const fixturePath = new URL("../../../docs/evidence/atlas-cardano-combined-pass-20261007.json", import.meta.url);
const fixture = await Bun.file(fixturePath).json() as Record<string, any>;
const expectedPurchaseId = "pur_01M49B9QJCBD8SS77FMAXNTJK8";
const expectedQuoteId = "quo_01M49B82CA1G6CAJPFTYZ8ANKE";
if (fixture.purchaseId !== expectedPurchaseId || fixture.quoteId !== expectedQuoteId) {
  throw new Error("retained_fixture_identity_mismatch");
}
if (typeof fixture.proof !== "object" || fixture.proof === null || Array.isArray(fixture.proof)) {
  throw new Error("retained_fixture_proof_invalid");
}
const proof = { ...fixture.proof, purchaseId: fixture.purchaseId, quoteId: fixture.quoteId };
const path = `/v1/evidence/purchases/${expectedPurchaseId}/proof`;

Bun.serve({
  hostname: "127.0.0.1",
  port: 4319,
  fetch(request) {
    const url = new URL(request.url);
    if (request.method !== "GET" || url.pathname !== path) {
      return Response.json({ error: "not_found" }, { status: 404 });
    }
    return Response.json({ proof }, { headers: { "cache-control": "no-store" } });
  },
});

console.log("read-only retained Capsule proof snapshot served on 127.0.0.1:4319");
