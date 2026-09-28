import {createClient} from 'npm:@supabase/supabase-js@2.117.2';
import {createHandler} from './handler.mjs';
// These default Edge secrets stay on the server. A fresh session client per request
// prevents verifyOtp from contaminating the service-role client's authorization.
Deno.serve((req:Request)=>{
  const url=Deno.env.get('SUPABASE_URL')!;
  const options={auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}};
  const admin=createClient(url,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,options);
  const sessionClient=createClient(url,Deno.env.get('SUPABASE_ANON_KEY')!,options);
  return createHandler({admin,sessionClient})(req);
});
