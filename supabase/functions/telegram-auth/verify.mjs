// Telegram production Ed25519 key, not a bot secret. Never accept a key from a request.
export const TELEGRAM_KEY='e7bf03a2fa4602af4580703d88dda5bb59f32ed8b02a56c187fe7d34caed242d';
export function makeVerifier(publicKeyHex=TELEGRAM_KEY){
  return async function verify(initData,botId,now=Math.floor(Date.now()/1000)){
    const reject=()=>{throw new Error('INVALID_TELEGRAM');};
    if(typeof initData!=='string'||initData.length>16384||!/^\d{1,16}$/.test(botId))reject();
    const params=new URLSearchParams(initData),seen=new Set();
    for(const [key] of params){if(seen.has(key)||!/^[a-z_]+$/.test(key))reject();seen.add(key);}
    const date=params.get('auth_date');
    if(!/^\d{1,12}$/.test(date||''))reject();
    if(now-Number(date)>300||Number(date)-now>30)throw new Error('EXPIRED_TELEGRAM');
    const signature=params.get('signature');
    if(!/^[A-Za-z0-9_-]{86}(==)?$/.test(signature||''))reject();
    const bytes=Uint8Array.from(atob(signature.replace(/-/g,'+').replace(/_/g,'/')),x=>x.charCodeAt(0));
    params.delete('signature');params.delete('hash');params.sort();
    const message=botId+':WebAppData\n'+Array.from(params,([k,v])=>k+'='+v).join('\n');
    const encoded=new TextEncoder().encode(message);
    const key=await crypto.subtle.importKey('raw',Uint8Array.from(publicKeyHex.match(/../g),x=>parseInt(x,16)),{name:'Ed25519'},false,['verify']);
    if(!await crypto.subtle.verify('Ed25519',key,bytes,encoded))reject();
    let user;try{user=JSON.parse(params.get('user'));}catch{reject();}
    if(!user||!Number.isSafeInteger(user.id)||user.id<=0||user.is_bot)reject();
    const fingerprint=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',encoded)),x=>x.toString(16).padStart(2,'0')).join('');
    return {id:String(user.id),fingerprint};
  };
}
export const verifyTelegram=makeVerifier();
