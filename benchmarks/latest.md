# ZTrace corpus results

Corpus SHA-256: 01525d22d5a4def99d5aa5c20c198c5ab1d1d58944be7706dcacc8a9028201a2
Engine SHA-256: 5f24a1a32bcb80caaf70824fb4ed07caa45ebca149785c21d0d1598335667852

Self-authored, synthetic, API-based fixtures. Challenge cases are a first-run stress split, not an independent external evaluation.

Review diagnostics do not count as detections. These metrics describe this corpus only, not production coverage.

Default models: 88 cases; TP 42; FN 2; FP 0; TN 44; review 7.
With the two explicitly listed custom adapters: {"TP":44,"FN":0,"FP":0,"TN":44,"reviewCases":6,"recall":1,"precision":1}. This is a configured result, not automatic discovery of unknown SDKs.

| Case | Outcome | Review |
| --- | --- | --- |
| audit-nullable-leak | TP | — |
| audit-nullable-safe | TN | — |
| audit-comma-leak | TP | — |
| audit-comma-safe | TN | — |
| audit-hook-leak | TP | — |
| audit-hook-safe | TN | — |
| audit-segment-leak | TP | — |
| audit-segment-safe | TN | — |
| audit-loop-leak | TP | — |
| audit-loop-safe | TN | — |
| audit-reachability-leak | TP | — |
| audit-reachability-safe | TN | — |
| checkout-telemetry-leak | TP | — |
| checkout-telemetry-safe | TN | — |
| payroll-balance-leak | TP | — |
| payroll-balance-safe | TN | — |
| support-history-leak | TP | — |
| support-history-safe | TN | — |
| invoice-axios-leak | TP | — |
| invoice-axios-safe | TN | — |
| session-websocket-leak | TP | — |
| session-websocket-safe | TN | — |
| session-xhr-leak | TP | — |
| session-xhr-safe | TN | — |
| server-pino-leak | TP | — |
| server-pino-safe | TN | — |
| sentry-context-leak | TP | — |
| sentry-context-safe | TN | — |
| react-effect-leak | TP | — |
| react-effect-safe | TN | — |
| react-resource-leak | TP | — |
| react-resource-safe | TN | — |
| class-logger-leak | TP | — |
| class-logger-safe | TN | — |
| injected-wallet-leak | TP | — |
| injected-wallet-safe | TN | — |
| ledger-pczt-leak | TP | — |
| ledger-pczt-safe | TN | — |
| viewing-key-leak | TP | — |
| viewing-key-safe | TN | — |
| alias-module-leak | TP | — |
| alias-module-safe | TN | — |
| indexed-loop-leak | TP | — |
| indexed-loop-safe | TN | — |
| serialized-fields-leak | TP | — |
| serialized-fields-safe | TN | — |
| challenge-rest-leak | TP | — |
| challenge-rest-safe | TN | — |
| challenge-conditional-function-leak | TP | — |
| challenge-conditional-function-safe | TN | — |
| challenge-array-spread-leak | TP | — |
| challenge-array-spread-safe | TN | — |
| challenge-permission-event-leak | TP | — |
| challenge-permission-event-safe | TN | — |
| challenge-custom-transport-leak | FN | UNMODELED_CALL |
| challenge-custom-transport-safe | TN | — |
| challenge-reflective-sink-leak | TP | DYNAMIC_DISPATCH_REVIEW |
| challenge-reflective-sink-safe | TN | DYNAMIC_DISPATCH_REVIEW |
| challenge-native-code-leak | FN | — |
| challenge-native-code-safe | TN | — |
| audit-callback-array-leak | TP | — |
| audit-callback-array-safe | TN | — |
| audit-callback-index-leak | TP | — |
| audit-callback-index-safe | TN | — |
| audit-reduce-leak | TP | — |
| audit-reduce-safe | TN | — |
| audit-reduce-direction-leak | TP | — |
| audit-reduce-direction-safe | TN | — |
| audit-catch-state-leak | TP | — |
| audit-catch-state-safe | TN | — |
| audit-caught-cause-leak | TP | — |
| audit-caught-cause-safe | TN | — |
| audit-object-getter-leak | TP | ACCESSOR_REVIEW |
| audit-object-getter-safe | TN | ACCESSOR_REVIEW |
| audit-object-setter-leak | TP | ACCESSOR_REVIEW |
| audit-object-setter-safe | TN | ACCESSOR_REVIEW |
| audit-promise-executor-leak | TP | — |
| audit-promise-executor-safe | TN | — |
| audit-promise-reference-leak | TP | — |
| audit-promise-reference-safe | TN | — |
| audit-bound-logger-leak | TP | — |
| audit-bound-logger-safe | TN | — |
| audit-applied-logger-leak | TP | — |
| audit-applied-logger-safe | TN | — |
| audit-destructure-assignment-leak | TP | — |
| audit-destructure-assignment-safe | TN | — |
| audit-timer-arguments-leak | TP | — |
| audit-timer-arguments-safe | TN | — |
