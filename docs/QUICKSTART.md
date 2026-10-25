# Your first local check

Run ZTrace from its project checkout. You need **Node.js 24 or later** and npm. Static scanning does not require a wallet, Zcash node, browser, or connection to a blockchain.

## 1. Install and build

Open a terminal in the ZTrace directory:

```sh
npm install
npm run build:tools
```

On Windows PowerShell, use `npm.cmd` if your machine blocks the `npm.ps1` shim. You do not need to change your execution policy.

## 2. Scan the leaking example

```sh
npm run scan -- examples/vulnerable
```

The included example sends wallet information into logging, analytics, and a support upload. Expect **three findings** across two files. The process exits with code 1 because the example intentionally contains disclosures.

Each finding includes the sensitive source, the destination, a trace between them, and a suggested change. These are analysis fixtures; the scanner does not run their wallet calls.

## 3. Compare the correction

```sh
npm run scan -- examples/safe
```

The corrected example reports public event names and status values while retaining private wallet information locally. Expect no findings in this fixture. A clean result still has limited coverage; it does not certify an application as private.

## 4. Check your application

Supply a relative or absolute path to your own project:

```sh
npm run scan -- ../your-zcash-app
```

Run the command from the ZTrace checkout. The scanner reads supported source files under the target path. It skips common build and dependency directories, declaration files, and directory-entry symlinks. It does not apply `.gitignore`; configure explicit exclusions when needed.

## 5. Write a JSON report

After building the tools, invoke the CLI directly to avoid npm's extra terminal output:

```sh
node dist-tools/packages/cli/src/cli.js scan ../your-zcash-app --format json --output report.json
```

Use a new output filename. Reports omit raw source text but contain file paths, source/destination locations, and trace labels, which may still reveal project context. Keep them local unless you intend to share them.

## Next steps

- Follow the [hands-on installation walkthrough](HANDS-ON.md) in a separate application folder.
- Add [source and sink adapters](SCANNER.md) for custom libraries.
- Read [CLI options and CI integration](CLI.md) before automating checks.
- Exercise trusted local flows with [runtime testing](RUNTIME.md).
- Investigate setup problems in [troubleshooting](TROUBLESHOOTING.md).
