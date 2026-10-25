# Verification and release

## Verify a release candidate

Run the following checks from the checkout:

```sh
npm ci
npm test
npm run benchmark
npm run test:runtime
npm run test:adversarial
npm run test:package
npm run test:ui
npm run test:site-base
npm run test:external
npm run lint
```

Runtime, consumer, and UI checks require Chromium. The package check installs an isolated consumer, uses the installed CLI and package exports, builds the actual SDK application, and retains its reports. The adversarial suite runs deterministic mutation cases under child-process time and JavaScript heap limits.

## Continuous integration

The Verify workflow runs Node.js 24 checks on Ubuntu and Windows. A separate job records observations against pinned upstream example source. Reports and the tested npm archive are uploaded as verification artifacts. Action references are pinned to commit SHAs and workflow permissions default to read-only repository access.

Inspect the platform results after pushing the workflow. Local verification establishes behavior on the executing machine; the workflow supplies the other platform executions.

## Prepare an archive

```sh
npm run build:tools
npm pack --pack-destination .artifacts/release
```

The package includes the compiled CLI, ESM APIs, TypeScript declarations, documentation, and MIT license. Website rendering dependencies are development dependencies. The optional native PCZT parser is loaded only for artifact inspection.

Before a public package release, choose an available npm package name, update package metadata and documentation consistently, remove the `private` flag, and use the verified archive as the release candidate. Check `CHANGELOG.md`, package contents, and source revision before publishing.

## Publish the documentation site

The Publish documentation site workflow is manually dispatched. In repository settings, select GitHub Actions as the Pages build source, then run the workflow. It builds the configured repository base path and deploys the resulting static artifact to GitHub Pages.

For another static host, run `npm run build` and serve `dist/`. Set `ZTRACE_BASE_PATH` when serving beneath a path prefix. Navigation uses hash routes, and brand assets and font URLs are built for the configured base.

## Retained third-party notices

Keep the upstream test-vector license and provenance, public brand-source references, and font licenses with the repository. The project license is MIT.
