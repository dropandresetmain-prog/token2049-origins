/** Shared fixture orchestration; child gateway receives only its own environment. */
import { fork, type ChildProcess } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import assert from "node:assert/strict";
import { loadPayerConfig } from "../../clients/payer/config.js";
const config = loadPayerConfig(process.env);
let child: ChildProcess;
let counter = 0;
export async function start() {
    child = fork("integration-e2e/cardano/gateway.ts", [], {
        execPath: process.execPath,
        execArgv: ["--env-file=.env.cardano-e2e", "--import", "tsx"],
        env: {
            PATH: process.env.PATH,
            SystemRoot: process.env.SystemRoot,
            TEMP: process.env.TEMP
        },
        silent: true
    });
    child.stdout?.on("data", () => {
    });
    child.stderr?.on("data", s => writeFileSync("data/cardano/gateway-error.log", s, {
        flag: "a",
        mode: 384
    }));
    await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(Error("gateway startup timeout")), 30000);
        child.on("message", (m: any) => {
            if (m.ready) {
                clearTimeout(timer);
                resolve();
            }
        });
        child.on("exit", code => {
            clearTimeout(timer);
            reject(Error("gateway startup failed " + code));
        });
    });
}
export async function ipc(op: string) {
    const id = ++counter;
    return new Promise<any>((resolve, reject) => {
        const timer = setTimeout(() => reject(Error("gateway operation timeout")), 15000);
        const handler = (m: any) => {
            if (m.id === id) {
                clearTimeout(timer);
                child.off("message", handler);
                m.ok ? resolve(m) : reject(Error("gateway operation failed"));
            }
        };
        child.on("message", handler);
        child.send({
            id,
            op
        });
    });
}
export async function call(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
    const token = readFileSync(config.gatewayTokenFile, "utf8").trim();
    const response = await fetch(config.gatewayUrl + path, {
        method,
        headers: {
            authorization: "Bearer " + token,
            ...(body !== undefined ? {
                "content-type": "application/json"
            } : {}),
            ...headers
        },
        ...(body !== undefined ? {
            body: JSON.stringify(body)
        } : {}),
        signal: AbortSignal.timeout(150000),
        redirect: "error"
    });
    return {
        response,
        body: await response.json() as any
    };
}
export async function purchase(key: string) {
    const s = await call("POST", "/v1/offers/search", {
        intent: {
            category: "hotel",
            destination: {
                cityName: "Singapore",
                countryCode: "SG"
            },
            checkin: "2026-11-01",
            checkout: "2026-11-02",
            occupancies: [{
                    adults: 1,
                    childrenAges: []
                }],
            guestNationality: "SG",
            spendCeiling: {
                currency: "USD",
                amountMinor: "102",
                scale: 2
            }
        }
    });
    assert.equal(s.response.status, 200);
    const q = await call("POST", "/v1/quotes", {
        offerId: s.body.offers[0].offerId,
        fulfillment: {
            category: "hotel",
            holder: {
                firstName: "Test",
                lastName: "Buyer",
                email: "test@example.invalid",
                phone: "+6599999999"
            },
            guests: [{
                    occupancyNumber: 1,
                    firstName: "Test",
                    lastName: "Buyer",
                    email: "test@example.invalid"
                }]
        }
    });
    assert.equal(q.response.status, 201);
    const quote = q.body.quote;
    const p = await call("POST", "/v1/purchases", {
        quoteId: quote.quoteId,
        approval: {
            maxTotal: quote.payablePrincipal,
            quoteDigest: quote.digest,
            selectedFundingOptionId: quote.fundingOptions[0].fundingOptionId
        }
    }, {
        "idempotency-key": key
    });
    assert.equal(p.response.status, 201);
    assert.equal(p.body.purchase.fundingInstructions.options[0].amount.amountBaseUnits, "1020");
    return p.body.purchase;
}
export async function close() {
    if (child?.connected)
        await ipc("close").catch(() => child.kill());
}
