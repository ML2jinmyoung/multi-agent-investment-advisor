import { tradingCurrency } from "./ledger";
import { SYMBOL_ALIASES } from "./symbol-aliases";

/**
 * Text parsing for the ledger: pasted holdings tables and trades reported in chat. Pure functions (no I/O),
 * shared by the /assets editor and the agent route. Parsing only proposes; the user confirms before any write.
 */

const BROKERS: [RegExp, string][] = [
  [/토스/, "토스증권"],
  [/삼성/, "삼성증권"],
  [/미래/, "미래에셋증권"],
  [/키움/, "키움증권"],
  [/한투|한국투자/, "한국투자증권"],
  [/nh|나무/i, "NH투자증권"],
  [/kb|국민/i, "KB증권"],
  [/신한/, "신한투자증권"],
  [/대신|크레온/, "대신증권"],
  [/메리츠/, "메리츠증권"],
  [/하나/, "하나증권"],
  [/카카오/, "카카오페이증권"],
  [/유안타/, "유안타증권"],
  [/교보/, "교보증권"],
  [/db금융|db투자/i, "DB금융투자"],
  [/ls|이베스트/i, "LS증권"],
  [/한화/, "한화투자증권"],
  [/현대차/, "현대차증권"],
];

/** Canonical broker name for a free-text mention ("삼성" -> "삼성증권"); unknown names are kept as typed. */
export function normalizeBroker(text: string): string {
  const t = text.trim();
  return BROKERS.find(([re]) => re.test(t))?.[1] ?? t;
}

/** Canonical brokers mentioned anywhere in a sentence. */
export function brokersIn(text: string): string[] {
  return BROKERS.filter(([re]) => re.test(text)).map(([, name]) => name);
}

const SYMBOL_RE = /^[A-Z0-9][A-Z0-9.-]{0,19}$/;
const KR_CODE = /^\d{5}[0-9A-Z]$/;

/** Listing code for a pasted cell: a known name ("삼성전자"), a KRX code or a ticker. */
export function resolveSymbol(token: string): string | undefined {
  const t = token.trim();
  const alias = SYMBOL_ALIASES[t.toLowerCase()] ?? SYMBOL_ALIASES[t.toLowerCase().replace(/\s+/g, "")];
  if (alias) return alias;
  const up = t.toUpperCase();
  return SYMBOL_RE.test(up) && (KR_CODE.test(up) || /[A-Z]/.test(up)) ? up : undefined;
}

function num(token: string): number | undefined {
  const t = token.trim().replace(/[,$₩]|원|주|usd|krw/gi, "");
  if (!/^\d+(\.\d+)?$/.test(t)) return undefined;
  return Number(t);
}

export interface PastedRow {
  broker?: string;
  symbol: string;
  quantity: number;
  averagePrice?: number;
}

/**
 * Parses rows like "삼성증권, 005930, 10, 71000", "NVDA 5 120.5" or tab-separated cells copied from a sheet.
 * Columns: [broker] symbol quantity [average price]. A header row or blank line is skipped; bad rows are reported.
 */
export function parsePastedHoldings(text: string): { rows: PastedRow[]; errors: string[] } {
  const rows: PastedRow[] = [];
  const errors: string[] = [];
  for (const [n, raw] of text.split(/\r?\n/).entries()) {
    const line = raw.trim();
    if (!line) continue;
    const tokens = (/[\t|]/.test(line) ? line.split(/\s*[\t|]\s*/) : line.split(/,(?!\d{3}(?:\D|$))|\s+/)).map((t) => t.trim()).filter(Boolean);
    // symbol = the right-most token that is a code or a name, followed by 1-2 numbers (quantity, average price)
    let at = -1;
    for (let i = tokens.length - 2; i >= 0; i--) {
      const tail = tokens.slice(i + 1);
      if (tail.length > 2 || !tail.every((t) => num(t) !== undefined)) continue;
      if (num(tokens[i]) === undefined || KR_CODE.test(tokens[i])) { at = i; break; }
    }
    const symbol = at >= 0 ? resolveSymbol(tokens[at]) : undefined;
    const quantity = at >= 0 ? num(tokens[at + 1]) : undefined;
    if (at < 0 || !symbol || !quantity) {
      if (rows.length === 0 && errors.length === 0 && !tokens.some((t) => num(t) !== undefined)) continue; // header
      errors.push(`${n + 1}번째 줄을 읽지 못했어요: ${line.slice(0, 40)}`);
      continue;
    }
    const broker = tokens.slice(0, at).join(" ");
    rows.push({ broker: broker ? normalizeBroker(broker) : undefined, symbol, quantity, averagePrice: tokens[at + 2] !== undefined ? num(tokens[at + 2]) : undefined });
  }
  return { rows, errors };
}

// ---- trades reported in chat ----

const DONE_BUY = /(샀|매수\s*(했|함|완료|체결|됐)|추가\s*매수했|물\s*탔|담았)/;
const DONE_SELL = /(팔았|매도\s*(했|함|완료|체결|됐)|익절\s*(했|함)|손절\s*(했|함)|정리\s*(했|함))/;
const QUESTION = /(\?|？|까\s*[?요]?\s*$|할까|살까|팔까|어때|어떨|괜찮|좋을)/;

/** A message that reports a trade already done ("엔비디아 5주 샀어"), as opposed to asking about one. */
export function isTradeReport(message: string): boolean {
  return (DONE_BUY.test(message) || DONE_SELL.test(message)) && !QUESTION.test(message);
}

export interface TradeDraft {
  action: "buy" | "sell";
  symbol?: string;
  quantity?: number;
  price?: number;
  currency: string;
  tradedAt: string;
  accountId?: string;
}

const UNIT: Record<string, number> = { 억: 1e8, 천만: 1e7, 백만: 1e6, 만: 1e4, 천: 1e3 };

/** "7만2천" -> 72000, "1억 5000만" -> 150000000, "71,000" -> 71000 */
function koreanAmount(text: string): number {
  let sum = 0;
  const rest = text.replace(/(\d[\d,]*(?:\.\d+)?)\s*(억|천만|백만|만|천)/g, (_, n: string, u: string) => ((sum += Number(n.replace(/,/g, "")) * UNIT[u]), ""));
  const tail = rest.replace(/[\s,]/g, "");
  return sum + (tail ? Number(tail) : 0);
}

function isoDate(d: Date) {
  return d.toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" });
}

function tradeDate(message: string, now: Date): string {
  const day = 86_400_000;
  if (/그저께|그제/.test(message)) return isoDate(new Date(now.getTime() - 2 * day));
  if (/어제/.test(message)) return isoDate(new Date(now.getTime() - day));
  const md = message.match(/(\d{1,2})\s*월\s*(\d{1,2})\s*일/) ?? message.match(/(?<![\d.])(\d{1,2})\/(\d{1,2})(?![\d/])/);
  if (md) {
    const year = Number(isoDate(now).slice(0, 4));
    const d = `${year}-${md[1].padStart(2, "0")}-${md[2].padStart(2, "0")}`;
    return d > isoDate(now) ? `${year - 1}${d.slice(4)}` : d;
  }
  return isoDate(now);
}

/**
 * Pulls action, symbol, quantity, price, date and account out of a trade report. Anything it cannot read stays
 * empty for the user to fill in on the confirmation card; nothing is guessed from the market.
 */
export function parseTradeReport(
  message: string,
  ctx: { accounts: { id: string; broker: string; name: string; symbols: string[] }[]; knownSymbol?: (s: string) => boolean; now?: Date },
): TradeDraft {
  const now = ctx.now ?? new Date();
  const lower = message.toLowerCase();
  const action = DONE_SELL.test(message) && !DONE_BUY.test(message) ? "sell" : "buy";

  const held = new Set(ctx.accounts.flatMap((a) => a.symbols));
  // the broker phrase is set aside first ("카카오페이증권" is not the stock 카카오), then the longest alias wins ("삼성전자우" over 삼성전자)
  const brokerFree = lower.replace(/\S*(?:증권|금융투자)\S*/g, " ");
  const compact = brokerFree.replace(/\s+/g, "");
  const hit = Object.entries(SYMBOL_ALIASES).sort((a, b) => b[0].length - a[0].length).find(([alias]) => brokerFree.includes(alias) || compact.includes(alias.replace(/\s+/g, "")));
  let symbol = hit?.[1];
  symbol ??= (message.match(/\b[A-Za-z]{1,5}(?:\.[A-Za-z])?\b/g) ?? []).map((t) => t.toUpperCase()).find((t) => held.has(t) || ctx.knownSymbol?.(t));
  // a 6-character KRX code, but not a price or quantity ("120000원", "100000주")
  symbol ??= message.match(/(?<![\d.,])(\d{5}[0-9A-Z])(?![\d.,])(?!\s*(?:원|주|달러|불|억|천|만))/)?.[1];

  const qty = message.match(/(\d+(?:\.\d+)?)\s*주(?![식간일A-Za-z0-9])/);
  const quantity = qty ? Number(qty[1]) : undefined;

  let price: number | undefined;
  let currency = symbol ? tradingCurrency(symbol) : "KRW";
  const usd = message.match(/\$\s*(\d[\d,]*(?:\.\d+)?)|(\d[\d,]*(?:\.\d+)?)\s*(?:달러|불|usd)/i);
  const krw = message.match(/((?:\d[\d,]*(?:\.\d+)?\s*(?:억|천만|백만|만|천)\s*)*(?:\d[\d,]*(?:\.\d+)?)?)\s*원/);
  const bare = message.match(/(?:평단|단가|가격|@)\s*(?:가\s*)?(\d[\d,]*(?:\.\d+)?)/);
  let amount: number | undefined;
  if (usd) { amount = Number((usd[1] ?? usd[2]).replace(/,/g, "")); currency = "USD"; }
  else if (krw?.[1].trim()) { amount = koreanAmount(krw[1]); currency = "KRW"; }
  else if (bare) amount = Number(bare[1].replace(/,/g, ""));
  if (amount !== undefined) {
    // "100만원어치" / "총 500달러" is the total, not the per-share price
    const total = /어치|총\s*\d|전체|합계/.test(message);
    if (!total) price = amount;
    else if (quantity) price = Math.round((amount / quantity) * 1e4) / 1e4;
  }

  // "삼성전자" must not read as the broker "삼성": the matched stock name is removed before brokers are looked for
  const mentioned = brokersIn(hit ? [hit[0], hit[0].replace(/\s+/g, "")].reduce((t, alias) => t.split(alias).join(" "), lower) : lower);
  const byBroker = ctx.accounts.filter((a) => mentioned.includes(normalizeBroker(a.broker)) || (a.name && message.includes(a.name)));
  const bySymbol = action === "sell" && symbol ? ctx.accounts.filter((a) => a.symbols.includes(symbol)) : [];
  const accountId = ctx.accounts.length === 1 ? ctx.accounts[0].id : byBroker.length === 1 ? byBroker[0].id : !mentioned.length && bySymbol.length === 1 ? bySymbol[0].id : undefined;

  return { action, symbol, quantity, price, currency, tradedAt: tradeDate(message, now), accountId };
}

export const BROKER_NAMES = BROKERS.map(([, name]) => name);
