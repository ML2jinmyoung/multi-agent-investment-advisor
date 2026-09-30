import { z } from "zod";
import { AccountType } from "./portfolio";

/**
 * Holdings ledger: one account per brokerage account the user keeps, and an append-only list of entries.
 * Quantity and average cost are never stored; they are folded from the entries, so a wrong entry is undone
 * by voiding that one row.
 */
const Symbol = z.string().trim().toUpperCase().regex(/^[A-Z0-9][A-Z0-9.-]{0,19}$/);
const Qty = z.number().finite().positive().max(1e9);
const Price = z.number().finite().nonnegative().max(1e9);

export const LedgerHolding = z.object({ symbol: Symbol, quantity: Qty, averagePrice: Price.optional() }).strict();
export type LedgerHolding = z.infer<typeof LedgerHolding>;

export const LedgerAccountInput = z.object({
  /** absent for an account created in this save */
  id: z.string().uuid().optional(),
  broker: z.string().trim().min(1).max(30),
  name: z.string().trim().max(30).default(""),
  type: AccountType.default("brokerage"),
  cashKRW: z.number().finite().nonnegative().max(1e13).default(0),
  cashUSD: z.number().finite().nonnegative().max(1e10).default(0),
  holdings: z.array(LedgerHolding).max(60),
}).strict().refine((a) => new Set(a.holdings.map((h) => h.symbol)).size === a.holdings.length, "한 계좌 안에서는 같은 종목을 한 줄로 합쳐 입력하세요.");
export type LedgerAccountInput = z.infer<typeof LedgerAccountInput>;

/** What the /assets editor saves: the whole ledger's current state. The server turns differences into entries. */
export const LedgerInput = z.object({ accounts: z.array(LedgerAccountInput).max(20) }).strict();
export type LedgerInput = z.infer<typeof LedgerInput>;

/** Points at the field the user must fix: "계좌 2 · 3번째 종목: 종목 코드 형식이 아니에요 (예: NVDA, 005930)". */
export function ledgerIssueMessage(issues: { path: PropertyKey[]; message: string }[]): string {
  const issue = issues[0];
  if (!issue) return "입력을 확인하세요.";
  const [, acct, field, row, sub] = issue.path;
  const where = typeof acct === "number" ? `계좌 ${acct + 1}${typeof row === "number" ? ` · ${row + 1}번째 종목` : ""}: ` : "";
  const key = field === "holdings" ? sub : field;
  const what: Record<string, string> = {
    broker: "증권사 이름을 1~30자로 적어 주세요.",
    name: "별칭은 30자까지예요.",
    symbol: "종목 코드 형식이 아니에요. 종목명 대신 코드(NVDA, 005930)를 넣어 주세요.",
    quantity: "수량은 0보다 큰 숫자여야 해요.",
    averagePrice: "평균 매입가는 0 이상의 숫자여야 해요 (해외 종목은 달러).",
    cashKRW: "원화 예수금은 0 이상의 숫자여야 해요.",
    cashUSD: "달러 예수금은 0 이상의 숫자여야 해요.",
    holdings: "한 계좌 안에서는 같은 종목을 한 줄로 합쳐 주세요.",
  };
  return where + (what[String(key)] ?? (typeof key === "string" && key ? `${key}: ${issue.message}` : issue.message));
}

export const EntryKind = z.enum(["set", "buy", "sell"]);
export type EntryKind = z.infer<typeof EntryKind>;
export const EntrySource = z.enum(["manual", "paste", "chat"]);
export type EntrySource = z.infer<typeof EntrySource>;

/** A trade the user reports (from chat or the history form). Prices are in the symbol's trading currency. */
export const TradeInput = z.object({
  accountId: z.string().uuid(),
  action: z.enum(["buy", "sell"]),
  symbol: Symbol,
  quantity: Qty,
  price: Price,
  fee: Price.optional(),
  tradedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  source: EntrySource.default("chat"),
}).strict();
export type TradeInput = z.infer<typeof TradeInput>;

export interface LedgerEntry {
  id: string;
  accountId: string;
  kind: EntryKind;
  symbol: string;
  quantity: number;
  price?: number;
  fee?: number;
  tradedAt: string;
  source: EntrySource;
  createdAt: string;
  voidedAt?: string;
}

export interface HoldingState {
  quantity: number;
  averagePrice?: number;
  realizedPnl: number;
}

export class LedgerError extends Error {}

const EPS = 1e-9;

/** Applies one entry to a holding. Buy re-weights the average cost; sell keeps it and books realized P&L. Fees stay out of the average. */
export function applyEntry(state: HoldingState | undefined, e: Pick<LedgerEntry, "kind" | "quantity" | "price" | "symbol">): HoldingState {
  const s = state ?? { quantity: 0, realizedPnl: 0 };
  if (e.kind === "set") return { quantity: e.quantity, averagePrice: e.quantity > 0 ? e.price : undefined, realizedPnl: s.realizedPnl };
  if (e.kind === "buy") {
    const quantity = s.quantity + e.quantity;
    const averagePrice = e.price === undefined ? undefined : s.quantity <= EPS ? e.price : s.averagePrice === undefined ? undefined : (s.averagePrice * s.quantity + e.price * e.quantity) / quantity;
    return { quantity, averagePrice, realizedPnl: s.realizedPnl };
  }
  if (e.quantity > s.quantity + EPS) throw new LedgerError(`${e.symbol}: 보유 수량(${s.quantity})보다 많이 팔 수 없습니다.`);
  const quantity = Math.max(0, s.quantity - e.quantity);
  const realized = s.averagePrice !== undefined && e.price !== undefined ? (e.price - s.averagePrice) * e.quantity : 0;
  return { quantity: quantity <= EPS ? 0 : quantity, averagePrice: quantity <= EPS ? undefined : s.averagePrice, realizedPnl: s.realizedPnl + realized };
}

/** Folds non-voided entries (oldest first) into account -> symbol -> holding. Zero-quantity holdings are dropped unless `keepEmpty`. */
export function foldEntries(entries: LedgerEntry[], opts: { keepEmpty?: boolean } = {}): Map<string, Map<string, HoldingState>> {
  const out = new Map<string, Map<string, HoldingState>>();
  const ordered = entries.filter((e) => !e.voidedAt).sort((a, b) => a.tradedAt.localeCompare(b.tradedAt) || a.createdAt.localeCompare(b.createdAt));
  for (const e of ordered) {
    const acct = out.get(e.accountId) ?? new Map<string, HoldingState>();
    out.set(e.accountId, acct);
    acct.set(e.symbol, applyEntry(acct.get(e.symbol), e));
  }
  if (!opts.keepEmpty) for (const acct of out.values()) for (const [sym, h] of acct) if (h.quantity <= EPS) acct.delete(sym);
  return out;
}

export const ACCOUNT_TYPE_LABEL: Record<AccountType, string> = { brokerage: "일반", isa: "ISA", irp: "IRP", dc: "DC", pension: "연금저축", other: "기타" };

export const accountLabel = (a: { broker: string; name: string }) => (a.name ? `${a.broker} · ${a.name}` : a.broker);

/** Listing-market guess for a code: 6-char KRX codes trade in KRW, everything else in USD. */
export const tradingCurrency = (symbol: string) => (/^\d{5}[A-Z0-9]$/.test(symbol) ? "KRW" : "USD");
