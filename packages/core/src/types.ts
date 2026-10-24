export type SensitiveKind =
  | 'shielded-address'
  | 'wallet-account'
  | 'wallet-balance'
  | 'wallet-history'
  | 'viewing-key'
  | 'spending-key'
  | 'memo'
  | 'pczt'

export interface Location {
  file: string
  line: number
  column: number
}

export interface TraceStep extends Location {
  kind: 'source' | 'assignment' | 'call' | 'return' | 'sink'
  label: string
}

export interface SourceRule {
  /** Exact ES module specifier, as written in an import. */
  module: string
  export: string
  kind: SensitiveKind
  /** Optional dot path within the returned value; omitted means the whole result. */
  path?: string
}

export interface ScanOptions {
  sources?: SourceRule[]
  sinks?: SinkRule[]
  /** Exact HTTPS origins allowed to receive sensitive data. Logging stays checked. */
  allowedNetworkOrigins?: string[]
  maxSteps?: number
  moduleAliases?: Record<string, string[]>
  disclosurePolicies?: DisclosurePolicy[]
}

export interface SinkRule {
  module: string
  export: string
  kind: 'logging' | 'network' | 'analytics'
}

export interface DisclosurePolicy {
  origin: string
  pathname: string
  kinds: SensitiveKind[]
  /** Dot paths relative to request options, e.g. body.invoiceId. */
  fields: string[]
  reason: string
}

export interface Finding {
  id: string
  ruleId: 'ZT001' | 'ZT002' | 'ZT003'
  severity: 'error' | 'warning'
  kind: SensitiveKind
  title: string
  message: string
  source: TraceStep
  sink: TraceStep
  trace: TraceStep[]
  remediation: string
}

export interface Diagnostic extends Location {
  code: string
  message: string
}

export interface ScanReport {
  schemaVersion: 1
  toolVersion: '0.1.0'
  files: string[]
  findings: Finding[]
  diagnostics: Diagnostic[]
  summary: {
    filesScanned: number
    sourcesDetected: number
    errors: number
    warnings: number
    coverage: 'limited' | 'incomplete'
  }
}

export interface SourceFile {
  path: string
  content: string
}
