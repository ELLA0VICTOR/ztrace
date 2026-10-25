import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {createRequire} from 'node:module'
import {test} from 'node:test'
import {scanSources, toSarif} from '../packages/core/src/index.js'

const require = createRequire(import.meta.url)
const Ajv = require('ajv') as typeof import('ajv').Ajv
const schema = JSON.parse(await readFile(new URL('../../tests/fixtures/sarif/sarif-schema-2.1.0.json', import.meta.url), 'utf8'))
// The published schema contains an older regex with a literal closing bracket.
const validate = new Ajv({strict: false, unicodeRegExp: false, validateFormats: false, allErrors: true}).compile(schema)

test('SARIF validates against the official schema and retains all three rules and their source-to-sink traces', () => {
  const marker = 'ZTRACE_SOURCE_LITERAL_MUST_NOT_APPEAR_68984'
  const report = scanSources([{path: 'wallet #1.ts', content: `import {getNoirWallet} from '@noir-wallet/sdk';const address=(await getNoirWallet().zcash.getAccounts()).shielded;const marker='${marker}';console.log(address);fetch('https://external.example',{method:'POST',body:address});import posthog from 'posthog-js';posthog.capture('checkout',{address});`}])
  const result = toSarif(report, {pathPrefix: 'apps/checkout'})
  assert.equal(validate(result), true, JSON.stringify(validate.errors))
  assert.equal(result.runs[0]!.results.length, 3)
  for (const finding of result.runs[0]!.results) {
    assert.equal(finding.locations[0]!.physicalLocation.artifactLocation.uri, 'apps/checkout/wallet%20%231.ts')
    assert.equal(result.runs[0]!.tool.driver.rules[finding.ruleIndex]!.id, finding.ruleId)
    assert.ok(finding.codeFlows[0]!.threadFlows[0]!.locations.length > 1)
  }
  assert.ok(!JSON.stringify(result).includes(marker))
  assert.equal(result.runs[0]!.invocations[0]!.executionSuccessful, true)
})

test('SARIF preserves incomplete analysis notices, source requirements, safe results, and Windows relative paths', () => {
  const missing = toSarif(scanSources([{path: 'src\\wallet.ts', content: "import {read} from 'unknown-wallet';console.log(read());"}], {requireSources: true}))
  assert.equal(validate(missing), true, JSON.stringify(validate.errors))
  assert.equal(missing.runs[0]!.invocations[0]!.executionSuccessful, false)
  assert.ok(missing.runs[0]!.invocations[0]!.toolExecutionNotifications.some(item => item.properties.code === 'SOURCE_REQUIREMENT_UNMET'))
  assert.equal(missing.runs[0]!.properties.sourceRequirementsSatisfied, false)
  const safe = toSarif(scanSources([{path: 'src\\wallet.ts', content: "import {getNoirWallet} from '@noir-wallet/sdk';const wallet=getNoirWallet();const a=await wallet.zcash.getAccounts();console.log('ready');"}]))
  assert.equal(validate(safe), true, JSON.stringify(validate.errors))
  assert.deepEqual(safe.runs[0]!.results, [])
  const windows = toSarif(scanSources([{path: 'src\\wallet.ts', content: "console.log((await window.noirwallet.zcash.getAccounts()).shielded)"}]))
  assert.equal(windows.runs[0]!.results[0]!.locations[0]!.physicalLocation.artifactLocation.uri, 'src/wallet.ts')
})

test('SARIF rejects absolute input metadata and encodes URI separators as filename text', () => {
  const report = scanSources([{path: 'src/token?name.ts', content: 'console.log((await window.noirwallet.zcash.getAccounts()).shielded)'}])
  assert.equal(toSarif(report).runs[0]!.results[0]!.locations[0]!.physicalLocation.artifactLocation.uri, 'src/token%3Fname.ts')
  assert.throws(() => toSarif(report, {pathPrefix: 'C:\\Users\\private'}))
  const absolute = scanSources([{path: 'C:/Users/private/app.ts', content: 'console.log((await window.noirwallet.zcash.getAccounts()).shielded)'}])
  assert.throws(() => toSarif(absolute))
})
