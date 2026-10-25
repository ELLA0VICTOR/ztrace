# Understand ZTrace by using it

Zcash protects transaction information on the blockchain. An application can still copy wallet information into logs, analytics, or a support request. ZTrace helps developers find those paths in their application.

## What the example demonstrates

The leaking checkout reads wallet information and uses it in three ways that need attention:

| Information | Where it goes | Finding |
| --- | --- | --- |
| Balance | A console log | ZT001 |
| Transaction history | A support upload | ZT002 |
| Shielded address | An analytics service, through a helper in another file | ZT003 |

The corrected checkout keeps the wallet values locally and sends public status messages instead. The source files are analysis fixtures; scanning reads them without running their wallet calls.

## 1. Prepare a separate application

Run this in the ZTrace checkout:

```powershell
npm.cmd run demo:prepare
```

The command compiles and packs ZTrace, then creates `ztrace-playground` beside the repository. It does not install dependencies in that new project. Existing directories are preserved; choose another location with `-- --destination <new-path>` if needed.

## 2. Install the tool yourself

Open the new project's `READ-ME-FIRST.md`. Copy the first two PowerShell commands: enter the project and install the generated `.tgz` file. This installs ZTrace as a development dependency in a separate project, using the actual local release package.

The installation command includes `--foreground-scripts` so npm can display the banner. When lifecycle scripts are disabled or hidden, installation can still succeed and the CLI still works. This local release is available before public registry publication.

## 3. Read a finding

From the new project:

```powershell
npx.cmd --no-install ztrace scan ./leaking
```

Expect three findings. Read each explanation, then use the **Read at** and **Sent at** locations to find the relevant code. For the analytics finding, open `leaking/checkout.ts` and `leaking/telemetry.ts`: the address crosses the helper function before reaching PostHog.

The exit code is 1 because the example deliberately contains findings. Green identifies the tool and fixes; red marks errors; amber marks warnings that need a disclosure decision.

## 4. Compare the correction

```powershell
npx.cmd --no-install ztrace scan ./corrected
```

Expect no findings and exit code 0 for this supported example. Compare the files: the app still obtains wallet data, but reporting contains public status messages. A network finding can also represent a necessary disclosure; review its purpose before configuring an exact endpoint/field policy.

## 5. Follow the complete path

```powershell
npx.cmd --no-install ztrace scan ./leaking --verbose
```

The detailed report shows the wallet read, intermediate assignments and function calls, and disclosure destination. Recognized wallet-input counts describe data the scanner identified. Finding counts describe disclosures, so the two counts can differ.

After this walkthrough, use the [runtime guide](RUNTIME.md) to observe synthetic values in an executing app and the [protocol guide](PROTOCOL.md) to understand viewing-key and PCZT disclosure inspection.
