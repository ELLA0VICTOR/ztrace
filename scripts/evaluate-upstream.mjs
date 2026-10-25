import {createHash} from 'node:crypto'
import {mkdir, readFile, writeFile} from 'node:fs/promises'
import {fileURLToPath} from 'node:url'
import {join} from 'node:path'
import {scanSources} from '../dist-tools/packages/core/src/index.js'

const root = fileURLToPath(new URL('../', import.meta.url))
const manifest = JSON.parse(await readFile(join(root, 'validation/external/noir-sdk-source.json'), 'utf8'))
const cache = join(root, '.artifacts/upstream/noir-sdk')
await mkdir(cache, {recursive: true})
const sources = []
for (const file of manifest.files) {
  const local = join(cache, file.path.replaceAll('/', '__'))
  let bytes
  try {bytes = await readFile(local)} catch {
    const response = await fetch(file.url, {signal: AbortSignal.timeout(15000)})
    if (!response.ok) throw new Error('Pinned upstream source unavailable.')
    bytes = Buffer.from(await response.arrayBuffer())
    await writeFile(local, bytes)
  }
  if (createHash('sha256').update(bytes).digest('hex') !== file.sha256) throw new Error('Pinned upstream source hash mismatch.')
  if (/\.[jt]sx?$/.test(file.path)) sources.push({path: file.path, content: bytes.toString('utf8')})
}
const started = performance.now()
const report = scanSources(sources, {requireSources: true})
if (!report.modelCoverage?.requirementsSatisfied || !['shielded-address', 'wallet-balance', 'wallet-history'].every(kind => report.modelCoverage.sourceKinds.includes(kind))) throw new Error('Expected upstream source categories were not recognized.')
const evidence = {generatedAt: new Date().toISOString(), source: {repository: manifest.repository, commit: manifest.commit, files: manifest.files.map(({path, sha256}) => ({path, sha256}))},
  engineSha256: createHash('sha256').update(await readFile(join(root, 'dist-tools/packages/core/src/analyzer.js'))).digest('hex'),
  assessment: 'Unmodified, independently authored upstream SDK example. Findings are candidate disclosures for review; no production vulnerability or labeled accuracy estimate is asserted.',
  milliseconds: Math.round(performance.now() - started), report,
}
await writeFile(join(root, 'validation/external/noir-sdk-latest.json'), JSON.stringify(evidence, null, 2) + '\n')
console.log(JSON.stringify({files: sources.length, summary: report.summary, findings: report.findings.map(item => ({rule: item.ruleId, kind: item.kind, sink: item.sink})), diagnostics: report.diagnostics.map(item => ({code: item.code, line: item.line}))}, null, 2))
