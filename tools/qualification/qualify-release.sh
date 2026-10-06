#!/usr/bin/env bash
set -Eeuo pipefail
ROOT="${SGIP_ROOT:-$PWD}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TS="$(date -u +%Y%m%dT%H%M%SZ)"
OUT="${SGIP_QUALIFICATION_OUT:-$ROOT/qualification-evidence/$TS}"
mkdir -p "$OUT"; STATUS="$OUT/status.tsv"; :>"$STATUS"
log(){ printf '%s\t%s\t%s\n' "$1" "$2" "${3:-}" >>"$STATUS"; printf '[%s] %-34s %s%s\n' "$(date -u +%H:%M:%S)" "$1" "$2" "${3:+ — $3}"; }
run(){ local n="$1";shift; local l="$OUT/$n.log";set +e;(cd "$ROOT"&&"$@")>"$l" 2>&1;local rc=$?;set -e;echo "$rc">"$OUT/$n.exit";if ((rc==0));then log "$n" PASS 'exit=0';else log "$n" FAIL "exit=$rc log=$(basename "$l")";fi;return $rc; }
block(){ log "$1" BLOCKED "$2"; }
[[ -f "$ROOT/package.json" ]] || { echo 'package.json missing' >&2;exit 2; }
[[ "$(node -e 'const p=require(process.argv[1]);process.stdout.write(String(p.name||""))' "$ROOT/package.json" 2>/dev/null||true)" == '@sgip/enterprise' ]] || { echo 'wrong package' >&2;exit 2; }
{
 echo "timestamp_utc=$TS";echo "root=$ROOT";echo "node=$(node -v 2>/dev/null||echo missing)";echo "npm=$(npm -v 2>/dev/null||echo missing)";
 echo "git_commit=$(git -C "$ROOT" rev-parse HEAD 2>/dev/null||echo n/a)";
 echo "package_lock_sha256=$(sha256sum "$ROOT/package-lock.json" 2>/dev/null|awk '{print $1}'||echo missing)";
} >"$OUT/preflight.env.txt"
(cd "$ROOT"&&find . -type f ! -path './node_modules/*' ! -path './dist/*' ! -path './qualification-evidence/*' ! -path './.git/*' -print0|sort -z|xargs -0 sha256sum)>"$OUT/source-manifest.sha256"
SRCROOT="$(sha256sum "$OUT/source-manifest.sha256"|awk '{print $1}')";echo "$SRCROOT">"$OUT/source-manifest-root.txt"
EXPECTED_MANIFEST="${SGIP_EXPECTED_SOURCE_MANIFEST_ROOT:-$(cat "$SCRIPT_DIR/EXPECTED_SOURCE_MANIFEST_ROOT.txt" 2>/dev/null||true)}"
GIT="$(git -C "$ROOT" rev-parse HEAD 2>/dev/null||true)"
if [[ -n "${SGIP_EXPECTED_GIT_COMMIT:-}" ]];then [[ "$GIT" == "$SGIP_EXPECTED_GIT_COMMIT" ]]&&log source-identity PASS "git=$GIT"||log source-identity FAIL "git mismatch";
elif [[ -n "$EXPECTED_MANIFEST" ]];then [[ "$SRCROOT" == "$EXPECTED_MANIFEST" ]]&&log source-identity PASS "manifest=$SRCROOT"||log source-identity FAIL "manifest mismatch actual=$SRCROOT expected=$EXPECTED_MANIFEST";
else log source-identity FAIL 'no expected git commit or manifest configured';fi

if run npm-ci env npm_config_fetch_retries="${NPM_FETCH_RETRIES:-1}" npm ci --no-audit --no-fund;then
 run typecheck npm run typecheck||true;run build npm run build||true;run static-guard npm run verify:error-contract:static||true;run jest-open-handles npx jest --runInBand --detectOpenHandles||true
 if [[ -n "${DATABASE_URL:-}" ]];then run postgres-semantic env SGIP_ROOT="$ROOT" node "$SCRIPT_DIR/verify-postgres-target.cjs"||true;else log postgres-semantic FAIL 'DATABASE_URL missing';fi
else block typecheck 'npm-ci failed';block build 'npm-ci failed';block static-guard 'npm-ci failed';block jest-open-handles 'npm-ci failed';block postgres-semantic 'npm-ci failed';fi

HARNESS="${SGIP_ERROR_CONTRACT_HARNESS:-}"; RESULTS="${SGIP_ERROR_CONTRACT_RESULTS_JSON:-}"
if [[ -n "$HARNESS" && -f "$HARNESS" ]];then
 export SGIP_ROOT="$ROOT"; [[ -n "$GIT" ]]&&export SGIP_EXPECTED_GIT_COMMIT="${SGIP_EXPECTED_GIT_COMMIT:-$GIT}"||true
 run error-contract-e2e node "$HARNESS"||true
else block error-contract-e2e 'SGIP_ERROR_CONTRACT_HARNESS missing';fi
if [[ -n "$RESULTS" && -f "$RESULTS" ]];then run results-json-acceptance node "$SCRIPT_DIR/verify-error-contract-results.cjs" "$RESULTS"||true;else block results-json-acceptance 'SGIP_ERROR_CONTRACT_RESULTS_JSON missing';fi

leak=0;:>"$OUT/secret-scan.log";for n in JWT_SECRET JWT_REFRESH_SECRET ANTHROPIC_API_KEY PGPASSWORD APP_DB_PASSWORD MIGRATOR_DB_PASSWORD;do v="${!n:-}";if (( ${#v}>=8 ));then if grep -RFl --exclude=secret-scan.log -- "$v" "$OUT" >/dev/null 2>&1;then echo "FAIL secret=$n">>"$OUT/secret-scan.log";leak=1;else echo "PASS secret=$n">>"$OUT/secret-scan.log";fi;fi;done
((leak==0))&&log evidence-secret-scan PASS 'no configured secret values found'||log evidence-secret-scan FAIL 'secret material found'

mandatory=(source-identity npm-ci typecheck build static-guard jest-open-handles postgres-semantic error-contract-e2e results-json-acceptance evidence-secret-scan); verdict=GO
for n in "${mandatory[@]}";do st="$(awk -F '\t' -v n="$n" '$1==n{v=$2}END{print v}' "$STATUS")";[[ "$st" == PASS ]]||verdict=HOLD;done
node - "$STATUS" "$verdict" "$TS" <<'NODE' >"$OUT/qualification-summary.json"
const fs=require('fs');const [f,verdict,ts]=process.argv.slice(2);const rows=fs.readFileSync(f,'utf8').trim().split(/\n/).filter(Boolean).map(x=>{const [name,status,...d]=x.split('\t');return{name,status,detail:d.join('\t')}});process.stdout.write(JSON.stringify({generatedAtUtc:ts,verdict,rows},null,2)+'\n');
NODE
(cd "$OUT"&&find . -type f ! -name evidence-sha256.txt -print0|sort -z|xargs -0 sha256sum)>"$OUT/evidence-sha256.txt"
echo "FINAL_QUALIFICATION_VERDICT=$verdict";echo "EVIDENCE_DIR=$OUT";[[ "$verdict" == GO ]]
