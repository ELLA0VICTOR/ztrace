# Contributing to ZTrace

ZTrace provides local privacy analysis for applications built on Zcash. Contributions should make its documented behavior more useful, reproducible, and understandable.

These guidelines use the [librustzcash contribution style guides](https://github.com/zcash/librustzcash/blob/main/CONTRIBUTING.md#styleguides) as a primary reference for focused changes, reviewable history, clear commit messages, public API documentation, and changelog discipline. The coding conventions below apply those principles to this TypeScript repository.

## Development setup

Use Node.js 24 or later and npm. From the repository root:

```cmd
npm ci
npm run build:tools
```

For the website:

```cmd
npm run dev
```

Runtime and UI verification also need Chromium. Follow the browser setup in [the runtime guide](docs/RUNTIME.md).

## Report a problem

Search existing issues first. Include the relevant version or commit, platform, command, expected result, actual result, and a small synthetic reproduction. Explain whether the problem concerns a missed disclosure, an incorrect finding, an incomplete result, protocol interpretation, or another behavior.

Use invented wallet values and sanitized source. Reports can contain identifying paths and destination details; review them before publishing. Keep seeds, spending keys, real viewing keys, wallet databases, and private user data out of issues and fixtures.

For a vulnerability that could expose real users, use the repository's private security-reporting option if available. If it is unavailable, request a private reporting channel without publishing exploit details or sensitive data. Do not imply that Zcash upstream maintainers operate a security response service for ZTrace.

## Propose a change

Describe the user problem and relevant analysis boundary before starting a large change. Open an issue for architectural changes, new dependencies, new SDK models, or significant protocol coverage changes so the approach can be discussed.

Work on a focused branch. Preserve existing public commits; do not rewrite shared history. A pull request should explain the resulting behavior, show a small example where useful, list relevant verification, and identify remaining coverage limits.

Commits should represent coherent changes with concise descriptive subjects. Explain the motivation when it is not obvious. Attribute contributors and preserve dependency licenses and fixture provenance.

## Coding and documentation

- Follow the surrounding TypeScript style and keep new dependencies justified and pinned consistently with the project.
- Document public API behavior and update the affected CLI, coverage, runtime, or protocol guide when contracts change.
- Describe user-visible changes in CHANGELOG.md alongside the implementation. Keep historical release entries separate from later work.
- Preserve source/sink provenance and review diagnostics. Unsupported code or incomplete execution must not silently become evidence of privacy.
- Keep reports and diagnostics useful without unnecessarily copying private input data into output.

## Verification

For source analysis or CLI behavior:

```cmd
npm test
npm run benchmark
npm run lint
```

New disclosure models should include a leaking example and a relevant safe counterpart, plus a regression that demonstrates the behavior being added or corrected. Include unsupported or ambiguous behavior when it is relevant to the change.

Run the affected additional checks:

| Area | Command |
| --- | --- |
| Browser runtime | npm run test:runtime |
| Package exports, installation, or SDK consumer | npm run test:package |
| Resource limits or malformed input | npm run test:adversarial |
| Website, documentation navigation, or accessibility | npm run test:ui |
| Deployment asset paths | npm run test:site-base |

Retain original upstream vector licenses, source revisions, and hashes. Treat benchmark labels and expected results as reviewable evidence: explain changes rather than regenerating expectations simply to make a check pass. Distinguish synthetic cases, observations of upstream examples, and independent user findings.

## Review and licensing

Address substantive review feedback and identify which checks were run. Maintainers may request smaller changes, additional regression coverage, or clearer analysis limits. Passing tests alone does not establish that a change is safe or complete.

Contributions must be submitted with the necessary rights and under the repository's [MIT license](LICENSE). Preserve third-party attribution and describe meaningful external or AI assistance when it helps reviewers understand provenance and review needs.
