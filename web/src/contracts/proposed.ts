/**
 * PROPOSED additions the console can use but the gateway does not provide yet.
 *
 * Every field is optional. The console renders without them and shows more when a source supplies them.
 * The sample source fills them in; the gateway source returns them empty until the backend adds them.
 * See docs/contracts/CONSOLE_CONTRACT.md ("Gaps") for the proposed backend change behind each field.
 */
import { z } from 'zod';
import { Money } from './backend.js';

/** Who asked for the purchase, as the customer would name it ("ChatGPT", "Claude"). Gap G2. */
export const RequestedBy = z.object({ name: z.string().min(1).max(80) });

export const PurchaseContext = z.object({
  /** Gap G1: the purchase title in list rows. Detail views read it from the quote. */
  title: z.string().min(1).max(200).optional(),
  /** Gap G2: the assistant's display name. */
  requestedBy: RequestedBy.optional(),
  /** Gap G3: the customer's request in their own words, as relayed by the assistant. */
  requestText: z.string().min(1).max(500).optional(),
  /** Gap G4: the spending limit the customer approved (Approval.maxTotal). */
  approvedMaxTotal: Money.optional(),
});
export type PurchaseContext = z.infer<typeof PurchaseContext>;

export const EMPTY_CONTEXT: PurchaseContext = Object.freeze({});
