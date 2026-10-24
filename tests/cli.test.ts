import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, readdir, readFile, rmdir, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

const cli = fileURLToPath(new URL('../packages/cli/src/cli.js', import.meta.url))
const examples = fileURLToPath(new URL('../../examples/', import.meta.url))
const fixtures = fileURLToPath(new URL('../../tests/fixtures/protocol/', import.meta.url))
const run = (...args: string[]) => spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', timeout: 15000 })

test('vulnerable example returns actual findings and CI failure', () => {
  const result = run('scan', join(examples, 'vulnerable'), '--format', 'json')
  assert.equal(result.status, 1, result.stderr)
  const report = JSON.parse(result.stdout)
  assert.deepEqual(report.findings.map((finding: { ruleId: string }) => finding.ruleId).sort(), ['ZT001', 'ZT002', 'ZT003'])
  assert.equal(report.summary.coverage, 'limited')
  assert.equal(report.diagnostics.length, 0)
})

test('corrected example returns zero findings and a limited-coverage result', () => {
  const result = run('scan', join(examples, 'safe'), '--format', 'json')
  assert.equal(result.status, 0, result.stderr)
  const report = JSON.parse(result.stdout)
  assert.equal(report.findings.length, 0)
  assert.equal(report.summary.coverage, 'limited')
})

test('unknown commands and missing paths return exit code 2', () => {
  assert.equal(run('wat').status, 2)
  assert.equal(run('scan', join(tmpdir(), 'ztrace-directory-that-does-not-exist')).status, 2)
  assert.equal(run('scan', '.', '--format', 'xml').status, 2)
})

test('PCZT CLI uses actual native parsing and keeps private-role acknowledgment separate', () => {
  const denied = run('inspect', 'pczt', join(fixtures, 'synthetic-v6.pczt.hex'), '--recipient', 'support')
  assert.equal(denied.status, 1)
  assert.equal(JSON.parse(denied.stdout).status, 'parsed-signer-projection')
  const accepted = run('inspect', 'pczt', join(fixtures, 'synthetic-v6.pczt.hex'), '--recipient', 'prover', '--acknowledge-private-disclosure')
  assert.equal(accepted.status, 0)
  assert.equal(JSON.parse(accepted.stdout).decision, 'explicit-private-role')
})

test('CLI auto-loads JSONC tsconfig aliases without executing configuration', async context => {
  const root = await mkdtemp(join(tmpdir(), 'ztrace-project-'))
  context.after(async () => { for (const entry of await readdir(root)) await unlink(join(root, entry)); await rmdir(root) })
  await writeFile(join(root, 'tsconfig.json'), `{ // jsonc metadata\n "compilerOptions":{"baseUrl":".","paths":{"@/*":["./*"]}}}`)
  await writeFile(join(root, 'app.ts'), `import {getNoirWallet} from '@noir-wallet/sdk';import {record} from '@/events';record((await getNoirWallet().zcash.getAccounts()).shielded);`)
  await writeFile(join(root, 'events.ts'), `export function record(value:unknown){console.log(value);}`)
  const result = run('scan', root, '--format', 'json')
  assert.equal(result.status, 1, result.stderr)
  assert.equal(JSON.parse(result.stdout).findings[0].sink.file, 'events.ts')
})

test('viewing-key CLI reports scope without returning the key', async context => {
  const root = await mkdtemp(join(tmpdir(), 'ztrace-key-'))
  context.after(async () => { for (const entry of await readdir(root)) await unlink(join(root, entry)); await rmdir(root) })
  const vectors = JSON.parse(await readFile(join(fixtures, 'uivk.json'), 'utf8'))
  const key = vectors[2][5] as string
  const path = join(root, 'viewing-key.txt')
  await writeFile(path, key)
  const result = run('inspect', 'key', path)
  assert.equal(result.status, 0, result.stderr)
  assert.equal(JSON.parse(result.stdout).scope, 'incoming')
  assert.ok(!result.stdout.includes(key))
})

test('CLI JSON policy, output, side-effect isolation, and incomplete coverage', async context => {
  const root = await mkdtemp(join(tmpdir(), 'ztrace-cli-'))
  context.after(async () => {
    for (const entry of await readdir(root)) await unlink(join(root, entry))
    await rmdir(root)
  })
  const source = join(root, 'app.ts')
  const output = join(root, 'report.json')
  const marker = join(root, 'should-not-exist.txt')
  const config = join(root, 'ztrace.config.json')
  await writeFile(source, `import { read } from 'private-wallet'; import { writeFileSync } from 'node:fs'; writeFileSync(${JSON.stringify(marker)}, 'executed'); console.log(read());`)
  await writeFile(config, JSON.stringify({ sources: [{ module: 'private-wallet', export: 'read', kind: 'viewing-key' }] }))
  const result = run('scan', root, '--format', 'json', '--output', output)
  assert.equal(result.status, 1, result.stderr)
  const report = JSON.parse(await readFile(output, 'utf8'))
  assert.equal(report.findings[0].kind, 'viewing-key')
  assert.ok(!(await readdir(root)).includes('should-not-exist.txt'))
  assert.equal(run('scan', root, '--format', 'json', '--output', output).status, 2, 'Existing reports must not be overwritten.')
  assert.equal(run('scan', root, '--output', source).status, 2, 'Source files must never be overwritten.')
  await writeFile(config, '{ malformed secret config: DO_NOT_ECHO_ME')
  const invalid = run('scan', root)
  assert.equal(invalid.status, 2)
  assert.ok(!invalid.stderr.includes('DO_NOT_ECHO_ME'))
  await writeFile(config, JSON.stringify({ sources: [], unexpectedOption: true }))
  assert.equal(run('scan', root).status, 2)
  await writeFile(config, '{}')
  await writeFile(source, 'switch (flag) { case true: break; }')
  const incomplete = run('scan', root, '--format', 'json', '--fail-on', 'never')
  assert.equal(incomplete.status, 2)
  assert.equal(JSON.parse(incomplete.stdout).summary.coverage, 'incomplete')
})
