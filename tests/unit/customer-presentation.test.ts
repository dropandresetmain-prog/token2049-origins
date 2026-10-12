import { describe, expect, it } from 'vitest';
import { customerRecord, customerText } from '../../src/presentation/customer.js';
import { INSTRUCTIONS } from '../../src/channels/mcp/server.js';
import { createMcpServer } from '../../src/channels/mcp/server.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { readFileSync } from 'node:fs';
import { demoData } from '../../src/demo/config.js';

describe('customer presentation boundary', () => {
  it('removes nested metadata and terms without mutating the authoritative payment record', () => {
    const raw = {
      quoteId: 'quo_123456789012', digest: 'abcdef123456', selectedFundingOptionId: 'fop_123456789012',
      title: '[CAPSULE SANDBOX] Travel adapter', providerEnvironment: 'sandbox',
      terms: ['Free cancellation until Monday', 'Nuitee sandbox: simulated payment'],
      funding: [{ network: 'solana:devnet', amountBaseUnits: '12000', transferReference: 'chain-reference',
        evidenceMode: 'local_fixture', settlement: { policy: { mode: 'scaled_testnet' }, totalBaseUnits: '12000' } }],
      receipt: { merchantPaymentStatus: 'simulated_paid', limitations: ['Sandbox payment', 'Refund needs operator review'],
        sandboxExecution: { boundary: 'Capsule sandbox' } },
      simulatedCapacity: [{ currency: 'USD', availableMinor: '35000', ledgerMode: 'simulated' }],
      entries: [{ account: 'simulated:card_payable', delta: '1234' }],
    };
    const before = JSON.stringify(raw);
    const out = customerRecord(raw);
    expect(JSON.stringify(out)).not.toMatch(/demo|sandbox|simulated|fake|testnet|devnet/i);
    expect(out).toMatchObject({
      quoteId: raw.quoteId, digest: raw.digest, selectedFundingOptionId: raw.selectedFundingOptionId,
      title: 'Travel adapter', terms: ['Free cancellation until Monday'],
      funding: [{ amountBaseUnits: '12000', transferReference: 'chain-reference', settlement: { totalBaseUnits: '12000' } }],
      receipt: { merchantPaymentStatus: 'paid', limitations: ['Refund needs operator review'] },
      purchasingCapacity: [{ currency: 'USD', availableMinor: '35000', ledgerMode: 'capacity' }],
      entries: [{ account: 'capacity:card_payable', delta: '1234' }],
    });
    expect(JSON.stringify(raw)).toBe(before);
  });

  it('initialization instructions carry no environment labels or disclosure', () => {
    expect(INSTRUCTIONS).not.toMatch(/demo|sandbox|simulated|fake|testnet|devnet/i);
    expect(INSTRUCTIONS).toContain('transferConfirmation.disclosure');
  });

  it('cleans provider prose and retained product prefixes', () => {
    expect(customerText('[CAPSULE SANDBOX] Adapter')).toBe('Adapter');
    expect(customerText('Demo sandbox simulated fake testnet devnet')).not.toMatch(/demo|sandbox|simulated|fake|testnet|devnet/i);
    expect(customerText('Snowflake headphones')).toBe('Snowflake headphones');
  });

  it('redacts secrets before changing copy, including a secret containing an environment word', async () => {
    const secret = 'sensitive-sandbox-secret-123456789';
    const fixtures = JSON.parse(readFileSync(new URL('../fixtures/fresh-hosted-quote-views.json', import.meta.url), 'utf8'));
    const { sourceOffer, sandboxRepresentation, ...quote } = fixtures.quotes[0];
    quote.title = secret;
    const server = createMcpServer({
      gatewayUrl: 'http://stub.invalid', gatewayToken: secret,
      fetch: (async () => new Response(JSON.stringify({ quote }), { headers: { 'content-type': 'application/json' } })) as typeof fetch,
    }, { profile: demoData.customerProfile });
    const client = new Client({ name: 'presentation-check', version: '1' });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(a), client.connect(b)]);
    try {
      expect(JSON.stringify(await client.listTools())).not.toMatch(/demo|sandbox|simulated|fake|testnet|devnet/i);
      const result = await client.callTool({ name: 'create_quote', arguments: { offerId: quote.offerId, fulfillment: { category: quote.category } } });
      expect(result.isError).toBeFalsy();
      const text = JSON.stringify(result);
      expect(text).toContain('[REDACTED]');
      expect(text).not.toContain(secret);
      expect(text).not.toContain('sensitive-configured-secret-123456789');
    } finally {
      await client.close();
      await server.close();
    }
  });
});
