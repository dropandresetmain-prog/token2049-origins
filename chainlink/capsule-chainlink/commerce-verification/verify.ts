export type ExpectedPurchase = {
  purchaseId: string;
  quoteId: string;
  network: string;
  rail: string;
  assetId: string;
  amountBaseUnits: string;
  payTo: string;
  txHash: string;
  merchantProvider: string;
  merchantEnvironment: string;
};

type JsonRecord = Record<string, any>;

export type ChainTransaction = {
  tx_hash: string;
  block_height: number | string;
  outputs: Array<{
    payment_addr?: { bech32?: string };
    asset_list?: Array<{ policy_id: string; asset_name: string; quantity: string }>;
  }>;
};

export type VerificationResult = {
  status: "verified" | "rejected";
  evidenceSource?: "live_capsule_proof" | "retained_capsule_snapshot";
  purchaseId: string;
  quoteId?: string;
  selectedFunding?: { rail: string; network: string; assetId: string; amountBaseUnits: string };
  chain?: { transactionHash: string; blockHeight: number };
  merchant?: { provider: string; environment: string; result: string; paymentStatus: string };
  receipt?: { receiptId: string; finalResult: string };
  checks: string[];
};

const isRecord = (value: unknown): value is JsonRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Verify the curated Capsule proof against pinned facts and a public chain read. */
export function verifyPurchase(
  purchaseId: string,
  proof: unknown,
  transaction: ChainTransaction | null,
  expected: ExpectedPurchase,
): VerificationResult {
  const checks: string[] = [];
  if (purchaseId !== expected.purchaseId || !isRecord(proof) || proof.purchaseId !== expected.purchaseId) {
    return { status: "rejected", purchaseId: expected.purchaseId, checks: ["purchase_id_allowlisted"] };
  }

  const funding = isRecord(proof.funding) ? proof.funding : {};
  const requirement = isRecord(funding.requirement) ? funding.requirement : {};
  const amount = isRecord(requirement.amount) ? requirement.amount : {};
  const progress = isRecord(proof.progress) ? proof.progress : {};
  const merchant = isRecord(proof.merchant) ? proof.merchant : {};
  const receipt = isRecord(proof.receipt) ? proof.receipt : null;
  const transfers = Array.isArray(funding.transfers) ? funding.transfers : [];

  const fundingMatches = requirement.rail === expected.rail
    && amount.network === expected.network
    && amount.assetId === expected.assetId
    && String(amount.amountBaseUnits) === expected.amountBaseUnits
    && requirement.payTo === expected.payTo;
  if (fundingMatches) checks.push("selected_funding_matches_pinned_quote");

  const transferMatches = funding.confirmationStatus === "confirmed"
    && funding.applied === true
    && transfers.some((transfer: unknown) => isRecord(transfer)
      && transfer.reference === expected.txHash
      && transfer.confirmationStatus === "confirmed"
      && transfer.application === "applied"
      && transfer.evidenceMode === "fresh_external");
  if (transferMatches) checks.push("capsule_records_fresh_confirmed_funding");

  const chainResult = verifyChain(transaction, expected);
  if (chainResult) checks.push("public_chain_confirms_recipient_asset_amount");

  const merchantMatches = merchant.provider === expected.merchantProvider
    && merchant.environment === expected.merchantEnvironment
    && merchant.result === "ticketed"
    && merchant.paymentStatus === "test_balance_paid"
    && merchant.evidenceMode === "fresh_external";
  if (merchantMatches) checks.push("merchant_result_is_fresh_and_successful");

  const receiptMatches = receipt !== null
    && receipt.finalResult === "Complete"
    && typeof receipt.receiptId === "string"
    && receipt.receiptId.length > 0
    && progress.stage === "complete"
    && progress.paymentConfirmed === true
    && progress.outcomeFinal === true;
  if (receiptMatches) checks.push("final_receipt_and_purchase_state_are_consistent");

  const complete = fundingMatches && transferMatches && chainResult !== null
    && merchantMatches && receiptMatches
    && proof.quoteId === expected.quoteId;
  return {
    status: complete ? "verified" : "rejected",
    purchaseId: expected.purchaseId,
    ...(typeof proof.quoteId === "string" ? { quoteId: proof.quoteId } : {}),
    ...(fundingMatches ? { selectedFunding: {
      rail: expected.rail,
      network: expected.network,
      assetId: expected.assetId,
      amountBaseUnits: expected.amountBaseUnits,
    } } : {}),
    ...(chainResult ? { chain: chainResult } : {}),
    ...(merchantMatches ? { merchant: {
      provider: merchant.provider,
      environment: merchant.environment,
      result: merchant.result,
      paymentStatus: merchant.paymentStatus,
    } } : {}),
    ...(receiptMatches ? { receipt: { receiptId: receipt.receiptId, finalResult: receipt.finalResult } } : {}),
    checks,
  };
}

function verifyChain(transaction: ChainTransaction | null, expected: ExpectedPurchase): { transactionHash: string; blockHeight: number } | null {
  if (!transaction || transaction.tx_hash !== expected.txHash || !/^[a-f0-9]{64}$/i.test(transaction.tx_hash)) return null;
  const blockHeight = Number(transaction.block_height);
  if (!Number.isSafeInteger(blockHeight) || blockHeight <= 0
    || !Array.isArray(transaction.outputs)
    || !/^\d+$/.test(expected.amountBaseUnits)) return null;

  let received = 0n;
  for (const output of transaction.outputs ?? []) {
    if (!isRecord(output) || !isRecord(output.payment_addr) || output.payment_addr.bech32 !== expected.payTo
      || !Array.isArray(output.asset_list)) continue;
    for (const asset of output.asset_list) {
      if (!isRecord(asset)) continue;
      if (`${asset.policy_id}.${asset.asset_name}` === expected.assetId && /^\d+$/.test(asset.quantity)) {
        received += BigInt(asset.quantity);
      }
    }
  }
  if (received !== BigInt(expected.amountBaseUnits)) return null;
  return { transactionHash: transaction.tx_hash, blockHeight };
}
