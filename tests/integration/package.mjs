import assert from 'node:assert/strict'
import {spawnSync} from 'node:child_process'
import {createHash} from 'node:crypto'
import {createServer} from 'node:http'
import {cp, mkdir, mkdtemp, readFile, realpath, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {basename, dirname, extname, join, resolve, sep} from 'node:path'
import {fileURLToPath, pathToFileURL} from 'node:url'

const root = fileURLToPath(new URL('../../', import.meta.url))
const artifacts = join(root, '.artifacts', 'release')
const npmCli = process.env.npm_execpath ?? join(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js')
function npm(args, cwd = root, expected = 0) {
  const result = spawnSync(process.execPath, [npmCli, ...args], {cwd, encoding: 'utf8', timeout: 240000, maxBuffer: 5_000_000, env: {...process.env, npm_config_audit: 'false', npm_config_fund: 'false'}})
  assert.equal(result.status, expected, `${args.join(' ')}\n${result.stdout}\n${result.stderr}`)
  return result.stdout
}
await mkdir(artifacts, {recursive: true})
const [packed] = JSON.parse(npm(['pack', '--ignore-scripts', '--json', '--pack-destination', artifacts]))
assert.ok(packed.files.some(file => file.path === 'LICENSE'))
assert.ok(packed.files.some(file => file.path === 'dist-tools/packages/core/src/index.d.ts'))
assert.ok(!packed.files.some(file => /^(?:node_modules|\.artifacts|dist\/|src\/generated)/.test(file.path)))
const tarball = join(artifacts, packed.filename)
// Stay outside the repository so Node cannot borrow its installed dependencies.
const consumer = await mkdtemp(join(tmpdir(), 'ztrace-consumer-'))
await cp(join(root, 'integration/checkout'), consumer, {recursive: true, filter: path => !['node_modules', 'dist'].includes(path.split(/[\\/]/).at(-1))})
const manifest = JSON.parse(await readFile(join(consumer, 'package.json'), 'utf8'))
manifest.devDependencies.ztrace = `file:${tarball.replaceAll('\\', '/')}`
await writeFile(join(consumer, 'package.json'), JSON.stringify(manifest, null, 2))
console.log('Packed ZTrace. Installing a separate consumer using the local npm cache when available…')
npm(['install', '--ignore-scripts', '--omit=optional', '--prefer-offline', '--no-audit', '--no-fund'], consumer)
const metadata = JSON.parse(await readFile(join(consumer, 'node_modules/ztrace/package.json'), 'utf8'))
assert.deepEqual(await readFile(join(consumer, 'node_modules/ztrace/dist-tools/packages/core/src/analyzer.js')), await readFile(join(root, 'dist-tools/packages/core/src/analyzer.js')), 'Installed engine must match the packed build')
for (const name of ['react', 'react-dom', 'motion', 'lucide-react', 'react-markdown', 'remark-gfm']) assert.ok(!metadata.dependencies[name], `Website dependency in tool package: ${name}`)
const apiPath = join(consumer, 'verify-api.mjs')
await writeFile(apiPath, `import assert from 'node:assert/strict';
import {scanSources} from 'ztrace/scanner';
import {auditBrowser,findBrowserPath} from 'ztrace/runtime';
import {inspectViewingCapability,inspectPcztDisclosure} from 'ztrace/protocol';
assert.equal(typeof auditBrowser,'function');assert.equal(typeof findBrowserPath,'function');
assert.equal(inspectViewingCapability('invalid').status,'invalid-or-unsupported');
const report=scanSources([{path:'app.ts',content:"import {getNoirWallet} from '@noir-wallet/sdk';const a=await getNoirWallet().zcash.getAccounts();console.log(a.shielded)"}],{requireSources:true});
assert.equal(report.findings.length,1);assert.equal(report.modelCoverage.requirementsSatisfied,true);
const missing=await inspectPcztDisclosure('50435a5400000000',{recipient:'support'});
assert.equal(missing.status,'parser-unavailable');assert.equal(missing.decision,'reject');
console.log('Installed package APIs and missing-native-parser behavior verified');`)
const api = spawnSync(process.execPath, [apiPath], {cwd: consumer, encoding: 'utf8', timeout: 30000})
assert.equal(api.status, 0, api.stderr)
console.log(api.stdout.trim())
// Vite's compiler also uses optional platform binaries. Test missing-parser behavior
// first, then install optional dependencies for the actual application build.
npm(['install', '--include=optional', '--ignore-scripts', '--prefer-offline', '--no-audit', '--no-fund'], consumer)
await writeFile(join(consumer, 'synthetic.pczt.hex'), await readFile(join(root, 'tests/fixtures/protocol/synthetic-v6.pczt.hex')))
await writeFile(join(consumer, 'verify-native.mjs'), `import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import {inspectPcztDisclosure} from 'ztrace/protocol';const report=await inspectPcztDisclosure((await readFile('synthetic.pczt.hex','utf8')).trim(),{recipient:'support'});assert.equal(report.status,'parsed-signer-projection');assert.equal(report.decision,'reject');assert.ok(report.fields.some(f=>f.category==='key-origin-fingerprint'));`)
const native = spawnSync(process.execPath, [join(consumer, 'verify-native.mjs')], {cwd: consumer, encoding: 'utf8', timeout: 30000})
assert.equal(native.status, 0, native.stderr)
console.log('Installed native parser and isolated worker verified.')
await writeFile(join(consumer, 'src', 'package-types.ts'), `import {scanSources,type ScanOptions} from 'ztrace/scanner';
import {auditBrowser,type RuntimeExpectations} from 'ztrace/runtime';
import {inspectViewingCapability,type PcztDisclosureOptions} from 'ztrace/protocol';
const options:ScanOptions={requireSources:true,requiredSourceKinds:['shielded-address']};
const expectations:RuntimeExpectations={canariesRead:['address']};
const role:PcztDisclosureOptions={recipient:'support'};
export {scanSources,auditBrowser,inspectViewingCapability,options,expectations,role};`)
npm(['run', 'build'], consumer)
console.log('Actual Noir SDK consumer compiles and bundles.')
const scan = variant => JSON.parse(npm(['exec', '--offline', '--', 'ztrace', 'scan', 'src', '--config', `ztrace.${variant}.json`, '--format', 'json'], consumer, variant === 'leaking' ? 1 : 0))
const leaking = scan('leaking'), corrected = scan('corrected')
assert.equal(leaking.findings.length, 3)
assert.deepEqual([...new Set(leaking.findings.map(item => item.ruleId))].sort(), ['ZT001', 'ZT002', 'ZT003'])
assert.equal(corrected.findings.length, 0)
assert.equal(corrected.modelCoverage.requirementsSatisfied, true)
console.log('Installed CLI: 3 disclosures in leaking flow; corrected flow clear with required source coverage.')

const dist = join(consumer, 'dist')
const mime = {'.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml'}
let sensitiveDeliveries = 0
const canaries = [
  {name: 'address', kind: 'shielded-address', value: 'ZTRACE_CONSUMER_ADDRESS_f31c694e', synthetic: true},
  {name: 'balance', kind: 'wallet-balance', value: '123456.12345678', synthetic: true},
  {name: 'history', kind: 'wallet-history', value: 'ZTRACE_CONSUMER_PRIVATE_MEMO_736aa', synthetic: true},
]
const server = createServer(async (request, response) => {
  if (['/events', '/support'].includes(request.url)) {
    let body = ''
    request.on('data', part => {body += part})
    request.on('end', () => {if (canaries.some(item => body.includes(item.value))) sensitiveDeliveries++; response.end('ok')})
    return
  }
  try {
    const file = resolve(dist, '.' + new URL(request.url, 'http://localhost').pathname)
    if (!file.startsWith(dist + sep)) {response.writeHead(403).end(); return}
    response.setHeader('Content-Type', mime[extname(file)] ?? 'application/octet-stream')
    response.end(await readFile(file))
  } catch {response.writeHead(404).end()}
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
let runtime
try {
  const {auditBrowser} = await import(pathToFileURL(resolve(consumer, 'node_modules/ztrace', metadata.exports['./runtime'].import)))
  const reports = []
  for (const variant of ['leaking', 'corrected']) reports.push(await auditBrowser({
    url: `http://127.0.0.1:${server.address().port}/${variant}.html`, canaries,
    testData: Object.fromEntries(canaries.map(item => [item.name, item.value])),
    actions: [{type: 'click', selector: '[data-test=checkout]'}], settleMs: 150,
    expectations: {canariesRead: canaries.map(item => item.name), checkpoints: ['zcash_getAccounts', 'zcash_getBalance', 'zcash_getTransactionHistory', 'checkout_complete'], minActions: 1},
  }))
  assert.equal(reports[0].completion, 'completed', JSON.stringify(reports[0].diagnostics))
  assert.deepEqual([...new Set(reports[0].findings.map(item => item.canary))].sort(), ['address', 'balance', 'history'])
  assert.equal(reports[1].completion, 'completed', JSON.stringify(reports[1].diagnostics))
  assert.equal(reports[1].findings.length, 0)
  assert.equal(reports[1].execution.expectationsSatisfied, true)
  assert.equal(sensitiveDeliveries, 0)
  runtime = {leaking: reports[0], corrected: reports[1], sensitiveDeliveries}
} finally {await new Promise(resolve => server.close(resolve))}
const sdk = JSON.parse(await readFile(join(consumer, 'node_modules/@noir-wallet/sdk/package.json'), 'utf8'))
const evidence = {generatedAt: new Date().toISOString(), package: {version: packed.version, bytes: packed.size, sha256: createHash('sha256').update(await readFile(tarball)).digest('hex')},
  integration: {sdk: sdk.name, version: sdk.version, provider: 'Synthetic extension-provider boundary; actual published SDK and React application executed'},
  static: {leaking, corrected}, runtime,
}
const rendered = JSON.stringify(evidence, null, 2)
for (const canary of canaries) assert.ok(!rendered.includes(canary.value), 'Evidence must omit canary values')
await mkdir(join(root, 'validation/consumer'), {recursive: true})
await writeFile(join(root, 'validation/consumer/latest.json'), rendered + '\n')
console.log('PASS: clean package installation, API/types, installed CLI, SDK calls, strict runtime flows, and zero sensitive collector deliveries.')
const fullConsumer = await realpath(consumer), tempRoot = await realpath(tmpdir())
if (dirname(fullConsumer) !== tempRoot || !basename(fullConsumer).startsWith('ztrace-consumer-')) throw new Error('Temporary consumer cleanup boundary mismatch.')
await rm(fullConsumer, {recursive: true, force: true, maxRetries: 5, retryDelay: 100})
