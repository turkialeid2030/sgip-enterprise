/**
 * AI Readiness Intake Engine — SCEOS Layer 8
 * Governance-aware AI readiness assessment.
 */
import { v4 as uuidv4 } from "uuid";

export type IndustrySector = "banking"|"insurance"|"healthcare"|"government"|"retail"|"energy"|"telecom"|"manufacturing"|"education"|"other";
export type CompanySize = "startup"|"sme"|"enterprise"|"large_enterprise"|"government_entity";
export type MaturityLevel = 1|2|3|4|5;
export type BudgetLevel = "none"|"minimal"|"moderate"|"significant"|"strategic";
export type AIUsageLevel = "none"|"experimental"|"limited"|"moderate"|"extensive";

export interface AIReadinessIntake {
  id:string; tenantId:string; sector:IndustrySector; companySize:CompanySize; userRole:string;
  currentAIUsage:AIUsageLevel; aiDepartments:string[]; adoptionBarriers:string[];
  timeConsumingTasks:string[]; willingToGrantAIAccess:boolean;
  dataMaturity:MaturityLevel; governanceMaturity:MaturityLevel; cyberMaturity:MaturityLevel;
  complianceMaturity:MaturityLevel; seniorLeadershipReadiness:MaturityLevel;
  budgetLevel:BudgetLevel; submittedAt:string;
}

export interface RoadmapPhase { phase:number; title:string; duration:string; actions:string[]; expectedROI:string; riskLevel:"low"|"medium"|"high"; }
export interface AutomationOpportunity { department:string; automatable:string[]; estimatedSaving:number; aiRisk:"low"|"medium"|"high"; }

export interface AIReadinessScore {
  id:string; tenantId:string; intakeId:string;
  aiReadinessScore:number; aiGovernanceRiskScore:number;
  roadmap:RoadmapPhase[]; departmentAutomationMap:Record<string,AutomationOpportunity>;
  quickWins:string[]; highRiskAreas:string[]; executiveSummary:string; generatedAt:string;
}

const intakeStore = new Map<string,AIReadinessIntake>();
const scoreStore  = new Map<string,AIReadinessScore>();

export class AIReadinessEngine {
  constructor(private readonly tenantId:string) {}

  submitIntake(params:Omit<AIReadinessIntake,"id"|"tenantId"|"submittedAt">):AIReadinessIntake {
    const intake:AIReadinessIntake = {...params,id:uuidv4(),tenantId:this.tenantId,submittedAt:new Date().toISOString()};
    intakeStore.set(intake.id,intake); return intake;
  }

  scoreIntake(intakeId:string):AIReadinessScore {
    const intake = intakeStore.get(intakeId);
    if (!intake||intake.tenantId!==this.tenantId) throw Object.assign(new Error("Intake not found"),{statusCode:404});
    const maturityAvg = (intake.dataMaturity+intake.governanceMaturity+intake.cyberMaturity+intake.complianceMaturity+intake.seniorLeadershipReadiness)/5;
    const usageBonus = ({none:0,experimental:5,limited:10,moderate:20,extensive:30} as Record<AIUsageLevel,number>)[intake.currentAIUsage];
    const budgetBonus = ({none:0,minimal:5,moderate:10,significant:20,strategic:30} as Record<BudgetLevel,number>)[intake.budgetLevel];
    const aiReadinessScore      = Math.min(100,Math.round((maturityAvg/5)*40+usageBonus+budgetBonus));
    const aiGovernanceRiskScore = Math.max(0,Math.round(80-(intake.governanceMaturity*12)-(intake.cyberMaturity*8)));
    const roadmap:RoadmapPhase[] = [
      {phase:1,title:"Foundation: Governance + Data",duration:"0-3 months",actions:["Establish AI policy","Data inventory","Risk classification"],expectedROI:"Risk -30%",riskLevel:"low"},
      {phase:2,title:"Pilot: Controlled Deployment",duration:"3-6 months",actions:["Select 2-3 low-risk cases","Human oversight","Measure impact"],expectedROI:"Productivity +15%",riskLevel:"medium"},
      {phase:3,title:"Scale: Governed Expansion",duration:"6-12 months",actions:["Expand departments","Automate monitoring","External audit"],expectedROI:"Efficiency +30%",riskLevel:"medium"},
    ];
    const departmentAutomationMap:Record<string,AutomationOpportunity> = {};
    for (const dept of intake.aiDepartments) {
      departmentAutomationMap[dept] = {department:dept,aiRisk:intake.governanceMaturity>=3?"low":"medium",estimatedSaving:10+Math.round(maturityAvg*2),automatable:["Report generation","Data analysis","Document review"]};
    }
    const quickWins = [...(intake.governanceMaturity>=3?["AI-assisted policy review"]:[]),(intake.dataMaturity>=3?"Automate KRI monitoring":"Data foundation first"),"AI meeting summarization","Document classification"];
    const highRiskAreas = [...(intake.governanceMaturity<=2?["AI governance gap"]:[]),(intake.cyberMaturity<=2?"Cyber posture insufficient":""),(intake.complianceMaturity<=2?"Compliance framework not ready":"")].filter(Boolean);
    const executiveSummary = `AI Readiness: ${aiReadinessScore}/100. Governance Risk: ${aiGovernanceRiskScore}/100. `+(aiReadinessScore>=70?"Ready for governed deployment.":aiReadinessScore>=40?"Foundation work required.":"Significant preparation needed.");
    const score:AIReadinessScore = {id:uuidv4(),tenantId:this.tenantId,intakeId,aiReadinessScore,aiGovernanceRiskScore,roadmap,departmentAutomationMap,quickWins,highRiskAreas,executiveSummary,generatedAt:new Date().toISOString()};
    scoreStore.set(score.id,score); return score;
  }

  getLatestScore():AIReadinessScore|undefined { return [...scoreStore.values()].filter(s=>s.tenantId===this.tenantId).at(-1); }
}

const aiCache = new Map<string,AIReadinessEngine>();
export function getAIReadinessEngine(tenantId:string):AIReadinessEngine {
  if (!aiCache.has(tenantId)) aiCache.set(tenantId,new AIReadinessEngine(tenantId)); return aiCache.get(tenantId)!;
}
