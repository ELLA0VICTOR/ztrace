import assert from 'node:assert/strict'
import { test } from 'node:test'
import { scanSources } from '../packages/core/src/index.js'

const prelude = `import {getNoirWallet} from '@noir-wallet/sdk'; const wallet=getNoirWallet(); const connection=await wallet.zcash.getAccounts(); `
const run = (content: string) => scanSources([{ path: 'app.tsx', content }])

test('audit regression: optional provider retains source identity', () => {
  for (const provider of ['flag ? getNoirWallet() : null', 'getNoirWallet() ?? null', 'flag && getNoirWallet()']) {
    const report = run(`import {getNoirWallet} from '@noir-wallet/sdk'; const wallet=${provider}; const account=await wallet?.zcash.getAccounts(); console.log(account?.shielded);`)
    assert.equal(report.findings.length, 1, provider)
  }
})

test('audit regression: comma expressions follow JavaScript evaluation order', () => {
  assert.equal(run(prelude + `let address=connection.shielded; (console.log(address), address='public');`).findings.length, 1)
  assert.equal(run(prelude + `let address=connection.shielded; (address='public', console.log(address));`).findings.length, 0)
})

test('audit regression: React adapter imports and fields are sources', () => {
  for (const module of ['@rhea-finance/zcash-wallet-adapter', '@rhea-finance/zcash-wallet-adapter/react']) {
    assert.equal(run(`import {useWallet} from '${module}'; const {shieldedAddress}=useWallet(); console.log(shieldedAddress);`).findings.length, 1)
    assert.equal(run(`import {useWallet} from '${module}'; const wallet=useWallet(); console.log((await wallet.getBalance()).available);`).findings.length, 1)
  }
})

test('audit regression: Segment factory produces modeled client', () => {
  assert.equal(run(prelude + `import {AnalyticsBrowser} from '@segment/analytics-next'; const analytics=AnalyticsBrowser.load({writeKey:'public'}); analytics.track('checkout',{address:connection.shielded});`).findings[0]?.ruleId, 'ZT003')
})

test('audit regression: finite loops detect disclosure', () => {
  for (const loop of [
    'for (const address of [connection.shielded]) console.log(address);',
    'const values=[connection.shielded]; for(let i=0;i<values.length;i++) console.log(values[i]);',
    'let i=0; while(i<1){console.log(connection.shielded);i++;}',
    'do {console.log(connection.shielded);break;} while(false);',
  ]) assert.equal(run(prelude + loop).findings.length, 1, loop)
})

test('audit regression: unreachable constant branches do not produce findings', () => {
  for (const branch of ['if(false) console.log(connection.shielded);', 'false && console.log(connection.shielded);', 'true || console.log(connection.shielded);', 'true ? 0 : console.log(connection.shielded);', 'while(false) console.log(connection.shielded);']) {
    assert.equal(run(prelude + branch).findings.length, 0, branch)
  }
})

test('direct injected provider and constructed adapter are modeled', () => {
  assert.equal(run(`console.log((await window.noirwallet.zcash.getAccounts()).shielded);`).findings.length, 1)
  assert.equal(run(`import {NoirZcashWalletAdapter} from '@rhea-finance/zcash-wallet-adapter'; const wallet=new NoirZcashWalletAdapter({network:'testnet'}); console.log((await wallet.getBalance()).available);`).findings.length, 1)
})

test('classes retain this-bound data from constructor through methods', () => {
  const report = run(prelude + `class Telemetry { constructor(value: string) {this.address=value;} send(){console.log(this.address);} } const telemetry=new Telemetry(connection.shielded); telemetry.send();`)
  assert.equal(report.findings.length, 1)
})

test('private class field initializers preserve sensitive provider identity', () => {
  const report = run(`import {getNoirWallet} from '@noir-wallet/sdk';class Reporter{#wallet=getNoirWallet();async send(){console.log((await this.#wallet.zcash.getAccounts()).shielded);}}new Reporter().send();`)
  assert.equal(report.findings.length, 1)
})

test('React state flows through effects and event handlers', () => {
  const report = run(`import {useState,useEffect} from 'react'; import {useWallet} from '@rhea-finance/zcash-wallet-adapter/react';
  export function App(){const {shieldedAddress}=useWallet();const [account,setAccount]=useState(null);useEffect(()=>{setAccount(shieldedAddress);},[shieldedAddress]);return <button onClick={()=>console.log(account)}>Send</button>;}`)
  assert.equal(report.findings.length, 1)
})

test('displaying a balance locally is allowed; resource URLs are checked', () => {
  assert.equal(run(prelude + `const balance=await wallet.zcash.getBalance(); const ui=<div>{balance.available}</div>;`).findings.length, 0)
  assert.equal(run(prelude + `const ui=<img src={'https://example.test/?id='+connection.shielded}/>;`).findings.length, 1)
})

test('network clients and structured loggers have explicit sink models', () => {
  for (const code of [
    `import axios from 'axios'; axios.post('https://example.test',{address:connection.shielded});`,
    `import axios from 'axios'; const api=axios.create();api.post('https://example.test',{address:connection.shielded});`,
    `const ws=new WebSocket('wss://example.test');ws.send(connection.shielded);`,
    `const xhr=new XMLHttpRequest();xhr.open('POST','https://example.test');xhr.send(connection.shielded);`,
    `import pino from 'pino';const logger=pino();logger.info({address:connection.shielded});`,
  ]) assert.equal(run(prelude + code).findings.length, 1, code)
})

test('configured aliases resolve local helpers', () => {
  const report = scanSources([
    { path: 'src/app.ts', content: prelude + `import {log} from '@/telemetry';log(connection.shielded);` },
    { path: 'src/telemetry.ts', content: 'export function log(value: unknown){console.log(value);}' },
  ], { moduleAliases: { '@/*': ['src/*'] } })
  assert.equal(report.findings.length, 1)
})

test('finite indexed loops complete without an approximation diagnostic', () => {
  const report = run(prelude + `const values=[connection.shielded]; for(let i=0;i<values.length;i++) console.log(values[i]);`)
  assert.equal(report.findings.length, 1)
  assert.equal(report.diagnostics.length, 0)
})

test('JSON round trips keep safe fields separate', () => {
  assert.equal(run(prelude + `const copy=JSON.parse(JSON.stringify({address:connection.shielded,event:'ready'}));console.log(copy.event);`).findings.length, 0)
})

test('disclosure approval is limited to endpoint, category, and field', () => {
  const options = { disclosurePolicies: [{ origin: 'https://merchant.example', pathname: '/invoice', kinds: ['shielded-address' as const], fields: ['body.address'], reason: 'Recipient address is needed for this invoice.' }] }
  const code = (path: string, field: string) => prelude + `fetch('https://merchant.example/${path}',{body:JSON.stringify({${field}:connection.shielded})});`
  assert.equal(scanSources([{ path: 'app.ts', content: code('invoice', 'address') }], options).findings.length, 0)
  assert.equal(scanSources([{ path: 'app.ts', content: code('history', 'address') }], options).findings.length, 1)
  assert.equal(scanSources([{ path: 'app.ts', content: code('invoice', 'customerId') }], options).findings.length, 1)
})

test('canonical PCZT builder and parser outputs remain sensitive', () => {
  assert.equal(run(`import {buildIronwoodTransaction} from '@ledgerhq/zcash-utils';const tx=await buildIronwoodTransaction(params);console.log(tx.pcztHex);`).findings[0]?.kind, 'pczt')
  assert.equal(run(`import {parsePczt} from '@ledgerhq/zcash-utils';fetch('https://example.test',{body:JSON.stringify(parsePczt(bytes))});`).findings[0]?.kind, 'pczt')
})

test('logical provider assignment retains capabilities and skips dead RHS effects', () => {
  assert.equal(run(`import {getNoirWallet} from '@noir-wallet/sdk';let wallet=null;wallet??=getNoirWallet();console.log((await wallet.zcash.getAccounts()).shielded);`).findings.length, 1)
  assert.equal(run(prelude + `let value=false;value&&=console.log(account.shielded);`).findings.length, 0)
})

test('loose-equality conditions do not incorrectly prune reachable disclosures', () => {
  assert.equal(run(prelude + `if(1==true)console.log(connection.shielded);`).findings.length, 1)
})

test('cyclic objects converge conservatively through branch joins', () => {
  const report = run(prelude + `const data={address:connection.shielded};data.self=data;if(flag){data.status='ready';}console.log(data);`)
  assert.equal(report.findings.length, 1)
})

test('possibly empty loops do not hide reachable code after an early return', () => {
  for (const loop of [
    'for(const item of history){value="public";return;}',
    'while(flag){value="public";return;}',
  ]) {
    const report = run(prelude + `function report(history:any){let value=connection.shielded;${loop}console.log(value);}report(await wallet.zcash.getTransactionHistory());`)
    assert.equal(report.findings.filter(f => f.kind === 'shielded-address').length, 1)
  }
})
