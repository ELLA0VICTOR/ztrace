import assert from 'node:assert/strict'
import { test } from 'node:test'
import { scanSources } from '../packages/core/src/index.js'

test('custom source and sink adapters classify only the declared returned field', () => {
  const options = {
    sources: [{ module: 'native-wallet', export: 'readAccount', path: 'addresses.shielded', kind: 'shielded-address' as const }],
    sinks: [{ module: 'telemetry', export: 'default.publish', kind: 'analytics' as const }],
  }
  for (const [field, count] of [['addresses.shielded', 1], ['status', 0]] as const) {
    const report = scanSources([{ path: 'app.ts', content: `import {readAccount} from 'native-wallet';import telemetry from 'telemetry';const account=readAccount();telemetry.publish(account.${field});` }], options)
    assert.equal(report.findings.length, count)
  }
})

test('dynamic console dispatch reports possible disclosure and review uncertainty', () => {
  const report = scanSources([{ path: 'app.ts', content: `import {getNoirWallet} from '@noir-wallet/sdk';const a=await getNoirWallet().zcash.getAccounts();console[method](a.shielded);` }])
  assert.equal(report.findings.length, 1)
  assert.ok(report.diagnostics.some(d => d.code === 'DYNAMIC_DISPATCH_REVIEW'))
})

test('CommonJS external imports keep known SDK and logger bindings', () => {
  const report = scanSources([{ path: 'app.cjs', content: `const {parsePczt}=require('@ledgerhq/zcash-utils');const logger=require('pino')();logger.info(parsePczt(bytes));` }])
  assert.equal(report.findings[0]?.kind, 'pczt')
})
