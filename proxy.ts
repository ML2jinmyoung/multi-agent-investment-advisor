import { NextResponse, type NextRequest } from "next/server";
import { USER_SESSION_COOKIE, VALID_ID } from "@/lib/user-session";

/** Anonymous POC tenant boundary. Replace the cookie value with the authenticated subject in production. */
export function proxy(req: NextRequest) {
  if (VALID_ID.test(req.cookies.get(USER_SESSION_COOKIE)?.value ?? "")) return NextResponse.next();
  const id = crypto.randomUUID();
  const headers = new Headers(req.headers);
  headers.set("cookie", [req.headers.get("cookie")?.split(";").filter((c) => !c.trim().startsWith(`${USER_SESSION_COOKIE}=`)).join(";"), `${USER_SESSION_COOKIE}=${id}`].filter(Boolean).join("; "));
  const res = NextResponse.next({ request: { headers } });
  res.cookies.set(USER_SESSION_COOKIE, id, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
  return res;
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
