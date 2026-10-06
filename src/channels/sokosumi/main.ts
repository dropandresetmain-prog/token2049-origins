import express from 'express';
import { Db } from '../../infrastructure/db.js';
import { MasumiClient, TUSDM, validateServiceUrl } from '../../integrations/masumi/client.js';
import { SokosumiRuntime } from './runtime.js';

const required = (name: string): string => { const value = process.env[name]?.trim(); if (!value) throw new Error('Missing ' + name); return value; };
const db = new Db(required('SOKOSUMI_DATABASE_URL'), process.env.SOKOSUMI_DATABASE_SCHEMA ?? 'public');
const client = new MasumiClient({
  baseUrl: validateServiceUrl(required('MASUMI_PAYMENT_SERVICE_URL')), token: required('MASUMI_PAYMENT_API_KEY'),
  agentIdentifier: required('MASUMI_AGENT_ID'), sellerVkey: required('MASUMI_SELLER_VKEY'),
  sellerAddress: required('MASUMI_SELLER_ADDRESS'), contractAddress: required('MASUMI_CONTRACT_ADDRESS'), assetUnit: required('MASUMI_PAYMENT_ASSET_UNIT'),
  feeBaseUnits: required('MASUMI_SERVICE_FEE_BASE_UNITS'), blockfrostKey: required('MASUMI_BLOCKFROST_PROJECT_ID'),
  blockfrostBaseUrl: 'https://cardano-preprod.blockfrost.io/api/v0',
});
if (process.env.MASUMI_NETWORK !== 'preprod' || client.config.assetUnit !== TUSDM) throw new Error('Only bounded Preprod is enabled');
const runtime = new SokosumiRuntime({ db, masumi: client, gatewayUrl: required('GATEWAY_URL'), identities: [{
  owner: required('SOKOSUMI_CUSTOMER_ID'), token: required('MASUMI_CHANNEL_AUTH_TOKEN'), gatewayToken: required('GATEWAY_API_TOKEN'),
}] });
await runtime.initialize();
const app = express().disable('x-powered-by');
app.use(express.json({ limit: '12kb' }));
app.use(runtime.router());
app.use((_error: unknown, _q: express.Request, res: express.Response, _n: express.NextFunction) => res.status(400).json({ error: { code: 'invalid_request' } }));
const server = app.listen(Number(process.env.SOKOSUMI_PORT ?? '3013'), '127.0.0.1', () => process.stdout.write('Authenticated Preprod agent listening on loopback\n'));
const stop = () => server.close(async () => { await db.close(); process.exit(0); });
process.on('SIGINT', stop); process.on('SIGTERM', stop);
