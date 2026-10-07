/**
 * Integrated Assurance Runtime — Phase 7.9
 * Unifies audit, compliance, controls, risk, AI assurance.
 */
import { v4 as uuidv4 } from "uuid";
import { getEventStore } from "../../runtime/persistence/persistent.event.store";
import { getCCMRuntime } from "../../compliance-runtime/ccm/ccm.runtime";
import { getRiskRuntime } from "../../risk-runtime/register/risk.intelligence.runtime";
import { getComplianceObligationRuntime } from "../../compliance-runtime/obligations/compliance.obligation.runtime";

export interface AssuranceOpinion {
  readonly id:string; readonly tenantId:string;
  readonly scope:string; readonly periodFrom:string; readonly periodTo:string;
  readonly opinionType:"reasonable"|"limited"|"adverse"|"disclaimer";
  readonly overallRating:"satisfactory"|"needs_improvement"|"unsatisfactory"|"critical";
  readonly evidenceCount:number; readonly findingCount:number;
  readonly controlScore:number; readonly riskScore:number; readonly complianceScore:number; readonly aiScore:number;
  readonly overallScore:number;
  readonly keyFindings:string[]; readonly recommendations:string[];
  readonly issuedBy:string; readonly issuedAt:string;
  readonly signature:string;
}

export interface AssuranceEvidence {
  readonly id:string; readonly tenantId:string;
  readonly domain:"control"|"risk"|"compliance"|"ai"|"governance";
  readonly entityId:string; readonly description:string;
  readonly source:string; readonly hash:string;
  readonly collectedAt:string; readonly expiresAt:string;
  readonly valid:boolean;
}

const opinionStore  = new Map<string,AssuranceOpinion>();
const evidenceStore = new Map<string,AssuranceEvidence>();

export class IntegratedAssuranceRuntime {
  constructor(private readonly tenantId:string) {}

  collectEvidence(params:{domain:AssuranceEvidence["domain"];entityId:string;description:string;source:string;ttlDays?:number}):AssuranceEvidence {
    const crypto=require("crypto");
    const ttlDays=params.ttlDays??365;
    if(!Number.isFinite(ttlDays)||ttlDays<=0||ttlDays>3650) throw Object.assign(new RangeError("ttlDays must be > 0 and <= 3650"),{statusCode:422,code:"VALIDATION_ERROR"});
    const collectedAt=new Date().toISOString();
    const expiresAt=new Date(Date.now()+ttlDays*24*3600000).toISOString();
    const ev:AssuranceEvidence=Object.freeze({
      id:uuidv4(), tenantId:this.tenantId,
      domain:params.domain, entityId:params.entityId,
      description:params.description, source:params.source,
      hash:crypto.createHash("sha256").update(JSON.stringify({tenantId:this.tenantId,domain:params.domain,entityId:params.entityId,description:params.description,source:params.source,collectedAt,expiresAt})).digest("hex").slice(0,24),
      collectedAt, expiresAt,
      valid:true,
    });
    evidenceStore.set(ev.id, ev);
    return ev;
  }

  issueOpinion(params:{scope:string;periodFrom:string;periodTo:string;issuedBy:string}):AssuranceOpinion {
    const crypto=require("crypto");
    const ccm   = getCCMRuntime(this.tenantId);
    const risk  = getRiskRuntime(this.tenantId);
    const compl = getComplianceObligationRuntime(this.tenantId);
    const evs   = this.getEvidence();

    const controlScore  = ccm.getOverallScore();
    const riskCount     = risk.getAll().length; const breachCount = risk.getBreachingTolerance().length;
    const riskScore     = riskCount>0?Math.max(0,100-Math.round(breachCount/riskCount*100)):100;
    const oblCount      = compl.getAll().length; const oblBreach = compl.getBreached().length;
    const complianceScore = oblCount>0?Math.max(0,100-Math.round(oblBreach/oblCount*100)):100;
    // No synthetic AI score: AI assurance remains unproven until AI-domain evidence exists.
    const aiScore       = evs.some(e=>e.domain==="ai") ? 100 : 0;
    const evidenceDomains = new Set(evs.map(e=>e.domain));
    const evidenceCoverage = evidenceDomains.size / 5;
    const operationalScore = (controlScore+riskScore+complianceScore+aiScore)/4;
    const overallScore  = Math.round(operationalScore * evidenceCoverage);

    let rating:AssuranceOpinion["overallRating"] = overallScore>=80?"satisfactory":overallScore>=60?"needs_improvement":overallScore>=40?"unsatisfactory":"critical";
    let opinion:AssuranceOpinion["opinionType"]  = overallScore>=80?"reasonable":overallScore>=60?"limited":overallScore>=40?"adverse":"disclaimer";
    if (evs.length===0 || evidenceCoverage<0.4) { opinion="disclaimer"; rating="critical"; }
    else if (evidenceCoverage<0.8 && opinion==="reasonable") opinion="limited";

    const keyFindings:string[]=[];
    if(breachCount>0) keyFindings.push(`${breachCount} risks exceeding tolerance thresholds`);
    if(oblBreach>0)   keyFindings.push(`${oblBreach} compliance obligations in breach`);
    if(controlScore<60) keyFindings.push(`Control effectiveness below threshold (${controlScore}%)`);
    if(evs.length===0) keyFindings.push("No valid assurance evidence available — opinion cannot be supported");
    else if(evidenceDomains.size<4) keyFindings.push(`Evidence domain coverage incomplete (${evidenceDomains.size}/5 domains)`);
    if(aiScore===0) keyFindings.push("AI assurance evidence not available — AI component scored at 0");

    const op:AssuranceOpinion=Object.freeze({
      id:uuidv4(), tenantId:this.tenantId,
      scope:params.scope, periodFrom:params.periodFrom, periodTo:params.periodTo,
      opinionType:opinion, overallRating:rating,
      evidenceCount:evs.length, findingCount:keyFindings.length,
      controlScore, riskScore, complianceScore, aiScore, overallScore,
      keyFindings, recommendations:keyFindings.map(f=>`Address: ${f}`),
      issuedBy:params.issuedBy, issuedAt:new Date().toISOString(),
      signature:crypto.createHash("sha256").update(JSON.stringify({scope:params.scope,periodFrom:params.periodFrom,periodTo:params.periodTo,overallScore,issuedBy:params.issuedBy,evidence:evs.map(e=>({id:e.id,hash:e.hash})).sort((a,b)=>a.id.localeCompare(b.id))})).digest("hex").slice(0,24),
    });
    opinionStore.set(op.id, op);
    getEventStore(this.tenantId).append({topic:"assurance.opinion.issued",payload:{opinionId:op.id,overallRating:rating,overallScore},actorId:params.issuedBy,actorRole:"assurance_lead"});
    return op;
  }

  getEvidence(domain?:AssuranceEvidence["domain"]):AssuranceEvidence[] {
    const now=Date.now();
    return [...evidenceStore.values()].filter(e=>e.tenantId===this.tenantId&&(!domain||e.domain===domain)&&e.valid&&Number.isFinite(Date.parse(e.expiresAt))&&Date.parse(e.expiresAt)>now);
  }
  getOpinions():AssuranceOpinion[] { return [...opinionStore.values()].filter(o=>o.tenantId===this.tenantId); }
  getLatestOpinion():AssuranceOpinion|undefined { return this.getOpinions().at(-1); }
}

const assurCache=new Map<string,IntegratedAssuranceRuntime>();
export function getAssuranceRuntime(tenantId:string):IntegratedAssuranceRuntime {
  if(!assurCache.has(tenantId)) assurCache.set(tenantId,new IntegratedAssuranceRuntime(tenantId));
  return assurCache.get(tenantId)!;
}
