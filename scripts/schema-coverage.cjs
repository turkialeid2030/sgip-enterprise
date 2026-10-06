/** Extract every table the runtime actually references, from code — not lists. */
const fs=require('fs'), path=require('path');
const ROOT=path.join(__dirname,'..');
const SKIP=new Set(['node_modules','dist','.git','tests','scripts']);
const files=[];
(function walk(d){for(const e of fs.readdirSync(d,{withFileTypes:true})){
  if(SKIP.has(e.name))continue; const p=path.join(d,e.name);
  if(e.isDirectory())walk(p); else if(/\.(ts|js|cjs)$/.test(e.name))files.push(p);}})(ROOT);

const refs=new Map();
const add=(t,f)=>{ if(!t)return; const n=t.replace(/["`]/g,'').trim();
  if(!/^[A-Za-z_][A-Za-z0-9_]*$/.test(n))return;
  const NOISE=new Set(['information_schema','pg_class','pg_policy','pg_roles','pg_attribute',
    'pg_namespace','public','THE','as','AS','SELECT','select','a','c','p','n','t','x']);
  if(NOISE.has(n))return;
  if(n.length<=2)return;                       // aliases
  if(/^pg_/i.test(n))return;
  refs.set(n,[...new Set([...(refs.get(n)??[]),path.relative(ROOT,f)])]); };

for(const f of files){
  const s=fs.readFileSync(f,'utf8');
  for(const m of s.matchAll(/\bFROM\s+("?[A-Za-z_][\w]*"?)/g))       add(m[1],f);
  for(const m of s.matchAll(/\bINSERT\s+INTO\s+("?[A-Za-z_][\w]*"?)/gi)) add(m[1],f);
  for(const m of s.matchAll(/\bUPDATE\s+("?[A-Za-z_][\w]*"?)\s+SET/gi))  add(m[1],f);
  for(const m of s.matchAll(/\bDELETE\s+FROM\s+("?[A-Za-z_][\w]*"?)/gi)) add(m[1],f);
  for(const m of s.matchAll(/\bJOIN\s+("?[A-Za-z_][\w]*"?)/gi))          add(m[1],f);
}
const out=[...refs.entries()].sort().map(([t,f])=>({table:t,files:f}));
console.log('RUNTIME TABLE REFERENCES: '+out.length);
for(const o of out) console.log(`  ${o.table.padEnd(26)} ${o.files.slice(0,2).join(', ')}`);
fs.writeFileSync('/tmp/schema_coverage.json',JSON.stringify(out,null,2));
