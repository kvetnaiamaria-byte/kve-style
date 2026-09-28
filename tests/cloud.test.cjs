const {test}=require('node:test'),assert=require('node:assert/strict');
require('../storage.js');require('../cloud-storage.js');
const user={id:'10000000-0000-4000-8000-000000000001'};
const photo='data:image/png;base64,aGVsbG8=';
function mock(){
  let doc=null,revision=0,fail=false;const objects=new Map(),removed=[];let reserves=0;
  const bucket={
    async upload(path,blob){objects.set(path,blob);return {};},
    async createSignedUrls(paths){return {data:paths.map(path=>({signedUrl:'https://private.example/'+path}))};},
    async remove(paths){for(const p of paths){removed.push(p);objects.delete(p);}return {};}
  };
  const client={storage:{from:()=>bucket},from:()=>({select:()=>({eq:()=>({maybeSingle:async()=>({data:doc?{document:doc,revision}:null})})})}),async rpc(name,args){
    if(name==='kve_reserve_photo'){reserves++;return {data:true};}
    if(name==='kve_release_photo')return {data:true};
    if(name==='kve_save_library'){
      if(fail)return {error:{message:'KVE_USER_QUOTA'}};
      if(args.p_expected_revision!==revision)return {error:{message:'KVE_CONFLICT'}};
      doc=structuredClone(args.p_document);return {data:++revision};
    }
    return {data:{limitBytes:50000000}};
  }};
  return {client,objects,removed,get reserves(){return reserves;},set fail(v){fail=v;}};
}
test('cloud deduplicates identical photos and saves references in every section',async()=>{
  const m=mock(),repo=await KveCloud.createRepository(m.client,user),d=repo.load();
  d.looks=[{id:1,photos:[photo],tags:[],folders:[]}];d.ideas=[{id:2,text:'idea',photo}];d.list=[{id:3,text:'item',photo}];d.folderCovers={'Лето':photo};
  await repo.save(d);assert.equal(m.objects.size,1);assert.equal(m.reserves,1);
  const saved=repo.load();for(const [o,k] of KveCloud.slots(saved))assert.match(o[k],/^kve-photo:/);
  assert.equal(d.ideas[0].photo,photo);assert.match(repo.photo(saved.ideas[0].photo),/^https:/);
});
test('failed cloud commit retains original snapshot and does not delete images',async()=>{
  const m=mock(),repo=await KveCloud.createRepository(m.client,user);let d=repo.load();d.ideas=[{id:1,text:'original',photo}];await repo.save(d);
  m.fail=true;d=repo.load();d.ideas=[];await assert.rejects(()=>repo.save(d),/лимит/);assert.equal(repo.load().ideas[0].text,'original');assert.equal(m.removed.length,0);
});
test('cloud rejects references belonging to another user',async()=>{
  const m=mock(),repo=await KveCloud.createRepository(m.client,user),d=repo.load();d.ideas=[{id:1,text:'x',photo:'kve-photo:another/account.jpg'}];
  await assert.rejects(()=>repo.save(d),/другого аккаунта/);assert.equal(m.objects.size,0);
});
test('concurrent device cannot overwrite a newer revision',async()=>{
  const m=mock(),a=await KveCloud.createRepository(m.client,user),b=await KveCloud.createRepository(m.client,user);
  await a.save(a.load());await assert.rejects(()=>b.save(b.load()),/другом устройстве/);
  await b.refresh();await b.save(b.load());
});
test('cloud deletes obsolete photos only after committing metadata',async()=>{
  const m=mock(),r=await KveCloud.createRepository(m.client,user),d=r.load();d.ideas=[{id:1,text:'x',photo}];await r.save(d);
  const next=r.load();next.ideas=[];await r.save(next);assert.equal(m.objects.size,0);assert.equal(m.removed.length,1);
});
test('logout disposes cached photos and blocks further repository work',async()=>{
  const m=mock(),r=await KveCloud.createRepository(m.client,user);r.dispose();await assert.rejects(()=>r.refresh(),/Сеанс/);await assert.rejects(()=>r.save(r.load()),/Сеанс/);
});
test('legacy migration is additive, idempotent, and does not mutate the source',async()=>{
  const current=KveStorage.normalize({ideas:[{id:1,text:'cloud'}]}),old=KveStorage.normalize({ideas:[{id:1,text:'local',photo}],list:[{id:2,text:'item'}]});
  const raw=JSON.stringify(old),merged=await KveCloud.mergeLegacy(current,old,raw);
  assert.equal(merged.ideas.length,2);assert.notEqual(merged.ideas[0].id,merged.ideas[1].id);assert.equal(JSON.stringify(old),raw);
  assert.equal(await KveCloud.mergeLegacy(merged,old,raw),null);assert.equal(current.ideas.length,1);
});
