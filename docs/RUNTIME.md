# Local browser canary testing

`ztrace runtime` explicitly runs a trusted local test application in an isolated Chromium context. It observes supplied synthetic canaries in console arguments, HTTP URLs/headers/bodies, and WebSocket messages. Plain, URL-encoded, base64/base64url, hexadecimal, and JSON-escaped representations are checked.

The harness never downloads a browser automatically. It uses an existing Playwright Chromium installation, `ZTRACE_BROWSER_PATH`, or the API's `browserPath`. A compatible cached browser is acceptable, and the actual browser version is recorded in the report. No existing browser profile or wallet extension is loaded.

## Reproduce the integration tests

```sh
npm run test:runtime
```

This starts a disposable loopback server and executes five leaking, corrected, WebSocket, header, and redirect flows in a real installed Chromium. No production wallet is involved. The tests assert that the leaking pages produce observations, the corrected page produces none, redirects fail closed, and synthetic values do not reach the server collector. A compact report is saved to `runtime/evidence/latest.json`.

## Test your local app

```json
{
  "url": "http://127.0.0.1:5173",
  "canaries": [
    {
      "name": "customer_address",
      "kind": "shielded-address",
      "value": "ZTRACE_TEST_ADDRESS_8f16743ec07c4ba7",
      "synthetic": true
    }
  ],
  "testData": { "address": "ZTRACE_TEST_ADDRESS_8f16743ec07c4ba7" },
  "actions": [{ "type": "click", "selector": "[data-test=checkout]" }],
  "settleMs": 200
}
```

After building the tools:

```sh
node dist-tools/packages/cli/src/cli.js runtime ./ztrace.runtime.json
```

Your controlled application must wire the supplied synthetic values into its test flow, for example through `window.__ZTRACE_TEST_DATA__`, which is populated before application scripts run. ZTrace does not pretend to connect a real wallet. The example marker is intentionally synthetic, not a spendable Zcash address; applications that validate addresses should use genuine addresses from disposable test wallets and explicitly mark their canaries as synthetic.

Supported actions: `click`, `fill`, and `waitFor` with a selector. The API is also exported as `ztrace/runtime` for use from existing test suites. Runtime exit codes: 0 completed without observed canary exposure; 1 observed exposure; 2 incomplete/error. A zero result is not a privacy guarantee or evidence that all canaries were exercised.

## Network and data handling

- The initial app must use HTTP(S) loopback without URL credentials.
- Only that exact origin is fetched. External HTTP requests, sensitive matching requests, and upstream WebSocket connections are blocked. Redirects are blocked and make the flow incomplete, preventing a redirect from bypassing interception.
- Service workers are disabled; flows that depend on them need separate testing. CDN-dependent apps may not work under this restriction: bundle test assets locally.
- A fresh browser context is used; no screenshots, HAR, traces, or raw payloads are retained. Reports contain canary names/categories, matched representations, destination origins, counters, diagnostics, and browser version. Names and origins can still reveal context; keep reports local.
- The observation window is bounded. Hashing, encryption, compression, unsupported encodings, native code, and paths not exercised may evade canary matching. This is a test instrument, not a sandbox for hostile applications or a network anonymity system.
