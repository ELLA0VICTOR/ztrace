# Benchmark methodology

Run `npm run benchmark` to build the current engine and evaluate the fixed 88-case corpus. It writes `latest.json` and `latest.md`. Reports record corpus, engine, and evaluator SHA-256 hashes, per-case results, families, splits, diagnostics, and timings. Rebuild the corpus only intentionally with `node benchmarks/build-corpus.mjs`; changing it changes its hash.

The corpus contains 44 deliberately vulnerable and 44 labeled safe synthetic programs. Twenty pairs cover confirmed regression families, 17 pairs use application-shaped integrations, and seven pairs challenge less familiar boundaries. The original 60 cases remain; 14 added pairs cover callback arguments, reductions, catch state, accessors, Promise execution, bound/applied loggers, destructuring assignments, and timers. All fixtures were authored in this project from documented API shapes; they are not independent production audits. The challenge split is a stress split, not permanently unseen data: findings have informed subsequent improvements.

For a vulnerable case to count as detected, a finding must match the expected data category, rule, and destination file. A manual-review diagnostic alone is a miss. Any finding on a labeled safe case is a false-positive case. Precision/recall are **case-level**, not finding-level metrics or estimates for the ecosystem. Extra findings within positive cases are retained in counts; the corpus is too small and synthetic for broad accuracy claims.

Two evaluations are reported separately:

1. Built-in models, with the per-fixture policy already present in the corpus.
2. The same corpus with two explicitly listed custom adapters for an otherwise unknown wallet source and telemetry sink. This demonstrates extensibility, not automatic discovery of unknown library behavior.

`--check` fails on regression/integration misses or false alarms. Challenge misses remain visible without being removed to make the gate pass. `baseline-static.json` retains the first expanded-engine run: it used an any-finding positive criterion, so it is historical evidence rather than a directly comparable precision study.

Separate evidence checks cover actual Chromium execution and pinned upstream Zcash encoding vectors. Those answer different questions and are not added to the static recall denominator. Meaningful next validation is external review, unseen real application structures, and independently labeled data. No such review is claimed yet.
