import { cookies } from "next/headers";
import { OWNER_USER_ID, isOwnerToken } from "./owner-auth";
import { DEMO_USER_ID, OWNER_COOKIE, USER_SESSION_COOKIE, VALID_ID } from "./session-cookie";

export { DEMO_USER_ID, OWNER_COOKIE, USER_SESSION_COOKIE, VALID_ID };

function cookieValue(req: Request, name: string): string | undefined {
  const raw = req.headers.get("cookie")?.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`))?.[1];
  try { return raw && decodeURIComponent(raw); } catch { return undefined; }
}

/** The anonymous per-browser id, ignoring any owner login. */
export function anonymousIdFromRequest(req: Request): string {
  const value = cookieValue(req, USER_SESSION_COOKIE);
  return value && VALID_ID.test(value) ? value : DEMO_USER_ID;
}

/** Owner devices (valid passcode cookie) share the fixed owner id; everyone else keeps their anonymous id. */
export function userIdFromRequest(req: Request): string {
  return isOwnerToken(cookieValue(req, OWNER_COOKIE)) ? OWNER_USER_ID : anonymousIdFromRequest(req);
}

export async function currentUserId(): Promise<string> {
  const jar = await cookies();
  if (isOwnerToken(jar.get(OWNER_COOKIE)?.value)) return OWNER_USER_ID;
  const value = jar.get(USER_SESSION_COOKIE)?.value;
  return value && VALID_ID.test(value) ? value : DEMO_USER_ID;
}
