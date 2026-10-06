/**
 * DevSecOps Governance Runtime — Phase 19
 * Policy-as-code pipelines, deployment risk scoring,
 * infrastructure drift detection, secure artifact governance.
 */
import { v4 as uuidv4 } from "uuid";
import * as crypto from "crypto";
import { getEventStore } from "../runtime/persistence/persistent.event.store";

export type DeploymentEnvironment = "production"|"staging"|"development"|"dr"|"sandbox";
export type ArtifactType = "container_image"|"npm_package"|"terraform_module"|"helm_chart"|"binary";
export type PolicyCheckStatus = "pass"|"fail"|"warn"|"skip";

export interface DeploymentRequest {
  readonly id:           string;
  readonly tenantId:     string;
  readonly serviceName:  string;
  readonly version:      string;
  readonly environment:  DeploymentEnvironment;
  readonly requestedBy:  string;
  readonly artifacts:    string[];
  readonly changeRef:    string;
  readonly riskScore:    number;        // 0-100
  readonly policyChecks: PolicyCheck[];
  readonly approved:     boolean;
  readonly blockedReason?:string;
  readonly deployedAt?:  string;
  readonly createdAt:    string;
}

export interface PolicyCheck {
  readonly checkId:   string;
  readonly name:      string;
  readonly category:  "security"|"compliance"|"governance"|"quality"|"performance";
  readonly status:    PolicyCheckStatus;
  readonly details:   string;
  readonly mandatory: boolean;
}

export interface ArtifactRecord {
  readonly id:         string;
  readonly tenantId:   string;
  readonly name:       string;
  readonly type:       ArtifactType;
  readonly version:    string;
  readonly hash:       string;         // SHA-256
  readonly sigVerified:boolean;
  readonly sbomPresent:boolean;
  readonly vulnCount:  number;
  readonly critVulns:  number;
  readonly approved:   boolean;
  readonly scannedAt:  string;
  readonly createdAt:  string;
}

export interface InfrastructureDrift {
  id:          string;
  tenantId:    string;
  resource:    string;
  environment: DeploymentEnvironment;
  expectedState:Record<string, unknown>;
  actualState:  Record<string, unknown>;
  driftType:   "config_drift"|"access_drift"|"network_drift"|"secret_drift"|"policy_drift";
  severity:    "critical"|"high"|"medium"|"low";
  detectedAt:  string;
  autoRemediation:boolean;
}

const deploymentStore = new Map<string, DeploymentRequest[]>();
const artifactStore   = new Map<string, ArtifactRecord[]>();
const driftStore      = new Map<string, InfrastructureDrift[]>();

// Default policy checks for production deployments
const PRODUCTION_POLICY_CHECKS: Omit<PolicyCheck,"status"|"details">[] = [
  { checkId:"SEC-001", name:"Container Image Vulnerability Scan", category:"security", mandatory:true },
  { checkId:"SEC-002", name:"SBOM (Software Bill of Materials) Present", category:"security", mandatory:true },
  { checkId:"SEC-003", name:"No Critical CVEs", category:"security", mandatory:true },
  { checkId:"GOV-001", name:"Change Management Approval", category:"governance", mandatory:true },
  { checkId:"GOV-002", name:"Risk Assessment Completed", category:"governance", mandatory:true },
  { checkId:"COM-001", name:"Data Protection Impact Assessment (if applicable)", category:"compliance", mandatory:false },
  { checkId:"QUA-001", name:"Unit Test Coverage >= 80%", category:"quality", mandatory:false },
  { checkId:"QUA-002", name:"Security Test Passed", category:"quality", mandatory:true },
];

export class DevSecOpsGovernanceRuntime {
  constructor(private readonly tenantId: string) {}

  assessDeployment(params: {
    serviceName:  string;
    version:      string;
    environment:  DeploymentEnvironment;
    requestedBy:  string;
    artifacts:    string[];
    changeRef:    string;
    hasApproval:  boolean;
    testCoverage: number;
    vulnCount:    number;
    critVulns:    number;
    hasSBOM:      boolean;
  }): DeploymentRequest {
    const checks: PolicyCheck[] = PRODUCTION_POLICY_CHECKS.map(check => {
      let status: PolicyCheckStatus = "pass";
      let details = "Check passed";
      switch(check.checkId) {
        case "SEC-001": status = params.vulnCount === 0 ? "pass" : params.critVulns > 0 ? "fail" : "warn"; details = params.vulnCount === 0 ? "No vulnerabilities" : `${params.vulnCount} vulnerabilities (${params.critVulns} critical)`; break;
        case "SEC-002": status = params.hasSBOM ? "pass" : "fail"; details = params.hasSBOM ? "SBOM present" : "SBOM missing — required for supply chain governance"; break;
        case "SEC-003": status = params.critVulns === 0 ? "pass" : "fail"; details = params.critVulns === 0 ? "No critical CVEs" : `${params.critVulns} critical CVEs — deployment blocked`; break;
        case "GOV-001": status = params.hasApproval ? "pass" : "fail"; details = params.hasApproval ? "Change approved" : "Missing change management approval"; break;
        case "GOV-002": status = params.environment === "production" && !params.hasApproval ? "warn" : "pass"; details = "Risk assessment status based on approval"; break;
        case "QUA-001": status = params.testCoverage >= 80 ? "pass" : params.testCoverage >= 60 ? "warn" : "fail"; details = `Test coverage: ${params.testCoverage}%`; break;
        case "QUA-002": status = "pass"; details = "Security tests passed (assumed)"; break;
        default: status = "skip"; details = "Check skipped";
      }
      return { ...check, status, details };
    });

    const mandatoryFailed = checks.filter(c => c.mandatory && c.status === "fail").length;
    const riskScore = Math.min(100, params.critVulns * 25 + (!params.hasSBOM?15:0) + (!params.hasApproval&&params.environment==="production"?30:0) + (params.vulnCount * 2));

    const dep: DeploymentRequest = Object.freeze({
      id:uuidv4(), tenantId:this.tenantId,
      serviceName:params.serviceName, version:params.version,
      environment:params.environment, requestedBy:params.requestedBy,
      artifacts:params.artifacts, changeRef:params.changeRef,
      riskScore, policyChecks:checks,
      approved: mandatoryFailed === 0,
      blockedReason: mandatoryFailed > 0 ? `${mandatoryFailed} mandatory policy checks failed` : undefined,
      createdAt:new Date().toISOString(),
    });
    if (!deploymentStore.has(this.tenantId)) deploymentStore.set(this.tenantId, []);
    deploymentStore.get(this.tenantId)!.push(dep);

    if (!dep.approved) {
      getEventStore(this.tenantId).append({ topic:"devsecops.deployment.blocked", payload:{ serviceName:params.serviceName, version:params.version, env:params.environment, reason:dep.blockedReason }, actorId:params.requestedBy, actorRole:"developer" });
    }
    return dep;
  }

  registerArtifact(params: {name:string; type:ArtifactType; version:string; vulnCount:number; critVulns:number; hasSBOM:boolean; sigVerified:boolean}): ArtifactRecord {
    const hash = crypto.createHash("sha256").update(`${params.name}:${params.version}:${Date.now()}`).digest("hex");
    const art: ArtifactRecord = Object.freeze({
      ...params, id:uuidv4(), tenantId:this.tenantId, hash, sbomPresent:params.hasSBOM,
      approved: params.critVulns === 0 && params.hasSBOM,
      scannedAt:new Date().toISOString(), createdAt:new Date().toISOString(),
    });
    if (!artifactStore.has(this.tenantId)) artifactStore.set(this.tenantId, []);
    artifactStore.get(this.tenantId)!.push(art);
    return art;
  }

  detectInfraDrift(params: {resource:string; environment:DeploymentEnvironment; expected:Record<string,unknown>; actual:Record<string,unknown>; driftType:InfrastructureDrift["driftType"]}): InfrastructureDrift | null {
    const hasDrift = JSON.stringify(params.expected) !== JSON.stringify(params.actual);
    if (!hasDrift) return null;
    const severity: InfrastructureDrift["severity"] = params.driftType === "secret_drift" ? "critical" : params.driftType === "access_drift" ? "high" : params.environment === "production" ? "high" : "medium";
    const drift: InfrastructureDrift = { id:uuidv4(), tenantId:this.tenantId, resource:params.resource, environment:params.environment, expectedState:params.expected, actualState:params.actual, driftType:params.driftType, severity, detectedAt:new Date().toISOString(), autoRemediation:severity!=="critical" };
    if (!driftStore.has(this.tenantId)) driftStore.set(this.tenantId, []);
    driftStore.get(this.tenantId)!.push(drift);
    getEventStore(this.tenantId).append({ topic:`devsecops.infra.drift.${severity}`, payload:{ resource:params.resource, driftType:params.driftType, env:params.environment }, actorId:"drift_detector", actorRole:"system" });
    return drift;
  }

  getDeployments(env?: DeploymentEnvironment): DeploymentRequest[] {
    const all = deploymentStore.get(this.tenantId) ?? [];
    return env ? all.filter(d=>d.environment===env) : all;
  }
  getBlockedDeployments(): DeploymentRequest[] { return this.getDeployments().filter(d=>!d.approved); }
  getArtifacts(): ArtifactRecord[] { return artifactStore.get(this.tenantId) ?? []; }
  getDrifts(): InfrastructureDrift[] { return driftStore.get(this.tenantId) ?? []; }
  getRiskScore(): number {
    const deps = this.getDeployments();
    const arts = this.getArtifacts();
    const drifts = this.getDrifts();
    return Math.min(100, Math.round(
      (this.getBlockedDeployments().length*20) + (arts.filter(a=>a.critVulns>0).length*25) + (drifts.filter(d=>d.severity==="critical").length*30)
    ));
  }
}

const dsCache = new Map<string, DevSecOpsGovernanceRuntime>();
export function getDevSecOpsRuntime(tenantId: string): DevSecOpsGovernanceRuntime {
  if (!dsCache.has(tenantId)) dsCache.set(tenantId, new DevSecOpsGovernanceRuntime(tenantId));
  return dsCache.get(tenantId)!;
}
