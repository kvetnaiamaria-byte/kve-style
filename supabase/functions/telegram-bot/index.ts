import {createClient} from 'npm:@supabase/supabase-js@2.117.2';
import {configureBot,createHandler} from './handler.mjs';

const token=Deno.env.get('TELEGRAM_BOT_TOKEN');
if(!token)throw new Error('TELEGRAM_BOT_TOKEN is not configured');
const url=Deno.env.get('SUPABASE_URL')!;
const admin=createClient(url,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false,autoRefreshToken:false}});
const functionUrl=url+'/functions/v1/telegram-bot';

const handler=createHandler({
  token,
  claimUpdate:async(updateId:number)=>{
    await admin.from('kve_bot_updates').delete().lt('received_at',new Date(Date.now()-30*86400000).toISOString());
    const {error}=await admin.from('kve_bot_updates').insert({update_id:updateId});
    if(!error)return true;
    if(error.code==='23505')return false;
    throw error;
  },
  releaseUpdate:async(updateId:number)=>{await admin.from('kve_bot_updates').delete().eq('update_id',updateId);}
});
Deno.serve(async(req:Request)=>{
  // A harmless, idempotent setup request applies the fixed profile and webhook.
  // It never accepts configuration from the caller and never returns the token.
  if(req.method==='GET'){
    try{await configureBot(token,functionUrl);return new Response('configured');}
    catch{return new Response('configuration failed',{status:502});}
  }
  return handler(req);
});
