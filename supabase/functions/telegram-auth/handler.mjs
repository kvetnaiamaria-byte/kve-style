import {verifyTelegram} from './verify.mjs';
const BOT_ID='8904793828';
const ORIGINS=new Set([
  'https://kve-style.vercel.app',
  'https://kve-style-git-codex-kve-test-version-kvetnaiamaria.vercel.app',
  'https://kve-style-git-codex-telegram-login-kvetnaiamaria.vercel.app'
]);
const messages={INVALID_TELEGRAM:'Открой KVÉ через @archive_style_bot в Telegram.',EXPIRED_TELEGRAM:'Закрой мини-приложение и открой его снова: время входа истекло.',KVE_TG_REPLAY:'Закрой мини-приложение и открой его снова для входа.',KVE_TG_CONFLICT:'Этот Telegram или аккаунт уже связан с другой библиотекой. Войди прежним способом.',KVE_TG_RATE:'Подожди немного и открой приложение снова.',NEED_ACCOUNT:'Сначала войди в существующий аккаунт по почте.'};
export function createHandler({admin,sessionClient,verify=verifyTelegram}){
  return async req=>{
    const origin=req.headers.get('Origin');
    const headers={'Content-Type':'application/json','Cache-Control':'no-store','Vary':'Origin'};
    if(origin&&ORIGINS.has(origin))Object.assign(headers,{'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info','Access-Control-Allow-Methods':'POST, OPTIONS'});
    const reply=(body,status=200)=>new Response(JSON.stringify(body),{status,headers});
    if(origin&&!ORIGINS.has(origin))return reply({error:'Недопустимый адрес приложения.'},403);
    if(req.method==='OPTIONS')return new Response(null,{status:204,headers});
    if(req.method!=='POST')return reply({error:'Method not allowed'},405);
    try{
      if(Number(req.headers.get('content-length')||0)>20000)return reply({error:'Request too large'},413);
      // Enforce size even on chunked bodies; never log the body, proof or tokens.
      const reader=req.body?.getReader();if(!reader)throw new Error('INVALID_TELEGRAM');
      const chunks=[];let size=0;
      while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>20000){await reader.cancel();return reply({error:'Request too large'},413);}chunks.push(value);}
      const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
      const body=JSON.parse(new TextDecoder().decode(bytes));
      if(!['login','create','link'].includes(body.action))throw new Error('INVALID_TELEGRAM');
      const identity=await verify(body.initData,BOT_ID);
      let linkUser=null;
      if(body.action==='link'){
        const token=req.headers.get('Authorization')?.match(/^Bearer (.+)$/)?.[1];
        if(!token)throw new Error('NEED_ACCOUNT');
        const {data,error}=await admin.auth.getUser(token);
        if(error||!data.user?.email_confirmed_at)throw new Error('NEED_ACCOUNT');
        linkUser=data.user.id;
      }
      const {data:account,error:claimError}=await admin.rpc('kve_telegram_claim',{p_telegram_id:identity.id,p_fingerprint:identity.fingerprint,p_action:body.action,p_link_user:linkUser});
      if(claimError)throw new Error(claimError.message);
      if(account.needs_registration)return reply({needs_registration:true});
      if(body.action==='link')return reply({linked:true});
      let result=await admin.auth.admin.getUserById(account.user_id);
      if(result.error&&!account.provisioned&&result.error.status===404){
        result=await admin.auth.admin.createUser({id:account.user_id,email:account.email,email_confirm:true,app_metadata:{kve_telegram_account:true}});
      }
      if(result.error||result.data.user?.id!==account.user_id)throw new Error('ACCOUNT_FAILED');
      const user=result.data.user;
      if(!account.provisioned){
        if(user.email!==account.email||user.app_metadata?.kve_telegram_account!==true)throw new Error('ACCOUNT_FAILED');
        const {error}=await admin.from('kve_telegram_accounts').update({provisioned:true}).eq('telegram_id',identity.id).eq('user_id',user.id);if(error)throw error;
      }
      if(!user.email||!user.email_confirmed_at)throw new Error('ACCOUNT_FAILED');
      const {data:link,error:linkError}=await admin.auth.admin.generateLink({type:'magiclink',email:user.email});
      if(linkError||link.user?.id!==user.id||!link.properties?.hashed_token)throw new Error('SESSION_FAILED');
      const {data,error}=await sessionClient.auth.verifyOtp({token_hash:link.properties.hashed_token,type:'email'});
      if(error||!data.session||data.user?.id!==user.id)throw new Error('SESSION_FAILED');
      return reply({access_token:data.session.access_token,refresh_token:data.session.refresh_token});
    }catch(e){
      const code=Object.keys(messages).find(x=>String(e.message).includes(x));
      return reply({error:code?messages[code]:'Не удалось завершить вход. Закрой KVÉ и попробуй снова.'},code==='KVE_TG_RATE'?429:401);
    }
  };
}
