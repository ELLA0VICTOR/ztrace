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
| `--format sarif` | SARIF 2.1.0 findings, locations, traces, and analysis notices. |
| `--verbose` | Include every trace step, wallet-input counts, and the model inventory. |
| `--color auto\|always\|never` | Select terminal color behavior; default is `auto`. |
| `--no-color` | Disable terminal colors. |
| `--output file` | Write a report to a new file. |
| `--config file` | Read a JSON policy; otherwise use `ztrace.config.json` at the scan root. |
| `--require-sources` | Require a recognized sensitive source. |
| `--allow-no-sources` | Explicitly permit source-free code; source recognition is otherwise required by default. |
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

## Reading terminal results

Interactive text reports show a green ZTRACE banner, a findings summary, and a plain-language explanation for each disclosure. Red marks errors; amber marks warnings and review notices. Each finding shows where the wallet value was read and where it was sent. Use `--verbose` for the full intermediate trace and recognized module models.

```sh
ztrace scan ./src
ztrace scan ./src --verbose
ztrace scan ./src --color always
```

Color is automatic in an interactive terminal. `NO_COLOR`, `FORCE_COLOR`, and explicit color flags are supported. Saved reports and JSON/SARIF output contain no ANSI styling. Narrow terminals use a compact wordmark.

## Installation banner and learning project

ZTrace's optional postinstall hook prints the wordmark and a starting command. It reads only its own banner/package metadata and performs no network access, writes, or subprocess execution. Installation also works with scripts disabled.

npm normally runs dependency lifecycle scripts in the background. Use `npm install --foreground-scripts` to show the banner during installation, as described in [npm's configuration reference](https://docs.npmjs.com/cli/v11/using-npm/config/#foreground-scripts). Script policies can suppress installation output. The CLI shows its own banner when run interactively.

From the source checkout, `npm run demo:prepare` packs the tool and creates a separate `ztrace-playground` folder beside the repository. It leaves installation to you, preserves existing directories, and writes a `READ-ME-FIRST.md` with exact PowerShell commands. A custom new location can be supplied using `npm run demo:prepare -- --destination /path/to/new-folder`. See [the hands-on guide](HANDS-ON.md).

## Code-scanning reports

Generate a SARIF report from the application checkout:

```sh
npx --no-install ztrace scan ./src --format sarif --output ztrace.sarif
```

The local ZTrace package must already be installed. File locations are relative to the command's working directory, so scanning `./src` produces `src/...` locations suitable for repository review. SARIF preserves rule severity, source-to-sink code flows, source requirements, and incomplete-analysis notices. Exit thresholds remain the same as text and JSON reports. Keep the scanner's exit status as a separate CI check even when another step uploads the report.

The export follows the [OASIS SARIF 2.1.0 standard](https://docs.oasis-open.org/sarif/sarif/v2.1.0/os/sarif-v2.1.0-os.html). [GitHub's supported SARIF properties](https://docs.github.com/en/code-security/reference/code-scanning/sarif-files/sarif-support) explain code-scanning ingestion and repository availability. Its upload action can populate fingerprints from repository source; ZTrace leaves fingerprint generation to that integration. No upload is performed by the CLI.

For an API integration:

```js
import {scanSources, toSarif} from 'ztrace/scanner'

const report = scanSources(sourceFiles, {requireSources: true})
const sarif = toSarif(report, {pathPrefix: 'src'})
```

Use source paths relative to the scan root. `pathPrefix` is the repository-relative path to that root. Absolute paths are rejected by the formatter to avoid embedding local machine directories. Reports retain names and locations but omit copied source snippets and literal payload values.

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
