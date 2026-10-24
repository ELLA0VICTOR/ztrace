#!/usr/bin/env node
import { readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { dirname, extname, isAbsolute, join, matchesGlob, relative, resolve } from 'node:path'
import { scanSources, sensitiveKinds } from '../../core/src/index.js'
import type { ScanOptions, ScanReport, SourceFile, SourceRule } from '../../core/src/index.js'
import { projectAliases } from './project.js'

const usage = `ZTrace 0.1.0 — local Zcash privacy analysis

Usage: ztrace scan [path] [options]
       ztrace runtime <local-test-spec.json> [--output new-report.json]
       ztrace inspect key <local-file>
       ztrace inspect pczt <local-file> --recipient support|analytics|broadcast|prover|signer

  --format text|json       Report format (default: text)
  --output <file>          Write a report instead of printing it
  --config <file>          Read a JSON policy (default: ztrace.config.json)
  --fail-on warning|error|never
                          Finding threshold (default: warning)
  --help                  Show usage
  --version               Show version

Exit codes: 0 = no findings at the threshold; 1 = findings;
            2 = invalid input, incomplete coverage, or an analysis error.

A zero exit code is not a privacy certification. Only documented flows are modeled.
The scan command reads source as text. Runtime explicitly executes a local test app
with synthetic canaries and blocks external requests; it uses an installed browser.
`

interface Configuration extends ScanOptions { exclude?: string[] }

function parseConfiguration(value: unknown): Configuration {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Configuration must be a JSON object.')
  const data = value as Record<string, unknown>
  const known = new Set(['sources', 'sinks', 'allowedNetworkOrigins', 'maxSteps', 'exclude', 'moduleAliases', 'disclosurePolicies'])
  for (const key of Object.keys(data)) if (!known.has(key)) throw new Error(`Unknown configuration option: ${key}`)
  if (data.maxSteps !== undefined && (!Number.isInteger(data.maxSteps) || Number(data.maxSteps) < 100 || Number(data.maxSteps) > 1_000_000)) throw new Error('maxSteps must be an integer between 100 and 1000000.')
  for (const key of ['exclude', 'allowedNetworkOrigins']) {
    if (data[key] !== undefined && (!Array.isArray(data[key]) || !data[key].every(entry => typeof entry === 'string'))) throw new Error(`${key} must be an array of strings.`)
  }
  for (const origin of (data.allowedNetworkOrigins ?? []) as string[]) {
    const url = new URL(origin)
    if (url.protocol !== 'https:' || origin !== url.origin) throw new Error('Each allowedNetworkOrigins entry must be an exact HTTPS origin, without a path or credentials.')
  }
  if (data.sources !== undefined) {
    if (!Array.isArray(data.sources)) throw new Error('sources must be an array.')
    for (const item of data.sources) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error('Each source must be an object.')
      const rule = item as SourceRule
      if (typeof rule.module !== 'string' || !rule.module || typeof rule.export !== 'string' || !rule.export || !sensitiveKinds.includes(rule.kind)) throw new Error('Each source needs a module, export, and supported sensitive kind.')
      if (rule.path !== undefined && (typeof rule.path !== 'string' || !rule.path || !rule.path.split('.').every(part => /^[A-Za-z_$][\w$]*$/u.test(part)))) throw new Error('Source path must use dot-separated field names.')
      if (Object.keys(rule).some(key => !['module', 'export', 'kind', 'path'].includes(key))) throw new Error('Unknown source rule property.')
    }
  }
  if (data.moduleAliases !== undefined) {
    if (!data.moduleAliases || typeof data.moduleAliases !== 'object' || Array.isArray(data.moduleAliases)) throw new Error('moduleAliases must be an object.')
    for (const targets of Object.values(data.moduleAliases)) if (!Array.isArray(targets) || !targets.every(target => typeof target === 'string')) throw new Error('Module alias targets must be string arrays.')
  }
  if (data.sinks !== undefined) {
    if (!Array.isArray(data.sinks)) throw new Error('sinks must be an array.')
    for (const rule of data.sinks) {
      if (!rule || typeof rule !== 'object' || Array.isArray(rule) || typeof rule.module !== 'string' || !rule.module || typeof rule.export !== 'string' || !rule.export || !['logging', 'network', 'analytics'].includes(rule.kind) || Object.keys(rule).some(key => !['module', 'export', 'kind'].includes(key))) throw new Error('Invalid sink adapter.')
    }
  }
  if (data.disclosurePolicies !== undefined) {
    if (!Array.isArray(data.disclosurePolicies)) throw new Error('disclosurePolicies must be an array.')
    for (const policy of data.disclosurePolicies) {
      if (!policy || typeof policy !== 'object' || Array.isArray(policy)) throw new Error('Invalid disclosure policy.')
      const p = policy as Record<string, unknown>
      if (typeof p.origin !== 'string' || new URL(p.origin).origin !== p.origin || !p.origin.startsWith('https://') || typeof p.pathname !== 'string' || !p.pathname.startsWith('/') || typeof p.reason !== 'string' || !p.reason.trim()) throw new Error('A policy needs an exact HTTPS origin, pathname, and reason.')
      if (!Array.isArray(p.kinds) || !p.kinds.every(kind => sensitiveKinds.includes(kind)) || !Array.isArray(p.fields) || !p.fields.every(field => typeof field === 'string' && field.length > 0)) throw new Error('Invalid policy categories or fields.')
      if (Object.keys(p).some(key => !['origin', 'pathname', 'kinds', 'fields', 'reason'].includes(key))) throw new Error('Unknown policy property.')
    }
  }
  return data as Configuration
}

function formatText(report: ScanReport): string {
  const lines = ['ZTrace · local privacy analysis', '']
  for (const finding of report.findings) {
    lines.push(`${finding.severity.toUpperCase()} ${finding.ruleId}  ${finding.title}`)
    lines.push(`  ${finding.sink.file}:${finding.sink.line}:${finding.sink.column}`)
    for (const item of finding.trace) lines.push(`  ${item.kind.padEnd(10)} ${item.file}:${item.line}:${item.column}  ${item.label}`)
    lines.push(`  Fix: ${finding.remediation}`, '')
  }
  for (const diagnostic of report.diagnostics) lines.push(`REVIEW ${diagnostic.code}  ${diagnostic.file}:${diagnostic.line}:${diagnostic.column}\n  ${diagnostic.message}`)
  const { filesScanned, sourcesDetected, errors, warnings, coverage } = report.summary
  lines.push('', `${filesScanned} files · ${sourcesDetected} sensitive sources · ${errors} errors · ${warnings} warnings`)
  lines.push(coverage === 'incomplete' ? 'Coverage incomplete: review diagnostics before relying on this scan.' : 'Coverage limited to the documented models. No findings does not establish privacy.')
  return `${lines.join('\n')}\n`
}

async function main(): Promise<number> {
  const args = process.argv.slice(2)
  if (args.includes('--help') || args.includes('-h') || args.length === 0) { process.stdout.write(usage); return 0 }
  if (args.length === 1 && args[0] === '--version') { process.stdout.write('0.1.0\n'); return 0 }
  if (args[0] === 'runtime') return (await import('../../runtime/src/cli.js')).runRuntimeCommand(args.slice(1))
  if (args[0] === 'inspect') return (await import('../../protocol/src/cli.js')).runInspectCommand(args.slice(1))
  if (args.shift() !== 'scan') throw new Error('Expected the scan command. Use --help for usage.')
  let target = '.', format = 'text', failOn = 'warning'
  let output: string | undefined, configPath: string | undefined
  let positional = false
  while (args.length) {
    const arg = args.shift()!
    if (['--format', '--output', '--config', '--fail-on'].includes(arg)) {
      const value = args.shift()
      if (!value || value.startsWith('--')) throw new Error(`Missing value for ${arg}`)
      if (arg === '--format') format = value
      if (arg === '--output') output = value
      if (arg === '--config') configPath = value
      if (arg === '--fail-on') failOn = value
    } else if (arg.startsWith('-')) throw new Error(`Unknown option: ${arg}`)
    else if (positional) throw new Error('Only one scan path is supported.')
    else { target = arg; positional = true }
  }
  if (!['text', 'json'].includes(format)) throw new Error('--format must be text or json.')
  if (!['warning', 'error', 'never'].includes(failOn)) throw new Error('--fail-on must be warning, error, or never.')
  const absolute = resolve(target)
  const info = await stat(absolute)
  const root = info.isDirectory() ? absolute : dirname(absolute)
  const policyPath = configPath ? resolve(configPath) : join(root, 'ztrace.config.json')
  let configuration: Configuration = {}
  try { configuration = parseConfiguration(JSON.parse(await readFile(policyPath, 'utf8'))) }
  catch (error) { if (configPath || (error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
  const project = configuration.moduleAliases ? { aliases: configuration.moduleAliases, diagnostics: [] } : await projectAliases(root)
  configuration.moduleAliases = project.aliases
  const ignored = new Set(['node_modules', '.git', '.next', '.nuxt', '.turbo', '.vercel', 'dist', 'dist-tools', 'build', 'coverage'])
  const extensions = new Set(['.ts', '.tsx', '.js', '.jsx', '.mts', '.cts', '.mjs', '.cjs'])
  const files: SourceFile[] = []
  const skipped: string[] = []
  let total = 0
  async function walk(path: string): Promise<void> {
    const name = relative(root, path).replaceAll('\\', '/')
    if (configuration.exclude?.some(pattern => matchesGlob(name, pattern))) return
    const details = await stat(path)
    if (details.isDirectory()) {
      for (const entry of (await readdir(path, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
        if (entry.isSymbolicLink() || ignored.has(entry.name)) continue
        await walk(join(path, entry.name))
      }
    } else if (extensions.has(extname(path)) && !/\.d\.(?:ts|mts|cts)$/u.test(path)) {
      if (details.size > 1_000_000 || total + details.size > 20_000_000 || files.length >= 1000) { skipped.push(name); return }
      const content = await readFile(path, 'utf8')
      total += details.size
      files.push({ path: name, content })
    }
  }
  await walk(absolute)
  if (!files.length) throw new Error('No supported source files found. Check the scan path and excludes.')
  const report = scanSources(files, configuration)
  for (const code of project.diagnostics) report.diagnostics.push({ file: 'tsconfig.json', line: 1, column: 1, code, message: 'Some project path metadata could not be loaded. Provide explicit moduleAliases or review the project configuration.' })
  for (const file of skipped) report.diagnostics.push({ file, line: 1, column: 1, code: 'FILE_LIMIT', message: 'File skipped due to the file-size, total-size, or file-count limit.' })
  if (skipped.length || project.diagnostics.length) report.summary.coverage = 'incomplete'
  const rendered = format === 'json' ? `${JSON.stringify(report, null, 2)}\n` : formatText(report)
  if (output) {
    const destination = resolve(output)
    // Refuse to overwrite source or policy files, including files outside the target.
    if (extensions.has(extname(destination)) || destination === policyPath || files.some(file => resolve(root, file.path) === destination)) throw new Error('Report output must not overwrite source code or the policy file.')
    const inside = relative(root, destination)
    if (isAbsolute(inside)) throw new Error('Invalid output path.')
    await writeFile(destination, rendered, { encoding: 'utf8', flag: 'wx' })
  } else process.stdout.write(rendered)
  if (report.summary.coverage === 'incomplete') return 2
  return failOn === 'never' ? 0 : report.findings.some(finding => failOn === 'warning' || finding.severity === 'error') ? 1 : 0
}

main().then(code => { process.exitCode = code }).catch(() => {
  // Do not echo exception messages: malformed inputs and file paths may contain secrets.
  process.stderr.write('ZTrace could not complete the scan. Check the command, readable paths, JSON policy, and output destination. Use --help for usage.\n')
  process.exitCode = 2
})
