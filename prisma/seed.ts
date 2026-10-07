/**
 * SGIP Enterprise — Realistic Governance Seed
 * Creates a complete governance universe:
 *   - Tenant + Users (6 roles)
 *   - Regulations (5 Saudi + international)
 *   - Risks (8 — spanning regulatory, cyber, financial, governance, AI)
 *   - Controls (12 — preventive/detective/corrective, manual/automated)
 *   - Compliance Obligations (5 — mapped to regulations)
 *   - Audit Findings (6 — with evidence links)
 *   - Evidence (7 — real hashes, legal hold)
 *   - CAPAs (5 — with overdue flags)
 *   - Policies (5 — with freshness scores)
 *   - Decisions (3 — board-approved)
 *   - Graph edges (20+ relationships wiring everything together)
 */
import { Pool } from "pg";
import bcrypt from "bcryptjs";
import { v4 as uuidv4 } from "uuid";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL
    ?? "postgresql://sgip_admin:sgip_secure_2025@localhost:5432/sgip_enterprise",
});

const q = async (sql: string, p: unknown[] = []) => {
  const r = await pool.query(sql, p);
  return r.rows;
};

const TENANT_ID = "tenant-001";
const ORG_ID    = "org-001";

async function upsertEntity(id: string, type: string, title: string, owner: string, data: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) {
  await q(
    `INSERT INTO "GovernanceEntity"
     (id, type, title, owner, status, priority, "riskLevel", "impactLevel",
      "dataJson", confidentiality, "tenantId", "organizationId", "createdBy", "updatedBy",
      "linkedRegulations", "linkedRisks", "linkedControls", "linkedEvidence",
      "linkedFindings", "linkedCAPAs", "linkedPolicies", "linkedDecisions",
      "linkedObligations", tags)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'system','system',$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)
     ON CONFLICT (id) DO NOTHING`,
    [
      id, type, title, owner,
      extra["status"] ?? "active",
      extra["priority"] ?? "high",
      extra["riskLevel"] ?? "high",
      extra["impactLevel"] ?? "high",
      JSON.stringify(data),
      extra["confidentiality"] ?? "confidential",
      TENANT_ID, ORG_ID,
      extra["linkedRegulations"] ?? [],
      extra["linkedRisks"]       ?? [],
      extra["linkedControls"]    ?? [],
      extra["linkedEvidence"]    ?? [],
      extra["linkedFindings"]    ?? [],
      extra["linkedCAPAs"]       ?? [],
      extra["linkedPolicies"]    ?? [],
      extra["linkedDecisions"]   ?? [],
      extra["linkedObligations"] ?? [],
      extra["tags"]              ?? [],
    ],
  );
}

async function upsertEdge(fromId: string, fromType: string, toId: string, toType: string, rel: string, weight = 5) {
  await q(
    `INSERT INTO "GraphEdge" (id,"fromId","fromType","toId","toType",relationship,weight,"tenantId","createdBy")
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'system')
     ON CONFLICT ("fromId","toId",relationship) DO NOTHING`,
    [uuidv4(), fromId, fromType, toId, toType, rel, weight, TENANT_ID],
  );
}

async function main() {
  console.log("╔══════════════════════════════════════════════════╗");
  console.log("║  SGIP Enterprise — Realistic Governance Seed    ║");
  console.log("╚══════════════════════════════════════════════════╝\n");

  // ── Tenant ────────────────────────────────────────────────────
  await q(`INSERT INTO "Tenant" (id, name, slug) VALUES ($1,$2,$3) ON CONFLICT (id) DO NOTHING`,
    [TENANT_ID, "مجموعة الستارتك القابضة", "startak"]);
  console.log("✓ Tenant: مجموعة الستارتك القابضة");

  // ── Users ─────────────────────────────────────────────────────
  const hash = await bcrypt.hash("Demo@1234", 12);
  const users = [
    { id:"usr-001", email:"cgo@demo.sgip",     nameAr:"أحمد العمري",       role:"governance_analyst"    },
    { id:"usr-002", email:"risk@demo.sgip",    nameAr:"م. نورا الشمري",    role:"risk_analyst"          },
    { id:"usr-003", email:"audit@demo.sgip",   nameAr:"منى الغامدي",       role:"internal_audit_agent"  },
    { id:"usr-004", email:"finance@demo.sgip", nameAr:"ريم السهلي",        role:"financial_reviewer"    },
    { id:"usr-005", email:"legal@demo.sgip",   nameAr:"فيصل الدوسري",      role:"legal_reviewer"        },
    { id:"usr-006", email:"admin@demo.sgip",   nameAr:"مسؤول النظام",      role:"orchestrator"          },
  ];
  for (const u of users) {
    await q(
      `INSERT INTO "User" (id,email,"passwordHash","nameAr",role,"tenantId") VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (email,"tenantId") DO NOTHING`,
      [u.id, u.email, hash, u.nameAr, u.role, TENANT_ID],
    );
  }
  console.log(`✓ ${users.length} users (password: Demo@1234)`);

  // ── Regulations ───────────────────────────────────────────────
  const regs = [
    { id:"reg-cma",   title:"لائحة حوكمة الشركات CMA-GOV-2023", data:{ code:"CMA-GOV-2023", issuer:"هيئة السوق المالية",    obligationCount:18, penaltyRange:"SAR 500K - 5M",     lastUpdated:"2023-12-01" } },
    { id:"reg-pdpl",  title:"نظام حماية البيانات الشخصية PDPL",  data:{ code:"PDPL-2021",    issuer:"SDAIA",                 obligationCount:26, penaltyRange:"SAR 3M + إيقاف",    lastUpdated:"2024-02-01" } },
    { id:"reg-nca",   title:"الضوابط الأساسية للأمن NCA-ECC",    data:{ code:"NCA-ECC",      issuer:"NCA",                   obligationCount:21, penaltyRange:"SAR 2M + تعليق",    lastUpdated:"2023-08-01" } },
    { id:"reg-fatf",  title:"توصيات مجموعة العمل المالي FATF",   data:{ code:"FATF-2023",    issuer:"FATF",                  obligationCount:40, penaltyRange:"قوائم سوداء دولية",  lastUpdated:"2023-06-01" } },
    { id:"reg-zatca", title:"متطلبات الامتثال الضريبي ZATCA",    data:{ code:"ZATCA-VAT",    issuer:"هيئة الزكاة والضريبة",  obligationCount:14, penaltyRange:"5-25% + فوائد",     lastUpdated:"2024-03-01" } },
  ];
  for (const r of regs) {
    await upsertEntity(r.id, "regulation", r.title, "CCO", r.data, { status:"active", priority:"high", riskLevel:"high", confidentiality:"internal" });
  }
  console.log(`✓ ${regs.length} regulations`);

  // ── Policies ──────────────────────────────────────────────────
  const policies = [
    { id:"pol-001", title:"سياسة الحوكمة المؤسسية",          owner:"CGO",  data:{ code:"POL-GOV-001", version:"2.1", freshnessScore:72, linkedRegCodes:["CMA-GOV-2023"], lastReview:"2024-09-01" }, extra:{ linkedRegulations:["reg-cma"], priority:"critical", riskLevel:"high", confidentiality:"confidential" } },
    { id:"pol-002", title:"سياسة حماية البيانات الشخصية",    owner:"CTO",  data:{ code:"POL-DATA-001",version:"1.3", freshnessScore:35, linkedRegCodes:["PDPL-2021"],    lastReview:"2024-01-01" }, extra:{ linkedRegulations:["reg-pdpl"], status:"needs_review", confidentiality:"confidential" } },
    { id:"pol-003", title:"سياسة مكافحة غسل الأموال AML",    owner:"CCO",  data:{ code:"POL-AML-001", version:"3.0", freshnessScore:85, linkedRegCodes:["FATF-2023"],    lastReview:"2025-01-15" }, extra:{ linkedRegulations:["reg-fatf"], confidentiality:"confidential" } },
    { id:"pol-004", title:"سياسة تضارب المصالح",             owner:"CGO",  data:{ code:"POL-COI-001", version:"1.0", freshnessScore:12, conflictFlag:true,               lastReview:"2023-06-01" }, extra:{ linkedRegulations:["reg-cma"], status:"under_review", confidentiality:"confidential" } },
    { id:"pol-005", title:"سياسة الأمن السيبراني",           owner:"CISO", data:{ code:"POL-SEC-001", version:"2.2", freshnessScore:88, linkedRegCodes:["NCA-ECC"],      lastReview:"2025-02-01" }, extra:{ linkedRegulations:["reg-nca"], confidentiality:"confidential" } },
  ];
  for (const p of policies) {
    await upsertEntity(p.id, "policy", p.title, p.owner, p.data, { ...p.extra, tags:["policy","governance"] });
  }
  console.log(`✓ ${policies.length} policies`);

  // ── Risks ─────────────────────────────────────────────────────
  const risks = [
    { id:"risk-001", title:"عدم الامتثال لـ CMA-GOV-2023",   owner:"CGO",  data:{ code:"R-001", category:"regulatory", probability:4, impact:5, inherentScore:20, residualScore:12, toleranceBreached:true,  appetiteBreached:true,  trending:"up"    }, extra:{ priority:"critical", riskLevel:"critical", linkedRegulations:["reg-cma"], linkedPolicies:["pol-001","pol-004"], linkedControls:["ctrl-001","ctrl-002"] } },
    { id:"risk-002", title:"اختراق بيانات العملاء",          owner:"CISO", data:{ code:"R-002", category:"cyber",       probability:3, impact:5, inherentScore:15, residualScore:8,  toleranceBreached:true,  appetiteBreached:true,  trending:"stable" }, extra:{ priority:"critical", riskLevel:"critical", linkedRegulations:["reg-pdpl","reg-nca"], linkedPolicies:["pol-002","pol-005"], linkedControls:["ctrl-003","ctrl-004"] } },
    { id:"risk-003", title:"غسل الأموال AML",                owner:"CCO",  data:{ code:"R-003", category:"financial",   probability:3, impact:5, inherentScore:15, residualScore:9,  toleranceBreached:true,  appetiteBreached:true,  trending:"down"   }, extra:{ priority:"critical", riskLevel:"critical", linkedRegulations:["reg-fatf"], linkedPolicies:["pol-003"], linkedControls:["ctrl-005","ctrl-006"] } },
    { id:"risk-004", title:"ضعف آليات الحوكمة المؤسسية",    owner:"CGO",  data:{ code:"R-004", category:"governance",  probability:4, impact:4, inherentScore:16, residualScore:10, toleranceBreached:false, appetiteBreached:true,  trending:"up"     }, extra:{ priority:"critical", riskLevel:"critical", linkedRegulations:["reg-cma"], linkedPolicies:["pol-001"], linkedControls:["ctrl-007","ctrl-008"] } },
    { id:"risk-005", title:"الاحتيال المالي الداخلي",        owner:"CAE",  data:{ code:"R-005", category:"financial",   probability:2, impact:5, inherentScore:10, residualScore:6,  toleranceBreached:false, appetiteBreached:false, trending:"stable" }, extra:{ priority:"high",     riskLevel:"high",     linkedControls:["ctrl-009"] } },
    { id:"risk-006", title:"انقطاع العمليات التشغيلية",      owner:"COO",  data:{ code:"R-006", category:"operational", probability:3, impact:4, inherentScore:12, residualScore:7,  toleranceBreached:false, appetiteBreached:false, trending:"stable" }, extra:{ priority:"high",     riskLevel:"high",     linkedRegulations:["reg-nca"], linkedControls:["ctrl-010"] } },
    { id:"risk-007", title:"الامتثال الضريبي ZATCA",         owner:"CFO",  data:{ code:"R-007", category:"financial",   probability:2, impact:3, inherentScore:6,  residualScore:3,  toleranceBreached:false, appetiteBreached:false, trending:"down"   }, extra:{ priority:"medium",   riskLevel:"medium",   linkedRegulations:["reg-zatca"], linkedControls:["ctrl-011"] } },
    { id:"risk-008", title:"مخاطر الذكاء الاصطناعي",        owner:"CTO",  data:{ code:"R-008", category:"ai",          probability:3, impact:4, inherentScore:12, residualScore:9,  toleranceBreached:true,  appetiteBreached:true,  trending:"up"     }, extra:{ priority:"high",     riskLevel:"high",     linkedRegulations:["reg-pdpl"], linkedControls:["ctrl-012"] } },
  ];
  for (const r of risks) {
    await upsertEntity(r.id, "risk", r.title, r.owner, r.data, { ...r.extra, tags:["risk",r.data["category"] as string] });
  }
  console.log(`✓ ${risks.length} risks`);

  // ── Controls ──────────────────────────────────────────────────
  const controls = [
    { id:"ctrl-001", title:"لجنة الحوكمة والمراجعة المستقلة",  owner:"مجلس الإدارة",  data:{ code:"C-001", controlType:"preventive",  mode:"manual",    frequency:"quarterly",    effectiveness:85, lastTestedAt:"2025-02-01" }, extra:{ priority:"critical", riskLevel:"high", linkedRisks:["risk-001","risk-004"], linkedRegulations:["reg-cma"] } },
    { id:"ctrl-002", title:"سياسة وإجراءات تضارب المصالح",    owner:"CGO",           data:{ code:"C-002", controlType:"preventive",  mode:"manual",    frequency:"annual",       effectiveness:70, lastTestedAt:"2024-10-01" }, extra:{ priority:"high",     riskLevel:"high", linkedRisks:["risk-001"], linkedRegulations:["reg-cma"] } },
    { id:"ctrl-003", title:"إدارة الهوية والوصول IAM",          owner:"CISO",          data:{ code:"C-003", controlType:"preventive",  mode:"automated", frequency:"continuous",   effectiveness:92, lastTestedAt:"2025-03-01" }, extra:{ priority:"critical", riskLevel:"critical", linkedRisks:["risk-002"], linkedRegulations:["reg-nca","reg-pdpl"] } },
    { id:"ctrl-004", title:"تشفير البيانات الحساسة (AES-256)", owner:"CISO",          data:{ code:"C-004", controlType:"preventive",  mode:"automated", frequency:"continuous",   effectiveness:88, lastTestedAt:"2025-02-15" }, extra:{ priority:"critical", riskLevel:"critical", linkedRisks:["risk-002"], linkedRegulations:["reg-pdpl"] } },
    { id:"ctrl-005", title:"التحقق من هوية العملاء KYC/CDD",   owner:"CCO",           data:{ code:"C-005", controlType:"preventive",  mode:"manual",    frequency:"per_client",   effectiveness:76, lastTestedAt:"2025-01-01" }, extra:{ priority:"critical", riskLevel:"critical", linkedRisks:["risk-003"], linkedRegulations:["reg-fatf"] } },
    { id:"ctrl-006", title:"مراقبة المعاملات المشبوهة STM",    owner:"CCO",           data:{ code:"C-006", controlType:"detective",   mode:"automated", frequency:"continuous",   effectiveness:81, lastTestedAt:"2025-03-01" }, extra:{ priority:"critical", riskLevel:"critical", linkedRisks:["risk-003"], linkedRegulations:["reg-fatf"] } },
    { id:"ctrl-007", title:"تقارير مجلس الإدارة الربعية",      owner:"CGO",           data:{ code:"C-007", controlType:"directive",   mode:"manual",    frequency:"quarterly",    effectiveness:65, lastTestedAt:"2025-01-15" }, extra:{ priority:"high",     riskLevel:"high", linkedRisks:["risk-004"], linkedRegulations:["reg-cma"] } },
    { id:"ctrl-008", title:"تقييم المخاطر للقرارات الاستراتيجية",owner:"CRO",         data:{ code:"C-008", controlType:"preventive",  mode:"manual",    frequency:"per_decision", effectiveness:72, lastTestedAt:"2024-12-01" }, extra:{ priority:"high",     riskLevel:"high", linkedRisks:["risk-004"] } },
    { id:"ctrl-009", title:"الفصل بين المهام SoD",              owner:"CAE",           data:{ code:"C-009", controlType:"preventive",  mode:"manual",    frequency:"annual",       effectiveness:55, lastTestedAt:"2024-09-01" }, extra:{ priority:"critical", riskLevel:"high", linkedRisks:["risk-005"] } },
    { id:"ctrl-010", title:"خطة استمرارية الأعمال BCP/DRP",    owner:"COO",           data:{ code:"C-010", controlType:"corrective",  mode:"manual",    frequency:"annual",       effectiveness:78, lastTestedAt:"2024-11-01" }, extra:{ priority:"high",     riskLevel:"high", linkedRisks:["risk-006"], linkedRegulations:["reg-nca"] } },
    { id:"ctrl-011", title:"مراجعة الالتزامات الضريبية",       owner:"CFO",           data:{ code:"C-011", controlType:"detective",   mode:"manual",    frequency:"monthly",      effectiveness:90, lastTestedAt:"2025-03-01" }, extra:{ priority:"medium",   riskLevel:"medium", linkedRisks:["risk-007"], linkedRegulations:["reg-zatca"] } },
    { id:"ctrl-012", title:"مراجعة مخرجات الذكاء الاصطناعي",  owner:"CTO",           data:{ code:"C-012", controlType:"detective",   mode:"manual",    frequency:"per_output",   effectiveness:60, lastTestedAt:"2025-02-01" }, extra:{ priority:"high",     riskLevel:"high", linkedRisks:["risk-008"] } },
  ];
  for (const c of controls) {
    await upsertEntity(c.id, "control", c.title, c.owner, c.data, { ...c.extra, tags:["control",c.data["controlType"] as string, c.data["mode"] as string] });
  }
  console.log(`✓ ${controls.length} controls`);

  // ── Compliance Obligations ────────────────────────────────────
  const obligations = [
    { id:"ob-001", title:"الإفصاح الفوري عن تضارب المصالح",       owner:"CGO",  data:{ code:"OB-001", regulationCode:"CMA-GOV-2023", articleRef:"م.71", frequency:"مستمر",      complianceScore:45, penalty:"SAR 500K",   nonCompliant:true  }, extra:{ status:"active", priority:"critical", riskLevel:"critical", linkedRegulations:["reg-cma"], linkedControls:["ctrl-001","ctrl-002"], linkedRisks:["risk-001"] } },
    { id:"ob-002", title:"تعيين مسؤول حماية البيانات DPO",         owner:"CTO",  data:{ code:"OB-002", regulationCode:"PDPL-2021",    articleRef:"م.32", frequency:"سنوي",       complianceScore:60, penalty:"SAR 3M",     nonCompliant:false }, extra:{ status:"in_progress", priority:"high", riskLevel:"high", linkedRegulations:["reg-pdpl"], linkedRisks:["risk-002"] } },
    { id:"ob-003", title:"تقديم الإقرار الضريبي الربعي",           owner:"CFO",  data:{ code:"OB-003", regulationCode:"ZATCA-VAT",    articleRef:"م.15", frequency:"ربعي",       complianceScore:92, penalty:"غرامة 5-25%",nonCompliant:false }, extra:{ status:"active", priority:"medium", riskLevel:"low", linkedRegulations:["reg-zatca"], linkedControls:["ctrl-011"], linkedRisks:["risk-007"] } },
    { id:"ob-004", title:"تقرير الامتثال السنوي للأمن السيبراني NCA",owner:"CISO",data:{ code:"OB-004", regulationCode:"NCA-ECC",    articleRef:"م.8",  frequency:"سنوي",       complianceScore:70, penalty:"SAR 2M",     nonCompliant:false }, extra:{ status:"in_progress", priority:"high", riskLevel:"high", linkedRegulations:["reg-nca"], linkedControls:["ctrl-003","ctrl-004"], linkedRisks:["risk-002"] } },
    { id:"ob-005", title:"تطبيق متطلبات EDD للعملاء عالي المخاطر", owner:"CCO",  data:{ code:"OB-005", regulationCode:"FATF-2023",   articleRef:"Rec.10",frequency:"مستمر",     complianceScore:40, penalty:"قوائم سوداء",nonCompliant:true  }, extra:{ status:"active", priority:"critical", riskLevel:"critical", linkedRegulations:["reg-fatf"], linkedControls:["ctrl-005","ctrl-006"], linkedRisks:["risk-003"] } },
  ];
  for (const o of obligations) {
    await upsertEntity(o.id, "compliance_obligation", o.title, o.owner, o.data, { ...o.extra, tags:["obligation","compliance"] });
  }
  console.log(`✓ ${obligations.length} compliance obligations`);

  // ── Evidence ──────────────────────────────────────────────────
  const evidence = [
    { id:"ev-001", title:"وثيقة سياسة تضارب المصالح v1.0",       owner:"CGO",  data:{ code:"EV-001", sourceType:"document",        hash:"sha256:a1b2c3d4e5f6g7h8i9j0", integrityStatus:"verified", legalHold:false, confidenceScore:91.5, expiryDate:"2026-03-10" }, extra:{ linkedRisks:["risk-001"], confidentiality:"confidential" } },
    { id:"ev-002", title:"مراجعة مستندات PDPL",                    owner:"CTO",  data:{ code:"EV-002", sourceType:"document",        hash:"sha256:b2c3d4e5f6g7h8i9j0k1", integrityStatus:"verified", legalHold:false, confidenceScore:88.2, expiryDate:"2026-03-12" }, extra:{ linkedRisks:["risk-002"], confidentiality:"confidential" } },
    { id:"ev-003", title:"سجل إجراءات KYC EDD",                    owner:"CCO",  data:{ code:"EV-003", sourceType:"process_log",     hash:"sha256:c3d4e5f6g7h8i9j0k1l2", integrityStatus:"verified", legalHold:false, confidenceScore:74.3, expiryDate:"2025-12-31" }, extra:{ linkedRisks:["risk-003"], confidentiality:"restricted" } },
    { id:"ev-004", title:"تقارير مجلس الإدارة الربعية Q4-2024",   owner:"CGO",  data:{ code:"EV-004", sourceType:"board_resolution", hash:"sha256:d4e5f6g7h8i9j0k1l2m3", integrityStatus:"verified", legalHold:false, confidenceScore:85.7, expiryDate:"2026-02-20" }, extra:{ linkedRisks:["risk-004"], confidentiality:"confidential" } },
    { id:"ev-005", title:"تقييم إطار حوكمة الذكاء الاصطناعي",    owner:"CTO",  data:{ code:"EV-005", sourceType:"policy",          hash:"sha256:e5f6g7h8i9j0k1l2m3n4", integrityStatus:"pending",  legalHold:false, confidenceScore:79.1, expiryDate:"2025-09-15" }, extra:{ linkedRisks:["risk-008"], confidentiality:"confidential" } },
    { id:"ev-006", title:"سجل صلاحيات النظام المالي — Legal Hold", owner:"CAE",  data:{ code:"EV-006", sourceType:"system_log",      hash:"sha256:f6g7h8i9j0k1l2m3n4o5", integrityStatus:"verified", legalHold:true,  confidenceScore:93.2, expiryDate:"2026-03-14" }, extra:{ linkedRisks:["risk-005"], confidentiality:"highly_confidential" } },
    { id:"ev-007", title:"قرار تشكيل لجنة المراجعة المستقلة",     owner:"CGO",  data:{ code:"EV-007", sourceType:"board_resolution", hash:"sha256:g7h8i9j0k1l2m3n4o5p6", integrityStatus:"verified", legalHold:false, confidenceScore:96.1, expiryDate:"2026-01-20" }, extra:{ linkedRisks:["risk-001"], confidentiality:"confidential" } },
  ];
  for (const e of evidence) {
    await upsertEntity(e.id, "evidence", e.title, e.owner, e.data, { ...e.extra, status:"active", priority:"high", riskLevel:"high", tags:["evidence",e.data["sourceType"] as string] });
  }
  console.log(`✓ ${evidence.length} evidence items`);

  // ── Audit Findings ────────────────────────────────────────────
  const findings = [
    { id:"find-001", title:"غياب سياسة تضارب المصالح الصريحة",        owner:"CAE", data:{ code:"F-001", findingType:"gap",      regulationRef:"م.71 — CMA-GOV-2023", severity:"critical", requiresHumanReview:false, remediationDays:21, confidenceScore:91.5, reviewStatus:"under_review" }, extra:{ linkedEvidence:["ev-001"], linkedControls:["ctrl-002"], linkedRisks:["risk-001"], linkedCAPAs:["capa-001"], priority:"critical", riskLevel:"critical", confidentiality:"confidential" } },
    { id:"find-002", title:"قصور متطلبات PDPL في وثائق الخصوصية",     owner:"CAE", data:{ code:"F-002", findingType:"gap",      regulationRef:"المادة 4 — PDPL-2021",  severity:"critical", requiresHumanReview:false, remediationDays:14, confidenceScore:88.2, reviewStatus:"active"       }, extra:{ linkedEvidence:["ev-002"], linkedControls:["ctrl-003"], linkedRisks:["risk-002"], linkedCAPAs:["capa-002"], priority:"critical", riskLevel:"critical" } },
    { id:"find-003", title:"ضعف ضوابط KYC للعملاء عالي المخاطر",      owner:"CAE", data:{ code:"F-003", findingType:"weakness", regulationRef:"FATF-2023 Rec.10",      severity:"critical", requiresHumanReview:true,  remediationDays:45, confidenceScore:74.3, reviewStatus:"active"       }, extra:{ linkedEvidence:["ev-003"], linkedControls:["ctrl-005"], linkedRisks:["risk-003"], linkedCAPAs:["capa-003"], priority:"critical", riskLevel:"critical" } },
    { id:"find-004", title:"غياب تقييم مخاطر الذكاء الاصطناعي",       owner:"CAE", data:{ code:"F-004", findingType:"gap",      regulationRef:"PDPL-2021/NCA-ECC",     severity:"high",     requiresHumanReview:true,  remediationDays:60, confidenceScore:79.1, reviewStatus:"active"       }, extra:{ linkedEvidence:["ev-005"], linkedControls:["ctrl-012"], linkedRisks:["risk-008"], linkedCAPAs:["capa-004"], priority:"high", riskLevel:"high" } },
    { id:"find-005", title:"ضعف الفصل بين المهام في العمليات المالية", owner:"CAE", data:{ code:"F-005", findingType:"weakness", regulationRef:"COSO-ERM",              severity:"high",     requiresHumanReview:false, remediationDays:21, confidenceScore:93.2, reviewStatus:"active"       }, extra:{ linkedEvidence:["ev-006"], linkedControls:["ctrl-009"], linkedRisks:["risk-005"], linkedCAPAs:["capa-005"], priority:"critical", riskLevel:"high" } },
    { id:"find-006", title:"استيفاء متطلبات لجنة المراجعة ✓",          owner:"CAE", data:{ code:"F-006", findingType:"positive", regulationRef:"م.53 — CMA-GOV-2023",  severity:"info",     requiresHumanReview:false, remediationDays:0,  confidenceScore:96.1, reviewStatus:"approved"     }, extra:{ linkedEvidence:["ev-007"], linkedControls:["ctrl-001"], priority:"low", riskLevel:"info", confidentiality:"internal" } },
  ];
  for (const f of findings) {
    await upsertEntity(f.id, "audit_finding", f.title, f.owner, f.data, { ...f.extra, tags:["finding",f.data["findingType"] as string] });
  }
  console.log(`✓ ${findings.length} audit findings`);

  // ── CAPAs ─────────────────────────────────────────────────────
  const capas = [
    { id:"capa-001", title:"تطوير وتحديث سياسة تضارب المصالح",     owner:"CGO",  data:{ code:"CAPA-001", findingId:"find-001", rootCause:"غياب مراجعة السياسات بعد تعديل لائحة CMA",            expectedImpact:"خفض R-001 من 20→10", escalationLevel:1, overdueFlag:false, dueDate:"2025-04-10" }, extra:{ status:"in_progress", priority:"critical", riskLevel:"high", linkedFindings:["find-001"] } },
    { id:"capa-002", title:"تحديث وثائق الخصوصية لمتطلبات PDPL",   owner:"CCO",  data:{ code:"CAPA-002", findingId:"find-002", rootCause:"غياب متابعة منهجية لإصدارات PDPL",                   expectedImpact:"إغلاق F-002",        escalationLevel:1, overdueFlag:false, dueDate:"2025-04-01" }, extra:{ status:"in_progress", priority:"critical", riskLevel:"high", linkedFindings:["find-002"] } },
    { id:"capa-003", title:"تفعيل إجراءات EDD العاجلة",             owner:"CCO",  data:{ code:"CAPA-003", findingId:"find-003", rootCause:"نقص الموارد المؤهلة في فريق AML",                    expectedImpact:"خفض R-003 من 15→7", escalationLevel:2, overdueFlag:true,  dueDate:"2025-03-31" }, extra:{ status:"overdue",     priority:"critical", riskLevel:"critical", linkedFindings:["find-003"] } },
    { id:"capa-004", title:"بناء إطار حوكمة الذكاء الاصطناعي",     owner:"CTO",  data:{ code:"CAPA-004", findingId:"find-004", rootCause:"غياب سياسة واضحة لاستخدام الذكاء الاصطناعي في المنظمة",expectedImpact:"خفض R-008 من 12→5",escalationLevel:1, overdueFlag:false, dueDate:"2025-06-01" }, extra:{ status:"draft",       priority:"high",     riskLevel:"high",     linkedFindings:["find-004"] } },
    { id:"capa-005", title:"إعادة هيكلة صلاحيات النظام المالي",    owner:"CAE",  data:{ code:"CAPA-005", findingId:"find-005", rootCause:"غياب مراجعة دورية للصلاحيات بعد التحديثات البرمجية",  expectedImpact:"إلغاء R-005",        escalationLevel:1, overdueFlag:false, dueDate:"2025-04-05" }, extra:{ status:"draft",       priority:"critical", riskLevel:"high",     linkedFindings:["find-005"] } },
  ];
  for (const c of capas) {
    await upsertEntity(c.id, "capa", c.title, c.owner, c.data, { ...c.extra, tags:["capa","remediation"] });
  }
  console.log(`✓ ${capas.length} CAPAs`);

  // ── Decisions ─────────────────────────────────────────────────
  const decisions = [
    { id:"dec-001", title:"اعتماد إطار حوكمة الذكاء الاصطناعي",        owner:"CGO", data:{ code:"DEC-001", decisionType:"strategic", decidedBy:"مجلس الإدارة", decisionBody:"مجلس الإدارة", status:"approved",   confidenceScore:82, riskImpact:"خفض R-008" }, extra:{ linkedEvidence:["ev-005","ev-007"], linkedRisks:["risk-008"], linkedCAPAs:["capa-004"], priority:"critical", riskLevel:"high" } },
    { id:"dec-002", title:"إعادة هيكلة فورية لصلاحيات النظام المالي",  owner:"CGO", data:{ code:"DEC-002", decisionType:"operational", decidedBy:"CAE", decisionBody:"لجنة التدقيق",    status:"approved",   confidenceScore:93, riskImpact:"إلغاء R-005" }, extra:{ linkedEvidence:["ev-006"], linkedRisks:["risk-005"], linkedCAPAs:["capa-005"], priority:"critical", riskLevel:"high" } },
    { id:"dec-003", title:"تعليق اتفاقية JV لمراجعة قانونية",           owner:"CLO", data:{ code:"DEC-003", decisionType:"legal",      decidedBy:"مجلس الإدارة", decisionBody:"مجلس الإدارة", status:"in_progress",confidenceScore:72, riskImpact:"تخفيف مخاطر قانونية" }, extra:{ linkedEvidence:["ev-001"], linkedRisks:["risk-001"], priority:"high", riskLevel:"high" } },
  ];
  for (const d of decisions) {
    await upsertEntity(d.id, "decision", d.title, d.owner, d.data, { ...d.extra, tags:["decision","governance"] });
  }
  console.log(`✓ ${decisions.length} decisions`);

  // ── Graph Edges — wiring the Knowledge Graph ──────────────────
  console.log("\nWiring Knowledge Graph edges...");
  const edges: Array<[string, string, string, string, string, number]> = [
    // Regulation → Policy
    ["reg-cma","regulation","pol-001","policy","governs",4],
    ["reg-cma","regulation","pol-004","policy","governs",4],
    ["reg-pdpl","regulation","pol-002","policy","governs",4],
    ["reg-fatf","regulation","pol-003","policy","governs",4],
    ["reg-nca","regulation","pol-005","policy","governs",4],
    // Regulation → Obligation
    ["reg-cma","regulation","ob-001","compliance_obligation","creates_obligation",5],
    ["reg-pdpl","regulation","ob-002","compliance_obligation","creates_obligation",5],
    ["reg-zatca","regulation","ob-003","compliance_obligation","creates_obligation",5],
    ["reg-nca","regulation","ob-004","compliance_obligation","creates_obligation",5],
    ["reg-fatf","regulation","ob-005","compliance_obligation","creates_obligation",5],
    // Control → Risk (mitigates)
    ["ctrl-001","control","risk-001","risk","mitigates",4],
    ["ctrl-002","control","risk-001","risk","mitigates",3],
    ["ctrl-003","control","risk-002","risk","mitigates",5],
    ["ctrl-004","control","risk-002","risk","mitigates",4],
    ["ctrl-005","control","risk-003","risk","mitigates",4],
    ["ctrl-006","control","risk-003","risk","mitigates",4],
    ["ctrl-009","control","risk-005","risk","mitigates",3],
    ["ctrl-012","control","risk-008","risk","mitigates",3],
    // Obligation → Control (addressed_by)
    ["ob-001","compliance_obligation","ctrl-001","control","addresses",5],
    ["ob-001","compliance_obligation","ctrl-002","control","addresses",4],
    ["ob-005","compliance_obligation","ctrl-005","control","addresses",5],
    ["ob-005","compliance_obligation","ctrl-006","control","addresses",4],
    // Evidence → Finding (supports)
    ["ev-001","evidence","find-001","audit_finding","supports",5],
    ["ev-002","evidence","find-002","audit_finding","supports",5],
    ["ev-003","evidence","find-003","audit_finding","supports",4],
    ["ev-005","evidence","find-004","audit_finding","supports",4],
    ["ev-006","evidence","find-005","audit_finding","supports",5],
    ["ev-007","evidence","find-006","audit_finding","supports",5],
    // Finding → Risk
    ["find-001","audit_finding","risk-001","risk","creates_risk",4],
    ["find-002","audit_finding","risk-002","risk","creates_risk",3],
    ["find-003","audit_finding","risk-003","risk","creates_risk",5],
    // Finding → CAPA
    ["find-001","audit_finding","capa-001","capa","triggers",5],
    ["find-002","audit_finding","capa-002","capa","triggers",5],
    ["find-003","audit_finding","capa-003","capa","triggers",5],
    ["find-004","audit_finding","capa-004","capa","triggers",4],
    ["find-005","audit_finding","capa-005","capa","triggers",4],
    // Decision → Entity
    ["dec-001","decision","capa-004","capa","drives",4],
    ["dec-002","decision","capa-005","capa","drives",5],
  ];

  for (const [fromId, fromType, toId, toType, rel, weight] of edges) {
    await upsertEdge(fromId, fromType, toId, toType, rel, weight);
  }
  console.log(`✓ ${edges.length} graph edges`);

  // ── Audit log ─────────────────────────────────────────────────
  await q(
    `INSERT INTO "AuditLog" (id, action, "performedBy", role, "traceId", "tenantId", "newValue")
     VALUES ($1,'system.seed_completed','system','system',$2,$3,$4)
     ON CONFLICT (id) DO NOTHING`,
    [uuidv4(), uuidv4(), TENANT_ID, JSON.stringify({ seededAt: new Date().toISOString(), version:"realistic-v2" })],
  );

  console.log("\n╔══════════════════════════════════════════════════╗");
  console.log("║  ✅ Seed complete — Governance universe ready   ║");
  console.log("╠══════════════════════════════════════════════════╣");
  console.log("║  API:   http://localhost:4000                   ║");
  console.log("║  Login: cgo@demo.sgip / Demo@1234              ║");
  console.log("╚══════════════════════════════════════════════════╝");

  await pool.end();
}

main().catch(e => { console.error("Seed failed:", e); process.exit(1); });
