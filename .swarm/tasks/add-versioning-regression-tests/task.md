# Add release-script security tests

- Task ID: `add-versioning-regression-tests`
- Round: 1
- Branch: worker/task-2
- Dependencies: harden-version-update-script

## Description

Add focused coverage for the versioning script (for example `test/updateVersion.test.ts`) using temp fixtures or exported helpers from task 1. Cover `--validate`, explicit `--version` updates, prerelease `--buildNumber` generation with and without an existing `alpha` suffix, mismatch detection, and rejection of shell-metacharacter or otherwise invalid version input. After the tests are in place, run `npm run build`, `npm run lint`, `npm test`, `npm run updateVersion -- --validate`, and a temp-copy smoke of the `--buildNumber` path to confirm the hardened implementation is non-breaking.