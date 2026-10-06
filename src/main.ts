import { buildGateway } from './composition.js';
import { realParts } from './wiring.js';
import { redact } from './infrastructure/redact.js';

const log = (l: Record<string, unknown>) => process.stdout.write(`${JSON.stringify(redact({ t: new Date().toISOString(), ...l }))}\n`);

const gw = await buildGateway(realParts(process.env, log), { log });
await gw.worker.start(gw.env.WORKER_INTERVAL_MS);
const server = gw.app.listen(gw.env.PORT, gw.env.HOST, () => {
  log({ msg: 'gateway listening', host: gw.env.HOST, port: gw.env.PORT, appEnv: gw.env.APP_ENV });
});

const shutdown = () => {
  gw.worker.stop();
  server.close(async () => {
    await gw.close();
    process.exit(0);
  });
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
