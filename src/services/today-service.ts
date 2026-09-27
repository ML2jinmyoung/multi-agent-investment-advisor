import type { Filing, StockWarning } from "@/domain/evidence";
import type { FxRate } from "@/domain/portfolio";
import type { TodayItem, TodayResponse } from "@/domain/today";
import { getEvidenceService } from "./evidence-service";
import { getMetrics } from "./exposure-engine";
import { getPolicy } from "./policy-store";
import { getPortfolioSnapshot, marketDataProvider } from "./portfolio-aggregator";
import { buildCandidates, rank } from "./relevance-engine";

/** Optional model steps, injected so the deterministic pipeline works without any API key. */
export interface TodayModelHooks {
  /** returns 0..1 relevance per candidate id (Jev noul: "materially relevant to this investor today?") */
  relevance?: (candidates: TodayItem[]) => Promise<Record<string, number>>;
  /** rewrites explanations; must stay within `facts` */
  explain?: (items: TodayItem[]) => Promise<TodayItem[]>;
}

export async function getToday(userId = "demo", hooks: TodayModelHooks = {}, opts: { fresh?: boolean; topN?: number } = {}): Promise<TodayResponse> {
  const limitations: string[] = [];
  const [snapshot, policy] = await Promise.all([getPortfolioSnapshot(userId, opts), getPolicy(userId)]);
  if (snapshot.valuationComplete === false) return { asOf: snapshot.asOf, totalValueKRW: snapshot.totals.marketValueKRW, dailyPnLKRW: 0, items: [], marketMode: snapshot.marketMode, valuationComplete: false, limitations: [...snapshot.warnings, "시세·환율을 모두 확인한 후 자산 변화 분석을 제공합니다."] };
  const { metrics, warnings: exposureWarnings } = await getMetrics(snapshot);
  limitations.push(...snapshot.warnings, ...exposureWarnings);

  let fxRates: FxRate[] = [];
  try {
    fxRates = await marketDataProvider().getFxRates();
  } catch {
    limitations.push("환율 변동 정보를 확인하지 못했습니다.");
  }

  // external events for the largest direct stock holdings only (rate limits, relevance)
  const evidence = getEvidenceService();
  const topStocks = metrics.symbols.filter((s) => s.kind === "stock" && s.directValueKRW > 0).slice(0, 5);
  const filings: Filing[] = [];
  const stockWarnings: StockWarning[] = [];
  await Promise.all(
    topStocks.map(async (s) => {
      try {
        filings.push(...(await evidence.getRecentFilings(s.key, 3)));
      } catch {
        limitations.push(`${s.name} 공시 정보를 확인하지 못했습니다.`);
      }
      try {
        stockWarnings.push(...(await evidence.getStockWarnings(s.key)));
      } catch {
        /* warnings are optional evidence */
      }
    }),
  );

  const { candidates, dailyPnLKRW } = buildCandidates({ snapshot, metrics, policy, fxRates, filings, warnings: stockWarnings });
  if (hooks.relevance && candidates.length) {
    try {
      const scores = await hooks.relevance(candidates);
      for (const c of candidates) c.scores.modelRelevance = scores[c.id];
    } catch {
      limitations.push("관련성 판단 모델을 사용하지 못해 규칙 기반 점수만 사용했습니다.");
    }
  }
  let items = rank(candidates, opts.topN ?? 3);
  if (hooks.explain && items.length) {
    try {
      items = await hooks.explain(items);
    } catch {
      /* template explanations remain */
    }
  }

  const value: TodayResponse = { marketMode: snapshot.marketMode, valuationComplete: snapshot.valuationComplete, asOf: snapshot.asOf, totalValueKRW: metrics.totalValueKRW, dailyPnLKRW, items, limitations: [...new Set(limitations)] };
  return value;
}
