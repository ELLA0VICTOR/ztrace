import type { SensitiveKind } from './types.js'

export const sensitiveKinds: SensitiveKind[] = [
  'shielded-address', 'wallet-account', 'wallet-balance', 'wallet-history',
  'viewing-key', 'spending-key', 'memo', 'pczt',
]

export const kindLabels: Record<SensitiveKind, string> = {
  'shielded-address': 'Shielded address',
  'wallet-account': 'Wallet account information',
  'wallet-balance': 'Wallet balance',
  'wallet-history': 'Wallet transaction history',
  'viewing-key': 'Viewing key',
  'spending-key': 'Spending key',
  memo: 'Private memo',
  pczt: 'Private transaction construction data',
}

export const loggingMethods = new Set(['log', 'info', 'warn', 'error', 'debug', 'trace', 'table', 'dir'])

export function isAnalyticsReference(reference: string): boolean {
  return /^import:(posthog-js|@segment\/analytics-next|@sentry\/(browser|react|node)):/u.test(reference)
    && /[.:](capture|track|identify|group|captureException|captureMessage|setUser|setContext)$/u.test(reference)
}
