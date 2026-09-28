# Security and privacy

## Reporting

Report reproducible security issues privately using GitHub's **Security → Report a vulnerability** when private vulnerability reporting is enabled for this repository. If that option is unavailable, open an issue asking for a private reporting channel without including exploit details, credentials, contract contents, signatures or personal information. Do not post sensitive evidence publicly.

The current TAPESIGN-2 contract and TAPESIGN-NOTARY-1 content declaration protocols are maintained here. V1 contracts require their original client. This project has not received an independent security audit.

## Trust model

- The handwritten strokes are bound to EIP-712 consent, together with the document hash, role, container endpoint and offer transaction. The pen image alone is not identity proof.
- The client checks transaction input, receipts, events, historical inbox/outbox digests, code pins, container identity and wallet signatures using two independent RPC slots. A successful result is not a consensus light-client proof.
- Cache responses are untrusted discovery hints and signed-content previews. Chain verification is required before signing, sealing or exporting evidence.
- Short confirmation permits interaction before finality. Reorganizations remain possible; the client rechecks dependencies before submission.
- Site operators may update files. Retain a separately trusted release manifest and client copy; a versioned filename does not make chain storage immutable.

## Public data and secrets

Contract text, parties, handwritten strokes and wallet signatures are public on chain. There is no encryption or deletion facility. Use synthetic content for testing.

Transparent notarizations publish original text/image bytes and SHA-256. Nontransparent notarizations publish the hash, container identity, declaration metadata and signature; originals are neither sent to the cache nor placed on chain. Hashes still permit matching known or guessed content. A notarization records the holder's claim and block time; it does not adjudicate ownership. Preserve originals for nontransparent claims.

The public notarization mailbox is enumerated independently by the client. Cache previews are not finalized chain evidence. An unavailable chain, incomplete page or conflicting snapshot prevents a complete audit result. Chunked uploads preserve transaction hashes across reloads, and uncertain wallet outcomes require recovery before continuing.

Never commit private keys, seed phrases, RPC credentials, SSH credentials, production logs, cache databases, real contract screenshots or evidence files. Test wallets in test/fixture.mjs are deliberately deterministic and have no relationship to real accounts; never fund them.

config/networks.json and config/app.json are embedded in browser builds. Any RPC token placed there becomes visible to users of that build even if you do not commit it. Use keyless endpoints or an appropriately restricted read-only gateway for public clients. The optional TapeSign cache does not implement a general-purpose RPC proxy.

.gitignore and npm run check:public provide additional checks, but do not replace review of staged changes or guarantee detection of every secret. Generated dist/, release/, server bundles and .local/ artifacts are excluded because they can embed deployment settings or real evidence. Rotate credentials if they were published; deleting a later commit does not erase repository history.

## Operating the cache

Bind to loopback behind HTTPS, run as the dedicated unprivileged user, keep the data directory private and back it up. No signing keys are required. POST /notify only queues a chain ID and transaction hash; the server fetches and verifies the evidence itself. Discovery from a single node never directly creates a verified contract.

Do not weaken code pins, collapse both independent RPC slots onto one provider, or treat missing trie node/HTTP failures as successful verification. Use providers with the historical-state capability required by the contract being checked.
