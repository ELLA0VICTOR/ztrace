import {readFileSync} from 'node:fs'
import type {ScanReport, SensitiveKind} from '../../core/src/index.js'

export type ColorMode = 'auto' | 'always' | 'never'
type Tone = 'green' | 'red' | 'amber' | 'bold' | 'muted'
const codes: Record<Tone, number> = {green: 92, red: 91, amber: 93, bold: 1, muted: 90}

export function supportsColor(mode: ColorMode, stream: {isTTY?: boolean} = process.stdout, env: NodeJS.ProcessEnv = process.env): boolean {
  if (mode !== 'auto') return mode === 'always'
  if (env.NO_COLOR !== undefined) return false
  if (env.FORCE_COLOR !== undefined) return env.FORCE_COLOR !== '0'
  return !!stream.isTTY && env.TERM !== 'dumb'
}

function clean(text: string): string {
  let result = ''
  for (const character of text) {
    const code = character.codePointAt(0)!
    result += code < 32 || (code >= 127 && code <= 159) ? '?' : character
  }
  return result
}
const painter = (color: boolean) => (tone: Tone, text: string) => color ? `\u001b[${codes[tone]}m${text}\u001b[0m` : text

export function terminalHeader(color: boolean, columns = 80): string {
  const paint = painter(color)
  let logo = 'ZTRACE'
  if (columns >= 58) {
    try {logo = readFileSync(new URL('../../../../public/terminal-banner.txt', import.meta.url), 'utf8').trimEnd()} catch { /* Compact branding remains available. */ }
  }
  return `\n${paint('green', logo)}\n\n${paint('bold', 'ZTrace 0.1.0')}  ${paint('muted', 'Find wallet data leaving your application.')}\n`
}

const descriptions: Record<SensitiveKind, string> = {
  'shielded-address': 'shielded wallet address', 'wallet-account': 'linked account details',
  'wallet-balance': 'wallet balance', 'wallet-history': 'transaction history',
  'viewing-key': 'viewing key', 'spending-key': 'spending key', memo: 'private memo', pczt: 'private transaction construction data',
}

export function formatText(report: ScanReport, options: {color?: boolean; banner?: boolean; verbose?: boolean; columns?: number} = {}): string {
  const paint = painter(!!options.color)
  const count = (number: number, singular: string, plural = singular + 's') => `${number} ${number === 1 ? singular : plural}`
  const at = (location: {file: string; line: number; column: number}) => `${clean(location.file)}:${location.line}:${location.column}`
  const width = Math.max(32, options.columns ?? 80)
  const wrap = (text: string, prefix = '', continuation = prefix): string[] => {
    const result: string[] = []
    let line = prefix
    for (const word of text.split(/\s+/u)) {
      const space = line === prefix || line === continuation ? '' : ' '
      if (line.length + space.length + word.length > width && line !== prefix && line !== continuation) {result.push(line); line = continuation + word}
      else line += space + word
    }
    result.push(line)
    return result
  }
  const lines = [options.banner ? terminalHeader(!!options.color, options.columns) : paint('green', 'ZTrace · local privacy analysis'), '']
  const incomplete = report.summary.coverage === 'incomplete'
  if (report.findings.length) lines.push(paint('bold', `${count(report.findings.length, 'privacy finding')} to review`))
  else lines.push(paint(incomplete ? 'amber' : 'green', incomplete ? 'REVIEW REQUIRED · some code could not be checked' : 'NO FINDINGS · no modeled disclosures found'))
  lines.push(`${count(report.summary.filesScanned, 'file')} checked · ${count(report.summary.errors, 'error')} · ${count(report.summary.warnings, 'warning')}`, '')

  report.findings.forEach((finding, index) => {
    const tone = finding.severity === 'error' ? 'red' : 'amber'
    const destination = finding.ruleId === 'ZT001' ? 'logs' : finding.ruleId === 'ZT003' ? 'analytics' : 'a network destination'
    const explanation = finding.ruleId === 'ZT002'
      ? `The user's ${descriptions[finding.kind]} reaches a network destination that needs review.`
      : `The app sends the user's ${descriptions[finding.kind]} to ${destination}.`
    lines.push(paint(tone, `${index + 1}. ${finding.severity.toUpperCase()} ${finding.ruleId} · ${clean(finding.title)}`))
    lines.push(...wrap(explanation, '   '), `   Read at   ${at(finding.source)}`, `   Sent at   ${at(finding.sink)}`)
    if (options.verbose) {
      lines.push('   Data path:')
      for (const step of finding.trace) lines.push(`     ${step.kind.padEnd(10)} ${at(step)}  ${clean(step.label)}`)
    }
    const fix = options.verbose ? finding.remediation : finding.ruleId === 'ZT001'
      ? 'Log a public event name without the wallet value.'
      : finding.ruleId === 'ZT003' ? 'Remove wallet details from analytics. Send a public event name instead.'
        : ['viewing-key', 'spending-key'].includes(finding.kind) ? 'Keep this key local. Network approvals cannot authorize key disclosure.'
          : 'Remove private data from the request, or review and approve the exact destination and fields.'
    const correction = wrap(clean(fix), '   Fix      ', '            ')
    correction[0] = correction[0]!.replace('Fix', paint('green', 'Fix'))
    lines.push(...correction, '')
  })
  for (const diagnostic of report.diagnostics) lines.push(paint('amber', `REVIEW ${clean(diagnostic.code)} · ${at(diagnostic)}`), `   ${clean(diagnostic.message)}`, '')
  if (options.verbose) {
    lines.push(`Recognized wallet inputs: ${report.summary.sourcesDetected}`)
    if (report.modelCoverage) {
      lines.push(`Data categories: ${report.modelCoverage.sourceKinds.map(kind => descriptions[kind]).join(', ') || 'none'}`)
      for (const item of report.modelCoverage.imports) lines.push(`  ${item.model.padEnd(10)} ${clean(item.module)} · ${item.model === 'local' ? 'project source' : item.roles.join(', ') || 'no declared model'}`)
    }
  }
  lines.push(...wrap(incomplete
    ? 'Some paths need manual review. Resolve the notices before relying on this check.'
    : 'Coverage is limited to supported code paths. This check does not certify privacy.').map(line => paint('muted', line)))
  if (!options.verbose) lines.push(...wrap('Use --verbose to see every trace step and the wallet models recognized.').map(line => paint('muted', line)))
  return lines.join('\n') + '\n'
}
