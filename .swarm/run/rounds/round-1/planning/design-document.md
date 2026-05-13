## Context
`scripts/updateVersion.ts` is internal build/release tooling invoked from Azure Pipelines (`azure-pipelines/templates/build.yml` and `test.yml`) through `npm run updateVersion`. It is not part of the published customer surface: `package.json` only ships `dist/`, `src/`, `types/`, `LICENSE`, and `README.md`, and the build artifact copy step omits `scripts/`.

## Finding assessment
- The RCE finding is **real and actionable**: `execSync(`npm version ${newVersion} ...`)` interpolates `--version` or `--buildNumber`-derived input into a shell command.
- The exposure is **limited to maintainer/CI contexts**, so this is not a production runtime exploit for library consumers, but it is still a valid supply-chain/SFI hardening issue and worth fixing.
- The fix is therefore necessary, but mainly for internal release safety rather than customer runtime protection.

## Historical context
The file was added in the repo’s initial commit and closely matches the older `scripts/updateVersion.ts` used in `Azure/azure-functions-nodejs-worker`, so the current design looks intentionally inherited for release automation convenience. The missed gap is shell-safety and input hardening, not the versioning workflow itself.

## Proposed change
- Refactor the script into testable helpers.
- Remove shell execution from package version updates; use a shell-free implementation that keeps `package.json`, `package-lock.json` root version fields, and `src/constants.ts` synchronized.
- Validate explicit versions and build-number-derived versions with `semver` before any file mutation.
- Preserve the existing CLI contract (`--validate`, `--version`, `--buildNumber`) and current prerelease formatting so the Azure Pipelines build/test flows continue to work unchanged.

## Regression / contract expectations
- Expected regression risk is low if the same files and CLI semantics are preserved.
- No customer-facing or host/worker contract break is expected because only internal repo tooling changes and the published package/runtime APIs remain untouched.
- Current CI already runs build/lint/test/version-validation across Node 18/20/22, but there is **no dedicated unit coverage** for the release script or malicious-input paths; adding focused tests is the main confidence gap to close.