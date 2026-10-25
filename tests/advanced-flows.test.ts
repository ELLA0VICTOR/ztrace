import assert from 'node:assert/strict'
import {test} from 'node:test'
import {scanSources} from '../packages/core/src/index.js'

const prelude = "import {getNoirWallet} from '@noir-wallet/sdk';const a=await getNoirWallet().zcash.getAccounts();"
const scan = (code: string) => scanSources([{path: 'app.ts', content: prelude + code}])

test('callbacks receive element, numeric index, and the original array without conflating their sensitivity', () => {
  for (const method of ['map', 'forEach', 'filter', 'flatMap', 'find', 'findIndex', 'some', 'every']) {
    assert.equal(scan(`[a.shielded].${method}((value,index,array)=>{console.log(array[index]);return value;});`).findings.length, 1, method)
    assert.equal(scan(`[a.shielded].${method}((value,index)=>{console.log(index);return value;});`).findings.length, 0, method)
  }
  assert.equal(scan("[a.shielded,'public'].map((value,index)=>{if(index===1)console.log(value);return value;});").findings.length, 0)
  assert.equal(scan('[a.shielded].forEach(console.log);').findings.length, 1)
  assert.equal(scan('[].forEach(()=>console.log(a.shielded));').findings.length, 0)
})

test('finite reducers retain accumulator fields, direction, original array, and omitted initial values', () => {
  for (const code of [
    "console.log([a.shielded].reduce((total,item)=>total+item,''));",
    "console.log([a.shielded].reduceRight((total,item)=>total+item,''));",
    "console.log([a.shielded].reduce((total,item)=>item));",
    "console.log(['public',a.shielded].reduce((total,item,index,array)=>({...total,address:array[index]}),{}).address);",
  ]) assert.equal(scan(code).findings.length, 1, code)
  assert.equal(scan("console.log([a.shielded,'public'].reduce((total,item)=>item,''));").findings.length, 0)
  assert.equal(scan("console.log([a.shielded,'public'].reduceRight((total,item)=>item,''));").findings.length, 1)
  assert.equal(scan("console.log([a.shielded].reduce((total,item)=>({status:'ready',address:item}),{}).status);").findings.length, 0)
  const symbolic = scan("const history=await getNoirWallet().zcash.getTransactionHistory();console.log(history.reduce((total,item)=>total+item,''));")
  assert.equal(symbolic.findings.length, 1)
  assert.ok(symbolic.diagnostics.some(item => item.code === 'REDUCTION_REVIEW'))
})

test('catch bindings include assignments performed before a direct or nested throw', () => {
  for (const code of [
    "let value='public';try{value=a.shielded;throw new Error('failure');}catch(error){console.log(value);}",
    "const holder={value:'public'};try{holder.value=a.shielded;throw 'failure';}catch(error){console.log(holder.value);}",
    "let value='public';try{try{value=a.shielded;throw 'failure';}catch(inner){throw inner;}}catch(error){console.log(value);}",
  ]) assert.equal(scan(code).findings.length, 1, code)
  assert.equal(scan("let value='public';try{throw 'failure';}catch(error){console.log(value);}").findings.length, 0)
})

test('local getters and setters use current captured state and their receiver; indirect behavior remains flagged', () => {
  for (const code of [
    'const record={get address(){return a.shielded;}};console.log(record.address);',
    "let value='public';const record={get address(){return value;}};value=a.shielded;console.log(record.address);",
    "const record={value:'public',get address(){return this.value;}};record.value=a.shielded;console.log(record.address);",
    "let value='public';const record={set address(next){value=next;}};record.address=a.shielded;console.log(value);",
    'const record={get address(){return a.shielded;}};console.log(JSON.stringify(record));',
    'const record={get address(){return a.shielded;}};const copy={...record};console.log(copy.address);',
    'const record={get address(){return a.shielded;}};console.log(Object.values(record));',
    'class Record{constructor(private value:string){}get address(){return this.value;}}console.log(new Record(a.shielded).address);',
    "class Record{value='public';set address(next){this.value=next;}}const record=new Record();record.address=a.shielded;console.log(record.value);",
  ]) {
    const report = scan(code)
    assert.equal(report.findings.length, 1, code)
    assert.ok(report.diagnostics.some(item => item.code === 'ACCESSOR_REVIEW'), code)
  }
  assert.equal(scan("const record={get status(){return 'ready';},address:a.shielded};console.log(record.status);").findings.length, 0)
})

test('Promise constructors, rejection handlers, settled results and timer callback arguments preserve flows', () => {
  for (const code of [
    'console.log(await new Promise(resolve=>resolve(a.shielded)));',
    'function finish(resolve){resolve(a.shielded);}console.log(await new Promise(finish.bind(null)));',
    'await new Promise((resolve,reject)=>reject(a.shielded)).catch(console.log);',
    'await Promise.reject(a.shielded).then(undefined,console.log);',
    'await Promise.resolve(a.shielded).then(console.log);',
    'console.log((await Promise.allSettled([Promise.resolve(a.shielded)]))[0].value);',
    'console.log(await Promise.race([Promise.resolve(a.shielded)]));',
    'setTimeout(console.log,0,a.shielded);',
    'queueMicrotask(()=>console.log(a.shielded));',
  ]) {
    const report = scan(code)
    assert.equal(report.findings.length, 1, code)
    assert.equal(report.diagnostics.length, 0, code)
  }
  assert.equal(scan("console.log((await Promise.allSettled([Promise.resolve(a.shielded)]))[0].status);").findings.length, 0)
  assert.equal(scan("console.log(await new Promise(resolve=>resolve({address:a.shielded,status:'ready'}))).status;").findings.length, 1)
  assert.equal(scan("console.log((await new Promise(resolve=>resolve({address:a.shielded,status:'ready'}))).status);").findings.length, 0)
})

test('bound, called, applied and spread logger arguments preserve sink identity and local this', () => {
  for (const code of [
    'console.log.bind(console)(a.shielded);',
    'console.log.bind(console,a.shielded)();',
    'console.log.call(console,a.shielded);',
    'console.log.apply(console,[a.shielded]);',
    'console.log(...[a.shielded]);',
    'function emit(){console.log(this.address);}const send=emit.bind({address:a.shielded});send();',
    "const send=flag?console.log.bind(console):console.warn.bind(console);send(a.shielded);",
  ]) assert.ok(scan(code).findings.length >= 1, code)
  assert.equal(scan("console.log.bind(console)('ready');").findings.length, 0)
})

test('nested destructuring assignments, defaults and rest retain selected fields', () => {
  for (const code of [
    'let address;[address]=[a.shielded];console.log(address);',
    'let address;({shielded:address}=a);console.log(address);',
    'let address;({inner:{address}}={inner:{address:a.shielded}});console.log(address);',
    'let tail;[, ...tail]=[0,a.shielded];console.log(tail[0]);',
    'let status,rest;({status,...rest}={status:"ready",address:a.shielded});console.log(rest.address);',
    'let address;[address=a.shielded]=[];console.log(address);',
  ]) assert.equal(scan(code).findings.length, 1, code)
  assert.equal(scan('let status;({status}={status:"ready",address:a.shielded});console.log(status);').findings.length, 0)
})

test('typeof and void keep operand side effects without disclosing the operand value', () => {
  assert.equal(scan('console.log(typeof a.shielded);').findings.length, 0)
  assert.equal(scan('console.log(void a.shielded);').findings.length, 0)
  assert.equal(scan('console.log(void console.log(a.shielded));').findings.length, 1)
  assert.equal(scan('console.log(typeof console.log(a.shielded));').findings.length, 1)
})

test('defined defaults skip their initializer, while unknown defaults preserve both possible side effects', () => {
  for (const code of [
    "const {status=a.shielded}={status:'ready'};console.log(status);",
    "const [status=a.shielded]=['ready'];console.log(status);",
    "let status;({status=a.shielded}={status:'ready'});console.log(status);",
    "const {status=console.log(a.shielded)}={status:'ready'};",
  ]) assert.equal(scan(code).findings.length, 0, code)
  assert.equal(scan("let value=a.shielded;const {status=(value='ready')}=unknownObject;console.log(value);").findings.length, 1)
  assert.equal(scan('const {status=a.shielded}={};console.log(status);').findings.length, 1)
  assert.equal(scan('function emit(value=a.shielded){console.log(value);}emit(undefined);').findings.length, 1)
  assert.equal(scan('function emit(value=a.shielded){console.log(value);}emit(void 0);').findings.length, 1)
  assert.equal(scan("function emit(value=console.log(a.shielded)){console.log(value);}emit('ready');").findings.length, 0)
})

test('Array.from skips empty callbacks and preserves numeric mapper indices', () => {
  assert.equal(scan('Array.from([],()=>console.log(a.shielded));').findings.length, 0)
  assert.equal(scan("Array.from([a.shielded,'ready'],(value,index)=>{if(index===1)console.log(value);return value;});").findings.length, 0)
  assert.equal(scan('Array.from([a.shielded],console.log);').findings.length, 1)
})
