import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { applyEntry } from "@/domain/ledger";
import { getLedger, listEntries, recordTrade, resetLedger, saveLedger, voidEntry } from "@/services/ledger-store";
import { getPortfolioInput, savePortfolioInput } from "@/services/portfolio-input-store";
import { getPortfolioSnapshot } from "@/services/portfolio-aggregator";
import { snapshotView } from "@/tools/portfolio-tools";
import { POST } from "../../app/api/agent/route";

const users: string[] = [];
const user = () => { const id = randomUUID(); users.push(id); return id; };
afterEach(async () => { for (const u of users.splice(0)) await resetLedger(u); });

const twoBrokers = {
  accounts: [
    { broker: "삼성증권", name: "", type: "brokerage" as const, cashKRW: 1_000_000, cashUSD: 0, holdings: [{ symbol: "NVDA", quantity: 10, averagePrice: 100 }] },
    { broker: "키움증권", name: "ISA", type: "isa" as const, cashKRW: 0, cashUSD: 0, holdings: [{ symbol: "005930", quantity: 20, averagePrice: 70000 }] },
  ],
};

describe("average cost", () => {
  it("re-weights on buy, keeps on sell and books realized P&L", () => {
    let s = applyEntry(undefined, { kind: "set", symbol: "X", quantity: 10, price: 100 });
    s = applyEntry(s, { kind: "buy", symbol: "X", quantity: 10, price: 130 });
    expect(s).toEqual({ quantity: 20, averagePrice: 115, realizedPnl: 0 });
    s = applyEntry(s, { kind: "sell", symbol: "X", quantity: 5, price: 135 });
    expect(s).toEqual({ quantity: 15, averagePrice: 115, realizedPnl: 100 });
    expect(() => applyEntry(s, { kind: "sell", symbol: "X", quantity: 16, price: 1 })).toThrow();
  });
});

describe("ledger store", () => {
  it("keeps holdings per broker and feeds the snapshot with average cost", async () => {
    const u = user();
    await savePortfolioInput(u, { holdings: [{ symbol: "AAPL", quantity: 1 }], cashKRW: 0, cashUSD: 0 });
    await saveLedger(u, twoBrokers);
    expect(await getPortfolioInput(u)).toBeNull(); // the older single list is replaced
    const ledger = await getLedger(u);
    expect(ledger.map((a) => [a.broker, a.holdings.map((h) => h.symbol)])).toEqual([["삼성증권", ["NVDA"]], ["키움증권", ["005930"]]]);
    const snap = await getPortfolioSnapshot(u);
    expect(Object.keys(snap.totals.byBroker).sort()).toEqual(["삼성증권", "키움증권"]);
    const view = await snapshotView(u, snap);
    const nvda = view.positions.find((p) => p.symbol === "NVDA");
    expect(nvda).toMatchObject({ account: "삼성증권", quantity: 10, averagePrice: 100, currency: "USD" });
    expect(view.positions.find((p) => p.symbol === "005930")?.account).toBe("키움증권 · ISA");
  });

  it("records, previews and undoes trades; refuses overselling", async () => {
    const u = user();
    await saveLedger(u, twoBrokers);
    const samsung = (await getLedger(u))[0].id;
    const trade = { accountId: samsung, action: "buy" as const, symbol: "NVDA", quantity: 10, price: 120, tradedAt: "2026-09-30", source: "chat" as const };
    const preview = await recordTrade(u, trade, { dryRun: true });
    expect(preview.entryId).toBeUndefined();
    expect(preview.after).toMatchObject({ quantity: 20, averagePrice: 110 });
    expect((await getLedger(u))[0].holdings[0].quantity).toBe(10);
    const saved = await recordTrade(u, trade);
    expect((await getLedger(u))[0].holdings[0]).toMatchObject({ quantity: 20, averagePrice: 110 });
    const sell = await recordTrade(u, { ...trade, action: "sell", quantity: 20, price: 130 });
    expect(sell.realized).toBe(400);
    expect((await getLedger(u))[0].holdings).toEqual([]);
    await expect(recordTrade(u, { ...trade, action: "sell", quantity: 1 })).rejects.toThrow(/보유 수량/);
    // undoing the buy would make the later sell overdraw
    await expect(voidEntry(u, saved.entryId!)).rejects.toThrow(/나중 거래부터/);
    await voidEntry(u, sell.entryId!);
    await voidEntry(u, saved.entryId!);
    expect((await getLedger(u))[0].holdings[0]).toMatchObject({ quantity: 10, averagePrice: 100 });
    expect((await listEntries(u)).filter((e) => !e.voidedAt)).toHaveLength(0);
  });

  it("editing a holding keeps trade history and other users cannot touch the account", async () => {
    const u = user(), other = user();
    await saveLedger(u, twoBrokers);
    const [samsung, kiwoom] = await getLedger(u);
    await recordTrade(u, { accountId: samsung.id, action: "buy", symbol: "NVDA", quantity: 5, price: 100, tradedAt: "2026-09-30", source: "chat" });
    await saveLedger(u, { accounts: [{ ...twoBrokers.accounts[0], id: samsung.id, holdings: [{ symbol: "NVDA", quantity: 15, averagePrice: 100 }, { symbol: "AAPL", quantity: 1 }] }] });
    const after = await getLedger(u);
    expect(after.map((a) => a.id)).toEqual([samsung.id]); // 키움 removed
    expect(after[0].holdings.map((h) => [h.symbol, h.quantity])).toEqual([["NVDA", 15], ["AAPL", 1]]);
    expect(await listEntries(u)).toHaveLength(1);
    await expect(recordTrade(other, { accountId: samsung.id, action: "buy", symbol: "NVDA", quantity: 1, price: 1, tradedAt: "2026-09-30", source: "chat" })).rejects.toThrow(/존재하지 않는/);
    await expect(saveLedger(other, { accounts: [{ ...twoBrokers.accounts[1], id: kiwoom.id }] })).rejects.toThrow(/존재하지 않는/);
  });
});

describe("trade reported in chat", () => {
  it("answers with a confirmation draft and leaves the ledger unchanged", async () => {
    const u = user();
    await saveLedger(u, twoBrokers);
    const req = new Request("http://localhost/api/agent", { method: "POST", headers: { cookie: `pia_session=${u}`, "Content-Type": "application/json" }, body: JSON.stringify({ message: "삼성에서 엔비디아 5주 120달러에 샀어" }) });
    const text = await (await POST(req)).text();
    const events = text.split("\n\n").filter((l) => l.startsWith("data: ")).map((l) => JSON.parse(l.slice(6)));
    const draft = events.find((e) => e.type === "trade_draft");
    expect(draft.draft).toMatchObject({ action: "buy", symbol: "NVDA", quantity: 5, price: 120, accountId: (await getLedger(u))[0].id });
    expect(draft.accounts.map((a: { label: string }) => a.label)).toEqual(["삼성증권", "키움증권 · ISA"]);
    expect(events.some((e) => e.type === "run")).toBe(false);
    expect((await getLedger(u))[0].holdings[0].quantity).toBe(10);
  });
});
