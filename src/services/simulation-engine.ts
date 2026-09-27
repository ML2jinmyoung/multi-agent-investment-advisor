import type { EtfHoldings } from "@/domain/evidence";
import type { InvestmentPolicy } from "@/domain/policy";
import type { PortfolioSnapshot, Position, Quote } from "@/domain/portfolio";
import type { MetricChange, PortfolioMetrics, ScenarioShock, ScenarioSimulationRequest, SimulationRequest, SimulationResult, TradeSimulationRequest } from "@/domain/simulation";
import { getSecurityMeta, securityMetaOrUnknown } from "@/providers/market/securities";
import { computeMetrics, getMetrics } from "./exposure-engine";
import { tradeCost } from "./fees";
import { checkPolicy } from "./policy-engine";
import { getPolicy } from "./policy-store";
import { computeTotals, getCommissionRates, getPortfolioSnapshot, marketDataProvider } from "./portfolio-aggregator";

export class SimulationError extends Error {}

export interface SimulationInputs {
  snapshot: PortfolioSnapshot;
  policy: InvestmentPolicy;
  etf: Map<string, EtfHoldings>;
  /** quote for a symbol that is not currently held (trade only) */
  quote?: Quote;
  commissionRates?: Record<string, number>;
  warnings?: string[];
}

const COUNTRY_LABEL: Record<string, string> = { KR: "국내 자산", US: "미국 자산" };

/** Fully deterministic. Never calls a model. */
export function simulate(req: SimulationRequest, inputs: SimulationInputs): SimulationResult {
  return req.type === "trade" ? simulateTrade(req, inputs) : simulateScenario(req, inputs);
}

function withPositions(snapshot: PortfolioSnapshot, positions: Position[]): PortfolioSnapshot {
  return { ...snapshot, positions, totals: computeTotals(snapshot.accounts, positions) };
}

function weightOf(m: PortfolioMetrics, key: string) {
  return m.symbols.find((s) => s.key === key)?.portfolioWeightPct ?? 0;
}

function change(key: string, label: string, before: number, after: number, unit: MetricChange["unit"] = "pct"): MetricChange {
  const r = unit === "pct" ? (n: number) => Math.round(n * 10) / 10 : Math.round;
  return { key, label, before: r(before), after: r(after), unit };
}

function exposureChanges(before: PortfolioMetrics, after: PortfolioMetrics, meta: ReturnType<typeof securityMetaOrUnknown>, symbolLabel: string): MetricChange[] {
  const out = [change(`symbol:${meta.symbol}`, `${symbolLabel} 실질 비중`, weightOf(before, meta.symbol), weightOf(after, meta.symbol))];
  if (meta.sector && meta.assetClass === "equity") out.push(change(`sector:${meta.sector}`, `${meta.sector} 비중`, before.weights.bySector[meta.sector] ?? 0, after.weights.bySector[meta.sector] ?? 0));
  out.push(change(`country:${meta.exposureCountry}`, `${COUNTRY_LABEL[meta.exposureCountry] ?? meta.exposureCountry + " 자산"} 비중`, before.weights.byCountry[meta.exposureCountry] ?? 0, after.weights.byCountry[meta.exposureCountry] ?? 0));
  if (meta.exposureCurrency !== "KRW") out.push(change(`currency:${meta.exposureCurrency}`, `${meta.exposureCurrency} 노출`, before.weights.byCurrency[meta.exposureCurrency] ?? 0, after.weights.byCurrency[meta.exposureCurrency] ?? 0));
  return out;
}

export function simulateTrade(req: TradeSimulationRequest, inputs: SimulationInputs): SimulationResult {
  const { snapshot, policy, etf } = inputs;
  const before = computeMetrics(snapshot, etf);
  const warnings = [...before.warnings, ...(inputs.warnings ?? [])];
  const held = snapshot.positions.filter((p) => p.symbol === req.symbol && p.assetType !== "cash");
  if (req.action === "sell" && !held.length) throw new SimulationError(`${req.symbol}은(는) 보유하고 있지 않아 매도 시뮬레이션을 할 수 없습니다.`);
  const meta = securityMetaOrUnknown(req.symbol, held[0] ? { name: held[0].name, assetType: held[0].assetType, market: held[0].market, currency: held[0].currency } : { name: inputs.quote?.name, assetType: inputs.quote?.assetType, market: inputs.quote?.market, currency: inputs.quote?.currency });
  const currency = held[0]?.currency ?? inputs.quote?.currency ?? meta.currency;
  const price = held[0]?.currentPrice ?? inputs.quote?.price;
  if (price === undefined) throw new SimulationError(`${req.symbol}의 시세를 확인하지 못해 시뮬레이션할 수 없습니다.`);
  const fx = currency === "KRW" ? 1 : snapshot.fxRates[currency];
  if (fx === undefined) throw new SimulationError(`${currency} 환율 정보가 없어 시뮬레이션할 수 없습니다.`);
  const priceKRW = price * fx;

  const accounts = snapshot.accounts.filter((a) => a.type === "brokerage");
  const cashKRW = (accountId: string, cur: string) => snapshot.positions.find((p) => p.accountId === accountId && p.assetType === "cash" && p.symbol === cur)?.marketValueKRW ?? 0;

  let positions = snapshot.positions.map((p) => ({ ...p }));
  const adjustCash = (accountId: string, cur: string, deltaKRW: number) => {
    const rate = cur === "KRW" ? 1 : (snapshot.fxRates[cur] ?? 1);
    let cash = positions.find((p) => p.accountId === accountId && p.assetType === "cash" && p.symbol === cur);
    if (!cash) {
      cash = { ...securityMetaOrUnknown(cur, { assetType: "cash", currency: cur }), accountId, symbol: cur, quantity: 0, currentPrice: 1, marketValueKRW: 0, provenance: { source: "simulation", retrievedAt: new Date().toISOString(), isMock: true } };
      positions.push(cash);
    }
    cash.marketValueKRW += deltaKRW;
    cash.quantity += deltaKRW / rate;
  };

  let cost;
  let quantity: number;
  if (req.action === "buy") {
    const accountId = req.accountId ?? accounts.map((a) => a.id).sort((a, b) => cashKRW(b, "KRW") + cashKRW(b, currency) - cashKRW(a, "KRW") - cashKRW(a, currency))[0];
    if (!accountId) throw new SimulationError("매수 가능한 위탁계좌가 없습니다.");
    quantity = req.quantity ?? req.amountKRW! / priceKRW;
    const grossKRW = quantity * priceKRW;
    const foreignCash = currency === "KRW" ? 0 : cashKRW(accountId, currency);
    const fromForeign = Math.min(foreignCash, grossKRW);
    const fromKRW = grossKRW - fromForeign;
    const buyRate = snapshot.fxBuyRates?.[currency];
    const fxSpreadRate = currency === "KRW" ? 0 : buyRate === undefined ? undefined : Math.max(0, (buyRate / fx) - 1);
    cost = tradeCost({ market: meta.market, assetType: meta.assetType, action: "buy", grossKRW, fxAmountKRW: fromKRW * (currency === "KRW" ? 0 : 1), commissionRate: inputs.commissionRates?.[meta.market], fxSpreadRate });
    const needKRW = fromKRW + cost.totalKRW;
    const availableKRW = cashKRW(accountId, "KRW");
    if (needKRW > availableKRW + 1) {
      throw new SimulationError(`투자 가능 금액(${Math.round(availableKRW).toLocaleString("ko-KR")}원)이 ${Math.round(needKRW - availableKRW).toLocaleString("ko-KR")}원 부족합니다.`);
    }
    if (fromForeign) adjustCash(accountId, currency, -fromForeign);
    adjustCash(accountId, "KRW", -needKRW);
    const existing = positions.find((p) => p.accountId === accountId && p.symbol === req.symbol && p.assetType !== "cash");
    if (existing) {
      existing.averagePrice = existing.averagePrice !== undefined ? (existing.averagePrice * existing.quantity + price * quantity) / (existing.quantity + quantity) : undefined;
      existing.quantity += quantity;
      existing.marketValueKRW += grossKRW;
    } else {
      positions.push({ accountId, symbol: req.symbol, name: meta.name, assetType: meta.assetType, market: meta.market, currency, quantity, averagePrice: price, currentPrice: price, marketValueKRW: grossKRW, provenance: inputs.quote?.provenance ?? { source: "simulation", retrievedAt: new Date().toISOString(), isMock: true } });
    }
  } else {
    const target = req.accountId ? held.find((p) => p.accountId === req.accountId) : [...held].sort((a, b) => b.quantity - a.quantity)[0];
    if (!target) throw new SimulationError("해당 계좌에 보유 수량이 없습니다.");
    quantity = req.quantity ?? req.amountKRW! / priceKRW;
    if (quantity > target.quantity + 1e-9) {
      warnings.push(`보유 수량(${target.quantity})을 초과하여 보유 수량 전량 매도로 계산했습니다.`);
      quantity = target.quantity;
    }
    const grossKRW = quantity * priceKRW;
    cost = tradeCost({ market: meta.market, assetType: meta.assetType, action: "sell", grossKRW, fxAmountKRW: 0, commissionRate: inputs.commissionRates?.[meta.market] });
    const pos = positions.find((p) => p.accountId === target.accountId && p.symbol === req.symbol && p.assetType !== "cash")!;
    pos.quantity -= quantity;
    pos.marketValueKRW -= grossKRW;
    if (pos.quantity <= 1e-9) positions = positions.filter((p) => p !== pos);
    adjustCash(target.accountId, currency, grossKRW - cost.totalKRW); // proceeds stay in the trade currency
  }

  const afterSnap = withPositions(snapshot, positions);
  const after = computeMetrics(afterSnap, etf);
  const label = `${meta.name}(${req.symbol})`;
  const changes = [
    ...exposureChanges(before.metrics, after.metrics, meta, label),
    change("buyingPower", "투자 가능 금액", before.metrics.buyingPowerKRW, after.metrics.buyingPowerKRW, "krw"),
    change("cashPct", "유동성 비중", before.metrics.cashPct, after.metrics.cashPct),
  ];

  return {
    request: req,
    before: before.metrics,
    after: after.metrics,
    changes,
    cost,
    policyChecks: checkPolicy(before.metrics, after.metrics, policy, { isTrade: true }),
    warnings: [...new Set(warnings)],
    computedAt: new Date().toISOString(),
    kind: "simulation",
  };
}

/** multiplicative factor a shock applies to one position's KRW value */
function shockFactor(p: Position, shock: ScenarioShock, etf: Map<string, EtfHoldings>): number {
  const s = shock.changePct / 100;
  const meta = securityMetaOrUnknown(p.symbol, { assetType: p.assetType, market: p.market, currency: p.currency });
  const holdings = p.assetType === "etf" ? etf.get(p.symbol)?.holdings : undefined;
  const target = shock.target.toUpperCase();
  switch (shock.kind) {
    case "symbol":
      if (p.symbol.toUpperCase() === target) return s;
      return holdings ? s * ((holdings.find((h) => h.symbol.toUpperCase() === target)?.weightPct ?? 0) / 100) : 0;
    case "sector": {
      const inSector = (sym: string, fallback?: string) => (getSecurityMeta(sym)?.sector ?? fallback ?? "").toUpperCase() === target;
      if (p.assetType === "stock") return inSector(p.symbol, meta.sector) ? s : 0;
      return holdings ? s * (holdings.filter((h) => inSector(h.symbol)).reduce((w, h) => w + h.weightPct, 0) / 100) : 0;
    }
    case "fx":
      return meta.exposureCurrency.toUpperCase() === target ? s : 0;
    case "market":
      if (meta.assetClass !== "equity") return 0;
      return target === "ALL" || meta.exposureCountry.toUpperCase() === target ? s : 0;
  }
}

export function simulateScenario(req: ScenarioSimulationRequest, inputs: SimulationInputs): SimulationResult {
  const { snapshot, policy, etf } = inputs;
  const before = computeMetrics(snapshot, etf);
  const positions = snapshot.positions.map((p) => ({
    ...p,
    marketValueKRW: p.marketValueKRW * req.shocks.reduce((f, shock) => f * (1 + shockFactor(p, shock, etf)), 1),
  }));
  const afterSnap = withPositions(snapshot, positions);
  const after = computeMetrics(afterSnap, etf);
  const impactKRW = after.metrics.totalValueKRW - before.metrics.totalValueKRW;
  const lossPct = before.metrics.totalValueKRW ? (-impactKRW / before.metrics.totalValueKRW) * 100 : 0;

  const changes: MetricChange[] = [change("totalValue", "총 평가액", before.metrics.totalValueKRW, after.metrics.totalValueKRW, "krw")];
  for (const shock of req.shocks) {
    const t = shock.target;
    if (shock.kind === "symbol") changes.push(change(`symbol:${t}`, `${securityMetaOrUnknown(t).name} 실질 비중`, weightOf(before.metrics, t), weightOf(after.metrics, t)));
    if (shock.kind === "sector") changes.push(change(`sector:${t}`, `${t} 비중`, before.metrics.weights.bySector[t] ?? 0, after.metrics.weights.bySector[t] ?? 0));
    if (shock.kind === "fx") changes.push(change(`currency:${t}`, `${t} 노출`, before.metrics.weights.byCurrency[t] ?? 0, after.metrics.weights.byCurrency[t] ?? 0));
    if (shock.kind === "market" && t !== "ALL") changes.push(change(`country:${t}`, `${COUNTRY_LABEL[t] ?? t} 비중`, before.metrics.weights.byCountry[t] ?? 0, after.metrics.weights.byCountry[t] ?? 0));
  }

  return {
    request: req,
    before: before.metrics,
    after: after.metrics,
    changes,
    impactKRW: Math.round(impactKRW),
    policyChecks: checkPolicy(before.metrics, after.metrics, policy, { scenarioLossPct: lossPct > 0 ? lossPct : undefined }),
    warnings: before.warnings,
    computedAt: new Date().toISOString(),
    kind: "simulation",
  };
}

/** Loads live inputs (snapshot, policy, ETF constituents, quote for unheld symbols) and runs the deterministic engine. */
export async function runSimulation(
  req: SimulationRequest,
  context: { userId?: string; snapshot?: PortfolioSnapshot; policy?: InvestmentPolicy; etf?: Map<string, EtfHoldings> } = {},
): Promise<SimulationResult> {
  const userId = context.userId ?? "demo";
  const snapshot = context.snapshot ?? await getPortfolioSnapshot(userId);
  if (snapshot.valuationComplete === false) throw new Error("시세·환율을 확인하지 못해 매매 시뮬레이션을 계산할 수 없습니다.");
  const policy = context.policy ?? await getPolicy(userId);
  const etf = context.etf ?? (await getMetrics(snapshot)).etf;
  let quote: Quote | undefined;
  if (req.type === "trade" && !snapshot.positions.some((p) => p.symbol === req.symbol && p.assetType !== "cash")) {
    try {
      quote = await marketDataProvider().getQuote(req.symbol);
    } catch {
      throw new SimulationError(`${req.symbol}의 시세를 확인하지 못해 시뮬레이션할 수 없습니다.`);
    }
  }
  let commissionRates: Record<string, number> | undefined;
  const warnings: string[] = [];
  if (snapshot.marketMode === "live") warnings.push("수수료·세금은 데모의 기본 가정입니다. 실제 계좌별 체결 비용을 조회하지 않습니다.");
  if (req.type === "trade") {
    const held = snapshot.positions.filter((p) => p.symbol === req.symbol && p.assetType !== "cash");
    const accounts = snapshot.accounts.filter((a) => a.type === "brokerage");
    const cash = (id: string) => snapshot.positions.filter((p) => p.accountId === id && p.assetType === "cash").reduce((sum, p) => sum + p.marketValueKRW, 0);
    const accountId = req.accountId ?? (req.action === "sell" ? held.sort((a, b) => b.quantity - a.quantity)[0]?.accountId : accounts.sort((a, b) => cash(b.id) - cash(a.id))[0]?.id);
    if (snapshot.marketMode !== "live" && accountId?.startsWith("toss-")) {
      try {
        commissionRates = await getCommissionRates(accountId);
      } catch {
        warnings.push("계좌 수수료 조회에 실패해 기본 수수료율을 사용했습니다.");
      }
    }
  }
  return simulate(req, { snapshot, policy, etf, quote, commissionRates, warnings });
}
