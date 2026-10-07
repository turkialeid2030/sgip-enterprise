/**
 * Edge Registry — typed edge definitions with semantic rules.
 * Defines: which node types can connect, semantic weight, direction rules.
 * Enforced by GovernanceGraphRuntime on edge creation.
 */
import { GovernanceNodeType, GovernanceEdgeType } from "../../types/graph.v4.types";

export interface EdgeDefinition {
  edgeType:     GovernanceEdgeType;
  fromTypes:    GovernanceNodeType[];
  toTypes:      GovernanceNodeType[];
  baseWeight:   number;
  isDirectional:boolean;
  description:  string;
  propagatesRisk:boolean;
  requiresEvidence:boolean;
}

export const EDGE_DEFINITIONS: Record<GovernanceEdgeType, EdgeDefinition> = {
  REGULATION_REQUIRES_CONTROL:  { edgeType:"REGULATION_REQUIRES_CONTROL",  fromTypes:["regulation"],  toTypes:["control"],  baseWeight:9, isDirectional:true, description:"Regulation mandates control implementation", propagatesRisk:false, requiresEvidence:false },
  REGULATION_CREATES_OBLIGATION:{ edgeType:"REGULATION_CREATES_OBLIGATION", fromTypes:["regulation"],  toTypes:["obligation"],baseWeight:9, isDirectional:true, description:"Regulation creates compliance obligation",  propagatesRisk:false, requiresEvidence:false },
  POLICY_IMPLEMENTS_REGULATION: { edgeType:"POLICY_IMPLEMENTS_REGULATION",  fromTypes:["policy"],      toTypes:["regulation"],baseWeight:8, isDirectional:true, description:"Policy implements regulatory requirement",  propagatesRisk:false, requiresEvidence:true  },
  POLICY_SUPERSEDES_POLICY:     { edgeType:"POLICY_SUPERSEDES_POLICY",      fromTypes:["policy"],      toTypes:["policy"],   baseWeight:7, isDirectional:true, description:"Newer policy supersedes older version",    propagatesRisk:false, requiresEvidence:true  },
  POLICY_GOVERNS_CONTROL:       { edgeType:"POLICY_GOVERNS_CONTROL",        fromTypes:["policy"],      toTypes:["control"],  baseWeight:7, isDirectional:true, description:"Policy governs control behaviour",         propagatesRisk:false, requiresEvidence:false },
  CONTROL_ADDRESSES_RISK:       { edgeType:"CONTROL_ADDRESSES_RISK",        fromTypes:["control"],     toTypes:["risk"],     baseWeight:8, isDirectional:true, description:"Control mitigates or addresses risk",      propagatesRisk:false, requiresEvidence:true  },
  EVIDENCE_SUPPORTS_FINDING:    { edgeType:"EVIDENCE_SUPPORTS_FINDING",     fromTypes:["evidence"],    toTypes:["audit_finding"],baseWeight:9, isDirectional:true, description:"Evidence supports audit finding",  propagatesRisk:false, requiresEvidence:false },
  EVIDENCE_VALIDATES_CONTROL:   { edgeType:"EVIDENCE_VALIDATES_CONTROL",    fromTypes:["evidence"],    toTypes:["control"],  baseWeight:9, isDirectional:true, description:"Evidence validates control effectiveness",  propagatesRisk:false, requiresEvidence:false },
  EVIDENCE_PROVES_COMPLIANCE:   { edgeType:"EVIDENCE_PROVES_COMPLIANCE",    fromTypes:["evidence"],    toTypes:["obligation"],baseWeight:9, isDirectional:true, description:"Evidence proves compliance obligation",    propagatesRisk:false, requiresEvidence:false },
  ATTESTATION_CERTIFIES_CONTROL:{ edgeType:"ATTESTATION_CERTIFIES_CONTROL", fromTypes:["attestation"], toTypes:["control"],  baseWeight:8, isDirectional:true, description:"Attestation certifies control operation",  propagatesRisk:false, requiresEvidence:true  },
  RISK_THREATENS_ASSET:         { edgeType:"RISK_THREATENS_ASSET",          fromTypes:["risk"],        toTypes:["asset"],    baseWeight:7, isDirectional:true, description:"Risk threatens organizational asset",      propagatesRisk:true,  requiresEvidence:false },
  RISK_AMPLIFIES_RISK:          { edgeType:"RISK_AMPLIFIES_RISK",           fromTypes:["risk"],        toTypes:["risk"],     baseWeight:6, isDirectional:true, description:"Risk amplifies another risk (cascading)",  propagatesRisk:true,  requiresEvidence:false },
  INCIDENT_TRIGGERS_RISK:       { edgeType:"INCIDENT_TRIGGERS_RISK",        fromTypes:["incident"],    toTypes:["risk"],     baseWeight:8, isDirectional:true, description:"Incident triggers or elevates risk",       propagatesRisk:true,  requiresEvidence:true  },
  VENDOR_INTRODUCES_RISK:       { edgeType:"VENDOR_INTRODUCES_RISK",        fromTypes:["vendor"],      toTypes:["risk"],     baseWeight:7, isDirectional:true, description:"Vendor relationship introduces risk",      propagatesRisk:true,  requiresEvidence:false },
  FINDING_SPAWNS_CAPA:          { edgeType:"FINDING_SPAWNS_CAPA",           fromTypes:["audit_finding"],toTypes:["capa"],   baseWeight:8, isDirectional:true, description:"Audit finding generates corrective action", propagatesRisk:false, requiresEvidence:true  },
  CAPA_CLOSES_FINDING:          { edgeType:"CAPA_CLOSES_FINDING",           fromTypes:["capa"],        toTypes:["audit_finding"],baseWeight:8, isDirectional:true, description:"CAPA closes the originating finding",  propagatesRisk:false, requiresEvidence:true  },
  EXCEPTION_OVERRIDES_CONTROL:  { edgeType:"EXCEPTION_OVERRIDES_CONTROL",   fromTypes:["exception"],   toTypes:["control"],  baseWeight:6, isDirectional:true, description:"Exception grants override of control",     propagatesRisk:true,  requiresEvidence:true  },
  WORKFLOW_APPROVES_EXCEPTION:  { edgeType:"WORKFLOW_APPROVES_EXCEPTION",    fromTypes:["workflow"],    toTypes:["exception"],baseWeight:7, isDirectional:true, description:"Workflow approval authorises exception",   propagatesRisk:false, requiresEvidence:true  },
  COMMITTEE_OWNS_POLICY:        { edgeType:"COMMITTEE_OWNS_POLICY",         fromTypes:["committee"],   toTypes:["policy"],   baseWeight:8, isDirectional:true, description:"Committee owns and governs policy",        propagatesRisk:false, requiresEvidence:false },
  COMMITTEE_APPROVES_DECISION:  { edgeType:"COMMITTEE_APPROVES_DECISION",   fromTypes:["committee"],   toTypes:["board_decision"],baseWeight:9, isDirectional:true, description:"Committee approves board decision",propagatesRisk:false, requiresEvidence:true  },
  USER_OWNS_RISK:               { edgeType:"USER_OWNS_RISK",                fromTypes:["user"],        toTypes:["risk"],     baseWeight:6, isDirectional:true, description:"User is risk owner with accountability",   propagatesRisk:false, requiresEvidence:false },
  USER_ATTESTS_CONTROL:         { edgeType:"USER_ATTESTS_CONTROL",          fromTypes:["user"],        toTypes:["control"],  baseWeight:7, isDirectional:true, description:"User attests to control operation",        propagatesRisk:false, requiresEvidence:true  },
  ROLE_GRANTS_ACCESS:           { edgeType:"ROLE_GRANTS_ACCESS",            fromTypes:["role"],        toTypes:["asset"],    baseWeight:6, isDirectional:true, description:"Role grants access to asset",               propagatesRisk:false, requiresEvidence:false },
  ROLE_RESTRICTS_ACTION:        { edgeType:"ROLE_RESTRICTS_ACTION",         fromTypes:["role"],        toTypes:["workflow"], baseWeight:7, isDirectional:true, description:"Role restricts specific workflow action",   propagatesRisk:false, requiresEvidence:false },
  KRI_MEASURES_RISK:            { edgeType:"KRI_MEASURES_RISK",             fromTypes:["kri"],         toTypes:["risk"],     baseWeight:7, isDirectional:true, description:"KRI measures and monitors risk level",     propagatesRisk:false, requiresEvidence:false },
  KCI_TESTS_CONTROL:            { edgeType:"KCI_TESTS_CONTROL",             fromTypes:["kci"],         toTypes:["control"],  baseWeight:7, isDirectional:true, description:"KCI tests and validates control",          propagatesRisk:false, requiresEvidence:true  },
  KPI_TRACKS_OBJECTIVE:         { edgeType:"KPI_TRACKS_OBJECTIVE",          fromTypes:["kpi"],         toTypes:["strategic_objective"],baseWeight:7, isDirectional:true, description:"KPI tracks strategic objective", propagatesRisk:false, requiresEvidence:false },
  FINDING_BREACHES_KRI:         { edgeType:"FINDING_BREACHES_KRI",          fromTypes:["audit_finding"],toTypes:["kri"],    baseWeight:8, isDirectional:true, description:"Audit finding causes KRI breach",          propagatesRisk:true,  requiresEvidence:true  },
  CONTROL_INHERITS_CONTROL:     { edgeType:"CONTROL_INHERITS_CONTROL",      fromTypes:["control"],     toTypes:["control"],  baseWeight:5, isDirectional:true, description:"Control inherits behaviour from parent",   propagatesRisk:false, requiresEvidence:false },
  POLICY_INHERITS_POLICY:       { edgeType:"POLICY_INHERITS_POLICY",        fromTypes:["policy"],      toTypes:["policy"],   baseWeight:5, isDirectional:true, description:"Policy inherits rules from parent",        propagatesRisk:false, requiresEvidence:false },
  RISK_INHERITS_RISK:           { edgeType:"RISK_INHERITS_RISK",            fromTypes:["risk"],        toTypes:["risk"],     baseWeight:5, isDirectional:true, description:"Risk inherits properties from parent",     propagatesRisk:true,  requiresEvidence:false },
};

export function getEdgeDefinition(type: GovernanceEdgeType): EdgeDefinition | undefined {
  return EDGE_DEFINITIONS[type];
}

export function validateEdgeTyping(
  fromType: GovernanceNodeType,
  toType:   GovernanceNodeType,
  edgeType: GovernanceEdgeType,
): { valid: boolean; reason?: string } {
  const def = EDGE_DEFINITIONS[edgeType];
  if (!def) return { valid: false, reason: `Unknown edge type: ${edgeType}` };
  if (!def.fromTypes.includes(fromType)) return { valid: false, reason: `${edgeType}: fromType "${fromType}" not in [${def.fromTypes.join(",")}]` };
  if (!def.toTypes.includes(toType))     return { valid: false, reason: `${edgeType}: toType "${toType}" not in [${def.toTypes.join(",")}]` };
  return { valid: true };
}

export function getRiskPropagatingEdgeTypes(): GovernanceEdgeType[] {
  return Object.values(EDGE_DEFINITIONS).filter(d => d.propagatesRisk).map(d => d.edgeType);
}

export function getEvidenceRequiredEdgeTypes(): GovernanceEdgeType[] {
  return Object.values(EDGE_DEFINITIONS).filter(d => d.requiresEvidence).map(d => d.edgeType);
}
