import {readFile,writeFile,mkdir} from 'node:fs/promises'
import {scanSources} from '../dist-tools/packages/core/src/index.js'

const examples={}
for(const [key,directory] of [['original','vulnerable'],['corrected','safe']]){
 const names=key==='original'?['checkout.ts','telemetry.ts']:['checkout.ts']
 const sources=await Promise.all(names.map(async path=>({path,content:await readFile(new URL(`../examples/${directory}/${path}`,import.meta.url),'utf8')})))
 examples[key]={name:key==='original'?'Example checkout':'Corrected checkout',report:scanSources(sources),sources}
}
const benchmark=JSON.parse(await readFile(new URL('../benchmarks/latest.json',import.meta.url),'utf8'))
const runtime=JSON.parse(await readFile(new URL('../runtime/evidence/latest.json',import.meta.url),'utf8'))
const vectors=await Promise.all(['f4jumble','ufvk','uivk'].map(async name=>JSON.parse(await readFile(new URL(`../tests/fixtures/protocol/${name}.json`,import.meta.url),'utf8'))))
const validation={cases:benchmark.cases.length,detected:benchmark.summary.TP,missed:benchmark.summary.FN,safe:benchmark.summary.TN,falseAlarms:benchmark.summary.FP,runtimeFlows:runtime.reports.length,protocolVectors:vectors.reduce((count,rows)=>count+rows.length-2,0)}
await mkdir(new URL('../src/generated/',import.meta.url),{recursive:true})
await writeFile(new URL('../src/generated/examples.json',import.meta.url),JSON.stringify(examples))
await writeFile(new URL('../src/generated/validation-summary.json',import.meta.url),JSON.stringify(validation))
console.log('Prepared scanner examples and evidence counts for the landing page.')
