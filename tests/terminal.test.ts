import assert from 'node:assert/strict'
import {test} from 'node:test'
import {spawnSync} from 'node:child_process'
import {fileURLToPath} from 'node:url'
import {mkdtemp, readFile, rmdir, unlink} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {scanSources} from '../packages/core/src/index.js'
import {formatText, supportsColor, terminalHeader} from '../packages/cli/src/terminal.js'

const cli = fileURLToPath(new URL('../packages/cli/src/cli.js', import.meta.url))
const examples = fileURLToPath(new URL('../../examples/', import.meta.url))
const run = (...args: string[]) => spawnSync(process.execPath, [cli, ...args], {encoding: 'utf8', timeout: 15000, env: {...process.env, NO_COLOR: '', FORCE_COLOR: undefined}})
const escape = '\u001b['

test('terminal color respects interactive detection, explicit settings and no-color environments', () => {
  assert.equal(supportsColor('auto', {isTTY: true}, {}), true)
  assert.equal(supportsColor('auto', {isTTY: false}, {}), false)
  assert.equal(supportsColor('auto', {isTTY: true}, {NO_COLOR: ''}), false)
  assert.equal(supportsColor('auto', {isTTY: true}, {FORCE_COLOR: '0'}), false)
  assert.equal(supportsColor('auto', {isTTY: false}, {FORCE_COLOR: '1'}), true)
  assert.equal(supportsColor('always', {isTTY: false}, {NO_COLOR: ''}), true)
  assert.equal(supportsColor('never', {isTTY: true}, {FORCE_COLOR: '1'}), false)
  assert.ok(terminalHeader(true).includes(escape + '92m'))
  assert.ok(!terminalHeader(false, 40).includes('████'))
})

test('default reports explain disclosures and verbose reports retain every trace step', () => {
  const report = scanSources([{path: 'wallet.ts', content: 'const account=await window.noirwallet.zcash.getAccounts();console.log(account.shielded);'}])
  const simple = formatText(report)
  assert.match(simple, /1 privacy finding to review/)
  assert.match(simple, /The app sends the user's shielded wallet address to logs/)
  assert.match(simple, /1 file checked · 1 error · 0 warnings/)
  assert.ok(!simple.includes('Assigned to'))
  const verbose = formatText(report, {verbose: true})
  assert.match(verbose, /Assigned to account/)
  assert.match(verbose, /Data categories:/)
  const incomplete = formatText(scanSources([{path: 'wallet.ts', content: 'unknownWallet.read()'}], {requireSources: true}), {color: true})
  assert.match(incomplete, /REVIEW REQUIRED/)
  assert.ok(!incomplete.includes('NO FINDINGS'))
  const hostile = formatText(scanSources([{path: 'wallet\u001b[2J.ts', content: 'console.log((await window.noirwallet.zcash.getAccounts()).shielded)'}]))
  assert.ok(!hostile.includes(escape))
})

test('forced colors preserve severity and machine formats stay clean', () => {
  const colored = run('scan', join(examples, 'vulnerable'), '--color', 'always')
  assert.equal(colored.status, 1, colored.stderr)
  for (const code of [92, 91, 93]) assert.ok(colored.stdout.includes(escape + code + 'm'))
  assert.ok(colored.stdout.includes('████'))
  const plain = run('scan', join(examples, 'safe'), '--no-color')
  assert.equal(plain.status, 0)
  assert.match(plain.stdout, /NO FINDINGS/)
  assert.ok(!plain.stdout.includes(escape))
  for (const format of ['json', 'sarif']) {
    const result = run('scan', join(examples, 'vulnerable'), '--format', format, '--color', 'always')
    assert.equal(result.status, 1, result.stderr)
    assert.ok(!result.stdout.includes(escape))
    assert.doesNotThrow(() => JSON.parse(result.stdout))
  }
  assert.equal(run('--version', '--color', 'always').stdout, '0.1.0\n')
})

test('saved text remains uncolored even when terminal color is forced', async context => {
  const directory = await mkdtemp(join(tmpdir(), 'ztrace-terminal-'))
  const output = join(directory, 'report.txt')
  context.after(async () => {await unlink(output); await rmdir(directory)})
  const result = run('scan', join(examples, 'safe'), '--color', 'always', '--output', output)
  assert.equal(result.status, 0, result.stderr)
  const text = await readFile(output, 'utf8')
  assert.ok(!text.includes(escape))
  assert.ok(!text.includes('████'))
})
