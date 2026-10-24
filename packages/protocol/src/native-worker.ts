// Native parsing is isolated in a child process. Only inventories leave this worker.
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)

process.once('message', (input: unknown) => {
  let output: Record<string, unknown>
  let parserAvailable = false
  try {
    if (typeof input !== 'string' || input.length > 4_000_000 || !/^[\da-f]+$/iu.test(input) || input.length % 2) throw new Error('Invalid input.')
    const metadata = require('@ledgerhq/zcash-utils/package.json') as { version: string }
    if (metadata.version !== '2.8.0') throw new Error('Unsupported parser version.')
    const native = require('@ledgerhq/zcash-utils') as { parsePczt(hex: string): Record<string, unknown> }
    parserAvailable = true
    const parsed = native.parsePczt(input)
    const fields: Array<{ path: string; category: string }> = []
    const observed: Record<string, string> = {
      spendRecipient: 'counterparty-address', recipient: 'counterparty-address',
      spendValue: 'note-value', value: 'note-value',
      spendRseed: 'note-randomness', rseed: 'note-randomness', spendRho: 'note-randomness',
      alpha: 'authorization-randomizer', rcv: 'value-commitment-opening', signingPath: 'key-derivation-path',
    }
    for (const bundleName of ['orchardBundle', 'ironwoodBundle']) {
      const bundle = parsed[bundleName] as { actions?: Array<Record<string, unknown>> } | undefined
      if (!bundle?.actions) continue
      bundle.actions.forEach((action, index) => {
        for (const [key, category] of Object.entries(observed)) if (action[key] !== undefined && action[key] !== null) fields.push({ path: `${bundleName}.actions[${index}].${key}`, category })
      })
    }
    for (const name of ['transparentInputs', 'transparentOutputs']) {
      const items = parsed[name] as Array<Record<string, unknown>> | undefined
      items?.forEach((item, index) => { if (item.derivation) fields.push({ path: `${name}[${index}].derivation`, category: 'key-derivation-path' }) })
    }
    const global = parsed.global as { txVersion?: number }
    output = { status: 'parsed-signer-projection', parser: '@ledgerhq/zcash-utils@2.8.0', transactionVersion: global.txVersion, fields }
  } catch {
    output = { status: parserAvailable ? 'invalid-or-unsupported' : 'parser-unavailable', fields: [] }
  }
  if (process.send) process.send(output, () => process.disconnect())
})
