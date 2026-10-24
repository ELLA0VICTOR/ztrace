# Troubleshooting

## PowerShell blocks npm

If PowerShell refuses to run `npm.ps1`, use `npm.cmd` instead. Do not change execution policy just to launch this project.

```powershell
npm.cmd install
npm.cmd run build:tools
npm.cmd run scan -- examples/vulnerable
```

## The leaking example exits with code 1

That is expected. The fixture contains three intentional disclosures. Code 1 means findings met the configured threshold. Code 2 means invalid input, an incomplete analysis, or another execution problem. Read both findings and diagnostics.

## No supported source files were found

Check the target path from your current terminal directory. ZTrace accepts TypeScript and JavaScript source extensions, skips declaration files and common dependency/build directories, and honors configured exclusions. The scanner does not apply `.gitignore` automatically.

## Imports or aliases need review

The CLI reads local JSON/JSONC tsconfig path metadata, local extends, and project references. Package-based extends and unsupported resolution patterns may require explicit `moduleAliases` in `ztrace.config.json`. Local CommonJS module resolution is not implemented; prefer supported ES-module imports or review the affected flow manually.

## A custom wallet or transport produces no finding

Unknown libraries are not automatically understood. Register exact imported source and sink functions in the JSON configuration. An unknown source may go unrecognized without a diagnostic, so the absence of findings is not proof of coverage. See [coverage and configuration](SCANNER.md).

## A report file already exists

Output files use exclusive creation to avoid silently replacing an existing report. Choose a fresh filename or deliberately manage old reports yourself.

## Runtime testing cannot find Chromium

The runtime harness does not download a browser automatically. Use an existing compatible Playwright Chromium installation, set `ZTRACE_BROWSER_PATH` to the browser executable, or provide `browserPath` through the API. The actual browser version is recorded in the report.

## My local app fails during a runtime test

Only the exact HTTP(S) loopback origin is fetched. External requests, upstream WebSockets, and redirects are blocked. Service workers are disabled. Bundle test assets locally and use a controlled test application with synthetic wallet data. Applications that depend on CDN scripts or a production wallet need a dedicated local test flow.

## A key or PCZT is not recognized

The key decoder supports documented revision-0 UFVK/UIVK encodings. It validates encoding structure, not account ownership or full cryptographic validity. The optional native PCZT parser must be installed and supported on your platform. PCZT inspection inventories a signer projection; it does not establish complete redaction. Inspect the report's diagnostics and read the [protocol limits](PROTOCOL.md).

## The landing-page example is slow on its first check

The TypeScript analysis engine loads only when you click **Run local check**. The page displays loading status while the browser starts its worker. The scanner runs outside the main UI thread. For a full project, use the local CLI.
