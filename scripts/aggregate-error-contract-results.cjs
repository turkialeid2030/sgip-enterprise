#!/usr/bin/env node
"use strict";
const fs=require("fs"),path=require("path"),{spawnSync}=require("child_process");
const root=path.resolve(__dirname,".."),dir=path.join(root,"qualification-evidence"),modes=["development","production","db-down"];
const runs=modes.map(mode=>{const p=path.join(dir,"error-contract-"+mode+".json");if(!fs.existsSync(p))return{mode,fatal:true,records:[]};return JSON.parse(fs.readFileSync(p,"utf8"))});
const records=runs.flatMap(r=>r.records||[]),failing=records.filter(r=>!r.pass),exposed=records.filter(r=>r.leaks&&Object.values(r.leaks).some(Boolean)),publicExposed=exposed.filter(r=>r.public),known=records.filter(r=>r.kind==="known"),cases=records.filter(r=>r.kind==="case"),unknown=records.filter(r=>r.unknown),errors=records.filter(r=>r.http&&Number(r.status)>=400),faults=records.filter(r=>r.fault&&r.fault.expected);
const staticRun=spawnSync(process.execPath,["scripts/verify-error-contract-static.cjs"],{cwd:root,encoding:"utf8"});fs.writeFileSync(path.join(dir,"error-contract-static.log"),(staticRun.stdout||"")+(staticRun.stderr||""));const staticPass=staticRun.status===0;
const knownMismatch=known.filter(r=>(r.expectedStatus!==undefined&&r.status!==r.expectedStatus)||(r.expectedCode&&r.code!==r.expectedCode)).length;
const caseMismatch=cases.filter(r=>(r.expectedStatus!==undefined&&r.status!==r.expectedStatus)||(r.expectedCode&&r.code!==r.expectedCode)||r.rollbackVerified===false).length;
const dev=new Map((runs.find(r=>r.mode==="development")?.records||[]).filter(r=>r.http).map(r=>[r.id,r])),prod=new Map((runs.find(r=>r.mode==="production")?.records||[]).filter(r=>r.http).map(r=>[r.id,r]));
const matrixIds=["AUTH-FAIL-NONE","AUTH-FAIL-BADTOKEN","AUTH-FORBIDDEN","ENT-READ-404","ENT-WRITE-BADTYPE","APPROVAL-CONCURRENT-409","AI-SERVICE-UNAVAILABLE","UNKNOWN-GLOBAL"];
const envMatrix=matrixIds.every(id=>{const a=dev.get(id),b=prod.get(id);return a&&b&&a.status===b.status&&String(a.code||"")===String(b.code||"")&&!Object.values(a.leaks||{}).some(Boolean)&&!Object.values(b.leaks||{}).some(Boolean)});
const flags={
 RAW_ERROR_RESPONSE_EXPOSURES:exposed.length,
 PUBLIC_ENDPOINT_RAW_ERROR_LEAKS:publicExposed.length,
 KNOWN_ERROR_STATUS_MISMATCHES:knownMismatch,
 CASE_EXPECTATION_MISMATCHES:caseMismatch,
 UNKNOWN_ERRORS_SANITIZED:unknown.length>0&&unknown.every(r=>r.sanitized&&r.pass)?"PASS":"FAIL",
 CORRELATION_TRACEABILITY:errors.every(r=>r.correlation&&r.correlation.pass)?"PASS":"FAIL",
 INTERNAL_DIAGNOSTICS_PRESERVED:faults.length>=10&&faults.every(r=>r.internal&&r.internal.pass)?"PASS":"FAIL",
 FAULT_INJECTION_VERIFIED:faults.length>=10&&faults.every(r=>r.fault.fired)?"PASS":"FAIL",
 LOG_SECRET_REDACTION:records.some(r=>r.id==="SECRET-REDACTION"&&r.pass)?"PASS":"FAIL",
 ENTITY_TYPE_VALIDATION:records.some(r=>r.id==="ENTITY-TYPE-VALIDATION"&&r.pass)?"PASS":"FAIL",
 ENV_MATRIX:envMatrix?"PASS":"FAIL",
 NO_TEST_SEAM_IN_PRODUCT:staticPass?"PASS":"FAIL",
 STATIC_GUARD_SECONDARY:staticPass?"PASS":"FAIL",
 REGRESSION:failing.length===0?"PASS":"FAIL",
 DB_DOWN_INSTANCE:records.some(r=>r.id==="PUBLIC-LOGIN-FAULT"&&r.pass)&&records.some(r=>r.id==="DASH-FAULT-CONN"&&r.pass)?"PASS":"FAIL",
 FAILING_RECORDS:failing.length,
 RUNTIME_PROOF:runs.every(r=>!r.fatal)&&records.some(r=>r.id==="CROSS-TENANT-ROUTE"&&r.pass)&&records.some(r=>r.id==="CROSS-TENANT-RLS"&&r.pass)&&faults.length>=10?"PASS":"FAIL",
 ERROR_CONTRACT_CLOSED:"FALSE"
};
const zeroFlags=new Set(["RAW_ERROR_RESPONSE_EXPOSURES","PUBLIC_ENDPOINT_RAW_ERROR_LEAKS","KNOWN_ERROR_STATUS_MISMATCHES","CASE_EXPECTATION_MISMATCHES"]);\nconst all=Object.entries(flags).every(([k,v])=>{if(["ERROR_CONTRACT_CLOSED","DB_DOWN_INSTANCE","FAILING_RECORDS"].includes(k))return true;if(zeroFlags.has(k))return Number(v)===0;return String(v).toUpperCase()==="PASS"})&&flags.DB_DOWN_INSTANCE==="PASS"&&flags.FAILING_RECORDS===0;
flags.ERROR_CONTRACT_CLOSED=all?"TRUE":"FALSE";
const result={meta:{runId:"v4-"+Date.now(),started:new Date().toISOString(),finished:new Date().toISOString(),commit:process.env.SGIP_EXPECTED_GIT_COMMIT||process.env.GITHUB_SHA||"n/a",node:process.version,mode:"sgip-v4-canonical-reconstructed",target:"SGIP Enterprise",harnessBasis:"historical runtime 20260927065050-D3A3 + closure matrix; reconstructed executable replacement"},flags,envRuns:runs};
fs.writeFileSync(path.join(root,"sgip_run_results.json"),JSON.stringify(result,null,2));
const report=["# SGIP Error Contract Final Execution Report","", "Commit: "+result.meta.commit,"Harness: "+result.meta.harnessBasis,"","## Flags",...Object.entries(flags).map(([k,v])=>"- "+k+" = "+v),"","## Runtime records","- total = "+records.length,"- passed = "+(records.length-failing.length),"- failed = "+failing.length,"",...(failing.length?["## Failing records",...failing.map(r=>"- "+r.env+"/"+r.id+": "+(r.reasons||[]).join(", "))]:["## Failing records","None"]),""] .join("\n");
fs.writeFileSync(path.join(root,"ERROR_CONTRACT_FINAL_EXECUTION_REPORT_SGIP.md"),report);console.log(report);process.exit(flags.ERROR_CONTRACT_CLOSED==="TRUE"?0:1);
