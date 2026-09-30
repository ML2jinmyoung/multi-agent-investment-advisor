"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { ACCOUNT_TYPE_LABEL, type LedgerAccountInput } from "@/domain/ledger";
import { BROKER_NAMES, normalizeBroker, parsePastedHoldings } from "@/domain/ledger-parse";
import type { AccountType } from "@/domain/portfolio";

type Account = Omit<LedgerAccountInput, "holdings"> & { key: string; holdings: { symbol: string; quantity: number; averagePrice?: number }[] };

const blank = (broker = ""): Account => ({ key: crypto.randomUUID(), broker, name: "", type: "brokerage", cashKRW: 0, cashUSD: 0, holdings: [] });

/** Per-brokerage holdings ledger editor. Saving sends the whole state; the server records what changed. */
export function LedgerEditor({ initial, custom }: { initial: Omit<Account, "key">[]; custom: boolean }) {
  const router = useRouter();
  const [accounts, setAccounts] = useState<Account[]>(() => (initial.length ? initial.map((a) => ({ ...a, key: a.id ?? crypto.randomUUID() })) : [blank()]));
  const [paste, setPaste] = useState("");
  const [pasteTarget, setPasteTarget] = useState(0);
  const [pasted, setPasted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const field = "min-w-0 w-full rounded border bg-background p-2 text-sm";
  const update = (i: number, next: Partial<Account>) => setAccounts(accounts.map((a, j) => (j === i ? { ...a, ...next } : a)));
  const updateHolding = (i: number, k: number, next: Partial<Account["holdings"][number]>) => update(i, { holdings: accounts[i].holdings.map((h, j) => (j === k ? { ...h, ...next } : h)) });

  function importPaste() {
    const { rows, errors } = parsePastedHoldings(paste);
    const next = accounts.map((a) => ({ ...a, holdings: [...a.holdings] }));
    const target = next[pasteTarget]?.broker.trim() ? next[pasteTarget] : undefined;
    let loaded = 0;
    for (const r of rows) {
      // every holding belongs to a broker: a row without one goes to the chosen account, or is refused
      if (!r.broker && !target) { errors.push(`${r.symbol}: 증권사가 없어요. 줄 앞에 증권사를 적거나 넣을 계좌를 고르세요.`); continue; }
      let acct = r.broker ? next.find((a) => normalizeBroker(a.broker) === r.broker) : target;
      if (!acct) {
        const empty = next.find((a) => !a.broker && !a.holdings.length);
        acct = empty ?? blank();
        acct.broker = r.broker ?? "";
        if (!empty) next.push(acct);
      }
      const h = { symbol: r.symbol, quantity: r.quantity, averagePrice: r.averagePrice };
      const at = acct.holdings.findIndex((x) => x.symbol === r.symbol);
      if (at >= 0) acct.holdings[at] = h;
      else acct.holdings.push(h);
      loaded++;
    }
    setAccounts(next);
    setPasted(pasted || loaded > 0);
    setPaste(errors.length ? paste : "");
    setMessage(`${loaded}줄을 불러왔어요. 확인 후 저장하세요.${errors.length ? ` 읽지 못한 줄: ${errors.join(" / ")}` : ""}`);
  }

  async function save() {
    setBusy(true);
    setMessage("");
    try {
      const ledger = { accounts: accounts.map((a) => ({ id: initial.some((x) => x.id === a.id) ? a.id : undefined, broker: a.broker, name: a.name, type: a.type, cashKRW: a.cashKRW, cashUSD: a.cashUSD, holdings: a.holdings })) };
      const res = await fetch("/api/ledger", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ledger, source: pasted ? "paste" : "manual" }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setMessage("장부를 저장했어요.");
      router.refresh();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "저장하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  async function reset() {
    if (!window.confirm("장부와 거래 기록을 모두 지우고 데모 자산으로 돌아갈까요?")) return;
    setBusy(true);
    try {
      await Promise.all([fetch("/api/ledger", { method: "DELETE" }), fetch("/api/portfolio/input", { method: "DELETE" })]);
      setMessage("장부를 지우고 데모 자산으로 복원했어요.");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <details className="rounded-2xl bg-card p-4 shadow-sm ring-1 ring-border" open={!custom}>
      <summary className="cursor-pointer font-medium">증권사별 보유자산 장부{custom ? " · 사용 중" : ""}</summary>
      <p className="my-3 text-sm text-muted-foreground">증권사마다 종목 코드·수량·평균 매입가를 적어 두세요. 이후 매매는 대화에서 &ldquo;삼성에서 엔비디아 5주 120달러에 샀어&rdquo;처럼 말하면 확인 후 반영돼요.</p>
      <datalist id="broker-names">{BROKER_NAMES.map((b) => <option key={b} value={b} />)}</datalist>
      <form onSubmit={(e) => { e.preventDefault(); void save(); }} className="space-y-4">
        <fieldset disabled={busy} className="space-y-4">
          {accounts.map((a, i) => (
            <section key={a.key} aria-label={`계좌 ${i + 1}`} className="space-y-2 rounded-xl border p-3">
              <div className="grid grid-cols-[2fr_2fr_1fr_auto] gap-2">
                <label className="text-xs">증권사<input className={field} required maxLength={30} list="broker-names" placeholder="예: 삼성증권" value={a.broker} onChange={(e) => update(i, { broker: e.target.value })} /></label>
                <label className="text-xs">별칭 (선택)<input className={field} maxLength={30} placeholder="ISA, 연금 등" value={a.name} onChange={(e) => update(i, { name: e.target.value })} /></label>
                <label className="text-xs">유형
                  <select className={field} value={a.type} onChange={(e) => update(i, { type: e.target.value as AccountType })}>
                    {Object.entries(ACCOUNT_TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </label>
                <button type="button" className="self-end px-2 pb-2 text-sm" aria-label={`계좌 ${i + 1} 삭제`} onClick={() => setAccounts(accounts.filter((_, j) => j !== i))}>×</button>
              </div>
              <div className="grid grid-cols-[2fr_1fr_1fr_auto] gap-2 text-xs"><span>종목 코드 (NVDA, 005930)</span><span>수량</span><span>평균 매입가 · 종목 통화</span><span /></div>
              {a.holdings.map((h, k) => (
                <div key={k} className="grid grid-cols-[2fr_1fr_1fr_auto] gap-2">
                  <input aria-label={`계좌 ${i + 1} 종목 ${k + 1}`} className={field} required maxLength={20} value={h.symbol} onChange={(e) => updateHolding(i, k, { symbol: e.target.value.toUpperCase() })} />
                  <input aria-label={`계좌 ${i + 1} 수량 ${k + 1}`} className={field} required type="number" min="0.00000001" max="1000000000" step="any" value={h.quantity || ""} onChange={(e) => updateHolding(i, k, { quantity: Number(e.target.value) })} />
                  <input aria-label={`계좌 ${i + 1} 평균 매입가 ${k + 1}`} className={field} type="number" min="0" max="1000000000" step="any" value={h.averagePrice ?? ""} onChange={(e) => updateHolding(i, k, { averagePrice: e.target.value === "" ? undefined : Number(e.target.value) })} />
                  <button type="button" className="px-2 text-sm" aria-label={`계좌 ${i + 1} 종목 ${k + 1} 삭제`} onClick={() => update(i, { holdings: a.holdings.filter((_, j) => j !== k) })}>×</button>
                </div>
              ))}
              <button type="button" className="text-sm underline" disabled={a.holdings.length >= 60} onClick={() => update(i, { holdings: [...a.holdings, { symbol: "", quantity: 1 }] })}>+ 종목 추가</button>
              <div className="grid grid-cols-2 gap-2">
                <label className="text-xs">원화 예수금 (KRW)<input className={field} type="number" min="0" max="10000000000000" step="any" value={a.cashKRW || ""} onChange={(e) => update(i, { cashKRW: Number(e.target.value) })} /></label>
                <label className="text-xs">달러 예수금 (USD)<input className={field} type="number" min="0" max="10000000000" step="any" value={a.cashUSD || ""} onChange={(e) => update(i, { cashUSD: Number(e.target.value) })} /></label>
              </div>
            </section>
          ))}
          <button type="button" className="text-sm underline" disabled={accounts.length >= 20} onClick={() => setAccounts([...accounts, blank()])}>+ 증권사 계좌 추가</button>

          <details className="rounded-xl border p-3">
            <summary className="cursor-pointer text-sm font-medium">표로 한꺼번에 붙여넣기</summary>
            <p className="my-2 text-xs text-muted-foreground">한 줄에 <code>증권사, 종목, 수량, 평단</code> 순서로 적거나 엑셀·구글시트에서 복사해 붙여넣으세요. 증권사 칸이 없는 줄은 아래에서 고른 계좌(증권사를 적어 둔 계좌)로 들어가요.</p>
            <textarea aria-label="보유 종목 붙여넣기" className={`${field} h-28 font-mono`} placeholder={"삼성증권, 005930, 10, 71000\n키움증권, NVDA, 5, 120.5"} value={paste} onChange={(e) => setPaste(e.target.value)} />
            <div className="mt-2 flex items-center gap-2">
              <select aria-label="증권사 칸이 없는 줄을 넣을 계좌" className={field} value={pasteTarget} onChange={(e) => setPasteTarget(Number(e.target.value))}>
                {accounts.map((a, i) => <option key={a.key} value={i}>{a.broker || `계좌 ${i + 1}`}{a.name ? ` · ${a.name}` : ""}</option>)}
              </select>
              <button type="button" className="shrink-0 rounded-full border px-4 py-2 text-sm" disabled={!paste.trim()} onClick={importPaste}>불러오기</button>
            </div>
          </details>

          <div className="flex gap-3">
            <button className="h-11 rounded-full bg-primary px-5 text-sm font-medium text-primary-foreground">{busy ? "저장 중…" : "장부 저장"}</button>
            {custom && <button type="button" className="text-sm underline" onClick={() => void reset()}>장부 삭제 · 데모 복원</button>}
          </div>
        </fieldset>
        <p role="status" className="text-sm">{message}</p>
        <p className="text-xs text-muted-foreground">계좌번호·인증정보는 받지 않아요. 가격은 종목이 거래되는 통화로 적어 주세요.</p>
      </form>
    </details>
  );
}
