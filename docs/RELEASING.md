# Release checklist

1. Confirm license and attribution are unchanged unless rights-holder permission authorizes a change.
2. Update `package.json`, `package-lock.json`, and `manifest.json` versions together. Add a changelog entry.
3. Run `npm ci`, `npm test`, `npm run check`, `npm run build`, and `npm run desktop:build` from a clean checkout.
4. Review tracked files for credentials, private endpoints, real profile data, browser state, and machine-specific paths. Check that generated builds and account data remain ignored.
5. Run the **Desktop builds** workflow manually on the intended commit, or push a reviewed version tag. It builds Windows x64, macOS ARM64/Intel, and Linux x64 artifacts with SHA-256 manifests. Artifacts are unsigned previews, not automatically published releases.
6. Test installation and launch on each claimed platform. Use an explicitly authorized short account test for changed live actions. A package build or unit-test pass does not replace that check.
7. Prepare release notes that distinguish tested behavior from available build targets and disclose unsigned/not-notarized preview status.
8. Publish only reviewed artifacts and matching checksum files. Enable pre-release status while platform validation remains incomplete.

The CI workflow runs offline tests and both source builds on Windows, macOS, and Linux. No CI secret, account cookie, or dating-app login is required. Signing/notarization and an automatic updater are not configured.
