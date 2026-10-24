import { bech32m } from '@scure/base'
import { blake2b } from '@noble/hashes/blake2.js'

/** ZIP 316 F4Jumble inverse. Encoding transform only, not new cryptography. */
export function unjumble(input: Uint8Array): Uint8Array {
  if (input.length < 38 || input.length > 4_194_368) throw new Error('Invalid F4Jumble size.')
  const bytes = Uint8Array.from(input)
  const split = Math.min(64, Math.floor(bytes.length / 2))
  const left = bytes.subarray(0, split), right = bytes.subarray(split)
  const personal = (letter: 'H' | 'G', round: number, block = 0): Uint8Array => {
    const result = new Uint8Array(16)
    result.set(new TextEncoder().encode(`UA_F4Jumble_${letter}`))
    result.set([round, block & 255, block >>> 8], 13)
    return result
  }
  const h = (round: number): void => {
    const hash = blake2b(right, { dkLen: left.length, personalization: personal('H', round) })
    for (let i = 0; i < left.length; i++) left[i] = left[i]! ^ hash[i]!
  }
  const g = (round: number): void => {
    for (let offset = 0; offset < right.length; offset += 64) {
      const hash = blake2b(left, { dkLen: 64, personalization: personal('G', round, offset / 64) })
      for (let i = 0; i < Math.min(64, right.length - offset); i++) right[offset + i] = right[offset + i]! ^ hash[i]!
    }
  }
  h(1); g(1); h(0); g(0)
  return bytes
}

export interface ViewingCapabilityReport {
  schemaVersion: 1
  status: 'recognized-encoding' | 'invalid-or-unsupported'
  validation: 'checksum-padding-canonical-tlv-and-component-lengths-only'
  network?: 'mainnet' | 'testnet' | 'regtest'
  scope?: 'full' | 'incoming'
  components: Array<{ typecode: number; protocol: string; bytes: number }>
  capabilities: string[]
  warnings: string[]
}

/** Inspect revision-0 UFVK/UIVK structure without returning key bytes or derived addresses. */
export function inspectViewingCapability(encoded: string): ViewingCapabilityReport {
  const report: ViewingCapabilityReport = { schemaVersion: 1, status: 'invalid-or-unsupported', validation: 'checksum-padding-canonical-tlv-and-component-lengths-only', components: [], capabilities: [], warnings: [] }
  try {
    if (encoded.length > 16384 || encoded !== encoded.trim()) throw new Error('Size or whitespace.')
    const { prefix, words } = bech32m.decode(encoded as `${string}1${string}`, 16384)
    const prefixes: Record<string, ['full' | 'incoming', 'mainnet' | 'testnet' | 'regtest']> = {
      uview: ['full', 'mainnet'], uviewtest: ['full', 'testnet'], uviewregtest: ['full', 'regtest'],
      uivk: ['incoming', 'mainnet'], uivktest: ['incoming', 'testnet'], uivkregtest: ['incoming', 'regtest'],
    }
    const recognized = prefixes[prefix]
    if (!recognized) throw new Error('Unsupported prefix or revision.')
    const decoded = unjumble(bech32m.fromWords(words))
    const padding = new Uint8Array(16)
    padding.set(new TextEncoder().encode(prefix))
    if (!padding.every((byte, index) => decoded[decoded.length - 16 + index] === byte)) throw new Error('Network padding mismatch.')
    const data = decoded.subarray(0, decoded.length - 16)
    let offset = 0, previous = -1
    const compact = (): number => {
      const marker = data[offset++]
      if (marker === undefined) throw new Error('Truncated CompactSize.')
      if (marker < 253) return marker
      const size = marker === 253 ? 2 : marker === 254 ? 4 : 8
      if (offset + size > data.length) throw new Error('Truncated CompactSize.')
      let value = 0n
      for (let i = 0; i < size; i++) value |= BigInt(data[offset++]!) << BigInt(8 * i)
      if (value < (size === 2 ? 253n : size === 4 ? 65536n : 4294967296n) || value > 0x2000000n) throw new Error('Noncanonical or oversized CompactSize.')
      return Number(value)
    }
    let shielded = false
    while (offset < data.length) {
      const typecode = compact(), length = compact()
      if (typecode <= previous || offset + length > data.length || !length) throw new Error('Duplicate, unordered, or truncated item.')
      previous = typecode
      const knownLength = typecode === 0 ? 65 : typecode === 2 ? recognized[0] === 'full' ? 128 : 64 : typecode === 3 ? recognized[0] === 'full' ? 96 : 64 : undefined
      if (knownLength !== undefined && length !== knownLength) throw new Error('Invalid component size.')
      if (typecode >= 0xe0 && typecode <= 0xfc) throw new Error('MUST-understand metadata is invalid in revision 0.')
      if (typecode >= 2 && !(typecode >= 0xc0 && typecode <= 0xfc)) shielded = true
      report.components.push({ typecode, protocol: typecode === 0 ? 'transparent-p2pkh' : typecode === 2 ? 'sapling' : typecode === 3 ? 'orchard-family' : 'unknown', bytes: length })
      offset += length
    }
    if (!shielded || !report.components.length) throw new Error('Revision 0 needs a shielded item.')
    report.status = 'recognized-encoding'
    report.scope = recognized[0]
    report.network = recognized[1]
    report.capabilities = recognized[0] === 'full'
      ? ['Known viewing components can expose incoming activity and outgoing payment information.', 'Known shielded full-viewing components can support spend tracking.', 'Known viewing components do not grant spending authority; unknown components are not interpreted.']
      : ['Known incoming-viewing components can expose incoming payment information.', 'Known incoming-viewing components do not grant spending authority or full spend tracking; unknown components are not interpreted.']
    report.warnings = ['A viewing capability is reusable and is not inherently restricted to one invoice or one address.', 'Component group/field validity and ownership are not established by this structural inspection.']
    if (report.components.some(component => component.protocol === 'unknown')) report.warnings.push('Unknown components remain opaque; their authority was not interpreted.')
  } catch {
    report.components = []
    report.warnings = ['Invalid or unsupported encoding. No capability or safety conclusion was made.']
  }
  return report
}
