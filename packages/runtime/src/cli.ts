import { readFile, writeFile, stat } from 'node:fs/promises'
import { resolve } from 'node:path'
import { auditBrowser } from './index.js'
import type { RuntimeOptions } from './index.js'

export async function runRuntimeCommand(args: string[]): Promise<number> {
  const spec = args.shift()
  if (!spec) throw new Error('Runtime requires a JSON test specification.')
  let output: string | undefined
  if (args.length) {
    if (args.shift() !== '--output' || !(output = args.shift()) || args.length) throw new Error('Unsupported runtime arguments.')
    if (!output.endsWith('.json')) throw new Error('Runtime output must be a new JSON report.')
  }
  if ((await stat(resolve(spec))).size > 1_000_000) throw new Error('Runtime specification exceeds size limit.')
  const source = await readFile(resolve(spec), 'utf8')
  const report = await auditBrowser(JSON.parse(source) as RuntimeOptions)
  const rendered = `${JSON.stringify(report, null, 2)}\n`
  if (output) await writeFile(resolve(output), rendered, { flag: 'wx' })
  else process.stdout.write(rendered)
  return report.completion === 'incomplete' ? 2 : report.findings.length ? 1 : 0
}
