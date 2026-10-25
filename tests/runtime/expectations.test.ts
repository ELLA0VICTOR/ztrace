import assert from 'node:assert/strict'
import {createServer} from 'node:http'
import {test} from 'node:test'
import {auditBrowser} from '../../packages/runtime/src/index.js'

test('strict runtime expectations reject idle and partially exercised flows and accept a corrected exercised flow', async context => {
  const marker = 'ZTRACE_EXPECTATION_TEST_MARKER_849d3a'
  const server = createServer((request, response) => {
    response.setHeader('Content-Type', 'text/html')
    const code = request.url === '/idle' ? '' : `document.querySelector('#run').onclick=async()=>{const address=window.__ZTRACE_TEST_DATA__.nested.address;document.querySelector('#status').textContent=address;${request.url === '/partial' ? '' : "await window.__ZTRACE_CHECKPOINT__('checkout_complete');"}};`
    response.end(`<!doctype html><button id="run">Run</button><p id="status">Ready</p><script>${code}</script>`)
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  context.after(() => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())))
  const address = server.address()
  assert.ok(address && typeof address !== 'string')
  const base = `http://127.0.0.1:${address.port}`
  const reports = []
  for (const path of ['/idle', '/partial', '/safe']) {
    reports.push(await auditBrowser({url: base + path,
      canaries: [{name: 'address', kind: 'shielded-address', value: marker, synthetic: true}],
      testData: {nested: {address: marker}}, actions: [{type: 'click', selector: '#run'}], settleMs: 30,
      expectations: {canariesRead: ['address'], checkpoints: ['checkout_complete'], minActions: 1},
    }))
  }
  assert.equal(reports[0]!.completion, 'incomplete')
  assert.ok(reports[0]!.diagnostics.includes('CANARY_NOT_READ:address'))
  assert.equal(reports[1]!.completion, 'incomplete')
  assert.deepEqual(reports[1]!.execution?.canariesRead, ['address'])
  assert.ok(reports[1]!.diagnostics.includes('CHECKPOINT_NOT_REACHED:checkout_complete'))
  assert.equal(reports[2]!.completion, 'completed')
  assert.equal(reports[2]!.findings.length, 0)
  assert.equal(reports[2]!.execution?.expectationsSatisfied, true)
  assert.ok(!JSON.stringify(reports).includes(marker))
})

test('runtime rejects misspelled expectations before starting a browser', async () => {
  await assert.rejects(auditBrowser({url: 'http://127.0.0.1:1', canaries: [{name: 'address', kind: 'shielded-address', value: 'ZTRACE_SYNTHETIC_MARKER_098', synthetic: true}], expectations: {canariesRead: ['missing']}}))
})
