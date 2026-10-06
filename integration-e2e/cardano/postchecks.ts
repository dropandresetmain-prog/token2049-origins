/** Guard checks against persisted live state; signer deliberately disabled. */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { loadPayerConfig } from "../../clients/payer/config.js";
import { Payer } from "../../clients/payer/payer.js";
import { PayerLedger } from "../../clients/payer/ledger.js";
import { decodePaymentSignatureHeader, encodePaymentSignatureHeader } from "@x402/core/http";
import { decodeCardanoTransaction } from "@x402/cardano";
import { createCardanoFundingAdapter } from "../../src/funding/cardano/adapter.js";
import { fundingCommitment } from "../../src/funding/cardano/binding.js";
const result: any = JSON.parse(readFileSync("integration-e2e/cardano/live-e2e.json", "utf8"));
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
    const state = JSON.parse(readFileSync("data/cardano/run-private.json", "utf8"));
    const ledger = new PayerLedger(config.ledgerFile);
    const paid = ledger.find(state.purchaseId)!;
    assert(paid.header);
    const next = state.guardPurchaseId ? (await call("GET", "/v1/purchases/" + state.guardPurchaseId)).body.purchase : await purchase("cardano-guards-" + state.schema);
    state.guardPurchaseId = next.purchaseId;
    writeFileSync("data/cardano/run-private.json", JSON.stringify(state, null, 2));
    let keysTouched = 0;
    const disabledSigner = () => {
        keysTouched++;
        throw Error("guard tests must never sign");
    };
    for (const [kind, overrides] of [["cumulative", {}], ["daily", {
                maxCumulative: 2040n
            }], ["per_payment", {
                maxPerPayment: 1019n
            }]] as const) {
        await assert.rejects(() => new Payer({
            config: {
                ...config,
                ...overrides
            },
            createSigner: disabledSigner
        }).pay(next.purchaseId), new RegExp(kind + "_cap"));
        record("persisted live purchase " + kind + " cap before key access", {
            result: "PASS"
        });
    }
    await assert.rejects(() => new Payer({
        config,
        createSigner: disabledSigner,
        now: () => new Date(Date.now() + 3600000)
    }).pay(next.purchaseId), /expiry/);
    assert.equal(keysTouched, 0);
    assert.equal(ledger.find(next.purchaseId), undefined);
    record("expired requirement and caps never touch key or reserve", {
        result: "PASS",
        keysTouched
    });
    const challenge = (await call("POST", "/v1/purchases/" + next.purchaseId + "/fund")).body;
    const old = decodePaymentSignatureHeader(paid.header);
    const forged = {
        ...old,
        resource: challenge.resource,
        accepted: challenge.accepts[0]
    };
    const mismatch = await call("POST", "/v1/purchases/" + next.purchaseId + "/fund", undefined, {
        "payment-signature": encodePaymentSignatureHeader(forged)
    });
    assert.equal(mismatch.response.status, 402);
    assert.match(mismatch.body.error.message, /does not bind this purchase and quote/);
    record("signed old transaction cannot bind a new purchase even with exact echoed terms", {
        result: "PASS",
        http: mismatch.response.status,
        reason: mismatch.body.error.message
    });
    const replay = await call("POST", "/v1/purchases/" + next.purchaseId + "/fund", undefined, {
        "payment-signature": paid.header
    });
    assert.equal(replay.response.status, 402);
    record("unaltered cross purchase replay rejected", {
        result: "PASS",
        http: replay.response.status
    });
    const snapshot = await ipc("snapshot");
    assert.equal(snapshot.counts.funding_evidence, 1);
    assert.equal(snapshot.counts.funding_attempts, 1);
    assert.equal(snapshot.executions, 0);
    assert.equal(ledger.committed(config.network, config.allowedAsset), 1020n);
    record("negative tests retain one chain funding and unchanged payer history", {
        result: "PASS",
        counts: snapshot.counts,
        committedBaseUnits: "1020"
    });
    result.completedAt = new Date().toISOString();
    writeFileSync(evidence, JSON.stringify(result, null, 2));
}
catch (e: any) {
    console.log(JSON.stringify({
        postchecks: "FAIL",
        message: e.message
    }));
    process.exitCode = 1;
}
finally {
    await close();
}
