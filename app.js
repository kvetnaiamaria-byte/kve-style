const localRepository=KveStorage.createLocalRepository({getItem:key=>localStorage.getItem(key),setItem:(key,value)=>localStorage.setItem(key,value)});
let repository=localRepository;
let db=repository.load();
let filesData=[];
let ideaPhotoData='';
let editingLook=null;
let editingIdea=null;
let lookTagsDraft=[];
let ideaTagsDraft=[];
let lookFoldersDraft=[];
let activeTag='Все';

function save(){
  try { repository.save(db); return true; }
  catch(e){
    db=repository.load();
    alert(e.name==='QuotaExceededError' ? 'Не хватает места. Изменения не сохранены, прежние данные на месте. Скачайте резервную копию в меню ••• или выберите фото меньшего размера.' : e.message);
    return false;
  }
}
function go(id){
  document.querySelectorAll('.page').forEach(x=>x.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  document.querySelectorAll('.nav button').forEach(b=>b.setAttribute('aria-current',b.dataset.page===id?'page':'false'));
  window.scrollTo(0,0);
}

function toggleSheet(){document.getElementById('sheet').classList.toggle('show')}
function openModal(id){document.getElementById(id).classList.add('show');renderFolderOptions()}
function closeModal(id){document.getElementById(id).classList.remove('show')}

function esc(s=''){
  return String(s).replace(/[&<>'"]/g,c=>({
    '&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'
  }[c]));
}

function renderFolderOptions(){
  const el=document.getElementById('lookFolders');
  if(!el)return;
  el.innerHTML=db.folders.length?db.folders.map((f,i)=>
    `<label class="folderCheck">
      <input type="checkbox" ${lookFoldersDraft.includes(f)?'checked':''} onchange="toggleLookFolder(${i},this.checked)">
      <span>${esc(f)}</span>
    </label>`
  ).join(''):`<div class="small">Папок пока нет</div>`;
}

function toggleLookFolder(i,on){
  const f=db.folders[i];
  if(on&&!lookFoldersDraft.includes(f))lookFoldersDraft.push(f);
  if(!on)lookFoldersDraft=lookFoldersDraft.filter(x=>x!==f);
}

function allTags(){
  return [...new Set(db.looks.flatMap(x=>x.tags))].slice(0,8);
}

function lookSearchText(x){
  return [x.note,...(x.folders||[]),...x.tags].join(' ').toLowerCase();
}

function renderTagDraft(kind){
  const arr=kind==='look'?lookTagsDraft:ideaTagsDraft;
  const box=document.getElementById(kind+'TagBox');
  const input=document.getElementById(kind+'TagInput');
  box.querySelectorAll('.tagpill').forEach(x=>x.remove());

  arr.forEach((t,i)=>{
    const el=document.createElement('span');
    el.className='tagpill';
    el.innerHTML=esc(t)+' ×';
    el.onclick=()=>{
      arr.splice(i,1);
      renderTagDraft(kind);
    };
    box.insertBefore(el,input);
  });
}

function commitTag(kind){
  const input=document.getElementById(kind+'TagInput');
  const v=input.value.trim().replace(/^#/,'').replace(/,$/,'');
  if(v){
    const arr=kind==='look'?lookTagsDraft:ideaTagsDraft;
    if(!arr.includes(v))arr.push(v);
    input.value='';
    renderTagDraft(kind);
  }
}

function tagKey(e,kind){
  if(e.key==='Enter'||e.key===','){
    e.preventDefault();
    commitTag(kind);
  }
}

/* СЖАТИЕ ФОТО ПЕРЕД СОХРАНЕНИЕМ */
async function compressImage(file,maxSide=1400,quality=.78){
  return new Promise((resolve,reject)=>{
    const r=new FileReader();

    r.onerror=reject;

    r.onload=()=>{
      const img=new Image();

      img.onerror=reject;

      img.onload=()=>{
        const w=img.naturalWidth;
        const h=img.naturalHeight;
        const scale=Math.min(1,maxSide/Math.max(w,h));
        const nw=Math.round(w*scale);
        const nh=Math.round(h*scale);

        const c=document.createElement('canvas');
        c.width=nw;
        c.height=nh;

        const ctx=c.getContext('2d');
        ctx.drawImage(img,0,0,nw,nh);

        resolve(c.toDataURL('image/jpeg',quality));
      };

      img.src=r.result;
    };

    r.readAsDataURL(file);
  });
}

function resetLookForm(){
  editingLook=null;
  conversionIdea=null;
  photoGeneration.look++;
  renderAttributeFields('look',{});
  filesData=[];
  lookTagsDraft=[];
  lookFoldersDraft=[];
  document.getElementById('lookModalTitle').textContent='Добавить образ';
  document.getElementById('lookSaveBtn').textContent='Сохранить образ';
  document.getElementById('lookNote').value='';
  document.getElementById('preview').innerHTML='';
  document.getElementById('lookTagInput').value='';
  renderFolderOptions();
  renderTagDraft('look');
}

function startAddLook(){
  resetLookForm();
  toggleSheet();
  openModal('lookModal');
}

async function saveLook(e){
  e.preventDefault();
  commitTag('look');
  if(photoJobs.look)return;

  if(!filesData.length){
    alert('Добавь хотя бы одно фото');
    return;
  }

  const data={
    photos:[...filesData],
    folders:[...lookFoldersDraft],
    folder:lookFoldersDraft[0]||'',
    tags:[...lookTagsDraft],
    note:document.getElementById('lookNote').value.trim(),
    attributes:readAttributes('look')
  };



  if(editingLook){
    const i=db.looks.findIndex(x=>x.id===editingLook);
    db.looks[i]={...db.looks[i],...data};
  }else{
    db.looks.unshift({id:newId(),...data});
  }

  if(conversionIdea)db.ideas=db.ideas.filter(x=>x.id!==conversionIdea);
  if(!(repository.cloud?await saveCloud():save()))return;

  closeModal('lookModal');
  resetLookForm();
  renderAll();
  go('looks');
}

function openLook(id){
  const x=db.looks.find(x=>x.id===id);
  if(!x)return;

  document.getElementById('lookDetailBody').innerHTML=`
    ${x.photos.map(p=>`<img class="detailPhoto" alt="Фото образа" src="${photoSrc(p)}">`).join('')}
    <div class="detailMeta">
      ${(x.folders||[]).map(f=>`<span class="tag">${esc(f)}</span>`).join('')}
      ${x.tags.map(t=>`<span class="tag">#${esc(t)}</span>`).join('')}
    </div>
    ${x.note?`<div class="detailNote">${esc(x.note)}</div>`:''}
    <button class="primary secondary" aria-pressed="${!!x.favorite}" onclick="toggleFavorite(${id},true)">${x.favorite?'♥ В избранном':'♡ В избранное'}</button>
    <div class="detailMeta">${Object.values(x.attributes||{}).filter(Boolean).map(v=>`<span class="tag">${esc(v)}</span>`).join('')}</div>
    <div class="rowBtns">
      <button class="primary" onclick="editLook(${id})">Редактировать</button>
      <button class="primary danger" onclick="deleteLook(${id})">Удалить</button>
    </div>
  `;

  openModal('lookDetail');
}

function editLook(id){
  const x=db.looks.find(x=>x.id===id);
  if(!x)return;

  closeModal('lookDetail');
  editingLook=id;
  conversionIdea=null;
  photoGeneration.look++;
  document.getElementById('lookTagInput').value='';
  renderAttributeFields('look',x.attributes||{});
  filesData=[...x.photos];
  lookTagsDraft=[...x.tags];
  lookFoldersDraft=[...(x.folders||[])];

  document.getElementById('lookModalTitle').textContent='Редактировать образ';
  document.getElementById('lookSaveBtn').textContent='Сохранить изменения';
  document.getElementById('lookNote').value=x.note||'';

  renderFolderOptions();
  renderLookPreview();
  renderTagDraft('look');
  openModal('lookModal');
}

async function deleteLook(id){
  if(!confirm('Удалить этот образ?'))return;
  db.looks=db.looks.filter(x=>x.id!==id);
  if(!(repository.cloud?await saveCloud():save()))return;
  closeModal('lookDetail');
  renderAll();
}

function resetIdeaForm(){
  editingIdea=null;
  photoGeneration.idea++;
  ideaPhotoData='';
  ideaTagsDraft=[];
  document.getElementById('ideaModalTitle').textContent='Новая идея';
  document.getElementById('ideaSaveBtn').textContent='Сохранить идею';
  document.getElementById('ideaPreview').innerHTML='';
  document.getElementById('ideaText').value='';
  document.getElementById('ideaTagInput').value='';
  renderTagDraft('idea');
}

function startAddIdea(){
  resetIdeaForm();
  toggleSheet();
  openModal('ideaModal');
}

async function saveIdea(e){
  e.preventDefault();
  commitTag('idea');
  if(photoJobs.idea)return;
  if(!document.getElementById('ideaText').value.trim()){alert('Напиши текст идеи');return;}

  const data={
    text:document.getElementById('ideaText').value.trim(),
    tags:[...ideaTagsDraft],
    photo:ideaPhotoData
  };



  if(editingIdea){
    const i=db.ideas.findIndex(x=>x.id===editingIdea);
    db.ideas[i]={...db.ideas[i],...data};
  }else{
    db.ideas.unshift({id:newId(),...data});
  }

  if(!(repository.cloud?await saveCloud():save())){
    return;
  }

  closeModal('ideaModal');
  resetIdeaForm();
  renderAll();
  go('ideas');
}

function openIdea(id){
  const x=db.ideas.find(x=>x.id===id);
  if(!x)return;

  document.getElementById('ideaDetailBody').innerHTML=`
    ${x.photo?`<img class="detailPhoto" src="${photoSrc(x.photo)}" alt="Фото идеи">`:''}
    <div class="detailNote" style="margin-top:12px">${esc(x.text)}</div>
    <div class="detailMeta">
      ${x.tags.map(t=>`<span class="tag">#${esc(t)}</span>`).join('')}
    </div>
    <button class="primary" onclick="ideaToLook(${id})">Превратить в образ</button>
    <div class="rowBtns">
      <button class="primary secondary" onclick="editIdea(${id})">Редактировать</button>
      <button class="primary danger" onclick="deleteIdea(${id})">Удалить</button>
    </div>
  `;

  openModal('ideaDetail');
}

function editIdea(id){
  const x=db.ideas.find(x=>x.id===id);
  if(!x)return;

  closeModal('ideaDetail');
  editingIdea=id;
  photoGeneration.idea++;
  document.getElementById('ideaTagInput').value='';
  ideaPhotoData=x.photo||'';
  ideaTagsDraft=[...x.tags];

  document.getElementById('ideaModalTitle').textContent='Редактировать идею';
  document.getElementById('ideaSaveBtn').textContent='Сохранить изменения';
  document.getElementById('ideaText').value=x.text;
  document.getElementById('ideaPreview').innerHTML=x.photo?`<img src="${photoSrc(x.photo)}" alt="Фото идеи">`:'';

  renderTagDraft('idea');
  openModal('ideaModal');
}

async function deleteIdea(id){
  if(!confirm('Удалить эту идею?'))return;
  db.ideas=db.ideas.filter(x=>x.id!==id);
  if(!(repository.cloud?await saveCloud():save()))return;
  closeModal('ideaDetail');
  renderAll();
}

async function ideaToLook(id){
  const x=db.ideas.find(x=>x.id===id);
  if(!x)return;

  if(!x.photo){
    closeModal('ideaDetail');
    resetLookForm();
    conversionIdea=id;
    lookTagsDraft=[...x.tags];
    document.getElementById('lookNote').value=x.text;
    renderTagDraft('look');
    openModal('lookModal');
    return;
  }

  db.looks.unshift({
    id:newId(),
    photos:[x.photo],
    folders:[],
    folder:'',
    tags:[...x.tags],
    note:x.text
  });

  db.ideas=db.ideas.filter(i=>i.id!==id);
  if(!(repository.cloud?await saveCloud():save()))return;
  closeModal('ideaDetail');
  renderAll();
  go('looks');
}

function renderAll(){
  renderLooks();
  renderFolders();
  renderIdeas();
  renderList();
  renderFolderPage();
  renderRecommendations();
  renderFolderOptions();
}


let ideaFilter='all', searchFilter='all', listFilter='active', onlyFavorites=false;
let currentFolder=null, editingFolder=null, folderCoverDraft='', conversionIdea=null;
let editingList=null;
const photoJobs={look:0,idea:0,folder:0,list:0};
const photoGeneration={look:0,idea:0,folder:0,list:0};
let listPhotoDraft='';
function newId(){
  let id=Date.now();
  const ids=new Set([...db.looks,...db.ideas,...db.list].map(x=>x.id));
  while(ids.has(id))id++;
  return id;
}
function photoSrc(value){
  if(typeof value!=='string')return '';
  if(value.startsWith('kve-photo:'))return esc(repository.photo?.(value)||'');
  return /^(data:image\/(jpeg|png|webp|gif|avif);base64,|https?:\/\/)/i.test(value)?esc(value):'';
}
function chooseChips(id,items,current,action){
  const el=document.getElementById(id);
  el.innerHTML=items.map(([value,label])=>`<button type="button" class="chip ${value===current?'active':''}" aria-pressed="${value===current}" data-value="${esc(value)}">${esc(label)}</button>`).join('');
  el.querySelectorAll('button').forEach(b=>b.onclick=()=>action(b.dataset.value));
}
function lookCards(arr){
  return arr.map(x=>`<div class="look"><button class="photoButton" aria-label="Открыть образ${x.note?': '+esc(x.note):''}" onclick="openLook(${x.id})">${x.photos[0]?`<img loading="lazy" alt="Фото образа" src="${photoSrc(x.photos[0])}">`:'<div class="placeholder"></div>'}${x.tags[0]?`<span class="badge">${esc(x.tags[0])}</span>`:''}</button><button class="heart ${x.favorite?'selected':''}" aria-label="${x.favorite?'Убрать из избранного':'В избранное'}" aria-pressed="${!!x.favorite}" onclick="toggleFavorite(${x.id})">${x.favorite?'♥':'♡'}</button></div>`).join('');
}
function ideaCards(arr){
  return arr.map(x=>`<button class="idea ideaButton" onclick="openIdea(${x.id})"><b>${esc(x.text)}</b><span class="ideaTags">${x.tags.map(t=>`<span class="tag">#${esc(t)}</span>`).join('')}</span></button>`).join('');
}
function renderChips(){
  if(activeTag!=='Все'&&!allTags().includes(activeTag))activeTag='Все';
  const el=document.getElementById('filterChips');
  el.innerHTML=`<button class="chip ${!onlyFavorites&&activeTag==='Все'?'active':''}" data-mode="all">Все</button><button class="chip ${onlyFavorites?'active':''}" data-mode="favorites">♡ Избранное</button>`+allTags().map(t=>`<button class="chip ${t===activeTag?'active':''}" data-tag="${esc(t)}">${esc(t)}</button>`).join('');
  el.querySelectorAll('button').forEach(b=>b.onclick=()=>{
    if(b.dataset.mode){onlyFavorites=b.dataset.mode==='favorites';activeTag='Все';}
    else {activeTag=b.dataset.tag;onlyFavorites=false;}
    renderLooks();
  });
}
function renderLooks(){
  renderChips();
  const q=document.getElementById('homeSearch').value.trim();
  document.getElementById('homeCollection').hidden=!!q;
  document.getElementById('homeResults').hidden=!q;
  const arr=db.looks.filter(x=>(activeTag==='Все'||x.tags.includes(activeTag))&&(!onlyFavorites||x.favorite));
  document.getElementById('grid').innerHTML=lookCards(arr);
  const empty=document.getElementById('emptyLooks');
  empty.style.display=arr.length?'none':'block';
  empty.textContent=onlyFavorites?'Нажми ♡ на образе, чтобы добавить его в избранное':activeTag!=='Все'?'С этим тегом пока нет образов':'Нажми +, чтобы добавить первый образ';
  if(q)renderSearch();
}
function renderIdeas(){
  chooseChips('ideaFilters',[['all','Все'],['without','Без фото'],['with','С фото']],ideaFilter,v=>{ideaFilter=v;renderIdeas();});
  const arr=db.ideas.filter(x=>ideaFilter==='all'||(ideaFilter==='with'?!!x.photo:!x.photo));
  document.getElementById('ideaList').innerHTML=ideaCards(arr);
  const el=document.getElementById('emptyIdeas');
  el.style.display=arr.length?'none':'block';
  el.textContent=db.ideas.length?'Нет идей для этого фильтра':'Здесь будут идеи, которые хочется попробовать позже';
}
function renderSearch(){
  chooseChips('searchFilters',[['all','Все'],['looks','Образы'],['ideas','Идеи'],['folders','Папки']],searchFilter,v=>{searchFilter=v;renderSearch();});
  const q=document.getElementById('homeSearch').value.trim().toLowerCase();
  const looks=db.looks.filter(x=>lookSearchText(x).includes(q));
  const ideas=db.ideas.filter(x=>[x.text,...x.tags].join(' ').toLowerCase().includes(q));
  const folders=db.folders.filter(x=>x.toLowerCase().includes(q));
  let html='';
  if((searchFilter==='all'||searchFilter==='looks')&&looks.length)html+=`<h3 class="resultTitle">Образы · ${looks.length}</h3><div class="grid">${lookCards(looks)}</div>`;
  if((searchFilter==='all'||searchFilter==='ideas')&&ideas.length)html+=`<h3 class="resultTitle">Идеи · ${ideas.length}</h3>${ideaCards(ideas)}`;
  if((searchFilter==='all'||searchFilter==='folders')&&folders.length)html+=`<h3 class="resultTitle">Папки · ${folders.length}</h3><div class="folders">${folderCards(folders)}</div>`;
  document.getElementById('searchResults').innerHTML=html||'<div class="empty">Ничего не найдено. Попробуй другое слово или тип контента.</div>';
}
async function toggleFavorite(id,detail=false){
  const x=db.looks.find(x=>x.id===id);if(!x)return;
  x.favorite=!x.favorite;
  if(!(repository.cloud?await saveCloud():save()))return;
  renderAll();
  if(detail)openLook(id);
}
function folderCards(folders){
  return folders.map(f=>{
    const looks=db.looks.filter(x=>x.folders.includes(f));
    const cover=(Object.hasOwn(db.folderCovers,f)?db.folderCovers[f]:'')||looks[0]?.photos[0];
    return `<button class="folder folderButton" onclick="openFolder(${db.folders.indexOf(f)})"><div class="cover">${cover?`<img loading="lazy" alt="Обложка папки" src="${photoSrc(cover)}">`:''}</div><h3>${esc(f)}</h3><p>${looks.length} образов</p></button>`;
  }).join('');
}
function renderFolders(){
  document.getElementById('folderList').innerHTML=folderCards(db.folders)||'<div class="empty">Создай первую папку кнопкой +</div>';
}
function openFolder(index){currentFolder=db.folders[index];renderFolderPage();go('folderPage');}
function renderFolderPage(){
  if(currentFolder===null)return;
  const looks=db.looks.filter(x=>x.folders.includes(currentFolder));
  document.getElementById('folderTitle').textContent=currentFolder;
  document.getElementById('folderGrid').innerHTML=lookCards(looks);
  document.getElementById('emptyFolder').style.display=looks.length?'none':'block';
}
function startFolder(name=null){
  editingFolder=name;
  photoGeneration.folder++;
  folderCoverDraft=name&&Object.hasOwn(db.folderCovers,name)?db.folderCovers[name]:'';
  document.getElementById('folderName').value=name||'';
  document.getElementById('folderModalTitle').textContent=name===null?'Новая папка':'Изменить папку';
  document.getElementById('folderSaveBtn').textContent=name===null?'Создать папку':'Сохранить изменения';
  document.getElementById('folderDeleteBtn').hidden=name===null;
  renderFolderPreview();openModal('folderModal');
}
function renderFolderPreview(){document.getElementById('folderPreview').innerHTML=folderCoverDraft?`<img alt="Новая обложка" src="${photoSrc(folderCoverDraft)}">`:'';}
function clearFolderCover(){photoGeneration.folder++;folderCoverDraft='';renderFolderPreview();}
async function saveFolder(e){
  e.preventDefault();if(photoJobs.folder)return;
  const name=document.getElementById('folderName').value.trim();
  if(!name){alert('Напиши название папки');return;}
  if(db.folders.includes(name)&&name!==editingFolder){alert('Папка с таким названием уже есть');return;}
  const previous=editingFolder;
  if(previous===null)db.folders.push(name);
  else{
    db.folders=db.folders.map(f=>f===previous?name:f);
    db.looks.forEach(x=>{x.folders=x.folders.map(f=>f===previous?name:f);if(x.folder===previous)x.folder=name;});
    delete db.folderCovers[previous];
  }
  if(folderCoverDraft)Object.defineProperty(db.folderCovers,name,{value:folderCoverDraft,writable:true,enumerable:true,configurable:true});
  if(!(repository.cloud?await saveCloud():save()))return;
  lookFoldersDraft=lookFoldersDraft.map(f=>f===previous?name:f);
  if(currentFolder===previous)currentFolder=name;
  closeModal('folderModal');renderAll();
  if(previous===null)go('folders');
}
async function deleteFolder(){
  const name=editingFolder;
  if(name===null||!confirm('Удалить папку «'+name+'»? Все образы останутся в разделе «Образы».'))return;
  db.folders=db.folders.filter(f=>f!==name);
  db.looks.forEach(x=>{x.folders=x.folders.filter(f=>f!==name);x.folder=x.folders[0]||'';});
  delete db.folderCovers[name];
  if(!(repository.cloud?await saveCloud():save()))return;
  lookFoldersDraft=lookFoldersDraft.filter(f=>f!==name);
  currentFolder=null;closeModal('folderModal');renderAll();go('folders');
}
async function processPhotos(kind,files,apply){
  const generation=photoGeneration[kind];
  const btn=document.getElementById(kind+'SaveBtn');
  photoJobs[kind]++;btn.disabled=true;btn.setAttribute('aria-busy','true');
  try{
    for(const file of files){
      const photo=await compressImage(file,kind==='folder'?900:1400);
      if(generation===photoGeneration[kind])apply(photo);
    }
  }catch(e){alert('Не удалось обработать фото. Попробуй JPEG или PNG.');}
  finally{photoJobs[kind]--;btn.disabled=photoJobs[kind]>0;btn.setAttribute('aria-busy',String(photoJobs[kind]>0));}
}
async function previewFiles(){
  const input=document.getElementById('lookFiles');
  const files=[...input.files].slice(0,Math.max(0,6-filesData.length));input.value='';
  await processPhotos('look',files,p=>{if(filesData.length<6)filesData.push(p);renderLookPreview();});
}
function renderLookPreview(){document.getElementById('preview').innerHTML=filesData.map(p=>`<img alt="Фото образа" src="${photoSrc(p)}">`).join('');}
async function previewIdeaFile(){
  const input=document.getElementById('ideaFile');const files=[...input.files].slice(0,1);input.value='';
  photoGeneration.idea++;
  await processPhotos('idea',files,p=>{ideaPhotoData=p;document.getElementById('ideaPreview').innerHTML=`<img alt="Фото идеи" src="${photoSrc(p)}">`;});
}
async function previewFolderFile(){
  const input=document.getElementById('folderFile');const files=[...input.files].slice(0,1);input.value='';
  photoGeneration.folder++;
  await processPhotos('folder',files,p=>{folderCoverDraft=p;renderFolderPreview();});
}
function renderAttributeFields(prefix,values){
  document.getElementById(prefix+'Attributes').innerHTML=Object.entries(KveRecommendations.options).map(([key,config])=>`<div class="field"><label for="${prefix}-${key}">${config.label}</label><select id="${prefix}-${key}"><option value="">${prefix==='wear'?'Неважно':'Не указано'}</option>${config.values.map(v=>`<option ${values[key]===v?'selected':''}>${v}</option>`).join('')}</select></div>`).join('');
}
function readAttributes(prefix){return Object.fromEntries(Object.keys(KveRecommendations.options).map(key=>[key,document.getElementById(prefix+'-'+key).value]));}
function renderRecommendations(){
  if(!document.getElementById('wear-occasion'))return;
  const selected=readAttributes('wear');
  const results=KveRecommendations.rank(db.looks,selected);
  const el=document.getElementById('recommendResults');
  if(!Object.values(selected).some(Boolean)){el.innerHTML='<div class="empty">Выбери хотя бы один параметр</div>';return;}
  el.innerHTML=results.length?results.map(r=>`<div class="recommendCard"><div class="recommendPhoto">${lookCards([r.look])}</div><div><b>${r.matches.length===r.total?'Подходит по выбранным параметрам':'Частичное совпадение'}</b><p class="small">${r.matches.length} из ${r.total}: ${r.matches.map(esc).join(' · ')}</p><button class="textButton" onclick="openLook(${r.look.id})">Посмотреть образ →</button></div></div>`).join(''):'<div class="empty">Совпадений пока нет. Попробуй другие параметры или добавь теги и параметры к своим образам.</div>';
}
function listUrl(value){
  const text=String(value||'').trim();if(!text)return '';
  try{const url=new URL(/^[a-z][a-z0-9+.-]*:/i.test(text)?text:'https://'+text);return ['http:','https:'].includes(url.protocol)?url.href:'';}catch(e){return '';}
}
function renderList(){
  chooseChips('listFilters',[['active','Активные'],['done','Выполненные'],['all','Все']],listFilter,v=>{listFilter=v;renderList();});
  document.getElementById('listCount').textContent=db.list.filter(x=>!x.done).length+' активных';
  const items=db.list.filter(x=>listFilter==='all'||(listFilter==='done'?x.done:!x.done));
  document.getElementById('checklist').innerHTML=items.map(x=>{
    const url=listUrl(x.link);const price=x.price!==undefined&&x.price!==''?String(x.price):'';
    const currency={RUB:'₽',EUR:'€',USD:'$'}[x.currency]||esc(x.currency||'₽');
    return `<div class="listRow ${x.done?'done':''}"><input type="checkbox" aria-label="${x.done?'Вернуть в активные':'Выполнить'}: ${esc(x.text)}" ${x.done?'checked':''} onchange="toggleListItem(${x.id})">
      ${x.photo?`<button class="listPhoto" aria-label="Открыть вещь: ${esc(x.text)}" onclick="editListItem(${x.id})"><img loading="lazy" alt="Фото вещи" src="${photoSrc(x.photo)}"></button>`:''}
      <div class="listContent"><button class="listName" onclick="editListItem(${x.id})">${esc(x.text)}</button>${price?`<div class="listPrice">${esc(price.replace('.',','))} ${currency}</div>`:''}${url?`<a class="listLink" href="${esc(url)}" target="_blank" rel="noopener noreferrer">Открыть ссылку ↗</a>`:''}</div>
      <button class="listIcon" aria-label="Редактировать пункт" onclick="editListItem(${x.id})">✎</button><button class="listIcon" aria-label="Удалить пункт" onclick="deleteListItem(${x.id})">×</button></div>`;
  }).join('')||`<div class="empty">${listFilter==='done'?'Здесь будут выполненные пункты':'Добавь первую вещь кнопкой «Добавить вещь»'}</div>`;
}
async function toggleListItem(id){const x=db.list.find(x=>x.id===id);if(!x)return;x.done=!x.done;if(repository.cloud)await saveCloud();else save();renderList();}
async function deleteListItem(id){db.list=db.list.filter(x=>x.id!==id);if(repository.cloud?await saveCloud():save())renderList();}
function startListItem(id=null){
  const x=id===null?null:db.list.find(x=>x.id===id);if(id!==null&&!x)return;
  editingList=id;photoGeneration.list++;listPhotoDraft=x?.photo||'';
  document.getElementById('listModalTitle').textContent=x?'Изменить вещь':'Добавить вещь';
  document.getElementById('listSaveBtn').textContent=x?'Сохранить изменения':'Добавить в List';
  document.getElementById('listEditInput').value=x?.text||'';
  document.getElementById('listLink').value=x?.link||'';
  document.getElementById('listPrice').value=x?.price??'';
  document.getElementById('listCurrency').value=x?.currency||'RUB';
  renderListPhoto();openModal('listModal');
}
function editListItem(id){startListItem(id);}
function renderListPhoto(){
  document.getElementById('listPreview').innerHTML=listPhotoDraft?`<img alt="Фото вещи" src="${photoSrc(listPhotoDraft)}">`:'';
  document.getElementById('listRemovePhoto').hidden=!listPhotoDraft;
}
function removeListPhoto(){photoGeneration.list++;listPhotoDraft='';renderListPhoto();}
async function previewListFile(){
  const input=document.getElementById('listFile');const files=[...input.files].slice(0,1);input.value='';if(!files.length)return;
  photoGeneration.list++;
  document.getElementById('listPhotoStatus').textContent='Обрабатываем фото…';
  await processPhotos('list',files,p=>{listPhotoDraft=p;renderListPhoto();});
  if(!photoJobs.list)document.getElementById('listPhotoStatus').textContent='Фото необязательно. Перед сохранением оно будет сжато.';
}
async function saveListItem(e){
  e.preventDefault();if(photoJobs.list)return;
  const text=document.getElementById('listEditInput').value.trim();if(!text){alert('Напиши название вещи');return;}
  const enteredLink=document.getElementById('listLink').value.trim(),link=listUrl(enteredLink);
  if(enteredLink&&!link){alert('Добавь корректную ссылку, которая начинается с https:// или http://');return;}
  const price=document.getElementById('listPrice').value.trim().replace(/\s/g,'').replace(',','.');
  if(price&&!/^\d+(\.\d{1,2})?$/.test(price)){alert('Впиши цену числом, например 4990 или 4990,50');return;}
  const currency=document.getElementById('listCurrency').value;
  const data={text,link,price,currency,photo:listPhotoDraft};
  const isNew=editingList===null;
  if(isNew)db.list.unshift({id:newId(),done:false,...data});
  else{const x=db.list.find(x=>x.id===editingList);if(!x)return;Object.assign(x,data);}
  if(!(repository.cloud?await saveCloud():save()))return;
  if(isNew)listFilter='active';
  editingList=null;closeModal('listModal');renderList();go('listPage');
}
function saveListEdit(e){return saveListItem(e);}
async function exportData(){
  try{
  const url=URL.createObjectURL(new Blob([await repository.export()],{type:'application/json'}));
  const a=document.createElement('a');a.href=url;a.download='KVE-backup-'+new Date().toISOString().slice(0,10)+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }catch(e){alert('Не удалось скачать копию: '+e.message);}
}
async function importData(event){
  const input=event.target,file=input.files[0];input.value='';if(!file)return;
  try{
    const next=KveStorage.normalize(JSON.parse(await file.text()));
    if(!confirm(`Восстановить ${next.looks.length} образов, ${next.ideas.length} идей и ${next.list.length} пунктов List? Это заменит текущую библиотеку ${repository.cloud?'в облаке':'в этом браузере'}. Если они нужны, сначала скачай резервную копию.`))return;
    db=next;if(!(repository.cloud?await saveCloud():save()))return;currentFolder=null;editingList=null;activeTag='Все';onlyFavorites=false;renderAll();closeModal('dataModal');go('looks');
  }catch(e){alert('Не удалось прочитать копию. Текущие данные не изменены.');}
}
renderAttributeFields('look',{});
renderAttributeFields('wear',{});
renderAll();go('looks');
if(repository.error){const warning=document.getElementById('storageWarning');warning.hidden=false;warning.textContent='Не удалось прочитать данные. Исходная запись не изменена. Скачайте её через меню •••.';}
window.addEventListener('storage',event=>{
  if(!repository.cloud&&(event.key===KveStorage.KEY||event.key===null)){const warning=document.getElementById('storageWarning');warning.hidden=false;warning.textContent='Данные изменились в другой вкладке. Обнови страницу перед сохранением.';}
});
document.addEventListener('keydown',event=>{
  if(!window.kveBusy&&event.key==='Escape')document.querySelectorAll('.modal.show,.sheet.show').forEach(el=>closeModal(el.id));
});
