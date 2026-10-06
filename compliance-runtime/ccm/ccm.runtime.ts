/**
 * Continuous Controls Monitoring Runtime — Phase 7.4
 * Live control health scoring, SoD monitoring, anomaly detection.
 */
import { v4 as uuidv4 } from "uuid";
import { getEventStore } from "../../runtime/persistence/persistent.event.store";

export type ControlStatus = "effective"|"partially_effective"|"ineffective"|"not_tested"|"override_detected";
export type ControlType   = "preventive"|"detective"|"corrective"|"compensating"|"directive";

export interface ControlHealth {
  readonly id:string; readonly tenantId:string;
  readonly controlId:string; readonly controlCode:string; readonly controlName:string;
  readonly type:ControlType; readonly status:ControlStatus;
  readonly effectivenessScore:number;  // 0-100
  readonly lastTestedAt?:string; readonly nextTestDue:string;
  readonly evidenceCount:number; readonly failureCount:number;
  readonly overrideDetected:boolean; readonly overrideCount:number;
  readonly ownerId:string; readonly updatedAt:string;
}

export interface SoDViolation {
  readonly id:string; readonly tenantId:string;
  readonly actorId:string; readonly conflictingRoles:string[];
  readonly conflictDescription:string; readonly detectedAt:string;
  readonly severity:"critical"|"high"|"medium";
  readonly blocked:boolean;
}

export interface CCMSignal {
  readonly id:string; readonly tenantId:string;
  readonly signalType:"control_failure"|"override_detected"|"sod_violation"|"evidence_gap"|"policy_breach"|"anomaly";
  readonly controlId?:string; readonly actorId?:string;
  readonly description:string; readonly severity:"critical"|"high"|"medium"|"low";
  readonly autoRemediation:boolean; readonly detectedAt:string;
}

const controlHealthStore = new Map<string,ControlHealth>();
const sodViolations:SoDViolation[] = [];
const ccmSignals:CCMSignal[] = [];

export class CCMRuntime {
  constructor(private readonly tenantId:string) {}

  registerControl(params:{controlId:string;controlCode:string;controlName:string;type:ControlType;ownerId:string;effectivenessScore?:number}):ControlHealth {
    const ch:ControlHealth = Object.freeze({
      id:uuidv4(), tenantId:this.tenantId,
      controlId:params.controlId, controlCode:params.controlCode, controlName:params.controlName,
      type:params.type, status:"not_tested",
      effectivenessScore:params.effectivenessScore??0,
      nextTestDue:new Date(Date.now()+30*24*3600000).toISOString(),
      evidenceCount:0, failureCount:0,
      overrideDetected:false, overrideCount:0,
      ownerId:params.ownerId, updatedAt:new Date().toISOString(),
    });
    controlHealthStore.set(`${this.tenantId}:${params.controlId}`, ch);
    return ch;
  }

  recordTestResult(controlId:string, passed:boolean, evidenceId:string, testedBy:string):ControlHealth {
    const key = `${this.tenantId}:${controlId}`;
    const ch  = controlHealthStore.get(key);
    if(!ch||ch.tenantId!==this.tenantId) throw Object.assign(new Error("Control not registered"),{statusCode:404});
    const failureCount = passed ? ch.failureCount : ch.failureCount+1;
    const score        = passed ? Math.min(100, ch.effectivenessScore+10) : Math.max(0, ch.effectivenessScore-20);
    const status:ControlStatus = score>=80?"effective":score>=50?"partially_effective":"ineffective";
    const updated:ControlHealth = Object.freeze({...ch, status, effectivenessScore:score, failureCount, evidenceCount:ch.evidenceCount+1, lastTestedAt:new Date().toISOString(), nextTestDue:new Date(Date.now()+30*24*3600000).toISOString(), updatedAt:new Date().toISOString()});
    controlHealthStore.set(key, updated);
    if(!passed) {
      const sig:CCMSignal = Object.freeze({id:uuidv4(),tenantId:this.tenantId,signalType:"control_failure",controlId,description:`Control ${ch.controlCode} test failed`,severity:score<20?"critical":"high",autoRemediation:false,detectedAt:new Date().toISOString()});
      ccmSignals.push(sig);
      getEventStore(this.tenantId).append({topic:"ccm.control.failed",payload:{controlId,controlCode:ch.controlCode,effectivenessScore:score},actorId:testedBy,actorRole:"control_tester"});
    }
    return updated;
  }

  detectOverride(controlId:string, actorId:string, reason:string):CCMSignal {
    const key = `${this.tenantId}:${controlId}`;
    const ch  = controlHealthStore.get(key);
    if(ch) {
      const updated:ControlHealth = Object.freeze({...ch, status:"override_detected", overrideDetected:true, overrideCount:ch.overrideCount+1, updatedAt:new Date().toISOString()});
      controlHealthStore.set(key, updated);
    }
    const sig:CCMSignal = Object.freeze({id:uuidv4(),tenantId:this.tenantId,signalType:"override_detected",controlId,actorId,description:`Override detected on control by ${actorId}: ${reason}`,severity:"critical",autoRemediation:false,detectedAt:new Date().toISOString()});
    ccmSignals.push(sig);
    getEventStore(this.tenantId).append({topic:"ccm.override.detected",payload:{controlId,actorId,reason},actorId,actorRole:"system"});
    return sig;
  }

  checkSoD(actorId:string, roles:string[], proposedAction:string):SoDViolation|null {
    // Simple SoD: same actor cannot both initiate and approve
    const CONFLICT_PAIRS = [["initiate","approve"],["prepare","review"],["request","authorize"],["execute","verify"]];
    for(const [a,b] of CONFLICT_PAIRS) {
      if(roles.some(r=>r.includes(a)) && roles.some(r=>r.includes(b))) {
        const v:SoDViolation = Object.freeze({id:uuidv4(),tenantId:this.tenantId,actorId,conflictingRoles:roles,conflictDescription:`Actor has conflicting roles for "${proposedAction}": ${a}+${b}`,detectedAt:new Date().toISOString(),severity:"critical",blocked:true});
        sodViolations.push(v);
        getEventStore(this.tenantId).append({topic:"ccm.sod.violation",payload:{actorId,roles,action:proposedAction},actorId,actorRole:"system"});
        return v;
      }
    }
    return null;
  }

  getControlHealth(controlId:string):ControlHealth|undefined { return controlHealthStore.get(`${this.tenantId}:${controlId}`); }
  getAllControls():ControlHealth[] { return [...controlHealthStore.values()].filter(c=>c.tenantId===this.tenantId); }
  getSignals(severity?:CCMSignal["severity"]):CCMSignal[] { return ccmSignals.filter(s=>s.tenantId===this.tenantId&&(!severity||s.severity===severity)); }
  getSoDViolations():SoDViolation[] { return sodViolations.filter(v=>v.tenantId===this.tenantId); }
  getOverallScore():number {
    const all=this.getAllControls();
    if(all.length===0) return 100;
    return Math.round(all.reduce((s,c)=>s+c.effectivenessScore,0)/all.length);
  }
}

const ccmCache=new Map<string,CCMRuntime>();
export function getCCMRuntime(tenantId:string):CCMRuntime {
  if(!ccmCache.has(tenantId)) ccmCache.set(tenantId,new CCMRuntime(tenantId));
  return ccmCache.get(tenantId)!;
}
