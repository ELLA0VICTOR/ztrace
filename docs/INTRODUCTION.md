# Build privacy into the application layer

ZTrace helps application developers find supported paths where private Zcash wallet data reaches logs, analytics, or network requests. It runs locally, without a hosted scanner or a source upload.

A shielded transaction protects transaction information onchain. The application around it can still send a wallet address, balance, history, viewing key, or transaction artifact somewhere it does not belong. ZTrace checks that application boundary.

## Start with a local scan

The static scanner reads JavaScript and TypeScript as text. It follows supported data flows across local modules and produces findings with source locations, destinations, intermediate trace steps, and remediation guidance. It does not execute the scanned application.

Use the [quickstart](QUICKSTART.md) to scan the included examples and then your own project. Read [sources, adapters, and policies](SCANNER.md) before relying on a result.

## Go beyond source analysis

- **Runtime testing:** exercise a trusted local application with synthetic values in a fresh Chromium context. Observe supported console, HTTP, and WebSocket disclosures. External requests are blocked.
- **Protocol inspection:** decode revision-0 Unified Viewing Key encodings and inspect a bounded PCZT signer projection before sharing artifacts.
- **Reusable APIs:** import the scanner, runtime harness, or protocol inspectors from the built development package for local automation.

Each mode answers a different question. A source trace identifies a possible path. A runtime observation establishes what happened in the exercised test. A disclosure inventory explains supported artifact fields. None provides a universal privacy guarantee.

## What this release includes

ZTrace is a development release, version 0.1.0. It includes a CLI, exported APIs, a 88-case self-authored synthetic scanner benchmark, controlled browser tests, and upstream protocol test vectors. It is used from the project checkout; a public npm package is not available yet.

The landing-page example uses engine-generated fixture results. Its **Run local check** button actually analyzes those fixture files in a browser worker. It does not connect a wallet or execute a transaction.

## Understand the boundary

The scanner models selected APIs and language constructs. Unsupported sources can escape recognition, and unsupported flows may require review. Runtime matching is limited to exercised paths and supported representations. Protocol inspection does not prove ownership, settlement, cryptographic validity, or complete PCZT redaction.

Read the [threat model](THREAT-MODEL.md) and [benchmark methodology](../benchmarks/METHODOLOGY.md) alongside the results.
