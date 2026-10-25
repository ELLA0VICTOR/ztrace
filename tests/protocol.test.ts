import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { bech32m } from '@scure/base'
import { test } from 'node:test'
import { inspectViewingCapability, inspectPcztDisclosure } from '../packages/protocol/src/index.js'
import { unjumble } from '../packages/protocol/src/unified.js'
import { scanSources } from '../packages/core/src/index.js'

const directory = new URL('../../tests/fixtures/protocol/', import.meta.url)
const readVectors = async (name: string): Promise<unknown[][]> => JSON.parse(await readFile(new URL(name, directory), 'utf8')) as unknown[][]

test('F4Jumble inverse matches all eight pinned upstream vectors', async () => {
  const vectors = (await readVectors('f4jumble.json')).slice(2)
  assert.equal(vectors.length, 8)
  for (const [normal, jumbled] of vectors) assert.equal(Buffer.from(unjumble(Buffer.from(jumbled as string, 'hex'))).toString('hex'), normal)
})

test('full and incoming viewing scopes match 40 upstream key encodings', async () => {
  for (const [name, scope] of [['ufvk.json', 'full'], ['uivk.json', 'incoming']]) {
    const vectors = (await readVectors(name!)).slice(2)
    assert.equal(vectors.length, 20)
    for (const row of vectors) {
      const encoded = row[5] as string
      const report = inspectViewingCapability(encoded)
      assert.equal(report.status, 'recognized-encoding')
      assert.equal(report.scope, scope)
      assert.equal(report.network, 'mainnet')
      assert.ok(!JSON.stringify(report).includes(encoded))
      assert.ok(report.components.length > 0)
    }
  }
})

test('viewing inspector rejects checksum errors, foreign padding, and unsupported revisions', async () => {
  const encoded = (await readVectors('ufvk.json'))[2]![5] as string
  const { words } = bech32m.decode(encoded as `${string}1${string}`, 16384)
  assert.equal(inspectViewingCapability(encoded.slice(0, -1) + (encoded.endsWith('q') ? 'p' : 'q')).status, 'invalid-or-unsupported')
  assert.equal(inspectViewingCapability(bech32m.encode('uviewtest', words, 16384)).status, 'invalid-or-unsupported')
  assert.equal(inspectViewingCapability(bech32m.encode('uvf', words, 16384)).status, 'invalid-or-unsupported')
  assert.equal(inspectViewingCapability('uview1not-a-real-key').status, 'invalid-or-unsupported')
})

test('static analysis recognizes a structurally checked viewing-key literal without an SDK', async () => {
  const encoded = (await readVectors('ufvk.json'))[2]![5] as string
  const report = scanSources([{ path: 'app.ts', content: `const key=${JSON.stringify(encoded)};console.log(key);` }])
  assert.equal(report.findings[0]?.kind, 'viewing-key')
  assert.ok(!JSON.stringify(report).includes(encoded))
})

test('real canonical PCZT bytes expose an inventory of private fields without their values', async () => {
  const hex = (await readFile(new URL('synthetic-v6.pczt.hex', directory), 'utf8')).trim()
  const report = await inspectPcztDisclosure(hex, { recipient: 'support' })
  assert.equal(report.status, 'parsed-signer-projection')
  assert.equal(report.transactionVersion, 6)
  assert.equal(report.decision, 'reject')
  assert.ok(report.fields.some(field => field.category === 'note-randomness'))
  assert.ok(report.fields.some(field => field.category === 'counterparty-address'))
  assert.ok(report.fields.some(field => field.category === 'key-origin-fingerprint'))
  assert.ok(report.fields.some(field => field.category === 'transparent-outpoint'))
  assert.equal(report.projection?.fieldsInventoried, report.fields.length)
  assert.equal(report.coverage, 'signer-projection-only')
  assert.ok(!JSON.stringify(report).includes(hex))
  assert.ok(!JSON.stringify(report).includes('"spendValue":'))
})

test('prover disclosure requires explicit acknowledgment, without claiming the prover is blind', async () => {
  const hex = (await readFile(new URL('synthetic-v6.pczt.hex', directory), 'utf8')).trim()
  assert.equal((await inspectPcztDisclosure(hex, { recipient: 'prover' })).decision, 'reject')
  const acknowledged = await inspectPcztDisclosure(hex, { recipient: 'prover', acknowledgePrivateDisclosure: true })
  assert.equal(acknowledged.decision, 'explicit-private-role')
  assert.ok(acknowledged.warnings.some(warning => warning.includes('not blind')))
})

test('invalid PCZT bytes never produce an approved role decision', async () => {
  const report = await inspectPcztDisclosure('50435a5400000000', { recipient: 'signer', acknowledgePrivateDisclosure: true })
  assert.equal(report.status, 'invalid-or-unsupported')
  assert.equal(report.decision, 'reject')
})
