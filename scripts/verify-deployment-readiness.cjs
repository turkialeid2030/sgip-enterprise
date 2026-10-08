#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const root = path.resolve(__dirname, "..");
const read = p => fs.readFileSync(path.join(root, p), "utf8");

const checks = [];
const add = (name, ok, detail="") => checks.push({ name, ok: !!ok, detail });

const docker = read("Dockerfile");
add("DOCKER_NODE_22_BASELINE", (docker.match(/FROM node:22-alpine/g) || []).length >= 2);
add("DOCKER_TYPECHECK_BEFORE_BUILD", /npm run typecheck[\s\S]*npm run build/.test(docker));
add("DOCKER_MIGRATIONS_INCLUDED", /\/app\/db\/migrations \.\/db\/migrations/.test(docker));
add("DOCKER_LOCKFILE_INCLUDED", /package-lock\.json/.test(docker));
add("DOCKER_NON_ROOT", /USER sgip/.test(docker));
add("DOCKER_RUNTIME_NPM_REMOVED", /rm -rf \/usr\/local\/lib\/node_modules\/npm/.test(docker));
add("DOCKER_READINESS_HEALTHCHECK", /\/health\/ready/.test(docker));
const dockerContext = read(".dockerignore");
const excluded = new Set(dockerContext.split(String.fromCharCode(10)).map(x => x.trim()));
add("DOCKER_CONTEXT_EXCLUDES_GIT", excluded.has(".git"));
add("DOCKER_CONTEXT_EXCLUDES_NODE_MODULES", excluded.has("**/node_modules"));
add("DOCKER_CONTEXT_EXCLUDES_ENV_FILES", excluded.has("**/.env") && excluded.has("**/.env.*"));
add("DOCKER_CONTEXT_EXCLUDES_PRIVATE_KEYS", excluded.has("**/*.pem") && excluded.has("**/*.key"));

const prodCompose = read("infra/docker/docker-compose.prod.yml");
add("PROD_COMPOSE_IMMUTABLE_APP_TAG", /SGIP_IMAGE_TAG:\?SGIP_IMAGE_TAG required/.test(prodCompose));
add("PROD_COMPOSE_NO_APP_LATEST", !/sgip\/sovereign-grc-os:latest/.test(prodCompose));
add("PROD_COMPOSE_NO_SNAKEOIL_TLS", !/ssl-cert-snakeoil/.test(prodCompose));

const k8s = read("infra/kubernetes/deployment.yml");
add("K8S_RESTRICTED_POD_SECURITY", /pod-security\.kubernetes\.io\/enforce:\s*restricted/.test(k8s));
add("K8S_UID_MATCHES_IMAGE", /runAsUser:\s*1001/.test(k8s) && /runAsGroup:\s*1001/.test(k8s));
add("K8S_READONLY_ROOT", /readOnlyRootFilesystem:\s*true/.test(k8s));
add("K8S_REFRESH_SECRET", /JWT_REFRESH_SECRET[\s\S]{0,180}jwt-refresh-secret/.test(k8s));
add("K8S_READINESS", /path:\s*\/health\/ready/.test(k8s));
add("K8S_IMAGE_FAIL_CLOSED", /qualification-placeholder/.test(k8s));
add("K8S_SERVICE_ACCOUNT_TOKEN_DISABLED", /automountServiceAccountToken:\s*false/.test(k8s));
add("K8S_DNS_EGRESS", /port:\s*53/.test(k8s));

const tf = read("infra/terraform/aws/main.tf");
const tfVars = read("infra/terraform/aws/variables.tf");
add("TERRAFORM_BACKEND_EXTERNALIZED", /backend\s+"s3"\s*\{\s*\}/.test(tf));
add("TERRAFORM_EXPLICIT_EKS_VERSION", /cluster_version\s*=\s*var\.eks_cluster_version/.test(tf) && /variable\s+"eks_cluster_version"/.test(tfVars));
add("TERRAFORM_EKS_PRIVATE_DEFAULT", /cluster_endpoint_public_access"[\s\S]{0,160}default\s*=\s*false/.test(tfVars));
add("TERRAFORM_FORBIDS_PUBLIC_WORLD_CIDR", /0\.0\.0\.0\/0/.test(tfVars) && /::\/0/.test(tfVars) && /must never contain/.test(tfVars));
add("TERRAFORM_ECR_IMMUTABLE", /image_tag_mutability\s*=\s*"IMMUTABLE"/.test(tf));
add("TERRAFORM_ECR_SCAN_ON_PUSH", /scan_on_push\s*=\s*true/.test(tf));

const workflow = read(".github/workflows/sgip-qualification.yml");
add("CI_PUSH_MAIN", /push:\s*\n\s*branches:\s*\[main\]/.test(workflow));
add("CI_DEPLOYMENT_VERIFIER", /verify:deployment/.test(workflow));
add("CI_CONTAINER_SMOKE", /Production Container, Trivy, Readiness/.test(workflow));
add("CI_TRIVY_HIGH_CRITICAL", /--severity HIGH,CRITICAL/.test(workflow));
add("CI_RELEASE_ATTESTATION", /SGIP_RELEASE_GATE=PASS/.test(workflow));

let bad = 0;
for (const c of checks) {
  console.log(`${c.ok ? "PASS" : "FAIL"} ${c.name}${c.detail ? " — " + c.detail : ""}`);
  if (!c.ok) bad++;
}
console.log(`DEPLOYMENT_READINESS_CHECKS=${checks.length}`);
console.log(`DEPLOYMENT_READINESS_FAILURES=${bad}`);
process.exit(bad ? 1 : 0);
