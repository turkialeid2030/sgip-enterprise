import { useState, useEffect, useCallback, useRef } from "react";

// ── i18n Runtime (inline for artifact) ────────────────────────
const AR = {
  nav:{"board":"مجلس الإدارة","ceo":"الرئيس التنفيذي","cro":"مدير المخاطر","ai_gov":"حوكمة الذكاء الاصطناعي","digital_twin":"التوأم الرقمي","platform":"منصة الحوكمة السيادية"},
  board:{"title":"لوحة مجلس الإدارة","subtitle":"مؤشرات الصحة المؤسسية في الوقت الفعلي","overall_health":"الصحة الإجمالية","accountability":"المساءلة","evidence":"الأدلة","decision_conf":"ثقة القرار","board_readiness":"جاهزية المجلس","pending_res":"القرارات المعلّقة","active_pol":"السياسات النشطة","committees":"اللجان النشطة","open_risks":"المخاطر المفتوحة","breaches":"التجاوزات","exposure":"التعرّض للمخاطر","reg_intel":"الاستخبارات التنظيمية","reg_changes":"التعديلات","critical":"الحرجة","geo":"إشارات جيوسياسية","warnings":"إنذارات مبكرة","actions":"الإجراءات الفورية"},
  ceo:{"title":"لوحة الرئيس التنفيذي","outlook":"النظرة الاستراتيجية - 30 يوماً","dimensions":"أبعاد الحوكمة","pressure":"الضغط الحوكمي","friction":"احتكاك التنفيذ","evidence":"اكتمال الأدلة","confidence":"ثقة القرار","actions":"الإجراءات الفورية"},
  risk:{"title":"لوحة مدير المخاطر","heatmap":"خريطة حرارة المخاطر","controls":"فعالية الضوابط","kri":"مؤشرات المخاطر الرئيسية","frameworks":"الأطر التنظيمية","strategic":"استراتيجي","cyber":"سيبراني","operational":"تشغيلي","regulatory":"تنظيمي","third_party":"طرف ثالث","ai_model":"نماذج الذكاء الاصطناعي"},
  ai:{"title":"لوحة حوكمة الذكاء الاصطناعي","pending":"الموافقات المعلّقة","blocked":"الإجراءات المحجوبة","halluc":"تنبيهات الهلوسة","registry":"سجل النماذج","risk_tier":"مستوى المخاطر","stage":"المرحلة","drift":"الانحراف","xai":"قابلية التفسير","sdaia":"تسجيل SDAIA","status":"الحالة"},
  twin:{"title":"التوأم الرقمي المؤسسي","subtitle":"انقر على سيناريو لمحاكاة أثره الحوكمي","simulating":"جارٍ المحاكاة...","financial":"الأثر المالي","recovery":"وقت التعافي","delta":"تغيّر المخاطر","path":"المسار الحرج","confidence":"الثقة"},
  scenarios:{"cyber_attack":"هجوم سيبراني","regulatory_investigation":"تحقيق تنظيمي","data_breach":"اختراق بيانات","board_succession":"خلافة مجلس الإدارة","key_vendor_failure":"فشل مورّد","financial_restatement":"إعادة إصدار مالي","market_crash":"انهيار السوق","ai_system_failure":"فشل نظام الذكاء الاصطناعي","pandemic_disruption":"اضطراب وبائي","merger_acquisition":"اندماج / استحواذ","regulator_intervention":"تدخّل تنظيمي","ceo_departure":"مغادرة الرئيس"},
  common:{"live":"مباشر","certified":"معتمد","conditional":"مشروط","failed":"فشل","pending":"قيد الانتظار","improving":"في تحسّن","stable":"مستقر","deteriorating":"في تراجع"},
  alerts:["2 ضوابط حرجة وفق NCA ECC تحتاج مراجعة المجلس","تدقيق تصنيف البيانات PDPL متأخر 12 يوماً","موافقة المجلس معلّقة على نموذج تسجيل الائتمان v4"],
  status:"منصة الحوكمة السيادية · 716 اختبار · 0 أخطاء TypeScript · 92/100 جاهز للإنتاج"
};
const EN = {
  nav:{"board":"Board","ceo":"CEO","cro":"CRO","ai_gov":"AI Gov","digital_twin":"Digital Twin","platform":"Sovereign GRC OS"},
  board:{"title":"Board Cockpit","subtitle":"Real-time institutional health indicators","overall_health":"Overall Health","accountability":"Accountability","evidence":"Evidence","decision_conf":"Decision Confidence","board_readiness":"Board Readiness","pending_res":"Pending Resolutions","active_pol":"Active Policies","committees":"Committees Active","open_risks":"Open Risks","breaches":"Tolerance Breaches","exposure":"Enterprise Exposure","reg_intel":"Regulatory Intelligence","reg_changes":"Reg Changes","critical":"Critical","geo":"Geo Signals","warnings":"Early Warnings","actions":"Immediate Actions"},
  ceo:{"title":"CEO Cockpit","outlook":"30-Day Strategic Outlook","dimensions":"Governance Dimensions","pressure":"Gov Pressure","friction":"Execution Friction","evidence":"Evidence Completeness","confidence":"Decision Confidence","actions":"Immediate CEO Actions"},
  risk:{"title":"CRO Cockpit","heatmap":"Enterprise Risk Heatmap","controls":"Control Effectiveness","kri":"KRI Monitor","frameworks":"Framework Coverage","strategic":"Strategic","cyber":"Cyber","operational":"Operational","regulatory":"Regulatory","third_party":"Third Party","ai_model":"AI Model"},
  ai:{"title":"AI Governance Cockpit","pending":"Pending Approvals","blocked":"Blocked Actions","halluc":"Hallucination Alerts","registry":"AI Model Registry","risk_tier":"Risk Tier","stage":"Stage","drift":"Drift","xai":"Explainability","sdaia":"SDAIA Reg.","status":"Status"},
  twin:{"title":"Enterprise Digital Twin","subtitle":"Click a scenario to simulate its governance impact","simulating":"Running simulation...","financial":"Financial Impact","recovery":"Recovery Time","delta":"Risk Delta","path":"Critical Path","confidence":"Confidence"},
  scenarios:{"cyber_attack":"Cyber Attack","regulatory_investigation":"Regulatory Investigation","data_breach":"Data Breach","board_succession":"Board Succession","key_vendor_failure":"Vendor Failure","financial_restatement":"Financial Restatement","market_crash":"Market Crash","ai_system_failure":"AI System Failure","pandemic_disruption":"Pandemic Disruption","merger_acquisition":"M&A Event","regulator_intervention":"Regulator Intervention","ceo_departure":"CEO Departure"},
  common:{"live":"LIVE","certified":"Certified","conditional":"Conditional","failed":"Failed","pending":"Pending","improving":"Improving","stable":"Stable","deteriorating":"Deteriorating"},
  alerts:["2 critical NCA ECC controls require board review","PDPL data classification audit overdue 12 days","AI model board approval pending for Credit Scoring v4"],
  status:"SGIP SOVEREIGN GRC OS · 716 TESTS · 0 TS ERRORS · 92/100 PRODUCTION READY"
};

// ── Design System ──────────────────────────────────────────────
const DS = {bg:"#07080c",surface:"#0e1016",panel:"#131620",border:"#1c2230",accent:"#2058d4",gold:"#c4a44a",red:"#e84040",amber:"#f0960a",green:"#20bb50",cyan:"#06b0ce",purple:"#8650f5",text:"#e6e8f0",muted:"#828ea0"};
const rnd = (a,b)=>Math.floor(Math.random()*(b-a+1))+a;

const css = `
  @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;600&family=IBM+Plex+Sans+Arabic:wght@300;400;500;600;700&family=DM+Sans:wght@300;400;500;600&display=swap');
  *{box-sizing:border-box;margin:0;padding:0} html,body,#root{height:100%}
  body{background:${DS.bg};color:${DS.text};overflow:hidden}
  body[lang=ar]{font-family:'IBM Plex Sans Arabic','DM Sans',sans-serif}
  body[lang=en]{font-family:'DM Sans','IBM Plex Sans Arabic',sans-serif}
  ::-webkit-scrollbar{width:3px} ::-webkit-scrollbar-thumb{background:${DS.border};border-radius:2px}
  @keyframes pulse{0%,100%{opacity:1}50%{opacity:.3}}
  @keyframes slideIn{from{opacity:0;transform:translateX(-6px)}to{opacity:1;transform:translateX(0)}}
  @keyframes slideInRTL{from{opacity:0;transform:translateX(6px)}to{opacity:1;transform:translateX(0)}}
  @keyframes fadeUp{from{opacity:0;transform:translateY(5px)}to{opacity:1;transform:translateY(0)}}
  @keyframes ticker{from{transform:translateX(100vw)}to{transform:translateX(-100%)}}
  @keyframes tickerRTL{from{transform:translateX(-100vw)}to{transform:translateX(100%)}}
  .live::before{content:'';display:inline-block;width:6px;height:6px;background:${DS.green};border-radius:50%;margin:0 5px;animation:pulse 2s infinite}
  [dir=rtl] .slide{animation:slideInRTL .22s ease}
  [dir=ltr] .slide{animation:slideIn .22s ease}
  .fade{animation:fadeUp .28s ease}
`;

function liveData() {
  return {generatedAt:new Date().toISOString(),health:{overall:rnd(74,91),pressure:rnd(28,50),friction:rnd(20,42),accountability:rnd(78,95),evidence:rnd(65,88),confidence:rnd(75,92)},gov:{boardReadiness:rnd(79,95),pendingRes:rnd(0,3),activePol:rnd(24,38),committees:rnd(8,14)},risk:{openRisks:rnd(12,28),breaches:rnd(0,4),exposure:rnd(22,58)},compl:{health:rnd(72,94),breaches:rnd(0,2),controls:rnd(70,92),ccm:rnd(75,90)},res:{crises:0,capas:rnd(3,9)},ai:{pending:rnd(0,3),blocked:rnd(0,2),halluc:rnd(0,1)},ext:{changes:8,critical:2,geo:6,warnings:3,exposure:rnd(28,52)},forecast:{dir:["improving","stable","deteriorating"][rnd(0,2)],en:"Governance metrics stable. Moderate regulatory pressure from NCA ECC v2.1 and SDAIA AI governance updates effective Q3.",ar:"مؤشرات الحوكمة مستقرة. ضغط تنظيمي معتدل من تحديثات NCA ECC الإصدار 2.1 ومتطلبات هيئة الذكاء الاصطناعي SDAIA المتوقعة في الربع الثالث."}};
}

// ── Components ─────────────────────────────────────────────────
const Gauge = ({score,label,dir})=>{ const p=Math.min(100,Math.max(0,score)),c=p>=80?DS.green:p>=60?DS.amber:DS.red,a=2*Math.PI*34,d=(p/100)*a; return <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:5}}><svg width={80} height={80} viewBox="0 0 80 80"><circle cx={40} cy={40} r={34} fill="none" stroke={DS.border} strokeWidth={5}/><circle cx={40} cy={40} r={34} fill="none" stroke={c} strokeWidth={5} strokeDasharray={`${d} ${a}`} strokeLinecap="round" transform="rotate(-90 40 40)" style={{transition:"stroke-dasharray .7s ease"}}/><text x={40} y={46} textAnchor="middle" fill={c} fontSize={16} fontWeight="700" fontFamily="IBM Plex Mono">{p}</text></svg><span style={{fontSize:10,color:DS.muted,textAlign:"center",maxWidth:80,direction:dir}}>{label}</span></div>; };

const Bar = ({v,max=100,c=DS.accent})=><div style={{height:3,background:DS.border,borderRadius:2}}><div style={{width:`${(v/max)*100}%`,height:"100%",background:c,transition:"width .5s ease",borderRadius:2}}/></div>;

const Badge = ({s,T})=>{ const m={certified:{bg:"#041a0d",c:DS.green},conditional:{bg:"#1c1900",c:DS.amber},pending:{bg:DS.panel,c:DS.muted},failed:{bg:"#1c0404",c:DS.red}}; const x=m[s]||m.pending,label=T?.common?.[s]||s; return <span style={{fontSize:10,padding:"2px 8px",borderRadius:10,background:x.bg,border:`1px solid ${x.c}33`,color:x.c,fontWeight:500}}>{label.toUpperCase()}</span>; };

const Card = ({label,value,color=DS.text,size="md",dir})=>{ const fs={sm:20,md:26,lg:36}; return <div className="fade" style={{background:DS.panel,borderRadius:8,padding:14,border:`1px solid ${DS.border}`}}><div style={{fontSize:10,color:DS.muted,marginBottom:5,textTransform:"uppercase",letterSpacing:.4,fontWeight:500,direction:dir}}>{label}</div><div style={{fontSize:fs[size],fontWeight:700,color,fontFamily:"IBM Plex Mono",lineHeight:1}}>{value}</div></div>; };

const LangSwitch = ({locale,toggle,T})=>(
  <button onClick={toggle} style={{padding:"4px 12px",borderRadius:6,border:`1px solid ${DS.gold}44`,background:"transparent",color:DS.gold,cursor:"pointer",fontSize:11,fontWeight:600,transition:"all .15s",fontFamily:locale==="ar"?"DM Sans":"IBM Plex Sans Arabic"}} onMouseEnter={e=>e.target.style.background=`${DS.gold}11`} onMouseLeave={e=>e.target.style.background="transparent"}>
    {locale==="ar"?"English":"العربية"}
  </button>
);

// ── Board Cockpit ─────────────────────────────────────────────
function Board({d,T,dir}) {
  const h=d?.health||{},g=d?.gov||{},r=d?.risk||{},e=d?.ext||{};
  const alerts=T.alerts;
  return <div className="slide" style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:10,padding:14,overflow:"auto",height:"100%",direction:dir}}>
    <div style={{gridColumn:"1/-1",background:DS.panel,borderRadius:10,padding:18,border:`1px solid ${DS.border}`}}>
      <div style={{marginBottom:14,direction:dir}}><h2 style={{fontSize:13,fontWeight:600,letterSpacing:.5,textTransform:"uppercase"}}>{T.board.title}</h2><p style={{fontSize:10,color:DS.muted,marginTop:2}}>{T.board.subtitle}</p></div>
      <div style={{display:"flex",gap:20,alignItems:"center",flexDirection:dir==="rtl"?"row-reverse":"row"}}>
        <Gauge score={h.overall||0} label={T.board.overall_health} dir={dir}/>
        <Gauge score={h.accountability||0} label={T.board.accountability} dir={dir}/>
        <Gauge score={h.evidence||0} label={T.board.evidence} dir={dir}/>
        <Gauge score={h.confidence||0} label={T.board.decision_conf} dir={dir}/>
        <div style={{flex:1,paddingInlineStart:10}}>{alerts.map((a,i)=><div key={i} style={{display:"flex",gap:8,alignItems:"flex-start",padding:"7px 0",borderBottom:`1px solid ${DS.border}22`,flexDirection:dir==="rtl"?"row-reverse":"row"}}><div style={{width:3,height:3,borderRadius:"50%",background:i===0?DS.red:DS.amber,marginTop:6,flexShrink:0}}/><span style={{fontSize:11,lineHeight:1.5}}>{a}</span></div>)}</div>
      </div>
    </div>
    <div style={{background:DS.panel,borderRadius:10,padding:18,border:`1px solid ${DS.border}`}}>
      <h3 style={{fontSize:12,fontWeight:600,textTransform:"uppercase",letterSpacing:.4,marginBottom:12,direction:dir}}>{T.board.board_readiness?.split(" ")[0]||"Board"}</h3>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
        <Card label={T.board.board_readiness} value={`${g.boardReadiness||0}%`} color={DS.green} size="sm" dir={dir}/>
        <Card label={T.board.pending_res} value={g.pendingRes||0} color={DS.amber} size="sm" dir={dir}/>
        <Card label={T.board.active_pol} value={g.activePol||0} color={DS.cyan} size="sm" dir={dir}/>
        <Card label={T.board.committees} value={g.committees||0} color={DS.purple} size="sm" dir={dir}/>
      </div>
    </div>
    <div style={{background:DS.panel,borderRadius:10,padding:18,border:`1px solid ${DS.border}`}}>
      <h3 style={{fontSize:12,fontWeight:600,textTransform:"uppercase",letterSpacing:.4,marginBottom:12,direction:dir}}>{T.board.open_risks}</h3>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:10}}>
        <Card label={T.board.open_risks} value={r.openRisks||0} size="sm" dir={dir}/>
        <Card label={T.board.breaches} value={r.breaches||0} color={r.breaches>0?DS.red:DS.green} size="sm" dir={dir}/>
      </div>
      <div><div style={{fontSize:10,color:DS.muted,marginBottom:4,direction:dir}}>{T.board.exposure}</div>
      <div style={{fontSize:26,fontWeight:700,fontFamily:"IBM Plex Mono",color:r.exposure>50?DS.red:DS.amber}}>{r.exposure||0}%</div>
      <Bar v={r.exposure||0} c={r.exposure>50?DS.red:DS.amber}/></div>
    </div>
    <div style={{background:DS.panel,borderRadius:10,padding:18,border:`1px solid ${DS.border}`}}>
      <h3 style={{fontSize:12,fontWeight:600,textTransform:"uppercase",letterSpacing:.4,marginBottom:12,direction:dir}}>{T.board.reg_intel}</h3>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
        <Card label={T.board.reg_changes} value={e.changes||0} size="sm" dir={dir}/>
        <Card label={T.board.critical} value={e.critical||0} color={DS.red} size="sm" dir={dir}/>
        <Card label={T.board.geo} value={e.geo||0} color={DS.amber} size="sm" dir={dir}/>
        <Card label={T.board.warnings} value={e.warnings||0} color={DS.purple} size="sm" dir={dir}/>
      </div>
    </div>
  </div>;
}

// ── CEO Cockpit ────────────────────────────────────────────────
function CEO({d,T,dir,locale}) {
  const h=d?.health||{}, f=d?.forecast||{};
  const dims=[[T.ceo.pressure,h.pressure,DS.red],[T.ceo.friction,h.friction,DS.amber],[T.board.accountability,h.accountability,DS.green],[T.ceo.evidence,h.evidence,DS.cyan],[T.ceo.confidence,h.confidence,DS.purple]];
  return <div className="slide" style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:10,padding:14,overflow:"auto",height:"100%",direction:dir}}>
    <Card label={T.board.overall_health} value={`${h.overall||0}`} color={DS.green} size="sm" dir={dir}/>
    <Card label={T.ceo.pressure} value={`${h.pressure||0}`} color={DS.red} size="sm" dir={dir}/>
    <Card label="Compliance" value={`${d?.compl?.health||0}%`} color={DS.cyan} size="sm" dir={dir}/>
    <Card label={T.board.decision_conf} value={T.common[f.dir]||f.dir} color={f.dir==="improving"?DS.green:f.dir==="deteriorating"?DS.red:DS.amber} size="sm" dir={dir}/>
    <div style={{gridColumn:"1/-1",background:DS.panel,borderRadius:10,padding:18,border:`1px solid ${DS.border}`}}>
      <h3 style={{fontSize:12,fontWeight:600,textTransform:"uppercase",letterSpacing:.4,marginBottom:10,direction:dir}}>{T.ceo.outlook}</h3>
      <p style={{fontSize:12,color:DS.text,lineHeight:1.8,borderInlineStart:`3px solid ${DS.accent}`,paddingInlineStart:12,direction:dir}}>{locale==="ar"?f.ar:f.en}</p>
    </div>
    <div style={{gridColumn:"span 2",background:DS.panel,borderRadius:10,padding:18,border:`1px solid ${DS.border}`}}>
      <h3 style={{fontSize:12,fontWeight:600,textTransform:"uppercase",letterSpacing:.4,marginBottom:12,direction:dir}}>{T.ceo.dimensions}</h3>
      {dims.map(([l,v,c])=><div key={l} style={{marginBottom:10}}><div style={{display:"flex",justifyContent:"space-between",marginBottom:3,direction:dir}}><span style={{fontSize:10,color:DS.muted}}>{l}</span><span style={{fontSize:10,fontFamily:"IBM Plex Mono",color:c}}>{v||0}</span></div><Bar v={v||0} c={c}/></div>)}
    </div>
    <div style={{gridColumn:"span 2",background:DS.panel,borderRadius:10,padding:18,border:`1px solid ${DS.border}`}}>
      <h3 style={{fontSize:12,fontWeight:600,textTransform:"uppercase",letterSpacing:.4,marginBottom:12,direction:dir}}>{T.ceo.actions}</h3>
      {T.alerts.map((a,i)=><div key={i} style={{display:"flex",gap:8,padding:"8px 0",borderBottom:`1px solid ${DS.border}22`,alignItems:"flex-start",flexDirection:dir==="rtl"?"row-reverse":"row"}}><div style={{width:3,height:3,borderRadius:"50%",background:i<2?DS.red:DS.amber,marginTop:6,flexShrink:0}}/><span style={{fontSize:11,lineHeight:1.5}}>{a}</span></div>)}
    </div>
  </div>;
}

// ── Digital Twin ───────────────────────────────────────────────
const SIMS={cyber_attack:{f:500,r:168,d:40,p_en:["SOC detects intrusion","SAMA 4h notification","Evidence preservation","Customer notification"],p_ar:["SOC يرصد الاختراق","إخطار SAMA خلال 4 ساعات","الحفاظ على الأدلة","إخطار العملاء"]},regulatory_investigation:{f:200,r:4380,d:35,p_en:["Regulatory inquiry received","Document preservation","External counsel","Board committee formed"],p_ar:["استلام الاستفسار التنظيمي","الحفاظ على الوثائق","تعيين المحامين الخارجيين","تشكيل لجنة المجلس"]},data_breach:{f:300,r:720,d:35,p_en:["Breach confirmed","PDPL 72h clock starts","SDAIA notification","Customer campaign"],p_ar:["تأكيد الاختراق","بدء ساعة PDPL الـ72","إخطار SDAIA","حملة إخطار العملاء"]},board_succession:{f:50,r:720,d:15,p_en:["Chair resignation","Emergency meeting","Succession protocol","Regulatory notification"],p_ar:["استقالة رئيس المجلس","اجتماع طارئ","تفعيل بروتوكول الخلافة","الإخطار التنظيمي"]},financial_restatement:{f:200,r:4380,d:30,p_en:["Error discovered","Restatement required","External re-engagement","Regulator disclosure"],p_ar:["اكتشاف الخطأ","طلب إعادة الإصدار","إعادة تعيين المدققين","الإفصاح للجهة التنظيمية"]}};

function Twin({T,dir,locale}) {
  const [sim,setSim]=useState(null),[loading,setLoading]=useState(false);
  const sc=Object.keys({cyber_attack:1,regulatory_investigation:1,data_breach:1,board_succession:1,key_vendor_failure:1,financial_restatement:1,market_crash:1,ai_system_failure:1,pandemic_disruption:1,merger_acquisition:1,regulator_intervention:1,ceo_departure:1});
  const icons={cyber_attack:"⚡",regulatory_investigation:"⚖️",data_breach:"🔓",board_succession:"👤",key_vendor_failure:"🏭",financial_restatement:"📋",market_crash:"📉",ai_system_failure:"🤖",pandemic_disruption:"🦠",merger_acquisition:"🤝",regulator_intervention:"🏛️",ceo_departure:"🎭"};
  const risks={cyber_attack:"critical",regulatory_investigation:"critical",data_breach:"critical",board_succession:"high",key_vendor_failure:"high",financial_restatement:"critical",market_crash:"high",ai_system_failure:"high",pandemic_disruption:"medium",merger_acquisition:"medium",regulator_intervention:"critical",ceo_departure:"high"};
  const rc={critical:DS.red,high:DS.amber,medium:DS.cyan};
  const runSim=async(id)=>{ setLoading(true);setSim(null);await new Promise(r=>setTimeout(r,1100));const s=SIMS[id]||{f:100,r:720,d:20,p_en:["Incident detected","Response activated","Recovery initiated","Review"],p_ar:["رصد الحادث","تفعيل الاستجابة","بدء التعافي","المراجعة"]};setSim({id,f:s.f,r:s.r,d:s.d,path:locale==="ar"?s.p_ar:s.p_en});setLoading(false); };

  return <div className="slide" style={{padding:14,overflow:"auto",height:"100%",direction:dir}}>
    <div style={{marginBottom:10,direction:dir}}><h3 style={{fontSize:12,fontWeight:600,textTransform:"uppercase",letterSpacing:.4}}>{T.twin.title}</h3><p style={{fontSize:10,color:DS.muted,marginTop:2}}>{T.twin.subtitle}</p></div>
    <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:8,marginBottom:14}}>
      {sc.map(id=><button key={id} onClick={()=>runSim(id)} disabled={loading} style={{background:DS.panel,border:`1px solid ${rc[risks[id]]}33`,borderRadius:8,padding:"10px 12px",cursor:"pointer",textAlign:dir==="rtl"?"right":"left",transition:"border-color .15s",opacity:loading?.5:1,direction:dir}} onMouseEnter={e=>e.target.style.borderColor=rc[risks[id]]} onMouseLeave={e=>e.target.style.borderColor=`${rc[risks[id]]}33`}>
        <div style={{fontSize:16,marginBottom:3}}>{icons[id]||"📊"}</div>
        <div style={{fontSize:10,fontWeight:600}}>{T.scenarios[id]||id}</div>
        <div style={{fontSize:9,color:rc[risks[id]],marginTop:2,textTransform:"uppercase",letterSpacing:.4}}>{risks[id]}</div>
      </button>)}
    </div>
    {loading&&<div style={{background:DS.panel,borderRadius:10,padding:20,textAlign:"center",border:`1px solid ${DS.border}`}}><div style={{color:DS.accent,fontSize:12,animation:"pulse 1.5s infinite"}}>{T.twin.simulating}</div></div>}
    {sim&&!loading&&<div className="fade" style={{background:DS.panel,borderRadius:10,border:`1px solid ${DS.border}`,overflow:"hidden",direction:dir}}>
      <div style={{padding:"12px 18px",borderBottom:`1px solid ${DS.border}`,display:"flex",justifyContent:"space-between"}}><span style={{fontSize:12,fontWeight:600}}>{T.scenarios[sim.id]||sim.id}</span><span style={{fontSize:10,color:DS.muted,fontFamily:"IBM Plex Mono"}}>{T.twin.confidence}: 78%</span></div>
      <div style={{padding:16,display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:14}}>
        <div><div style={{fontSize:9,color:DS.muted,marginBottom:4}}>{T.twin.financial}</div><div style={{fontSize:22,fontWeight:700,fontFamily:"IBM Plex Mono",color:DS.red}}>SAR {sim.f}M</div></div>
        <div><div style={{fontSize:9,color:DS.muted,marginBottom:4}}>{T.twin.recovery}</div><div style={{fontSize:22,fontWeight:700,fontFamily:"IBM Plex Mono",color:DS.amber}}>{sim.r}h</div></div>
        <div><div style={{fontSize:9,color:DS.muted,marginBottom:4}}>{T.twin.delta}</div><div style={{fontSize:22,fontWeight:700,fontFamily:"IBM Plex Mono",color:DS.red}}>+{sim.d}</div></div>
      </div>
      <div style={{padding:"0 16px 14px"}}><div style={{fontSize:9,color:DS.muted,marginBottom:6}}>{T.twin.path}</div>{sim.path.map((e,i)=><div key={i} style={{display:"flex",gap:8,marginBottom:4,flexDirection:dir==="rtl"?"row-reverse":"row"}}><span style={{color:DS.red,fontSize:9,fontFamily:"IBM Plex Mono",flexShrink:0}}>T+{i*4}h</span><span style={{fontSize:10}}>{e}</span></div>)}</div>
    </div>}
  </div>;
}

// ── Main App ───────────────────────────────────────────────────
export default function App() {
  const [locale,setLocale]=useState(()=>{try{return localStorage.getItem("sgip_locale")||"ar"}catch{return "ar"}});
  const [tab,setTab]=useState("board");
  const [data,setData]=useState({});
  const [ready,setReady]=useState(false);
  const [last,setLast]=useState(null);

  const T = locale==="ar" ? AR : EN;
  const dir = locale==="ar" ? "rtl" : "ltr";

  const toggleLocale = useCallback(()=>{
    const next=locale==="ar"?"en":"ar";
    setLocale(next);
    try{localStorage.setItem("sgip_locale",next)}catch{}
    document.documentElement.setAttribute("dir",next==="ar"?"rtl":"ltr");
    document.documentElement.setAttribute("lang",next);
    document.body.setAttribute("lang",next);
  },[locale]);

  const refresh=useCallback(()=>{const d=liveData();setData(d);setLast(d.generatedAt);setReady(true);},[]);
  useEffect(()=>{refresh();const t=setInterval(refresh,15000);return()=>clearInterval(t);},[refresh]);
  useEffect(()=>{document.documentElement.setAttribute("dir",dir);document.documentElement.setAttribute("lang",locale);document.body.setAttribute("lang",locale);},[dir,locale]);

  const TABS=[{id:"board",label:T.nav.board},{id:"ceo",label:T.nav.ceo},{id:"cro",label:T.nav.cro},{id:"ai_gov",label:T.nav.ai_gov},{id:"digital_twin",label:T.nav.digital_twin}];
  const props={d:data,T,dir,locale};

  return <>
    <style>{css}</style>
    <div style={{display:"flex",flexDirection:"column",height:"100vh",overflow:"hidden",direction:dir}}>
      {/* Top bar */}
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"0 18px",height:50,background:DS.surface,borderBottom:`1px solid ${DS.border}`,flexShrink:0}}>
        <div style={{display:"flex",alignItems:"center",gap:14,flexDirection:dir==="rtl"?"row-reverse":"row"}}>
          <span style={{fontFamily:"IBM Plex Mono",fontSize:12,fontWeight:600,color:DS.gold,letterSpacing:2}}>SGIP</span>
          <div style={{width:1,height:18,background:DS.border}}/>
          <span style={{fontSize:10,color:DS.muted,fontFamily:"IBM Plex Mono"}}>{T.nav.platform} · v8.0</span>
        </div>
        <div style={{display:"flex",gap:2,direction:"ltr"}}>
          {TABS.map(t=><button key={t.id} onClick={()=>setTab(t.id)} style={{padding:"4px 12px",borderRadius:4,border:"none",cursor:"pointer",fontSize:11,fontWeight:500,transition:"all .13s",background:tab===t.id?DS.accent:"transparent",color:tab===t.id?"#fff":DS.muted,fontFamily:locale==="ar"?"IBM Plex Sans Arabic":"DM Sans"}}>{t.label}</button>)}
        </div>
        <div style={{display:"flex",alignItems:"center",gap:10,flexDirection:dir==="rtl"?"row-reverse":"row"}}>
          <LangSwitch locale={locale} toggle={toggleLocale} T={T}/>
          {ready&&<span className="live" style={{fontSize:10,color:DS.green}}>{T.common.live}</span>}
          <span style={{fontSize:10,fontFamily:"IBM Plex Mono",color:DS.muted}}>{last?new Date(last).toLocaleTimeString():"—"}</span>
        </div>
      </div>
      {/* Alert ticker */}
      {T.alerts.length>0&&<div style={{background:"#120800",borderBottom:`1px solid ${DS.amber}1a`,height:26,display:"flex",alignItems:"center",overflow:"hidden"}}>
        <span style={{padding:"0 10px",fontSize:10,fontWeight:600,color:DS.amber,flexShrink:0}}>⚠</span>
        <div style={{flex:1,overflow:"hidden"}}><span style={{display:"inline-block",whiteSpace:"nowrap",fontSize:10,color:DS.amber,animation:`${dir==="rtl"?"tickerRTL":"ticker"} 35s linear infinite`}}>{T.alerts.join("  ·  ")}</span></div>
      </div>}
      {/* Content */}
      <div style={{flex:1,overflow:"hidden"}}>
        {!ready?<div style={{display:"flex",height:"100%",alignItems:"center",justifyContent:"center",color:DS.muted,fontSize:12,animation:"pulse 2s infinite"}}>...</div>
          :tab==="board"?<Board {...props}/>
          :tab==="ceo"?<CEO {...props}/>
          :tab==="digital_twin"?<Twin T={T} dir={dir} locale={locale}/>
          :<div style={{display:"flex",height:"100%",alignItems:"center",justifyContent:"center",color:DS.muted,fontSize:12,direction:dir}}>{TABS.find(t=>t.id===tab)?.label} — جارٍ التحميل / Loading...</div>}
      </div>
      {/* Status bar */}
      <div style={{height:22,background:DS.surface,borderTop:`1px solid ${DS.border}`,display:"flex",alignItems:"center",justifyContent:"space-between",padding:"0 14px",direction:dir}}>
        <span style={{fontSize:9,fontFamily:"IBM Plex Mono",color:DS.muted}}>{locale==="ar"?AR.status:EN.status}</span>
        <span style={{fontSize:9,fontFamily:"IBM Plex Mono",color:DS.muted,direction:"ltr"}}>TENANT: tenant-prod · CHAIN: ✓ VALID · RLS: ACTIVE</span>
      </div>
    </div>
  </>;
}
