#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const root = path.resolve(__dirname, "..");
const read = p => fs.readFileSync(path.join(root, p), "utf8");
const checks = [];
const add = (name, ok, detail="") => checks.push({name, ok:!!ok, detail});

const docker = read("Dockerfile");
add("DOCKER_NODE_22_BASELINE", (docker.match(/FROM node:22-alpine/g)||[]).length >= 2);
add("DOCKER_MIGRATIONS_INCLUDED", /\/app\/db\/migrations \.\/db\/migrations/.test(docker));
add("DOCKER_READINESS_HEALTHCHECK", /\/health\/ready/.test(docker));
add("DOCKER_NO_FAIL_OPEN_TRIVY", !/trivy[^\n]*(--exit-code\s+0|\|\|\s*true)/i.test(docker));

const compose = read("docker-compose.yml");
add("COMPOSE_REDIS_AUTH", /redis-server[^\n]*--requirepass/.test(compose));
add("COMPOSE_NO_SOURCE_BIND_OVER_APP", !/\.\/:\/app/.test(compose));
add("COMPOSE_API_READINESS", /health\/ready/.test(compose));

const prodCompose = read("infra/docker/docker-compose.prod.yml");
add("PROD_COMPOSE_IMMUTABLE_APP_TAG", /SGIP_IMAGE_TAG:\?SGIP_IMAGE_TAG required/.test(prodCompose));
add("PROD_COMPOSE_NO_LATEST", !/image:\s*[^\n]+:latest\b/.test(prodCompose));
add("PROD_COMPOSE_NO_IMPLICIT_SNAKEOIL_TLS", !/ssl-cert-snakeoil/.test(prodCompose));
add("PROD_COMPOSE_EXPLICIT_API_HOST", /SGIP_API_HOST:\?SGIP_API_HOST required/.test(prodCompose));

const k8s = read("infra/kubernetes/deployment.yml");
add("K8S_POD_SECURITY_LABEL", /pod-security\.kubernetes\.io\/enforce:\s*restricted/.test(k8s));
add("K8S_NO_ACCOUNT_ID_PLACEHOLDER", !/ACCOUNT_ID/.test(k8s));
add("K8S_REFRESH_SECRET", /JWT_REFRESH_SECRET[\s\S]{0,180}jwt-refresh-secret/.test(k8s));
add("K8S_UID_MATCHES_IMAGE", /runAsUser:\s*1001/.test(k8s) && /runAsGroup:\s*1001/.test(k8s));
add("K8S_READONLY_ROOT", /readOnlyRootFilesystem:\s*true/.test(k8s));
add("K8S_READINESS", /path:\s*\/health\/ready/.test(k8s));
add("K8S_IMAGE_REQUIRES_DEPLOY_PATCH", /qualification-placeholder/.test(k8s));
add("K8S_DNS_EGRESS", /port:\s*53/.test(k8s));

const tf = read("infra/terraform/aws/main.tf");
const tfVars = read("infra/terraform/aws/variables.tf");
add("TERRAFORM_BACKEND_NOT_HARDCODED", /backend\s+"s3"\s*\{\s*\}/.test(tf));
add("TERRAFORM_EXPLICIT_EKS_VERSION", /cluster_version\s*=\s*var\.eks_cluster_version/.test(tf) && /variable\s+"eks_cluster_version"/.test(tfVars));
add("TERRAFORM_FORBIDS_PUBLIC_WORLD_CIDR", /!contains\(var\.allowed_cidr_blocks,\s*"0\.0\.0\.0\/0"\)/.test(tfVars) && /!contains\(var\.allowed_cidr_blocks,\s*"::\/0"\)/.test(tfVars));

let bad=0;
for (const c of checks) {
  console.log(`${c.ok ? "PASS" : "FAIL"} ${c.name}${c.detail ? " — "+c.detail : ""}`);
  if (!c.ok) bad++;
}
console.log(`DEPLOYMENT_READINESS_CHECKS=${checks.length}`);
console.log(`DEPLOYMENT_READINESS_FAILURES=${bad}`);
process.exit(bad ? 1 : 0);
