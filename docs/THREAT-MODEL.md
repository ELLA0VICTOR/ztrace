# Threat model

ZTrace helps application developers identify accidental disclosure of modeled Zcash wallet data in supported JavaScript/TypeScript source. The engine reports possible data paths, not confirmed exploitation, executed payments, or discovered vulnerabilities in the SDK vendor.

## Boundaries

- Project source and JSON policy are inputs. Neither is evaluated as JavaScript.
- Static analysis does not open wallet databases, read environment files, request seeds, or send network traffic. Optional runtime testing explicitly executes a trusted loopback test app; use only synthetic test data.
- Reports omit copied source snippets, literal values, and network payloads. They retain paths, identifiers, and source categories, which may themselves be sensitive.
- Configured sources and approved origins are decisions made by the developer. An incorrect policy can hide relevant disclosures.
- Supported source/sink models and the finite analysis budget limit coverage. Unknown SDKs, transports, libraries, and language patterns can hide flows.

## Outside the claim

The tool cannot certify an application as private, protect against malicious dependencies, prove zero-knowledge circuit soundness, or detect every leak. Runtime canary inspection covers exercised paths and supported representations only. Protocol inspection does not establish account ownership, full cryptographic key validity, valid chain settlement, or complete PCZT redaction. It does not audit a remote server or prevent IP/timing correlation. No cloud dashboard or upload service is used.

## Validation

Tests exercise cross-module flows, safe field selection, corrected payloads, aliases, branch joins, source/sink shadowing, origin matching, key disclosure, incomplete coverage, and CLI exit codes. Test source uses synthetic code and documented wallet API shapes. It does not connect to a production wallet or use real private data.

The vulnerable/corrected fixtures and corpus demonstrate bounded analyzer behavior. Real Chromium tests establish the reported local observations, not production wallet behavior. Existing protocol implementations supply canonical primitives; ZTrace adds disclosure inventories and application policies. The landing-page example uses fixture source in a local browser worker. Its initial engine-generated results are example evidence, not a production application scan.
