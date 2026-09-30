import { describe, expect, it } from "vitest";
import { LedgerInput, ledgerIssueMessage } from "@/domain/ledger";
import { parseTradeReport, resolveSymbol } from "@/domain/ledger-parse";

describe("symbol names in the ledger editor", () => {
  it("turns common Korean and English names into listing codes", () => {
    expect(["SK하이닉스", "삼성전자", "삼양식품", "엔비디아", "마이크론 테크놀로지", "알파벳C", "테슬라", "TSMC(ADR)", "이튼 코퍼레이션", "SK텔레콤", "마벨 테크놀로지 그룹", "JEPI"].map(resolveSymbol))
      .toEqual(["000660", "005930", "003230", "NVDA", "MU", "GOOG", "TSLA", "TSM", "ETN", "017670", "MRVL", "JEPI"]);
    expect(resolveSymbol("nvda")).toBe("NVDA");
    expect(resolveSymbol("삼성전자우")).toBe("005935");
    expect(resolveSymbol("듣도보도못한종목")).toBeUndefined();
  });

  it("prefers the longest alias in a chat trade report", () => {
    const ctx = { accounts: [{ id: "a", broker: "삼성증권", name: "", symbols: [] }], now: new Date("2026-09-30T03:00:00Z") };
    expect(parseTradeReport("삼성전자우 10주 샀어", ctx).symbol).toBe("005935");
    expect(parseTradeReport("마이크론 테크놀로지 2주 샀어", ctx).symbol).toBe("MU");
  });

  it("does not read a broker name as a stock, nor a stock name as a broker", () => {
    const ctx = { accounts: [
      { id: "kakao", broker: "카카오페이증권", name: "", symbols: [] },
      { id: "hyundai", broker: "현대차증권", name: "", symbols: [] },
      { id: "samsung", broker: "삼성증권", name: "", symbols: [] },
    ], now: new Date("2026-09-30T03:00:00Z") };
    expect(parseTradeReport("카카오페이증권에서 애플 2주 샀어", ctx)).toMatchObject({ symbol: "AAPL", accountId: "kakao" });
    expect(parseTradeReport("현대차증권에서 삼성전자 10주 7만원에 샀어", ctx)).toMatchObject({ symbol: "005930", accountId: "hyundai", price: 70000 });
    expect(parseTradeReport("삼성에서 현대차 3주 샀어", ctx)).toMatchObject({ symbol: "005380", accountId: "samsung" });
    expect(parseTradeReport("삼성증권에서 카카오 5주 샀어", ctx)).toMatchObject({ symbol: "035720", accountId: "samsung" });
  });

  it("names the account and row that failed validation", () => {
    const bad = LedgerInput.safeParse({ accounts: [
      { broker: "메리츠증권", holdings: [{ symbol: "NVDA", quantity: 1 }] },
      { broker: "키움증권", holdings: [{ symbol: "NVDA", quantity: 1 }, { symbol: "삼양식품", quantity: 5 }] },
    ] });
    expect(bad.success).toBe(false);
    if (!bad.success) expect(ledgerIssueMessage(bad.error.issues)).toBe("계좌 2 · 2번째 종목: 종목 코드 형식이 아니에요. 종목명 대신 코드(NVDA, 005930)를 넣어 주세요.");
    const dup = LedgerInput.safeParse({ accounts: [{ broker: "키움증권", holdings: [{ symbol: "NVDA", quantity: 1 }, { symbol: "NVDA", quantity: 2 }] }] });
    if (!dup.success) expect(ledgerIssueMessage(dup.error.issues)).toBe("계좌 1: 한 계좌 안에서는 같은 종목을 한 줄로 합쳐 입력하세요.");
    const noBroker = LedgerInput.safeParse({ accounts: [{ broker: "", holdings: [] }] });
    if (!noBroker.success) expect(ledgerIssueMessage(noBroker.error.issues)).toBe("계좌 1: 증권사 이름을 1~30자로 적어 주세요.");
  });
});
