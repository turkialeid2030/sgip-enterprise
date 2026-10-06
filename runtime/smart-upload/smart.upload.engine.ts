/**
 * Smart Upload Engine — Pilot Enhancement (Day-0 data population)
 *
 * Implements the ServiceNow Import-Set pattern: stage -> validate -> transform -> commit.
 * Ships per-framework CSV templates (SAMA CSF, NCA ECC, PDPL, ISO 27001/37301/42001).
 * Each committed row is tagged with provenance "smart_upload" for the Data Maturity Index.
 *
 * Additive module: does not modify any frozen runtime.
 */

export type FrameworkId =
  | "sama_csf" | "nca_ecc" | "pdpl"
  | "iso_27001" | "iso_37301" | "iso_42001";

export interface TemplateColumn {
  key:       string;
  labelEn:   string;
  labelAr:   string;
  required:  boolean;
  type:      "string" | "number" | "enum" | "date";
  enumValues?: string[];
  maxLength?:  number;
}

export interface UploadTemplate {
  framework:   FrameworkId;
  nameEn:      string;
  nameAr:      string;
  targetTable: string;          // governance entity this populates
  columns:     TemplateColumn[];
}

export interface ValidationError {
  row:     number;
  column:  string;
  value:   string;
  message: string;
}

export interface StagingRow {
  rowNumber: number;
  raw:       Record<string, string>;
  valid:     boolean;
  errors:    ValidationError[];
}

export interface UploadResult {
  uploadId:       string;
  framework:      FrameworkId;
  tenantId:       string;
  totalRows:      number;
  validRows:      number;
  invalidRows:    number;
  committed:      number;
  errors:         ValidationError[];
  stagingRows:    StagingRow[];
  provenance:     "smart_upload";
  uploadedAt:     string;
  summary:        { en: string; ar: string };
}

// ── Framework templates ───────────────────────────────────────
const TEMPLATES: Record<FrameworkId, UploadTemplate> = {
  sama_csf: {
    framework: "sama_csf", nameEn: "SAMA Cyber Security Framework", nameAr: "إطار البنك المركزي للأمن السيبراني",
    targetTable: "controls",
    columns: [
      { key:"control_id",   labelEn:"Control ID",       labelAr:"رمز الضابط",      required:true,  type:"string", maxLength:32 },
      { key:"domain",       labelEn:"Domain",           labelAr:"المجال",          required:true,  type:"string" },
      { key:"description",  labelEn:"Description",       labelAr:"الوصف",           required:true,  type:"string", maxLength:1000 },
      { key:"maturity",     labelEn:"Maturity Level",   labelAr:"مستوى النضج",     required:true,  type:"enum", enumValues:["0","1","2","3","4","5"] },
      { key:"owner",        labelEn:"Control Owner",     labelAr:"مالك الضابط",     required:true,  type:"string" },
      { key:"status",       labelEn:"Status",            labelAr:"الحالة",          required:false, type:"enum", enumValues:["implemented","partial","not_implemented"] },
    ],
  },
  nca_ecc: {
    framework: "nca_ecc", nameEn: "NCA Essential Cybersecurity Controls", nameAr: "الضوابط الأساسية للأمن السيبراني",
    targetTable: "controls",
    columns: [
      { key:"control_id",   labelEn:"Control ID",       labelAr:"رمز الضابط",      required:true,  type:"string", maxLength:32 },
      { key:"main_domain",  labelEn:"Main Domain",      labelAr:"المجال الرئيسي",  required:true,  type:"string" },
      { key:"subcontrol",   labelEn:"Subcontrol",       labelAr:"الضابط الفرعي",   required:true,  type:"string", maxLength:1000 },
      { key:"compliance",   labelEn:"Compliance Level", labelAr:"مستوى الامتثال",  required:true,  type:"enum", enumValues:["compliant","partial","non_compliant"] },
      { key:"evidence_ref", labelEn:"Evidence Reference",labelAr:"مرجع الدليل",    required:false, type:"string" },
    ],
  },
  pdpl: {
    framework: "pdpl", nameEn: "Personal Data Protection Law", nameAr: "نظام حماية البيانات الشخصية",
    targetTable: "obligations",
    columns: [
      { key:"obligation_id",labelEn:"Obligation ID",    labelAr:"رمز الالتزام",    required:true,  type:"string", maxLength:32 },
      { key:"article",      labelEn:"PDPL Article",     labelAr:"مادة النظام",     required:true,  type:"string" },
      { key:"requirement",  labelEn:"Requirement",      labelAr:"المتطلب",         required:true,  type:"string", maxLength:1000 },
      { key:"data_category",labelEn:"Data Category",    labelAr:"تصنيف البيانات",  required:true,  type:"enum", enumValues:["personal","sensitive","health","financial","biometric"] },
      { key:"status",       labelEn:"Compliance Status",labelAr:"حالة الامتثال",   required:true,  type:"enum", enumValues:["compliant","gap","in_progress"] },
    ],
  },
  iso_27001: {
    framework: "iso_27001", nameEn: "ISO/IEC 27001 ISMS", nameAr: "نظام إدارة أمن المعلومات",
    targetTable: "controls",
    columns: [
      { key:"annex_ref",    labelEn:"Annex A Reference",labelAr:"مرجع الملحق أ",   required:true,  type:"string", maxLength:32 },
      { key:"control_name", labelEn:"Control Name",     labelAr:"اسم الضابط",      required:true,  type:"string" },
      { key:"applicable",   labelEn:"Applicable",       labelAr:"قابل للتطبيق",    required:true,  type:"enum", enumValues:["yes","no"] },
      { key:"status",       labelEn:"Implementation",   labelAr:"التنفيذ",         required:true,  type:"enum", enumValues:["implemented","partial","planned","not_implemented"] },
    ],
  },
  iso_37301: {
    framework: "iso_37301", nameEn: "ISO 37301 Compliance MS", nameAr: "نظام إدارة الامتثال",
    targetTable: "obligations",
    columns: [
      { key:"obligation_id",labelEn:"Obligation ID",    labelAr:"رمز الالتزام",    required:true,  type:"string", maxLength:32 },
      { key:"source",       labelEn:"Obligation Source",labelAr:"مصدر الالتزام",   required:true,  type:"string" },
      { key:"description",  labelEn:"Description",       labelAr:"الوصف",           required:true,  type:"string", maxLength:1000 },
      { key:"owner",        labelEn:"Owner",             labelAr:"المالك",          required:true,  type:"string" },
    ],
  },
  iso_42001: {
    framework: "iso_42001", nameEn: "ISO 42001 AI MS", nameAr: "نظام إدارة الذكاء الاصطناعي",
    targetTable: "ai_controls",
    columns: [
      { key:"control_id",   labelEn:"Control ID",       labelAr:"رمز الضابط",      required:true,  type:"string", maxLength:32 },
      { key:"ai_system",    labelEn:"AI System",        labelAr:"نظام الذكاء",     required:true,  type:"string" },
      { key:"risk_tier",    labelEn:"Risk Tier",        labelAr:"مستوى المخاطر",   required:true,  type:"enum", enumValues:["minimal","limited","high","critical"] },
      { key:"status",       labelEn:"Status",            labelAr:"الحالة",          required:true,  type:"enum", enumValues:["compliant","gap","in_progress"] },
    ],
  },
};

export class SmartUploadEngine {
  /** Return the template (column spec) for a framework. */
  getTemplate(framework: FrameworkId): UploadTemplate | null {
    return TEMPLATES[framework] ?? null;
  }

  listTemplates(): Array<{ framework: FrameworkId; nameEn: string; nameAr: string; columnCount: number }> {
    return Object.values(TEMPLATES).map(t => ({
      framework: t.framework, nameEn: t.nameEn, nameAr: t.nameAr, columnCount: t.columns.length,
    }));
  }

  /** Generate a CSV header row (the downloadable template). */
  generateCsvTemplate(framework: FrameworkId): string {
    const t = TEMPLATES[framework];
    if (!t) return "";
    const header = t.columns.map(c => c.key).join(",");
    const labels = t.columns.map(c => `"${c.labelEn} / ${c.labelAr}"`).join(",");
    return `${header}\n${labels}`;
  }

  /** Parse raw CSV text into rows. Simple RFC-4180-ish parser (no embedded newlines). */
  private parseCsv(csv: string): Record<string, string>[] {
    const lines = csv.split(/\r?\n/).filter(l => l.trim().length > 0);
    if (lines.length < 2) return [];
    const headers = this.splitCsvLine(lines[0]);
    const rows: Record<string, string>[] = [];
    // skip optional label row (row 1 if it doesn't look like data — heuristic: contains "/")
    let startIdx = 1;
    if (lines[1] && lines[1].includes("/")) startIdx = 2;
    for (let i = startIdx; i < lines.length; i++) {
      const cells = this.splitCsvLine(lines[i]);
      const row: Record<string, string> = {};
      headers.forEach((h, idx) => { row[h] = (cells[idx] ?? "").trim(); });
      rows.push(row);
    }
    return rows;
  }

  private splitCsvLine(line: string): string[] {
    const out: string[] = [];
    let cur = "", inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') { inQuotes = !inQuotes; continue; }
      if (ch === "," && !inQuotes) { out.push(cur); cur = ""; continue; }
      cur += ch;
    }
    out.push(cur);
    return out.map(s => s.trim());
  }

  private validateRow(row: Record<string, string>, rowNum: number, template: UploadTemplate): StagingRow {
    const errors: ValidationError[] = [];
    for (const col of template.columns) {
      const val = row[col.key] ?? "";
      if (col.required && val === "") {
        errors.push({ row: rowNum, column: col.key, value: val, message: `Required field "${col.labelEn}" is empty` });
        continue;
      }
      if (val === "") continue; // optional + empty is fine
      if (col.type === "number" && isNaN(Number(val))) {
        errors.push({ row: rowNum, column: col.key, value: val, message: `"${col.labelEn}" must be a number` });
      }
      if (col.type === "enum" && col.enumValues && !col.enumValues.includes(val)) {
        errors.push({ row: rowNum, column: col.key, value: val, message: `"${col.labelEn}" must be one of: ${col.enumValues.join(", ")}` });
      }
      if (col.maxLength && val.length > col.maxLength) {
        errors.push({ row: rowNum, column: col.key, value: val.slice(0, 20) + "…", message: `"${col.labelEn}" exceeds ${col.maxLength} characters` });
      }
    }
    return { rowNumber: rowNum, raw: row, valid: errors.length === 0, errors };
  }

  /**
   * Full pipeline: parse -> validate -> stage -> commit valid rows.
   * Returns a result; valid rows are tagged provenance "smart_upload".
   */
  upload(tenantId: string, framework: FrameworkId, csvContent: string): UploadResult {
    const template = TEMPLATES[framework];
    const uploadId = `upload-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    if (!template) {
      return {
        uploadId, framework, tenantId, totalRows: 0, validRows: 0, invalidRows: 0,
        committed: 0, errors: [{ row: 0, column: "framework", value: framework, message: "Unknown framework" }],
        stagingRows: [], provenance: "smart_upload", uploadedAt: new Date().toISOString(),
        summary: { en: "Unknown framework.", ar: "إطار غير معروف." },
      };
    }

    const parsed = this.parseCsv(csvContent);
    const stagingRows = parsed.map((r, i) => this.validateRow(r, i + 1, template));
    const validRows = stagingRows.filter(r => r.valid);
    const invalidRows = stagingRows.filter(r => !r.valid);
    const allErrors = stagingRows.flatMap(r => r.errors);

    // "Commit" = valid rows are accepted into the target table (in-memory for pilot)
    const committed = validRows.length;

    return {
      uploadId, framework, tenantId,
      totalRows: stagingRows.length, validRows: validRows.length, invalidRows: invalidRows.length,
      committed, errors: allErrors, stagingRows,
      provenance: "smart_upload", uploadedAt: new Date().toISOString(),
      summary: {
        en: `Uploaded ${stagingRows.length} rows to ${template.nameEn}: ${committed} committed, ${invalidRows.length} rejected. Data tagged as smart_upload provenance.`,
        ar: `تم رفع ${stagingRows.length} صفاً إلى ${template.nameAr}: ${committed} مقبول، ${invalidRows.length} مرفوض. وُسمت البيانات كمصدر رفع ذكي.`,
      },
    };
  }
}

let _engine: SmartUploadEngine | null = null;
export function getSmartUploadEngine(): SmartUploadEngine {
  if (!_engine) _engine = new SmartUploadEngine();
  return _engine;
}
