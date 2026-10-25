# Verification evidence

This directory retains reproducible observations for the 0.1.0 release candidate. Local checks ran on Windows with Node.js 24 and Chromium. The repository's CI workflow repeats verification on Ubuntu and Windows after the changes are pushed.

| Check | Result | Evidence |
| --- | --- | --- |
| Core, CLI, and protocol regressions | 96 passing tests, including official-schema SARIF validation and terminal formatting | `npm test` |
| Runtime regressions | 7 passing tests | [Baseline flows](../runtime/evidence/latest.json), [boundary flows](../runtime/evidence/boundaries.json) |
| Deterministic adversarial checks | 520 checks across source flows, key encodings, and PCZT input boundaries | [Report](adversarial/latest.json) |
| Synthetic source benchmark | 42 detected leaks, 2 misses, 0 false positives, 44 safe cases; the two explicit adapters resolve the misses | [Results](../benchmarks/latest.md) |
| Installed-package consumer | Actual published Noir SDK; leaking and corrected React flows; static analysis and runtime expectations; zero sensitive collector deliveries | [Report](consumer/latest.json) |
| Pinned upstream example | 24 recognized sources, 3 candidate disclosure traces, 1 review diagnostic | [Observation](external/noir-sdk-latest.json), [provenance](external/noir-sdk-source.json) |

The consumer test installs the packed tool outside the repository, verifies ESM exports and TypeScript declarations, exercises the installed CLI, and checks optional native-parser behavior. Its browser flow supplies synthetic wallet values through the extension-provider boundary. It retains a package digest and execution metadata without retaining the canary values.

The synthetic benchmark has self-authored labels. The upstream example is independently authored source with no assigned vulnerability labels; its candidate traces converge on an intentional block-explorer link and require contextual review. These evaluations support the documented scenarios rather than a production-wide accuracy estimate.

Static analysis remains bounded by its models and control-flow approximations. Runtime evidence covers the actions, encodings, and observation window exercised. PCZT inspection inventories the native signer's projection; a complete artifact inventory requires a fuller parser.

See the [integration guide](../docs/INTEGRATION.md) for the executable consumer workflow and the [release guide](../docs/RELEASING.md) for verification commands, packaging, CI, and documentation deployment.
