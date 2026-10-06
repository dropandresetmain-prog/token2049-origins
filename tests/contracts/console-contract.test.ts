/**
 * Drift guard between the Capsule console (web/) and the gateway (src/).
 *
 * The console cannot import src/evidence/proof.ts (it pulls in the database layer), so it keeps a mirror of
 * PurchaseProof in web/src/contracts/evidence.ts. The evidence list and detail schemas describe what
 * src/evidence/read-model.ts returns, which has no zod schema of its own. This file keeps both honest:
 *
 *  1. runtime: the backend PurchaseProof parses every console sample proof;
 *  2. runtime: the mirror and backend schemas have the identical JSON Schema;
 *  3. compile time (`npm run typecheck`): the read model's return types satisfy the console's schemas.
 */
import { describe, expect, expectTypeOf, it } from 'vitest';
import { z } from 'zod';
import { PurchaseProof as BackendPurchaseProof } from '../../src/evidence/proof.js';
import type { listPurchases, purchaseDetail } from '../../src/evidence/read-model.js';
import {
  EvidenceDetail,
  EvidenceListItem,
  EvidenceListResponse,
  PurchaseProof as MirrorPurchaseProof,
  PurchaseProofResponse,
} from '../../web/src/contracts/evidence.js';
import { createSampleSource } from '../../web/src/source/sample.js';

const source = createSampleSource({ now: Date.parse('2026-10-06T10:20:00Z') });

async function bundles() {
  const list = await source.listPurchases();
  expect(list.entries.length).toBeGreaterThan(0);
  return Promise.all(list.entries.map(async (e) => ({ item: e.item, bundle: await source.getPurchase(e.item.id) })));
}

describe('console contract drift: PurchaseProof', () => {
  it('the backend schema parses every sample proof', async () => {
    for (const { item, bundle } of await bundles()) {
      expect(bundle.proof, item.id).not.toBeNull();
      const parsed = BackendPurchaseProof.safeParse(bundle.proof);
      expect(parsed.success, `${item.id}: ${parsed.success ? '' : JSON.stringify(parsed.error.issues)}`).toBe(true);
      // Strict on both sides: parsing must not drop or add anything.
      expect(parsed.success && parsed.data).toEqual(bundle.proof);
    }
  });

  it('the mirror and backend schemas generate identical JSON Schema', () => {
    const mirror = z.toJSONSchema(MirrorPurchaseProof, { io: 'input' });
    const backend = z.toJSONSchema(BackendPurchaseProof, { io: 'input' });
    expect(mirror).toEqual(backend);
    // Same for the output direction (defaults and transforms), and guard against a vacuous comparison.
    expect(z.toJSONSchema(MirrorPurchaseProof, { io: 'output' })).toEqual(z.toJSONSchema(BackendPurchaseProof, { io: 'output' }));
    const props = (mirror as { properties?: Record<string, unknown>; additionalProperties?: unknown });
    expect(Object.keys(props.properties ?? {})).toEqual(expect.arrayContaining(['purchaseId', 'timeline', 'funding', 'merchant', 'receipt', 'technicalEvidencePath']));
    expect(props.additionalProperties).toBe(false);
  });

  it('a field added to either side is detected', () => {
    const extended = BackendPurchaseProof.extend({ extra: z.string() });
    expect(z.toJSONSchema(extended)).not.toEqual(z.toJSONSchema(MirrorPurchaseProof));
  });

  it('the mirror response wrapper matches the backend route body { proof }', async () => {
    for (const { bundle } of await bundles()) {
      expect(PurchaseProofResponse.safeParse({ proof: bundle.proof }).success).toBe(true);
    }
  });
});

describe('console contract drift: evidence list and detail', () => {
  it('sample list items and the technical record satisfy the console schemas', async () => {
    for (const { item, bundle } of await bundles()) {
      expect(EvidenceListItem.safeParse(item).success, item.id).toBe(true);
      expect(EvidenceDetail.safeParse(bundle.technicalRecord).success, item.id).toBe(true);
    }
    const list = await source.listPurchases();
    expect(EvidenceListResponse.safeParse({ purchases: list.entries.map((e) => e.item), limit: list.limit }).success).toBe(true);
  });
});

/* ---------- compile-time: checked by `npm run typecheck` (tsconfig includes tests/) ---------- */

type ListItem = Awaited<ReturnType<typeof listPurchases>>[number];
type Detail = Awaited<ReturnType<typeof purchaseDetail>>;

describe('console contract drift: read-model return types (compile time)', () => {
  it('listPurchases() items are assignable to the EvidenceListItem input', () => {
    expectTypeOf<ListItem>().toExtend<z.input<typeof EvidenceListItem>>();
  });

  it('purchaseDetail() carries the parts of EvidenceDetail the console reads', () => {
    expectTypeOf<Pick<Detail, 'purchase' | 'reservation' | 'events'>>().toExtend<z.input<typeof EvidenceDetail>>();
  });
});
