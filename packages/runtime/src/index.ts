import { access, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { chromium } from 'playwright-core'
import { sensitiveKinds } from '../../core/src/index.js'
import type {RuntimeOptions,RuntimeFinding,RuntimeReport} from './types.js'
export type {Canary,RuntimeAction,RuntimeOptions,RuntimeFinding,RuntimeReport} from './types.js'

function localUrl(value: string): URL {
  const url = new URL(value)
  if (!['http:', 'https:'].includes(url.protocol) || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || url.username || url.password) throw new Error('Runtime tests require an HTTP(S) loopback app URL without credentials.')
  return url
}

/** Resolve an already installed browser. This function never downloads one. */
export async function findBrowserPath(): Promise<string | undefined> {
  if (process.env.ZTRACE_BROWSER_PATH) { await access(process.env.ZTRACE_BROWSER_PATH); return process.env.ZTRACE_BROWSER_PATH }
  try { await access(chromium.executablePath()); return chromium.executablePath() } catch { /* Try an existing cache. */ }
  const cache = process.env.PLAYWRIGHT_BROWSERS_PATH ?? (process.platform === 'win32'
    ? join(process.env.LOCALAPPDATA ?? '', 'ms-playwright')
    : process.platform === 'darwin' ? join(process.env.HOME ?? '', 'Library', 'Caches', 'ms-playwright') : join(process.env.HOME ?? '', '.cache', 'ms-playwright'))
  try {
    const entries = (await readdir(cache)).filter(entry => /^chromium-\d+$/u.test(entry)).sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1]))
    for (const entry of entries) {
      const executable = process.platform === 'win32' ? join(cache, entry, 'chrome-win64', 'chrome.exe')
        : process.platform === 'darwin' ? join(cache, entry, 'chrome-mac', 'Chromium.app', 'Contents', 'MacOS', 'Chromium') : join(cache, entry, 'chrome-linux', 'chrome')
      try { await access(executable); return executable } catch { /* Continue searching the local cache. */ }
    }
  } catch { /* The caller receives a useful missing-browser error. */ }
  return undefined
}

/** Opt-in execution of a trusted LOCAL test app. All external HTTP and websocket destinations are blocked. */
export async function auditBrowser(options: RuntimeOptions): Promise<RuntimeReport> {
  const app = localUrl(options.url)
  if (!Array.isArray(options.canaries) || !options.canaries.length || options.canaries.length > 50) throw new Error('Provide between 1 and 50 synthetic canaries.')
  const names = new Set<string>()
  for (const canary of options.canaries) {
    if (canary.synthetic !== true || !/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/u.test(canary.name) || names.has(canary.name) || !sensitiveKinds.includes(canary.kind) || typeof canary.value !== 'string' || canary.value.length < 12 || canary.value.length > 10000) throw new Error('Invalid synthetic canary.')
    names.add(canary.name)
  }
  const timeout = options.timeoutMs ?? 10_000, settle = options.settleMs ?? 150
  if (!Number.isInteger(timeout) || timeout < 100 || timeout > 30_000 || !Number.isInteger(settle) || settle < 0 || settle > 2000) throw new Error('Invalid runtime time bounds.')
  if ((options.actions?.length ?? 0) > 100) throw new Error('At most 100 runtime actions are supported.')
  for (const action of options.actions ?? []) if (!['click', 'fill', 'waitFor'].includes(action.type) || typeof action.selector !== 'string' || (action.type === 'fill' && typeof action.value !== 'string')) throw new Error('Invalid runtime action.')
  const executablePath = options.browserPath ?? await findBrowserPath()
  if (!executablePath) throw new Error('No installed Chromium found. Set ZTRACE_BROWSER_PATH or browserPath. ZTrace does not download a browser automatically.')
  const patterns = options.canaries.flatMap(canary => [
    ['plain', canary.value], ['url', encodeURIComponent(canary.value)],
    ['base64', Buffer.from(canary.value).toString('base64')], ['base64url', Buffer.from(canary.value).toString('base64url')],
    ['hex', Buffer.from(canary.value).toString('hex')], ['json-escaped', JSON.stringify(canary.value).slice(1, -1)],
  ].map(([encoding, value]) => ({ canary, encoding: encoding!, value: value! })))
  const findings = new Map<string, RuntimeFinding>()
  const diagnostics = new Set<string>()
  const summary = { actionsCompleted: 0, requestsObserved: 0, requestsBlocked: 0, consoleEventsObserved: 0 }
  function destination(raw: string): string {
    if (raw === 'console://local') return 'local-console'
    let result: string
    try { result = new URL(raw).origin } catch { return 'unclassified-destination' }
    for (const pattern of patterns) result = result.replaceAll(pattern.value, '[redacted]')
    return result
  }
  function observe(channel: RuntimeFinding['channel'], text: string, rawDestination: string): boolean {
    let found = false
    const matched = new Set<string>()
    for (const pattern of patterns) if (text.includes(pattern.value) && !matched.has(pattern.canary.name)) {
      matched.add(pattern.canary.name)
      const item: RuntimeFinding = { channel, canary: pattern.canary.name, kind: pattern.canary.kind, encoding: pattern.encoding, destination: destination(rawDestination) }
      findings.set(`${channel}:${item.canary}:${item.destination}`, item)
      found = true
    }
    return found
  }
  const pending = new Set<Promise<unknown>>()
  const browser = await chromium.launch({ executablePath, headless: true })
  let completed = true
  try {
    const context = await browser.newContext({ serviceWorkers: 'block', acceptDownloads: false })
    context.setDefaultTimeout(timeout)
    await context.addInitScript(data => {
      Object.defineProperty(window, '__ZTRACE_TEST_DATA__', { value: data, writable: false, configurable: false })
    }, options.testData ?? {})
    await context.route('**/*', async route => {
      const request = route.request()
      summary.requestsObserved++
      let headers: Record<string, string>
      try { headers = await request.allHeaders() } catch { completed = false; diagnostics.add('UNREADABLE_REQUEST_HEADERS'); await route.abort().catch(() => {}); return }
      if (summary.requestsObserved > 1000) { completed = false; diagnostics.add('RUNTIME_REQUEST_LIMIT'); summary.requestsBlocked++; await route.abort().catch(() => {}); return }
      const text = [request.url(), JSON.stringify(headers), request.postData() ?? ''].join('\n')
      const exposed = observe('request', text, request.url())
      let local = false
      try { local = new URL(request.url()).origin === app.origin } catch { /* Reject non-HTTP requests. */ }
      if (exposed || !local) { summary.requestsBlocked++; await route.abort('blockedbyclient') }
      else {
        // Do not let redirects bypass request interception. Only this loopback origin is fetched.
        try {
          const response = await route.fetch({ maxRedirects: 0, timeout })
          if (response.status() >= 300 && response.status() < 400 && response.headers().location) {
            summary.requestsBlocked++
            diagnostics.add('REDIRECT_BLOCKED')
            completed = false
            await route.abort('blockedbyclient')
          } else await route.fulfill({ response })
        } catch {
          completed = false
          diagnostics.add('LOCAL_REQUEST_FAILED')
          await route.abort('failed').catch(() => {})
        }
      }
    })
    await context.routeWebSocket('**/*', socket => {
      // No connectToServer(): sockets terminate in this isolated test harness.
      socket.onMessage(message => observe('websocket', typeof message === 'string' ? message : message.toString('utf8'), socket.url()))
    })
    context.on('page', page => {
      page.on('console', message => {
        summary.consoleEventsObserved++
        const job = (async () => {
          const values = await Promise.all(message.args().map(async argument => {
            try { return JSON.stringify(await argument.jsonValue()) } catch { diagnostics.add('UNREADABLE_CONSOLE_ARGUMENT'); return '' }
          }))
          observe('console', values.join('\n'), 'console://local')
        })()
        pending.add(job)
        void job.finally(() => pending.delete(job))
      })
      page.on('pageerror', () => { diagnostics.add('APPLICATION_ERROR'); completed = false })
    })
    const page = await context.newPage()
    await page.goto(app.href, { waitUntil: 'domcontentloaded', timeout })
    for (const action of options.actions ?? []) {
      const locator = page.locator(action.selector)
      if (action.type === 'click') await locator.click()
      if (action.type === 'fill') await locator.fill(action.value)
      if (action.type === 'waitFor') await locator.waitFor({ state: 'visible' })
      summary.actionsCompleted++
    }
    // A bounded observation window is explicit; no claim is made about later activity.
    if (settle) await page.waitForTimeout(settle)
    await Promise.allSettled([...pending])
  } catch {
    completed = false
    diagnostics.add('RUNTIME_FLOW_INCOMPLETE')
  } finally {
    await browser.close()
  }
  return { schemaVersion: 1, mode: 'runtime-canary', completion: completed && !diagnostics.size ? 'completed' : 'incomplete', browserVersion: browser.version(),
    findings: [...findings.values()], diagnostics: [...diagnostics], summary,
    scope: 'Only supplied synthetic canaries, supported encodings, executed actions, and the bounded observation window were checked. External HTTP and all WebSocket upstream connections were blocked. No payloads, screenshots, HAR, or browser traces were retained.' }
}
