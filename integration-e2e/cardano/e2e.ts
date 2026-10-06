/** Opt-in bounded live Preprod payment; never initialize or reset payer history here. */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { loadPayerConfig } from "../../clients/payer/config.js";
import { Payer } from "../../clients/payer/payer.js";
import { PayerLedger } from "../../clients/payer/ledger.js";
import { decodePaymentSignatureHeader, encodePaymentSignatureHeader } from "@x402/core/http";
import { decodeCardanoTransaction } from "@x402/cardano";
const result: any = {
    timestamp: new Date().toISOString(),
    sourceSha: "0afd377681fe0e27e0ea86cf2cfaa34cdb970769",
    scope: "Real Cardano Preprod funding; hotel and card capacity are local fixtures",
    checks: [],
    outcome: "PARTIAL"
};
const evidence = "integration-e2e/cardano/live-e2e.json";
const config = loadPayerConfig(process.env);
import { start, ipc, call, purchase, close } from "./runtime.js";
function record(check: string, data: unknown) {
    result.checks = result.checks.filter((item: {
        check: string;
    }) => item.check !== check);
    result.checks.push({
        check,
        ...(data as object)
    });
    writeFileSync(evidence, JSON.stringify(result, null, 2));
    console.log(JSON.stringify({
        check,
        ...(data as object)
    }));
}
try {
    await start();
    const state: any = JSON.parse(readFileSync("data/cardano/run-private.json", "utf8"));
    let p = state.purchaseId ? (await call("GET", "/v1/purchases/" + state.purchaseId)).body.purchase : await purchase("cardano-live-one-" + state.schema);
    state.purchaseId = p.purchaseId;
    writeFileSync("data/cardano/run-private.json", JSON.stringify(state, null, 2));
    record("fixture hotel quote with exact real Cardano requirement", {
        purchaseId: p.purchaseId,
        commercialTotalMinor: "102",
        requiredBaseUnits: "1020",
        fixture: true
    });
    const before = await ipc("snapshot");
    assert.equal(before.executions, 0);
    record("commerce gated before funding", {
        result: "PASS",
        counts: before.counts
    });
    let lost = false;
    const sent: string[] = [];
    const wrapped: typeof fetch = async (url, init) => {
        const header = new Headers(init?.headers).get("payment-signature");
        if (header) {
            sent.push(createHash("sha256").update(header).digest("hex"));
            const payload = decodePaymentSignatureHeader(header);
            const tx = decodeCardanoTransaction((payload.payload as any).transaction);
            result.signedTransaction = {
                hash: tx.txHash,
                feeLovelace: tx.fee.toString(),
                outputs: tx.outputs.map(o => ({
                    address: o.address,
                    coin: o.coin.toString(),
                    assets: Object.fromEntries(Object.entries(o.assets).map(([k, v]) => [k, v.toString()]))
                }))
            };
            writeFileSync(evidence, JSON.stringify(result, null, 2));
            if (!lost) {
                for (const field of ["network", "asset", "amount", "payTo", "extra"]) {
                    const bad = structuredClone(payload);
                    if (field === "network")
                        bad.accepted.network = "cardano:mainnet";
                    if (field === "asset")
                        bad.accepted.asset = "lovelace";
                    if (field === "amount")
                        bad.accepted.amount = "1019";
                    if (field === "payTo")
                        bad.accepted.payTo = await new Payer({
                            config
                        }).source().then(s => s.publicAddress);
                    if (field === "extra")
                        bad.accepted.extra = {
                            ...bad.accepted.extra,
                            quoteDigest: "f".repeat(64)
                        };
                    const r = await call("POST", "/v1/purchases/" + p.purchaseId + "/fund", undefined, {
                        "payment-signature": encodePaymentSignatureHeader(bad)
                    });
                    assert.equal(r.body.error.code, "payment_invalid");
                    record("wrong " + field + " refused before broadcast", {
                        result: "PASS",
                        http: r.response.status
                    });
                }
                const r = await fetch(url, init);
                const text = await r.text();
                writeFileSync("data/cardano/funding-response-private.json", text, {
                    mode: 384
                });
                record("real signed payment gateway response", {
                    http: r.status
                });
                lost = true;
                throw Error("deliberate response loss after actual send");
            }
        }
        return fetch(url, init);
    };
    if (p.state === "awaiting_funding") {
        try {
            await new Payer({
                config,
                fetchImpl: wrapped,
                maxAttempts: 1,
                log: e => console.log(JSON.stringify(e))
            }).pay(p.purchaseId);
        }
        catch (e: any) {
            record("deliberate response loss or payment failure", {
                code: e.code || "internal",
                message: e.message
            });
        }
    }
    const ledger = new PayerLedger(config.ledgerFile);
    const entry = ledger.find(p.purchaseId);
    assert.ok(entry?.header, "signed payload must be durable");
    result.signedHeaderFingerprint = createHash("sha256").update(entry.header).digest("hex");
    await ipc("close");
    await start();
    const resumed = await new Payer({
        config,
        maxAttempts: 1
    }).pay(p.purchaseId);
    record("gateway and payer restart recovery", {
        result: "PASS",
        resumed: resumed.resumed,
        transferReference: resumed.transferReference
    });
    for (let attempt = 0; attempt < 15; attempt++) {
        await ipc("tick");
        p = (await call("GET", "/v1/purchases/" + p.purchaseId)).body.purchase;
        if (p.state === "succeeded")
            break;
        await new Promise(r => setTimeout(r, 5000));
    }
    assert.equal(p.state, "succeeded");
    assert.equal(p.paymentState, "confirmed");
    assert.equal(p.receipt.evidenceMode, "local_fixture");
    assert.equal(p.receipt.merchantPaymentStatus, "simulated_paid");
    assert.equal(p.receipt.funding[0].evidenceMode, "fresh_external");
    record("truthful receipt", {
        result: "PASS",
        state: p.state,
        paymentState: p.paymentState,
        receipt: p.receipt
    });
    const snapshot = await ipc("snapshot");
    assert.equal(snapshot.executions, 1);
    assert.equal(snapshot.counts.funding_evidence, 1);
    assert.equal(snapshot.counts.reservations, 1);
    assert.ok(snapshot.balance.every((b: any) => b.sum === "0"));
    record("single funding reservation execution and balanced journal", {
        result: "PASS",
        ...snapshot
    });
    const replay = await call("POST", "/v1/purchases/" + p.purchaseId + "/fund", undefined, {
        "payment-signature": entry.header
    });
    assert.equal(replay.response.status, 409);
    record("same purchase replay has no second transfer", {
        result: "PASS",
        http: replay.response.status
    });
    const retry = await new Payer({
        config
    }).pay(p.purchaseId);
    assert.equal(retry.resumed, true);
    assert.equal(retry.transferReference, resumed.transferReference);
    assert.equal(ledger.committed(config.network, config.allowedAsset), 1020n);
    record("accepted payer rerun retains exact transaction and cap", {
        result: "PASS",
        transferReference: retry.transferReference,
        committedBaseUnits: "1020"
    });
    result.outcome = "PASS";
    result.completedAt = new Date().toISOString();
    writeFileSync(evidence, JSON.stringify(result, null, 2));
}
catch (e: any) {
    result.failure = {
        message: e.message
    };
    writeFileSync(evidence, JSON.stringify(result, null, 2));
    console.log(JSON.stringify({
        outcome: result.outcome,
        failure: result.failure
    }));
    process.exitCode = 1;
}
finally {
    await close();
}
