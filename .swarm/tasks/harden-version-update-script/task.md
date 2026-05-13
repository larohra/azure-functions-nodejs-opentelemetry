# Refactor release version updater

- Task ID: `harden-version-update-script`
- Round: 1
- Branch: worker/task-1
- Dependencies: (none)

## Description

Update `scripts/updateVersion.ts` so CLI parsing delegates to pure helpers instead of building a shell command. Remove `execSync`, validate `--version` and any `--buildNumber`-derived version with `semver` before mutating files, and keep `package.json`, `package-lock.json` root version entries, and `src/constants.ts` synchronized. Preserve the existing CLI flags, usage text, and prerelease formatting so the Azure Pipelines build/test steps continue to work without contract changes.