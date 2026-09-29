export const APP_URL='https://kve-style.vercel.app/';
export const WELCOME='Привет! Это KVÉ — твоя личная библиотека образов.\n\nЗдесь можно:\n• сохранять образы, идеи и заметки\n• собирать папки и избранное\n• вести список вещей и покупок\n• получать подсказку «Что надеть?»\n\nНажми кнопку ниже, чтобы открыть KVÉ.';

const encoder=new TextEncoder();
function equal(a,b){
  const left=encoder.encode(a||''),right=encoder.encode(b||'');
  let diff=left.length^right.length;
  for(let i=0;i<Math.max(left.length,right.length);i++)diff|=(left[i]||0)^(right[i]||0);
  return diff===0;
}
export async function webhookSecret(token){
  const data=encoder.encode('kve-telegram-webhook:'+token);
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',data)),x=>x.toString(16).padStart(2,'0')).join('');
}
async function telegram(token,method,body,fetcher=fetch){
  const response=await fetcher(`https://api.telegram.org/bot${token}/${method}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(15000)});
  const result=await response.json().catch(()=>({ok:false}));
  if(!response.ok||!result.ok)throw new Error('TELEGRAM_API_FAILED');
  return result.result;
}
export async function configureBot(token,functionUrl,fetcher=fetch){
  const secret=await webhookSecret(token);
  const calls=[
    ['setWebhook',{url:functionUrl,secret_token:secret,allowed_updates:['message'],drop_pending_updates:false}],
    ['setMyCommands',{commands:[{command:'start',description:'О KVÉ и как начать'},{command:'app',description:'Открыть приложение'},{command:'help',description:'Помощь'}]}],
    ['setMyDescription',{description:'KVÉ — личная библиотека образов, идей и вещей. Сохраняй гардероб и находи, что надеть.'}],
    ['setMyShortDescription',{short_description:'Личная библиотека образов и идей'}],
    ['setChatMenuButton',{menu_button:{type:'web_app',text:'Открыть KVÉ',web_app:{url:APP_URL}}}]
  ];
  for(const [method,body] of calls)await telegram(token,method,body,fetcher);
}
export function createHandler({token,claimUpdate,releaseUpdate,fetcher=fetch}){
  return async req=>{
    if(req.method!=='POST')return new Response('ok',{status:200});
    const expected=await webhookSecret(token);
    if(!equal(req.headers.get('X-Telegram-Bot-Api-Secret-Token'),expected))return new Response('forbidden',{status:403});
    if(Number(req.headers.get('content-length')||0)>262144)return new Response('too large',{status:413});
    let update;try{update=await req.json();}catch{return new Response('bad request',{status:400});}
    if(!Number.isSafeInteger(update?.update_id)||update.update_id<0)return new Response('bad request',{status:400});
    if(!await claimUpdate(update.update_id))return new Response('ok');
    const message=update.message;
    if(!message||message.chat?.type!=='private'||message.from?.is_bot)return new Response('ok');
    if(!Number.isSafeInteger(message.chat.id))return new Response('ok');
    try{
      await telegram(token,'sendMessage',{chat_id:message.chat.id,text:WELCOME,reply_markup:{inline_keyboard:[[{text:'Открыть KVÉ',web_app:{url:APP_URL}}]]}},fetcher);
      return new Response('ok');
    }catch{
      await releaseUpdate(update.update_id);
      return new Response('retry',{status:500});
    }
  };
}
