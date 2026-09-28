const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');
test('Telegram mapping is server-only, unique, replay protected and preserves existing uid',async()=>{
 const db=new PGlite();
 try{
 await db.exec('create role anon;create role authenticated;create role service_role bypassrls;grant usage on schema public to anon,authenticated,service_role;');
 await db.exec(fs.readFileSync(path.join(__dirname,'../supabase/migrations/20260928142743_telegram_auth.sql'),'utf8'));
 const proof='a'.repeat(64),uid='11111111-1111-4111-8111-111111111111';
 for(const role of ['anon','authenticated']){
  await db.exec('set role '+role);
  await assert.rejects(db.query('select * from public.kve_telegram_accounts'));
  await assert.rejects(db.query("select kve_telegram_claim(123,$1,'link',$2)",[proof,uid]));
  await db.exec('reset role');
 }
 await db.exec('set role service_role');
 let r=await db.query("select kve_telegram_claim(123,$1,'login',null) as a",[proof]);assert.equal(r.rows[0].a.needs_registration,true);
 r=await db.query("select kve_telegram_claim(123,$1,'link',$2) as a",[proof,uid]);assert.equal(r.rows[0].a.user_id,uid);assert.equal(r.rows[0].a.provisioned,true);
 await assert.rejects(db.query("select kve_telegram_claim(124,$1,'link',$2)",['b'.repeat(64),uid]),/KVE_TG_CONFLICT/);
 await db.query("update kve_telegram_accounts set last_attempt=now()-interval '11 seconds'");
 await assert.rejects(db.query("select kve_telegram_claim(123,$1,'login',null)",[proof]),/KVE_TG_REPLAY/);
 await assert.rejects(db.query("select kve_telegram_claim(123,$1,'link',$2)",['c'.repeat(64),'22222222-2222-4222-8222-222222222222']),/KVE_TG_CONFLICT/);
 r=await db.query("select kve_telegram_claim(456,$1,'create',null) as a",['d'.repeat(64)]);const fresh=r.rows[0].a;
 assert.notEqual(fresh.user_id,uid);assert.match(fresh.email,/@kve\.invalid$/);assert.equal(fresh.provisioned,false);
 await assert.rejects(db.query("select kve_telegram_claim(456,$1,'login',null)",['e'.repeat(64)]),/KVE_TG_RATE/);
 }finally{await db.close();}
});
