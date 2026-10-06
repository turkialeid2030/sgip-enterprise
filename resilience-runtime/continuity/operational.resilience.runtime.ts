/**
 * Operational Resilience Runtime — Phase 7.8
 * BCP, dependency mapping, recovery objectives, resilience scoring.
 */
import { v4 as uuidv4 } from "uuid";
import { getEventStore } from "../../runtime/persistence/persistent.event.store";

export interface CriticalProcess {
  readonly id:string; readonly tenantId:string;
  readonly name:string; readonly code:string;
  readonly rto:number; readonly rpo:number;  // hours
  readonly tier:"tier1"|"tier2"|"tier3";
  readonly dependencies:string[]; readonly ownerId:string;
  readonly status:"active"|"disrupted"|"recovered";
  readonly resilienceScore:number; readonly lastTestedAt?:string;
  readonly createdAt:string;
}

export interface ServiceDependency {
  readonly id:string; readonly tenantId:string;
  readonly processId:string; readonly dependencyType:"internal"|"vendor"|"infrastructure"|"data";
  readonly dependencyName:string; readonly criticality:"critical"|"high"|"medium"|"low";
  readonly singlePointOfFailure:boolean;
  readonly fallback?:string; readonly createdAt:string;
}

export interface ResilienceScore {
  readonly tenantId:string; readonly scoredAt:string;
  readonly overallScore:number;
  readonly dimensions:{bcp:number;rto_compliance:number;rpo_compliance:number;test_coverage:number;dependency_health:number};
  readonly tier1ProcessCount:number; readonly criticalProcessesTested:number;
  readonly singlePointsOfFailure:number; readonly recommendations:string[];
  readonly dataSufficiency:"sufficient"|"insufficient";
}

const processStore    = new Map<string,CriticalProcess>();
const dependencyStore = new Map<string,ServiceDependency>();

export class OperationalResilienceRuntime {
  constructor(private readonly tenantId:string) {}

  registerProcess(params:{name:string;code:string;rto:number;rpo:number;tier:CriticalProcess["tier"];ownerId:string;dependencies?:string[]}):CriticalProcess {
    const p:CriticalProcess=Object.freeze({id:uuidv4(),tenantId:this.tenantId,...params,dependencies:params.dependencies??[],status:"active",resilienceScore:70,createdAt:new Date().toISOString()});
    processStore.set(p.id,p);
    return p;
  }

  addDependency(processId:string,params:{dependencyType:ServiceDependency["dependencyType"];dependencyName:string;criticality:ServiceDependency["criticality"];singlePointOfFailure:boolean;fallback?:string}):ServiceDependency {
    const dep:ServiceDependency=Object.freeze({id:uuidv4(),tenantId:this.tenantId,processId,...params,createdAt:new Date().toISOString()});
    dependencyStore.set(dep.id,dep);
    if(params.singlePointOfFailure) getEventStore(this.tenantId).append({topic:"resilience.spof.detected",payload:{processId,dependencyName:params.dependencyName},actorId:"system",actorRole:"system"});
    return dep;
  }

  scoreResilience():ResilienceScore {
    const all=this.getProcesses();
    const t1=all.filter(p=>p.tier==="tier1");
    const tested=all.filter(p=>p.lastTestedAt).length;
    const deps=[...dependencyStore.values()].filter(d=>d.tenantId===this.tenantId);
    const spofs=deps.filter(d=>d.singlePointOfFailure).length;
    const hasInventory=all.length>0;
    const rtoCompliance=hasInventory?Math.round(all.filter(p=>p.rto<=24).length/all.length*100):0;
    const rpoCompliance=hasInventory?Math.round(all.filter(p=>p.rpo<=4).length/all.length*100):0;
    const testCoverage =hasInventory?Math.round(tested/all.length*100):0;
    const depHealth=hasInventory ? (deps.length>0?Math.max(0,100-spofs*15):50) : 0;
    const overall=Math.round((rtoCompliance+rpoCompliance+testCoverage+depHealth)/4);
    const recs:string[]=[];
    if(!hasInventory) recs.push("No critical-process inventory available — resilience score is unassessed/fail-closed");
    else if(deps.length===0) recs.push("No service dependencies mapped — dependency health cannot be fully evidenced");
    if(spofs>0) recs.push(`Eliminate ${spofs} single points of failure`);
    if(testCoverage<80) recs.push(`Increase resilience testing coverage (currently ${testCoverage}%)`);
    return {tenantId:this.tenantId,scoredAt:new Date().toISOString(),overallScore:overall,dimensions:{bcp:overall,rto_compliance:rtoCompliance,rpo_compliance:rpoCompliance,test_coverage:testCoverage,dependency_health:depHealth},tier1ProcessCount:t1.length,criticalProcessesTested:tested,singlePointsOfFailure:spofs,recommendations:recs,dataSufficiency:hasInventory?"sufficient":"insufficient"};
  }

  getProcesses(tier?:CriticalProcess["tier"]):CriticalProcess[] { return [...processStore.values()].filter(p=>p.tenantId===this.tenantId&&(!tier||p.tier===tier)); }
  getDependencies(processId?:string):ServiceDependency[] { return [...dependencyStore.values()].filter(d=>d.tenantId===this.tenantId&&(!processId||d.processId===processId)); }
}

const resCache=new Map<string,OperationalResilienceRuntime>();
export function getResilienceRuntime(tenantId:string):OperationalResilienceRuntime {
  if(!resCache.has(tenantId)) resCache.set(tenantId,new OperationalResilienceRuntime(tenantId));
  return resCache.get(tenantId)!;
}
