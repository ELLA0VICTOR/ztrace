# ZTrace corpus results

Corpus SHA-256: 440a17e1e2429363c20aac4255e08af3381824c97444d84d8f912f1f4d69bb96
Engine SHA-256: 101ce55812421c226a59a1214b534d6c48a263f5fd621fed7562af1821a1b1a3

Self-authored, synthetic, API-based fixtures. Challenge cases are a first-run stress split, not an independent external evaluation.

Review diagnostics do not count as detections. These metrics describe this corpus only, not production coverage.

Default models: 60 cases; TP 28; FN 2; FP 0; TN 30; review 3.
With the two explicitly listed custom adapters: {"TP":30,"FN":0,"FP":0,"TN":30,"reviewCases":2,"recall":1,"precision":1}. This is a configured result, not automatic discovery of unknown SDKs.

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
