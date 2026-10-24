import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { auditBrowser } from '../../packages/runtime/src/index.js'

test('real Chromium observes leaks, accepts the corrected flow, and blocks delivery', async context => {
  const address = 'ZTRACE_TEST_ADDRESS_8f16743ec07c4ba7'
  const viewingKey = 'ZTRACE_TEST_VIEWINGKEY_96717a4ea009'
  let deliveredSensitiveRequests = 0
  const server = createServer((request, response) => {
    if (request.url === '/redirect') { response.writeHead(302, { location: 'https://external.example/redirect-target' }); response.end(); return }
    if (request.url?.startsWith('/collect')) {
      let body = ''
      request.on('data', chunk => { body += String(chunk) })
      request.on('end', () => { const data = body + JSON.stringify(request.headers); if (data.includes(address) || data.includes(viewingKey)) deliveredSensitiveRequests++; response.end('ok') })
      return
    }
    response.setHeader('content-type', 'text/html; charset=utf-8')
    const action = request.url === '/headers' ? `await fetch('/collect',{method:'POST',headers:{'X-Wallet':data.address},body:'public'}).catch(()=>{});`
      : request.url === '/safe' ? `console.info('checkout_ready');document.querySelector('#status').textContent=data.address;await fetch('/collect',{method:'POST',body:JSON.stringify({event:'ready'})});`
      : request.url === '/socket' ? `const socket=new WebSocket('wss://external.example/socket');socket.onopen=()=>socket.send(data.address);`
        : `console.debug({address:data.address});await fetch('https://external.example/collect',{method:'POST',body:btoa(data.address)}).catch(()=>{});await fetch('/collect',{method:'POST',body:JSON.stringify({key:data.viewingKey})}).catch(()=>{});`
    response.end(`<!doctype html><html><body><button id="run">Run</button><div id="status">Ready</div><script>const data=window.__ZTRACE_TEST_DATA__;document.querySelector('#run').onclick=async()=>{${action}};</script></body></html>`)
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  context.after(() => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())))
  const endpoint = server.address()
  assert.ok(endpoint && typeof endpoint !== 'string')
  const url = `http://127.0.0.1:${endpoint.port}`
  const canaries = [
    { name: 'address', value: address, kind: 'shielded-address' as const, synthetic: true as const },
    { name: 'viewing_key', value: viewingKey, kind: 'viewing-key' as const, synthetic: true as const },
  ]
  const reports = []
  for (const path of ['/leak', '/safe', '/socket', '/headers', '/redirect']) {
    reports.push(await auditBrowser({ url: url + path, canaries, testData: { address, viewingKey }, actions: path === '/redirect' ? [] : [{ type: 'click', selector: '#run' }], settleMs: 200 }))
  }
  const [leak, safe, socket] = reports
  assert.equal(leak!.completion, 'completed')
  assert.ok(leak!.findings.some(f => f.channel === 'console' && f.canary === 'address'))
  assert.ok(leak!.findings.some(f => f.channel === 'request' && f.encoding === 'base64'))
  assert.ok(leak!.findings.some(f => f.kind === 'viewing-key'))
  assert.equal(safe!.completion, 'completed')
  assert.equal(safe!.findings.length, 0)
  assert.ok(socket!.findings.some(f => f.channel === 'websocket'))
  assert.ok(reports[3]!.findings.some(f => f.channel === 'request' && f.canary === 'address'))
  assert.equal(reports[4]!.completion, 'incomplete')
  assert.ok(reports[4]!.diagnostics.includes('REDIRECT_BLOCKED'))
  assert.equal(deliveredSensitiveRequests, 0)
  assert.ok(!JSON.stringify(reports).includes(address))
  assert.ok(!JSON.stringify(reports).includes(viewingKey))
  const evidence = fileURLToPath(new URL('../../../runtime/evidence/', import.meta.url))
  await mkdir(evidence, { recursive: true })
  await writeFile(new URL('../../../runtime/evidence/latest.json', import.meta.url), JSON.stringify({ generatedAt: new Date().toISOString(), provenance: 'New executions of five local synthetic pages/flows in an installed Chromium; no wallet transaction was performed.', deliveredSensitiveRequests, reports }, null, 2) + '\n')
})

test('runtime refuses remote apps and canaries not declared synthetic', async () => {
  await assert.rejects(auditBrowser({ url: 'https://example.com', canaries: [] }))
  await assert.rejects(auditBrowser({ url: 'http://127.0.0.1:1234', canaries: [{ name: 'bad', kind: 'viewing-key', value: 'not-test-data-long-enough', synthetic: false as unknown as true }] }))
})
