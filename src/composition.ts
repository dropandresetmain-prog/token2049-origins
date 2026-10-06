import { Db } from './infrastructure/db.js';
import { systemClock, type Clock, iso } from './infrastructure/clock.js';
import { loadCoreEnv, toCoreConfig, type CoreEnv } from './infrastructure/config.js';
import { CommerceCore } from './core/service.js';
import { Worker } from './core/worker.js';
import { seedCapacityPool } from './core/capacity.js';
import { createHttpApp } from './channels/http/app.js';
import type { CommerceExecutor, FundingAdapter, BankObservationAdapter } from './contracts/ports.js';
import type { FundingRail, ProviderRoute } from './contracts/common.js';
import type { Router } from 'express';

export interface GatewayParts {
  executors: CommerceExecutor[];
  fundingAdapters: FundingAdapter[];
  bankAdapters: BankObservationAdapter[];
  extraRouters?: Array<{ path: string; router: Router; auth: boolean }>;
}

export interface Gateway {
  env: CoreEnv;
  db: Db;
  core: CommerceCore;
  worker: Worker;
  app: ReturnType<typeof createHttpApp>;
}

/**
 * Wire the gateway. Production composition passes real adapters (see main.ts); tests pass
 * fixture adapters through this same function. There is no environment switch that swaps a
 * real rail for a fixture inside the deployed process.
 */
export function buildGateway(parts: GatewayParts, opts: { env?: NodeJS.ProcessEnv; clock?: Clock; db?: Db; log?: (l: Record<string, unknown>) => void } = {}): Gateway {
  const env = loadCoreEnv(opts.env ?? process.env);
  const clock = opts.clock ?? systemClock;
  const db = opts.db ?? new Db(env.DATABASE_PATH);
  seedCapacityPool(db, 'USD', 2, env.SIMULATED_CARD_CAPACITY_USD_MINOR, iso(clock.now()));
  const core = new CommerceCore({
    db,
    clock,
    config: toCoreConfig(env),
    executors: new Map<ProviderRoute, CommerceExecutor>(parts.executors.map((e) => [e.route, e])),
    fundingAdapters: new Map<FundingRail, FundingAdapter>(parts.fundingAdapters.map((a) => [a.rail, a])),
    bankAdapters: parts.bankAdapters,
  });
  const worker = new Worker(core);
  const app = createHttpApp({ core, ...(parts.extraRouters ? { extraRouters: parts.extraRouters } : {}), ...(opts.log ? { log: opts.log } : {}) });
  return { env, db, core, worker, app };
}
