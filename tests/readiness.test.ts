import assert from 'node:assert/strict'
import {test} from 'node:test'
import {scanSources} from '../packages/core/src/index.js'

const wallet = "import {getNoirWallet} from '@noir-wallet/sdk';const a=await getNoirWallet().zcash.getAccounts();"
const scan = (body: string) => scanSources([{path: 'app.ts', content: wallet + body}])

test('coverage inventory distinguishes model availability from actual recognized source categories', () => {
  const report = scanSources([{path: 'app.ts', content: "import {readAccount} from 'unknown-wallet';import 'https://private.example/?token=DO_NOT_REPORT';console.log(readAccount());"}], {requireSources: true})
  assert.equal(report.summary.sourcesDetected, 0)
  assert.equal(report.summary.coverage, 'incomplete')
  assert.ok(report.diagnostics.some(item => item.code === 'SOURCE_REQUIREMENT_UNMET'))
  assert.equal(report.modelCoverage?.imports.find(item => item.module === 'unknown-wallet')?.model, 'unmodeled')
  assert.ok(!JSON.stringify(report).includes('DO_NOT_REPORT'))
  const adapted = scanSources([{path: 'app.ts', content: "import {readAccount} from 'unknown-wallet';console.log(readAccount().address);"}], {requiredSourceKinds: ['shielded-address'], sources: [{module: 'unknown-wallet', export: 'readAccount', path: 'address', kind: 'shielded-address'}]})
  assert.equal(adapted.findings.length, 1)
  assert.equal(adapted.modelCoverage?.requirementsSatisfied, true)
  assert.equal(adapted.modelCoverage?.imports[0]?.model, 'configured')
  assert.deepEqual(adapted.modelCoverage?.sourceKinds, ['shielded-address'])
})

test('requiring a specific category detects partial integration coverage', () => {
  const report = scanSources([{path: 'app.ts', content: wallet}], {requiredSourceKinds: ['viewing-key']})
  assert.equal(report.modelCoverage?.requirementsSatisfied, false)
  assert.equal(report.summary.coverage, 'incomplete')
})

test('switch known selection, default search, fall-through and branch joins preserve disclosures', () => {
  for (const [body, findings] of [
    ["switch('public'){case 'private':console.log(a.shielded);break;case 'public':console.log('ready');break;}", 0],
    ["switch('private'){default:console.log('ready');break;case 'private':console.log(a.shielded);break;}", 1],
    ["switch('private'){case 'private':case 'next':console.log(a.shielded);break;}", 1],
    ["let value='public';switch(mode){case 'private':value=a.shielded;break;default:value='public';}console.log(value);", 1],
    ["switch(mode){case 'one':console.log(a.shielded);break;default:console.warn(a.shielded);break;}", 2],
    ["switch('absent'){case 'private':console.log(a.shielded);break;}", 0],
    ["for(const mode of ['skip','send']){switch(mode){case 'skip':continue;case 'send':console.log(a.shielded);break;}}", 1],
    ["let value='public';switch('one'){case 'one':for(const item of [1]){break;}value=a.shielded;break;}console.log(value);", 1],
  ] as const) {
    const report = scan(body)
    assert.equal(report.findings.length, findings, body)
    assert.equal(report.summary.coverage, 'limited', body)
  }
})

test('switch case side effects follow JavaScript search order', () => {
  const report = scan("let value=a.shielded;switch('one'){case (console.log(value),'one'):break;case (console.warn(value),'two'):break;}")
  assert.equal(report.findings.length, 1)
  assert.equal(report.findings[0]?.sink.label, 'console.log')
})

test('switch returns retain sensitive results and skip paths that return early', () => {
  const report = scan("function choose(mode){switch(mode){case 'one':return a.shielded;default:return 'public';}console.log(a.shielded);}console.warn(choose('one'));")
  assert.equal(report.findings.length, 1)
  assert.equal(report.findings[0]?.sink.label, 'console.warn')
})

test('API input and switch budgets fail explicitly', () => {
  assert.throws(() => scanSources([{path: 'large.ts', content: ' '.repeat(1_000_001)}]))
  assert.throws(() => scanSources([{path: 'same.ts', content: ''}, {path: './same.ts', content: ''}]))
  const report = scan(`switch(mode){${Array.from({length: 129}, (_, index) => `case ${index}: break;`).join('')}}`)
  assert.equal(report.summary.coverage, 'incomplete')
  assert.ok(report.diagnostics.some(item => item.code === 'SWITCH_LIMIT'))
})

test('standard promises, map containers and array searches retain data and execute callback effects', () => {
  for (const body of [
    "Promise.resolve(a.shielded).catch(value=>console.log(value));",
    "Promise.resolve(a.shielded).finally(()=>console.log(a.shielded));",
    "const values=[];values.push(a.shielded);console.log(values.find(value=>true));",
    "const values=new Map();values.set('private',a.shielded);console.log(values.get('private'));",
    "const values=new Map([['private',a.shielded]]);for(const [key,value]of values.entries())console.log(value);",
    "const values=new Map();values.set(a.shielded,'public');console.log(Array.from(values.keys()));",
    "const value=flag?[]:{length:a.shielded};console.log(value.length);",
    "const history=await getNoirWallet().zcash.getTransactionHistory();const groups=new Map();for(const item of history){const day=new Date(item.timestamp).toISOString();const values=groups.get(day);if(values)values.push(item);else groups.set(day,[item]);}console.log(Array.from(groups.values()));",
  ]) {
    const report = scan(body)
    assert.ok(report.findings.length > 0, body)
    assert.equal(report.summary.coverage, 'limited', JSON.stringify(report.diagnostics))
  }
  assert.equal(scan("const values=new Map();values.set('private',a.shielded);values.set('public','ready');console.log(values.get('public'));").findings.length, 0)
  assert.equal(scan("const values=new Map();values.set('private',a.shielded);values.clear();console.log(Array.from(values.values()));").findings.length, 0)
  assert.equal(scan("const values=new Map([['public',a.shielded]]);console.log(values.has('public'));").findings.length, 0)
  for (const access of ["console.log(values.get('private'))", "console.log(Array.from(values.values()))", "values.forEach(value=>console.log(value))"]) {
    const report = scanSources([{path: 'app.ts', content: `import {readEntries} from 'wallet-entries';const values=new Map(readEntries());${access};`}], {sources: [{module: 'wallet-entries', export: 'readEntries', kind: 'wallet-account'}]})
    assert.equal(report.findings.length, 1, access)
  }
  assert.equal(scan("Promise.resolve({private:a.shielded,status:'ready'}).then(value=>console.log(value.status));").findings.length, 0)
  assert.equal(scan("Promise.resolve({private:a.shielded,status:'ready'}).then(value=>console.log(value.private));").findings.length, 1)
  assert.equal(scan("const object={private:a.shielded};Object.entries(object).forEach(([key,value])=>console.log(value));").findings.length, 1)
})

test('linked signing and lending identity fields are sensitive while public status fields stay clear', () => {
  for (const method of ['getPublicKey', 'checkLendingMcaAccount']) {
    const field = method === 'getPublicKey' ? 'pubkey' : 'mcaId'
    assert.equal(scan(`const identity=await getNoirWallet().zcash.${method}();console.log(identity.${field});`).findings.length, 1)
    assert.equal(scan(`const identity=await getNoirWallet().zcash.${method}();console.log(identity.signingMode);`).findings.length, 0)
  }
})

test('callbacks retain their captured React state and promise cleanup is modeled', () => {
  const report = scanSources([{path: 'App.tsx', content: `import {useState} from 'react';${wallet}export function App(){const [address,setAddress]=useState(a.shielded);return <button onClick={()=>setAddress(value=>{console.log(value);return 'public'})}>Go</button>}`}])
  assert.equal(report.findings.length, 1)
  assert.equal(report.summary.coverage, 'limited')
  assert.equal(scan("fetch('/public').catch(()=>{}).finally(()=>{});").summary.coverage, 'limited')
})

test('explicit thrown values, error messages and causes reach catch bindings across local calls', () => {
  for (const body of [
    "try{throw a.shielded}catch(error){console.log(error)}",
    "function fail(){throw new Error(a.shielded)}try{fail()}catch(error){console.error(error.message)}",
    "try{throw new Error('public',{cause:{address:a.shielded}})}catch(error){console.log(error.cause.address)}",
    "try{try{throw a.shielded}catch(inner){throw inner}}catch(outer){console.log(outer)}",
  ]) {
    const report = scan(body)
    assert.equal(report.findings.length, 1, body)
    assert.equal(report.summary.coverage, 'limited', JSON.stringify(report.diagnostics))
  }
})

test('public error fields and shadowed catch variables stay clear', () => {
  assert.equal(scan("try{throw new Error('public',{cause:a.shielded})}catch(error){console.log(error.message)}").findings.length, 0)
  assert.equal(scan("const error=a.shielded;try{throw 'public'}catch(error){console.log(error)}").findings.length, 0)
})
