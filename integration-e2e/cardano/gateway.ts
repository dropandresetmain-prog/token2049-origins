/** Isolated gateway process: real Cardano adapter, fixture hotel, no payer authority. */
import { readFileSync, writeFileSync } from "node:fs";
import { Pool } from "pg";
import { buildGateway } from "../../src/composition.js";
import { Db } from "../../src/infrastructure/db.js";
import { systemClock } from "../../src/infrastructure/clock.js";
import { createClient } from "../../src/infrastructure/auth.js";
import { createCardanoFundingAdapter } from "../../src/funding/cardano/adapter.js";
import { FixtureExecutor } from "../../tests/support/fixtures.js";
import { trialBalance } from "../../src/core/journal.js";
const state = JSON.parse(readFileSync("data/cardano/run-private.json", "utf8"));
if (!/^cardano_e2e_[a-f0-9]{32}$/.test(state.schema))
    throw Error("invalid isolated schema");
if (Object.keys(process.env).some(k => k.startsWith("PAYER_") || k === "MNEMONIC"))
    throw Error("payer authority leaked into gateway");
const admin = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 1
});
await admin.query(`CREATE SCHEMA IF NOT EXISTS "${state.schema}"`);
await admin.end();
const db = new Db(process.env.DATABASE_URL!, state.schema);
const hotel = new FixtureExecutor("nuitee", "hotel", systemClock, 100n);
const adapter = createCardanoFundingAdapter(process.env);
const gw = await buildGateway({
    executors: [hotel],
    fundingAdapters: [adapter],
    bankAdapters: []
}, {
    db
});
gw.core.deps.config.settlementPolicy = {
    mode: "scaled_testnet",
    numerator: 1,
    denominator: 1000
};
if (!state.customerId) {
    const client = await createClient(db, {
        displayName: "Cardano live E2E",
        channel: "test",
        label: "cardano-isolated"
    }, new Date().toISOString());
    state.customerId = client.customerId;
    writeFileSync("data/cardano/gateway.token", client.token, {
        flag: "wx",
        mode: 384
    });
    writeFileSync("data/cardano/run-private.json", JSON.stringify(state, null, 2));
}
const server = gw.app.listen(Number(process.env.PORT), "127.0.0.1", () => process.send?.({
    ready: true,
    readiness: "pending"
}));
process.on("message", async (message: any) => {
    try {
        if (message.op === "tick") {
            await gw.worker.tick();
            process.send?.({
                id: message.id,
                ok: true
            });
        }
        if (message.op === "snapshot") {
            const counts: any = {};
            for (const table of ["funding_evidence", "funding_attempts", "reservations", "journal_entries", "jobs"])
                counts[table] = (await db.get<any>(`SELECT count(*)::int AS n FROM ${table}`))!.n;
            process.send?.({
                id: message.id,
                ok: true,
                counts,
                executions: hotel.executeCalls,
                balance: [...await trialBalance(db)].map(([asset, sum]) => ({
                    asset,
                    sum: sum.toString()
                }))
            });
        }
        if (message.op === "close") {
            server.close(async () => {
                await db.close();
                process.send?.({
                    id: message.id,
                    ok: true
                });
                process.exit(0);
            });
        }
    }
    catch {
        process.send?.({
            id: message.id,
            ok: false
        });
    }
});
