function telegramAvailable(){return !!window.Telegram?.WebApp?.initData;}
function telegramEnabled(){return !!window.KVE_CLOUD_CONFIG?.telegramEnabled;}
function telegramGate(){
  if(!telegramEnabled())return '';
  return telegramAvailable()?'<button type="button" class="primary" onclick="telegramAuthenticate(\'login\')">Войти через Telegram</button><div id="telegramNew" hidden><p class="small">Telegram пока не связан с библиотекой. Если у тебя уже есть аккаунт, войди по почте ниже и привяжи Telegram в разделе «Данные».</p><button class="primary secondary" onclick="telegramAuthenticate(\'create\')">Я здесь впервые — создать библиотеку</button></div><p class="small">Или войди в существующий аккаунт по почте</p>':'<p class="small">Новую библиотеку можно бесплатно создать через Telegram.</p><a class="primary secondary" href="https://t.me/archive_style_bot?startapp" target="_blank" rel="noopener">Открыть KVÉ в Telegram</a>';
}
async function telegramAuthenticate(action){
  if(window.kveBusy||!telegramEnabled())return;
  if(!telegramAvailable()){alert('Открой KVÉ через @archive_style_bot в Telegram.');return;}
  if(action==='link'&&!confirm('Связать этот Telegram с текущей библиотекой? После привязки через Telegram можно будет открывать её на других устройствах.'))return;
  if(action==='create'&&!confirm('Создать новую пустую библиотеку? Если у тебя уже есть облачный аккаунт, войди по почте и привяжи Telegram к нему.'))return;
  cloudBusy(true,action==='link'?'Привязываем Telegram…':'Входим через Telegram…');
  try{
    const {data:sessionData,error:sessionError}=await cloudClient.auth.getSession();if(sessionError)throw sessionError;
    const headers={'Content-Type':'application/json',apikey:KVE_CLOUD_CONFIG.publishableKey};
    if(action==='link'&&sessionData.session)headers.Authorization='Bearer '+sessionData.session.access_token;
    const response=await fetch(KVE_CLOUD_CONFIG.url+'/functions/v1/telegram-auth',{method:'POST',headers,body:JSON.stringify({action,initData:Telegram.WebApp.initData}),signal:AbortSignal.timeout(45000)});
    const data=await response.json();if(!response.ok)throw new Error(data.error||'Не удалось войти.');
    if(data.needs_registration){document.getElementById('telegramNew').hidden=false;cloudMessage('Выбери новую библиотеку или войди в свой существующий аккаунт.');return;}
    if(data.linked){alert('Telegram привязан. Библиотека и лимит остались прежними.');return;}
    const {error}=await cloudClient.auth.setSession({access_token:data.access_token,refresh_token:data.refresh_token});if(error)throw error;
    await cloudConnect();
  }catch(e){if(action==='link')alert(e.message);else cloudMessage(e.message);}
  finally{cloudBusy(false);}
}
function telegramAccountLabel(user){return user?.app_metadata?.kve_telegram_account?'Аккаунт Telegram':user?.email||'Мой аккаунт';}
