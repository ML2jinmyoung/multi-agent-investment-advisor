import { createHash, createHmac, timingSafeEqual } from "node:crypto";

/**
 * Single-owner login for a personal deployment. `OWNER_PASSCODE` (server env) unlocks a fixed user id on any
 * device; the device keeps a signed cookie derived from the passcode, so changing the passcode signs every
 * device out while the owner's data (keyed by the fixed id) stays put. Without the env var this is all off.
 */
export const OWNER_USER_ID = "owner:main";
const MIN_PASSCODE = 8;

export const ownerEnabled = () => (process.env.OWNER_PASSCODE ?? "").length >= MIN_PASSCODE;

/** Cookie value for a signed-in device. */
export function ownerToken(): string {
  return createHmac("sha256", process.env.OWNER_PASSCODE ?? "").update("ai-pb-owner-v1").digest("base64url");
}

const same = (a: string, b: string) => {
  const x = createHash("sha256").update(a).digest();
  const y = createHash("sha256").update(b).digest();
  return timingSafeEqual(x, y);
};

export const isOwnerToken = (value: string | undefined) => !!value && ownerEnabled() && same(value, ownerToken());
export const checkPasscode = (input: string) => ownerEnabled() && same(input, process.env.OWNER_PASSCODE ?? "");

// ── brute-force limit (in memory: the app runs on one machine) ──
const WINDOW_MS = 15 * 60_000;
const PER_CLIENT = 5;
const OVERALL = 20;
const failures = new Map<string, number[]>();

function recent(key: string, now: number) {
  const list = (failures.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
  failures.set(key, list);
  return list;
}

/** False while this client, or everyone together, has too many recent wrong passcodes. */
export function loginAllowed(client: string, now = Date.now()): boolean {
  return recent(client, now).length < PER_CLIENT && recent("*", now).length < OVERALL;
}

export function recordFailure(client: string, now = Date.now()) {
  for (const key of [client, "*"]) failures.set(key, [...recent(key, now), now]);
}

export function resetLoginLimits() {
  failures.clear();
}

/** Client address as Fly's proxy reports it, falling back to the first forwarded hop. */
export function clientKey(req: Request): string {
  return req.headers.get("fly-client-ip") ?? req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
}
