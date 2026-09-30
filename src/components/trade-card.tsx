"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { tradingCurrency } from "@/domain/ledger";
import type { TradeDraft } from "@/domain/ledger-parse";

type Holding = { quantity: number; averagePrice?: number; realizedPnl: number };
type Result = { entryId?: string; before: Holding; after: Holding; realized: number };

const money = (n: number | undefined, currency: string) =>
  n === undefined ? "미입력" : new Intl.NumberFormat("ko-KR", { style: "currency", currency, maximumFractionDigits: currency === "KRW" ? 0 : 2 }).format(n);

async function post(body: unknown, method = "POST", query = ""): Promise<Result> {
  const res = await fetch(`/api/ledger/trades${query}`, { method, headers: { "Content-Type": "application/json" }, body: method === "POST" ? JSON.stringify(body) : undefined });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "요청에 실패했습니다.");
  return data;
}

/** Confirmation for a trade the user reported in chat. The ledger changes only on "장부에 반영"; "되돌리기" voids it. */
export function TradeCard({ draft, accounts }: { draft: TradeDraft; accounts: { id: string; label: string }[] }) {
  const [form, setForm] = useState({ accountId: draft.accountId ?? "", action: draft.action, symbol: draft.symbol ?? "", quantity: draft.quantity ?? 0, price: draft.price, tradedAt: draft.tradedAt });
  const [preview, setPreview] = useState<Result | null>(null);
  const [saved, setSaved] = useState<Result | null>(null);
  const [state, setState] = useState<"edit" | "busy" | "saved" | "undone" | "dismissed">("edit");
  const [error, setError] = useState("");
  const symbol = form.symbol.trim().toUpperCase();
  const currency = symbol ? tradingCurrency(symbol) : draft.currency;
  const trade = { accountId: form.accountId, action: form.action, symbol, quantity: form.quantity, price: form.price, tradedAt: form.tradedAt, source: "chat" as const };
  const complete = !!(form.accountId && symbol && form.quantity > 0 && form.price !== undefined && form.price >= 0);

  useEffect(() => {
    if (!complete || state !== "edit") return;
    const t = setTimeout(() => {
      post({ trade, dryRun: true }).then((r) => { setPreview(r); setError(""); }, (e: Error) => { setPreview(null); setError(e.message); });
    }, 300);
    return () => clearTimeout(t);
    // trade is derived from form; re-run only when the form changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(form), complete, state]);

  if (!accounts.length) {
    return (
      <div className="rounded-2xl border p-4 text-sm">
        거래를 기록하려면 먼저 <Link href="/assets" className="underline">자산 화면</Link>에서 증권사 계좌와 보유 종목을 등록해 주세요.
      </div>
    );
  }
  if (state === "dismissed") return <p className="text-sm text-muted-foreground">장부에 반영하지 않았어요.</p>;

  async function confirm() {
    setState("busy");
    setError("");
    try {
      setSaved(await post({ trade }));
      setState("saved");
    } catch (e) {
      setError((e as Error).message);
      setState("edit");
    }
  }
  async function undo() {
    if (!saved?.entryId) return;
    setState("busy");
    try {
      await post(null, "DELETE", `?id=${saved.entryId}`);
      setState("undone");
    } catch (e) {
      setError((e as Error).message);
      setState("saved");
    }
  }

  const field = "min-w-0 w-full rounded border bg-background p-2 text-sm";
  const label = accounts.find((a) => a.id === form.accountId)?.label;
  const change = (r: Result) =>
    `${symbol} ${r.before.quantity.toLocaleString()}주 → ${r.after.quantity.toLocaleString()}주 · 평단 ${money(r.before.averagePrice, currency)} → ${money(r.after.averagePrice, currency)}${form.action === "sell" && r.realized ? ` · 실현손익 ${money(r.realized, currency)}` : ""}`;

  if (state === "saved" || state === "undone" || (state === "busy" && saved)) {
    return (
      <div className="rounded-2xl border p-4 text-sm" role="status">
        <p className="font-medium">{state === "undone" ? "반영을 취소했어요." : `${label}에 반영했어요.`}</p>
        {saved && state !== "undone" && <p className="mt-1 tabular-nums text-muted-foreground">{change(saved)}</p>}
        {state !== "undone" && <button type="button" className="mt-2 text-sm underline" disabled={state === "busy"} onClick={() => void undo()}>되돌리기</button>}
        {error && <p className="mt-2 text-red-600">{error}</p>}
      </div>
    );
  }

  return (
    <form className="space-y-3 rounded-2xl border p-4 text-sm" onSubmit={(e) => { e.preventDefault(); void confirm(); }}>
      <p className="font-medium">이 거래를 장부에 반영할까요?</p>
      <fieldset disabled={state === "busy"} className="grid grid-cols-2 gap-2">
        <label className="col-span-2">계좌
          <select className={field} required value={form.accountId} onChange={(e) => setForm({ ...form, accountId: e.target.value })}>
            <option value="">계좌를 고르세요</option>
            {accounts.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
          </select>
        </label>
        <label>구분
          <select className={field} value={form.action} onChange={(e) => setForm({ ...form, action: e.target.value as "buy" | "sell" })}>
            <option value="buy">매수</option>
            <option value="sell">매도</option>
          </select>
        </label>
        <label>종목 코드<input className={field} required maxLength={20} value={form.symbol} onChange={(e) => setForm({ ...form, symbol: e.target.value.toUpperCase() })} /></label>
        <label>수량<input className={field} required type="number" min="0.00000001" step="any" value={form.quantity || ""} onChange={(e) => setForm({ ...form, quantity: Number(e.target.value) })} /></label>
        <label>체결 단가 ({currency})<input className={field} required type="number" min="0" step="any" value={form.price ?? ""} onChange={(e) => setForm({ ...form, price: e.target.value === "" ? undefined : Number(e.target.value) })} /></label>
        <label className="col-span-2">체결일<input className={field} required type="date" value={form.tradedAt} onChange={(e) => setForm({ ...form, tradedAt: e.target.value })} /></label>
      </fieldset>
      {preview && <p className="tabular-nums text-muted-foreground">{change(preview)}</p>}
      {error && <p className="text-red-600">{error}</p>}
      <div className="flex gap-3">
        <button className="h-10 rounded-full bg-primary px-4 font-medium text-primary-foreground disabled:opacity-50" disabled={!complete || state === "busy" || !!error}>{state === "busy" ? "반영 중…" : "장부에 반영"}</button>
        <button type="button" className="underline" onClick={() => setState("dismissed")}>반영 안 함</button>
      </div>
    </form>
  );
}
