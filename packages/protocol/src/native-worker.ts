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
      seedFingerprint: 'key-origin-fingerprint',
    }
    let shieldedActions = 0
    for (const bundleName of ['orchardBundle', 'ironwoodBundle']) {
      const bundle = parsed[bundleName] as { actions?: Array<Record<string, unknown>> } | undefined
      if (!bundle?.actions) continue
      if (bundle.actions.length > 10000) throw new Error('Projection exceeds inventory limit.')
      shieldedActions += bundle.actions.length
      bundle.actions.forEach((action, index) => {
        for (const [key, category] of Object.entries(observed)) if (action[key] !== undefined && action[key] !== null) fields.push({ path: `${bundleName}.actions[${index}].${key}`, category })
      })
    }
    for (const name of ['transparentInputs', 'transparentOutputs']) {
      const items = parsed[name] as Array<Record<string, unknown>> | undefined
      if ((items?.length ?? 0) > 10000) throw new Error('Projection exceeds inventory limit.')
      items?.forEach((item, index) => {
        for (const [key, category] of Object.entries({value: 'transparent-value', scriptPubKey: 'transparent-script', prevoutTxid: 'transparent-outpoint', prevoutIndex: 'transparent-outpoint'})) {
          if (item[key] !== undefined && item[key] !== null) fields.push({path: `${name}[${index}].${key}`, category})
        }
        const derivation = item.derivation as Record<string, unknown> | undefined
        if (derivation) for (const [key, category] of Object.entries({signingPath: 'key-derivation-path', pubkey: 'linked-public-key', seedFingerprint: 'key-origin-fingerprint'})) {
          if (derivation[key] !== undefined && derivation[key] !== null) fields.push({path: `${name}[${index}].derivation.${key}`, category})
        }
      })
    }
    if (fields.length > 20000) throw new Error('Projection exceeds inventory limit.')
    const global = parsed.global as { txVersion?: number }
    output = { status: 'parsed-signer-projection', parser: '@ledgerhq/zcash-utils@2.8.0', transactionVersion: global.txVersion, fields,
      projection: {shieldedActions, transparentInputs: (parsed.transparentInputs as unknown[] | undefined)?.length ?? 0, transparentOutputs: (parsed.transparentOutputs as unknown[] | undefined)?.length ?? 0, fieldsInventoried: fields.length} }
  } catch {
    output = { status: parserAvailable ? 'invalid-or-unsupported' : 'parser-unavailable', fields: [] }
  }
  if (process.send) process.send(output, () => process.disconnect())
})
