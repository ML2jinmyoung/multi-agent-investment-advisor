import type { EtfHoldings } from "@/domain/evidence";
import type { PortfolioSnapshot } from "@/domain/portfolio";
import type { Exposure, PortfolioMetrics } from "@/domain/simulation";
import { etfHoldingsProvider } from "@/providers/etf/issuer";
import { getSecurityMeta, securityMetaOrUnknown } from "@/providers/market/securities";

type Bucket = Record<string, number>;
const add = (m: Bucket, k: string, v: number) => (m[k] = (m[k] ?? 0) + v);

/**
 * Deterministic exposure calculation with ETF look-through.
 * Direct NVDA + QQQ x NVDA weight + VOO x NVDA weight = actual NVDA exposure.
 */
export function computeMetrics(snapshot: PortfolioSnapshot, etf: Map<string, EtfHoldings>): { metrics: PortfolioMetrics; warnings: string[] } {
  const total = snapshot.totals.marketValueKRW;
  const warnings: string[] = [];
  const exposures = new Map<string, Exposure>();
  const bySector: Bucket = {};
  const byCountry: Bucket = {};
  const byCurrency: Bucket = {};
  const byAssetClass: Bucket = {};
  const brokerage = new Set(snapshot.accounts.filter((a) => a.type === "brokerage").map((a) => a.id));
  let buyingPower = 0;

  const bump = (key: string, name: string, kind: Exposure["kind"], direct: number, indirect: number) => {
    const e = exposures.get(key) ?? { key, name, kind, directValueKRW: 0, indirectValueKRW: 0, totalValueKRW: 0, portfolioWeightPct: 0 };
    e.directValueKRW += direct;
    e.indirectValueKRW += indirect;
    e.totalValueKRW += direct + indirect;
    exposures.set(key, e);
  };

  for (const p of snapshot.positions) {
    const meta = securityMetaOrUnknown(p.symbol, { name: p.name, assetType: p.assetType, market: p.market, currency: p.currency });
    const v = p.marketValueKRW;
    add(byAssetClass, meta.assetClass, v);
    if (p.assetType === "cash" && brokerage.has(p.accountId)) buyingPower += v;

    if (p.assetType === "etf") {
      const h = etf.get(p.symbol);
      const residualKind: Exposure["kind"] = meta.assetClass === "bond" ? "bond" : "etf-residual";
      let covered = 0;
      for (const c of h?.holdings ?? []) {
        const cv = (v * c.weightPct) / 100;
        covered += c.weightPct;
        const cm = getSecurityMeta(c.symbol);
        const kind: Exposure["kind"] = cm ? (cm.assetType === "stock" ? "stock" : cm.assetClass === "bond" ? "bond" : "other") : "stock";
        bump(c.symbol, cm?.name ?? c.name, kind, 0, cv);
        if (meta.assetClass === "equity") add(bySector, cm?.sector ?? "미분류", cv);
        add(byCountry, cm?.exposureCountry ?? meta.exposureCountry, cv);
        add(byCurrency, cm?.exposureCurrency ?? meta.exposureCurrency, cv);
      }
      if (!h && (meta.assetClass === "equity" || snapshot.marketMode === "live")) {
        warnings.push(`${p.name}(${p.symbol}): 구성 종목 데이터를 확인하지 못해 ETF 내부 보유량은 look-through 계산에서 제외했습니다.`);
      }
      const residual = Math.max(0, 100 - covered);
      if (residual > 0.01) {
        const rv = (v * residual) / 100;
        bump(`${p.symbol}:residual`, `${p.name} (${h ? "기타 구성" : "구성 미확인"})`, residualKind, rv, 0);
        if (meta.assetClass === "equity") add(bySector, "ETF 미분류", rv);
        add(byCountry, meta.exposureCountry, rv);
        add(byCurrency, meta.exposureCurrency, rv);
      }
      continue;
    }

    const kind: Exposure["kind"] = p.assetType === "stock" ? "stock" : meta.assetClass === "bond" ? "bond" : meta.assetClass === "cash" ? "cash" : "other";
    bump(p.symbol, p.name, kind, v, 0);
    if (meta.assetClass === "equity") add(bySector, meta.sector ?? "미분류", v);
    add(byCountry, meta.exposureCountry, v);
    add(byCurrency, meta.exposureCurrency, v);
  }

  const pct = (v: number | undefined) => (total ? ((v ?? 0) / total) * 100 : 0);
  const pctMap = (m: Bucket) => Object.fromEntries(Object.entries(m).map(([k, v]) => [k, pct(v)]));
  const symbols = [...exposures.values()]
    .map((e) => ({ ...e, portfolioWeightPct: pct(e.totalValueKRW) }))
    .sort((a, b) => b.totalValueKRW - a.totalValueKRW);

  return {
    metrics: {
      totalValueKRW: total,
      buyingPowerKRW: buyingPower,
      cashPct: pct(byAssetClass.cash),
      overseasPct: 100 - pct(byCountry.KR),
      riskyAssetPct: pct(byAssetClass.equity),
      symbols,
      weights: { bySector: pctMap(bySector), byCountry: pctMap(byCountry), byCurrency: pctMap(byCurrency), byAssetClass: pctMap(byAssetClass) },
    },
    warnings,
  };
}

/** Fetches ETF constituents for every ETF in the snapshot (missing ones become warnings) and computes metrics. */
export async function getMetrics(snapshot: PortfolioSnapshot): Promise<{ metrics: PortfolioMetrics; warnings: string[]; etf: Map<string, EtfHoldings> }> {
  const provider = etfHoldingsProvider();
  const etf = new Map<string, EtfHoldings>();
  const symbols = [...new Set(snapshot.positions.filter((p) => p.assetType === "etf").map((p) => p.symbol))];
  await Promise.all(
    symbols.map(async (s) => {
      try {
        etf.set(s, await provider.getHoldings(s));
      } catch {
        /* reported by computeMetrics as a warning */
      }
    }),
  );
  return { ...computeMetrics(snapshot, etf), etf };
}
