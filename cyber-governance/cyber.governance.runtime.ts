/**
 * Cyber & Data Governance Runtime — Phase 12
 *
 * Connects: Cyber assets → Controls → Incidents → Access → Data lineage
 * Supports: NCA ECC, ISO 27001, SAMA CSF, PDPL, NIST CSF
 */
import { v4 as uuidv4 } from "uuid";
import { getEventStore } from "../runtime/persistence/persistent.event.store";
import { getCCMRuntime } from "../compliance-runtime/ccm/ccm.runtime";
import { getIncidentRuntime } from "../resilience-runtime/incidents/incident.crisis.runtime";

// ── Cyber Asset Inventory ─────────────────────────────────────
export type AssetCriticality = "critical"|"high"|"medium"|"low";
export type AssetType = "server"|"application"|"database"|"network_device"|"cloud_service"|"endpoint"|"ot_system"|"data_store";

export interface CyberAsset {
  readonly id:            string;
  readonly tenantId:      string;
  readonly name:          string;
  readonly assetType:     AssetType;
  readonly criticality:   AssetCriticality;
  readonly ownerId:       string;
  readonly environment:   "production"|"staging"|"development"|"dr";
  readonly dataClassification:"public"|"internal"|"confidential"|"restricted";
  readonly regulatoryScope:string[];  // which regs apply
  readonly controlIds:    string[];
  readonly exposureScore: number;     // 0-100
  readonly lastScannedAt?:string;
  readonly vulnerabilities:number;
  readonly patchStatus:  "current"|"behind"|"critical_patch_missing";
  readonly createdAt:    string;
}

// ── Access Governance ─────────────────────────────────────────
export interface AccessRecord {
  readonly id:          string;
  readonly tenantId:    string;
  readonly principalId: string;
  readonly principalType:"user"|"service_account"|"ai_agent";
  readonly resourceId:  string;
  readonly accessLevel: "read"|"write"|"admin"|"owner";
  readonly grantedBy:   string;
  readonly grantedAt:   string;
  readonly expiresAt?:  string;
  readonly justification:string;
  readonly reviewedAt?: string;
  readonly isPrivileged:boolean;
  readonly riskScore:   number;       // 0-100
}

// ── Data Lineage ──────────────────────────────────────────────
export interface DataLineageNode {
  readonly id:            string;
  readonly tenantId:      string;
  readonly dataAssetId:   string;
  readonly dataAssetName: string;
  readonly classification:"public"|"internal"|"confidential"|"restricted"|"secret";
  readonly sourceSystem:  string;
  readonly transformation?:string;
  readonly destinations:  string[];
  readonly retentionDays: number;
  readonly pdplApplicable:boolean;
  readonly crossBorder:   boolean;
  readonly encryptionAtRest:boolean;
  readonly encryptionInTransit:boolean;
  readonly createdAt:     string;
}

// ── Ransomware Readiness ──────────────────────────────────────
export interface RansomwareReadiness {
  tenantId:           string;
  scoredAt:           string;
  overallScore:       number;   // 0-100 (higher = more ready)
  backupCoverage:     number;
  recoveryTimeHours:  number;
  immutableBackups:   boolean;
  segmentation:       boolean;
  incidentPlaybook:   boolean;
  lastDrillDate?:     string;
  criticalAssetsProtected:number;
  totalCriticalAssets:number;
  recommendations:    string[];
  dataSufficiency:     "sufficient"|"partial"|"insufficient";
  backupEvidenceAvailable:boolean;
}

// ── Security Metrics ──────────────────────────────────────────
export interface CyberGovernanceScore {
  tenantId:           string;
  scoredAt:           string;
  overallScore:       number;
  assetCoverage:      number;
  accessRiskScore:    number;
  patchComplianceRate:number;
  incidentResponseScore:number;
  dataProtectionScore:number;
  privilegedAccessRisk:number;
  criticalVulnerabilities:number;
  overduePatches:     number;
  expiredAccess:      number;
  recommendations:    string[];
  dataSufficiency:     "sufficient"|"partial"|"insufficient";
}

const assetStore    = new Map<string, CyberAsset[]>();
const accessStore   = new Map<string, AccessRecord[]>();
const lineageStore  = new Map<string, DataLineageNode[]>();

export class CyberGovernanceRuntime {
  constructor(private readonly tenantId: string) {}

  registerAsset(params: Omit<CyberAsset,"id"|"tenantId"|"createdAt">): CyberAsset {
    const asset: CyberAsset = Object.freeze({ ...params, id:uuidv4(), tenantId:this.tenantId, createdAt:new Date().toISOString() });
    if (!assetStore.has(this.tenantId)) assetStore.set(this.tenantId, []);
    assetStore.get(this.tenantId)!.push(asset);

    if (params.criticality === "critical" && params.patchStatus === "critical_patch_missing") {
      getEventStore(this.tenantId).append({
        topic: "cyber.asset.critical_patch_missing",
        payload: { assetId:asset.id, assetName:params.name, env:params.environment },
        actorId:"system", actorRole:"system",
      });
    }
    return asset;
  }

  grantAccess(params: Omit<AccessRecord,"id"|"tenantId">): AccessRecord {
    const rec: AccessRecord = Object.freeze({ ...params, id:uuidv4(), tenantId:this.tenantId });
    if (!accessStore.has(this.tenantId)) accessStore.set(this.tenantId, []);
    accessStore.get(this.tenantId)!.push(rec);

    if (params.isPrivileged && params.riskScore > 70) {
      getEventStore(this.tenantId).append({
        topic: "cyber.access.high_risk_privileged",
        payload: { accessId:rec.id, principalId:params.principalId, resourceId:params.resourceId, riskScore:params.riskScore },
        actorId: params.grantedBy, actorRole:"access_admin",
      });
    }
    return rec;
  }

  trackDataLineage(params: Omit<DataLineageNode,"id"|"tenantId"|"createdAt">): DataLineageNode {
    const node: DataLineageNode = Object.freeze({ ...params, id:uuidv4(), tenantId:this.tenantId, createdAt:new Date().toISOString() });
    if (!lineageStore.has(this.tenantId)) lineageStore.set(this.tenantId, []);
    lineageStore.get(this.tenantId)!.push(node);

    if (params.crossBorder && params.pdplApplicable) {
      getEventStore(this.tenantId).append({
        topic: "cyber.data.cross_border_personal_data",
        payload: { nodeId:node.id, assetName:params.dataAssetName, source:params.sourceSystem },
        actorId:"system", actorRole:"system",
      });
    }
    return node;
  }

  detectAccessAnomalies(): Array<{principalId:string; riskType:string; severity:string; description:string}> {
    const records = accessStore.get(this.tenantId) ?? [];
    const anomalies: Array<{principalId:string; riskType:string; severity:string; description:string}> = [];
    const now = new Date().toISOString();

    // Expired access
    const expired = records.filter(r => r.expiresAt && r.expiresAt < now);
    for (const r of expired) {
      anomalies.push({ principalId:r.principalId, riskType:"expired_access", severity:"high", description:`Access to ${r.resourceId} expired on ${r.expiresAt}` });
    }

    // Unreviewed privileged access > 90 days
    const stalePrivileged = records.filter(r => r.isPrivileged && (!r.reviewedAt || new Date(r.reviewedAt).getTime() < Date.now() - 90*86400000));
    for (const r of stalePrivileged) {
      anomalies.push({ principalId:r.principalId, riskType:"stale_privileged_access", severity:"critical", description:`Privileged access to ${r.resourceId} not reviewed for 90+ days` });
    }

    // Multiple admin grants to same principal
    const adminCounts = records.filter(r => r.accessLevel === "admin").reduce((acc,r) => { acc[r.principalId] = (acc[r.principalId]??0)+1; return acc; }, {} as Record<string,number>);
    for (const [pid, count] of Object.entries(adminCounts)) {
      if (count >= 3) anomalies.push({ principalId:pid, riskType:"excessive_admin_access", severity:"high", description:`Principal has admin access to ${count} resources` });
    }

    return anomalies;
  }

  assessRansomwareReadiness(): RansomwareReadiness {
    const assets  = this.getAssets();
    const critical = assets.filter(a => a.criticality === "critical");
    const incidents = getIncidentRuntime(this.tenantId).getAll("security");
    const hasPlaybook = incidents.length > 0;
    const criticalPatched = critical.filter(a => a.patchStatus === "current").length;

    // Patch status is NOT backup evidence. Until an explicit backup/recovery evidence source is integrated,
    // backup/immutability/RTO claims must fail closed rather than fabricate readiness.
    const backupEvidenceAvailable = false;
    const backupCoverage = 0;
    const immutableBackups = false;
    const recoveryTimeHours = 0; // 0 means unassessed here; see backupEvidenceAvailable/dataSufficiency.
    const segmentation = assets.some(a => a.assetType === "network_device");
    const patchCoverage = critical.length>0 ? Math.round(criticalPatched/critical.length*100) : 0;
    const overallScore = assets.length===0 ? 0 : Math.round((patchCoverage + (segmentation?80:0) + 0 + (hasPlaybook?85:0)) / 4);

    const recs: string[] = ["Backup coverage, immutability, and recovery-time evidence are not integrated — ransomware readiness is fail-closed"];
    if (patchCoverage < 80) recs.push(`Only ${patchCoverage}% of critical assets have current patches — increase patch coverage`);
    if (!segmentation)       recs.push("No network segmentation detected — implement network isolation");
    if (!hasPlaybook)        recs.push("No ransomware incident response playbook — develop and test playbook");
    if (assets.length===0)   recs.push("No cyber-asset inventory available — readiness cannot be assessed");

    return { tenantId:this.tenantId, scoredAt:new Date().toISOString(), overallScore, backupCoverage, recoveryTimeHours, immutableBackups, segmentation, incidentPlaybook:hasPlaybook, criticalAssetsProtected:criticalPatched, totalCriticalAssets:critical.length, recommendations:recs, dataSufficiency:assets.length===0?"insufficient":"partial", backupEvidenceAvailable };
  }

  scoreGovernance(): CyberGovernanceScore {
    const assets  = this.getAssets();
    const access  = accessStore.get(this.tenantId) ?? [];
    const ccm     = getCCMRuntime(this.tenantId);
    const lineage = lineageStore.get(this.tenantId) ?? [];

    const patchedCount    = assets.filter(a => a.patchStatus === "current").length;
    const patchRate       = assets.length > 0 ? Math.round(patchedCount/assets.length*100) : 0;
    const privRisk        = access.filter(a => a.isPrivileged && a.riskScore > 60).length;
    const expired         = this.detectAccessAnomalies().filter(a => a.riskType === "expired_access").length;
    const critVulns       = assets.reduce((s,a) => s + (a.patchStatus==="critical_patch_missing"?1:0), 0);
    const dataProtection  = lineage.filter(l => l.encryptionAtRest && l.encryptionInTransit).length / Math.max(1,lineage.length) * 100;

    const hasCyberData = assets.length>0 || access.length>0 || lineage.length>0;
    const accessPosture = access.length>0 ? Math.max(0,100-privRisk*10) : 0;
    const ccmScore = hasCyberData ? ccm.getOverallScore() : 0;
    const overall = Math.round((patchRate + ccmScore + accessPosture + dataProtection) / 4);
    const recs: string[] = [
      ...(critVulns > 0 ? [`${critVulns} critical patches missing — immediate remediation`] : []),
      ...(expired > 0   ? [`${expired} expired access records — revoke immediately`] : []),
      ...(privRisk > 0  ? [`${privRisk} high-risk privileged access grants — urgent review`] : []),
      ...(!hasCyberData ? ["No cyber asset/access/lineage inventory available — governance score is fail-closed"] : []),
    ];

    return { tenantId:this.tenantId, scoredAt:new Date().toISOString(), overallScore:Math.min(100,Math.max(0,overall)), assetCoverage:assets.length>0?80:0, accessRiskScore:Math.min(100,privRisk*15), patchComplianceRate:patchRate, incidentResponseScore:hasCyberData?75:0, dataProtectionScore:Math.round(dataProtection), privilegedAccessRisk:privRisk, criticalVulnerabilities:critVulns, overduePatches:assets.filter(a=>a.patchStatus==="behind").length, expiredAccess:expired, recommendations:recs, dataSufficiency:!hasCyberData?"insufficient":(assets.length>0&&lineage.length>0?"sufficient":"partial") };
  }

  getAssets(criticality?: AssetCriticality): CyberAsset[] {
    const all = assetStore.get(this.tenantId) ?? [];
    return criticality ? all.filter(a=>a.criticality===criticality) : all;
  }
  getAccessRecords(principalId?: string): AccessRecord[] {
    const all = accessStore.get(this.tenantId) ?? [];
    return principalId ? all.filter(a=>a.principalId===principalId) : all;
  }
  getDataLineage(pdplOnly?: boolean): DataLineageNode[] {
    const all = lineageStore.get(this.tenantId) ?? [];
    return pdplOnly ? all.filter(l=>l.pdplApplicable) : all;
  }
}

const cyberCache = new Map<string, CyberGovernanceRuntime>();
export function getCyberGovernanceRuntime(tenantId: string): CyberGovernanceRuntime {
  if (!cyberCache.has(tenantId)) cyberCache.set(tenantId, new CyberGovernanceRuntime(tenantId));
  return cyberCache.get(tenantId)!;
}
