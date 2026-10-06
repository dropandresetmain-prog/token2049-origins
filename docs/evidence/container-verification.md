# Container verification — 2026-10-06

Evidence mode: local runtime validation. No provider calls, wallet generation or spending occurred. Public deployment and live Shopify checkout remain NOT_RUN/BLOCKED_EXTERNAL.

- Source: implementation checkpoint `beac0228eec8418380b575e1d90665da3e939989`, plus tested final `.dockerignore` signer/state exclusions.
- Command: `docker build -t t2o-commerce-core:verification .` — PASS, exit 0. Final cached build verified the updated context exclusions.
- Docker server: 29.6.2, desktop-linux, Linux ARM64.
- Image ID: `sha256:1a773af29d50ee6074d188503e9c23714e612123c07dfbb2a12f144a708d8969`.
- Base image: node:24-bookworm-slim digest `sha256:d6aa754f16b3197301076f047b5def2f02ea1dbbc2ca920407d46d7ec7f87b20`.
- Container Node: v24.21.0; browser: Chromium 153.0.8010.12 (pinned Playwright browser revision 1243). Host source tests ran on Node v24.15.0, Windows ARM64.

## Runtime probe

An inline Node child-process probe invoked Docker CLI with argument arrays, a unique verification container/labelled volume, APP_ENV=test and a loopback-only host port. It provisioned an MCP client through the compiled official client tool in writable /data and used that token inside the container without printing its value.

| Check | Result |
|---|---|
| Health/capabilities/inspect endpoints and unauthenticated evidence rejection | PASS |
| Runtime uid is non-root | PASS |
| Gateway image lacks payer source, wallets and .env | PASS |
| Client token mode is 0600 and default MCP scope lacks purchases:fund | PASS |
| Official CLI-created token authenticates against the mounted gateway database | PASS |
| Chromium launches using SHOPIFY_BROWSER_EXECUTABLE and renders local DOM | PASS |
| Database and private client token persist after stop/recreate with same volume | PASS |
| Both disposable containers removed; volume label verified before removal | PASS |

Sanitized output:

```text
image=sha256:1a773af29d50ee6074d188503e9c23714e612123c07dfbb2a12f144a708d8969 linux/arm64
PASS non-root container, private token mode, authenticated read, no payer/wallet/env files; node=v24.21.0
PASS bundled Chromium launch and local DOM; browser=153.0.8010.12
PASS non-root container, private token mode, authenticated read, no payer/wallet/env files; node=v24.21.0
PASS named-volume database/token persistence across restart; no provider calls or spending
```

The local image tag remains available. No container remains running and no test volume remains. Chromium local DOM rendering does not validate live checkout selectors, provider permissions, shipping/tax or paid readback. Other deployment architectures have not been exercised.
