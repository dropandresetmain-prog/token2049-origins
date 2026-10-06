/**
 * Gateway source: authenticated, read-only calls to the gateway HTTP API. Every response is validated
 * with the gateway's own schemas before it reaches a presenter.
 *
 * STUB: implemented on the console/source branch. See docs/contracts/CONSOLE_CONTRACT.md.
 */
import { ConsoleError, type ConsoleSource } from '../contracts/source.js';

export interface GatewaySourceOptions {
  /** '' for same-origin. */
  baseUrl: string;
  accessKey: string;
  fetchImpl?: typeof fetch;
}

export function createGatewaySource(_opts: GatewaySourceOptions): ConsoleSource {
  const notYet = async (): Promise<never> => {
    throw new ConsoleError('internal', 'gateway source not implemented yet');
  };
  return { kind: 'gateway', environment: notYet, listPurchases: notYet, getPurchase: notYet };
}
