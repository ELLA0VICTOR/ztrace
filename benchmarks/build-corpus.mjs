// Self-authored integration-shaped fixtures. No project under analysis is executed.
import { writeFile } from 'node:fs/promises'

const noir = `import {getNoirWallet} from '@noir-wallet/sdk'; const wallet=getNoirWallet(); const account=await wallet.zcash.getAccounts();\n`
const react = `import {useWallet} from '@rhea-finance/zcash-wallet-adapter/react';\n`
const cases = []
function pair(id, family, positive, negative, options = {}, files = undefined) {
  for (const [suffix, content, vulnerable] of [['leak', positive, true], ['safe', negative, false]]) {
    cases.push({ id: `${id}-${suffix}`, family, split: id.startsWith('audit-') ? 'regression' : id.startsWith('challenge-') ? 'challenge' : 'integration', vulnerable, options,
      files: [{ path: 'app.tsx', content }, ...(files ?? [])] })
  }
}

pair('audit-nullable', 'control-flow', `import {getNoirWallet} from '@noir-wallet/sdk'; const w=ready?getNoirWallet():null; console.log((await w?.zcash.getAccounts())?.shielded);`, `import {getNoirWallet} from '@noir-wallet/sdk'; const w=ready?getNoirWallet():null; const a=await w?.zcash.getAccounts();console.log('ready');`)
pair('audit-comma', 'control-flow', noir+`let value=account.shielded;(console.log(value),value='public');`, noir+`let value=account.shielded;(value='public',console.log(value));`)
pair('audit-hook', 'react', react+`const {shieldedAddress}=useWallet();console.log(shieldedAddress);`, react+`const {isConnected}=useWallet();console.log(isConnected);`)
pair('audit-segment', 'analytics', noir+`import {AnalyticsBrowser} from '@segment/analytics-next';const a=AnalyticsBrowser.load({writeKey:'public'});a.track('checkout',{customer:account.shielded});`, noir+`import {AnalyticsBrowser} from '@segment/analytics-next';const a=AnalyticsBrowser.load({writeKey:'public'});a.track('checkout',{event:'started'});`)
pair('audit-loop', 'loops', noir+`for(const a of [account.shielded]) console.log(a);`, noir+`for(const a of ['public']) console.log(a);`)
pair('audit-reachability', 'control-flow', noir+`if(true)console.log(account.shielded);`, noir+`if(false)console.log(account.shielded);`)

pair('checkout-telemetry', 'cross-module', noir+`import {record} from './record.js';record({customer:account.shielded});`, noir+`import {record} from './record.js';record({event:'checkout'});`, {}, [{path:'record.ts',content:`import posthog from 'posthog-js';export function record(event:unknown){posthog.capture('checkout',event);}`}])
pair('payroll-balance', 'financial-data', noir+`const {available}=await wallet.zcash.getBalance();fetch('https://telemetry.example/metrics',{body:JSON.stringify({available})});`, noir+`const balance=await wallet.zcash.getBalance();fetch('https://telemetry.example/metrics',{body:JSON.stringify({event:'balance_loaded'})});`)
pair('support-history', 'financial-data', noir+`const history=await wallet.zcash.getTransactionHistory();fetch('https://support.example/ticket',{body:JSON.stringify({history})});`, noir+`const history=await wallet.zcash.getTransactionHistory();fetch('https://support.example/ticket',{body:JSON.stringify({code:'PAYMENT_PENDING'})});`)
pair('invoice-axios', 'transports', noir+`import axios from 'axios';const api=axios.create();api.post('https://example.test',{customer:account.shielded});`, noir+`import axios from 'axios';const api=axios.create();api.post('https://example.test',{event:'invoice_created'});`)
pair('session-websocket', 'transports', noir+`const s=new WebSocket('wss://example.test');s.send(JSON.stringify({account:account.shielded}));`, noir+`const s=new WebSocket('wss://example.test');s.send(JSON.stringify({event:'connected'}));`)
pair('session-xhr', 'transports', noir+`const x=new XMLHttpRequest();x.open('POST','https://example.test');x.send(account.shielded);`, noir+`const x=new XMLHttpRequest();x.open('POST','https://example.test');x.send('connected');`)
pair('server-pino', 'logging', noir+`import pino from 'pino';const logger=pino();logger.info({account:account.shielded});`, noir+`import pino from 'pino';const logger=pino();logger.info({event:'connected'});`)
pair('sentry-context', 'analytics', noir+`import {setContext} from '@sentry/react';setContext('wallet',{id:account.shielded});`, noir+`import {setContext} from '@sentry/react';setContext('checkout',{status:'pending'});`)
pair('react-effect', 'react', react+`import {useState,useEffect} from 'react';export function Checkout(){const {shieldedAddress}=useWallet();const [value,setValue]=useState(null);useEffect(()=>setValue(shieldedAddress),[shieldedAddress]);return <button onClick={()=>console.log(value)}>Continue</button>;}`, react+`import {useEffect} from 'react';export function Checkout(){const {shieldedAddress}=useWallet();useEffect(()=>console.log('wallet_connected'),[shieldedAddress]);return <span>{shieldedAddress}</span>;}`)
pair('react-resource', 'react', react+`export function Pixel(){const {shieldedAddress}=useWallet();return <img src={'https://example.test/pixel?id='+shieldedAddress}/>;}`, react+`export function Panel(){const {shieldedAddress}=useWallet();return <p>{shieldedAddress}</p>;}`)
pair('class-logger', 'classes', noir+`class Reporter{constructor(private value:string){}send(){console.log(this.value);}}new Reporter(account.shielded).send();`, noir+`class Reporter{constructor(private value:string){}send(){console.log('connected');}}new Reporter(account.shielded).send();`)
pair('injected-wallet', 'sources', `const a=await window.noirwallet.zcash.getAccounts();console.log(a.shielded);`, `const a=await window.noirwallet.zcash.getAccounts();console.log('connected');`)
pair('ledger-pczt', 'zcash-artifacts', `import {buildIronwoodTransaction} from '@ledgerhq/zcash-utils';const r=await buildIronwoodTransaction(params);console.log(r.pcztHex);`, `import {buildIronwoodTransaction} from '@ledgerhq/zcash-utils';const r=await buildIronwoodTransaction(params);console.log('transaction_prepared');`)
pair('viewing-key', 'zcash-artifacts', `import {readKey} from 'wallet-storage';fetch('https://example.test',{body:readKey()});`, `import {readKey} from 'wallet-storage';const key=readKey();console.log('key_loaded');`, {sources:[{module:'wallet-storage',export:'readKey',kind:'viewing-key'}]})
pair('alias-module', 'cross-module', noir+`import {record} from '@/events';record(account.shielded);`, noir+`import {record} from '@/events';record('connected');`, {moduleAliases:{'@/*':['src/*']}}, [{path:'src/events.ts',content:`export function record(value:unknown){console.log(value);}`}])
pair('indexed-loop', 'loops', noir+`const values=[account.shielded];for(let i=0;i<values.length;i++)console.log(values[i]);`, noir+`const values=['one','two'];for(let i=0;i<values.length;i++)console.log(values[i]);`)
pair('serialized-fields', 'field-sensitivity', noir+`const data=JSON.parse(JSON.stringify({private:account.shielded,event:'connected'}));console.log(data.private);`, noir+`const data=JSON.parse(JSON.stringify({private:account.shielded,event:'connected'}));console.log(data.event);`)
pair('challenge-rest', 'field-sensitivity', noir+`const data={address:account.shielded,status:'ready'};const {status,...rest}=data;console.log(rest);`, noir+`const data={address:account.shielded,status:'ready'};const {address,...rest}=data;console.log(rest);`)
pair('challenge-conditional-function', 'control-flow', noir+`function first(x:any){console.log(x);}function second(x:any){console.warn(x);}const send=flag?first:second;send(account.shielded);`, noir+`function first(x:any){return x;}function second(x:any){return x;}const send=flag?first:second;send(account.shielded);`)
pair('challenge-array-spread', 'field-sensitivity', noir+`const values=[...['public'],account.shielded];console.log(values[1]);`, noir+`const values=[account.shielded,...['public']];const [first,...rest]=values;console.log(rest);`)
pair('challenge-permission-event', 'sources', `import {getNoirWallet} from '@noir-wallet/sdk';getNoirWallet().zcash.on('accountsChanged',a=>console.log(a.shielded));`, `import {getNoirWallet} from '@noir-wallet/sdk';getNoirWallet().zcash.on('accountsChanged',a=>console.log('accounts_changed'));`)
pair('challenge-custom-transport', 'unmodeled-transport', noir+`import remote from 'custom-telemetry';remote.publish({customer:account.shielded});`, noir+`import remote from 'custom-telemetry';remote.publish({event:'connected'});`)
pair('challenge-reflective-sink', 'dynamic-dispatch', noir+`const method=runtimeMethod;console[method](account.shielded);`, noir+`const method=runtimeMethod;console[method]('ready');`)
pair('challenge-native-code', 'unmodeled-source', `import {readAccount} from 'unmodeled-native-wallet';const a=readAccount();console.log(a.shielded);`, `import {readAccount} from 'unmodeled-native-wallet';const a=readAccount();console.log('ready');`)

// Later confirmed misses remain in the corpus as paired regressions.
pair('audit-callback-array', 'callbacks', noir+`[account.shielded].forEach((value,index,array)=>console.log(array[index]));`, noir+`[account.shielded].forEach((value,index)=>console.log(index));`)
pair('audit-callback-index', 'callbacks', noir+`[account.shielded,'public'].map((value,index)=>{if(index===0)console.log(value);return value;});`, noir+`[account.shielded,'public'].map((value,index)=>{if(index===1)console.log(value);return value;});`)
pair('audit-reduce', 'callbacks', noir+`console.log([account.shielded].reduce((total,item)=>total+item,''));`, noir+`console.log([account.shielded,'public'].reduce((total,item)=>item,''));`)
pair('audit-reduce-direction', 'callbacks', noir+`console.log([account.shielded,'public'].reduceRight((total,item)=>item,''));`, noir+`console.log([account.shielded,'public'].reduce((total,item)=>item,''));`)
pair('audit-catch-state', 'exceptions', noir+`let value='public';try{value=account.shielded;throw new Error('failure');}catch(error){console.log(value);}`, noir+`let value='public';try{throw new Error('failure');}catch(error){console.log(value);}`)
pair('audit-caught-cause', 'exceptions', noir+`try{throw new Error('failure',{cause:{address:account.shielded}});}catch(error){console.log(error.cause.address);}`, noir+`try{throw new Error('failure',{cause:{address:account.shielded}});}catch(error){console.log(error.message);}`)
pair('audit-object-getter', 'accessors', noir+`const record={get value(){return account.shielded;}};console.log(record.value);`, noir+`const record={get value(){return 'ready';}};console.log(record.value);`)
pair('audit-object-setter', 'accessors', noir+`let value='public';const record={set address(next){value=next;}};record.address=account.shielded;console.log(value);`, noir+`let value='public';const record={set address(next){value='ready';}};record.address=account.shielded;console.log(value);`)
pair('audit-promise-executor', 'promises', noir+`console.log(await new Promise(resolve=>resolve(account.shielded)));`, noir+`console.log((await new Promise(resolve=>resolve({address:account.shielded,status:'ready'}))).status);`)
pair('audit-promise-reference', 'promises', noir+`await Promise.reject(account.shielded).catch(console.log);`, noir+`await Promise.reject(account.shielded).catch(()=>console.log('failed'));`)
pair('audit-bound-logger', 'function-dispatch', noir+`const log=console.log.bind(console,account.shielded);log();`, noir+`const log=console.log.bind(console,'ready');log();`)
pair('audit-applied-logger', 'function-dispatch', noir+`console.log.apply(console,[account.shielded]);`, noir+`console.log.apply(console,['ready']);`)
pair('audit-destructure-assignment', 'field-sensitivity', noir+`let address;({shielded:address}=account);console.log(address);`, noir+`let status;({status}={address:account.shielded,status:'ready'});console.log(status);`)
pair('audit-timer-arguments', 'callbacks', noir+`setTimeout(console.log,0,account.shielded);`, noir+`setTimeout(console.log,0,'ready');`)

await writeFile(new URL('./corpus.json',import.meta.url),JSON.stringify({schemaVersion:1,provenance:'Self-authored, synthetic, API-based fixtures. Challenge cases are a first-run stress split, not an independent external evaluation.',cases},null,2)+'\n')
console.log(`Wrote ${cases.length} labeled cases.`)
