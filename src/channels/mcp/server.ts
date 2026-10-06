import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { GatewayClient } from './client.js';
import { BridgeClient } from './bridge.js';
import { secretsOf, type McpConfig } from './config.js';
import { registerTools } from './tools.js';

const INSTRUCTIONS = [
  'Thin commerce channel. Flow: find_offers -> create_quote -> (user approves exact quote) -> buy -> get_purchase.',
  'Offers are indicative, quotes are exact and immutable. Use synthetic traveller and shipping data in sandbox.',
  'This server cannot sign payments. buy returns "action_required" unless a bounded payer is configured; never tell the user an item was purchased unless a result says status "succeeded".',
].join(' ');

/**
 * Build one MCP server bound to one gateway identity. No DB, no core, no payer keys: every tool is a
 * call to the canonical HTTP gateway (plus an optional call to the separate payer bridge).
 */
export function createMcpServer(config: McpConfig): McpServer {
  const server = new McpServer({ name: 'commerce-gateway', version: '0.1.0' }, { instructions: INSTRUCTIONS });
  registerTools(server, {
    gateway: new GatewayClient(config),
    bridges: BridgeClient.fromConfig(config),
    secrets: secretsOf(config),
  });
  return server;
}
