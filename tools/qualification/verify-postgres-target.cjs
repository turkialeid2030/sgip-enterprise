#!/usr/bin/env node
const fs=require('fs'),path=require('path'),crypto=require('crypto');
let Pool; try{({Pool}=require('pg'))}catch(e){console.error('PG_MODULE_MISSING');process.exit(2)}
const root=process.env.SGIP_ROOT||process.cwd();
const url=process.env.DATABASE_URL;
if(!url){console.error('DATABASE_URL_MISSING');process.exit(2)}
const expectedRole=process.env.SGIP_EXPECTED_DB_ROLE||'sgip_app';
const normalise=s=>s.replace(/--[^\n]*/g,'').replace(/\s+/g,' ').trim();
const dir=process.env.SGIP_MIGRATIONS_DIR||path.join(root,'db','migrations');
const files=fs.readdirSync(dir).filter(x=>x.endsWith('.sql')).sort();
if(!files.length){console.error('NO_MIGRATIONS');process.exit(2)}
const expected=files.map(file=>{const sql=fs.readFileSync(path.join(dir,file),'utf8');return {version:file.split('_')[0],file,checksum:crypto.createHash('sha256').update(normalise(sql)).digest('hex').slice(0,16),sql}});
const pool=new Pool({connectionString:url,max:1,connectionTimeoutMillis:5000});
let bad=0; const fail=(m)=>{console.log('FAIL '+m);bad++},pass=(m)=>console.log('PASS '+m);
(async()=>{
 try{
  const role=(await pool.query(`SELECT current_user AS role, rolsuper, rolbypassrls FROM pg_roles WHERE rolname=current_user`)).rows[0];
  if(!role) fail('runtime role unresolved');
  else {
    if(role.role!==expectedRole) fail(`runtime role expected=${expectedRole} actual=${role.role}`); else pass(`runtime role=${role.role}`);
    if(role.rolsuper) fail('runtime role is superuser'); else pass('runtime role not superuser');
    if(role.rolbypassrls) fail('runtime role has BYPASSRLS'); else pass('runtime role cannot bypass RLS');
  }
  let ledger;
  try{ledger=(await pool.query(`SELECT version,checksum,status FROM schema_migrations ORDER BY version`)).rows}catch(e){fail('schema_migrations missing');ledger=[]}
  const by=new Map(ledger.map(x=>[String(x.version),x]));
  for(const e of expected){const row=by.get(e.version);if(!row)fail(`migration missing ${e.file}`);else if(row.status!=='applied')fail(`migration not applied ${e.file} status=${row.status}`);else if(String(row.checksum)!==e.checksum)fail(`migration checksum mismatch ${e.file}`);else pass(`migration ${e.file} checksum verified`)}
  for(const l of ledger){if(!expected.some(e=>e.version===String(l.version)))fail(`unexpected migration version ${l.version}`)}
  const declared=new Set(); for(const e of expected){for(const m of e.sql.matchAll(/CREATE TABLE (?:IF NOT EXISTS )?"?([A-Za-z_][\w]*)"?/gi))declared.add(m[1])}
  const tables=new Set((await pool.query(`SELECT tablename FROM pg_tables WHERE schemaname='public'`)).rows.map(x=>x.tablename));
  for(const t of declared){if(!tables.has(t))fail(`declared table missing ${t}`)}
  if([...declared].every(t=>tables.has(t)))pass(`declared schema tables present count=${declared.size}`);
  const rls=(await pool.query(`SELECT c.relname,c.relrowsecurity,c.relforcerowsecurity,(SELECT count(*)::int FROM pg_policy p WHERE p.polrelid=c.oid) policies FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r' AND EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid=c.oid AND NOT a.attisdropped AND a.attname IN ('tenant_id','tenantId')) ORDER BY c.relname`)).rows;
  if(!rls.length)fail('no tenant-scoped tables discovered');
  for(const r of rls){if(!r.relrowsecurity||!r.relforcerowsecurity||Number(r.policies)<1)fail(`RLS incomplete table=${r.relname} enabled=${r.relrowsecurity} force=${r.relforcerowsecurity} policies=${r.policies}`)}
  if(rls.length&&!rls.some(r=>!r.relrowsecurity||!r.relforcerowsecurity||Number(r.policies)<1))pass(`RLS+FORCE+policy verified tables=${rls.length}`);
 } catch(e){console.error('POSTGRES_VERIFIER_EXCEPTION',e&&e.message?e.message:String(e));bad++}
 finally{await pool.end().catch(()=>{})}
 console.log(`POSTGRES_QUALIFICATION_FAILURES=${bad}`);process.exit(bad?1:0);
})();
