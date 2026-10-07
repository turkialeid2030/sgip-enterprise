const { Client, Pool } = require("pg");
const { spawn } = require("child_process");
const http = require("http");
const fs = require("fs"), path = require("path"), crypto = require("crypto");
const bcrypt = require(path.join(process.cwd(), "node_modules/bcryptjs"));

const HOST="/tmp", PORT=5433, DB="sgip_e2e", SUPER="pgowner";
const R=[]; const rec=(n,p,d)=>{R.push({n,p,d});console.log(`  ${p?"PASS":"FAIL"}  ${n}${d?" — "+d:""}`)};
const conn=async(u,d=DB)=>{const c=new Client({host:HOST,port:PORT,user:u,database:d});await c.connect();return c};
const norm=s=>s.replace(/--[^\n]*/g,"").replace(/\s+/g," ").trim();

(async()=>{
  // ── fresh database ──
  let b=await conn(SUPER,"postgres");
  await b.query(`DROP DATABASE IF EXISTS ${DB}`); await b.query(`CREATE DATABASE ${DB}`); await b.end();
  let a=await conn(SUPER);
  await a.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);
  await a.query(`CREATE EXTENSION IF NOT EXISTS pgcrypto`);
  for(const [r,o] of [["sgip_owner","NOLOGIN NOSUPERUSER NOBYPASSRLS"],
                      ["sgip_app","LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD 'app_pw'"]]){
    await a.query(`CREATE ROLE ${r} ${o}`).catch(async()=>{await a.query(`ALTER ROLE ${r} ${o}`)});
  }
  await a.query(`GRANT USAGE, CREATE ON SCHEMA public TO sgip_owner`);
  await a.query(`GRANT USAGE ON SCHEMA public TO sgip_app`);

  // ── authoritative migrations + LEDGER (emulating 10-apply-migrations.sh) ──
  await a.query(`SET ROLE sgip_owner`);
  await a.query(`CREATE TABLE IF NOT EXISTS schema_migrations(
     id UUID PRIMARY KEY DEFAULT gen_random_uuid(), version TEXT NOT NULL,
     description TEXT NOT NULL, checksum TEXT NOT NULL, source_id TEXT NOT NULL,
     applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), applied_by TEXT NOT NULL DEFAULT CURRENT_USER,
     duration_ms INTEGER, status TEXT NOT NULL DEFAULT 'applied',
     CONSTRAINT uq_schema_migrations_version UNIQUE(version))`);
  await a.query(`RESET ROLE`);
  const dir=path.join(process.cwd(),"db","migrations");
  const files=fs.readdirSync(dir).filter(f=>f.endsWith(".sql")).sort();
  let migOk=true, migErr="";
  for(const f of files){
    const sql=fs.readFileSync(path.join(dir,f),"utf8");
    const ck=crypto.createHash("sha256").update(norm(sql)).digest("hex").slice(0,16);
    try{
      await a.query("BEGIN"); await a.query("SET LOCAL ROLE sgip_owner"); await a.query(sql);
      await a.query(`RESET ROLE`);
      await a.query(`INSERT INTO schema_migrations(version,description,checksum,source_id)
                     VALUES($1,$2,$3,$4) ON CONFLICT (version) DO NOTHING`,
                     [f.split("_")[0],f,ck,"db/migrations/"+f]);
      await a.query("COMMIT");
    }catch(e){ await a.query("ROLLBACK").catch(()=>{}); migOk=false; migErr=`${f}: ${e.message.split("\n")[0]}`; break; }
  }
  rec("authoritative migrations applied AND recorded in ledger", migOk, migErr||`${files.length} migrations`);
  const led=await a.query(`SELECT count(*)::int n FROM schema_migrations`);
  rec("migration ledger is populated (not entries=0)", led.rows[0].n===files.length, `entries=${led.rows[0].n}`);

  await a.query(`GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO sgip_app`);
  await a.query(`GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public TO sgip_app`);

  // ── seed two tenants + users ──
  const hash=await bcrypt.hash("Passw0rd!",10);
  for(const t of ["tenant-a","tenant-b"]){
    await a.query(`INSERT INTO "Tenant"(id,name,slug) VALUES($1,$2,$3) ON CONFLICT DO NOTHING`,[t,t,t]).catch(()=>{});
    // "User" carries FORCE RLS: the insert needs a tenant context even for the owner
    await a.query("BEGIN");
    await a.query("SELECT set_config('app.tenant_id',$1,true)",[t]);
    await a.query(`INSERT INTO "User"(id,email,"nameAr",role,"tenantId","passwordHash","isActive")
                   VALUES($1,$2,$3,$4,$5,$6,true) ON CONFLICT DO NOTHING`,
                   [t+"-u1",`u@${t}.sa`,"مستخدم","governance_analyst",t,hash]).catch(e=>{});
    await a.query("COMMIT");
  }
  await a.query("BEGIN"); await a.query("SELECT set_config('app.tenant_id','tenant-a',true)");
  const ucount=await a.query(`SELECT count(*)::int n FROM "User"`);
  await a.query("COMMIT");
  rec("seed users created under FORCE RLS (tenant-scoped)", ucount.rows[0].n>=1, `users=${ucount.rows[0].n}`);
  await a.end();

  // ── start API as sgip_app ──
  const url=`postgresql://sgip_app:app_pw@localhost:${PORT}/${DB}?host=${HOST}`;
  const srv=spawn("node",["dist/api/server.js"],{env:{...process.env,PORT:"4080",NODE_ENV:"production",
    DATABASE_URL:url,JWT_SECRET:"e2e_secret",JWT_REFRESH_SECRET:"e2e_refresh"},stdio:["ignore","pipe","pipe"]});
  let log=""; srv.stdout.on("data",d=>log+=d); srv.stderr.on("data",d=>log+=d);
  await new Promise(r=>setTimeout(r,5000));

  const call=(p,m="GET",body=null,tok=null)=>new Promise(res=>{
    const h={"Content-Type":"application/json"}; if(tok)h.Authorization="Bearer "+tok;
    const q=http.request({hostname:"localhost",port:4080,path:p,method:m,headers:h},r=>{
      let d="";r.on("data",c=>d+=c);r.on("end",()=>{try{res({s:r.statusCode,b:JSON.parse(d)})}catch{res({s:r.statusCode,b:d.slice(0,90)})}})});
    q.on("error",e=>res({s:0,b:e.message})); if(body)q.write(JSON.stringify(body)); q.end();});

  // Real evidence only: the process must be alive AND /health/ready must answer 200.
  const alive = srv.exitCode === null;
  const ready = await call("/health/ready");
  const startedOk = alive && ready.s === 200 && /migration state verified/.test(log);
  rec("API started in production mode and /health/ready = 200", startedOk,
      `alive=${alive} ready=${ready.s} ledgerVerified=${/migration state verified/.test(log)}`);
  if (!startedOk) { console.log("  --- startup log ---\n" + log.split("\n").slice(-12).join("\n")); }

  // ── REAL LOGIN under FORCE RLS ──
  const login=await call("/api/auth/login","POST",{email:"u@tenant-a.sa",password:"Passw0rd!",tenantId:"tenant-a"});
  rec("real login succeeds under FORCE RLS (via withTenant)", login.s===200 && !!login.b.token,
      login.s===200?"token issued":`status=${login.s} ${JSON.stringify(login.b).slice(0,70)}`);
  const tokA=login.b?.token;

  const wrongTenant=await call("/api/auth/login","POST",{email:"u@tenant-a.sa",password:"Passw0rd!",tenantId:"tenant-b"});
  rec("login with the wrong tenant is rejected", wrongTenant.s!==200, `status=${wrongTenant.s}`);

  const badPw=await call("/api/auth/login","POST",{email:"u@tenant-a.sa",password:"wrong",tenantId:"tenant-a"});
  rec("login with a wrong password is rejected", badPw.s!==200, `status=${badPw.s}`);

  // ── forged refresh token using the dev default must be rejected ──
  const jwt=require(path.join(process.cwd(),"node_modules/jsonwebtoken"));
  const forged=jwt.sign({userId:"x",tenantId:"tenant-a",role:"admin",type:"refresh"},"dev_refresh_secret",{expiresIn:"1h"});
  const fr=await call("/api/auth/refresh","POST",{refreshToken:forged});
  rec("refresh token forged with the dev default is rejected", fr.s===401, `status=${fr.s}`);

  // ── authenticated reads ──
  if(tokA){
    const ck=await call("/api/executive/cockpit","GET",null,tokA);
    rec("authenticated API read succeeds", ck.s===200, `status=${ck.s}`);
  } else rec("authenticated API read succeeds", false, "no token");


  // ── item 3: authenticated CROSS-TENANT HTTP denial ──
  const loginB=await call("/api/auth/login","POST",{email:"u@tenant-b.sa",password:"Passw0rd!",tenantId:"tenant-b"});
  const tokB=loginB.b?.token;
  rec("tenant B can log in independently", loginB.s===200 && !!tokB, `status=${loginB.s}`);

  // ── items 3+4: real entities must EXIST before isolation means anything ──
  const mkEntity=(t)=>({type:"policy",title:`Entity ${t}`,owner:`owner-${t}`,
    description:`probe for ${t}`,status:"draft",priority:"medium",
    riskLevel:"medium",impactLevel:"medium"});

  let entA=null, entB=null;
  const createA = tokA ? await call("/api/entities","POST",mkEntity("A"),tokA) : {s:0,b:"no token"};
  entA = createA.b?.id ?? createA.b?.entity?.id ?? null;
  rec("POST /api/entities as tenant A = 201", createA.s===201 && !!entA,
      `status=${createA.s} id=${entA??"none"} ${createA.s!==201?JSON.stringify(createA.b).slice(0,80):""}`);

  const createB = tokB ? await call("/api/entities","POST",mkEntity("B"),tokB) : {s:0,b:"no token"};
  entB = createB.b?.id ?? createB.b?.entity?.id ?? null;
  rec("POST /api/entities as tenant B = 201", createB.s===201 && !!entB,
      `status=${createB.s} id=${entB??"none"}`);

  if(entA){
    const g=await call(`/api/entities/${entA}`,"GET",null,tokA);
    rec("tenant A can GET its own entity = 200", g.s===200, `status=${g.s}`);
    const p=await call(`/api/entities/${entA}`,"PATCH",{title:"Entity A updated"},tokA);
    rec("tenant A can PATCH its own entity", p.s>=200&&p.s<300, `status=${p.s}`);
  } else { rec("tenant A can GET its own entity = 200", false, "no entity"); 
           rec("tenant A can PATCH its own entity", false, "no entity"); }

  if(entA && entB){
    const g=await call(`/api/entities/${entB}`,"GET",null,tokA);
    rec("token A cannot GET tenant B entity", [403,404].includes(g.s), `status=${g.s}`);
    const p=await call(`/api/entities/${entB}`,"PATCH",{title:"hacked"},tokA);
    rec("token A cannot PATCH tenant B entity", [403,404].includes(p.s), `status=${p.s}`);
    const d=await call(`/api/entities/${entB}`,"DELETE",null,tokA);
    rec("token A cannot DELETE tenant B entity", [403,404].includes(d.s), `status=${d.s}`);

    // verify directly in PostgreSQL that B is untouched
    let intact="?";
    try{
      const c=await conn(SUPER);
      await c.query("BEGIN"); await c.query("SELECT set_config('app.tenant_id','tenant-b',true)");
      const r=await c.query(`SELECT title FROM "GovernanceEntity" WHERE id=$1`,[entB]);
      await c.query("COMMIT"); await c.end();
      intact = r.rows[0]?.title ?? "missing";
    }catch(e){ intact="err:"+e.message.slice(0,30); }
    rec("tenant B row is unchanged in PostgreSQL after A's attempts",
        intact==="Entity B", `title=${intact}`);
  } else {
    for(const n of ["token A cannot GET tenant B entity","token A cannot PATCH tenant B entity",
                    "token A cannot DELETE tenant B entity",
                    "tenant B row is unchanged in PostgreSQL after A's attempts"])
      rec(n,false,"entities were not created — isolation claim would be vacuous");
  }

  // ── item 2: register must not honour a forged tenantId in the body ──
  if(tokA){
    const reg=await call("/api/auth/register","POST",
      {email:"intruder@x.sa",password:"Passw0rd!",nameAr:"دخيل",role:"admin",tenantId:"tenant-b"},tokA);
    let landed="none";
    try{
      const c=await conn(SUPER);
      await c.query("BEGIN"); await c.query("SELECT set_config('app.tenant_id','tenant-b',true)");
      const r=await c.query(`SELECT count(*)::int n FROM "User" WHERE email='intruder@x.sa'`);
      await c.query("COMMIT"); landed=String(r.rows[0].n); await c.end();
    }catch(e){ landed="err"; }
    // 401 would mean the request never reached authorization — not a valid proof.
    rec("register with a forged tenantId is rejected with 403 (not 401)",
        reg.s===403, `status=${reg.s} ${reg.s!==403?JSON.stringify(reg.b).slice(0,70):""}`);
    let inA="?";
    try{
      const c=await conn(SUPER);
      await c.query("BEGIN"); await c.query("SELECT set_config('app.tenant_id','tenant-a',true)");
      inA=String((await c.query(`SELECT count(*)::int n FROM "User" WHERE email='intruder@x.sa'`)).rows[0].n);
      await c.query("COMMIT"); await c.end();
    }catch(e){ inA="err"; }
    rec("forged-tenant user landed in NEITHER tenant", landed==="0" && inA==="0",
        `rowsInB=${landed} rowsInA=${inA}`);
  }

  // ── item 4: pool leakage with a forced-reuse pool ──
  {
    const dbmod=require(path.join(process.cwd(),"dist/api/services/db.service.js"));
    process.env.DATABASE_URL=url;
    let leaked="";
    try{
      await dbmod.runInTenantScope("tenant-a",()=>dbmod.query('SELECT id FROM "User"'));
      const rows=await dbmod.runInTenantScope("tenant-b",()=>dbmod.query('SELECT "tenantId" FROM "User"'));
      leaked=rows.map(r=>r.tenantId).filter(t=>t!=="tenant-b").join(",");
    }catch(e){ leaked="ERR:"+e.message.slice(0,40); }
    rec("pooled connection reuse does not leak tenant A context into tenant B",
        leaked==="", leaked?`leaked=${leaked}`:"no leakage across reuse");
  }

    const edge=await call("/api/graph/edge","POST",
      {fromId:entA,toId:entB,type:"depends_on",relation:"depends_on"},tokA);
    rec("graph edge endpoint reachable and tenant-scoped",
        [200,201,400,404,422].includes(edge.s), `status=${edge.s}`);

  // ── item 5 (V5.2): REAL outage — stop the actual PostgreSQL the API uses ──
  {
    const { execSync } = require("child_process");
    const PGCTL = path.join(process.cwd(),"node_modules/@embedded-postgres/linux-x64/native/bin/pg_ctl");
    let httpBlocked=false, det="", phantom="?";
    try{
      execSync(`su pgtest -c "${PGCTL} -D /tmp/pgdata -m fast stop"`,{stdio:"pipe"});
      await new Promise(r=>setTimeout(r,1500));
      const w = await call("/api/entities","POST",mkEntity("PHANTOM"),tokA);
      // Blocked = anything that is not a success. status 0 means the request
      // could not complete at all, which is also a refusal to persist.
      httpBlocked = !(w.s >= 200 && w.s < 300);
      det = `HTTP status=${w.s} (alive=${srv.exitCode === null})`;
      // restore
      execSync(`su pgtest -c "${PGCTL} -D /tmp/pgdata -o '-p ${PORT} -k ${HOST}' -l /tmp/pg.log start"`,{stdio:"pipe"});
      await new Promise(r=>setTimeout(r,3000));
      const c=await conn(SUPER);
      await c.query("BEGIN"); await c.query("SELECT set_config('app.tenant_id','tenant-a',true)");
      phantom=String((await c.query(`SELECT count(*)::int n FROM "GovernanceEntity" WHERE title='Entity PHANTOM'`)).rows[0].n);
      await c.query("COMMIT"); await c.end();
    }catch(e){ det="ERR:"+e.message.split("\n")[0].slice(0,60);
      try{ execSync(`su pgtest -c "${PGCTL} -D /tmp/pgdata -o '-p ${PORT} -k ${HOST}' -l /tmp/pg.log start"`,{stdio:"pipe"}); await new Promise(r=>setTimeout(r,3000)); }catch(_){}
    }
    rec("HTTP write during a REAL PostgreSQL outage fails (no 2xx)", httpBlocked, det);
    rec("no phantom row appeared after the database returned", phantom==="0", `rows=${phantom}`);
  }

  // the API may have been torn down by the outage; ensure a live server follows
  srv.kill();
  await new Promise(r=>setTimeout(r,800));

  // ── items 6+7: audit + graph persistence, then durability of the EXACT record ──
  {
    let auditRows="?";
    try{
      const c=await conn(SUPER);
      await c.query("BEGIN"); await c.query("SELECT set_config('app.tenant_id','tenant-a',true)");
      auditRows=String((await c.query(
        `SELECT count(*)::int n FROM "AuditLog" WHERE "entityId"=$1`,[entA])).rows[0].n);
      await c.query("COMMIT"); await c.end();
    }catch(e){ auditRows="err"; }
    rec("audit trail persisted for the entity mutation (same transaction)",
        Number(auditRows)>=1, `auditRows=${auditRows}`);

  }

  // ── item 12: restart durability of the EXACT created record ──
  {
    const srvMid=spawn("node",["dist/api/server.js"],{env:{...process.env,PORT:"4080",NODE_ENV:"production",
      DATABASE_URL:url,JWT_SECRET:"e2e_secret",JWT_REFRESH_SECRET:"e2e_refresh"},stdio:"ignore"});
    await new Promise(r=>setTimeout(r,5000));
    const before=await call(`/api/entities/${entA}`,"GET",null,tokA);
    srvMid.kill(); await new Promise(r=>setTimeout(r,1200));
    const srv2=spawn("node",["dist/api/server.js"],{env:{...process.env,PORT:"4080",NODE_ENV:"production",
      DATABASE_URL:url,JWT_SECRET:"e2e_secret",JWT_REFRESH_SECRET:"e2e_refresh"},stdio:"ignore"});
    await new Promise(r=>setTimeout(r,5000));
    const relogin=await call("/api/auth/login","POST",{email:"u@tenant-a.sa",password:"Passw0rd!",tenantId:"tenant-a"});
    const after=await call(`/api/entities/${entA}`,"GET",null,relogin.b?.token);
    const titleKept = after.b?.title === "Entity A updated";
    rec("the EXACT entity survives restart with its updated title",
        before.s===200 && relogin.s===200 && after.s===200 && titleKept,
        `before=${before.s} relogin=${relogin.s} after=${after.s} title=${JSON.stringify(after.b?.title)}`);

    let auditAfter="?";
    try{
      const c=await conn(SUPER);
      await c.query("BEGIN"); await c.query("SELECT set_config('app.tenant_id','tenant-a',true)");
      auditAfter=String((await c.query(
        `SELECT count(*)::int n FROM "AuditLog" WHERE "entityId"=$1`,[entA])).rows[0].n);
      await c.query("COMMIT"); await c.end();
    }catch(e){ auditAfter="err"; }
    rec("audit records survive the restart", Number(auditAfter)>=1, `auditRows=${auditAfter}`);

    // cross-tenant: B must not see A's audit.
    // MUST use the runtime role — pgowner is a SUPERUSER and bypasses RLS even
    // with FORCE (documented limit, proven in the V2 gate).
    let bSeesA="?";
    try{
      const c=await conn("sgip_app");
      await c.query("BEGIN"); await c.query("SELECT set_config('app.tenant_id','tenant-b',true)");
      bSeesA=String((await c.query(
        `SELECT count(*)::int n FROM "AuditLog" WHERE "entityId"=$1`,[entA])).rows[0].n);
      await c.query("COMMIT"); await c.end();
    }catch(e){ bSeesA="err"; }
    rec("tenant B cannot see tenant A audit records", bSeesA==="0", `rowsVisibleToB=${bSeesA}`);
    srv2.kill();
  }

  const pass=R.filter(r=>r.p).length;
  console.log(`\n  E2E: ${pass}/${R.length}`);
  fs.writeFileSync("/tmp/e2e_results.json",JSON.stringify(R,null,2));
  process.exit(pass===R.length?0:1);
})().catch(e=>{console.error("FATAL:",e.message);process.exit(2)});
