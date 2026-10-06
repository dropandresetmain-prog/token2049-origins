import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ConfigError, loadConfigFromEnv } from './config.js';
import { createMcpServer } from './server.js';
import { startMcpHttpServer } from './http.js';

/**
 * Entrypoint. stdio by default (stdout is the protocol channel, so diagnostics go to stderr only);
 * streamable HTTP on 127.0.0.1 when MCP_HTTP_PORT is set. Never logs token values.
 */
async function main(): Promise<void> {
  const config = loadConfigFromEnv(process.env);
  if (config.httpPort !== undefined) {
    const h = await startMcpHttpServer(config, config.httpPort);
    process.stderr.write(`mcp: streamable HTTP listening at ${h.url} (bridge ${config.bridge ? 'configured' : 'not configured'})\n`);
    const stop = () => void h.close().then(() => process.exit(0));
    process.on('SIGINT', stop);
    process.on('SIGTERM', stop);
    return;
  }
  await createMcpServer(config).connect(new StdioServerTransport());
  process.stderr.write(`mcp: stdio ready (bridge ${config.bridge ? 'configured' : 'not configured'})\n`);
}

main().catch((e: unknown) => {
  // Config errors are safe to print (they never contain secrets); anything else is reduced to a name.
  process.stderr.write(`mcp: fatal: ${e instanceof ConfigError ? e.message : e instanceof Error ? e.name : 'error'}\n`);
  process.exit(1);
});
