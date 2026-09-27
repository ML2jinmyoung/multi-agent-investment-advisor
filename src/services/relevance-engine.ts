import type { Filing, StockWarning } from "@/domain/evidence";
import type { InvestmentPolicy } from "@/domain/policy";
import type { FxRate, PortfolioSnapshot, Provenance } from "@/domain/portfolio";
import type { PortfolioMetrics } from "@/domain/simulation";
import type { TodayItem } from "@/domain/today";
import { krw, signedPct } from "@/lib/format";
import { checkPolicy } from "./policy-engine";

export interface RelevanceInputs {
  snapshot: PortfolioSnapshot;
  metrics: PortfolioMetrics;
  policy: InvestmentPolicy;
  fxRates: FxRate[];
  filings: Filing[];
  warnings: StockWarning[];
}

const r1 = (n: number) => Math.round(n * 10) / 10;
const CURRENCY_LABEL: Record<string, string> = { USD: "USD/KRW" };

/**
 * Step 1-2 of Today-for-Me: candidate events + deterministic financial impact.
 * No model involved. Returns candidates with template explanations and scores (model score left empty).
 */
export function buildCandidates(input: RelevanceInputs): { candidates: TodayItem[]; dailyPnLKRW: number } {
  const { snapshot, metrics, policy } = input;
  const total = metrics.totalValueKRW || 1;
  const impactScore = (impactKRW: number) => Math.min(1, Math.abs(impactKRW) / (total * 0.01)); // 1% of portfolio -> 1.0
  const candidates: TodayItem[] = [];

  // per-symbol daily P&L from held instruments (direct) — ETF moves already embed their constituents
  const bySymbol = new Map<string, { name: string; value: number; pnl: number; changePct: number; sources: Provenance[] }>();
  for (const p of snapshot.positions) {
    if (p.assetType === "cash" || p.dailyChangePct === undefined) continue;
    const prev = p.marketValueKRW / (1 + p.dailyChangePct / 100);
    const e = bySymbol.get(p.symbol) ?? { name: p.name, value: 0, pnl: 0, changePct: p.dailyChangePct, sources: [] };
    e.value += p.marketValueKRW;
    e.pnl += p.marketValueKRW - prev;
    if (!e.sources.some((s) => s.source === p.provenance.source)) e.sources.push(p.provenance);
    if (p.marketProvenance && !e.sources.some((s) => s.source === p.marketProvenance!.source && s.isMock === p.marketProvenance!.isMock)) e.sources.push(p.marketProvenance);
    bySymbol.set(p.symbol, e);
  }
  const dailyPnLKRW = [...bySymbol.values()].reduce((s, e) => s + e.pnl, 0);
  const policyChecks = checkPolicy(metrics, metrics, policy);
  const proximity = new Map(policyChecks.filter((c) => c.subject && c.status !== "ok").map((c) => [c.subject!, c]));

  for (const [symbol, e] of bySymbol) {
    if (Math.abs(e.changePct) < 2 && Math.abs(e.pnl) < total * 0.002) continue;
    const exposure = metrics.symbols.find((s) => s.key === symbol);
    const exposurePct = exposure ? r1(exposure.portfolioWeightPct) : r1((e.value / total) * 100);
    const contribution = dailyPnLKRW !== 0 && Math.sign(e.pnl) === Math.sign(dailyPnLKRW) ? Math.round((e.pnl / dailyPnLKRW) * 100) : undefined;
    const facts = [
      `${e.name} 이전 거래일 종가 대비 ${signedPct(e.changePct)}`,
      exposure && exposure.indirectValueKRW > 0
        ? `직접 보유와 ETF 내부 노출을 합하면 연결 자산의 ${exposurePct}%가 ${e.name}에 노출`
        : `연결 자산의 ${exposurePct}%를 ${e.name}이(가) 차지`,
      `직접 보유분의 가격 변동 영향 (현재 환율 기준) ${krw(Math.round(e.pnl))}`,
    ];
    if (contribution !== undefined) facts.push(`확인된 가격 변동 ${dailyPnLKRW < 0 ? "손실" : "이익"}의 약 ${contribution}%`);
    const check = proximity.get(symbol);
    if (check) facts.push(`투자 원칙: ${check.label} ${check.after}% / 한도 ${check.limit}% (${check.status === "violation" ? "위반" : "근접"})`);
    candidates.push({
      id: `price:${symbol}`,
      type: "price_move",
      title: `${e.name} ${signedPct(e.changePct)}`,
      symbol,
      portfolioImpactKRW: Math.round(e.pnl),
      exposurePct,
      importance: 0,
      scores: { financialImpact: Math.min(1, impactScore(e.pnl) * 0.7 + Math.min(1, Math.abs(e.changePct) / 10) * 0.3), policyRelevance: check ? (check.status === "violation" ? 1 : 0.5) : 0 },
      facts,
      explanation: facts.slice(1).join(". ") + ".",
      explanationBy: "template",
      sources: e.sources,
    });
  }

  for (const fx of input.fxRates) {
    if (fx.changePct === undefined || Math.abs(fx.changePct) < 0.5) continue;
    const exposurePct = r1(metrics.weights.byCurrency[fx.currency] ?? 0);
    const value = (exposurePct / 100) * total;
    const impact = value - value / (1 + fx.changePct / 100);
    const facts = [
      `${CURRENCY_LABEL[fx.currency] ?? fx.currency} 24시간 전 대비 ${signedPct(fx.changePct)}`,
      `연결 자산 중 ${fx.currency} 노출 약 ${exposurePct}% (KR 상장 해외 ETF 포함)`,
      `환율 변화만으로 원화 환산 평가액에 ${krw(Math.round(impact))} 영향`,
    ];
    candidates.push({
      id: `fx:${fx.currency}`,
      type: "fx_move",
      title: `${CURRENCY_LABEL[fx.currency] ?? fx.currency} ${signedPct(fx.changePct)}`,
      portfolioImpactKRW: Math.round(impact),
      exposurePct,
      importance: 0,
      scores: { financialImpact: impactScore(impact), policyRelevance: policy.preferences.fxRisk === "low" ? 0.6 : 0.2 },
      facts,
      explanation: `${facts[1]}. ${fx.changePct < 0 ? "원화 강세" : "원화 약세"}로 ${facts[2]}.`,
      explanationBy: "template",
      sources: [fx.provenance],
    });
  }

  for (const c of policyChecks) {
    if (c.status === "ok" || c.after === undefined) continue;
    const label = `${c.label}${c.subject ? ` · ${c.subject}` : ""}`;
    const facts = [`${label}: 현재 ${c.after}% / 한도 ${c.limit}%`, c.status === "violation" ? "투자 원칙 위반 상태" : "한도의 90% 이내로 근접"];
    candidates.push({
      id: `policy:${c.rule}:${c.subject ?? ""}`,
      type: "policy",
      title: `${c.status === "violation" ? "원칙 위반" : "원칙 근접"} · ${label}`,
      symbol: c.subject,
      portfolioImpactKRW: 0,
      exposurePct: c.after,
      importance: 0,
      scores: { financialImpact: 0, policyRelevance: c.status === "violation" ? 1 : 0.6 },
      facts,
      explanation: facts.join(". ") + ".",
      explanationBy: "template",
      sources: [],
    });
  }

  for (const w of input.warnings) {
    const exposure = metrics.symbols.find((s) => s.key === w.symbol);
    if (!exposure) continue;
    const facts = [`${exposure.name}: ${w.type} (${w.message})`, `연결 자산의 ${r1(exposure.portfolioWeightPct)}% 노출`];
    candidates.push({
      id: `warning:${w.symbol}:${w.type}`,
      type: "warning",
      title: `${exposure.name} ${w.type}`,
      symbol: w.symbol,
      portfolioImpactKRW: 0,
      exposurePct: r1(exposure.portfolioWeightPct),
      importance: 0,
      scores: { financialImpact: Math.min(1, exposure.portfolioWeightPct / 10), policyRelevance: 0.4 },
      facts,
      explanation: facts.join(". ") + ".",
      explanationBy: "template",
      sources: [w.provenance],
    });
  }

  for (const f of input.filings) {
    const exposure = f.symbol ? metrics.symbols.find((s) => s.key === f.symbol) : undefined;
    if (!exposure) continue;
    const facts = [`${exposure.name} 신규 공시: ${f.title} (${f.type}, ${f.filedAt.slice(0, 10)})`, `현재 ${exposure.name}은(는) 연결 자산의 ${r1(exposure.portfolioWeightPct)}%`];
    candidates.push({
      id: `filing:${f.id}`,
      type: "filing",
      title: `${exposure.name} 신규 공시`,
      symbol: f.symbol,
      portfolioImpactKRW: 0,
      exposurePct: r1(exposure.portfolioWeightPct),
      importance: 0,
      scores: { financialImpact: Math.min(1, exposure.portfolioWeightPct / 10) * 0.5, policyRelevance: 0.2 },
      facts,
      explanation: facts.reverse().join(". ") + ".",
      explanationBy: "template",
      sources: [f.provenance],
    });
  }

  return { candidates, dailyPnLKRW: Math.round(dailyPnLKRW) };
}

/** importance = financial impact + policy relevance (+ model relevance when available). Deterministic given the scores. */
export function rank(candidates: TodayItem[], topN = 3): TodayItem[] {
  return candidates
    .map((c) => {
      const m = c.scores.modelRelevance;
      const importance = m === undefined ? 0.6 * c.scores.financialImpact + 0.4 * c.scores.policyRelevance : 0.5 * c.scores.financialImpact + 0.3 * c.scores.policyRelevance + 0.2 * m;
      return { ...c, importance: Math.round(importance * 100) / 100 };
    })
    .sort((a, b) => b.importance - a.importance)
    .slice(0, topN);
}
