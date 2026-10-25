import assert from 'node:assert/strict'
import {spawnSync} from 'node:child_process'
import {createServer} from 'node:http'
import {mkdir, readFile, realpath} from 'node:fs/promises'
import {dirname, extname, join, resolve, sep} from 'node:path'
import {fileURLToPath} from 'node:url'
import {chromium} from 'playwright-core'
import {findBrowserPath} from '../../dist-tools/packages/runtime/src/index.js'

const root = fileURLToPath(new URL('../../', import.meta.url))
const out = join(root, '.artifacts/pages')
await mkdir(out, {recursive: true})
if (dirname(await realpath(out)) !== await realpath(join(root, '.artifacts'))) throw new Error('Build output boundary mismatch.')
const build = spawnSync(process.execPath, [join(root, 'node_modules/vite/bin/vite.js'), 'build', '--base=/ztrace/', '--outDir', out, '--emptyOutDir'], {cwd: root, encoding: 'utf8', timeout: 60000, maxBuffer: 1000000})
assert.equal(build.status, 0, build.stderr)
const prefix = '/ztrace/'
const types = {'.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.png': 'image/png'}
const server = createServer(async (request, response) => {
  const pathname = new URL(request.url, 'http://localhost').pathname
  if (!pathname.startsWith(prefix)) {response.writeHead(404).end(); return}
  const file = resolve(out, decodeURIComponent(pathname.slice(prefix.length)) || 'index.html')
  if (!file.startsWith(out + sep)) {response.writeHead(403).end(); return}
  try {response.setHeader('Content-Type', types[extname(file)] ?? 'application/octet-stream'); response.end(await readFile(file))}
  catch {response.writeHead(404).end()}
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const browser = await chromium.launch({executablePath: await findBrowserPath(), headless: true})
try {
  const page = await browser.newPage({viewport: {width: 1280, height: 900}, reducedMotion: 'reduce'})
  const failures = []
  page.on('response', response => {if (response.status() >= 400) failures.push(response.url())})
  page.on('pageerror', error => failures.push(error.message))
  const origin = `http://127.0.0.1:${server.address().port}`
  await page.goto(origin + prefix)
  await page.locator('.hero h1').waitFor()
  await page.evaluate(() => document.fonts.ready)
  await page.waitForFunction(() => [...document.querySelectorAll('.technology-logo')].every(image => image.complete && image.naturalWidth > 0))
  assert.equal(await page.evaluate(() => document.fonts.check('500 16px "Space Grotesk"')), true)
  await page.getByRole('button', {name: 'Run local check'}).click()
  await page.getByRole('status').filter({hasText: 'Checked locally'}).waitFor()
  await page.goto(origin + prefix + '#docs/integration')
  await page.getByRole('heading', {name: 'Install, detect, correct, verify', exact: true}).waitFor()
  assert.ok(await page.locator('.markdown-document').isVisible())
  assert.deepEqual(failures, [], 'Subpath assets and lazy chunks must load successfully')
  console.log('PASS: /ztrace/ deployment base, fonts, all brand images, lazy worker analysis, and lazy documentation.')
} finally {await browser.close(); await new Promise(resolve => server.close(resolve))}
