import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { mcpToken, OWNER_USER_ID } from "@/lib/owner-auth";
import { getLedger, resetLedger, saveLedger } from "@/services/ledger-store";
import { POST } from "../../app/api/mcp/[token]/route";

const rpc = async (token: string, body: unknown) => {
  const req = new Request(`http://localhost/api/mcp/${token}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
    body: JSON.stringify(body),
  });
  return POST(req, { params: Promise.resolve({ token }) });
};
const call = async (name: string, args: Record<string, unknown> = {}) => {
  const res = await rpc(mcpToken(), { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } });
  expect(res.status).toBe(200);
  const { result } = await res.json();
  return { ...result, data: result.isError ? undefined : JSON.parse(result.content[0].text) };
};

describe("owner MCP endpoint", () => {
  beforeAll(async () => {
    vi.stubEnv("OWNER_PASSCODE", "correct horse battery");
    await saveLedger(OWNER_USER_ID, { accounts: [{ broker: "삼성증권", name: "", type: "brokerage", cashKRW: 500_000, cashUSD: 0, holdings: [{ symbol: "NVDA", quantity: 10, averagePrice: 100 }] }] });
  });
  afterAll(async () => {
    await resetLedger(OWNER_USER_ID);
    vi.unstubAllEnvs();
  });

  it("is a 404 for any token but the owner's", async () => {
    expect((await rpc("nope", { jsonrpc: "2.0", id: 1, method: "tools/list" })).status).toBe(404);
    vi.stubEnv("OWNER_PASSCODE", "");
    expect((await rpc(mcpToken(), { jsonrpc: "2.0", id: 1, method: "tools/list" })).status).toBe(404);
    vi.stubEnv("OWNER_PASSCODE", "correct horse battery");
  });

  it("initializes and lists the ledger tools", async () => {
    const init = await rpc(mcpToken(), { jsonrpc: "2.0", id: 0, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "0" } } });
    expect(init.status).toBe(200);
    expect((await init.json()).result.serverInfo.name).toBe("my-ai-pb");
    const list = await rpc(mcpToken(), { jsonrpc: "2.0", id: 1, method: "tools/list" });
    const names = (await list.json()).result.tools.map((t: { name: string }) => t.name);
    expect(names).toEqual(expect.arrayContaining(["get_ledger", "get_portfolio", "get_today", "simulate_trade", "record_trade", "undo_trade"]));
  });

  it("reads the owner's ledger with broker names", async () => {
    const { data } = await call("get_ledger");
    expect(data.accounts).toHaveLength(1);
    expect(data.accounts[0]).toMatchObject({ broker: "삼성증권", holdings: [{ symbol: "NVDA", quantity: 10, averagePrice: 100, currency: "USD" }] });
    const pos = await call("get_position", { symbol: "nvda" });
    expect(pos.data[0]).toMatchObject({ account: "삼성증권", quantity: 10, averagePrice: 100 });
  });

  it("previews a trade without saving, then saves on confirm and can undo it", async () => {
    const [{ id: accountId }] = await getLedger(OWNER_USER_ID);
    const preview = await call("record_trade", { accountId, action: "buy", symbol: "nvda", quantity: 10, price: 130 });
    expect(preview.data).toMatchObject({ saved: false, before: { quantity: 10 }, after: { quantity: 20, averagePrice: 115 } });
    expect((await getLedger(OWNER_USER_ID))[0].holdings[0].quantity).toBe(10);

    const saved = await call("record_trade", { accountId, action: "buy", symbol: "NVDA", quantity: 10, price: 130, confirm: true });
    expect(saved.data.saved).toBe(true);
    expect((await getLedger(OWNER_USER_ID))[0].holdings[0]).toMatchObject({ quantity: 20, averagePrice: 115 });

    const trades = await call("list_trades");
    expect(trades.data[0]).toMatchObject({ action: "buy", quantity: 10, price: 130 });
    await call("undo_trade", { entryId: trades.data[0].entryId });
    expect((await getLedger(OWNER_USER_ID))[0].holdings[0].quantity).toBe(10);
  });

  it("returns a tool error instead of throwing on a bad account", async () => {
    const res = await call("record_trade", { accountId: "00000000-0000-0000-0000-000000000000", action: "sell", symbol: "NVDA", quantity: 1, price: 1, confirm: true });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain("계좌");
  });
});
