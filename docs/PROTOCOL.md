# Zcash disclosure inspection

## Viewing capabilities

`inspectViewingCapability` decodes revision-0 Unified Full/Incoming Viewing Key encodings locally. It checks Bech32m checksum, F4Jumble inverse, HRP/network padding, canonical CompactSize fields, item ordering/uniqueness, known component lengths, and selected revision restrictions.

It reports network, full/incoming scope, component types and sizes, and the privacy authority implied by known components. It never returns key bytes or derived addresses. Unknown components remain opaque. This is structural inspection: component curve/field validity, account ownership, and correctness of address derivation are not proved. Revision-2 prefixes are explicitly unsupported.

```sh
node dist-tools/packages/cli/src/cli.js inspect key ./viewing-key.txt
```

Use a local file so key material is not placed in shell history. A viewing capability does not inherently restrict access to one invoice or one address. Full and incoming viewing keys have different observation authority; neither recognized viewing-key type grants spending authority. Unknown components are not interpreted.

The implementation follows [ZIP 316](https://zips.z.cash/zip-0316), uses `@scure/base` and `@noble/hashes`, and is checked against eight pinned upstream F4Jumble vectors and 40 upstream UFVK/UIVK encodings. Source commit, original URLs, hashes, and upstream MIT license are retained under `tests/fixtures/protocol`. The production decoder currently accepts at most 16384 encoded characters; it does not claim full maximum-length ZIP conformance.

## PCZT private-field inventory

```sh
node dist-tools/packages/cli/src/cli.js inspect pczt ./transaction.pczt.hex --recipient support
```

Binary or hex PCZT files are accepted. The optional, pinned `@ledgerhq/zcash-utils@2.8.0` native package performs parsing in an isolated child process with a timeout. The parent receives only a field inventory, never decoded addresses, amounts, note randomness, or derivation paths. Upstream parsing/consistency checks remain upstream capabilities; ZTrace supplies the disclosure inventory and role decision.

**Coverage: signer projection only.** This parser does not expose every PCZT field. Its inventory includes available shielded recipient/value/randomness/opening fields and derivation-path presence. Full viewing keys, witnesses, memos, and proprietary data may be absent from the projection. It cannot establish complete redaction or compliance with every role's minimum information requirements. Some valid, heavily redacted PCZTs are unsupported by this signer-oriented parser. Unsupported input never receives an approval decision.

Support, analytics, and broadcast destinations are rejected for private construction artifacts. For a required prover/signer role, private disclosure needs a separate acknowledgment:

```sh
node dist-tools/packages/cli/src/cli.js inspect pczt ./transaction.pczt.hex --recipient prover --acknowledge-private-disclosure
```

That produces an `explicit-private-role` decision, **not** a guarantee of minimal disclosure. A delegated prover learns private note information; proof outsourcing is not automatically blind. Broadcast the extracted transaction rather than PCZT construction bytes. See [ZIP 374 privacy implications](https://zips.z.cash/zip-0374#privacy-implications).

The binary fixture is a genuine, locally generated V6/Ironwood PCZT using synthetic keys and a nonexistent funding UTXO. It was never broadcast and is not evidence of mined settlement. Its provenance and hash are retained separately.
