# ZTrace corpus results

Corpus SHA-256: 440a17e1e2429363c20aac4255e08af3381824c97444d84d8f912f1f4d69bb96
Engine SHA-256: b1e015868aa61bddb3bcb166763b72fb2fbc9fe165e7c029b3d4e625421ca282

Self-authored, synthetic, API-based fixtures. Challenge cases are a first-run stress split, not an independent external evaluation.

Review diagnostics do not count as detections. These metrics describe this corpus only, not production coverage.

Cases: 60; TP 27; FN 3; FP 0; TN 30; review 2.

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
| challenge-reflective-sink-leak | FN | UNMODELED_CALL |
| challenge-reflective-sink-safe | TN | — |
| challenge-native-code-leak | FN | — |
| challenge-native-code-safe | TN | — |
