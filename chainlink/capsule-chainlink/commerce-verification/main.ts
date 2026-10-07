import {
  HTTPClient,
  HTTPCapability,
  Runner,
  consensusIdenticalAggregation,
  decodeJson,
  handler,
  type HTTPPayload,
  type Runtime,
} from "@chainlink/cre-sdk";
import { verifyPurchase, type ChainTransaction, type ExpectedPurchase, type VerificationResult } from "./verify";

export type Config = {
  gatewayOrigin: string;
  evidenceSourceMode: "live" | "retained_snapshot";
  expected: ExpectedPurchase;
};

const GATEWAY_ORIGIN = "https://token2049-origins.onrender.com";
const SNAPSHOT_ORIGIN = "http://127.0.0.1:4319";
const KOIOS_TX_INFO = "https://preprod.koios.rest/api/v1/tx_info";
const SECRET_ID = "CAPSULE_EVIDENCE_TOKEN";
const MAX_TRIGGER_BYTES = 4 * 1024;
const MAX_HTTP_RESPONSE_BYTES = 64 * 1024;

type JsonRecord = Record<string, any>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function inputPurchaseId(payload: HTTPPayload): string | null {
  if (!payload.input || payload.input.length === 0 || payload.input.length > MAX_TRIGGER_BYTES) return null;
  try {
    const input = JSON.parse(new TextDecoder().decode(payload.input)) as { purchaseId?: unknown };
    return typeof input.purchaseId === "string" ? input.purchaseId : null;
  } catch {
    return null;
  }
}

function consensusJson(runtime: Runtime<Config>, request: {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: Uint8Array;
}, project: (value: unknown) => unknown): unknown {
  const consensusResult = new HTTPClient().sendRequest<[], string, string>(
    runtime,
    (requester) => {
      const response = requester.sendRequest(request).result();
      if (response.statusCode < 200 || response.statusCode >= 300
        || response.body.length > MAX_HTTP_RESPONSE_BYTES) {
        throw new Error("upstream_read_failed");
      }
      return JSON.stringify(project(decodeJson(response.body)));
    },
    consensusIdenticalAggregation<string>(),
  )().result();
  return JSON.parse(consensusResult);
}

function projectCapsuleProof(value: unknown): unknown {
  if (!isRecord(value) || !isRecord(value.proof)) return null;
  const proof = value.proof;
  const funding = isRecord(proof.funding) ? proof.funding : {};
  const requirement = isRecord(funding.requirement) ? funding.requirement : {};
  const merchant = isRecord(proof.merchant) ? proof.merchant : {};
  const receipt = isRecord(proof.receipt) ? proof.receipt : null;
  const progress = isRecord(proof.progress) ? proof.progress : {};
  const amount = isRecord(requirement.amount) ? requirement.amount : {};
  const transfers = Array.isArray(funding.transfers)
    ? funding.transfers.filter(isRecord).map((transfer) => ({
      reference: transfer.reference,
      confirmationStatus: transfer.confirmationStatus,
      application: transfer.application,
      evidenceMode: transfer.evidenceMode,
    }))
    : [];
  return {
    proof: {
      purchaseId: proof.purchaseId,
      quoteId: proof.quoteId,
      funding: {
        requirement: {
          rail: requirement.rail,
          payTo: requirement.payTo,
          amount: { network: amount.network, assetId: amount.assetId, amountBaseUnits: amount.amountBaseUnits },
        },
        confirmationStatus: funding.confirmationStatus,
        applied: funding.applied,
        transfers,
      },
      merchant: {
        provider: merchant.provider,
        environment: merchant.environment,
        result: merchant.result,
        paymentStatus: merchant.paymentStatus,
        evidenceMode: merchant.evidenceMode,
      },
      receipt: receipt ? { receiptId: receipt.receiptId, finalResult: receipt.finalResult } : null,
      progress: { stage: progress.stage, paymentConfirmed: progress.paymentConfirmed, outcomeFinal: progress.outcomeFinal },
    },
  };
}

function projectKoiosTransaction(value: unknown, expectedHash: string): ChainTransaction | null {
  if (!Array.isArray(value)) return null;
  const row = value.find((item) => isRecord(item) && item.tx_hash === expectedHash);
  if (!isRecord(row)) return null;
  const outputs = Array.isArray(row.outputs) ? row.outputs.filter(isRecord).map((output) => ({
    payment_addr: isRecord(output.payment_addr) ? { bech32: output.payment_addr.bech32 } : undefined,
    asset_list: Array.isArray(output.asset_list) ? output.asset_list.filter(isRecord).map((asset) => ({
      policy_id: asset.policy_id,
      asset_name: asset.asset_name,
      quantity: asset.quantity,
    })) : [],
  })) : [];
  return { tx_hash: row.tx_hash, block_height: row.block_height, outputs } as ChainTransaction;
}

function onHTTPTrigger(runtime: Runtime<Config>, payload: HTTPPayload): VerificationResult {
  const { gatewayOrigin, evidenceSourceMode, expected } = runtime.config;
  const purchaseId = inputPurchaseId(payload);
  const requiredOrigin = evidenceSourceMode === "live" ? GATEWAY_ORIGIN
    : evidenceSourceMode === "retained_snapshot" ? SNAPSHOT_ORIGIN : null;
  if (!requiredOrigin || gatewayOrigin !== requiredOrigin || !purchaseId || purchaseId !== expected.purchaseId) {
    return { status: "rejected", purchaseId: expected.purchaseId, checks: ["purchase_id_allowlisted"] };
  }

  const headers: Record<string, string> = { accept: "application/json" };
  if (evidenceSourceMode === "live") {
    const evidenceToken = runtime.getSecret({ id: SECRET_ID }).result().value;
    if (!evidenceToken) throw new Error("evidence_read_credential_unavailable");
    headers.authorization = `Bearer ${evidenceToken}`;
  }
  const resolvedProofUrl = `${gatewayOrigin}/v1/evidence/purchases/${encodeURIComponent(expected.purchaseId)}/proof`;
  const capsuleResponse = consensusJson(runtime, {
    url: resolvedProofUrl,
    method: "GET",
    headers,
  }, projectCapsuleProof);
  if (!capsuleResponse || typeof capsuleResponse !== "object" || !("proof" in capsuleResponse)) {
    throw new Error("capsule_proof_unavailable");
  }

  const koiosResponse = consensusJson(runtime, {
    url: KOIOS_TX_INFO,
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: new TextEncoder().encode(JSON.stringify({
      _tx_hashes: [expected.txHash], _assets: true, _inputs: false, _metadata: false,
      _withdrawals: false, _certs: false, _scripts: false, _bytecode: false, _governance: false,
    })),
  }, (value) => projectKoiosTransaction(value, expected.txHash));
  const result = verifyPurchase(expected.purchaseId, capsuleResponse.proof, koiosResponse as ChainTransaction | null, expected);
  result.evidenceSource = evidenceSourceMode === "live" ? "live_capsule_proof" : "retained_capsule_snapshot";
  runtime.log(`Capsule commerce verification: ${result.status}`);
  return result;
}

const initWorkflow = (config: Config) => [
  handler(new HTTPCapability().trigger({}), onHTTPTrigger),
];

export async function main() {
  const runner = await Runner.newRunner<Config>();
  await runner.run(initWorkflow);
}
