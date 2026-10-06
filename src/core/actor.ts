import type { Channel, Scope } from '../contracts/common.js';

/** Resolved server-side from an authenticated credential. A client-supplied agent ID confers nothing. */
export interface ActorContext {
  customerId: string;
  clientId: string;
  channel: Channel;
  scopes: ReadonlySet<Scope>;
  requestId: string;
}
