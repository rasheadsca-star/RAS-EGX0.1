const REQUIRED_COLUMNS = ["symbol","price","previousClose"];
let market = [];
let portfolio = [];
let analysis = [];

const els = {
  trustBanner: document.getElementById("trustBanner"),
  marketInput: document.getElementById("marketInput"),
  portfolioInput: document.getElementById("portfolioInput"),
  qualityKpi: document.getElementById("qualityKpi"),
  countKpi: document.getElementById("countKpi"),
  strongKpi: document.getElementById("strongKpi"),
  riskKpi: document.getElementById("riskKpi"),
  confidenceKpi: document.getElementById("confidenceKpi"),
  portfolioKpi: document.getElementById("portfolioKpi"),
  searchInput: document.getElementById("searchInput"),
  signalFilter: document.getElementById("signalFilter"),
  minConfidence: document.getElementById("minConfidence"),
  sortMode: document.getElementById("sortMode"),
  topList: document.getElementById("topList"),
  portfolioBox: document.getElementById("portfolioBox"),
  rowsCount: document.getElementById("rowsCount"),
  analysisRows: document.getElementById("analysisRows")
};

function splitCsvLine(line){
  const out=[]; let cur=""; let inside=false;
  for(let i=0;i<line.length;i++){
    const ch=line[i];
    if(ch === '"' && line[i+1] === '"'){ cur+='"'; i++; }
    else if(ch === '"') inside=!inside;
    else if(ch === "," && !inside){ out.push(cur); cur=""; }
    else cur+=ch;
  }
  out.push(cur);
  return out;
}

function num(v){
  if(v === undefined || v === null) return null;
  const cleaned = String(v).replaceAll(",","").replaceAll("٬","").trim();
  if(cleaned === "") return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function parseCsv(text){
  const lines = text.split(/\r?\n/).filter(x => x.trim());
  if(lines.length < 2) throw new Error("الملف لا يحتوي على بيانات كافية.");
  const headers = splitCsvLine(lines[0]).map(h => h.trim());
  const lower = headers.map(h => h.toLowerCase());

  const indexOf = (...names) => {
    for(const name of names){
      const i = lower.indexOf(name.toLowerCase());
      if(i >= 0) return i;
    }
    return -1;
  };

  const idx = {
    symbol: indexOf("symbol","ticker","code","رمز"),
    name: indexOf("name","company","companyName","الشركة","اسم"),
    sector: indexOf("sector","القطاع"),
    price: indexOf("price","last","lastPrice","close","السعر"),
    previousClose: indexOf("previousClose","prevClose","previous","prev","إغلاق سابق"),
    high: indexOf("high","أعلى"),
    low: indexOf("low","أدنى"),
    volume: indexOf("volume","vol","الحجم"),
    avg20Volume: indexOf("avg20Volume","avgVolume20","average20Volume","vol20","متوسط حجم 20"),
    support: indexOf("support","support1","دعم"),
    resistance: indexOf("resistance","resistance1","مقاومة"),
    date: indexOf("date","sessionDate","تاريخ")
  };

  if(idx.symbol < 0 || idx.price < 0){
    throw new Error("لازم الملف يحتوي على symbol و price على الأقل.");
  }

  return lines.slice(1).map(line => {
    const c = splitCsvLine(line);
    const row = {
      symbol: String(c[idx.symbol] || "").trim().toUpperCase(),
      name: idx.name >= 0 ? String(c[idx.name] || "").trim() : "",
      sector: idx.sector >= 0 ? String(c[idx.sector] || "").trim() : "",
      price: idx.price >= 0 ? num(c[idx.price]) : null,
      previousClose: idx.previousClose >= 0 ? num(c[idx.previousClose]) : null,
      high: idx.high >= 0 ? num(c[idx.high]) : null,
      low: idx.low >= 0 ? num(c[idx.low]) : null,
      volume: idx.volume >= 0 ? num(c[idx.volume]) : null,
      avg20Volume: idx.avg20Volume >= 0 ? num(c[idx.avg20Volume]) : null,
      support: idx.support >= 0 ? num(c[idx.support]) : null,
      resistance: idx.resistance >= 0 ? num(c[idx.resistance]) : null,
      date: idx.date >= 0 ? String(c[idx.date] || "").trim() : ""
    };
    return row;
  }).filter(r => r.symbol && r.price !== null);
}

function parsePortfolioCsv(text){
  const lines = text.split(/\r?\n/).filter(x => x.trim());
  if(lines.length < 2) throw new Error("ملف المحفظة لا يحتوي على بيانات كافية.");
  const headers = splitCsvLine(lines[0]).map(h => h.trim().toLowerCase());
  const iSymbol = headers.indexOf("symbol");
  const iQty = headers.indexOf("quantity");
  const iCost = headers.indexOf("avgcost");
  if(iSymbol < 0 || iQty < 0 || iCost < 0) throw new Error("ملف المحفظة لازم يحتوي على symbol, quantity, avgCost.");
  return lines.slice(1).map(line => {
    const c = splitCsvLine(line);
    return {
      symbol: String(c[iSymbol] || "").trim().toUpperCase(),
      quantity: num(c[iQty]) || 0,
      avgCost: num(c[iCost]) || 0
    };
  }).filter(p => p.symbol && p.quantity > 0);
}

function analyzeRow(r){
  const missing = [];
  if(r.price === null) missing.push("price");
  if(r.previousClose === null) missing.push("previousClose");
  if(r.volume === null) missing.push("volume");
  if(r.avg20Volume === null) missing.push("avg20Volume");
  if(r.support === null) missing.push("support");
  if(r.resistance === null) missing.push("resistance");

  const changePct = r.previousClose ? ((r.price - r.previousClose) / r.previousClose) * 100 : null;
  const volumeRatio = (r.avg20Volume && r.avg20Volume > 0 && r.volume !== null) ? r.volume / r.avg20Volume : null;
  const distSupport = r.support ? ((r.price - r.support) / r.support) * 100 : null;
  const distResistance = r.resistance ? ((r.resistance - r.price) / r.price) * 100 : null;

  const qualityScore = Math.round(((6 - missing.length) / 6) * 100);

  if(r.price === null || r.previousClose === null){
    return { ...r, missing, qualityScore, signal:"INVALID", confidence:0, reason:"السعر أو الإغلاق السابق غير موجود.", changePct, volumeRatio, distSupport, distResistance, riskScore:100 };
  }

  let score = 0;
  let riskScore = 0;
  const reasons = [];

  if(changePct > 0.5){ score += 18; reasons.push("اتجاه سعري إيجابي"); }
  if(changePct > 1.5){ score += 10; reasons.push("زخم سعري واضح"); }
  if(changePct < -1.2){ riskScore += 26; reasons.push("ضغط سعري سلبي"); }

  if(volumeRatio !== null){
    if(volumeRatio >= 1.5){ score += 25; reasons.push("حجم تداول أعلى من متوسط 20 جلسة"); }
    else if(volumeRatio >= 1){ score += 12; reasons.push("حجم تداول مقبول"); }
    else { riskScore += 7; reasons.push("حجم تداول أقل من المتوسط"); }
  }

  if(distSupport !== null){
    if(distSupport >= 0 && distSupport <= 4){ score += 14; reasons.push("قريب من دعم معلوم"); }
    if(distSupport < 0){ riskScore += 30; reasons.push("كسر دعم"); }
    if(distSupport > 10){ riskScore += 8; reasons.push("بعيد عن الدعم"); }
  }

  if(distResistance !== null){
    if(distResistance > 4){ score += 10; reasons.push("مساحة صعود قبل المقاومة"); }
    if(distResistance >= 0 && distResistance <= 2){ riskScore += 15; reasons.push("قريب جدًا من المقاومة"); }
    if(distResistance < 0){ score += 10; reasons.push("اختراق مقاومة"); }
  }

  if(qualityScore < 70){
    score = Math.min(score, 42);
    reasons.push("جودة البيانات تقلل الثقة");
  }

  let signal = "WAIT";
  let confidence = Math.max(20, Math.min(100, score + Math.round(qualityScore * 0.35) - Math.round(riskScore * 0.25)));

  if(qualityScore < 45){
    signal = "INVALID";
    confidence = Math.min(confidence, 35);
  } else if(riskScore >= 35 || (changePct !== null && changePct < -2.5)){
    signal = "RISK_REDUCE";
    confidence = Math.max(60, Math.min(92, 55 + riskScore));
  } else if(confidence >= 78 && score >= 55){
    signal = "STRONG_WATCH";
  } else if(confidence >= 62 && score >= 40){
    signal = "WATCH";
  }

  return {
    ...r,
    missing,
    qualityScore,
    signal,
    confidence,
    reason: reasons.join(" + ") || "لا توجد إشارات كافية",
    changePct,
    volumeRatio,
    distSupport,
    distResistance,
    riskScore
  };
}

function runAnalysis(){
  analysis = market.map(analyzeRow);
  renderAll();
}

function filtered(){
  const q = els.searchInput.value.trim().toUpperCase();
  const sig = els.signalFilter.value;
  const minC = Number(els.minConfidence.value || 0);
  const sort = els.sortMode.value;

  let rows = analysis.filter(r => {
    const matchQ = !q || r.symbol.includes(q) || (r.name || "").toUpperCase().includes(q);
    const matchSig = sig === "ALL" || r.signal === sig;
    const matchC = r.confidence >= minC;
    return matchQ && matchSig && matchC;
  });

  rows.sort((a,b) => {
    if(sort === "volumeRatio") return (b.volumeRatio || 0) - (a.volumeRatio || 0);
    if(sort === "changePct") return (b.changePct || -999) - (a.changePct || -999);
    if(sort === "risk") return (b.riskScore || 0) - (a.riskScore || 0);
    return (b.confidence || 0) - (a.confidence || 0);
  });

  return rows;
}

function renderAll(){
  const strong = analysis.filter(r => r.signal === "STRONG_WATCH").length;
  const risks = analysis.filter(r => r.signal === "RISK_REDUCE").length;
  const avgC = analysis.length ? Math.round(analysis.reduce((a,b)=>a+b.confidence,0)/analysis.length) : 0;
  const avgQ = analysis.length ? Math.round(analysis.reduce((a,b)=>a+b.qualityScore,0)/analysis.length) : 0;

  els.trustBanner.className = market.length ? "trust-banner ok" : "trust-banner";
  els.trustBanner.innerHTML = market.length
    ? `<strong>DATA LOADED</strong><span>تم تحميل ${market.length} سهم. التحليل مبني على ملفك فقط.</span>`
    : `<strong>NO DATA</strong><span>ارفع ملف CSV للأسعار حتى يبدأ التحليل.</span>`;

  els.qualityKpi.textContent = market.length ? avgQ + "%" : "--";
  els.countKpi.textContent = market.length;
  els.strongKpi.textContent = strong;
  els.riskKpi.textContent = risks;
  els.confidenceKpi.textContent = market.length ? avgC + "%" : "--";

  renderTopList();
  renderPortfolio();
  renderTable();
}

function signalArabic(signal){
  return {
    STRONG_WATCH:"مراقبة قوية",
    WATCH:"مراقبة",
    WAIT:"انتظار",
    RISK_REDUCE:"حذر / تخفيف",
    INVALID:"بيانات غير كافية"
  }[signal] || signal;
}

function fmtPct(v){
  return v === null || v === undefined ? "--" : v.toFixed(2) + "%";
}
function fmtNum(v){
  return v === null || v === undefined ? "--" : Number(v).toLocaleString();
}

function renderTopList(){
  const rows = analysis
    .filter(r => r.signal === "STRONG_WATCH" || r.signal === "WATCH")
    .sort((a,b)=>b.confidence-a.confidence)
    .slice(0,8);

  if(!rows.length){
    els.topList.className = "cards-list empty";
    els.topList.textContent = market.length ? "لا توجد فرص مراقبة قوية بالشروط الحالية." : "ارفع بيانات الأسعار أولًا.";
    return;
  }

  els.topList.className = "cards-list";
  els.topList.innerHTML = rows.map(r => `
    <div class="item">
      <div>
        <div class="symbol">${r.symbol}</div>
        <div class="sub">${r.name || ""}</div>
        <div class="sub">${r.reason}</div>
      </div>
      <div style="text-align:left">
        <span class="badge ${r.signal}">${signalArabic(r.signal)}</span>
        <div class="sub">ثقة ${r.confidence}%</div>
        <div class="sub">VR ${r.volumeRatio ? r.volumeRatio.toFixed(2) : "--"}</div>
      </div>
    </div>
  `).join("");
}

function renderPortfolio(){
  if(!portfolio.length){
    els.portfolioKpi.textContent = "--";
    els.portfolioBox.className = "cards-list empty";
    els.portfolioBox.textContent = "ارفع ملف المحفظة لو عايز تحليل المراكز.";
    return;
  }

  const bySymbol = Object.fromEntries(analysis.map(r => [r.symbol, r]));
  let totalValue = 0;
  let totalCost = 0;

  const items = portfolio.map(p => {
    const m = bySymbol[p.symbol];
    const value = m ? p.quantity * m.price : 0;
    const cost = p.quantity * p.avgCost;
    totalValue += value;
    totalCost += cost;
    const pnl = value - cost;
    const pnlPct = cost ? (pnl / cost) * 100 : 0;
    return { ...p, market: m, value, cost, pnl, pnlPct };
  });

  els.portfolioKpi.textContent = totalValue ? Math.round(totalValue).toLocaleString() : "--";
  els.portfolioBox.className = "cards-list";
  els.portfolioBox.innerHTML = items.map(x => `
    <div class="item">
      <div>
        <div class="symbol">${x.symbol}</div>
        <div class="sub">كمية: ${fmtNum(x.quantity)} | متوسط: ${x.avgCost}</div>
        <div class="sub">الإشارة: ${x.market ? signalArabic(x.market.signal) : "غير موجود في ملف الأسعار"}</div>
      </div>
      <div style="text-align:left">
        <div class="${x.pnl >= 0 ? "good" : "bad"}">${Math.round(x.pnl).toLocaleString()}</div>
        <div class="sub">${x.pnlPct.toFixed(2)}%</div>
      </div>
    </div>
  `).join("") + `
    <div class="item">
      <strong>إجمالي الربح/الخسارة</strong>
      <strong class="${(totalValue-totalCost) >= 0 ? "good" : "bad"}">${Math.round(totalValue-totalCost).toLocaleString()}</strong>
    </div>
  `;
}

function renderTable(){
  const rows = filtered();
  els.rowsCount.textContent = `${rows.length} صف`;
  if(!rows.length){
    els.analysisRows.innerHTML = "";
    return;
  }

  els.analysisRows.innerHTML = rows.map(r => `
    <tr>
      <td><strong>${r.symbol}</strong></td>
      <td>${r.name || "--"}</td>
      <td>${fmtNum(r.price)}</td>
      <td class="${r.changePct >= 0 ? "good" : "bad"}">${fmtPct(r.changePct)}</td>
      <td>${r.volumeRatio ? r.volumeRatio.toFixed(2) : "--"}</td>
      <td>${fmtNum(r.support)}</td>
      <td>${fmtNum(r.resistance)}</td>
      <td>${fmtPct(r.distSupport)}</td>
      <td>${fmtPct(r.distResistance)}</td>
      <td><span class="badge ${r.signal}">${signalArabic(r.signal)}</span></td>
      <td>${r.confidence}%</td>
      <td>${r.qualityScore}%</td>
      <td class="muted">${r.reason}</td>
    </tr>
  `).join("");
}

function downloadCsv(filename, rows){
  const csv = rows.map(r => r.map(v => `"${String(v ?? "").replaceAll('"','""')}"`).join(",")).join("\n");
  const blob = new Blob([csv], {type:"text/csv;charset=utf-8"});
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function exportReport(){
  if(!analysis.length){ alert("ارفع بيانات الأسعار أولًا."); return; }
  const header = ["symbol","name","price","previousClose","changePct","volume","avg20Volume","volumeRatio","support","resistance","distSupport","distResistance","signal","confidence","qualityScore","reason"];
  const rows = analysis.map(r => [r.symbol,r.name,r.price,r.previousClose,fmtPct(r.changePct),r.volume,r.avg20Volume,r.volumeRatio ? r.volumeRatio.toFixed(2) : "",r.support,r.resistance,fmtPct(r.distSupport),fmtPct(r.distResistance),signalArabic(r.signal),r.confidence,r.qualityScore,r.reason]);
  downloadCsv("egx-light-trusted-report.csv", [header, ...rows]);
}

function downloadMarketTemplate(){
  downloadCsv("egx-market-template.csv", [
    ["symbol","name","sector","price","previousClose","high","low","volume","avg20Volume","support","resistance","date"],
    ["CIB","Commercial International Bank","Banks","82.50","81.30","83.10","80.90","1150000","900000","79.80","86.00","2026-07-01"],
    ["CCAP","Qalaa Holdings","Financials","5.40","5.52","5.58","5.35","2200000","1800000","5.20","5.75","2026-07-01"]
  ]);
}

function downloadPortfolioTemplate(){
  downloadCsv("egx-portfolio-template.csv", [
    ["symbol","quantity","avgCost"],
    ["CIB","100","81.00"],
    ["CCAP","1000","5.43"]
  ]);
}

els.marketInput.addEventListener("change", async e => {
  const file = e.target.files[0];
  if(!file) return;
  try{
    market = parseCsv(await file.text());
    if(!market.length) throw new Error("لا توجد صفوف صالحة.");
    localStorage.setItem("egx_light_market", JSON.stringify(market));
    runAnalysis();
  }catch(err){ alert("فشل استيراد ملف الأسعار: " + err.message); }
});

els.portfolioInput.addEventListener("change", async e => {
  const file = e.target.files[0];
  if(!file) return;
  try{
    portfolio = parsePortfolioCsv(await file.text());
    localStorage.setItem("egx_light_portfolio", JSON.stringify(portfolio));
    renderPortfolio();
  }catch(err){ alert("فشل استيراد ملف المحفظة: " + err.message); }
});

["searchInput","signalFilter","minConfidence","sortMode"].forEach(id => document.getElementById(id).addEventListener("input", renderTable));
document.getElementById("exportBtn").addEventListener("click", exportReport);
document.getElementById("templateBtn").addEventListener("click", downloadMarketTemplate);
document.getElementById("portfolioTemplateBtn").addEventListener("click", downloadPortfolioTemplate);
document.getElementById("clearBtn").addEventListener("click", () => {
  localStorage.removeItem("egx_light_market");
  localStorage.removeItem("egx_light_portfolio");
  market = [];
  portfolio = [];
  analysis = [];
  renderAll();
});

try{
  market = JSON.parse(localStorage.getItem("egx_light_market") || "[]");
  portfolio = JSON.parse(localStorage.getItem("egx_light_portfolio") || "[]");
}catch{
  market = [];
  portfolio = [];
}
runAnalysis();
