/**
 * CLI: pay one gateway purchase from the local payer wallet.
 *
 *   npx tsx clients/payer/pay.ts --purchase pur_XXXXXXXXXXXX
 *
 * Reads PAYER_* / BLOCKFROST_PROJECT_ID from the environment (load .env.payer yourself, for example with
 * `node --env-file=.env.payer`). Prints the resulting purchase status and transaction id. Never prints
 * headers, tokens or the mnemonic.
 */
import { pathToFileURL } from 'node:url';
import { loadPayerConfig } from './config.js';
import { Payer, PayerError } from './payer.js';

export function parseArgs(argv: string[]): { purchaseId: string } {
  const i = argv.indexOf('--purchase');
  const id = i >= 0 ? argv[i + 1] : undefined;
  if (!id) throw new PayerError('invalid_request', 'usage: pay.ts --purchase <purchaseId>');
  return { purchaseId: id };
}

export async function main(argv: string[], env: NodeJS.ProcessEnv, out: { write(s: string): unknown }): Promise<number> {
  try {
    const { purchaseId } = parseArgs(argv);
    const payer = new Payer({ config: loadPayerConfig(env), log: (e) => out.write(`${JSON.stringify(e)}\n`) });
    const r = await payer.pay(purchaseId);
    const p = r.purchase as { state?: string; paymentState?: string } | null;
    out.write(
      `${JSON.stringify({ ok: true, purchaseId, state: p?.state ?? null, paymentState: p?.paymentState ?? null, transferReference: r.transferReference, resumed: r.resumed })}\n`,
    );
    return 0;
  } catch (e) {
    if (e instanceof PayerError) {
      const p = e.purchase as { state?: string; paymentState?: string } | undefined;
      out.write(
        `${JSON.stringify({ ok: false, error: { code: e.code, message: e.message }, ...(p ? { purchase: { state: p.state ?? null, paymentState: p.paymentState ?? null } } : {}) })}\n`,
      );
    } else {
      const message = e instanceof Error && /^invalid payer configuration/.test(e.message) ? e.message : 'payer failed';
      out.write(`${JSON.stringify({ ok: false, error: { code: 'internal', message } })}\n`);
    }
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2), process.env, process.stdout).then((c) => {
    process.exitCode = c;
  });
}
