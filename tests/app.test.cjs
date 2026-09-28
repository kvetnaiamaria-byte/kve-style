const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const root = path.join(__dirname, '..');
const photo = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6cgAAAABJRU5ErkJggg==';
const legacy = { looks: [{ id: 10, folder: 'Лето', photos: [photo], tags: ['лето'], note: 'На прогулку' }], folders: ['Лето', 'На каждый день'], ideas: [{id: 11, text: 'Голубая рубашка', tags: ['лето'], photo}], customFutureField: {keep: true} };
function app(seed=legacy) {
  const html=fs.readFileSync(path.join(root,'index.html'),'utf8').replace(/<script src="[^"]+"><\/script>/g,'');
  const dom=new JSDOM(html,{url:'https://kve-test.example',runScripts:'dangerously'});
  const w=dom.window;w.alerts=[];w.alert=x=>w.alerts.push(x);w.confirm=()=>true;w.scrollTo=()=>{};
  if(seed!==null)w.localStorage.setItem('kve-v01',typeof seed==='string'?seed:JSON.stringify(seed));
  for(const name of ['storage.js','recommendations.js','app.js'])vm.runInContext(fs.readFileSync(path.join(root,name),'utf8'),dom.getInternalVMContext());
  const q=s=>w.document.querySelector(s);
  const run=s=>vm.runInContext(s,dom.getInternalVMContext());
  const state=()=>JSON.parse(w.localStorage.getItem('kve-v01'));
  return {w,q,run,state,close:()=>w.close()};
}
const submit = '({preventDefault(){}})';

test('legacy data loads without an automatic write and remains backward compatible',()=>{
  const a=app();assert.equal(a.w.localStorage.getItem('kve-v01'),JSON.stringify(legacy));
  assert.equal(a.q('#grid').children.length,1);a.run('toggleFavorite(10)');
  assert.equal(a.state().looks[0].folder,'Лето');assert.deepEqual(a.state().looks[0].folders,['Лето']);
  assert.equal(a.state().looks[0].photos[0],photo);assert.equal(a.state().customFutureField.keep,true);a.close();
});
test('look create, multiple folders, pending tags, note, attributes, edit, open and delete',()=>{
  const a=app();a.run('resetLookForm()');a.run(`filesData=[${JSON.stringify(photo)}];lookFoldersDraft=['Лето','На каждый день']`);
  a.q('#lookTagInput').value='минимализм';a.q('#lookNote').value='Белая рубашка';a.q('#look-season').value='Лето';
  a.run(`saveLook(${submit})`);let x=a.state().looks[0];assert.deepEqual(x.folders,['Лето','На каждый день']);assert.deepEqual(x.tags,['минимализм']);assert.equal(x.attributes.season,'Лето');
  a.run(`openLook(${x.id})`);assert.match(a.q('#lookDetailBody').textContent,/Белая рубашка/);
  a.run(`editLook(${x.id})`);a.q('#lookNote').value='Изменённая заметка';a.run(`saveLook(${submit})`);assert.equal(a.state().looks[0].note,'Изменённая заметка');
  a.run(`deleteLook(${x.id})`);assert.equal(a.state().looks.length,1);a.close();
});
test('look requires a photo, idea does not; whitespace idea is rejected',()=>{
  const a=app(null);a.run('resetLookForm()');a.run(`saveLook(${submit})`);assert.match(a.w.alerts.pop(),/фото/);
  a.run('resetIdeaForm()');a.q('#ideaText').value='  ';a.run(`saveIdea(${submit})`);assert.match(a.w.alerts.pop(),/текст/);
  a.q('#ideaText').value='Купить ремень';a.run(`saveIdea(${submit})`);assert.equal(a.state().ideas[0].photo,'');a.close();
});
test('idea filters, edit, delete and photo conversion preserve content',()=>{
  const a=app();a.run('resetIdeaForm()');a.q('#ideaText').value='Без фото';a.run(`saveIdea(${submit})`);
  a.run("ideaFilter='without';renderIdeas()");assert.equal(a.q('#ideaList').children.length,1);
  a.run("ideaFilter='with';renderIdeas()");assert.match(a.q('#ideaList').textContent,/Голубая/);
  a.run('ideaToLook(11)');const converted=a.state().looks[0];assert.equal(converted.photos[0],photo);assert.equal(converted.note,'Голубая рубашка');assert.deepEqual(converted.tags,['лето']);
  const id=a.state().ideas[0].id;a.run(`editIdea(${id})`);a.q('#ideaText').value='Новая идея';a.run(`saveIdea(${submit})`);assert.equal(a.state().ideas[0].text,'Новая идея');a.run(`deleteIdea(${id})`);assert.equal(a.state().ideas.length,0);a.close();
});
test('photo-free conversion waits for photo and cancellation leaves original idea intact',()=>{
  const a=app({looks:[],folders:[],ideas:[{id:20,text:'Образ без фото',tags:['белый']}]});
  a.run('ideaToLook(20)');assert.equal(a.state().ideas.length,1);a.run("closeModal('lookModal')");assert.equal(a.state().ideas.length,1);
  a.run('ideaToLook(20)');a.run(`filesData=[${JSON.stringify(photo)}]`);a.run(`saveLook(${submit})`);assert.equal(a.state().ideas.length,0);assert.equal(a.state().looks[0].note,'Образ без фото');a.close();
});
test('folder open, rename references, cover persist and delete preserve looks',()=>{
  const a=app();a.run('openFolder(0)');assert.equal(a.q('#folderGrid').children.length,1);
  a.run("startFolder('Лето')");a.q('#folderName').value='Отпуск';a.run(`folderCoverDraft=${JSON.stringify(photo)}`);a.run(`saveFolder(${submit})`);
  assert.deepEqual(a.state().looks[0].folders,['Отпуск']);assert.equal(a.state().looks[0].folder,'Отпуск');assert.equal(a.state().folderCovers['Отпуск'],photo);
  a.run("startFolder('Отпуск');deleteFolder()");assert.equal(a.state().looks.length,1);assert.deepEqual(a.state().looks[0].folders,[]);assert.equal(a.state().folderCovers['Отпуск'],undefined);a.close();
});
test('folder duplicate rename fails without changing saved data',()=>{
  const a=app();a.run("startFolder('Лето')");a.q('#folderName').value='На каждый день';a.run(`saveFolder(${submit})`);assert.match(a.w.alerts.pop(),/уже есть/);assert.deepEqual(a.state().folders,legacy.folders);a.close();
});
test('unified search finds look tags/notes/folders and ideas, and type filters work',()=>{
  const a=app();a.q('#homeSearch').value='лето';a.run('renderLooks()');assert.equal(a.q('#homeCollection').hidden,true);assert.match(a.q('#searchResults').textContent,/Образы/);assert.match(a.q('#searchResults').textContent,/Идеи/);assert.match(a.q('#searchResults').textContent,/Папки/);
  a.run("searchFilter='ideas';renderSearch()");assert.equal(a.q('#searchResults .grid'),null);assert.equal(a.q('#searchResults .idea').textContent.includes('Голубая'),true);
  a.q('#homeSearch').value='прогулку';a.run("searchFilter='all';renderSearch()");assert.equal(a.q('#searchResults .grid').children.length,1);a.close();
});
test('favorites persist across reload and edit',()=>{
  const a=app();a.run('toggleFavorite(10);editLook(10)');a.q('#lookNote').value='Новое';a.run(`saveLook(${submit})`);const saved=a.state();a.close();
  const b=app(saved);b.run('onlyFavorites=true;renderLooks()');assert.equal(b.q('#grid').children.length,1);b.run('toggleFavorite(10)');assert.equal(b.q('#grid').children.length,0);b.close();
});
test('List create, edit, complete, restore, filter, delete, reload',()=>{
  const a=app();a.q('#listInput').value='Купить ремень';a.run(`addListItem(${submit})`);const id=a.state().list[0].id;
  a.run(`editListItem(${id})`);a.q('#listEditInput').value='Подобрать ремень';a.run(`saveListEdit(${submit},${id})`);
  a.run(`toggleListItem(${id})`);assert.equal(a.state().list[0].done,true);a.run("listFilter='done';renderList()");assert.match(a.q('#checklist').textContent,/Подобрать ремень/);
  const saved=a.state();a.close();const b=app(saved);b.run(`toggleListItem(${id})`);assert.equal(b.state().list[0].done,false);b.run(`deleteListItem(${id})`);assert.equal(b.state().list.length,0);b.close();
});
test('recommendations use saved looks, rank matches and reject explicit conflicts',()=>{
  const a=app();const result=a.run("KveRecommendations.rank(db.looks,{season:'Лето',occasion:'Работа'})");assert.equal(result.length,1);assert.equal(result[0].matches.length,1);assert.equal(result[0].total,2);
  assert.equal(a.run("KveRecommendations.rank([{id:1,tags:['лето'],attributes:{season:'Зима'}}],{season:'Лето'}).length"),0);
  assert.equal(a.run('KveRecommendations.rank(db.looks,{}).length'),0);a.close();
});
function failWrites(a){a.w.Storage.prototype.setItem=function(){throw new a.w.DOMException('full','QuotaExceededError');};}
test('quota failure leaves idea conversion, deletion and folder rename unchanged in memory and storage',()=>{
  const a=app();const raw=a.w.localStorage.getItem('kve-v01');failWrites(a);
  a.run('ideaToLook(11)');assert.equal(a.run('db.ideas.length'),1);assert.equal(a.run('db.looks.length'),1);
  a.run('deleteLook(10)');assert.equal(a.run('db.looks.length'),1);
  a.run("startFolder('Лето')");a.q('#folderName').value='Переименовать';a.run(`saveFolder(${submit})`);assert.equal(a.run('db.folders[0]'),'Лето');
  assert.equal(a.w.localStorage.getItem('kve-v01'),raw);assert.equal(a.w.alerts.length,3);a.close();
});
test('corrupt localStorage is not silently overwritten',()=>{
  const a=app('{broken');assert.equal(a.q('#storageWarning').hidden,false);a.q('#listInput').value='Новое';a.run(`addListItem(${submit})`);assert.equal(a.w.localStorage.getItem('kve-v01'),'{broken');a.close();
});
test('conflicting write from a second tab is blocked',()=>{
  const a=app();const other=JSON.stringify({...legacy,looks:[]});a.w.localStorage.setItem('kve-v01',other);a.run('toggleFavorite(10)');assert.equal(a.w.localStorage.getItem('kve-v01'),other);assert.match(a.w.alerts.pop(),/другой вкладке/);a.close();
});
test('separate browser repositories do not share data',()=>{
  const a=app();const b=app(null);assert.equal(b.q('#grid').children.length,0);a.run('toggleFavorite(10)');assert.equal(b.w.localStorage.getItem('kve-v01'),null);a.close();b.close();
});
test('imported text and cover names cannot inject executable markup',()=>{
  const a=app({looks:[{id:1,tags:['<img src=x onerror=alert(1)>'],note:'<script>alert(1)</script>',photos:[photo]}],ideas:[],folders:['__proto__']});assert.equal(a.q('#grid .badge img'),null);
  a.run('openLook(1)');assert.equal(a.q('#lookDetailBody script'),null);a.run("startFolder('__proto__')");a.run(`folderCoverDraft=${JSON.stringify(photo)}`);a.run(`saveFolder(${submit})`);assert.equal(a.state().folderCovers.__proto__,photo);a.close();
});
test('future schema data is protected from downgrade',()=>{
  const seed={...legacy,schemaVersion:99};const a=app(seed);a.q('#listInput').value='test';a.run(`addListItem(${submit})`);assert.deepEqual(a.state(),seed);a.close();
});

test('cancelled photo-free conversion cannot delete the idea when editing a different look',()=>{
  const a=app({...legacy,ideas:[{id:22,text:'Не удалять',tags:[]}]});a.run('ideaToLook(22);editLook(10)');a.run(`saveLook(${submit})`);assert.equal(a.state().ideas.length,1);a.close();
});
test('backup import is validated, can be cancelled and round-trips photos',async()=>{
  const a=app();const before=a.w.localStorage.getItem('kve-v01');
  await a.w.importData({target:{files:[{text:async()=>'{broken'}],value:'x'}});assert.equal(a.w.localStorage.getItem('kve-v01'),before);
  a.w.confirm=()=>false;await a.w.importData({target:{files:[{text:async()=>JSON.stringify({looks:[],folders:[],ideas:[]})}],value:'x'}});assert.equal(a.w.localStorage.getItem('kve-v01'),before);
  a.w.confirm=()=>true;await a.w.importData({target:{files:[{text:async()=>JSON.stringify({...legacy,list:[{id:99,text:'План',done:true}]})}],value:'x'}});assert.equal(a.state().looks[0].photos[0],photo);assert.equal(a.state().list[0].done,true);a.close();
});
test('photo processing disables save and late results cannot leak into a new draft',async()=>{
  const a=app();a.run('resetLookForm();globalThis.resolvePhoto=null;compressImage=()=>new Promise(resolve=>{globalThis.resolvePhoto=resolve})');
  const job=a.run("processPhotos('look',[{}],p=>filesData.push(p))");assert.equal(a.q('#lookSaveBtn').disabled,true);
  a.run('resetLookForm()');a.w.resolvePhoto(photo);await job;assert.equal(a.run('filesData.length'),0);assert.equal(a.q('#lookSaveBtn').disabled,false);a.close();
});

test('List item stores link, price, currency and photo across reload and completion',()=>{
  const a=app();a.run('startListItem()');a.q('#listEditInput').value='Лоферы';a.q('#listLink').value='example.com/loafers';a.q('#listPrice').value='4 990,50';a.q('#listCurrency').value='EUR';a.run(`listPhotoDraft=${JSON.stringify(photo)}`);a.run(`saveListItem(${submit})`);
  const x=a.state().list[0];assert.equal(x.link,'https://example.com/loafers');assert.equal(x.price,'4990.50');assert.equal(x.photo,photo);assert.equal(x.currency,'EUR');assert.equal(a.q('#checklist a').getAttribute('rel'),'noopener noreferrer');
  const b=app(a.state());b.run(`toggleListItem(${x.id});editListItem(${x.id})`);assert.equal(b.q('#listPrice').value,'4990.50');assert.equal(b.q('#listLink').value,x.link);assert.equal(b.q('#listPreview img').getAttribute('src'),photo);b.q('#listEditInput').value='Новые лоферы';b.run(`saveListItem(${submit})`);assert.equal(b.state().list[0].done,true);assert.equal(b.state().list[0].photo,photo);a.close();b.close();
});
test('List blocks invalid price and executable links; photo and optional fields can be removed',()=>{
  const a=app();a.run('startListItem()');a.q('#listEditInput').value='Ремень';a.q('#listLink').value='javascript:alert(1)';a.run(`saveListItem(${submit})`);assert.match(a.w.alerts.pop(),/ссылку/);a.q('#listLink').value='';a.q('#listPrice').value='-100';a.run(`saveListItem(${submit})`);assert.match(a.w.alerts.pop(),/цену/);a.q('#listPrice').value='0';a.run(`listPhotoDraft=${JSON.stringify(photo)}`);a.run(`saveListItem(${submit})`);const id=a.state().list[0].id;assert.match(a.q('#checklist').textContent,/0 ₽/);
  a.run(`editListItem(${id});removeListPhoto()`);a.q('#listPrice').value='';a.run(`saveListItem(${submit})`);assert.equal(a.state().list[0].photo,'');assert.equal(a.state().list[0].price,'');a.close();
});
test('legacy List can be enriched and failed photo save preserves data and the draft',()=>{
  const a=app({...legacy,list:[{id:99,text:'Старый пункт',done:true}]});a.run('editListItem(99)');a.q('#listLink').value='https://example.com';a.q('#listPrice').value='1500';a.run(`listPhotoDraft=${JSON.stringify(photo)}`);failWrites(a);a.run(`saveListItem(${submit})`);assert.equal(a.state().list[0].link,undefined);assert.equal(a.run('listPhotoDraft'),photo);assert.equal(a.q('#listModal').classList.contains('show'),true);a.close();
});
test('late item photo cannot replace the next item draft',async()=>{
  const a=app();a.run('startListItem();globalThis.resolvePhoto=null;compressImage=()=>new Promise(resolve=>{globalThis.resolvePhoto=resolve})');const job=a.run("processPhotos('list',[{}],p=>{listPhotoDraft=p})");assert.equal(a.q('#listSaveBtn').disabled,true);a.run('startListItem()');a.w.resolvePhoto(photo);await job;assert.equal(a.run('listPhotoDraft'),'');assert.equal(a.q('#listSaveBtn').disabled,false);a.close();
});

test('idea photographs stay hidden in lists and search but open in details and editing',()=>{
  const a=app();assert.equal(a.q('#ideaList img'),null);a.run("ideaFilter='with';renderIdeas()");assert.equal(a.q('#ideaList').children.length,1);assert.equal(a.q('#ideaList img'),null);
  a.q('#homeSearch').value='рубашка';a.run("searchFilter='ideas';renderLooks()");assert.equal(a.q('#searchResults img'),null);
  a.run('openIdea(11)');assert.equal(a.q('#ideaDetailBody img').getAttribute('src'),photo);
  a.run('editIdea(11)');assert.equal(a.q('#ideaPreview img').getAttribute('src'),photo);assert.equal(a.state().ideas[0].photo,photo);a.close();
});
