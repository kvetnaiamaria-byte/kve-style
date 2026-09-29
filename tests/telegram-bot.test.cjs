const {test}=require('node:test'),assert=require('node:assert/strict');
async function module(){return import('../supabase/functions/telegram-bot/handler.mjs');}
function jsonResponse(data,status=200){return new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});}
test('bot configuration installs webhook secret, commands, description and app button',async()=>{
  const {configureBot,webhookSecret,APP_URL}=await module(),calls=[];
  await configureBot('123:secret','https://example.functions/telegram-bot',async(url,options)=>{calls.push({url,body:JSON.parse(options.body)});return jsonResponse({ok:true,result:true});});
  assert.deepEqual(calls.map(x=>x.url.split('/').pop()),['setWebhook','setMyCommands','setMyDescription','setMyShortDescription','setChatMenuButton']);
  assert.equal(calls[0].body.secret_token,await webhookSecret('123:secret'));assert.equal(calls[0].body.url,'https://example.functions/telegram-bot');
  assert.equal(calls[4].body.menu_button.web_app.url,APP_URL);assert.deepEqual(calls[1].body.commands.map(x=>x.command),['start','app','help']);
});
test('webhook rejects forged secret before reading or recording update',async()=>{
  const {createHandler}=await module();let claimed=0;
  const handler=createHandler({token:'123:secret',claimUpdate:async()=>{claimed++;return true;},releaseUpdate:async()=>{}});
  const result=await handler(new Request('https://example.test',{method:'POST',headers:{'Content-Type':'application/json','X-Telegram-Bot-Api-Secret-Token':'wrong'},body:'{"update_id":1}'}));
  assert.equal(result.status,403);assert.equal(claimed,0);
});
test('private start receives one welcome with web app button; retry is deduplicated',async()=>{
  const {createHandler,webhookSecret,APP_URL}=await module(),seen=new Set(),sent=[];
  const token='123:secret',handler=createHandler({token,claimUpdate:async id=>{if(seen.has(id))return false;seen.add(id);return true;},releaseUpdate:async()=>{},fetcher:async(url,options)=>{sent.push(JSON.parse(options.body));return jsonResponse({ok:true,result:{}});}});
  const headers={'Content-Type':'application/json','X-Telegram-Bot-Api-Secret-Token':await webhookSecret(token)};
  const body=JSON.stringify({update_id:22,message:{chat:{id:123,type:'private'},from:{is_bot:false},text:'/start'}});
  assert.equal((await handler(new Request('https://example.test',{method:'POST',headers,body}))).status,200);
  assert.equal((await handler(new Request('https://example.test',{method:'POST',headers,body}))).status,200);
  assert.equal(sent.length,1);assert.match(sent[0].text,/личная библиотека/);assert.equal(sent[0].reply_markup.inline_keyboard[0][0].web_app.url,APP_URL);
});
test('bot stays quiet in groups and retries after a Telegram delivery failure',async()=>{
  const {createHandler,webhookSecret}=await module(),seen=new Set();let released=0,attempts=0;
  const token='123:secret',handler=createHandler({token,claimUpdate:async id=>{if(seen.has(id))return false;seen.add(id);return true;},releaseUpdate:async id=>{released++;seen.delete(id);},fetcher:async()=>{attempts++;return jsonResponse({ok:false},500);}});
  const headers={'Content-Type':'application/json','X-Telegram-Bot-Api-Secret-Token':await webhookSecret(token)};
  const group=JSON.stringify({update_id:1,message:{chat:{id:-1,type:'group'},from:{is_bot:false},text:'/start'}});
  assert.equal((await handler(new Request('https://x',{method:'POST',headers,body:group}))).status,200);assert.equal(attempts,0);
  const dm=JSON.stringify({update_id:2,message:{chat:{id:4,type:'private'},from:{is_bot:false},text:'/start'}});
  assert.equal((await handler(new Request('https://x',{method:'POST',headers,body:dm}))).status,500);assert.equal(released,1);
});
