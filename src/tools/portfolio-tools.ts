import { tool } from "ai";
import { z } from "zod";
import { PolicyCheck } from "@/domain/policy";
import type { PortfolioSnapshot } from "@/domain/portfolio";
import { getMetrics } from "@/services/exposure-engine";
import { checkPolicy } from "@/services/policy-engine";
import { getPolicy } from "@/services/policy-store";
import { getPortfolioSnapshot } from "@/services/portfolio-aggregator";
import { r1, safeTool } from "./shared";

/** Minimal, LLM-safe view of the portfolio: no account identifiers, rounded numbers. */
const SnapshotView = z.object({
  asOf: z.string(),
  totalValueKRW: z.number(),
  buyingPowerKRW: z.number(),
  accounts: z.array(z.object({ name: z.string(), type: z.string(), status: z.enum(["LIVE", "DEMO", "MANUAL"]) })),
  positions: z.array(z.object({ symbol: z.string(), name: z.string(), account: z.string(), assetType: z.string(), marketValueKRW: z.number(), weightPct: z.number(), dailyChangePct: z.number().optional() })),
  byCurrencyPct: z.record(z.string(), z.number()),
  byCountryPct: z.record(z.string(), z.number()),
  bySectorPct: z.record(z.string(), z.number()),
  warnings: z.array(z.string()),
  sources: z.array(z.string()),
});

export async function snapshotView(userId = "demo", existing?: PortfolioSnapshot) {
  const snap = existing ?? await getPortfolioSnapshot(userId);
  if (snap.valuationComplete === false) throw new Error("시세·환율을 확인하지 못해 자산 분석을 보류했습니다.");
  const { metrics, warnings } = await getMetrics(snap);
  const byId = new Map(snap.accounts.map((a) => [a.id, a]));
  const total = snap.totals.marketValueKRW || 1;
  return SnapshotView.parse({
    asOf: snap.asOf,
    totalValueKRW: Math.round(snap.totals.marketValueKRW),
    buyingPowerKRW: Math.round(metrics.buyingPowerKRW),
    accounts: snap.accounts.map((a) => ({ name: a.name, type: a.type, status: a.channel === "manual" ? "MANUAL" : a.isLive ? "LIVE" : "DEMO" })),
    positions: snap.positions
      .sort((a, b) => b.marketValueKRW - a.marketValueKRW)
      .map((p) => ({ symbol: p.symbol, name: p.name, account: byId.get(p.accountId)?.name ?? "", assetType: p.assetType, marketValueKRW: Math.round(p.marketValueKRW), weightPct: r1((p.marketValueKRW / total) * 100), dailyChangePct: p.dailyChangePct })),
    byCurrencyPct: Object.fromEntries(Object.entries(metrics.weights.byCurrency).map(([k, v]) => [k, r1(v)])),
    byCountryPct: Object.fromEntries(Object.entries(metrics.weights.byCountry).map(([k, v]) => [k, r1(v)])),
    bySectorPct: Object.fromEntries(Object.entries(metrics.weights.bySector).map(([k, v]) => [k, r1(v)])),
    warnings: [...snap.warnings, ...warnings],
    sources: snap.sources.map((s) => `${s.source}${s.isMock ? " (DEMO)" : ""}`),
  });
}

const ExposureView = z.object({
  symbol: z.string(),
  name: z.string(),
  directValueKRW: z.number(),
  indirectValueKRW: z.number(),
  totalValueKRW: z.number(),
  portfolioWeightPct: z.number(),
  note: z.string().optional(),
});

export function portfolioToolsFor(userId = "demo") { return {
  getPortfolioSnapshot: tool({
    description: "연결된 모든 계좌(LIVE/DEMO)의 보유 자산, 비중, 통화/국가/섹터 비중, 투자 가능 금액. 숫자는 이 결과만 사용한다.",
    inputSchema: z.object({}),
    execute: () => safeTool(SnapshotView, "portfolio", () => snapshotView(userId)),
  }),
  getPosition: tool({
    description: "특정 종목의 계좌별 보유 내역",
    inputSchema: z.object({ symbol: z.string() }),
    execute: ({ symbol }) =>
      safeTool(z.array(z.object({ account: z.string(), quantity: z.number(), averagePrice: z.number().optional(), currentPrice: z.number().optional(), marketValueKRW: z.number(), currency: z.string() })), "portfolio", async () => {
        const snap = await getPortfolioSnapshot(userId);
        const byId = new Map(snap.accounts.map((a) => [a.id, a]));
        return snap.positions.filter((p) => p.symbol === symbol).map((p) => ({ account: byId.get(p.accountId)?.name ?? "", quantity: p.quantity, averagePrice: p.averagePrice, currentPrice: p.currentPrice, marketValueKRW: Math.round(p.marketValueKRW), currency: p.currency }));
      }),
  }),
  getExposure: tool({
    description: "ETF look-through를 포함한 종목별 실질 노출(직접 보유 + ETF 내부 보유). symbol을 생략하면 상위 10개.",
    inputSchema: z.object({ symbol: z.string().optional() }),
    execute: ({ symbol }) =>
      safeTool(z.object({ exposures: z.array(ExposureView), warnings: z.array(z.string()) }), "exposure", async () => {
        const { metrics, warnings } = await getMetrics(await getPortfolioSnapshot(userId));
        const list = (symbol ? metrics.symbols.filter((s) => s.key === symbol) : metrics.symbols.slice(0, 10)).map((s) => ({
          symbol: s.key,
          name: s.name,
          directValueKRW: Math.round(s.directValueKRW),
          indirectValueKRW: Math.round(s.indirectValueKRW),
          totalValueKRW: Math.round(s.totalValueKRW),
          portfolioWeightPct: r1(s.portfolioWeightPct),
          note: s.kind === "etf-residual" ? "구성 종목을 확인하지 못한 ETF 잔여분" : undefined,
        }));
        return { exposures: list, warnings };
      }),
  }),
  getBuyingPower: tool({
    description: "위탁계좌 기준 투자 가능 금액(KRW 환산)",
    inputSchema: z.object({}),
    execute: () => safeTool(z.object({ buyingPowerKRW: z.number() }), "portfolio", async () => ({ buyingPowerKRW: Math.round((await getMetrics(await getPortfolioSnapshot(userId))).metrics.buyingPowerKRW) })),
  }),
  getInvestmentPolicy: tool({
    description: "사용자가 정의한 투자 원칙(목적, 기간, 최대 손실, 비중 한도, 선호)",
    inputSchema: z.object({}),
    execute: () => safeTool(z.any(), "policy", () => getPolicy(userId)),
  }),
  checkInvestmentPolicy: tool({
    description: "현재 포트폴리오가 투자 원칙을 지키는지 코드로 점검한 결과(ok/warning/violation)",
    inputSchema: z.object({}),
    execute: () =>
      safeTool(z.array(PolicyCheck), "policy", async () => {
        const [snap, policy] = await Promise.all([getPortfolioSnapshot(userId), getPolicy(userId)]);
        const { metrics } = await getMetrics(snap);
        return checkPolicy(metrics, metrics, policy);
      }),
  }),
}; }

export const portfolioTools = portfolioToolsFor();
