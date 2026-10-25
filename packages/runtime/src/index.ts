import { access, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { chromium } from 'playwright-core'
import { sensitiveKinds } from '../../core/src/index.js'
import type {RuntimeOptions,RuntimeFinding,RuntimeReport} from './types.js'
export type {Canary,RuntimeAction,RuntimeOptions,RuntimeFinding,RuntimeReport,RuntimeExpectations} from './types.js'

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
  const expectations = options.expectations
  const validName = (value: unknown): value is string => typeof value === 'string' && /^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/u.test(value)
  if (expectations !== undefined) {
    if (!expectations || typeof expectations !== 'object' || Array.isArray(expectations) || Object.keys(expectations).some(key => !['canariesRead', 'checkpoints', 'minActions'].includes(key))) throw new Error('Invalid runtime expectations.')
    for (const list of [expectations.canariesRead, expectations.checkpoints]) if (list !== undefined && (!Array.isArray(list) || list.length > 100 || !list.every(validName))) throw new Error('Invalid runtime expectation names.')
    if (expectations.canariesRead?.some(name => !names.has(name))) throw new Error('Expected canary name is not declared.')
    if (expectations.minActions !== undefined && (!Number.isInteger(expectations.minActions) || expectations.minActions < 1 || expectations.minActions > 100)) throw new Error('Invalid expected action count.')
    if (!(expectations.canariesRead?.length || expectations.checkpoints?.length || expectations.minActions)) throw new Error('Provide at least one execution expectation.')
  }
  const canariesRead = new Set<string>(), checkpointsReached = new Set<string>()
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
  const started = Date.now()
  const browser = await chromium.launch({ executablePath, headless: true, timeout })
  let completed = true
  let deadlineTimer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<never>((_, reject) => {
    deadlineTimer = setTimeout(() => {completed = false; diagnostics.add('RUNTIME_DEADLINE'); reject(new Error('Runtime deadline exceeded.'))}, Math.max(1, timeout - (Date.now() - started)))
  })
  const execute = async () => {
    const context = await browser.newContext({ serviceWorkers: 'block', acceptDownloads: false })
    context.setDefaultTimeout(timeout)
    await context.exposeBinding('__ZTRACE_RUNTIME_SIGNAL__', (_source, signal: unknown) => {
      if (!signal || typeof signal !== 'object') return
      const item = signal as {type?: unknown; name?: unknown}
      if (!validName(item.name)) return
      if (item.type === 'canary-read' && names.has(item.name)) canariesRead.add(item.name)
      if (item.type === 'checkpoint' && expectations?.checkpoints?.includes(item.name)) checkpointsReached.add(item.name)
    })
    await context.addInitScript(({data, canaries, trackReads, checkpoints}) => {
      const target = window as unknown as Record<string, unknown>
      const pending = new Set<Promise<unknown>>()
      const sent = new Set<string>()
      const signal = (type: string, name: string): Promise<unknown> => {
        const key = `${type}:${name}`
        if ((type === 'checkpoint' && !checkpoints.includes(name)) || sent.has(key)) return Promise.resolve()
        sent.add(key)
        const send = target.__ZTRACE_RUNTIME_SIGNAL__ as (value: unknown) => Promise<unknown>
        const job = send({type, name}).catch(() => {})
        pending.add(job)
        void job.then(() => pending.delete(job))
        return job
      }
      if (trackReads) {
        const queue: object[] = [data], visited = new WeakSet<object>()
        while (queue.length) {
          const object = queue.pop()!
          if (visited.has(object)) continue
          visited.add(object)
          for (const key of Object.keys(object)) {
            let value = (object as Record<string, unknown>)[key]
            if (value && typeof value === 'object') queue.push(value)
            Object.defineProperty(object, key, {enumerable: true, configurable: true,
              get() {for (const canary of canaries) if (value === canary.value) void signal('canary-read', canary.name); return value},
              set(next: unknown) {value = next},
            })
          }
        }
      }
      Object.defineProperty(window, '__ZTRACE_TEST_DATA__', {value: data, writable: false, configurable: false})
      Object.defineProperty(window, '__ZTRACE_CHECKPOINT__', {value: (name: string) => signal('checkpoint', name), writable: false, configurable: false})
      Object.defineProperty(window, '__ZTRACE_FLUSH__', {value: () => Promise.allSettled([...pending]), writable: false, configurable: false})
    }, {data: options.testData ?? {}, canaries: options.canaries.map(({name, value}) => ({name, value})), trackReads: !!expectations?.canariesRead?.length, checkpoints: expectations?.checkpoints ?? []})
    await context.route('**/*', async route => {
      const request = route.request()
      summary.requestsObserved++
      let headers: Record<string, string>
      try { headers = await request.allHeaders() } catch { completed = false; diagnostics.add('UNREADABLE_REQUEST_HEADERS'); await route.abort().catch(() => {}); return }
      if (summary.requestsObserved > 1000) { completed = false; diagnostics.add('RUNTIME_REQUEST_LIMIT'); summary.requestsBlocked++; await route.abort().catch(() => {}); return }
      const body = request.postDataBuffer(), headerText = JSON.stringify(headers)
      if ((body?.byteLength ?? 0) + headerText.length + request.url().length > 1_000_000) {
        completed = false; diagnostics.add('RUNTIME_REQUEST_SIZE_LIMIT'); summary.requestsBlocked++
        await route.abort('blockedbyclient').catch(() => {}); return
      }
      const text = [request.url(), headerText, body?.toString('utf8') ?? ''].join('\n')
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
      observe('websocket', socket.url(), socket.url())
      socket.onMessage(message => observe('websocket', typeof message === 'string' ? message : message.toString('utf8'), socket.url()))
    })
    context.on('page', page => {
      page.on('console', message => {
        summary.consoleEventsObserved++
        if (summary.consoleEventsObserved > 1000) {completed = false; diagnostics.add('RUNTIME_CONSOLE_LIMIT'); return}
        // Chromium's JSON conversion drops Error, Map, Set, and binary contents.
        // Inspect data descriptors with explicit bounds, without invoking getters/toJSON.
        observe('console', message.text().slice(0, 1_000_000), 'console://local')
        if (message.text().length > 1_000_000) diagnostics.add('CONSOLE_INSPECTION_LIMIT')
        const job = (async () => {
          const args = message.args()
          if (args.length > 50) diagnostics.add('CONSOLE_INSPECTION_LIMIT')
          const values = await Promise.all(args.slice(0, 50).map(async argument => {
            try {
              const result = await argument.evaluate(value => {
                const queue: Array<{value: unknown; depth: number}> = [{value, depth: 0}], seen = new Set<object>(), chunks: string[] = []
                let count = 0, length = 0, limited = false, unreadable = false
                const append = (text: string) => {const room = Math.max(0, 1_000_000 - length); chunks.push(text.slice(0, room)); length += Math.min(room, text.length); if (text.length > room) limited = true}
                while (queue.length && count++ < 1000 && length < 1_000_000) {
                  const item = queue.shift()!, current = item.value
                  if (typeof current === 'string' || typeof current === 'number' || typeof current === 'bigint' || typeof current === 'boolean') {append(String(current)); continue}
                  if (!current || typeof current !== 'object' || seen.has(current)) continue
                  seen.add(current)
                  if (item.depth > 12) {limited = true; continue}
                  const enqueue = (next: unknown) => {if (queue.length < 1000) queue.push({value: next, depth: item.depth + 1}); else limited = true}
                  try {
                    if (current instanceof Map) {for (const [key, entry] of Map.prototype.entries.call(current)) {enqueue(key); enqueue(entry); if (queue.length >= 1000) {limited = true; break}}}
                    else if (current instanceof Set) {for (const entry of Set.prototype.values.call(current)) {enqueue(entry); if (queue.length >= 1000) {limited = true; break}}}
                    else if (current instanceof ArrayBuffer || ArrayBuffer.isView(current)) {
                      const bytes = current instanceof ArrayBuffer ? new Uint8Array(current) : new Uint8Array(current.buffer, current.byteOffset, current.byteLength)
                      if (bytes.byteLength > 1_000_000) limited = true
                      append(new TextDecoder().decode(bytes.subarray(0, 1_000_000)))
                      continue
                    }
                    for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(current))) {
                      append(key)
                      if ('value' in descriptor) enqueue(descriptor.value)
                      else if (descriptor.get && !(current instanceof Error && key === 'stack' && /\[native code\]/u.test(Function.prototype.toString.call(descriptor.get)))) unreadable = true
                      if (queue.length >= 1000 || length >= 1_000_000) {limited = true; break}
                    }
                  } catch {unreadable = true}
                }
                if (queue.length) limited = true
                return {text: chunks.join('\n'), limited, unreadable}
              })
              if (result.limited) diagnostics.add('CONSOLE_INSPECTION_LIMIT')
              if (result.unreadable) diagnostics.add('UNREADABLE_CONSOLE_ARGUMENT')
              return result.text
            } catch { diagnostics.add('UNREADABLE_CONSOLE_ARGUMENT'); return '' }
          }))
          observe('console', values.join('\n'), 'console://local')
        })()
        pending.add(job)
        void job.then(() => pending.delete(job), () => {pending.delete(job); diagnostics.add('UNREADABLE_CONSOLE_ARGUMENT')})
      })
      page.on('pageerror', error => {observe('console', error.message + '\n' + (error.stack ?? ''), 'console://local'); diagnostics.add('APPLICATION_ERROR'); completed = false})
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
    for (const observedPage of context.pages()) for (const frame of observedPage.frames()) {
      await frame.evaluate(async () => {
        const flush = (window as unknown as {__ZTRACE_FLUSH__?: () => Promise<unknown>}).__ZTRACE_FLUSH__
        if (flush) await flush()
      }).catch(() => {if (expectations) {completed = false; diagnostics.add('EXECUTION_SIGNALS_UNREADABLE')}})
    }
    await Promise.allSettled([...pending])
  }
  try {
    await Promise.race([execute(), deadline])
  } catch {
    completed = false
    diagnostics.add('RUNTIME_FLOW_INCOMPLETE')
  } finally {
    clearTimeout(deadlineTimer)
    await browser.close()
  }
  const expectationsSatisfied = (!expectations?.minActions || summary.actionsCompleted >= expectations.minActions)
    && (expectations?.canariesRead ?? []).every(name => canariesRead.has(name))
    && (expectations?.checkpoints ?? []).every(name => checkpointsReached.has(name))
  if (expectations?.minActions && summary.actionsCompleted < expectations.minActions) diagnostics.add('EXPECTED_ACTIONS_MISSING')
  for (const name of expectations?.canariesRead ?? []) if (!canariesRead.has(name)) diagnostics.add(`CANARY_NOT_READ:${name}`)
  for (const name of expectations?.checkpoints ?? []) if (!checkpointsReached.has(name)) diagnostics.add(`CHECKPOINT_NOT_REACHED:${name}`)
  return { schemaVersion: 1, mode: 'runtime-canary', completion: completed && !diagnostics.size ? 'completed' : 'incomplete', browserVersion: browser.version(),
    execution: {canariesRead: [...canariesRead].sort(), checkpointsReached: [...checkpointsReached].sort(), expectationsConfigured: !!expectations, expectationsSatisfied: expectations ? expectationsSatisfied : null},
    findings: [...findings.values()], diagnostics: [...diagnostics], summary,
    scope: 'Only supplied synthetic canaries, supported encodings, executed actions, and the bounded observation window were checked. External HTTP and all WebSocket upstream connections were blocked. No payloads, screenshots, HAR, or browser traces were retained.' }
}
