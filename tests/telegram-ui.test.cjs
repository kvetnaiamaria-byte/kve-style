const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {JSDOM}=require('jsdom');
async function setup(telegram=true){
 const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8').replace(/<script src="[^"]+"><\/script>/g,'');
 const dom=new JSDOM(html,{url:'https://kve-style.vercel.app',runScripts:'dangerously'}),w=dom.window,context=dom.getInternalVMContext();
 w.alert=()=>{};w.confirm=()=>true;w.scrollTo=()=>{};w.KVE_CLOUD_CONFIG={enabled:true,telegramEnabled:true,url:'https://example.test',publishableKey:'public'};
 if(telegram)w.Telegram={WebApp:{initData:'signed-proof'}};
 const session={access_token:'existing-session',user:{id:'existing-user'}};
 w.supabase={createClient:()=>({auth:{getSession:async()=>({data:{session:null}}),onAuthStateChange:()=>{}}})};
 for(const name of ['storage.js','recommendations.js','app.js','telegram-ui.js'])vm.runInContext(fs.readFileSync(path.join(__dirname,'..',name),'utf8'),context);
 w.KveCloud={authStorage:()=>({getItem:async()=>null,setItem:async()=>{}})};
 vm.runInContext(fs.readFileSync(path.join(__dirname,'../cloud-ui.js'),'utf8'),context);
 await new Promise(r=>setImmediate(r));
 return {w,run:s=>vm.runInContext(s,context),close:()=>w.close(),session};
}
test('Telegram first login offers explicit creation and keeps existing email login',async()=>{
 const a=await setup();try{
 assert.equal(a.w.document.getElementById('cloudLayer').hidden,false);
 assert.equal(a.w.document.getElementById('cloudSignup').hidden,true);
 assert.ok(a.w.document.getElementById('cloudLogin'));
 let action;a.w.fetch=async(url,options)=>{action=JSON.parse(options.body).action;return {ok:true,json:async()=>({needs_registration:true})};};
 await a.run("telegramAuthenticate('login')");assert.equal(action,'login');assert.equal(a.w.document.getElementById('telegramNew').hidden,false);
 }finally{a.close();}
});
test('Telegram linking requires explicit consent and forwards current session without replacing library',async()=>{
 const a=await setup();try{
 a.run("cloudClient.auth.getSession=async()=>({data:{session:{access_token:'existing-session'}}})");
 let sent=0;a.w.fetch=async(url,options)=>{sent++;assert.equal(options.headers.Authorization,'Bearer existing-session');return {ok:true,json:async()=>({linked:true})};};
 a.w.confirm=()=>false;await a.run("telegramAuthenticate('link')");assert.equal(sent,0);
 a.w.confirm=()=>true;const before=a.run('JSON.stringify(db)');await a.run("telegramAuthenticate('link')");assert.equal(sent,1);assert.equal(a.run('JSON.stringify(db)'),before);
 }finally{a.close();}
});
test('ordinary browser offers bot link without pretending Telegram is authenticated',async()=>{
 const a=await setup(false);try{a.run('cloudGate()');assert.match(a.w.document.querySelector('#cloudLayer a').href,/archive_style_bot/);assert.equal(a.w.document.getElementById('telegramNew'),null);}finally{a.close();}
});
