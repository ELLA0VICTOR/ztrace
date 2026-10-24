export interface PcztDisclosureOptions {
  recipient: 'support' | 'analytics' | 'broadcast' | 'prover' | 'signer'
  acknowledgePrivateDisclosure?: boolean
}
export interface PcztDisclosureReport {
  schemaVersion: 1
  status: 'parsed-signer-projection' | 'invalid-or-unsupported' | 'parser-unavailable'
  parser?: string
  transactionVersion?: number
  fields: Array<{ path: string; category: string }>
  recipient: PcztDisclosureOptions['recipient']
  decision: 'reject' | 'explicit-private-role'
  warnings: string[]
  coverage: 'signer-projection-only'
}
