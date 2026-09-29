/* Cloud is opt-in: the original browser library is never overwritten or removed. */
let cloudClient,cloudSessionStore,cloudUser=null,cloudRefreshRunning=false;
window.kveBusy=false;
function cloudBusy(on,label='Сохраняем…'){
  window.kveBusy=on;document.getElementById('kveApp').inert=on;
  document.getElementById('cloudLayer').inert=on;
  const el=document.getElementById('cloudBusy');el.textContent=label;el.hidden=!on;
}
async function saveCloud(){
  if(window.kveBusy)return false;
  cloudBusy(true);
  try{await repository.save(db);db=repository.load();await cloudUsage();return true;}
  catch(e){db=repository.load();alert(e.message);return false;}
  finally{cloudBusy(false);}
}
function cloudMessage(message){const el=document.getElementById('cloudMessage');if(el)el.textContent=message;}
function cloudGate(){
  document.getElementById('kveApp').hidden=true;
  const layer=document.getElementById('cloudLayer');layer.hidden=false;
  layer.innerHTML=`<div class="cloudCard"><div class="brand">KVÉ</div><h2>Твоя библиотека в облаке</h2><p class="small">Войди, чтобы открывать свои образы на разных устройствах.</p>
  ${telegramGate()}<form id="cloudLogin"><div class="field"><label for="cloudEmail">Почта</label><input id="cloudEmail" type="email" autocomplete="email" required></div><div class="field"><label for="cloudPassword">Пароль</label><input id="cloudPassword" type="password" minlength="8" autocomplete="current-password" required></div><button class="primary" type="submit">Войти</button></form>
  <button id="cloudSignup" class="primary secondary" ${telegramEnabled()?'hidden':''}>Создать аккаунт</button><p id="cloudMessage" role="status" class="small"></p><p class="small">Регистрация по почте пока доступна только владельцу. Для нового аккаунта используй Telegram.</p><button class="textButton" id="cloudLocal">Вернуться к данным этого браузера</button></div>`;
  document.getElementById('cloudLogin').onsubmit=e=>{e.preventDefault();cloudAuthenticate(false);};
  document.getElementById('cloudSignup').onclick=()=>cloudAuthenticate(true);
  document.getElementById('cloudLocal').onclick=cloudUseLocal;
}
async function cloudAuthenticate(signup){
  const form=document.getElementById('cloudLogin');if(!form.reportValidity())return;
  const email=document.getElementById('cloudEmail').value.trim(),password=document.getElementById('cloudPassword').value;
  cloudBusy(true,signup?'Создаём аккаунт…':'Входим…');
  try{
    const {data,error}=signup?await cloudClient.auth.signUp({email,password,options:{emailRedirectTo:location.origin+'/cloud-confirm.html'}}):await cloudClient.auth.signInWithPassword({email,password});
    if(error)throw error;
    if(data.session)await cloudConnect();
    else cloudMessage('Открой письмо Supabase и подтверди почту. Затем вернись сюда и нажми «Войти».');
  }catch(e){cloudMessage('Не удалось войти: '+e.message);}
  finally{cloudBusy(false);}
}
async function cloudConnect(){
  // getUser validates with Auth; do not trust cached user metadata for ownership.
  const {data,error}=await cloudClient.auth.getUser();if(error||!data.user)throw error||new Error('Войди в аккаунт');
  const next=await KveCloud.createRepository(cloudClient,data.user);
  if(repository.cloud)repository.dispose();
  repository=next;cloudUser=data.user;db=repository.load();
  await cloudSessionStore.setItem('kve-mode','cloud');
  document.querySelectorAll('.modal.show,.sheet.show').forEach(x=>x.classList.remove('show'));
  currentFolder=null;resetLookForm();resetIdeaForm();listPhotoDraft='';folderCoverDraft='';editingList=null;
  document.getElementById('homeSearch').value='';activeTag='Все';onlyFavorites=false;
  document.getElementById('storageWarning').hidden=true;
  document.getElementById('cloudLayer').hidden=true;document.getElementById('kveApp').hidden=false;
  renderAll();go('looks');cloudAccount();await cloudUsage();
}
function cloudAccount(){
  const el=document.getElementById('cloudAccount');
  if(repository.cloud){
    el.innerHTML=`<p class="detailNote"><b>Облако подключено</b><br>${esc(telegramAccountLabel(cloudUser))}</p><p id="cloudUsage" class="small">Считаем объём…</p><button class="primary secondary" onclick="cloudRefresh(true)">Обновить библиотеку</button><button class="primary secondary" onclick="cloudMigrate()">Перенести данные этого браузера</button>${telegramEnabled()&&telegramAvailable()?'<button class="primary secondary" onclick="telegramAuthenticate(\'link\')">Привязать Telegram к этой библиотеке</button>':''}<button class="textButton" onclick="cloudLogout()">Выйти из аккаунта</button>`;
    document.getElementById('storageDescription').textContent='Эта библиотека сохраняется в твоём аккаунте. Для загрузки и сохранения нужен интернет. Резервная копия включает фотографии.';
  }else{
    el.innerHTML='<button class="primary secondary" onclick="cloudGate()">Подключить облако</button>';
    document.getElementById('storageDescription').textContent='Сейчас данные сохраняются только в этом браузере. Подключи облако для синхронизации.';
  }
}
async function cloudUsage(){
  try{const r=repository;if(!r.cloud)return;const u=await r.usage();if(r!==repository)return;
    const el=document.getElementById('cloudUsage');if(el)el.textContent=`Фотографии: ${(u.ownBytes/1000000).toFixed(1)} из ${u.limitBytes/1000000} МБ`;
  }catch(e){const el=document.getElementById('cloudUsage');if(el)el.textContent='Не удалось обновить объём хранилища.';}
}
async function cloudUseLocal(){
  if(repository.cloud)return;
  await cloudSessionStore.setItem('kve-mode','local');repository=localRepository;db=repository.load();
  document.getElementById('cloudLayer').hidden=true;document.getElementById('kveApp').hidden=false;
  renderAll();cloudAccount();
}
async function cloudLogout(){
  if(window.kveBusy)return;
  cloudBusy(true,'Выходим…');
  try{const {error}=await cloudClient.auth.signOut({scope:'local'});if(error)throw error;
    if(repository.cloud)repository.dispose();repository=localRepository;cloudUser=null;db=KveStorage.normalize({});
    resetLookForm();resetIdeaForm();listPhotoDraft='';folderCoverDraft='';currentFolder=null;
    document.querySelectorAll('.detailPhoto').forEach(x=>x.remove());renderAll();cloudGate();
  }catch(e){alert('Не удалось выйти: '+e.message);}finally{cloudBusy(false);}
}
async function cloudMigrate(){
  if(!repository.cloud||window.kveBusy)return;
  let raw;try{raw=localStorage.getItem(KveStorage.KEY);}catch(e){alert('Данные браузера недоступны');return;}
  if(!raw){alert('В этом браузере нет старой библиотеки. Открой KVÉ на том устройстве и по тому адресу, где ты сохраняла образы.');return;}
  cloudBusy(true,'Готовим перенос…');
  try{
    const legacy=KveStorage.normalize(JSON.parse(raw));
    const bound=await cloudSessionStore.getItem('kve-legacy-owner');
    if(bound&&bound!==cloudUser.id)throw new Error('Эта библиотека уже привязана к другому аккаунту. Войди в него для переноса.');
    const next=await KveCloud.mergeLegacy(db,legacy,raw);
    if(!next){alert('Эта версия библиотеки уже перенесена.');return;}
    if(!confirm(`Перенести ${legacy.looks.length} образов, ${legacy.ideas.length} идей и ${legacy.list.length} вещей в аккаунт ${telegramAccountLabel(cloudUser)}? Подтверди, что это твои данные. Сначала будет скачана резервная копия. Старые данные останутся в браузере.`))return;
    const url=URL.createObjectURL(new Blob([raw],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='KVE-before-cloud.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);
    // Bind before upload, so a failed migration cannot later be claimed by another account.
    await cloudSessionStore.setItem('kve-legacy-owner',cloudUser.id);
    await repository.save(next);db=repository.load();renderAll();await cloudUsage();
    alert('Библиотека перенесена. Исходные данные сохранены в браузере.');
  }catch(e){alert(e.message);}finally{cloudBusy(false);}
}
async function cloudRefresh(manual=false){
  if(!repository.cloud||window.kveBusy||cloudRefreshRunning)return;
  if(!manual&&(document.hidden||document.querySelector('.modal.show,.sheet.show')))return;
  cloudRefreshRunning=true;cloudBusy(true,'Обновляем библиотеку…');
  try{await repository.refresh();db=repository.load();renderAll();await cloudUsage();}
  catch(e){if(manual)alert('Не удалось обновить: '+e.message);}
  finally{cloudRefreshRunning=false;cloudBusy(false);}
}
(async function(){
  if(!window.KVE_CLOUD_CONFIG?.enabled)return;
  cloudSessionStore=KveCloud.authStorage();
  cloudClient=supabase.createClient(KVE_CLOUD_CONFIG.url,KVE_CLOUD_CONFIG.publishableKey,{auth:{storage:cloudSessionStore,persistSession:true,detectSessionInUrl:false,autoRefreshToken:true},global:{fetch:(url,options)=>fetch(url,{...options,signal:options?.signal||AbortSignal.timeout(45000)})}});
  document.getElementById('kveApp').hidden=true;
  try{
    const mode=await cloudSessionStore.getItem('kve-mode');
    const {data,error}=await cloudClient.auth.getSession();if(error)throw error;
    if(data.session){cloudBusy(true,'Открываем облако…');await cloudConnect();}
    else if(mode==='cloud'||(telegramEnabled()&&telegramAvailable()))cloudGate();else{document.getElementById('kveApp').hidden=false;cloudAccount();}
  }catch(e){cloudGate();cloudMessage('Облако недоступно: '+e.message);}
  finally{cloudBusy(false);}
  cloudClient.auth.onAuthStateChange((event,session)=>{
    if(repository.cloud&&(!session||session.user.id!==repository.user.id)){
      repository.dispose();repository=localRepository;cloudUser=null;db=KveStorage.normalize({});
      resetLookForm();resetIdeaForm();listPhotoDraft='';folderCoverDraft='';currentFolder=null;
      document.querySelectorAll('.detailPhoto').forEach(x=>x.remove());
      document.getElementById('lookDetailBody').innerHTML='';document.getElementById('ideaDetailBody').innerHTML='';
      renderAll();cloudGate();
    }
  });
  window.addEventListener('focus',()=>cloudRefresh());setInterval(()=>cloudRefresh(),60000);
})();
