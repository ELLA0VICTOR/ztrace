# ZTrace

Catch privacy leaks before you ship.

ZTrace is local privacy tooling for JavaScript and TypeScript applications using Zcash: a reusable source-analysis engine, CLI, optional browser canary tests, and protocol disclosure inspectors. The `scan` command follows supported flows across local modules without executing the project. Runtime mode explicitly executes a trusted local test app using synthetic data and an isolated browser.

**Status: early development.** The scanner has bounded models, not a proof of privacy. A scan with no findings means that no modeled source-to-sink flow was found. Review coverage diagnostics and the [threat model](docs/THREAT-MODEL.md).

## Run locally

Node.js 24 or later. Dependencies are already installed in this starter workspace.

```sh
npm install
npm test
npm run benchmark
npm run test:runtime
npm run scan -- examples/vulnerable
npm run scan -- examples/safe
```

On Windows PowerShell with script execution disabled, use `npm.cmd` in place of `npm`. No execution-policy change is needed.

The vulnerable fixture produces three findings: an address sent to analytics through an imported helper, a logged balance, and history sent to a network endpoint. The corrected fixture produces zero findings. These are source-analysis examples using documented API shapes, not executed wallet transactions or claims of vulnerabilities in Noir itself.

## Scan a project

```sh
npm run scan -- "C:/path/to/your/app" --format json
npm run scan -- "C:/path/to/your/app" --format json --output report.json
```

Reports contain locations, source categories, trace labels, remediation advice, and coverage diagnostics. They omit source snippets, literal values, and request payloads. Paths and variable names can still be sensitive; keep reports local. Output files are created only when they do not already exist.

After `npm run build:tools`, CI can call the built CLI directly:

```sh
node dist-tools/packages/cli/src/cli.js scan ./your-app --format json
```

| Exit | Meaning |
| --- | --- |
| 0 | No findings at the selected threshold; only documented flows checked |
| 1 | Findings meet the selected threshold |
| 2 | Incomplete coverage, invalid input, or an analysis error |

Default threshold: any finding. `--fail-on error` excludes warnings from the finding threshold; `--fail-on never` leaves findings informational. Neither option turns incomplete coverage into a successful exit.

The development package is private and has not been published to npm. The React frontend is a product landing page and documentation site, with an interactive source-analysis example. It follows [the supplied design skill](apple_frontend_design_skill.md) and the Roster Finance visual reference.

## Open the landing page and documentation

```sh
npm run dev
```

Open the printed localhost URL. The landing page explains the product, supported checks, evidence, and limits. Its leaking/corrected example starts with engine-generated fixture reports; **Run local check** analyzes the fixture source in a browser worker without uploading it. Documentation includes introduction, quickstart, CLI integration, configuration, runtime tests, protocol inspection, methodology, threat model, and troubleshooting.

Use the CLI/API for your own projects, native artifact inspection, and runtime browser tests. The site does not upload project files, connect wallets, or store private keys. Fonts, documentation, and examples are self-hosted without analytics. Native scrolling, reduced-motion support, and responsive layouts keep the site usable without requiring animation. Font licenses are in `public/fonts`.

## Reuse the engine

```ts
import { scanSources } from 'ztrace/scanner'

const report = scanSources([
  { path: 'checkout.ts', content: checkoutSource },
  { path: 'telemetry.ts', content: telemetrySource },
])

console.log(report.summary)
```

This package self-reference works within the built repository. A future public package will expose the same entry point after packaging and release validation.

## Checks in this milestone

| Rule | Destination | Default severity |
| --- | --- | --- |
| ZT001 | Supported `console` logging methods | Error |
| ZT002 | `fetch` or `navigator.sendBeacon` without an approved origin | Warning; key disclosure is an error |
| ZT003 | Supported PostHog, Segment, and Sentry methods | Error |

Built-in sources cover selected Noir SDK, injected provider, RHEA React adapter, and Ledger utility APIs, plus structurally checked viewing-key literals. Models are tied to the [documented provider API](https://docs.zknoir.com/developers/provider-api/), [account shapes](https://docs.zknoir.com/developers/accounts-and-events/), and [integration security guidance](https://docs.zknoir.com/developers/security/). An ordinary variable called `balance` or `viewingKey` is not automatically considered a source.

See [coverage and configuration](docs/SCANNER.md) for source/sink adapters and narrow disclosure policies, [browser runtime tests](docs/RUNTIME.md), and [Zcash protocol inspection](docs/PROTOCOL.md).

## Measured evidence

The [60-case synthetic benchmark](benchmarks/latest.md) includes regression, integration-shaped, and challenge splits. Default models currently detect 28 of 30 labeled leaks, with zero findings on 30 labeled safe cases. The two remaining unknown-library cases are detected when their explicit adapters are supplied. This is case-level evidence for the named corpus, not a production coverage estimate; review diagnostics remain separate from detections.

Real Chromium tests exercise leaking and corrected local pages, check console/HTTP/WebSocket exposure, and verify that synthetic canaries are not delivered. [Retained runtime evidence](runtime/evidence/latest.json) records the actual browser version and outcomes without payload values. Protocol tests use eight upstream F4Jumble vectors, 40 upstream viewing-key encodings, and a locally generated synthetic V6 PCZT fixture. See [benchmark methodology](benchmarks/METHODOLOGY.md).

## Development checks

```sh
npm test
npm run lint
npm run build
```
