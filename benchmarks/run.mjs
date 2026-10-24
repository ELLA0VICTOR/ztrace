import {readFile,writeFile} from 'node:fs/promises'
import {createHash} from 'node:crypto'
import {scanSources} from '../dist-tools/packages/core/src/index.js'

const bytes=await readFile(new URL('./corpus.json',import.meta.url))
const corpus=JSON.parse(bytes)
const expectedKinds={ 'payroll-balance':'wallet-balance','support-history':'wallet-history','ledger-pczt':'pczt','viewing-key':'viewing-key' }
const expectedRules={ 'audit-segment':'ZT003','checkout-telemetry':'ZT003','payroll-balance':'ZT002','support-history':'ZT002','invoice-axios':'ZT002','session-websocket':'ZT002','session-xhr':'ZT002','sentry-context':'ZT003','react-resource':'ZT002','viewing-key':'ZT002','challenge-custom-transport':'ZT003' }
function expected(item){const base=item.id.replace(/-(?:leak|safe)$/u,'');return{kind:expectedKinds[base]??'shielded-address',ruleId:expectedRules[base]??'ZT001',file:base==='checkout-telemetry'?'record.ts':base==='alias-module'?'src/events.ts':'app.tsx'}}
function matching(item,report){const e=expected(item);return report.findings.filter(f=>f.kind===e.kind&&f.ruleId===e.ruleId&&f.sink.file===e.file).length}
const rows=[]
for(const item of corpus.cases){
  const started=performance.now()
  const report=scanSources(item.files,item.options)
  const detected=item.vulnerable?matching(item,report)>0:report.findings.length>0
  rows.push({id:item.id,family:item.family,split:item.split,vulnerable:item.vulnerable,expected:expected(item),matchedFindings:matching(item,report),detected,classification:item.vulnerable?(detected?'TP':'FN'):(detected?'FP':'TN'),findings:report.findings.length,reviewDiagnostics:report.diagnostics.map(d=>d.code),milliseconds:Number((performance.now()-started).toFixed(3))})
}
const tally=list=>{
  const counts={TP:0,FN:0,FP:0,TN:0,reviewCases:0}
  for(const row of list){counts[row.classification]++;if(row.reviewDiagnostics.length)counts.reviewCases++}
  return {...counts,recall:counts.TP+counts.FN?counts.TP/(counts.TP+counts.FN):null,precision:counts.TP+counts.FP?counts.TP/(counts.TP+counts.FP):null}
}
const engineFiles=['analyzer.ts','rules.ts','types.ts']
const engine=createHash('sha256')
for(const file of engineFiles)engine.update(await readFile(new URL(`../packages/core/src/${file}`,import.meta.url)))
engine.update(await readFile(new URL('../packages/protocol/src/unified.ts',import.meta.url)))
engine.update(await readFile(new URL('../package-lock.json',import.meta.url)))
const report={schemaVersion:1,generatedAt:new Date().toISOString(),corpusSha256:createHash('sha256').update(bytes).digest('hex'),evaluationPolicySha256:createHash('sha256').update(await readFile(new URL(import.meta.url))).digest('hex'),engineSha256:engine.digest('hex'),provenance:corpus.provenance,summary:tally(rows),splits:Object.fromEntries([...new Set(rows.map(r=>r.split))].map(split=>[split,tally(rows.filter(r=>r.split===split))])),families:Object.fromEntries([...new Set(rows.map(r=>r.family))].map(family=>[family,tally(rows.filter(r=>r.family===family))])),cases:rows}
const configuredRows=[]
const configuredAdapters={sources:[{module:'unmodeled-native-wallet',export:'readAccount',kind:'shielded-address',path:'shielded'}],sinks:[{module:'custom-telemetry',export:'default.publish',kind:'analytics'}]}
for(const item of corpus.cases){
 const result=scanSources(item.files,{...item.options,sources:[...(item.options.sources??[]),...configuredAdapters.sources],sinks:configuredAdapters.sinks})
 const detected=item.vulnerable?matching(item,result)>0:result.findings.length>0
 configuredRows.push({id:item.id,vulnerable:item.vulnerable,classification:item.vulnerable?(detected?'TP':'FN'):(detected?'FP':'TN'),reviewDiagnostics:result.diagnostics.map(d=>d.code)})
}
report.withExplicitCustomAdapters={adapters:configuredAdapters,summary:tally(configuredRows),cases:configuredRows}
await writeFile(new URL('./latest.json',import.meta.url),JSON.stringify(report,null,2)+'\n')
const lines=['# ZTrace corpus results','',`Corpus SHA-256: ${report.corpusSha256}`,`Engine SHA-256: ${report.engineSha256}`,'',corpus.provenance,'','Review diagnostics do not count as detections. These metrics describe this corpus only, not production coverage.','',`Default models: ${rows.length} cases; TP ${report.summary.TP}; FN ${report.summary.FN}; FP ${report.summary.FP}; TN ${report.summary.TN}; review ${report.summary.reviewCases}.`,`With the two explicitly listed custom adapters: ${JSON.stringify(report.withExplicitCustomAdapters.summary)}. This is a configured result, not automatic discovery of unknown SDKs.`,'','| Case | Outcome | Review |','| --- | --- | --- |',...rows.map(row=>`| ${row.id} | ${row.classification} | ${row.reviewDiagnostics.join(', ')||'—'} |`)]
await writeFile(new URL('./latest.md',import.meta.url),lines.join('\n')+'\n')
console.log(JSON.stringify({cases:rows.length,...report.summary,splits:report.splits,withExplicitCustomAdapters:report.withExplicitCustomAdapters.summary},null,2))
if(process.argv.includes('--check')&&rows.some(row=>row.split!=='challenge'&&(row.classification==='FN'||row.classification==='FP')))process.exitCode=1
