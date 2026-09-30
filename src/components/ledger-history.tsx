"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { tradingCurrency } from "@/domain/ledger";

export type TradeRow = { id: string; account: string; kind: string; symbol: string; quantity: number; price?: number; tradedAt: string; source: string; voidedAt?: string };

const SOURCE: Record<string, string> = { chat: "대화", manual: "직접", paste: "붙여넣기" };

/** Recent buy/sell entries with undo. Voided rows stay visible, struck through. */
export function LedgerHistory({ trades }: { trades: TradeRow[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState("");
  if (!trades.length) return null;
  async function undo(id: string) {
    setBusy(id);
    setError("");
    const res = await fetch(`/api/ledger/trades?id=${id}`, { method: "DELETE" });
    if (!res.ok) setError((await res.json()).error ?? "취소하지 못했습니다.");
    setBusy(undefined);
    router.refresh();
  }
  return (
    <details className="rounded-2xl bg-card p-4 shadow-sm ring-1 ring-border">
      <summary className="cursor-pointer font-medium">최근 거래 기록 {trades.filter((t) => !t.voidedAt).length}건</summary>
      <ul className="mt-2 divide-y text-sm">
        {trades.map((t) => (
          <li key={t.id} className={`flex items-center justify-between gap-2 py-2 ${t.voidedAt ? "text-muted-foreground line-through" : ""}`}>
            <div>
              <p>{t.kind === "buy" ? "매수" : "매도"} {t.symbol} {t.quantity.toLocaleString()}주{t.price !== undefined && ` @ ${new Intl.NumberFormat("ko-KR", { style: "currency", currency: tradingCurrency(t.symbol), maximumFractionDigits: 2 }).format(t.price)}`}</p>
              <p className="text-xs text-muted-foreground">{t.account} · {t.tradedAt} · {SOURCE[t.source] ?? t.source}</p>
            </div>
            {!t.voidedAt && <button type="button" className="shrink-0 text-xs underline" disabled={busy === t.id} onClick={() => void undo(t.id)}>되돌리기</button>}
          </li>
        ))}
      </ul>
      {error && <p className="text-sm text-red-600">{error}</p>}
    </details>
  );
}
