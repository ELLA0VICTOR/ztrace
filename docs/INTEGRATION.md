# Install, detect, correct, verify

The consumer integration installs a packed ZTrace build into a fresh operating-system temporary directory. It compiles a React application using the published `@noir-wallet/sdk@0.1.9`, invokes the installed CLI, type-checks all package entry points, and exercises the application in Chromium.

## Run the complete walkthrough

From the ZTrace checkout:

```sh
npm ci
npm run test:package
```

Use an installed Chromium or set `ZTRACE_BROWSER_PATH` as described in the [runtime guide](RUNTIME.md). npm reuses its cache when possible. The test installs the consumer's dependencies, verifies missing-native-parser handling first, then installs optional dependencies for the application build.

The source application is in `integration/checkout`. The first install is deliberately outside this repository, preventing parent `node_modules` from filling in undeclared dependencies. Successful test runs remove their owned temporary installation after retaining evidence.

## The leaking flow

`src/leaking.ts` reads the connected account, balance, and history through the actual SDK. It then includes the address in a telemetry event, logs the available balance, and serializes history into a support request.

The installed CLI reports one finding each for analytics, logging, and network disclosure. The JSON policy registers the small consumer telemetry package as an explicit sink and requires all three source categories. The application itself, SDK wrapper, and telemetry implementation are compiled and executed.

## The correction

`src/corrected.ts` retains account, balance, and history in local state. Outbound events contain public status values. The corrected scan produces zero findings with the required source categories still recognized.

## Verify execution

Browser tests inject synthetic values at the extension-provider boundary. The published SDK performs its normal provider requests and response normalization. Required checkpoints confirm `zcash_getAccounts`, `zcash_getBalance`, `zcash_getTransactionHistory`, and completion of the checkout handler. Canary-read expectations confirm access to all three synthetic values.

The fixture enables its checkout handler only when the harness supplies its test data. Opening the application normally shows setup instructions, keeping the deliberately leaking variant confined to the synthetic workflow.

The leaking browser flow observes all three categories. The corrected flow completes its expectations with no observations. Sensitive matching requests are intercepted before delivery; the collector receives zero synthetic private values. These checks exercise SDK integration and application behavior without submitting a wallet transaction.

## Inspect the evidence

`validation/consumer/latest.json` records the package SHA-256, SDK version, static reports, browser version, execution expectations, observations, and collector result. It omits the synthetic value contents and temporary machine paths.

The package is retained under `.artifacts/release/` for local inspection. You can install that archive into another application using `npm install /path/to/ztrace-0.1.0.tgz`, then run `npx --no-install ztrace scan ./src --require-sources`.

## Upstream application observation

```sh
npm run test:external
```

This scans the unmodified Noir SDK example pinned in `validation/external/noir-sdk-source.json`. The script verifies file hashes and reuses its local source cache. Reports retain the original baseline and current observations separately.

Current candidate findings follow transaction-history values into a user-facing block-explorer link. They require review in the context of intentional navigation. Remaining diagnostics cover clipboard export, timer scheduling, and a bounded closure context. The report is an upstream example observation; its programs have no independently assigned safe/leaking labels.
