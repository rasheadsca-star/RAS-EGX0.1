/*
EGX Pro Hub V8.1.2 — Build Regression QA Report
Checks generated files and JSON health during GitHub Actions.
Does not reset or overwrite market cache/history/scan-state.
*/
const fs=require("fs");
const path=require("path");
function exists(file){return fs.existsSync(file)}
function readText(file){try{return fs.readFileSync(file,"utf8")}catch{return""}}
function readJson(file,fallback){try{return JSON.parse(fs.readFileSync(file,"utf8"))}catch{return fallback}}
function write(file,obj){fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,JSON.stringify(obj,null,2),"utf8")}
function test(name,ok,message){return {name,ok:!!ok,status:ok?"PASS":"FAIL",message:message||""}}
function main(){
  const tests=[];
  const warnings=[];
  const requiredFiles=[
    "index.html",
    "service-worker.js",
    "manifest.json",
    "data/recommendations.json",
    "data/source-health.json",
    "data/app-health-status.json",
    "data/recommendation-accuracy-latest.json",
    "data/institutional-score-report.json"
  ];
  requiredFiles.forEach(f=>tests.push(test("file:"+f,exists(f),exists(f)?"exists":"missing")));
  const index=readText("index.html");
  ["renderStockSearch","renderStabilityQA","renderInstitutionalScoring","renderPortfolioRisk","renderAppHealth","renderAlerts","v801BindStockSearchStable"].forEach(fn=>{
    tests.push(test("index-function:"+fn,index.includes("function "+fn)||index.includes(fn+"="),index.includes(fn)?"found":"missing"));
  });
  ["stockSearch","stability","institutional","portfolioRisk","accuracy"].forEach(screen=>{
    tests.push(test("screen-route:"+screen,index.includes(`EGX.screen==="${screen}"`),index.includes(screen)?"route found":"route missing"));
  });
  const rec=readJson("data/recommendations.json",{});
  const rows=Array.isArray(rec.all)?rec.all:[];
  tests.push(test("data:recommendation_rows",rows.length>0,`${rows.length} rows`));
  if(rows.length<20)warnings.push("Recommendations rows are lower than expected.");
  const src=readJson("data/source-health.json",{});
  tests.push(test("data:source_health",src && Object.keys(src).length>0,"source-health readable"));
  if(src.ok===false)warnings.push("source-health reports ok=false.");
  const app=readJson("data/app-health-status.json",{});
  tests.push(test("data:app_health",app && Object.keys(app).length>0,"app-health readable"));
  const inst=readJson("data/institutional-score-report.json",{});
  tests.push(test("data:institutional_report",inst && Object.keys(inst).length>0,"institutional report readable"));
  const failed=tests.filter(x=>!x.ok);
  const report={
    ok:failed.length===0,
    engine:"v8_1_2_regression_qa",
    generatedAt:new Date().toISOString(),
    total:tests.length,
    passed:tests.length-failed.length,
    failedCount:failed.length,
    failed:failed.map(x=>x.name),
    warnings,
    tests,
    note:"Regression QA report generated in GitHub Actions. It checks files/routes/data availability only."
  };
  write("data/app-regression-report.json",report);
  console.log("Regression QA report", {ok:report.ok,total:report.total,failed:report.failedCount,warnings:warnings.length});
  if(failed.length){
    console.log("Failed tests:", failed.map(x=>x.name).join(", "));
  }
}
main();
