import { describe, expect, it } from "vitest";
import { isTradeReport, normalizeBroker, parsePastedHoldings, parseTradeReport } from "@/domain/ledger-parse";

const now = new Date("2026-09-30T03:00:00Z");
const accounts = [
  { id: "a", broker: "삼성증권", name: "", symbols: ["NVDA"] },
  { id: "b", broker: "키움증권", name: "ISA", symbols: ["005930"] },
];

describe("pasted holdings", () => {
  it("reads broker/symbol/quantity/average rows in comma, space and tab layouts", () => {
    const { rows, errors } = parsePastedHoldings([
      "증권사, 종목, 수량, 평단",
      "삼성, 005930, 10, 71,000",
      "NVDA 5 120.5",
      "키움증권\t000660\t3\t180000",
      "한국투자 증권 삼성전자 2",
      "알수없음 뭐지",
    ].join("\n"));
    expect(rows).toEqual([
      { broker: "삼성증권", symbol: "005930", quantity: 10, averagePrice: 71000 },
      { broker: undefined, symbol: "NVDA", quantity: 5, averagePrice: 120.5 },
      { broker: "키움증권", symbol: "000660", quantity: 3, averagePrice: 180000 },
      { broker: "한국투자증권", symbol: "005930", quantity: 2, averagePrice: undefined },
    ]);
    expect(errors).toHaveLength(1);
  });
  it("normalizes broker nicknames", () => {
    expect(normalizeBroker("한투")).toBe("한국투자증권");
    expect(normalizeBroker("나의증권")).toBe("나의증권");
  });
});

describe("trades reported in chat", () => {
  it("tells a done trade from a question", () => {
    expect(isTradeReport("삼성에서 엔비디아 5주 120달러에 샀어")).toBe(true);
    expect(isTradeReport("삼성전자 3주 매도했어요")).toBe(true);
    expect(isTradeReport("엔비디아 5주 살까?")).toBe(false);
    expect(isTradeReport("어제 샀는데 어때?")).toBe(false);
  });
  it("extracts account, symbol, quantity, price and date", () => {
    expect(parseTradeReport("삼성에서 엔비디아 5주 120달러에 샀어", { accounts, now })).toEqual({ action: "buy", symbol: "NVDA", quantity: 5, price: 120, currency: "USD", tradedAt: "2026-09-30", accountId: "a" });
    expect(parseTradeReport("어제 삼성전자 3주 7만2천원에 팔았어", { accounts, now })).toMatchObject({ action: "sell", symbol: "005930", quantity: 3, price: 72000, currency: "KRW", tradedAt: "2026-09-29", accountId: "b" });
    expect(parseTradeReport("키움 ISA에서 005930 10주 총 700만원어치 샀어", { accounts, now })).toMatchObject({ symbol: "005930", quantity: 10, price: 700000, accountId: "b" });
    expect(parseTradeReport("9월 3일에 NVDA 2주 매수 완료", { accounts, now })).toMatchObject({ tradedAt: "2026-09-03", price: undefined, accountId: undefined });
  });
});
