# Contributing

## Development

Use Node.js 22.12+, clone the repository and run npm ci. Run npm run dev for the local application and npm run build for the static client. Configuration and deployment are documented in docs/CONFIGURATION.md and docs/DEPLOYMENT.md.

Before opening a pull request:

1. Use synthetic contracts and test wallets. Keep real evidence and deployment settings out of the repository.
2. Run npm test, npm run build, npm run build:cache and npm run check:public.
3. For client changes, start the local server and run test:ui, test:cache-ui and test:containers. Edge is the default; PLAYWRIGHT_CHANNEL=chromium selects an installed Playwright Chromium.
4. Review git diff and git diff --cached, including configuration URLs, generated files and documentation.
5. Describe the behavior change, relevant validation and any compatibility or trust-model implications.

The browser tests simulate the wallet and chain boundary. They must not send live transactions. Read-only checks of a real contract require an explicitly supplied transaction hash and keep reports under .local/.

## Protocol changes

Preserve canonical encoding, wallet signatures, independent RPC verification and exact offer/acceptance references. Cache data must not become signing authority. Contract grouping is a display index, not a substitute for verifying a branch.

Changes to src/, config/, scripts/, index.html, package.json or package-lock.json change the source release ID. Do not automatically trust every older release: review compatibility and retain the approved V2 releases needed by in-progress contracts. Do not silently rewrite signed documents or migrate V1 evidence.

The official site identity is part of the signed protocol. A fork with a different identity needs a deliberate compatibility design and tests; changing only the deployment URL does not change that identity.

## License

Contributions are submitted under the repository's MIT license. Preserve third-party notices and do not copy code with incompatible or unknown redistribution terms. Security reports should follow SECURITY.md.
