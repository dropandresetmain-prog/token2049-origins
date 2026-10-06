import { describe, expect, test } from "bun:test";
import { verifyPurchase, type ChainTransaction, type ExpectedPurchase } from "./verify";

const expected: ExpectedPurchase = {
  purchaseId: "pur_test",
  quoteId: "quo_test",
  network: "cardano:preprod",
  rail: "cardano",
  assetId: "policy.asset",
  amountBaseUnits: "22870",
  payTo: "addr_test1testdestination",
  txHash: "a".repeat(64),
  merchantProvider: "atlas",
  merchantEnvironment: "sandbox",
};

const proof = {
  purchaseId: "pur_test",
  quoteId: "quo_test",
  funding: {
    requirement: {
      rail: "cardano",
      amount: { network: "cardano:preprod", assetId: "policy.asset", amountBaseUnits: "22870" },
      payTo: "addr_test1testdestination",
    },
    confirmationStatus: "confirmed",
    applied: true,
    transfers: [{ reference: "a".repeat(64), confirmationStatus: "confirmed", application: "applied", evidenceMode: "fresh_external" }],
  },
  merchant: { provider: "atlas", environment: "sandbox", result: "ticketed", paymentStatus: "test_balance_paid", evidenceMode: "fresh_external" },
  receipt: { receiptId: "rcp_test", finalResult: "Complete" },
  progress: { stage: "complete", paymentConfirmed: true, outcomeFinal: true },
};

const transaction: ChainTransaction = {
  tx_hash: "a".repeat(64),
  block_height: 5261680,
  outputs: [{
    payment_addr: { bech32: "addr_test1testdestination" },
    asset_list: [{ policy_id: "policy", asset_name: "asset", quantity: "22870" }],
  }],
};

describe("Capsule commerce proof verification", () => {
  test("returns a sanitized deterministic verdict for consistent purchase, merchant, receipt, and chain evidence", () => {
    const result = verifyPurchase("pur_test", proof, transaction, expected);
    expect(result.status).toBe("verified");
    expect(result.checks).toHaveLength(5);
    expect(JSON.stringify(result)).not.toContain(expected.payTo);
    expect(JSON.stringify(result)).not.toContain("raw");
  });

  test("rejects an arbitrary purchase ID before considering evidence", () => {
    const result = verifyPurchase("pur_other", proof, transaction, expected);
    expect(result.status).toBe("rejected");
    expect(result.checks).toEqual(["purchase_id_allowlisted"]);
  });

  test("rejects proof without fresh successful funding and final merchant receipt", () => {
    const incomplete = structuredClone(proof);
    incomplete.funding.transfers[0].evidenceMode = "local_fixture";
    incomplete.merchant.paymentStatus = "unpaid";
    const result = verifyPurchase("pur_test", incomplete, transaction, expected);
    expect(result.status).toBe("rejected");
    expect(result.checks).not.toContain("capsule_records_fresh_confirmed_funding");
    expect(result.checks).not.toContain("merchant_result_is_fresh_and_successful");
  });

  test("rejects a different quote even when the remaining evidence looks consistent", () => {
    const changedQuote = structuredClone(proof);
    changedQuote.quoteId = "quo_other";
    const result = verifyPurchase("pur_test", changedQuote, transaction, expected);
    expect(result.status).toBe("rejected");
  });

  test("rejects a chain transaction with a mismatched destination or asset quantity", () => {
    const mismatched = structuredClone(transaction);
    mismatched.outputs[0].payment_addr!.bech32 = "addr_test1differentdestination";
    const result = verifyPurchase("pur_test", proof, mismatched, expected);
    expect(result.status).toBe("rejected");
    expect(result.checks).not.toContain("public_chain_confirms_recipient_asset_amount");
  });
  test("rejects malformed nested proof and chain response data without throwing", () => {
    const malformedProof = {
      purchaseId: expected.purchaseId,
      quoteId: expected.quoteId,
      funding: { requirement: { amount: null }, transfers: [null] },
      merchant: null,
      receipt: {},
      progress: null,
    };
    const malformedTransaction = {
      tx_hash: expected.txHash,
      block_height: 5261680,
      outputs: [null],
    } as unknown as ChainTransaction;
    let result: ReturnType<typeof verifyPurchase> | undefined;
    expect(() => { result = verifyPurchase(expected.purchaseId, malformedProof, malformedTransaction, expected); }).not.toThrow();
    expect(result?.status).toBe("rejected");
  });
});
