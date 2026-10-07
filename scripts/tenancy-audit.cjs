/** Item 1: every query touching a tenant-scoped table must go through the contract. */
const fs=require('fs'),path=require('path');
const ROOT=path.join(__dirname,'..');
const TENANT_TABLES=new Set(['User','Tenant','GovernanceEntity','GraphEdge','AgentOutput','AuditLog',
 'MemoryEntry','GovernancePolicy','PolicyEvaluation','ApprovalRequest','SoDViolation','GovernanceDecision',
 'FrameworkAssessment','MaturityScore','RACIEntry','CultureSignal','ImmutableDecision','EvidenceRecord',
 'Attestation','TenantConfig','TenantViolation','governance_events','governance_snapshots',
 'evidence_records','audit_trail']);
const SKIP=new Set(['node_modules','dist','.git','tests','scripts','prisma']);
const files=[];
(function w(d){for(const e of fs.readdirSync(d,{withFileTypes:true})){
 if(SKIP.has(e.name))continue;const p=path.join(d,e.name);
 if(e.isDirectory())w(p);else if(/\.ts$/.test(e.name))files.push(p);}})(ROOT);

const findings=[];
for(const f of files){
  const rel=path.relative(ROOT,f);
  const lines=fs.readFileSync(f,'utf8').split('\n');
  lines.forEach((line,i)=>{
    // any direct query call
    if(!/\b(pool|client|getPool\(\))\s*\.\s*(query|connect)\s*\(|(^|[^.\w])query(One)?\s*\(|queryCount\s*\(/.test(line))return;
    const m=line.match(/\b(?:FROM|INTO|UPDATE|JOIN)\s+"?([A-Za-z_][\w]*)"?/);
    // multiline: look ahead a few lines for the table
    let table=m?m[1]:null;
    if(!table){for(let k=i;k<Math.min(i+6,lines.length);k++){
      const mm=lines[k].match(/\b(?:FROM|INTO|UPDATE|JOIN)\s+"?([A-Za-z_][\w]*)"?/);
      if(mm){table=mm[1];break;}}}
    if(!table||!TENANT_TABLES.has(table))return;
    // is it inside a guarded path?
    const ctx=lines.slice(Math.max(0,i-25),i+3).join('\n');
    const whole=lines.join('\n');
    // A file is guarded when it either (a) wraps queries in an explicit tenant
    // transaction, or (b) routes through db.service query()/queryOne(), which
    // enforce the contract at RUNTIME: a tenant-table query with no bound scope
    // throws TENANT_CONTEXT_REQUIRED. Raw pool/client queries outside a wrapper
    // bypass that contract and are the real violations.
    const wrapperFile=/withRLS\s*\([\s\S]{0,400}set_config\('app\.tenant_id'/.test(whole);
    const viaContract=/from ["'].*db\.service["']/.test(whole) &&
                      !/\b(pool|client|getPool\(\))\s*\.\s*(query|connect)\s*\(/.test(line);
    const explicit=/withTenant\s*\(|withRLS\s*\(|set_config\('app\.tenant_id'|tx\.(query|queryOne)/.test(ctx);
    const guarded= explicit || wrapperFile || viaContract;
    findings.push({file:rel,line:i+1,table,guarded,snippet:line.trim().slice(0,72)});
  });
}
const unguarded=findings.filter(f=>!f.guarded);
console.log('DAO/SERVICE            TABLE                 GUARDED  FILE:LINE');
console.log('-'.repeat(92));
for(const f of findings){
  console.log(`${path.basename(f.file).padEnd(22)} ${f.table.padEnd(21)} ${(f.guarded?'yes':'NO ').padEnd(8)} ${f.file}:${f.line}`);
}
console.log(`\ntotal tenant-table queries: ${findings.length}  guarded: ${findings.length-unguarded.length}  UNGUARDED: ${unguarded.length}`);
fs.writeFileSync('/tmp/tenancy_audit.json',JSON.stringify({findings,unguarded},null,2));
process.exit(unguarded.length===0?0:1);
