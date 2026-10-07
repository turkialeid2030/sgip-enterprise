#!/usr/bin/env node
"use strict";
require("ts-node/register/transpile-only");
const fs=require("fs"),path=require("path"),request=require("supertest"),jwt=require("jsonwebtoken"),bcrypt=require("bcryptjs"),express=require("express"),{Pool}=require("pg");
const mode=process.argv[2]||"development",root=path.resolve(__dirname,".."),outDir=path.join(root,"qualification-evidence");
fs.mkdirSync(outDir,{recursive:true});
process.env.NODE_ENV=mode==="db-down"?"production":mode;
process.env.JWT_SECRET=process.env.JWT_SECRET||"ci_jwt_secret_ChangeMe_0123456789";
process.env.JWT_REFRESH_SECRET=process.env.JWT_REFRESH_SECRET||"ci_refresh_secret_ChangeMe_0123456789";
delete process.env.ANTHROPIC_API_KEY;
if(mode==="db-down")process.env.DATABASE_URL=process.env.SGIP_E2E_BAD_DATABASE_URL||"postgresql://sgip_app:ci_app_only_ChangeMe123@127.0.0.1:59999/sgip_enterprise";

const records=[],logs=[],origErr=console.error;
console.error=(...a)=>{logs.push(a.map(x=>typeof x==="string"?x:JSON.stringify(x)).join(" "));origErr(...a)};
const {app}=require("../api/server.ts"),{disconnectDB}=require("../api/services/db.service.ts");
const {correlationMiddleware}=require("../api/middleware/correlation.middleware.ts"),{errorMiddleware}=require("../api/middleware/error.middleware.ts");
const safe=/^[A-Za-z0-9._:-]{8,128}$/;
function leaks(res){const s=JSON.stringify(res.body||{})+" "+JSON.stringify(res.headers||{});return{raw:/relation\s+["'][^"']+["']\s+does not exist|violates .* constraint|ECONNREFUSED|\bat\s+[^ \n]+:\d+:\d+|SGIP_[A-Z0-9_]+_CANARY/i.test(s),secret:[process.env.JWT_SECRET,process.env.JWT_REFRESH_SECRET,process.env.APP_DB_PASSWORD,process.env.MIGRATOR_DB_PASSWORD].filter(Boolean).some(v=>v.length>=8&&s.includes(v))}}
function corr(res){if(res.status<400)return{pass:true};const h=String(res.headers["x-correlation-id"]||""),b=String(res.body&&res.body.correlationId||"");return{pass:!!h&&h===b&&safe.test(h),header:h,body:b}}
function add(r){r.env=mode;r.reasons=r.reasons||[];if(r.leaks&&Object.values(r.leaks).some(Boolean))r.reasons.push("RAW_RESPONSE_LEAK");if(r.http&&r.status>=400&&!r.correlation.pass)r.reasons.push("CORRELATION");if(r.expectedStatus!==undefined&&r.status!==r.expectedStatus)r.reasons.push("STATUS");if(r.expectedCode&&r.code!==r.expectedCode)r.reasons.push("CODE");if(r.rollbackVerified===false)r.reasons.push("ROLLBACK");if(r.fault&&r.fault.expected&&(!r.internal||!r.internal.pass))r.reasons.push("INTERNAL");r.pass=r.pass!==false&&r.reasons.length===0;records.push(r);return r}
async function hit(id,builder,status,code,opt={}){const before=logs.length,res=await builder(request(app)),l=leaks(res),c=corr(res),cid=String(res.headers["x-correlation-id"]||""),fresh=logs.slice(before);const internal=opt.fault?{pass:fresh.some(x=>x.includes(cid)&&x.includes(opt.route||"")&&x.includes('"stack"'))}:undefined;const sanitized=res.status<500||(!Object.values(l).some(Boolean)&&["Internal server error","Service temporarily unavailable","AI service temporarily unavailable"].includes(String(res.body&&res.body.error||"")));return add({kind:opt.kind||"case",id,http:true,public:!!opt.public,unknown:!!opt.unknown,expectedStatus:status,expectedCode:code,status:res.status,code:res.body&&res.body.code,correlation:c,leaks:l,sanitized,fault:opt.fault?{expected:true,fired:true,kind:opt.fault}:{expected:false,fired:false},internal})}
async function finish(){fs.writeFileSync(path.join(outDir,"error-contract-"+mode+".json"),JSON.stringify({mode,records},null,2));await disconnectDB().catch(()=>{});process.exit(records.every(r=>r.pass)?0:1)}

(async()=>{
if(mode==="db-down"){
 const token=jwt.sign({userId:"x",email:"x@x.test",role:"orchestrator",tenantId:"down",nameAr:"x"},process.env.JWT_SECRET,{expiresIn:"1h"});
 await hit("PUBLIC-LOGIN-FAULT",q=>q.post("/api/auth/login").send({email:"x@x.test",password:"abcdef",tenantId:"down"}),503,"DATA_UNAVAILABLE",{public:true,fault:"db-down",route:"POST /api/auth/login"});
 await hit("DASH-FAULT-CONN",q=>q.get("/api/dashboard/summary").set("Authorization","Bearer "+token),503,"DATA_UNAVAILABLE",{fault:"db-down",route:"GET /api/dashboard/summary"});
 return finish();
}
const admin=new Pool({connectionString:process.env.ADMIN_DATABASE_URL||"postgresql://sgip_bootstrap:ci_bootstrap_only@localhost:5432/sgip_enterprise",max:1});
const appPool=new Pool({connectionString:process.env.DATABASE_URL,max:1});
const s=mode==="production"?"prod":"dev",tenant="e2e-"+s+"-a",tenantB="e2e-"+s+"-b",uid="e2e-"+s+"-orch",bid="e2e-"+s+"-board",email="orch-"+s+"@sgip.test",bmail="board-"+s+"@sgip.test",entity="fixture-"+s+"-entity",other="fixture-"+s+"-other",done="approval-"+s+"-done",pending="approval-"+s+"-pending";
const hash=await bcrypt.hash("E2Epass123!",4),steps=JSON.stringify([{order:0,approver:uid,approverType:"user",required:true,slaHours:24,status:"pending"}]);
async function restore(t){const f=t+"__e2e_fault",r=await admin.query("SELECT to_regclass($1) r",['"'+f+'"']);if(r.rows[0]&&r.rows[0].r)await admin.query('ALTER TABLE "'+f+'" RENAME TO "'+t+'"')}
async function renamed(t,fn){await restore(t);const f=t+"__e2e_fault";await admin.query('ALTER TABLE "'+t+'" RENAME TO "'+f+'"');try{return await fn()}finally{await admin.query('ALTER TABLE "'+f+'" RENAME TO "'+t+'"')}}
for(const t of ["GovernanceEntity","AuditLog","GovernancePolicy","ApprovalRequest"])await restore(t);
await admin.query('INSERT INTO "Tenant"(id,name,slug) VALUES($1,$2,$3) ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name',[tenant,"E2E A "+s,tenant+"-slug"]);
await admin.query('INSERT INTO "Tenant"(id,name,slug) VALUES($1,$2,$3) ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name',[tenantB,"E2E B "+s,tenantB+"-slug"]);
await admin.query('INSERT INTO "User"(id,email,"passwordHash","nameAr",role,"tenantId") VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(id) DO UPDATE SET email=EXCLUDED.email,"passwordHash"=EXCLUDED."passwordHash",role=EXCLUDED.role,"tenantId"=EXCLUDED."tenantId"',[uid,email,hash,"E2E","orchestrator",tenant]);
await admin.query('INSERT INTO "User"(id,email,"passwordHash","nameAr",role,"tenantId") VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(id) DO UPDATE SET email=EXCLUDED.email,"passwordHash"=EXCLUDED."passwordHash",role=EXCLUDED.role,"tenantId"=EXCLUDED."tenantId"',[bid,bmail,hash,"E2E Board","board_reporter",tenant]);
await admin.query('INSERT INTO "GovernanceEntity"(id,type,title,owner,"tenantId","createdBy","updatedBy") VALUES($1,$2,$3,$4,$5,$6,$6) ON CONFLICT(id) DO UPDATE SET title=EXCLUDED.title,status=$7',[entity,"risk","Fixture "+s,"E2E",tenant,uid,"draft"]);
await admin.query('INSERT INTO "GovernanceEntity"(id,type,title,owner,"tenantId","createdBy","updatedBy") VALUES($1,$2,$3,$4,$5,$6,$6) ON CONFLICT(id) DO UPDATE SET title=EXCLUDED.title,status=$7',[other,"risk","Other "+s,"E2E",tenantB,"e2e-b","draft"]);
await admin.query('INSERT INTO "ApprovalRequest"(id,"tenantId","entityId","entityType",action,"requestedBy",steps,"currentStep",status,"slaDeadline","correlationId") VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,0,$8,NOW()+INTERVAL \'1 day\',$9) ON CONFLICT(id) DO UPDATE SET status=EXCLUDED.status,steps=EXCLUDED.steps,"currentStep"=0',[done,tenant,entity,"risk","approve",uid,steps,"approved",done+"-cid"]);
await admin.query('INSERT INTO "ApprovalRequest"(id,"tenantId","entityId","entityType",action,"requestedBy",steps,"currentStep",status,"slaDeadline","correlationId") VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,0,$8,NOW()+INTERVAL \'1 day\',$9) ON CONFLICT(id) DO UPDATE SET status=EXCLUDED.status,steps=EXCLUDED.steps,"currentStep"=0',[pending,tenant,entity,"risk","approve",uid,steps,"pending",pending+"-cid"]);
const token=jwt.sign({userId:uid,email,role:"orchestrator",tenantId:tenant,nameAr:"E2E"},process.env.JWT_SECRET,{expiresIn:"1h"}),boardToken=jwt.sign({userId:bid,email:bmail,role:"board_reporter",tenantId:tenant,nameAr:"E2E"},process.env.JWT_SECRET,{expiresIn:"1h"}),auth=q=>q.set("Authorization","Bearer "+token),board=q=>q.set("Authorization","Bearer "+boardToken);
await hit("AUTH-FAIL-NONE",q=>q.get("/api/entities"),401,"AUTHENTICATION_REQUIRED");
await hit("AUTH-FAIL-BADTOKEN",q=>q.get("/api/entities").set("Authorization","Bearer bad.token.value"),401,"AUTHENTICATION_REQUIRED");
await hit("AUTH-FORBIDDEN",q=>board(q.post("/api/entities")).send({type:"risk",title:"x",owner:"x"}),403,"ACCESS_DENIED");
await hit("ENT-READ-404",q=>auth(q.get("/api/entities/no-such-entity")),404,"RESOURCE_NOT_FOUND");
await hit("ENT-WRITE-BADTYPE",q=>auth(q.post("/api/entities")).send({type:"unknown_type_e2e",title:"x",owner:"x"}),422,"VALIDATION_ERROR");
await hit("PUBLIC-HEALTH-NO-TOKEN",q=>q.get("/api/dashboard/health"),200,undefined,{public:true});
await hit("AUTH-REGISTER-CONFLICT",q=>auth(q.post("/api/auth/register")).send({email,password:"E2Epass123!",nameAr:"dup",role:"orchestrator",tenantId:tenant}),409,"RESOURCE_CONFLICT");
await hit("APPROVAL-CONCURRENT-409",q=>auth(q.patch("/api/approvals/"+done+"/decide")).send({decision:"approved"}),409,"CONCURRENT_APPROVAL_STATE_CHANGED");
await hit("CROSS-TENANT-ROUTE",q=>auth(q.get("/api/entities/"+other)),404,"RESOURCE_NOT_FOUND");
let rr=[];const c=await appPool.connect();try{await c.query("BEGIN");await c.query("SELECT set_config('app.tenant_id',$1,true)",[tenant]);rr=(await c.query('SELECT id FROM "GovernanceEntity" WHERE id=ANY($1::text[])',[[entity,other]])).rows;await c.query("COMMIT")}catch(e){await c.query("ROLLBACK").catch(()=>{});throw e}finally{c.release()}
add({kind:"case",id:"CROSS-TENANT-RLS",http:false,status:200,expectedStatus:200,pass:rr.length===1&&rr[0].id===entity,leaks:{},correlation:{pass:true}});
const {normalizeEntityType}=require("../api/validation/entity-type.ts");
add({kind:"case",id:"ENTITY-TYPE-VALIDATION",http:false,status:200,expectedStatus:200,pass:normalizeEntityType("waqf")==="waqf"&&normalizeEntityType("charitable_assoc")==="charitable_association"&&normalizeEntityType("bad_unknown")===null,leaks:{},correlation:{pass:true}});
for(const x of [["KE-VALIDATION_ERROR","ENT-WRITE-BADTYPE",422,"VALIDATION_ERROR"],["KE-AUTHENTICATION_REQUIRED","AUTH-FAIL-NONE",401,"AUTHENTICATION_REQUIRED"],["KE-ACCESS_DENIED","AUTH-FORBIDDEN",403,"ACCESS_DENIED"],["KE-RESOURCE_NOT_FOUND","ENT-READ-404",404,"RESOURCE_NOT_FOUND"],["KE-CONCURRENT_APPROVAL_STATE_CHANGED","APPROVAL-CONCURRENT-409",409,"CONCURRENT_APPROVAL_STATE_CHANGED"],["KE-RESOURCE_CONFLICT","AUTH-REGISTER-CONFLICT",409,"RESOURCE_CONFLICT"]]){const b=records.find(r=>r.id===x[1]);add({kind:"known",id:x[0],http:false,ref:x[1],expectedStatus:x[2],expectedCode:x[3],status:b.status,code:b.code,pass:b.status===x[2]&&b.code===x[3],leaks:{},correlation:{pass:true}})}
const ag=await auth(request(app).get("/api/ai/agents")),aid=ag.body&&ag.body[0]&&ag.body[0].agentId;
const ai=await hit("AI-SERVICE-UNAVAILABLE",q=>auth(q.post("/api/ai/analyze")).send({agentId:aid,action:"analyze",context:"E2E governed AI availability check"}),503,"AI_SERVICE_UNAVAILABLE",{fault:"ai-config",route:"POST /api/ai/analyze"});
add({kind:"known",id:"KE-AI_SERVICE_UNAVAILABLE",http:false,expectedStatus:503,expectedCode:"AI_SERVICE_UNAVAILABLE",status:ai.status,code:ai.code,pass:ai.status===503&&ai.code==="AI_SERVICE_UNAVAILABLE",leaks:{},correlation:{pass:true}});
await renamed("GovernanceEntity",async()=>hit("UNKNOWN-GLOBAL",q=>auth(q.get("/api/entities/"+entity)),500,"INTERNAL_ERROR",{unknown:true,fault:"pg-relation",route:"GET /api/entities/"+entity}));
await renamed("GovernanceEntity",async()=>hit("ENT-READ-FAULT",q=>auth(q.get("/api/entities/"+entity)),500,"INTERNAL_ERROR",{fault:"pg-relation",route:"GET /api/entities/"+entity}));
const oldTitle=(await admin.query('SELECT title FROM "GovernanceEntity" WHERE id=$1',[entity])).rows[0].title;
await renamed("AuditLog",async()=>hit("ENT-WRITE-PATCH-FAULT",q=>auth(q.patch("/api/entities/"+entity)).send({title:"ROLLBACK_ME"}),500,"INTERNAL_ERROR",{fault:"audit-relation",route:"PATCH /api/entities/"+entity}));
records.find(r=>r.id==="ENT-WRITE-PATCH-FAULT").rollbackVerified=(await admin.query('SELECT title FROM "GovernanceEntity" WHERE id=$1',[entity])).rows[0].title===oldTitle;
const mark="CREATE-ROLLBACK-"+s+"-"+Date.now();
await renamed("AuditLog",async()=>hit("ENT-WRITE-CREATE-FAULT",q=>auth(q.post("/api/entities")).send({type:"risk",title:mark,owner:"x"}),500,"INTERNAL_ERROR",{fault:"audit-relation",route:"POST /api/entities"}));
records.find(r=>r.id==="ENT-WRITE-CREATE-FAULT").rollbackVerified=Number((await admin.query('SELECT count(*)::int c FROM "GovernanceEntity" WHERE title=$1',[mark])).rows[0].c)===0;
await renamed("AuditLog",async()=>hit("ENT-WRITE-DELETE-FAULT",q=>auth(q.delete("/api/entities/"+entity)),500,"INTERNAL_ERROR",{fault:"audit-relation",route:"DELETE /api/entities/"+entity}));
records.find(r=>r.id==="ENT-WRITE-DELETE-FAULT").rollbackVerified=(await admin.query('SELECT status FROM "GovernanceEntity" WHERE id=$1',[entity])).rows[0].status!=="archived";
const rel="e2e-rel-"+s+"-"+Date.now();
await renamed("AuditLog",async()=>hit("GRAPH-MUTATE-FAULT",q=>auth(q.post("/api/graph/edge")).send({fromId:entity,toId:entity,relationship:rel,weight:1}),500,"INTERNAL_ERROR",{fault:"audit-relation",route:"POST /api/graph/edge"}));
records.find(r=>r.id==="GRAPH-MUTATE-FAULT").rollbackVerified=Number((await admin.query('SELECT count(*)::int c FROM "GraphEdge" WHERE relationship=$1',[rel])).rows[0].c)===0;
const pc="E2E-"+s+"-"+Date.now();
await renamed("AuditLog",async()=>hit("POLICY-MUTATE-FAULT",q=>auth(q.post("/api/policies")).send({code:pc,title:"E2E",category:"governance",rules:[]}),500,"INTERNAL_ERROR",{fault:"audit-relation",route:"POST /api/policies"}));
records.find(r=>r.id==="POLICY-MUTATE-FAULT").rollbackVerified=Number((await admin.query('SELECT count(*)::int c FROM "GovernancePolicy" WHERE code=$1',[pc])).rows[0].c)===0;
await admin.query('UPDATE "ApprovalRequest" SET status=$2,"currentStep"=0,steps=$3::jsonb WHERE id=$1',[pending,"pending",steps]);
await renamed("AuditLog",async()=>hit("APPROVAL-DECIDE-FAULT",q=>auth(q.patch("/api/approvals/"+pending+"/decide")).send({decision:"approved"}),500,"INTERNAL_ERROR",{fault:"audit-relation",route:"PATCH /api/approvals/"+pending+"/decide"}));
records.find(r=>r.id==="APPROVAL-DECIDE-FAULT").rollbackVerified=(await admin.query('SELECT status FROM "ApprovalRequest" WHERE id=$1',[pending])).rows[0].status==="pending";
for(const r of records)if(["ENT-WRITE-PATCH-FAULT","ENT-WRITE-CREATE-FAULT","ENT-WRITE-DELETE-FAULT","GRAPH-MUTATE-FAULT","POLICY-MUTATE-FAULT","APPROVAL-DECIDE-FAULT"].includes(r.id)&&r.rollbackVerified===false){r.reasons.push("ROLLBACK");r.pass=false}
const mini=express();mini.use(correlationMiddleware);mini.get("/fault",()=>{throw new Error("password="+process.env.JWT_SECRET+" SGIP_SECRET_CANARY")});mini.use(errorMiddleware);const bi=logs.length,sr=await request(mini).get("/fault"),fresh=logs.slice(bi).join("\n"),sl=leaks(sr),sc=corr(sr);add({kind:"case",id:"SECRET-REDACTION",http:true,unknown:true,sanitized:!Object.values(sl).some(Boolean),status:sr.status,expectedStatus:500,code:sr.body&&sr.body.code,expectedCode:"INTERNAL_ERROR",leaks:sl,correlation:sc,fault:{expected:true,fired:true},internal:{pass:!fresh.includes(process.env.JWT_SECRET)&&fresh.includes("[REDACTED]")&&fresh.includes("SGIP_SECRET_CANARY")&&fresh.includes(String(sr.headers["x-correlation-id"]))&&fresh.includes('"stack"')}});
await admin.end();await appPool.end();return finish();
})().catch(async e=>{fs.writeFileSync(path.join(outDir,"error-contract-"+mode+".json"),JSON.stringify({mode,fatal:true,error:e&&e.stack||String(e),records},null,2));console.error(e);await disconnectDB().catch(()=>{});process.exit(2)});
