import assert from 'node:assert/strict'
import {createServer} from 'node:http'
import {readFile, mkdir} from 'node:fs/promises'
import {resolve, extname, sep} from 'node:path'
import {chromium} from 'playwright-core'
import AxeBuilder from '@axe-core/playwright'
import {findBrowserPath} from '../../dist-tools/packages/runtime/src/index.js'

const root = resolve('dist')
const mime = {'.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.json': 'application/json'}
const server = createServer(async (request, response) => {
  try {
    const path = resolve(root, '.' + decodeURIComponent(new URL(request.url, 'http://localhost').pathname))
    if (path !== root && !path.startsWith(root + sep)) {response.writeHead(403).end(); return}
    const file = path === root ? resolve(root, 'index.html') : path
    response.setHeader('Content-Type', mime[extname(file)] ?? 'application/octet-stream')
    response.end(await readFile(file))
  } catch {response.writeHead(404).end()}
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const url = `http://127.0.0.1:${server.address().port}`
const browser = await chromium.launch({executablePath: await findBrowserPath(), headless: true})
const results = []
try {
  await mkdir('.artifacts/ui', {recursive: true})
  const context = await browser.newContext({viewport: {width: 1440, height: 1000}, reducedMotion: 'reduce', permissions: ['clipboard-read', 'clipboard-write']})
  const page = await context.newPage()
  const errors = [], external = [], requests = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('request', request => requests.push(request.url()))
  await page.route('**/*', route => {if (!route.request().url().startsWith(url)) {external.push(route.request().url()); return route.abort()}return route.continue()})
  await page.goto(url)
  await page.getByRole('heading', {name: 'Keep private wallet data out of public places.'}).waitFor()
  await page.evaluate(() => document.fonts.ready)
  await page.waitForTimeout(700)
  assert.equal(requests.some(request => request.includes('scanner.worker')), false, 'Scanner must be lazy-loaded')
  await page.screenshot({path: '.artifacts/ui/landing-desktop.jpg', type: 'jpeg', quality: 65})
  await page.getByRole('button', {name: 'Run local check'}).click()
  await page.getByRole('status').filter({hasText: 'Checked locally'}).waitFor({timeout: 30000})
  assert.match(await page.locator('.example-verdict').innerText(), /3 findings in 2 files/)
  await page.getByRole('button', {name: 'The correction', exact: true}).click()
  await page.getByRole('button', {name: 'Run local check'}).click()
  await page.getByRole('status').filter({hasText: 'Checked locally'}).waitFor({timeout: 30000})
  assert.match(await page.locator('.example-verdict').innerText(), /0 findings in 1 file/)
  results.push('Actual browser-worker analysis: leaking fixture 3 findings; corrected fixture 0')
  await page.getByRole('button', {name: 'Pause technology strip'}).click()
  assert.equal(await page.locator('.marquee').evaluate(element => getComputedStyle(element.firstElementChild).animationPlayState), 'paused')
  await page.locator('.faq-list summary').first().click()
  assert.equal(await page.locator('.faq-list details').first().getAttribute('open'), '')
  for (const id of ['problem', 'how-it-works', 'coverage', 'evidence']) {await page.locator('#' + id).scrollIntoViewIfNeeded(); await page.waitForTimeout(150)}
  await page.waitForTimeout(600)
  let accessibility = await new AxeBuilder({page}).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()
  assert.deepEqual(accessibility.violations.map(item => ({id: item.id, nodes: item.nodes.map(node => node.target)})), [], 'Desktop landing accessibility')
  results.push('Landing navigation, correction switch, marquee pause, FAQ, desktop WCAG checks')
  const docPages = ['introduction', 'quickstart', 'hands-on', 'cli', 'integration', 'coverage', 'runtime', 'protocol', 'evidence', 'boundaries', 'troubleshooting', 'releasing']
  for (const id of docPages) {
    await page.goto(url + '/#docs/' + id)
    await page.locator('.markdown-document h1').waitFor()
    assert.equal(await page.locator('.markdown-document h1').count(), 1)
    assert.equal(await page.locator('.header-cta').innerText(), 'Back')
    assert.equal(await page.locator('.header-cta').getAttribute('href'), '#')
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, id + ' desktop overflow')
    const toc = page.locator('.doc-toc button').first()
    if (await toc.count()) {await toc.click(); assert.ok(await page.evaluate(() => scrollY) > 0, 'TOC scrolls')}
  }
  await page.goto(url + '/#docs/quickstart')
  await page.locator('.markdown-document h1').waitFor()
  await page.locator('.doc-toc button').nth(3).click()
  await page.waitForFunction(() => document.querySelector('.doc-toc button[aria-current="location"]')?.textContent?.includes('Check your application'))
  const targetTop = await page.locator('#doc-4-check-your-application').evaluate(element => element.getBoundingClientRect().top)
  assert.ok(targetTop >= 110 && targetTop < 180, 'Section jump clears the header and selects the actual section')
  await page.getByRole('button', {name: 'Copy documentation code'}).first().click()
  assert.match(await page.evaluate(() => navigator.clipboard.readText()), /npm install\r?\nnpm run build:tools/)
  await page.screenshot({path: '.artifacts/ui/docs-desktop.jpg', type: 'jpeg', quality: 65})
  accessibility = await new AxeBuilder({page}).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()
  assert.deepEqual(accessibility.violations.map(item => ({id: item.id, nodes: item.nodes.map(node => node.target)})), [], 'Desktop documentation accessibility')
  await page.getByRole('link', {name: 'Skip to content'}).focus()
  await page.keyboard.press('Enter')
  assert.equal(new URL(page.url()).hash, '#docs/quickstart', 'Skip link must retain docs route')
  assert.equal(await page.evaluate(() => document.activeElement.id), 'main-content')
  results.push(`All ${docPages.length} docs routes, section navigation, real clipboard copy, keyboard skip link, docs WCAG checks`)
  await page.setViewportSize({width: 390, height: 844})
  await page.goto(url)
  await page.locator('.hero h1').waitFor()
  await page.waitForTimeout(700)
  await page.getByRole('button', {name: 'Open navigation'}).click()
  await page.getByRole('navigation', {name: 'Mobile navigation'}).waitFor()
  await page.keyboard.press('Escape')
  assert.equal(await page.getByRole('button', {name: 'Open navigation'}).evaluate(element => element === document.activeElement), true)
  for (const repeat of [0, 1]) {
    await page.getByRole('button', {name: 'Open navigation'}).click()
    await page.getByRole('navigation', {name: 'Mobile navigation'}).getByRole('link', {name: 'The problem', exact: true}).click()
    assert.equal(await page.getByRole('navigation', {name: 'Mobile navigation'}).count(), 0, `Mobile menu closes on navigation ${repeat}`)
  }
  await page.goto(url)
  await page.locator('.hero h1').waitFor()
  await page.waitForTimeout(700)
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
  await page.screenshot({path: '.artifacts/ui/landing-mobile.jpg', type: 'jpeg', quality: 65})
  accessibility = await new AxeBuilder({page}).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()
  assert.deepEqual(accessibility.violations.map(item => ({id: item.id, nodes: item.nodes.map(node => node.target)})), [], 'Mobile landing accessibility')
  for (const id of docPages) {
    await page.goto(url + '/#docs/' + id)
    await page.locator('.markdown-document h1').waitFor()
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, id + ' mobile overflow')
  }
  await page.selectOption('#documentation-page', 'introduction')
  await page.getByRole('heading', {name: 'Build privacy into the application layer'}).waitFor()
  await page.screenshot({path: '.artifacts/ui/docs-mobile.jpg', type: 'jpeg', quality: 65})
  accessibility = await new AxeBuilder({page}).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()
  assert.deepEqual(accessibility.violations.map(item => ({id: item.id, nodes: item.nodes.map(node => node.target)})), [], 'Mobile documentation accessibility')
  results.push('Mobile menu / Escape focus, all docs without page overflow, mobile docs selector and WCAG checks')
  await page.locator('.header-cta').click()
  await page.getByRole('heading', {name: 'Keep private wallet data out of public places.'}).waitFor()
  assert.match(await page.locator('.header-cta').innerText(), /Documentation/)
  assert.deepEqual(external, [], 'Site must not fetch external resources')
  assert.deepEqual(errors, [], 'No browser execution errors')
  await context.close()

  const motionContext = await browser.newContext({viewport: {width: 1440, height: 1000}})
  const motionPage = await motionContext.newPage()
  await motionPage.goto(url)
  await motionPage.locator('.scroll-heading').first().waitFor({state: 'attached'})
  await motionPage.evaluate(() => document.fonts.ready)
  const heading = motionPage.locator('.scroll-heading').first()
  const top = await heading.evaluate(element => element.getBoundingClientRect().top + scrollY)
  await motionPage.evaluate(top => scrollTo(0, top - innerHeight * .93), top)
  await motionPage.waitForTimeout(150)
  const before = await heading.locator('span').last().evaluate(element => getComputedStyle(element).color)
  await motionPage.evaluate(top => scrollTo(0, top - innerHeight * .2), top)
  await motionPage.waitForTimeout(150)
  const after = await heading.locator('span').last().evaluate(element => getComputedStyle(element).color)
  assert.notEqual(before, after, 'Scroll position drives text darkening')
  assert.equal(after, 'rgb(26, 26, 26)')
  for (const id of ['how-it-works', 'coverage', 'evidence']) {await motionPage.locator('#' + id).scrollIntoViewIfNeeded(); await motionPage.waitForTimeout(750); await motionPage.screenshot({path: `.artifacts/ui/${id}.jpg`, type: 'jpeg', quality: 65})}
  results.push('Normal-motion scroll-linked gray-to-black text, section reveal screenshots')
  await motionContext.close()
  console.log(JSON.stringify({passed: results, externalRequests: external.length, browserErrors: errors.length}, null, 2))
} finally {
  await browser.close()
  await new Promise(resolve => server.close(resolve))
}
