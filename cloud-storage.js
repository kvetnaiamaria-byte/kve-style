/* Private Supabase repository. No browser service keys; all writes checked by RLS. */
(function(root){
  const copy=x=>JSON.parse(JSON.stringify(x));
  const empty=()=>KveStorage.normalize({});
  function authStorage(){
    let pending;
    function database(){return pending||(pending=new Promise((resolve,reject)=>{
      const r=indexedDB.open('kve-account',1);
      r.onupgradeneeded=()=>r.result.createObjectStore('session');
      r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);
    }));}
    async function request(mode,action){const db=await database();return new Promise((resolve,reject)=>{
      const tx=db.transaction('session',mode),r=action(tx.objectStore('session'));
      tx.oncomplete=()=>resolve(r.result??null);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);
    });}
    return {getItem:k=>request('readonly',s=>s.get(k)),setItem:(k,v)=>request('readwrite',s=>s.put(v,k)),removeItem:k=>request('readwrite',s=>s.delete(k))};
  }
  function slots(doc){
    const result=[];
    for(const x of doc.looks)for(let i=0;i<x.photos.length;i++)result.push([x.photos,i]);
    for(const x of [...doc.ideas,...doc.list])if(x.photo)result.push([x,'photo']);
    for(const k of Object.keys(doc.folderCovers))if(doc.folderCovers[k])result.push([doc.folderCovers,k]);
    return result;
  }
  async function digest(bytes){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');}
  function failure(error){
    const m=error?.message||String(error);
    if(/KVE_CONFLICT/.test(m))return new Error('Библиотека изменилась на другом устройстве. Скопируй текст черновика и обнови библиотеку перед повторным сохранением.');
    if(/KVE_USER_QUOTA/.test(m))return new Error('Достигнут твой лимит фотографий. Удали ненужные фото и попробуй ещё раз.');
    if(/KVE_PROJECT_QUOTA/.test(m))return new Error('Общее хранилище KVÉ заполнено. Обратись к владельцу приложения.');
    return new Error('Не удалось подтвердить сохранение в облаке. Проверь интернет и обнови библиотеку перед повтором. '+m);
  }
  async function createRepository(client,user){
    let snapshot=empty(), revision=0, disposed=false;
    let urls=new Map();
    const bucket=client.storage.from('kve-photos');
    function check(){if(disposed)throw new Error('Сеанс завершён. Войди снова.');}
    function path(ref){if(!ref.startsWith('kve-photo:'+user.id+'/'))throw new Error('Фотография другого аккаунта');return ref.slice(10);}
    async function sign(doc){
      const refs=[...new Set(slots(doc).map(([o,k])=>o[k]))];
      const next=new Map();
      for(let i=0;i<refs.length;i+=100){
        const batch=refs.slice(i,i+100),{data,error}=await bucket.createSignedUrls(batch.map(path),3600);
        if(error)throw error;check();
        data.forEach((r,j)=>{if(r.error||!r.signedUrl)throw new Error('Фото недоступно');next.set(batch[j],r.signedUrl);});
      }
      return next;
    }
    async function refresh(){
      check();const {data,error}=await client.from('kve_libraries').select('revision,document').eq('owner_id',user.id).maybeSingle();
      if(error)throw error;
      const next=data?KveStorage.normalize(data.document):empty();
      const nextUrls=await sign(next);check();snapshot=next;revision=data?.revision||0;urls=nextUrls;
    }
    await refresh();
    return {
      cloud:true,user,load:()=>copy(snapshot),photo:ref=>urls.get(ref)||'',
      dispose(){disposed=true;urls.clear();snapshot=empty();},refresh,
      async usage(){const {data,error}=await client.rpc('kve_storage_usage');if(error)throw error;check();return data;},
      async save(document){
        check();const next=KveStorage.normalize(copy(document));const uploaded=new Map();
        try{
          for(const [object,key] of slots(next)){
            const ref=object[key];if(ref.startsWith('kve-photo:')){path(ref);continue;}
            if(uploaded.has(ref)){object[key]=uploaded.get(ref);continue;}
            const match=/^data:image\/(jpeg|png|webp|gif|avif);base64,([A-Za-z0-9+/=\r\n]+)$/.exec(ref);
            if(!match)throw new Error('Для переноса нужны встроенные фотографии из резервной копии KVÉ.');
            const bytes=Uint8Array.from(atob(match[2]),c=>c.charCodeAt(0));
            const filename=user.id+'/'+await digest(bytes)+'.'+(match[1]==='jpeg'?'jpg':match[1]);check();
            const reservation=await client.rpc('kve_reserve_photo',{p_name:filename,p_bytes:bytes.length});
            if(reservation.error)throw reservation.error;check();
            // Immutable uploads deduplicate identical photos. A duplicate never replaces data.
            const {error}=await bucket.upload(filename,new Blob([bytes],{type:'image/'+match[1]}),{upsert:false,contentType:'image/'+match[1]});
            if(error&&!['409','Duplicate'].includes(String(error.statusCode||error.code)))throw error;
            check();object[key]='kve-photo:'+filename;uploaded.set(ref,object[key]);
          }
          const nextUrls=await sign(next);check();
          const {data,error}=await client.rpc('kve_save_library',{p_document:next,p_expected_revision:revision});
          if(error)throw error;check();
          const oldRefs=new Set(slots(snapshot).map(([o,k])=>o[k]));
          const retained=new Set(slots(next).map(([o,k])=>o[k]));
          snapshot=next;revision=data;urls=nextUrls;
          // Only remove photos after the new document is committed. Server protects refs.
          const obsolete=[...oldRefs].filter(r=>!retained.has(r)).map(path);
          if(obsolete.length){
            const result=await bucket.remove(obsolete).catch(()=>({error:true}));
            if(!result.error)for(const name of obsolete)await Promise.resolve(client.rpc('kve_release_photo',{p_name:name})).catch(()=>{});
          }
        }catch(e){throw failure(e);}
      },
      async export(){
        const doc=copy(snapshot);
        const cached=new Map();
        for(const [o,k] of slots(doc)){
          const ref=o[k];if(!cached.has(ref)){
            const {data,error}=await bucket.download(path(ref));if(error)throw error;check();
            const uri=await new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=reject;r.readAsDataURL(data);});
            cached.set(ref,uri);
          }o[k]=cached.get(ref);
        }
        return JSON.stringify(doc);
      }
    };
  }
  // Repeatable merge: original IDs are remapped only if they collide; source hash
  // records completion in the same atomic cloud commit as the imported data.
  async function mergeLegacy(current,legacy,raw){
    const marker=await digest(new TextEncoder().encode(raw));
    if((current.importedSources||[]).includes(marker))return null;
    const next=copy(current),used=new Set([...next.looks,...next.ideas,...next.list].map(x=>x.id));
    for(const kind of ['looks','ideas','list'])for(const original of legacy[kind]){
      const x=copy(original);while(used.has(x.id))x.id++;used.add(x.id);next[kind].push(x);
    }
    next.folders=[...new Set([...next.folders,...legacy.folders])];
    next.folderCovers={...legacy.folderCovers,...next.folderCovers};
    next.importedSources=[...(next.importedSources||[]),marker];return next;
  }
  root.KveCloud={authStorage,createRepository,mergeLegacy,slots};
})(globalThis);
