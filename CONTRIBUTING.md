# Contributing

Thanks for helping improve SpicySwipe. Read the [license](License) and [attribution](ATTRIBUTION.md) first: this is a source-available project under personal/non-commercial terms. Contributions do not remove those restrictions. Only contribute work you have permission to share under the repository's terms.

## Local development

Fork and clone the repository, use Node.js 24 LTS, and run:

```sh
npm ci
npm test
npm run check
npm run build
npm run desktop:build
```

Use `npm run dev` for the sample-data browser preview, or `npm run desktop` for Electron. See [architecture](docs/ARCHITECTURE.md) for the main modules.

## Pull requests

1. Keep the change focused and describe the user-visible problem.
2. Add a meaningful regression for behavior changes. Use synthetic profiles and mocked account/device boundaries.
3. Run the commands above. State the actual OS/device testing performed; do not imply a cross-platform live test from a unit-test pass.
4. Include screenshots only when useful, with synthetic data. Never include real profile photos, conversation text, credentials, or local account files.
5. Preserve existing attribution and dependency license notices.

Automated CI must never sign in to real dating accounts or submit real Likes/messages. Any manual live test requires the account owner's explicit authorization and a bounded test plan. Avoid changes that bypass account challenges, silently spend paid items, or continue after an uncertain action outcome.

## Reports and conduct

Use the bug-report or feature-request form for ordinary issues. Keep reports reproducible and conversations respectful. Do not harass, publish others' personal information, or post unsolicited promotional content. Security issues belong in the [private reporting channel](SECURITY.md).
