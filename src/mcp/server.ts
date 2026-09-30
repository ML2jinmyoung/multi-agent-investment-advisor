import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { todayModelHooks } from "@/agents/today-hooks";
import { accountLabel, LedgerError, tradingCurrency } from "@/domain/ledger";
import { ScenarioShock } from "@/domain/simulation";
import { withoutLlm } from "@/providers/llm/demo";
import { getEvidenceService } from "@/services/evidence-service";
import { getMetrics } from "@/services/exposure-engine";
import { getLedger, listEntries, recordTrade, voidEntry } from "@/services/ledger-store";
import { checkPolicy } from "@/services/policy-engine";
import { getPolicy } from "@/services/policy-store";
import { getPortfolioSnapshot, marketDataProvider } from "@/services/portfolio-aggregator";
import { runSimulation, SimulationError } from "@/services/simulation-engine";
import { getToday } from "@/services/today-service";
import { snapshotView } from "@/tools/portfolio-tools";
import { simulationView } from "@/tools/simulation-tools";
import { r1 } from "@/tools/shared";

/**
 * MCP server for the owner's ledger, so the Claude app (a custom connector on a Pro/Max plan) can talk about the
 * owner's holdings with no model cost on this side: every tool is deterministic, the reasoning happens in the
 * Claude app. Mirrors the in-app agent tools; the only write is `record_trade`, and it previews before saving.
 */
export function createOwnerMcpServer(userId: string): McpServer {
  const server = new McpServer({ name: "my-ai-pb", version: "1.0.0" });
  const json = (value: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(value) }] });
  const fail = (message: string) => ({ content: [{ type: "text" as const, text: message }], isError: true });
  const run = async (fn: () => Promise<unknown>) => {
    try {
      return json(await fn());
    } catch (e) {
      if (e instanceof LedgerError || e instanceof SimulationError) return fail(e.message);
      return fail(e instanceof Error ? e.message : "요청을 처리하지 못했습니다.");
    }
  };
  const today = () => new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" });
  const readOnly = { readOnlyHint: true, destructiveHint: false, openWorldHint: false };

  // ── holdings ──
  server.registerTool("get_ledger", {
    title: "증권사별 장부",
    description: "증권사 계좌마다 보유 종목의 수량, 평균 매입가(종목 통화), 실현 손익, 예수금. 시세는 포함하지 않는다. 거래를 기록하려면 여기서 accountId를 찾는다.",
    inputSchema: z.object({}),
    annotations: readOnly,
  }, () => run(async () => ({
    accounts: (await getLedger(userId)).map((a) => ({
      accountId: a.id, broker: a.broker, name: a.name, label: accountLabel(a), type: a.type, cashKRW: a.cashKRW, cashUSD: a.cashUSD,
      holdings: a.holdings.map((h) => ({ symbol: h.symbol, quantity: h.quantity, averagePrice: h.averagePrice, currency: tradingCurrency(h.symbol), realizedPnl: h.realizedPnl })),
    })),
  })));

  server.registerTool("get_portfolio", {
    title: "포트폴리오 현황",
    description: "모든 계좌의 평가액(KRW), 종목별 비중과 수익률, 통화/국가/섹터 비중, 투자 가능 금액. 금액과 비중은 이 결과의 숫자만 쓴다.",
    inputSchema: z.object({}),
    annotations: readOnly,
  }, () => run(() => snapshotView(userId)));

  server.registerTool("get_position", {
    title: "종목 보유 내역",
    description: "한 종목을 어느 계좌에 얼마나, 얼마에 들고 있는지",
    inputSchema: z.object({ symbol: z.string().describe("종목 코드: NVDA, 005930") }),
    annotations: readOnly,
  }, ({ symbol }) => run(async () => {
    const snap = await getPortfolioSnapshot(userId);
    const byId = new Map(snap.accounts.map((a) => [a.id, a]));
    return snap.positions.filter((p) => p.symbol === symbol.toUpperCase()).map((p) => ({ account: byId.get(p.accountId)?.name ?? "", quantity: p.quantity, averagePrice: p.averagePrice, currentPrice: p.currentPrice, marketValueKRW: Math.round(p.marketValueKRW), currency: p.currency }));
  }));

  server.registerTool("get_exposure", {
    title: "실질 노출",
    description: "ETF 구성 종목까지 본 종목별 실질 노출(직접 보유 + ETF 내부 보유). symbol을 생략하면 상위 10개.",
    inputSchema: z.object({ symbol: z.string().optional() }),
    annotations: readOnly,
  }, ({ symbol }) => run(async () => {
    const { metrics, warnings } = await getMetrics(await getPortfolioSnapshot(userId));
    const list = (symbol ? metrics.symbols.filter((s) => s.key === symbol.toUpperCase()) : metrics.symbols.slice(0, 10)).map((s) => ({
      symbol: s.key, name: s.name, directValueKRW: Math.round(s.directValueKRW), indirectValueKRW: Math.round(s.indirectValueKRW), totalValueKRW: Math.round(s.totalValueKRW), portfolioWeightPct: r1(s.portfolioWeightPct),
      note: s.kind === "etf-residual" ? "구성 종목을 확인하지 못한 ETF 잔여분" : undefined,
    }));
    return { exposures: list, warnings };
  }));

  // ── market ──
  server.registerTool("get_quotes", {
    title: "현재가",
    description: "종목 현재가와 등락률 (출처, 기준 시각 포함)",
    inputSchema: z.object({ symbols: z.array(z.string()).min(1).max(20) }),
    annotations: readOnly,
  }, ({ symbols }) => run(async () =>
    (await marketDataProvider().getQuotes(symbols.map((s) => s.toUpperCase()))).map((q) => ({ symbol: q.symbol, price: q.price, currency: q.currency, changePct: q.changePct, source: q.provenance.source, asOf: q.provenance.asOf, isMock: q.provenance.isMock })),
  ));

  server.registerTool("get_price_history", {
    title: "가격 이력",
    description: "일봉 종가 이력 (period: 1w|1m|3m|6m|1y). 최근 추세 설명용이며 예측에 쓰지 않는다.",
    inputSchema: z.object({ symbol: z.string(), period: z.enum(["1w", "1m", "3m", "6m", "1y"]).default("1m") }),
    annotations: readOnly,
  }, ({ symbol, period }) => run(async () => {
    const candles = await marketDataProvider().getPriceHistory(symbol.toUpperCase(), period);
    const first = candles[0]?.close;
    const last = candles.at(-1)?.close;
    return { symbol: symbol.toUpperCase(), candles: candles.map((c) => ({ date: c.date, close: c.close })), changePct: first && last ? Math.round((last / first - 1) * 1000) / 10 : undefined };
  }));

  server.registerTool("get_stock_warnings", {
    title: "거래소 유의사항",
    description: "거래소가 붙인 매수 유의사항(투자경고, 단기과열 등)",
    inputSchema: z.object({ symbol: z.string() }),
    annotations: readOnly,
  }, ({ symbol }) => run(async () => (await getEvidenceService().getStockWarnings(symbol.toUpperCase())).map((w) => ({ type: w.type, message: w.message, since: w.since, source: w.provenance.source }))));

  // ── today, policy, simulation ──
  server.registerTool("get_today", {
    title: "오늘의 변화",
    description: "오늘 내 자산에 영향을 준 주요 변화(가격, 환율, 투자 원칙, 유의사항)와 일일 손익. 규칙 기반으로 고른 항목이며 사실(facts)만 근거로 쓴다.",
    inputSchema: z.object({}),
    annotations: readOnly,
  }, () => run(async () => {
    const t = await withoutLlm(() => getToday(userId, todayModelHooks()));
    return { asOf: t.asOf, totalValueKRW: t.totalValueKRW, dailyPnLKRW: t.dailyPnLKRW, items: t.items.map((i) => ({ type: i.type, title: i.title, symbol: i.symbol, portfolioImpactKRW: i.portfolioImpactKRW, facts: i.facts, explanation: i.explanation })), limitations: t.limitations };
  }));

  server.registerTool("get_investment_policy", {
    title: "투자 원칙",
    description: "사용자가 정한 투자 원칙(목적, 기간, 최대 손실, 비중 한도, 선호)",
    inputSchema: z.object({}),
    annotations: readOnly,
  }, () => run(() => getPolicy(userId)));

  server.registerTool("check_investment_policy", {
    title: "투자 원칙 점검",
    description: "현재 포트폴리오가 투자 원칙을 지키는지 코드로 점검한 결과(ok/warning/violation)",
    inputSchema: z.object({}),
    annotations: readOnly,
  }, () => run(async () => {
    const [snap, policy] = await Promise.all([getPortfolioSnapshot(userId), getPolicy(userId)]);
    const { metrics } = await getMetrics(snap);
    return checkPolicy(metrics, metrics, policy);
  }));

  server.registerTool("simulate_trade", {
    title: "매매 시뮬레이션",
    description: "가상의 매수/매도를 현재 포트폴리오에 적용해 비중, 노출, 비용, 투자 원칙 위반 여부를 계산한다. 장부는 바뀌지 않는다.",
    inputSchema: z.object({ symbol: z.string(), action: z.enum(["buy", "sell"]), amountKRW: z.number().positive().optional(), quantity: z.number().positive().optional() }),
    annotations: readOnly,
  }, (input) => run(async () => simulationView(await runSimulation({ type: "trade", ...input, symbol: input.symbol.toUpperCase() }, { userId }))));

  server.registerTool("simulate_scenario", {
    title: "시나리오 시뮬레이션",
    description: "가정 시나리오(종목/섹터/환율/시장 ±X%)가 현재 포트폴리오에 주는 영향. 예측이 아니라 가정이다.",
    inputSchema: z.object({ shocks: z.array(ScenarioShock).min(1).max(5) }),
    annotations: readOnly,
  }, ({ shocks }) => run(async () => simulationView(await runSimulation({ type: "scenario", shocks }, { userId }))));

  // ── the ledger's only write ──
  server.registerTool("record_trade", {
    title: "거래 기록",
    description: "실제로 체결한 매수/매도를 장부에 기록한다. 먼저 confirm 없이 불러 before/after를 사용자에게 보여 주고, 사용자가 맞다고 한 뒤에만 confirm: true로 다시 불러 저장한다. accountId는 get_ledger에서 찾는다. 단가는 종목 통화(국내 KRW, 해외 USD) 기준.",
    inputSchema: z.object({
      accountId: z.string().uuid(),
      action: z.enum(["buy", "sell"]),
      symbol: z.string(),
      quantity: z.number().positive(),
      price: z.number().nonnegative().describe("체결 단가, 종목 통화"),
      fee: z.number().nonnegative().optional(),
      tradedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("체결일 YYYY-MM-DD, 생략하면 오늘"),
      confirm: z.boolean().default(false).describe("false: 미리보기만, true: 저장"),
    }),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  }, ({ confirm, tradedAt, ...t }) => run(async () => {
    const result = await recordTrade(userId, { ...t, symbol: t.symbol.toUpperCase(), tradedAt: tradedAt ?? today(), source: "chat" }, { dryRun: !confirm });
    return { saved: confirm, ...result, note: confirm ? "장부에 기록했습니다. 취소는 undo_trade." : "미리보기입니다. 사용자가 확인하면 confirm: true로 저장하세요." };
  }));

  server.registerTool("list_trades", {
    title: "거래 기록 목록",
    description: "최근 기록한 매수/매도 (취소된 것은 voidedAt이 있음)",
    inputSchema: z.object({ limit: z.number().int().min(1).max(100).default(30) }),
    annotations: readOnly,
  }, ({ limit }) => run(async () => (await listEntries(userId, limit)).map((e) => ({ entryId: e.id, account: e.account, action: e.kind, symbol: e.symbol, quantity: e.quantity, price: e.price, fee: e.fee, tradedAt: e.tradedAt, voidedAt: e.voidedAt }))));

  server.registerTool("undo_trade", {
    title: "거래 취소",
    description: "잘못 기록한 거래 한 건을 취소한다(entryId는 list_trades에서). 사용자가 명시적으로 요청한 경우에만.",
    inputSchema: z.object({ entryId: z.string().uuid() }),
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
  }, ({ entryId }) => run(async () => { await voidEntry(userId, entryId); return { ok: true }; }));

  return server;
}
