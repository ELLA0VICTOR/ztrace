import assert from 'node:assert/strict'
import {spawnSync} from 'node:child_process'
import {createHash} from 'node:crypto'
import {mkdir, readFile, writeFile} from 'node:fs/promises'
import {fileURLToPath} from 'node:url'

const worker = fileURLToPath(new URL('./worker.mjs', import.meta.url))
const results = []
for (const suite of ['sources', 'keys', 'pczt']) {
  const start = performance.now()
  const child = spawnSync(process.execPath, ['--max-old-space-size=256', worker, suite], {encoding: 'utf8', timeout: 30000, maxBuffer: 100000})
  assert.equal(child.status, 0, `${suite}: ${child.error?.message ?? ''}\n${child.stderr}`)
  results.push({...JSON.parse(child.stdout), milliseconds: Math.round(performance.now() - start)})
}
const engine = await readFile(new URL('../../dist-tools/packages/core/src/analyzer.js', import.meta.url))
const evidence = {generatedAt: new Date().toISOString(), engineSha256: createHash('sha256').update(engine).digest('hex'),
  scope: 'Deterministic synthetic mutation and resource-bound checks; each suite runs in a child process with a 30-second deadline and 256 MB JavaScript heap ceiling.',
  results, totalChecks: results.reduce((sum, result) => sum + result.checks, 0),
}
const directory = new URL('../../validation/adversarial/', import.meta.url)
await mkdir(directory, {recursive: true})
await writeFile(new URL('latest.json', directory), JSON.stringify(evidence, null, 2) + '\n')
console.log(JSON.stringify(evidence, null, 2))
