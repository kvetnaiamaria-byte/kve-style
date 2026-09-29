const {test}=require('node:test'),assert=require('node:assert/strict');
const {webcrypto}=require('node:crypto');
const now=1800000000,bot='8904793828';
async function fixture(){
  const keys=await webcrypto.subtle.generateKey('Ed25519',true,['sign','verify']);
  const pub=Buffer.from(await webcrypto.subtle.exportKey('raw',keys.publicKey)).toString('hex');
  const {makeVerifier,verifyTelegram}=await import('../supabase/functions/telegram-auth/verify.mjs');
  async function sign(changes={}){
    const p=new URLSearchParams({auth_date:String(now),user:JSON.stringify({id:1234567890123,first_name:'Мария'}),...changes});p.sort();
    const msg=bot+':WebAppData\n'+Array.from(p,([k,v])=>k+'='+v).join('\n');
    p.set('signature',Buffer.from(await webcrypto.subtle.sign('Ed25519',keys.privateKey,new TextEncoder().encode(msg))).toString('base64url'));
    return p.toString();
  }
  return {verify:makeVerifier(pub),production:verifyTelegram,sign};
}
test('Telegram verifies signed user and binds signature to bot',async()=>{
  const f=await fixture(),data=await f.sign();assert.equal((await f.verify(data,bot,now)).id,'1234567890123');
  await assert.rejects(f.verify(data,'8904793829',now));await assert.rejects(f.production(data,bot,now));
});
test('Telegram rejects forged user, duplicate fields and missing signature',async()=>{
  const f=await fixture(),data=await f.sign();
  await assert.rejects(f.verify(data.replace('1234567890123','1234567890124'),bot,now));
  await assert.rejects(f.verify(data+'&auth_date='+now,bot,now));
  await assert.rejects(f.verify('auth_date='+now,bot,now));
});
test('Telegram rejects stale/future proof and invalid user IDs',async()=>{
  const f=await fixture();
  await assert.rejects(f.verify(await f.sign(),bot,now+301));
  await assert.rejects(f.verify(await f.sign(),bot,now-31));
  for(const id of [0,-1,1.2,'123',9007199254740992])await assert.rejects(f.verify(await f.sign({user:JSON.stringify({id})}),bot,now));
});
test('Telegram replay fingerprint ignores attacker-editable hash and encoding order',async()=>{
  const f=await fixture(),data=await f.sign(),a=await f.verify(data,bot,now),b=await f.verify(data+'&hash=anything',bot,now);
  assert.equal(a.fingerprint,b.fingerprint);
});
test('Telegram endpoint verifies proof before DB access and links only a server-verified user',async()=>{
 const {createHandler}=await import('../supabase/functions/telegram-auth/handler.mjs');let calls=0;
 const req=(action='login',token)=>new Request('https://example.test',{method:'POST',headers:{Origin:'https://kve-style.vercel.app','Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:JSON.stringify({action,initData:'proof',user_id:'attacker'})});
 const admin={auth:{getUser:async()=>({data:{user:{id:'verified',email_confirmed_at:'2026'}}})},rpc:async(name,args)=>{calls++;assert.equal(args.p_link_user,'verified');return {data:{user_id:'verified'}};}};
 let handler=createHandler({admin,verify:async()=>{throw new Error('INVALID_TELEGRAM');}});
 assert.equal((await handler(req())).status,401);assert.equal(calls,0);
 handler=createHandler({admin,verify:async()=>({id:'123',fingerprint:'abc'})});
 assert.equal((await handler(req('link'))).status,401);assert.equal(calls,0);
 assert.deepEqual(await (await handler(req('link','token'))).json(),{linked:true});assert.equal(calls,1);
});
test('Telegram session exchange refuses UID mismatch and keeps tokens out of errors',async()=>{
 const {createHandler}=await import('../supabase/functions/telegram-auth/handler.mjs');let uid='mapped';
 const admin={rpc:async()=>({data:{user_id:'mapped',provisioned:true}}),auth:{admin:{getUserById:async()=>({data:{user:{id:'mapped',email:'private@example.test',email_confirmed_at:'2026'}}}),generateLink:async()=>({data:{user:{id:uid},properties:{hashed_token:'secret'}}})}}};
 const handler=createHandler({admin,verify:async()=>({id:'123',fingerprint:'abc'}),sessionClient:{auth:{verifyOtp:async()=>({data:{user:{id:'mapped'},session:{access_token:'access',refresh_token:'refresh'}}})}}});
 const request=()=>new Request('https://example.test',{method:'POST',body:JSON.stringify({action:'login',initData:'proof'})});
 assert.deepEqual(await (await handler(request())).json(),{access_token:'access',refresh_token:'refresh'});
 uid='wrong';const denied=await handler(request());assert.equal(denied.status,401);assert.doesNotMatch(await denied.text(),/secret|access|refresh/);
});
