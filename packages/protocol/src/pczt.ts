import { fork } from 'node:child_process'
import { fileURLToPath } from 'node:url'

import type { PcztDisclosureOptions, PcztDisclosureReport } from './types.js'
export type { PcztDisclosureOptions, PcztDisclosureReport } from './types.js'

/** Never returns parsed note values, addresses, randomizers, or key bytes. */
export async function inspectPcztDisclosure(input: string | Uint8Array, options: PcztDisclosureOptions): Promise<PcztDisclosureReport> {
  const report: PcztDisclosureReport = { schemaVersion: 1, status: 'invalid-or-unsupported', fields: [], recipient: options.recipient, decision: 'reject', coverage: 'signer-projection-only',
    warnings: ['The parser exposes a signer projection, not every PCZT field. Absence from this inventory does not prove a field was redacted.', 'Viewing keys, Merkle witnesses, memos, and proprietary fields may not appear in the projection.'] }
  if (!['support', 'analytics', 'broadcast', 'prover', 'signer'].includes(options.recipient)) throw new Error('Unsupported recipient role.')
  const hex = typeof input === 'string' ? input : Buffer.from(input).toString('hex')
  if (!/^[\da-f]+$/iu.test(hex) || hex.length > 4_000_000 || hex.length % 2 || hex.slice(0, 8).toLowerCase() !== '50435a54') return report
  const result = await new Promise<Record<string, unknown>>(resolve => {
    const child = fork(fileURLToPath(new URL('./native-worker.js', import.meta.url)), [], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'], execArgv: ['--max-old-space-size=128'] })
    let finished = false
    const done = (value: Record<string, unknown>): void => {
      if (finished) return
      finished = true
      clearTimeout(timer)
      child.kill()
      resolve(value)
    }
    const timer = setTimeout(() => done({ status: 'parser-unavailable' }), 10_000)
    child.once('message', message => done(message as Record<string, unknown>))
    child.once('error', () => done({ status: 'parser-unavailable' }))
    child.once('exit', () => done({ status: 'parser-unavailable' }))
    child.send(hex, error => { if (error) done({ status: 'parser-unavailable' }) })
  })
  if (result.status !== 'parsed-signer-projection') {
    report.status = result.status === 'parser-unavailable' ? 'parser-unavailable' : 'invalid-or-unsupported'
    return report
  }
  report.status = 'parsed-signer-projection'
  report.parser = String(result.parser)
  report.transactionVersion = Number(result.transactionVersion)
  report.fields = result.fields as PcztDisclosureReport['fields']
  if (['prover', 'signer'].includes(options.recipient) && options.acknowledgePrivateDisclosure === true) {
    report.decision = 'explicit-private-role'
    report.warnings.push('The selected role receives private transaction information. A delegated prover learns private note data; this is not blind proof outsourcing.')
  } else report.warnings.push('PCZT bytes are not approved for this destination. Broadcast the extracted transaction; keep private construction data out of support and analytics.')
  return report
}
