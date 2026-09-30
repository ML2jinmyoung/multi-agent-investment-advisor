import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DELETE, GET, POST } from "../../app/api/owner/route";
import { OWNER_USER_ID, resetLoginLimits } from "@/lib/owner-auth";
import { userIdFromRequest } from "@/lib/user-session";
import { getLedger, resetLedger, saveLedger } from "@/services/ledger-store";

const PASS = "correct-horse-battery";
beforeEach(() => { vi.stubEnv("OWNER_PASSCODE", PASS); resetLoginLimits(); });
afterEach(async () => { vi.unstubAllEnvs(); await resetLedger(OWNER_USER_ID); });

const login = (anon: string, passcode: string, ip = "1.2.3.4") =>
  POST(new Request("http://localhost/api/owner", { method: "POST", headers: { cookie: `pia_session=${anon}`, "fly-client-ip": ip, "Content-Type": "application/json" }, body: JSON.stringify({ passcode }) }));
const ownerCookie = (res: Response) => res.headers.get("set-cookie")!.split(";")[0];
const as = (cookie: string) => new Request("http://localhost/", { headers: { cookie } });

describe("owner login", () => {
  it("gives every signed-in device the same fixed id and carries over this browser's ledger", async () => {
    const phone = randomUUID(), laptop = randomUUID();
    await saveLedger(phone, { accounts: [{ broker: "삼성증권", name: "", type: "brokerage", cashKRW: 0, cashUSD: 0, holdings: [{ symbol: "NVDA", quantity: 3 }] }] });
    const res = await login(phone, PASS);
    expect(res.status).toBe(200);
    expect((await res.json()).adopted).toBe(true);
    const cookie = ownerCookie(res);
    expect(res.headers.get("set-cookie")).toMatch(/HttpOnly/);
    expect(userIdFromRequest(as(`pia_session=${laptop}; ${cookie}`))).toBe(OWNER_USER_ID);
    expect((await getLedger(OWNER_USER_ID))[0].holdings[0].quantity).toBe(3);
    expect(await getLedger(phone)).toEqual([]);
    expect((await (await GET(as(cookie))).json()).owner).toBe(true);
    // a second device logging in does not replace the owner's ledger
    expect((await (await login(laptop, PASS)).json()).adopted).toBe(false);
    expect((await DELETE(as(cookie))).headers.get("set-cookie")).toMatch(/Max-Age=0/);
  });

  it("cannot be claimed without the passcode", async () => {
    const anon = randomUUID();
    expect((await login(anon, "wrong-pass")).status).toBe(401);
    expect(userIdFromRequest(as(`pia_session=${OWNER_USER_ID}`))).toBe("demo");
    expect(userIdFromRequest(as(`pia_session=${anon}; pia_owner=forged`))).toBe(anon);
    const cookie = ownerCookie(await login(anon, PASS));
    vi.stubEnv("OWNER_PASSCODE", "a-new-passcode-123"); // rotating the passcode signs every device out
    expect(userIdFromRequest(as(cookie))).toBe("demo");
    vi.stubEnv("OWNER_PASSCODE", "");
    expect((await login(anon, "")).status).toBe(404);
  });

  it("locks a client out after five wrong passcodes", async () => {
    for (let i = 0; i < 5; i++) expect((await login(randomUUID(), "nope", "9.9.9.9")).status).toBe(401);
    expect((await login(randomUUID(), PASS, "9.9.9.9")).status).toBe(429);
    expect((await login(randomUUID(), PASS, "8.8.8.8")).status).toBe(200);
  });
});
