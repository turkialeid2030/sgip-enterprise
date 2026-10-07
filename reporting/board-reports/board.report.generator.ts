/**
 * Board Report Generator — Pilot Enhancement
 *
 * Generates a board-ready governance report as self-contained HTML (print-to-PDF
 * ready, RTL/LTR aware). Pulls from cockpit-style inputs and embeds the Data
 * Maturity Index + Decision Confidence explanation so the board sees provenance
 * and reasoning, not just numbers.
 *
 * Additive module: does not modify any frozen runtime.
 */

export interface BoardReportInput {
  tenantId:        string;
  organizationName:string;
  locale:          "ar" | "en";
  period:          string;          // e.g. "Q2 2026"
  governanceScore: number;
  complianceScore: number;
  riskExposure:    number;
  openRisks:       number;
  confidenceIndex: number;
  dataMaturity?:   { automatedRatio: number; manualCount: number; maturityStage: string };
  confidenceNarrative?: string;
  topActions:      string[];
}

const L = {
  ar: {
    title: "تقرير الحوكمة لمجلس الإدارة", org: "المنشأة", period: "الفترة", generated: "تاريخ الإصدار",
    summary: "الملخص التنفيذي", govScore: "درجة الحوكمة", complScore: "درجة الامتثال",
    riskExp: "التعرّض للمخاطر", openRisks: "المخاطر المفتوحة", confidence: "مؤشر ثقة القرار",
    maturity: "نضج البيانات", automated: "آلية", manual: "يدوية", stage: "المرحلة",
    reasoning: "تفسير ثقة القرار", actions: "الإجراءات الفورية المطلوبة",
    confidential: "وثيقة سرية — لأعضاء مجلس الإدارة فقط",
    footer: "منصة الحوكمة السيادية SGIP · مُولّد آلياً",
  },
  en: {
    title: "Board Governance Report", org: "Organization", period: "Period", generated: "Generated",
    summary: "Executive Summary", govScore: "Governance Score", complScore: "Compliance Score",
    riskExp: "Risk Exposure", openRisks: "Open Risks", confidence: "Decision Confidence Index",
    maturity: "Data Maturity", automated: "Automated", manual: "Manual", stage: "Stage",
    reasoning: "Decision Confidence Reasoning", actions: "Immediate Actions Required",
    confidential: "CONFIDENTIAL — Board Members Only",
    footer: "SGIP Sovereign GRC OS · Auto-generated",
  },
};

export class BoardReportGenerator {
  /** Generate a self-contained, print-ready bilingual HTML report. */
  generate(input: BoardReportInput): string {
    const t = L[input.locale];
    const dir = input.locale === "ar" ? "rtl" : "ltr";
    const font = input.locale === "ar"
      ? "'Segoe UI', 'Tahoma', sans-serif"
      : "'Segoe UI', 'Helvetica', sans-serif";
    const now = new Date().toLocaleDateString(input.locale === "ar" ? "ar-SA" : "en-US");

    const scoreColor = (v: number) => v >= 80 ? "#18b048" : v >= 60 ? "#e88c08" : "#e03838";

    const maturityBlock = input.dataMaturity ? `
      <div class="card">
        <h3>${t.maturity}</h3>
        <table>
          <tr><td>${t.automated}</td><td><strong>${input.dataMaturity.automatedRatio}%</strong></td></tr>
          <tr><td>${t.manual}</td><td>${input.dataMaturity.manualCount}</td></tr>
          <tr><td>${t.stage}</td><td>${input.dataMaturity.maturityStage}</td></tr>
        </table>
      </div>` : "";

    const reasoningBlock = input.confidenceNarrative ? `
      <div class="card">
        <h3>${t.reasoning}</h3>
        <p class="narrative">${this.escape(input.confidenceNarrative)}</p>
      </div>` : "";

    const actionsHtml = input.topActions.map(a => `<li>${this.escape(a)}</li>`).join("");

    return `<!doctype html>
<html lang="${input.locale}" dir="${dir}">
<head>
<meta charset="utf-8"/>
<title>${t.title} — ${this.escape(input.organizationName)}</title>
<style>
  @page { size: A4; margin: 18mm; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: ${font}; color: #1a1d28; line-height: 1.6; direction: ${dir}; }
  .header { border-bottom: 3px solid #1e52cc; padding-bottom: 14px; margin-bottom: 20px; }
  .header h1 { font-size: 22px; color: #1e52cc; }
  .header .meta { font-size: 12px; color: #666; margin-top: 6px; }
  .confidential { background: #fff4e5; border: 1px solid #e88c08; color: #a85800; padding: 6px 12px; font-size: 11px; font-weight: 600; border-radius: 4px; display: inline-block; margin-bottom: 16px; }
  .grid { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 12px; margin-bottom: 20px; }
  .metric { border: 1px solid #e0e3eb; border-radius: 8px; padding: 14px; text-align: center; }
  .metric .label { font-size: 11px; color: #666; text-transform: uppercase; letter-spacing: .5px; }
  .metric .value { font-size: 30px; font-weight: 700; margin-top: 6px; }
  .card { border: 1px solid #e0e3eb; border-radius: 8px; padding: 16px; margin-bottom: 16px; }
  .card h3 { font-size: 14px; color: #1e52cc; margin-bottom: 10px; }
  .card table { width: 100%; border-collapse: collapse; }
  .card td { padding: 5px 0; border-bottom: 1px solid #f0f1f5; font-size: 13px; }
  .narrative { font-size: 13px; color: #333; border-${dir === "rtl" ? "right" : "left"}: 3px solid #1e52cc; padding-${dir === "rtl" ? "right" : "left"}: 12px; }
  ul { padding-${dir === "rtl" ? "right" : "left"}: 20px; }
  li { font-size: 13px; margin-bottom: 6px; }
  .footer { margin-top: 30px; padding-top: 12px; border-top: 1px solid #e0e3eb; font-size: 10px; color: #999; text-align: center; }
</style>
</head>
<body>
  <div class="header">
    <h1>${t.title}</h1>
    <div class="meta">
      ${t.org}: <strong>${this.escape(input.organizationName)}</strong> &nbsp;·&nbsp;
      ${t.period}: ${this.escape(input.period)} &nbsp;·&nbsp;
      ${t.generated}: ${now}
    </div>
  </div>

  <span class="confidential">${t.confidential}</span>

  <h2 style="font-size:16px;margin-bottom:12px;">${t.summary}</h2>
  <div class="grid">
    <div class="metric"><div class="label">${t.govScore}</div><div class="value" style="color:${scoreColor(input.governanceScore)}">${input.governanceScore}</div></div>
    <div class="metric"><div class="label">${t.complScore}</div><div class="value" style="color:${scoreColor(input.complianceScore)}">${input.complianceScore}%</div></div>
    <div class="metric"><div class="label">${t.confidence}</div><div class="value" style="color:${scoreColor(input.confidenceIndex)}">${input.confidenceIndex}%</div></div>
    <div class="metric"><div class="label">${t.riskExp}</div><div class="value" style="color:${scoreColor(100 - input.riskExposure)}">${input.riskExposure}%</div></div>
    <div class="metric"><div class="label">${t.openRisks}</div><div class="value">${input.openRisks}</div></div>
  </div>

  ${maturityBlock}
  ${reasoningBlock}

  <div class="card">
    <h3>${t.actions}</h3>
    <ul>${actionsHtml}</ul>
  </div>

  <div class="footer">${t.footer} · ${now}</div>
</body>
</html>`;
  }

  private escape(s: string): string {
    return String(s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }
}

let _gen: BoardReportGenerator | null = null;
export function getBoardReportGenerator(): BoardReportGenerator {
  if (!_gen) _gen = new BoardReportGenerator();
  return _gen;
}
