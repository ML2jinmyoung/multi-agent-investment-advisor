/**
 * Common Korean/English names -> listing code. Lowercase keys without spaces; matched as substrings of
 * lowercased text (longest alias wins) and as whole cells in the ledger editor and pasted tables.
 */
export const SYMBOL_ALIASES: Record<string, string> = {
  // US stocks
  엔비디아: "NVDA", nvidia: "NVDA", 애플: "AAPL", apple: "AAPL", 마이크로소프트: "MSFT", microsoft: "MSFT", 아마존: "AMZN", amazon: "AMZN",
  테슬라: "TSLA", tesla: "TSLA", 메타플랫폼스: "META", 알파벳a: "GOOGL", 알파벳c: "GOOG", 알파벳: "GOOG", 구글: "GOOG", google: "GOOG",
  넷플릭스: "NFLX", netflix: "NFLX", 브로드컴: "AVGO", broadcom: "AVGO", 코스트코: "COST", costco: "COST", 버크셔: "BRK.B", 버크셔해서웨이: "BRK.B",
  jp모건: "JPM", jp모간: "JPM", 일라이릴리: "LLY", 마이크론: "MU", 마이크론테크놀로지: "MU", micron: "MU", tsmc: "TSM", "tsmc(adr)": "TSM", 티에스엠씨: "TSM",
  이튼: "ETN", 이튼코퍼레이션: "ETN", eaton: "ETN", 마벨: "MRVL", 마벨테크놀로지: "MRVL", 마벨테크놀로지그룹: "MRVL", marvell: "MRVL",
  amd: "AMD", 에이엠디: "AMD", 팔란티어: "PLTR", palantir: "PLTR", 오라클: "ORCL", 인텔: "INTC", 퀄컴: "QCOM", 아이온큐: "IONQ", 유나이티드헬스: "UNH",
  마스터카드: "MA", 월마트: "WMT", 엑슨모빌: "XOM", 코카콜라: "KO", 펩시: "PEP", 디즈니: "DIS", 나이키: "NKE", 스타벅스: "SBUX", 맥도날드: "MCD",
  // US ETFs
  jepi: "JEPI", jepq: "JEPQ", schd: "SCHD", qqq: "QQQ", spy: "SPY", voo: "VOO", vti: "VTI", tqqq: "TQQQ", soxl: "SOXL", soxx: "SOXX", tlt: "TLT", ivv: "IVV", qqqm: "QQQM",
  // KR stocks
  삼성전자우: "005935", 삼성전자: "005930", 삼전: "005930", sk하이닉스: "000660", 하이닉스: "000660", 현대차: "005380", 현대자동차: "005380", 기아: "000270",
  삼성바이오로직스: "207940", 삼바: "207940", lg에너지솔루션: "373220", 엘지에너지솔루션: "373220", kb금융: "105560", 셀트리온: "068270", 네이버: "035420", naver: "035420",
  카카오: "035720", 한화에어로스페이스: "012450", 현대모비스: "012330", posco홀딩스: "005490", 포스코홀딩스: "005490", 신한지주: "055550", 하나금융지주: "086790",
  삼양식품: "003230", sk텔레콤: "017670", sk이노베이션: "096770", lg화학: "051910", 삼성sdi: "006400", 한국전력: "015760", 크래프톤: "259960", 알테오젠: "196170",
  hd현대중공업: "329180", 두산에너빌리티: "034020", 삼성물산: "028260", lg전자: "066570", 카카오뱅크: "323410", 하이브: "352820", 삼성생명: "032830", 메리츠금융지주: "138040",
  // KR ETFs
  "kodex 200": "069500", kodex200: "069500", 코덱스200: "069500", "tiger 미국s&p500": "360750", "tiger미국s&p500": "360750", "타이거미국s&p500": "360750",
  "tiger 미국나스닥100": "133690", tiger미국나스닥100: "133690", 타이거미국나스닥100: "133690", "kodex 국고채10년": "152380", kodex국고채10년: "152380",
};
