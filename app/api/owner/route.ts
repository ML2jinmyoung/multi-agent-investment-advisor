import { z } from "zod";
import { OWNER_USER_ID, checkPasscode, clientKey, loginAllowed, ownerEnabled, ownerToken, recordFailure } from "@/lib/owner-auth";
import { OWNER_COOKIE, anonymousIdFromRequest, userIdFromRequest } from "@/lib/user-session";
import { readJson } from "@/lib/write-guard";
import { adoptLedger } from "@/services/ledger-store";

export const dynamic = "force-dynamic";

const YEAR = 60 * 60 * 24 * 365;
const sameSite = (req: Request) => {
  const origin = req.headers.get("origin");
  return !origin || origin === (process.env.PUBLIC_APP_ORIGIN ?? new URL(req.url).origin);
};
const cookie = (value: string, maxAge: number) =>
  `${OWNER_COOKIE}=${value}; Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=Lax${process.env.NODE_ENV === "production" ? "; Secure" : ""}`;

/** Whether owner login is configured and whether this device is signed in. */
export async function GET(req: Request) {
  return Response.json({ enabled: ownerEnabled(), owner: userIdFromRequest(req) === OWNER_USER_ID }, { headers: { "Cache-Control": "no-store" } });
}

const Body = z.object({ passcode: z.string().min(1).max(200) }).strict();

/** Sign this device in with the owner passcode. */
export async function POST(req: Request) {
  if (!sameSite(req)) return Response.json({ error: "같은 사이트에서 요청하세요." }, { status: 403 });
  if (!ownerEnabled()) return Response.json({ error: "소유자 로그인이 설정되지 않았습니다." }, { status: 404 });
  const client = clientKey(req);
  if (!loginAllowed(client)) return Response.json({ error: "시도가 너무 많습니다. 15분 뒤에 다시 해 주세요." }, { status: 429 });
  const body = await readJson(req, 1_000);
  if ("error" in body) return body.error;
  const parsed = Body.safeParse(body.json);
  if (!parsed.success || !checkPasscode(parsed.data.passcode)) {
    recordFailure(client);
    return Response.json({ error: "비밀번호가 맞지 않습니다." }, { status: 401 });
  }
  const adopted = await adoptLedger(anonymousIdFromRequest(req), OWNER_USER_ID);
  return Response.json({ ok: true, adopted }, { headers: { "Set-Cookie": cookie(ownerToken(), YEAR) } });
}

/** Sign this device out; it goes back to its anonymous session. */
export async function DELETE(req: Request) {
  if (!sameSite(req)) return Response.json({ error: "같은 사이트에서 요청하세요." }, { status: 403 });
  return Response.json({ ok: true }, { headers: { "Set-Cookie": cookie("", 0) } });
}
