/**
 * Create a customer API client. The bearer token is written to a gitignored file under data/
 * (mode 0600 where supported) and is NOT printed.
 * Usage: npm run client:create -- --name "Demo agent" --channel mcp [--customer cus_...] [--role customer|payer|operator] [--scopes comma,list]
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { Db } from '../src/infrastructure/db.js';
import { loadCoreEnv } from '../src/infrastructure/config.js';
import { createClient, ALL_CUSTOMER_SCOPES } from '../src/infrastructure/auth.js';
import { Channel, Scope } from '../src/contracts/common.js';

const { values } = parseArgs({ options: { name: { type: 'string' }, channel: { type: 'string', default: 'http' }, customer: { type: 'string' }, role: { type: 'string', default: 'customer' }, scopes: { type: 'string' } } });
const env = loadCoreEnv();
const channel = Channel.parse(values.channel);
const roles: Record<string, Scope[]> = {
  customer: channel === 'mcp' ? ALL_CUSTOMER_SCOPES.filter(s => s !== 'purchases:fund') : ALL_CUSTOMER_SCOPES,
  payer: ['purchases:read', 'purchases:fund'],
  operator: ['purchases:read', 'evidence:read', 'operator:read'],
};
const role = values.role!;
if (!roles[role]) throw new Error('role must be customer, payer, or operator');
const scopes = values.scopes ? values.scopes.split(',').map(s => Scope.parse(s.trim())) : roles[role]!;
const db = new Db(env.DATABASE_PATH);
const r = createClient(db, { displayName: values.name ?? 'Demo customer', channel, label: values.name ?? channel, scopes, ...(values.customer ? { customerId: values.customer } : {}) }, new Date().toISOString());
mkdirSync('data/clients', { recursive: true });
const file = join('data/clients', `${r.clientId}.token`);
writeFileSync(file, r.token + '\n', { mode: 0o600 });
process.stdout.write(`created client ${r.clientId} for customer ${r.customerId} (channel ${channel}, role ${role}, scopes ${scopes.join(',')}); token written to ${file}\n`);
db.close();
