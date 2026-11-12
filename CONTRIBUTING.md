# Contributing to NetSim Community Edition

Thank you for considering a contribution to NetSim. This guide covers the development setup, the checks every pull request must pass and the policies that keep the project browser-only and private by design.

By taking part in this project you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md).

## Project policies

These rules apply to every change. A pull request that breaks one of them will not be merged.

1. **Browser-only.** NetSim has no server, no accounts and no backend services. The application must not make network requests at runtime. State lives in the application store and in the browser's local storage, accessed through the shared storage interface.
2. **No telemetry.** No analytics, tracking, error reporting services or any other code that sends data out of the browser.
3. **No new runtime dependencies without discussion.** Open an issue first and explain why the dependency is needed and what it adds to the bundle. Development dependencies also need a short justification in the pull request.
4. **English everywhere.** Code, comments, identifiers, file names, test names, commit messages and pull request text are written in English.
5. **Licence.** The project is licensed under AGPL-3.0, and so are all contributions (see [License](#license)).

## Development setup

Prerequisites:

- Node.js 20.19+ or 22.12+ with npm
- Rust stable toolchain (installed with rustup)
- `wasm-pack`

```bash
# Fork the repository on GitHub, then clone your fork
git clone <URL-of-your-fork>
cd netsim

# Install the JavaScript dependencies
npm install

# Build the WebAssembly core (before the first run and after changes in wasm-core/)
npm run build:wasm

# Start the development server
npm run dev
```

## Branches

Create one branch per topic, named `<type>/<topic-in-english>`:

| Type | Use it for |
| :--- | :--- |
| `feat` | New functionality |
| `fix` | Bug fixes |
| `refactor` | Internal changes without a behaviour change |
| `docs` | Documentation only |
| `test` | Tests only |
| `chore` | Tooling, CI and maintenance |

Examples: `feat/ospf-area-summary`, `fix/vlan-trunk-parsing`, `docs/quick-start`.

Keep your branch up to date with `main` and keep each pull request focused on one topic.

## Checks to run before opening a pull request

Run all of these locally. Every one must finish without errors.

```bash
# Lint (warnings are treated as errors)
npm run lint

# Type-check the application code
npx tsc --noEmit -p tsconfig.json

# Type-check the tests
npx tsc --noEmit -p tsconfig.vitest.json

# Unit tests
npx vitest run

# Rust core tests
cargo test --manifest-path wasm-core/Cargo.toml
```

`npm run typecheck` and `npm test` are the package scripts for the type checks and the unit tests.

## Coding standards

- **TypeScript strict.** Avoid `any`, `@ts-ignore`, `@ts-expect-error` and non-null assertions in new code. Reviewers will ask for them to be removed.
- **React.** Function components and hooks. Keep components thin: they render state and call actions.
- **Domain logic** lives in pure, framework-free modules. Time, identifiers, randomness and storage are passed in as parameters, so the logic is deterministic and easy to test.
- **State.** Global state uses Zustand. State changes must be predictable and covered by tests.
- **Untrusted input.** Anything parsed or read from a file, the clipboard or browser storage enters the code as `unknown`, passes an explicit type guard and has a size limit. Never spread or merge imported objects into state; rebuild them field by field.
- **Unsafe APIs.** No `dangerouslySetInnerHTML`, `innerHTML`, `eval` or `new Function`. Sanitise download file names. Clean up timers and subscriptions.
- **Fixtures and examples.** Never commit real addresses, host names, keys or personal data. Prefer reserved documentation values such as `example.com` and the `192.0.2.0/24`, `198.51.100.0/24` and `203.0.113.0/24` ranges.

## Adding a feature

Features are self-contained folders under `src/features/<id>/` that plug into the application through a small contract, without editing shared files. The contract is described in [docs/architecture/features.md](docs/architecture/features.md); that document is the source of truth. In short:

- `feature.ui.tsx` registers a lazily loaded panel that appears in the Tools menu.
- `feature.slice.ts` adds the feature's state to the store. State fields are prefixed with the feature name.
- `feature.commands.ts` adds CLI commands.
- Persistent data uses the feature's own storage slots, named `netsim.<feature>.<thing>.v<n>`, through the shared storage interface.
- Tests live in `src/tests/features/<id>/`.

If a feature seems to need a change in a shared file, open an issue to discuss it before writing the code.

## Tests

- New behaviour comes with tests. Unit tests use Vitest and live under `src/tests/`.
- Import the test APIs explicitly from `vitest`.
- Tests run offline: they must not depend on the network, the system clock or random values.
- Cover the domain logic, the type guards and the security-relevant paths: oversized input, corrupt JSON, unexpected object keys and storage failures.
- Changes in `wasm-core/` come with Rust tests.

## Pull requests

1. Fill in the pull request template: summary, changes, how to test, security notes and a changelog entry.
2. Do not edit `CHANGELOG.md`. Write the entry in the pull request description; the maintainers add it at release time.
3. Update the documentation when behaviour changes.
4. Link the related issues.

## Reporting bugs and requesting features

- Report bugs in the [issue tracker](https://github.com/anghabar/netsim/issues). Include a clear title, the steps to reproduce, what you expected and your browser and operating system.
- Feature requests are welcome in the same place. Describe the use case and how it helps people who learn networking with NetSim.
- **Security problems are not reported in public issues.** Follow [SECURITY.md](SECURITY.md).

## License

By contributing, you agree that your contributions are licensed under the project's **AGPL-3.0** licence.
