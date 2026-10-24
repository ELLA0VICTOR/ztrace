# CLI and local integration

All commands below run from the ZTrace checkout after `npm run build:tools`. This release is not published to a public package registry.

## Scan commands

```sh
node dist-tools/packages/cli/src/cli.js scan ./path/to/app
node dist-tools/packages/cli/src/cli.js scan ./path/to/app --format json --output report.json
node dist-tools/packages/cli/src/cli.js scan ./path/to/app --config ./policy.json --fail-on error
```

| Option | Behavior |
| --- | --- |
| `--format text` | Human-readable findings and coverage diagnostics; default. |
| `--format json` | Structured scan report. |
| `--output file` | Write a report to a new file. |
| `--config file` | Read a JSON policy; otherwise use `ztrace.config.json` at the scan root. |
| `--fail-on warning` | Fail on warnings or errors; default. |
| `--fail-on error` | Fail on errors. Warnings remain in the report. |
| `--fail-on never` | Do not fail on findings. Incomplete coverage still requires review. |
| `--help` | Show supported commands and options. |
| `--version` | Print the development version. |

## Exit codes and CI

| Code | Meaning |
| --- | --- |
| `0` | No finding meets the configured threshold; documented coverage remains limited. |
| `1` | Findings meet the threshold. |
| `2` | Invalid input, incomplete analysis, or an execution error. |

Build and run the scanner in a CI job that has access to the ZTrace checkout. Preserve the command's exit status instead of treating an emitted JSON file as success. Review diagnostics as well as findings.

```sh
npm ci
npm run build:tools
node dist-tools/packages/cli/src/cli.js scan ../application --format json --output privacy-report.json
```

Use a fresh output path per run. A zero exit status means only that the supported analysis did not produce findings at the selected threshold.

## Scanner API

The package exports `ztrace/scanner`, `ztrace/runtime`, and `ztrace/protocol`. From a local script in this checkout, you can use the compiled scanner directly:

```js
import {scanSources} from './dist-tools/packages/core/src/index.js'

const report = scanSources([
  {path: 'app.ts', content: sourceText},
], {
  sources: [
    {module: 'my-wallet', export: 'readAddress', kind: 'shielded-address'},
  ],
})

console.log(report.summary)
```

The API accepts source text and analysis options. Unlike the CLI, it does not discover project files or read tsconfig metadata for you. Supply local module aliases explicitly when calling the engine directly. An application integrating the local package must arrange its own local package resolution; public installation commands are not available in this release.

## Runtime and artifact commands

```sh
node dist-tools/packages/cli/src/cli.js runtime ./ztrace.runtime.json --output runtime-report.json
node dist-tools/packages/cli/src/cli.js inspect key ./viewing-key.txt
node dist-tools/packages/cli/src/cli.js inspect pczt ./transaction.pczt --recipient support
```

Runtime testing executes a trusted local application with synthetic canaries. Inspect commands read local artifacts. Follow the [runtime guide](RUNTIME.md) and [protocol guide](PROTOCOL.md) for requirements and disclosure limits.
