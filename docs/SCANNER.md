# Scanner coverage and configuration

## Source models

The Noir adapter recognizes the actual import binding of `getNoirWallet` from `@noir-wallet/sdk`, including named aliases and namespace imports. A method with the same name on an unrelated object is not recognized as Noir.

| Method on `wallet.zcash` | Sensitive result |
| --- | --- |
| `connect`, `getAccounts` | `shielded` address; linked `transparent` address; authorized `accounts` records |
| `getAddresses` | `shielded` address and linked `transparent` address |
| `getBalance`, `getMaxTransfer` | Result and its fields, conservatively treated as wallet financial data |
| `getTransactionHistory` | Result and its fields, including private history/memos |
| `getPublicKey` | Linked `pubkey`, `address`, and `originAddress` fields |
| `checkLendingMcaAccount` | Linked `mcaId` and `publicKey` fields |

Additional sources now include `window.noirwallet.zcash`, imported `useWallet` from the RHEA adapter root or `/react` entry point, and constructed `NoirZcashWalletAdapter` clients. Hook fields `shieldedAddress`, `transparentAddress`, `accounts`, and `balance` carry sensitivity; `isConnected` does not. The `accountsChanged` callback is modeled as potentially receiving account addresses. These are syntactic/API models, not a claim that every extension version or transport implements the same capabilities.

Ledger adapter sources: `parsePczt` results, `pcztHex` from `buildTransaction`/`buildIronwoodTransaction`, decrypted `startSync().next()` results, and `ufvk`/`xpub` from the test-only key derivation helper. A direct, structurally valid revision-0 UFVK/UIVK string literal is also recognized using the protocol decoder; arbitrary variable names are not source rules.

Raw RPC response schemas, arbitrary injected providers, and unknown SDKs still require explicit source adapters. Binary inspection is available separately through `ztrace inspect`; its signer-projection limits are described in [PROTOCOL.md](PROTOCOL.md).

## Supported flows

ES module imports between scanned files; local functions and returned values; variables and reassignments; object/array fields and rest/spread destructuring; object aliases; conditional branch joins and possible call targets; async/await; basic `Promise.all`/`Promise.resolve`; direct `.then`, `.map`, `.filter`, `.flatMap`, and `.forEach` callbacks; string interpolation; JSON serialization; common string transformations. Encoding, trimming, and replacing text do not remove sensitivity.

Common application constructs now modeled: nullable providers, short-circuit and logical assignment, expression order, definite constant branches, local class constructors/methods/parameter properties, React state/ref/effect/memo/callback hooks, JSX event handlers, local components, resource URL attributes, and bounded loops. Hook/effect/event behavior is a conservative possible-flow model, not a React scheduler simulation. Rendering a balance or address as local text is not automatically treated as exfiltration.

Finite loops are expanded up to 128 iterations; symbolic collections use bounded source-state propagation. Nonconvergence, labeled/ambiguous loop control, and limits produce review diagnostics. The core API accepts `moduleAliases`; the CLI also reads path metadata from root JSON/JSONC tsconfig files, local extends, and project references. Package-based extends, inheritance, and accessors require review.

Analysis is conservative: both unknown conditional branches are considered, and array callback elements can be combined. Constant branches can be pruned, but general reachability is not proved. Direct, known JSON stringify/parse round trips retain fields; arbitrary serialization or library transformations can still lose precision.

Inheritance, accessors, recursive expansion, dynamic code, complex framework lifecycles, dynamic module loading, and arbitrary library internals are not fully modeled. Detected unsupported syntax, unresolved local imports, unknown calls receiving sensitive inputs/callbacks, and exhausted budgets produce review diagnostics. Dynamic console methods are treated as possible supported loggers and also require review. Only selected unsupported cases can be detected. An unrecognized source may produce no diagnostics at all: coverage always remains limited.

This is not a general JavaScript runtime or a complete taint-analysis system. It does not analyze implicit control-flow disclosure, timing, address reuse, network metadata, or cryptographic soundness.

External CommonJS `require` bindings can use the known SDK/logger/transport models and explicit adapters. Local `require` plus `module.exports` resolution is not implemented and produces review diagnostics. ES-module local imports provide the full supported cross-file path.

## Destination models

- Global `console.log`, `info`, `warn`, `error`, `debug`, `trace`, `table`, and `dir`.
- Global `fetch`, `window.fetch`, `globalThis.fetch`, and `navigator.sendBeacon`.
- Direct/namespace calls to `capture`, `track`, `identify`, `group`, `captureException`, `captureMessage`, `setUser`, and `setContext` on imports from `posthog-js`, `@segment/analytics-next`, `@sentry/browser`, `@sentry/react`, or `@sentry/node`.

Additional destinations: Segment `AnalyticsBrowser.load(...).track(...)`, direct Axios calls and `axios.create()` clients, browser WebSocket/XHR sends, and selected Pino/Winston factory methods. User-defined functions shadowing globals are distinguished by symbols. Arbitrary factory patterns, native side effects, Axios config-object overloads, and unregistered transports still require review or explicit sink adapters. Policies are applied only where the destination/payload shape is modeled; they do not authorize unknown transports.

## JSON configuration

Place `ztrace.config.json` at the scanned directory root, or supply `--config path`. The CLI reads JSON only; no JavaScript configuration is executed. Unknown keys are rejected.

```json
{
  "sources": [
    { "module": "my-wallet-client", "export": "readViewingKey", "kind": "viewing-key" },
    { "module": "./memo-store", "export": "readMemo", "kind": "memo" }
  ],
  "sinks": [
    { "module": "custom-telemetry", "export": "default.publish", "kind": "analytics" }
  ],
  "disclosurePolicies": [
    {
      "origin": "https://payments.example",
      "pathname": "/invoice",
      "kinds": ["shielded-address"],
      "fields": ["body.recipient"],
      "reason": "The approved invoice endpoint needs the recipient address."
    }
  ],
  "exclude": ["**/*.test.ts", "generated/**"],
  "maxSteps": 100000
}
```

Custom source rules mark the return of an imported function as sensitive. An optional `path`, such as `addresses.shielded`, marks only that returned field. Module specifiers and export names match exactly as written in source. Sink adapter kinds are `logging`, `network`, or `analytics`; a default client method can be named `default.publish`. Adapters are declarations supplied by the developer; they do not automatically infer an unknown library's privacy behavior.

Supported source kinds: `shielded-address`, `wallet-account`, `wallet-balance`, `wallet-history`, `viewing-key`, `spending-key`, `memo`, `pczt`.

Prefer `disclosurePolicies`: approvals match a static HTTPS origin, exact pathname, data category, and exact field path. For fetch, field paths are relative to request options (`body.recipient`); Axios payload paths are relative to its data argument. These policies are intended disclosure decisions, not proof that the remote recipient is safe. An existing `allowedNetworkOrigins` setting remains supported as a broad compatibility policy and should be replaced with narrow policies. HTTP, relative/dynamic URLs, and lookalike domains remain checked. Viewing/spending keys remain errors even for an approved origin. Network policies do not authorize logging or analytics.

CLI exclusions use Node's `path.matchesGlob` syntax. Default skipped directories: `node_modules`, `.git`, `.next`, `.nuxt`, `.turbo`, `.vercel`, `dist`, `dist-tools`, `build`, `coverage`. Declaration files and directory-entry symlinks are skipped. `.gitignore` rules are not currently interpreted; use explicit `exclude` patterns. The CLI reads at most 1000 files, 1 MB per file, and 20 MB total; size/count skips make coverage incomplete. The default analysis budget is 100000 steps.

No broad suppress-comment or automatic source-code editing mechanism is implemented. Review and fix findings manually.

## Coverage inventory and required sources

Every new report includes `modelCoverage`: imported package identifiers, available model roles, recognized sensitive categories, and whether configured source requirements were met. Import classifications are `built-in`, `configured`, `local`, or `unmodeled`. They describe model availability; the recognized `sourceKinds` list describes source categories actually encountered by the analysis. URL import credentials and query strings are omitted from the inventory.

The CLI requires at least one recognized sensitive source by default. Keep that intent explicit in CI:

```sh
node dist-tools/packages/cli/src/cli.js scan ./app --require-sources
```

Or specify the categories your integration expects in `ztrace.config.json`:

```json
{
  "requireSources": true,
  "requiredSourceKinds": ["shielded-address", "wallet-balance", "wallet-history"]
}
```

An unmet requirement produces `SOURCE_REQUIREMENT_UNMET`, incomplete coverage, and CLI exit code 2. This catches a missing wallet model even when no disclosure was detected. Requirements describe static source recognition; runtime execution expectations are configured separately.

For a deliberate scan of source-free utilities, use `--allow-no-sources` or set `requireSources` to `false` in the JSON policy. CLI flags override the policy. The reusable `scanSources` API enables requirements through its options.

## Additional application constructs

Switch analysis follows strict literal selection, default search order, fall-through, breaks, returns, and enclosing-loop continues. Unknown selectors join possible entry paths; computed cases and ambiguous control transfers can require review. Switches are limited to 128 clauses.

Promise `catch`/`finally`, array `find`/`findIndex`/`some`/`every`, mutable array `push`, numeric conversions, Date formatting, regular-expression transformations, and Map containers preserve supported sensitive flows. Map models include construction, get/set, entries/keys/values, clear/delete, and forEach. Ambiguous object aliases from multiple map entries produce review diagnostics. Symbolic-loop array growth is widened to a combined element state so data categories can converge within the loop bound.

Nested callback analysis retains observed lexical contexts, including React state setters. Closure expansion has an eight-context bound for entry analysis, and additional contexts are reported for review. These are bounded possible-flow models.

Explicit thrown values propagate into catch bindings, including throws from local function calls and nested catches. Standard Error-family message, stack, and cause fields preserve their respective data flows. Object enumeration and the SDK's pure signing-verification/address-conversion helpers also preserve supported sensitivity. Complex exception control transfers and asynchronous scheduling remain conservative approximations.

Catch environments include modeled assignments performed before a throw. Finite array callbacks receive the element, numeric index, and original array; known empty arrays skip callbacks. Finite `reduce`/`reduceRight` retain accumulator fields and direction up to 128 elements. Unknown-length reductions perform bounded propagation and emit `REDUCTION_REVIEW`.

Promise constructors model resolve/reject callbacks as possible data paths. Rejection handlers, `allSettled`, `race`, and `any` retain supported values. Direct function references, bound callbacks, `call`/`apply`, finite argument spreads, and timer callbacks are supported. Timer and promise models describe possible execution, without simulating the event loop or proving fulfillment/rejection order.

Nested array/object destructuring assignments retain selected fields, defaults, and rest values. Local object/class getter reads and setter writes use their current modeled receiver and captured state. Getter evaluation is included in known JSON serialization, spreads, and object enumeration. Accessors still emit `ACCESSOR_REVIEW`: reflective descriptors, inherited accessors, and arbitrary library access are outside this model.

Known defined literal values skip default initializers; explicit `undefined` and `void` results select them. Unknown defaults join the executed and skipped environments. `typeof` and `void` preserve operand side effects without treating the operand's private value as their output. Known empty `Array.from` mappings skip their callbacks.
