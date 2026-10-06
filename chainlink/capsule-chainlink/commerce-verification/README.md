# Capsule CRE verification workflow

This project builds an isolated Chainlink CRE workflow that verifies a pinned Capsule proof and a public Cardano transaction read. See [`docs/work/CHAINLINK_CRE.md`](../../../docs/work/CHAINLINK_CRE.md) for track research, security boundaries, reproduction instructions, and retained simulation evidence.

The production target fetches only the existing Capsule evidence proof endpoint and requires a dedicated `evidence:read` token injected through CRE secret management. It does not create purchases or perform writes. The snapshot target is for local simulation only: it reads the retained proof through an ephemeral loopback fixture and must not be deployed, because a DON would not have access to that fixture.

Install and check the TypeScript project from this directory:

```sh
bun install --frozen-lockfile
bun run typecheck
bun test
```

The successful official CLI simulation and sanitized output are documented at [`docs/evidence/chainlink-cre/commerce-verification-simulation.json`](../../../docs/evidence/chainlink-cre/commerce-verification-simulation.json).
