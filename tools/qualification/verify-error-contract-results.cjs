#!/usr/bin/env node
const fs=require('fs');
const p=process.argv[2];
if(!p||!fs.existsSync(p)){console.error('RESULTS_JSON_MISSING');process.exit(2)}
let j;try{j=JSON.parse(fs.readFileSync(p,'utf8'))}catch(e){console.error('RESULTS_JSON_INVALID');process.exit(2)}
const f=j.flags||{};
const exact={
  RAW_ERROR_RESPONSE_EXPOSURES:0,
  PUBLIC_ENDPOINT_RAW_ERROR_LEAKS:0,
  KNOWN_ERROR_STATUS_MISMATCHES:0,
  CASE_EXPECTATION_MISMATCHES:0,
  UNKNOWN_ERRORS_SANITIZED:'PASS',
  CORRELATION_TRACEABILITY:'PASS',
  INTERNAL_DIAGNOSTICS_PRESERVED:'PASS',
  FAULT_INJECTION_VERIFIED:'PASS',
  LOG_SECRET_REDACTION:'PASS',
  ENTITY_TYPE_VALIDATION:'PASS',
  ENV_MATRIX:'PASS',
  NO_TEST_SEAM_IN_PRODUCT:'PASS',
  STATIC_GUARD_SECONDARY:'PASS',
  REGRESSION:'PASS',
  RUNTIME_PROOF:'PASS',
  ERROR_CONTRACT_CLOSED:'TRUE',
};
let bad=0;
for(const [k,v] of Object.entries(exact)){
  const a=f[k]; const ok=(typeof v==='number')?Number(a)===v:String(a).toUpperCase()===v;
  console.log(`${ok?'PASS':'FAIL'} ${k} expected=${v} actual=${a===undefined?'MISSING':a}`); if(!ok)bad++;
}
if(Number(f.FAILING_RECORDS??0)!==0){console.log(`FAIL FAILING_RECORDS expected=0 actual=${f.FAILING_RECORDS}`);bad++;}
else console.log('PASS FAILING_RECORDS expected=0 actual=0');
const meta=j.meta||{};
if(process.env.SGIP_EXPECTED_GIT_COMMIT){
  const ok=String(meta.commit||'')===process.env.SGIP_EXPECTED_GIT_COMMIT;
  console.log(`${ok?'PASS':'FAIL'} META_COMMIT expected=${process.env.SGIP_EXPECTED_GIT_COMMIT} actual=${meta.commit??'MISSING'}`);if(!ok)bad++;
}
console.log(`RESULTS_ACCEPTANCE_FAILURES=${bad}`);
process.exit(bad?1:0);
