# Coverage audit — 24 October 2026

This audit exercised the built `ztrace/scanner` API with additional synthetic TypeScript programs. Scanned code was not executed, and no wallet, credentials, real private data, or external application service was used. No implementation fixes were made as part of this review.

The existing 32 automated tests validate their listed scenarios. They do not establish overall recall, precision, or coverage of real Zcash applications. The probes below deliberately challenge implementation boundaries and are not a representative benchmark.

## Observed results

| Probe | Result | Assessment |
| --- | --- | --- |
| Direct Noir account address to `console.log` | One finding; no diagnostic | Positive control behaves as intended |
| Balance from the React adapter's `useWallet()` | Zero sources, zero findings, no diagnostic | Unsupported source is silently unrecognized |
| Address disclosure inside `for…of` | Zero findings; `UNMODELED_STATEMENT`; incomplete coverage | Known language gap is surfaced for review |
| `console.log(address), address = 'public'` | Zero findings, no diagnostic | Incorrect expression evaluation order hides disclosure |
| `flag ? getNoirWallet() : null`, followed by optional account reads | Zero sources, zero findings, no diagnostic | Joining provider references with null drops the source model |
| Segment `AnalyticsBrowser.load(...).track(...)` with an address | Zero findings; `UNMODELED_CALL`; incomplete coverage | Factory-created client is not connected to the sink model |
| `if (false) console.log(address)` | One finding | Definite unreachable branch causes a false positive |

## Priority order

1. Correct expression evaluation order and preserve possible provider/function references through branches and null checks. Convert the discovered misses and false positive into regression cases when implementing fixes.
2. Strengthen control-flow/state handling and cover common loops, callbacks, React patterns, module aliases, and class instances with bounded, explicit approximations.
3. Extend versioned source models to the React adapter and selected wallet/RPC interfaces, and sink models to factory-created analytics clients and common transports/loggers. Surface known unsupported integrations in coverage reporting.
4. Replace origin-only approval with narrowly scoped disclosure rules: destination route, data category, and payload fields. Keep keys protected and decisions auditable.
5. Add an opt-in runtime test mode for controlled local applications, using synthetic wallet data and intercepted/blocked external requests. Report only the paths and transformations actually exercised. This mode executes the application under test; the static scan remains source-only.
6. Add Zcash-specific transaction/viewing-capability models using canonical protocol definitions and existing parsers. A PCZT label alone is not binary inspection or validation of redaction.
7. Establish a larger, separated vulnerable/safe evaluation corpus with held-out cases and real integration structures. Publish misses, false alarms, and coverage exclusions alongside successful detections.

## Inherent boundaries

Static analysis must approximate dynamic JavaScript behavior; runtime tests cover only exercised paths. Their combination cannot certify arbitrary applications as free of every privacy leak. Remote retention, malicious dependencies, operating-system compromise, cryptographic correctness, and IP/timing correlation require separate controls or audits.

The practical target is strong, measured coverage of named Zcash application workflows, clear disclosure policies, useful traces, and honest reporting of unsupported paths.

## Implementation follow-up

All six original failing/false-positive audit families now have regression coverage: nullable providers, comma evaluation order, React adapter sources, finite-loop disclosure, Segment factory clients, and definite unreachable branches. Broader coverage adds class instances, hook/event flows, aliases, rest/spread, narrow disclosure policies, and configurable source/sink adapters.

The [current 60-case corpus report](../benchmarks/latest.md) keeps default-model misses separate from explicit-adapter results. The challenge split has informed improvements and is not claimed as an independently held-out assessment. The [runtime tests](RUNTIME.md) and [protocol inspectors](PROTOCOL.md) are implemented and verified within their documented limits. The retained observations above describe the original pre-fix implementation, not the current status.
