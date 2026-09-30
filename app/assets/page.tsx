import { LedgerEditor } from "@/components/ledger-editor";
import { LedgerHistory } from "@/components/ledger-history";
import { OwnerLogin } from "@/components/owner-login";
import { OWNER_USER_ID, ownerEnabled } from "@/lib/owner-auth";
import { MarketRefresh } from "@/components/market-refresh";
import { getPortfolioInput } from "@/services/portfolio-input-store";
import { getLedger, listEntries } from "@/services/ledger-store";
import { SourceBadge } from "@/components/source-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { krw, pct, signedPct } from "@/lib/format";
import { getPortfolioSnapshot } from "@/services/portfolio-aggregator";
import { currentUserId } from "@/lib/user-session";

export const dynamic = "force-dynamic";

export default async function AssetsPage() {
  const userId = await currentUserId();
  const [snap, input, ledger, trades] = await Promise.all([getPortfolioSnapshot(userId), getPortfolioInput(userId), getLedger(userId), listEntries(userId)]);
  // an earlier single-list input opens in the editor as one account, and moves into the ledger on first save
  const initial = ledger.length
    ? ledger.map((a) => ({ ...a, holdings: a.holdings.map(({ symbol, quantity, averagePrice }) => ({ symbol, quantity, averagePrice })) }))
    : input ? [{ broker: "기존 입력", name: "", type: "brokerage" as const, cashKRW: input.cashKRW, cashUSD: input.cashUSD, holdings: input.holdings }] : [];
  const total = snap.totals.marketValueKRW;

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">자산</h1>
      <section aria-label="총 평가액" className="rounded-3xl bg-primary p-5 text-primary-foreground shadow-lg shadow-primary/20">
        <p className="text-sm text-primary-foreground/75">{snap.valuationComplete === false ? "확인된 평가액" : "총 평가액"}</p>
        <p className="text-3xl font-semibold tracking-tight tabular-nums">{krw(total)}</p>
        <p className="mt-1 text-xs text-primary-foreground/75">
          {snap.accounts.length}개 계좌 · {new Date(snap.asOf).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })} 기준
        </p>
        <ul className="mt-4 flex flex-wrap gap-1.5 text-xs tabular-nums">
          <li className="rounded-full bg-white/12 px-2.5 py-1">{snap.marketMode === "live" ? "실제 시세" : "예시 시세"}</li>
          <li className="rounded-full bg-white/12 px-2.5 py-1">{ledger.length ? "증권사별 장부" : input ? "직접 입력 자산" : "데모 자산"}</li>
          <li className="rounded-full bg-white/12 px-2.5 py-1">USD/KRW {snap.fxRates.USD ? snap.fxRates.USD.toLocaleString("ko-KR", { maximumFractionDigits: 2 }) : "조회 대기"}</li>
        </ul>
      </section>
      <MarketRefresh />
      {ownerEnabled() && <OwnerLogin owner={userId === OWNER_USER_ID} />}
      <LedgerEditor key={JSON.stringify(initial)} initial={initial} custom={ledger.length > 0 || !!input} />
      <LedgerHistory trades={trades} />
      {snap.accounts.map((acct) => {
        const positions = snap.positions
          .filter((p) => p.accountId === acct.id)
          .sort((a, b) => b.marketValueKRW - a.marketValueKRW);
        const acctTotal = positions.reduce((s, p) => s + p.marketValueKRW, 0);
        return (
          <Card key={acct.id} className="rounded-2xl shadow-sm">
            <CardHeader>
              <CardTitle className="flex items-center justify-between text-base">
                <span>{acct.name}</span>
                <SourceBadge account={acct} />
              </CardTitle>
              <p className="text-sm text-muted-foreground tabular-nums">
                {krw(acctTotal)} · {snap.valuationComplete === false ? "일부 평가 누락" : `전체의 ${pct(total ? (acctTotal / total) * 100 : 0)}`}
              </p>
            </CardHeader>
            <CardContent>
              <ul className="divide-y">
                {positions.map((p) => (
                  <li key={p.symbol} className="flex items-center justify-between py-2 text-sm">
                    <div>
                      <p className="font-medium">{p.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {p.symbol}
                        {p.assetType !== "cash" && ` · ${p.quantity.toLocaleString()}주`}
                      </p>
                      {p.averagePrice !== undefined && p.assetType !== "cash" && (
                        <p className="text-xs text-muted-foreground tabular-nums">
                          평단 {new Intl.NumberFormat("ko-KR", { style: "currency", currency: p.currency, maximumFractionDigits: 2 }).format(p.averagePrice)}
                          {p.averagePrice > 0 && p.currentPrice !== undefined && (
                            <span className={cn("ml-1", p.currentPrice < p.averagePrice ? "text-down" : p.currentPrice > p.averagePrice ? "text-up" : "")}>
                              {signedPct(((p.currentPrice - p.averagePrice) / p.averagePrice) * 100)}
                            </span>
                          )}
                        </p>
                      )}
                    </div>
                    <div className="text-right tabular-nums">
                      {p.currentPrice !== undefined && ["stock", "etf", "bond", "fund"].includes(p.assetType) && <p className="text-xs text-muted-foreground">시세 {new Intl.NumberFormat("ko-KR", { style: "currency", currency: p.currency, maximumFractionDigits: 2 }).format(p.currentPrice)}</p>}
                      <p>{p.valuationAvailable === false ? "시세·환율 확인 필요" : krw(p.marketValueKRW)}</p>
                      <p className="text-xs text-muted-foreground">
                        {snap.valuationComplete === false ? "비중 확인 필요" : pct(total ? (p.marketValueKRW / total) * 100 : 0)}
                        {p.dailyChangePct !== undefined && p.assetType !== "cash" && (
                          <span className={cn("ml-1", p.dailyChangePct < 0 ? "text-down" : p.dailyChangePct > 0 ? "text-up" : "")}>
                            {signedPct(p.dailyChangePct)}
                          </span>
                        )}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        );
      })}

      {snap.warnings.length > 0 && (
        <details className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          <summary className="cursor-pointer font-medium">데이터 안내 {snap.warnings.length}건</summary>
          <ul className="mt-1 list-disc pl-4">
            {snap.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </details>
      )}

      <details className="text-xs text-muted-foreground">
        <summary className="cursor-pointer font-medium">데이터 출처</summary>
        <ul className="mt-1">
          {snap.sources.map((s) => (
            <li key={`${s.source}:${s.asOf}:${s.isMock}`}>
              {s.source}
              {s.isMock ? " (DEMO)" : ""}
              {s.asOf ? ` · 기준 ${new Date(s.asOf).toLocaleString("ko-KR")}` : ""}
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}
