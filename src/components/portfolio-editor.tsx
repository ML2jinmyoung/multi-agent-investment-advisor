"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { PortfolioInput } from "@/domain/portfolio-input";

export function PortfolioEditor({ initial, custom }: { initial: PortfolioInput; custom: boolean }) {
  const router = useRouter();
  const [input, setInput] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const field = "min-w-0 w-full rounded border bg-background p-2 text-sm";
  async function save(reset = false) {
    setBusy(true); setMessage("");
    try {
      const res = await fetch("/api/portfolio/input", { method: reset ? "DELETE" : "PUT", headers: { "Content-Type": "application/json" }, body: reset ? undefined : JSON.stringify(input) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setMessage(reset ? "기본 데모 자산으로 복원했습니다." : "입력한 자산을 반영했습니다.");
      router.refresh();
    } catch (e) { setMessage(e instanceof Error ? e.message : "저장하지 못했습니다."); }
    finally { setBusy(false); }
  }
  return <details className="rounded-2xl bg-card p-4 shadow-sm ring-1 ring-border">
    <summary className="cursor-pointer font-medium">내 보유자산으로 분석하기{custom ? " · 직접 입력 사용 중" : ""}</summary>
    <p className="my-3 text-sm text-muted-foreground">종목 코드·수량·평균 매입가만 입력하세요. 계좌 연결 없이 이 브라우저에만 적용돼요.</p>
    <form onSubmit={(e) => { e.preventDefault(); void save(); }} className="space-y-3">
      <fieldset disabled={busy} className="space-y-2">
        <div className="grid grid-cols-[2fr_1fr_1fr_auto] gap-2 text-xs"><span>종목 코드 (NVDA, 005930)</span><span>수량</span><span>평균 매입가 · 종목 통화</span><span>삭제</span></div>
        {input.holdings.map((h, i) => <div key={i} className="grid grid-cols-[2fr_1fr_1fr_auto] gap-2">
          <input aria-label={`종목 ${i + 1}`} className={field} required maxLength={20} value={h.symbol} onChange={(e) => setInput({ ...input, holdings: input.holdings.map((v, j) => j === i ? { ...v, symbol: e.target.value.toUpperCase() } : v) })} />
          <input aria-label={`수량 ${i + 1}`} className={field} required type="number" min="0.00000001" max="1000000000" step="any" value={h.quantity || ""} onChange={(e) => setInput({ ...input, holdings: input.holdings.map((v, j) => j === i ? { ...v, quantity: Number(e.target.value) } : v) })} />
          <input aria-label={`평균 매입가 ${i + 1}`} className={field} type="number" min="0" max="1000000000" step="any" value={h.averagePrice ?? ""} onChange={(e) => setInput({ ...input, holdings: input.holdings.map((v, j) => j === i ? { ...v, averagePrice: e.target.value === "" ? undefined : Number(e.target.value) } : v) })} />
          <button type="button" className="px-2 text-sm" aria-label={`종목 ${i + 1} 삭제`} onClick={() => setInput({ ...input, holdings: input.holdings.filter((_, j) => i !== j) })}>×</button>
        </div>)}
        <button type="button" className="text-sm underline" disabled={input.holdings.length >= 40} onClick={() => setInput({ ...input, holdings: [...input.holdings, { symbol: "", quantity: 1 }] })}>+ 종목 추가</button>
        <div className="grid grid-cols-2 gap-3">
          <label className="text-sm">원화 현금 (KRW)<input className={field} required type="number" min="0" max="10000000000000" step="any" value={input.cashKRW} onChange={(e) => setInput({ ...input, cashKRW: Number(e.target.value) })} /></label>
          <label className="text-sm">달러 현금 (USD)<input className={field} required type="number" min="0" max="10000000000" step="any" value={input.cashUSD} onChange={(e) => setInput({ ...input, cashUSD: Number(e.target.value) })} /></label>
        </div>
        <div className="flex gap-3"><button className="h-11 rounded-full bg-primary px-5 text-sm font-medium text-primary-foreground">{busy ? "반영 중…" : "분석에 반영"}</button><button type="button" className="text-sm underline" onClick={() => void save(true)}>입력 삭제 · 데모 복원</button></div>
      </fieldset>
      <p role="status" className="text-sm">{message}</p>
      <p className="text-xs text-muted-foreground">계좌번호·인증정보는 받지 않아요.</p>
    </form>
  </details>;
}
