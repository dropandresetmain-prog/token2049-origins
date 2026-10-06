# Chainlink CRE commerce verification

Capsule performs a purchase through its existing authority and payment paths. This separate CRE HTTP-triggered workflow then reads a bounded Capsule proof and independently checks the Cardano payment output against Koios. It returns a deterministic, sanitized verdict. CRE is outside the purchase critical path and cannot mutate a purchase.

## Track fit and current CRE path

The TOKEN2049 Origins Chainlink category is **“Best Workflow with CRE”**; its public description asks builders to build with the Chainlink Runtime Environment. This implementation uses the official TypeScript SDK, a real HTTP trigger, CRE's HTTP capability, consensus aggregation, local WebAssembly compilation, and a successful CLI simulation against an existing Capsule purchase. It demonstrates CRE orchestrating independent commerce verification, rather than merely importing the SDK.

Official references checked for this lane:

- [TOKEN2049 Origins](https://token2049.com/singapore/2049-origins)
- [CRE overview: build and simulate; deployment requires approval](https://docs.chain.link/cre/overview)
- [CRE getting-started guide](https://docs.chain.link/cre/getting-started/overview)
- [CRE CLI repository and v1.37.0 release](https://github.com/smartcontractkit/cre-cli/releases/tag/v1.37.0)
- [TypeScript SDK release history](https://github.com/smartcontractkit/cre-sdk-typescript/releases)
- [Koios API guide](https://www.koios.rest/guide/introduction.html)

Pinned versions: CRE CLI v1.37.0, `@chainlink/cre-sdk` 1.23.0, `@chainlink/cre-sdk-javy-plugin` 1.7.0, Bun 1.4.0, TypeScript 5.9.3, and Javy v8.1.0. SDK and project dependencies are lockfile-pinned. The official CRE CLI Linux ARM64 release archive (`cre_v1.37.0_linux_arm64.tar.gz`) was verified against SHA-256 `8454d872386a1633e9f1792d593b13b3f1dd7f8101bc09cbb6f67069edcb5dfa`; its extracted binary is kept under ignored `chainlink/.tools/`. The pinned Javy plugin exposes `cre-setup`; `bun x cre-setup` installs Javy v8.1.0 for the container platform using the official [Javy release asset](https://github.com/bytecodealliance/javy/releases/download/v8.1.0/javy-arm-linux-v8.1.0.gz), SHA-256 `dcb2cd296fcba827a61e9750badb6d12a111346483e6f3fe4cbf287e62fb2a5a`. No standalone Javy binary is tracked. On Windows ARM64, CRE/Javy compilation ran inside the official Bun Linux ARM64 container; a fresh Debian-based container needs `ca-certificates`, `curl`, and `gpg` for the official setup. The official Javy Windows installer does not support Windows ARM64. The temporary Docker container and copied CRE profile were removed after simulation.

The organizer clarified in a private chat that DON deployment is not necessary and does not affect evaluation; simulation is sufficient. The private chat image is intentionally not copied here. The local account is authenticated, but deploy access is disabled; no request was submitted and no workflow was deployed.

Official deployment guidance says simulation/build is available without approval while DON deployment requires approval. The reviewed deployment guide lists default quotas of 3 private workflows per organization, 1 linked on-chain key per organization, and 3 on-chain workflows per linked key. This lane defines one private-registry workflow and does not deploy it. No per-simulation or execution price is published in the reviewed CRE docs; the lane made no CRE platform payment and did no write. The Cardano chain read uses Koios Preprod's public HTTPS API through CRE's HTTP capability, so no CRE-native Cardano chain selector or chain-write support is assumed. The SDK HTTP trigger and HTTP capability both built and ran under CLI simulation.

## What CRE checks

The trigger accepts at most 4 KiB of JSON, and only the one configured purchase ID. Configuration pins the associated quote, Cardano Preprod rail/network, tUSDM asset, amount, recipient, and transaction hash. The workflow fetches one bounded Capsule proof and one bounded Koios transaction response through the CRE HTTP capability. Each node projects only relevant proof or transaction fields before consensus aggregation.

The verifier requires Capsule to record fresh, confirmed and applied funding; checks the proof's purchase and quote IDs, selected rail/network/asset/amount and transfer reference; confirms the exact recipient, asset and quantity in the public transaction output; and checks the fresh successful Atlas sandbox result and final receipt/purchase state. Output contains only the verdict and curated facts. It excludes credentials, raw evidence, provider references, and recipient address.

The merchant and receipt checks are against Capsule's retained proof. CRE did not contact Atlas directly, so it independently checks the public-chain payment but does not independently validate Atlas ticketing. The exact evidence source is included in the result.

## Reproduce the successful retained-snapshot simulation

`chainlink/capsule-chainlink/commerce-verification` contains the SDK project; the enclosing `chainlink/capsule-chainlink` directory contains CRE project settings. The simulation used a disposable `oven/bun:1.4.0` Linux ARM64 container, the official CLI binary, and a temporary copy of the existing local CRE profile. The profile copy was removed with the container. No account credential or secret value is part of this repository.

With Docker, the profile already authenticated locally, and the official CLI available at `chainlink/.tools/cre-linux-arm64`:

```powershell
$root = (Get-Location).Path
docker run -d --name capsule-cre-sim `
  -v "${root}:/work" `
  -v "${root}\chainlink\.tools:/tools:ro" `
  -w /work/chainlink/capsule-chainlink `
  --entrypoint sh oven/bun:1.4.0 -c 'sleep 600'
docker exec capsule-cre-sim sh -lc 'apt-get update && apt-get install -y --no-install-recommends ca-certificates curl gpg'
docker exec capsule-cre-sim mkdir -p /root/.cre
docker cp "$env:USERPROFILE\.cre\context.yaml" capsule-cre-sim:/root/.cre/context.yaml
docker cp "$env:USERPROFILE\.cre\cre.yaml" capsule-cre-sim:/root/.cre/cre.yaml
docker exec capsule-cre-sim sh -lc 'cd /work/chainlink/capsule-chainlink/commerce-verification && bun install --frozen-lockfile && bun x cre-setup'
docker exec -d capsule-cre-sim sh -lc 'cd /work/chainlink/capsule-chainlink/commerce-verification && bun run snapshot-fixture'
Start-Sleep -Seconds 2
docker exec capsule-cre-sim sh -lc '/tools/cre-linux-arm64 workflow simulate commerce-verification --target snapshot-settings --non-interactive --trigger-index 0 --http-payload "{\"purchaseId\":\"pur_01M49B9QJCBD8SS77FMAXNTJK8\"}"'
docker rm -f capsule-cre-sim
```

The fixture serves the sanitized retained Capsule proof only on `127.0.0.1:4319`; it verifies that source artifact's purchase and quote IDs match the pinned IDs before serving. The snapshot target fixes the origin to loopback and has no secret mapping. It is for simulation only and must not be deployed; a DON would not have access to the local fixture. The workflow's other read is the real public Koios Preprod endpoint. Production configuration instead fixes the Capsule origin to the existing gateway and requires a `CAPSULE_EVIDENCE_TOKEN` supplied through CRE's secret manager; the matching environment-variable name is `CRE_CAPSULE_EVIDENCE_TOKEN`. That credential must be a dedicated owner-scoped `evidence:read` credential and is not provisioned in this lane.

## Verification and retained result

From the SDK project directory:

```powershell
bun install --frozen-lockfile
bun run typecheck
bun test
```

Result: typecheck passed; all 6 verifier tests passed, including wrong purchase, stale/unsuccessful funding, mismatched quote, wrong chain destination/asset quantity, and malformed nested data. The CRE CLI compiled the workflow and the simulation exited 0 with `status: verified` and all five checks. Curated output is retained in [`docs/evidence/chainlink-cre/commerce-verification-simulation.json`](../evidence/chainlink-cre/commerce-verification-simulation.json). It omits the actual recipient address and raw proof.

The retained Capsule report is [`docs/evidence/atlas-cardano-combined-pass-20261007.json`](../evidence/atlas-cardano-combined-pass-20261007.json), SHA-256 `96e141d744b1f906245bd7505970dfbbe23f404140a2fcc9d9c5f4f982e81c93`. Its historical source report is trusted for Capsule's recorded merchant outcome and receipt. Koios independently confirmed the transaction hash, block height 5261680, and expected recipient/asset/quantity during CRE simulation.

## Boundaries and review findings

- No purchase was rerun. CRE does not enter the payment or merchant execution path, perform writes, expose signer material, or receive a provider credential.
- Production evidence authentication is not demonstrated. The required `evidence:read` credential is absent; do not use a broad gateway token. **Investigate Now** before any live production workflow: provision a dedicated owner-scoped reader and verify the existing proof endpoint.
- DON deployment is unavailable for this account. **Park for Later**; organizer clarification says deployment is not required for evaluation. No deployment is claimed.
- **Resolved Act Now:** an earlier fixture draft hardcoded the pinned IDs rather than proving them from the source artifact. The final fixture reads both IDs from the retained report and refuses to serve on mismatch; the wrong-quote verifier test also rejects substituted evidence.
- Snapshot mode is intended only for local simulation, and its historical-vs-live source is explicit in configuration and output. **Ignore / Accept Risk** for the submission simulation; use the production mode only after the credential and live endpoint are available.
- Eligibility timing beyond the official event/category wording was not independently established here; no claim is made that the repository predates or meets any unstated kickoff rule.
