/** Read-only independent chain confirmation for the retained exact payment. */
import { readFileSync, writeFileSync } from "node:fs";
import assert from "node:assert/strict";
import { decodePaymentSignatureHeader } from "@x402/core/http";
import { PayerLedger } from "../../clients/payer/ledger.js";
import { loadPayerConfig } from "../../clients/payer/config.js";
import { BlockfrostClient, sumPaidTo } from "../../src/funding/cardano/blockfrost.js";
import { fundingCommitment } from "../../src/funding/cardano/binding.js";
const c = loadPayerConfig(process.env), state = JSON.parse(readFileSync("data/cardano/run-private.json", "utf8"));
const entry = new PayerLedger(c.ledgerFile).find(state.purchaseId);
assert(entry?.header);
const payload = decodePaymentSignatureHeader(entry.header);
const evidence = JSON.parse(readFileSync("integration-e2e/cardano/live-e2e.json", "utf8"));
const hash = evidence.signedTransaction.hash;
const bf = new BlockfrostClient({
    baseUrl: c.blockfrostBaseUrl,
    projectId: c.blockfrostProjectId
});
const chain = await bf.getTransaction(hash);
assert(chain);
assert.equal(sumPaidTo(chain.outputs, c.expectedPayTo, c.allowedAsset), 1020n);
assert.equal(chain.commitment, fundingCommitment(payload.resource!.url, payload.accepted));
assert(chain.confirmations !== null && chain.confirmations >= 1);
assert.equal(chain.validContract, true);
const history = JSON.parse(readFileSync("data/cardano/history-private.json", "utf8"));
const record = {
    check: "independent official Blockfrost exact chain readback",
    result: "PASS",
    observedAt: new Date().toISOString(),
    txHash: chain.txHash,
    networkMagic: await bf.networkMagic(),
    blockHeight: chain.blockHeight,
    blockTime: chain.blockTime,
    newerBlocks: chain.confirmations,
    treasury: c.expectedPayTo,
    asset: c.allowedAsset,
    receivedBaseUnits: sumPaidTo(chain.outputs, c.expectedPayTo, c.allowedAsset).toString(),
    treasuryAdaLovelace: sumPaidTo(chain.outputs, c.expectedPayTo, "lovelace").toString(),
    commitment: chain.commitment,
    outputs: chain.outputs
};
evidence.checks.push(record);
evidence.historyReconciliation = {
    checkedAt: history.timestamp,
    addressFingerprint: history.addressFingerprint,
    transactionCount: history.transactionCount,
    outgoingCount: history.outgoingCount,
    incomingTransactionHashes: history.transactions.map((t: {
        tx_hash: string;
    }) => t.tx_hash),
    sharedLedger: "C:/Dev/token2049-setup/secrets/cardano-payer-a2e66045653afe62/ledger.json"
};
writeFileSync("integration-e2e/cardano/live-e2e.json", JSON.stringify(evidence, null, 2));
console.log(JSON.stringify(record, null, 2));
