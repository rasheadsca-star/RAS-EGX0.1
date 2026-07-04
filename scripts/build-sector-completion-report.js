/*
EGX Pro Hub V8.7 — Sector Completion Report
Builds sector coverage, liquidity by sector, and safe review suggestions for unknown symbols.
Does not overwrite the official sector map automatically.
*/
const fs=require("fs");
const path=require("path");
function read(file,fallback){try{return JSON.parse(fs.readFileSync(file,"utf8"))}catch{return fallback}}
function write(file,obj){fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,JSON.stringify(obj,null,2),"utf8")}
function num(v){if(v==null||v==="")return 0;const n=Number(String(v).replace(/[,%٬،]/g,"").replace(/[^\d.+\-eE]/g,""));return isFinite(n)?n:0}
function cleanSector(s){s=String(s||"").trim();return (!s||s==="-"||s==="غير مصنف"||s.toLowerCase()==="unknown")?"غير مصنف":s}
const RULES=[
  ["بنوك",90,/(bank|بنك|بن[وك]|credit|قرض|ائتمان|مصرف)/i],
  ["عقارات وإنشاءات",82,/(real estate|housing|development|تعمير|اسكان|إسكان|عقار|اوراسكوم|construction|مقاولات|مدينة نصر|طلعت|بالم|اعمار)/i],
  ["أغذية ومشروبات",82,/(food|foods|beverage|مطاحن|مخابز|اغذية|أغذية|دواجن|زيوت|سكر|البان|ألبان|دومتي|جهينة|عبور لاند)/i],
  ["رعاية صحية وأدوية",86,/(pharma|medical|health|دواء|ادوية|أدوية|مستشفى|مستشفيات|تشخيص|سبيد|راميدا|ابن سينا|نيل|ممفيس)/i],
  ["مواد أساسية وأسمنت",84,/(cement|اسمنت|أسمنت|حديد|صلب|aluminum|المونيوم|ألمنيوم|حديد|صلب|كيماويات|بتروكيماويات|سماد|اسمدة|أسمدة)/i],
  ["اتصالات وتكنولوجيا",84,/(telecom|اتصالات|technology|تكنولوجيا|فوري|اي فاينانس|e-finance|راية|اورنج|موبايل)/i],
  ["خدمات مالية غير مصرفية",80,/(financial|finance|leasing|تأجير|تمويل|سمسرة|هيرميس|بلتون|ثروة|كونتكت|ci capital|سي اي كابيتال)/i],
  ["سياحة وترفيه",78,/(tourism|hotel|hotels|سياحة|فنادق|منتجعات|بيراميزا|رمكو)/i],
  ["خدمات نقل وشحن",78,/(shipping|transport|logistics|نقل|شحن|ملاحة|قناة|حاويات)/i],
  ["خدمات ومنتجات صناعية",70,/(industrial|صناعات|صناعة|كابلات|نساجون|غزل|نسيج|ورق|عبوات|مطابع)/i]
];
function inferSector(r){
  const text=[r.symbol,r.name,r.name_ar,r.name_en,r.companyName].filter(Boolean).join(" ");
  for(const [sector,conf,rx] of RULES){
    if(rx.test(text))return {symbol:r.symbol,suggestedSector:sector,confidence:conf,reason:"matched company name keywords"};
  }
  return null;
}
function main(){
  const rec=read("data/recommendations.json",{});
  const rows=Array.isArray(rec.all)?rec.all:[];
  const sectors={};
  const missing=[];
  rows.forEach(r=>{
    const sector=cleanSector(r.sector||r.sector_ar||r.industry);
    sectors[sector]=sectors[sector]||{sector,count:0,valueTraded:0,avgChange:0,newsImpact:0,symbols:[]};
    sectors[sector].count++;
    sectors[sector].valueTraded+=num(r.valueTraded);
    sectors[sector].avgChange+=num(r.changePct);
    sectors[sector].newsImpact+=num(r.newsImpactScore);
    sectors[sector].symbols.push(r.symbol);
    if(sector==="غير مصنف")missing.push(r);
  });
  const sectorRows=Object.values(sectors).map(x=>({
    ...x,
    avgChange:x.count?Number((x.avgChange/x.count).toFixed(3)):0,
    newsImpact:x.count?Number((x.newsImpact/x.count).toFixed(2)):0
  })).sort((a,b)=>b.valueTraded-a.valueTraded);
  const suggestions=missing.map(inferSector).filter(Boolean).sort((a,b)=>b.confidence-a.confidence);
  const known=rows.length-missing.length;
  const coveragePct=rows.length?Number((known/rows.length*100).toFixed(2)):0;
  const report={
    ok:true,
    engine:"v8_7_sector_completion",
    generatedAt:new Date().toISOString(),
    totalSymbols:rows.length,
    classifiedSymbols:known,
    unclassifiedSymbols:missing.length,
    coveragePct,
    sectors:sectorRows,
    missing:missing.map(r=>({symbol:r.symbol,name:r.name_ar||r.name_en||r.name||"",price:num(r.price),changePct:num(r.changePct),valueTraded:num(r.valueTraded)})),
    suggestions,
    note:"Suggestions are review-only. They do not overwrite egx-sector-map.json automatically."
  };
  write("data/sector-completion-report.json",report);
  write("data/egx-sector-map-suggestions.json",{ok:true,generatedAt:report.generatedAt,suggestions});
  console.log("Sector completion", {coveragePct, missing:missing.length, suggestions:suggestions.length});
}
main();
