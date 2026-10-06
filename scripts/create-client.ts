/**
 * Create a customer API client. The bearer token is written to a gitignored file under data/
 * (mode 0600 where supported) and is NOT printed.
 * Usage: npm run client:create -- --name "Demo agent" --channel mcp [--customer cus_...]
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { Db } from '../src/infrastructure/db.js';
import { loadCoreEnv } from '../src/infrastructure/config.js';
import { createClient } from '../src/infrastructure/auth.js';
import { Channel } from '../src/contracts/common.js';

const { values } = parseArgs({ options: { name: { type: 'string' }, channel: { type: 'string', default: 'http' }, customer: { type: 'string' } } });
const env = loadCoreEnv();
const channel = Channel.parse(values.channel);
const db = new Db(env.DATABASE_PATH);
const r = createClient(db, { displayName: values.name ?? 'Demo customer', channel, label: values.name ?? channel, ...(values.customer ? { customerId: values.customer } : {}) }, new Date().toISOString());
mkdirSync('data/clients', { recursive: true });
const file = join('data/clients', `${r.clientId}.token`);
writeFileSync(file, r.token + '\n', { mode: 0o600 });
process.stdout.write(`created client ${r.clientId} for customer ${r.customerId} (channel ${channel}); token written to ${file}\n`);
db.close();
