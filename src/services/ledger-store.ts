import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { AccountType } from "@/domain/portfolio";
import {
  type EntrySource,
  foldEntries,
  type HoldingState,
  type LedgerEntry,
  LedgerError,
  LedgerInput,
  TradeInput,
} from "@/domain/ledger";
import { resetPortfolioInput } from "./portfolio-input-store";

export interface LedgerAccountView {
  id: string;
  broker: string;
  name: string;
  type: AccountType;
  cashKRW: number;
  cashUSD: number;
  holdings: ({ symbol: string } & HoldingState)[];
}

export interface TradeResult {
  entryId?: string;
  before: HoldingState;
  after: HoldingState;
  /** realized P&L of this sell in the symbol's currency (0 for a buy or unknown cost) */
  realized: number;
}

const today = () => new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" });
const round = (n: number) => Math.round(n * 1e8) / 1e8;

function toEntry(r: typeof schema.ledgerEntries.$inferSelect): LedgerEntry {
  return { id: r.id, accountId: r.accountId, kind: r.kind as LedgerEntry["kind"], symbol: r.symbol, quantity: r.quantity, price: r.price ?? undefined, fee: r.fee ?? undefined, tradedAt: r.tradedAt, source: r.source as EntrySource, createdAt: r.createdAt, voidedAt: r.voidedAt ?? undefined };
}

async function loadEntries(userId: string): Promise<LedgerEntry[]> {
  const db = await getDb();
  return (await db.select().from(schema.ledgerEntries).where(eq(schema.ledgerEntries.userId, userId))).map(toEntry);
}

export async function hasLedger(userId: string): Promise<boolean> {
  const db = await getDb();
  const [row] = await db.select({ id: schema.ledgerAccounts.id }).from(schema.ledgerAccounts).where(eq(schema.ledgerAccounts.userId, userId)).limit(1);
  return !!row;
}

export async function getLedger(userId: string): Promise<LedgerAccountView[]> {
  const db = await getDb();
  const [accounts, entries] = await Promise.all([
    db.select().from(schema.ledgerAccounts).where(eq(schema.ledgerAccounts.userId, userId)).orderBy(schema.ledgerAccounts.sortOrder, schema.ledgerAccounts.createdAt),
    loadEntries(userId),
  ]);
  const folded = foldEntries(entries);
  return accounts.map((a) => ({
    id: a.id,
    broker: a.broker,
    name: a.name,
    type: a.type as AccountType,
    cashKRW: a.cashKRW,
    cashUSD: a.cashUSD,
    holdings: [...(folded.get(a.id) ?? new Map<string, HoldingState>())].map(([symbol, h]) => ({ symbol, ...h })),
  }));
}

/**
 * Saves the editor's full ledger state. Account metadata is updated in place; a holding whose quantity or
 * average cost changed gets a `set` entry (removed holdings get a zero `set`), so the trade history stays intact.
 * Accounts missing from the input are deleted with their entries.
 */
export async function saveLedger(userId: string, raw: LedgerInput, source: EntrySource = "manual") {
  if (userId === "demo") throw new LedgerError("개별 세션이 필요합니다.");
  const input = LedgerInput.parse(raw);
  const db = await getDb();
  const current = new Map((await getLedger(userId)).map((a) => [a.id, a]));
  for (const a of input.accounts) if (a.id && !current.has(a.id)) throw new LedgerError("존재하지 않는 계좌입니다.");
  const now = new Date().toISOString();
  const date = today();
  await db.transaction(async (tx) => {
    const keep = new Set(input.accounts.flatMap((a) => (a.id ? [a.id] : [])));
    const removed = [...current.keys()].filter((id) => !keep.has(id));
    if (removed.length) {
      await tx.delete(schema.ledgerEntries).where(and(eq(schema.ledgerEntries.userId, userId), inArray(schema.ledgerEntries.accountId, removed)));
      await tx.delete(schema.ledgerAccounts).where(and(eq(schema.ledgerAccounts.userId, userId), inArray(schema.ledgerAccounts.id, removed)));
    }
    for (const [i, a] of input.accounts.entries()) {
      const id = a.id ?? randomUUID();
      const meta = { broker: a.broker, name: a.name, type: a.type, cashKRW: a.cashKRW, cashUSD: a.cashUSD, sortOrder: i };
      if (a.id) await tx.update(schema.ledgerAccounts).set(meta).where(and(eq(schema.ledgerAccounts.id, id), eq(schema.ledgerAccounts.userId, userId)));
      else await tx.insert(schema.ledgerAccounts).values({ id, userId, createdAt: now, ...meta });
      const before = new Map((current.get(id)?.holdings ?? []).map((h) => [h.symbol, h]));
      const sets: { symbol: string; quantity: number; price?: number }[] = [];
      for (const h of a.holdings) {
        const b = before.get(h.symbol);
        if (!b || round(b.quantity) !== round(h.quantity) || (b.averagePrice === undefined ? h.averagePrice !== undefined : h.averagePrice === undefined || round(b.averagePrice) !== round(h.averagePrice))) sets.push({ symbol: h.symbol, quantity: h.quantity, price: h.averagePrice });
        before.delete(h.symbol);
      }
      for (const symbol of before.keys()) sets.push({ symbol, quantity: 0 });
      if (sets.length) await tx.insert(schema.ledgerEntries).values(sets.map((s) => ({ id: randomUUID(), userId, accountId: id, kind: "set", symbol: s.symbol, quantity: s.quantity, price: s.price ?? null, tradedAt: date, source, createdAt: now })));
    }
  });
  // the ledger replaces the older single-list input
  await resetPortfolioInput(userId);
}

/** Applies a reported trade to the account's current holding. `dryRun` returns the before/after without saving. */
export async function recordTrade(userId: string, raw: TradeInput, opts: { dryRun?: boolean } = {}): Promise<TradeResult> {
  if (userId === "demo") throw new LedgerError("개별 세션이 필요합니다.");
  const t = TradeInput.parse(raw);
  const db = await getDb();
  const [acct] = await db.select().from(schema.ledgerAccounts).where(and(eq(schema.ledgerAccounts.id, t.accountId), eq(schema.ledgerAccounts.userId, userId)));
  if (!acct) throw new LedgerError("존재하지 않는 계좌입니다.");
  const entries = (await loadEntries(userId)).filter((e) => e.accountId === t.accountId && e.symbol === t.symbol);
  const entry: LedgerEntry = { id: randomUUID(), accountId: t.accountId, kind: t.action, symbol: t.symbol, quantity: t.quantity, price: t.price, fee: t.fee, tradedAt: t.tradedAt, source: t.source, createdAt: new Date().toISOString() };
  const empty: HoldingState = { quantity: 0, realizedPnl: 0 };
  const before = foldEntries(entries, { keepEmpty: true }).get(t.accountId)?.get(t.symbol) ?? empty;
  // folds the whole history with the new entry in place, so a backdated sell cannot overdraw a later point
  const after = foldEntries([...entries, entry], { keepEmpty: true }).get(t.accountId)?.get(t.symbol) ?? empty;
  if (!opts.dryRun) await db.insert(schema.ledgerEntries).values({ ...entry, userId, price: entry.price ?? null, fee: entry.fee ?? null });
  return { entryId: opts.dryRun ? undefined : entry.id, before, after, realized: round(after.realizedPnl - before.realizedPnl) };
}

export async function listEntries(userId: string, limit = 30): Promise<(LedgerEntry & { account: string })[]> {
  const db = await getDb();
  const rows = await db
    .select({ e: schema.ledgerEntries, broker: schema.ledgerAccounts.broker, name: schema.ledgerAccounts.name })
    .from(schema.ledgerEntries)
    .innerJoin(schema.ledgerAccounts, eq(schema.ledgerEntries.accountId, schema.ledgerAccounts.id))
    .where(and(eq(schema.ledgerEntries.userId, userId), inArray(schema.ledgerEntries.kind, ["buy", "sell"])))
    .orderBy(desc(schema.ledgerEntries.createdAt))
    .limit(limit);
  return rows.map((r) => ({ ...toEntry(r.e), account: r.name ? `${r.broker} · ${r.name}` : r.broker }));
}

/** Undo: voids one trade, refusing when a later sell would then exceed the holding. */
export async function voidEntry(userId: string, id: string) {
  if (userId === "demo") throw new LedgerError("개별 세션이 필요합니다.");
  const entries = await loadEntries(userId);
  const target = entries.find((e) => e.id === id && !e.voidedAt);
  if (!target) throw new LedgerError("취소할 거래를 찾지 못했습니다.");
  const now = new Date().toISOString();
  try {
    foldEntries(entries.map((e) => (e.id === id ? { ...e, voidedAt: now } : e)));
  } catch {
    throw new LedgerError("이후 매도 기록과 맞지 않아 취소할 수 없습니다. 나중 거래부터 취소하세요.");
  }
  const db = await getDb();
  await db.update(schema.ledgerEntries).set({ voidedAt: now }).where(and(eq(schema.ledgerEntries.id, id), eq(schema.ledgerEntries.userId, userId)));
}

export async function resetLedger(userId: string) {
  const db = await getDb();
  await db.delete(schema.ledgerEntries).where(eq(schema.ledgerEntries.userId, userId));
  await db.delete(schema.ledgerAccounts).where(eq(schema.ledgerAccounts.userId, userId));
}

/**
 * On first owner login, carries over what this browser entered anonymously (ledger, older single-list input and
 * investment policy), each only when the owner has none yet, so nothing of the owner's is ever overwritten.
 */
export async function adoptLedger(fromUserId: string, toUserId: string): Promise<boolean> {
  if (fromUserId === "demo" || fromUserId === toUserId || (await hasLedger(toUserId))) return false;
  const db = await getDb();
  let moved = false;
  if (await hasLedger(fromUserId)) {
    await db.transaction(async (tx) => {
      await tx.update(schema.ledgerAccounts).set({ userId: toUserId }).where(eq(schema.ledgerAccounts.userId, fromUserId));
      await tx.update(schema.ledgerEntries).set({ userId: toUserId }).where(eq(schema.ledgerEntries.userId, fromUserId));
    });
    moved = true;
  }
  const [owner] = await db.select({ id: schema.portfolioInputs.userId }).from(schema.portfolioInputs).where(eq(schema.portfolioInputs.userId, toUserId));
  if (!owner && !moved) {
    const res = await db.update(schema.portfolioInputs).set({ userId: toUserId }).where(eq(schema.portfolioInputs.userId, fromUserId));
    moved = res.rowsAffected > 0;
  }
  const [policy] = await db.select({ id: schema.investmentPolicies.id }).from(schema.investmentPolicies).where(eq(schema.investmentPolicies.id, `${toUserId}:default`));
  if (!policy) await db.update(schema.investmentPolicies).set({ id: `${toUserId}:default` }).where(eq(schema.investmentPolicies.id, `${fromUserId}:default`));
  return moved;
}
