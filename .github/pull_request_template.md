<!--
Thank you for contributing to NetSim Community Edition.
Please read CONTRIBUTING.md before opening the pull request.
Do not use a pull request to report a vulnerability: follow SECURITY.md.
-->

## Summary

<!-- What does this pull request do, and why? -->

## Changes

<!-- The main changes, as a short list. -->

## How to test

<!-- Exact commands and manual steps a reviewer can follow. -->

## Security notes

<!-- New inputs (files, clipboard, storage), their guards and size limits, or "None". -->

## Changelog entry

<!-- The text to add to CHANGELOG.md at release time. Do not edit CHANGELOG.md in this pull request. -->

## Checklist

- [ ] The branch is named `<type>/<topic-in-english>` and the pull request covers one topic.
- [ ] `npm run lint` passes.
- [ ] `npx tsc --noEmit -p tsconfig.json` passes.
- [ ] `npx tsc --noEmit -p tsconfig.vitest.json` passes.
- [ ] `npx vitest run` passes.
- [ ] `cargo test --manifest-path wasm-core/Cargo.toml` passes.
- [ ] New behaviour has tests, and the tests run offline.
- [ ] The change is browser-only: no network requests, no telemetry, no accounts.
- [ ] No new runtime dependency, or it was agreed in an issue first (link it above).
- [ ] No `any`, `@ts-ignore` or non-null assertions in new code; external input is validated and size-limited.
- [ ] New features follow the feature contract in `docs/architecture/features.md`.
- [ ] Code, comments and this description are in English.
- [ ] `CHANGELOG.md` is not edited; the entry is in the section above.
- [ ] I agree that this contribution is licensed under AGPL-3.0.
