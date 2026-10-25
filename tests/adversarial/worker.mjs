import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {bech32m} from '@scure/base'
import {scanSources} from '../../dist-tools/packages/core/src/index.js'
import {inspectPcztDisclosure, inspectViewingCapability} from '../../dist-tools/packages/protocol/src/index.js'

const suite = process.argv[2]
const marker = 'ZTRACE_PRIVATE_VALUE_MUST_STAY_LOCAL_4938'
let checks = 0, rejected = 0
const clean = report => {assert.ok(!JSON.stringify(report).includes(marker)); checks++}
if (suite === 'sources') {
  const prelude = "import {getNoirWallet} from '@noir-wallet/sdk';const account=await getNoirWallet().zcash.getAccounts();"
  const original = [
    "console.log(account.shielded);",
    "const x={secret:account.shielded,event:'ready'};console.log(x.secret);",
    "const x=JSON.parse(JSON.stringify({secret:account.shielded}));console.log(x.secret);",
    "switch('send'){case 'send':console.log(account.shielded);break;default:console.log('ready');}",
    "const values=[];values.push(account.shielded);console.log(values.find(x=>true));",
    "const values=new Map([['secret',account.shielded]]);console.log(values.get('secret'));",
    "function outer(value){return ()=>console.log(value)}outer(account.shielded)();",
    "Promise.resolve(account.shielded).then(value=>console.log(value)).catch(()=>{});",
    "try{throw account.shielded}catch(error){console.log(error)}",
    "function fail(){throw new Error(account.shielded)}try{fail()}catch(error){console.log(error.message)}",
    "const x={secret:account.shielded};const y=x;y.secret='ready';console.log(x.secret);",
    "switch('safe'){case 'send':console.log(account.shielded);break;default:console.log('ready');}",
    "const values=new Map([['secret',account.shielded],['public','ready']]);console.log(values.get('public'));",
    "const values=new Map([['secret',account.shielded]]);values.clear();console.log(Array.from(values.values()));",
  ]
  const variants = original.map((code, index) => ({code, leak: index < 10, review: false}))
  for (const [code, leak, review = false] of [
    ['[account.shielded].forEach((value,index,array)=>console.log(array[index]));', true],
    ['[account.shielded].forEach((value,index)=>console.log(index));', false],
    ["console.log([account.shielded].reduce((total,item)=>total+item,''));", true],
    ["console.log([account.shielded,'public'].reduce((total,item)=>item,''));", false],
    ["let value='public';try{value=account.shielded;throw 'failed'}catch(error){console.log(value)}", true],
    ["let value='public';try{throw 'failed'}catch(error){console.log(value)}", false],
    ['console.log(await new Promise(resolve=>resolve(account.shielded)));', true],
    ["console.log(await new Promise(resolve=>resolve('ready')));", false],
    ['console.log.bind(console,account.shielded)();', true],
    ["console.log.bind(console,'ready')();", false],
    ['let value;({shielded:value}=account);console.log(value);', true],
    ["let value;({status:value}={status:'ready',address:account.shielded});console.log(value);", false],
    ['const record={get value(){return account.shielded}};console.log(record.value);', true, true],
    ["const record={get value(){return 'ready'}};console.log(record.value);", false, true],
  ]) variants.push({code, leak, review})
  for (let pass = 0; pass < 6; pass++) for (let index = 0; index < variants.length; index++) {
    const variant = variants[index]
    let body = variant.code
    if (pass === 1) body = body.replaceAll('.shielded', "['shielded']")
    if (pass === 2) body = body.replaceAll('console.log', 'globalThis.console.log')
    if (pass === 3) body = body.replaceAll('console.log', 'emit')
    if (pass === 4) body = `async function execute(){${body}}await execute();`
    if (pass === 5) body = body.replaceAll('console.log(', 'console.log.bind(console)(')
    const text = `${prelude}\n/* mutation ${pass} */const sentinel=${JSON.stringify(marker)};${pass === 3 ? 'const emit=console.log;' : ''}${body}`.replaceAll('account', `walletRecord${pass}`)
    const report = scanSources([{path: 'mutant.ts', content: text}], {requireSources: true})
    assert.equal(report.findings.length > 0, variant.leak, `${pass}: ${variant.code}`)
    assert.equal(report.summary.coverage, variant.review ? 'incomplete' : 'limited', JSON.stringify(report.diagnostics))
    clean(report)
  }
  const exhausted = scanSources([{path: 'budget.ts', content: prelude + 'console.log(account.shielded)'}], {maxSteps: 1})
  assert.equal(exhausted.summary.coverage, 'incomplete'); clean(exhausted)
  for (const text of [' '.repeat(1_000_001), '('.repeat(4000) + '0' + ')'.repeat(4000)]) {
    let report
    try {report = scanSources([{path: 'bound.ts', content: text}], {requireSources: true})}
    catch (error) {assert.ok(error instanceof Error); rejected++; checks++}
    if (report) {assert.equal(report.summary.coverage, 'incomplete'); clean(report)}
  }
  const url = scanSources([{path: 'import.ts', content: `import '${'https://example.test/?token=' + marker}';`}], {requireSources: true})
  clean(url)
} else if (suite === 'keys') {
  const rows = JSON.parse(await readFile(new URL('../../tests/fixtures/protocol/ufvk.json', import.meta.url), 'utf8')).slice(2)
  for (let index = 0; index < 256; index++) {
    const key = rows[index % rows.length][5]
    const position = (index * 31) % key.length
    const mutant = key.slice(0, position) + (key[position] === 'q' ? 'p' : 'q') + key.slice(position + 1)
    const report = inspectViewingCapability(mutant)
    assert.equal(report.status, 'invalid-or-unsupported'); clean(report); rejected++
  }
  for (let index = 0; index < 64; index++) {
    const key = rows[index % rows.length][5]
    const {prefix, words} = bech32m.decode(key, 16384)
    words[(index * 19) % words.length] ^= 1
    const mutant = bech32m.encode(prefix, words, 16384)
    const report = inspectViewingCapability(mutant)
    assert.ok(['recognized-encoding', 'invalid-or-unsupported'].includes(report.status))
    assert.ok(!JSON.stringify(report).includes(mutant)); clean(report)
    if (report.status === 'invalid-or-unsupported') rejected++
  }
  for (const text of ['', marker, 'uview1' + 'q'.repeat(20000)]) {assert.equal(inspectViewingCapability(text).status, 'invalid-or-unsupported'); clean(inspectViewingCapability(text)); rejected++}
} else if (suite === 'pczt') {
  const valid = Buffer.from((await readFile(new URL('../../tests/fixtures/protocol/synthetic-v6.pczt.hex', import.meta.url), 'utf8')).trim(), 'hex')
  for (let index = 0; index < 24; index++) {
    const length = 4 + Math.floor((valid.length - 4) * index / 24)
    const bytes = valid.subarray(0, length)
    const report = await inspectPcztDisclosure(bytes, {recipient: 'support'})
    assert.equal(report.decision, 'reject')
    if (report.status !== 'parsed-signer-projection') {assert.equal(report.fields.length, 0); rejected++}
    assert.ok(!JSON.stringify(report).includes(bytes.toString('hex')))
    clean(report)
  }
  const huge = await inspectPcztDisclosure(new Uint8Array(2_000_001), {recipient: 'signer', acknowledgePrivateDisclosure: true})
  assert.equal(huge.status, 'invalid-or-unsupported'); assert.equal(huge.decision, 'reject'); clean(huge); rejected++
} else throw new Error('Unknown suite')
console.log(JSON.stringify({suite, checks, rejected}))
