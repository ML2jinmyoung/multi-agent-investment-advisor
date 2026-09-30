/** Cookie names and id format, kept free of Node APIs so the proxy can import them. */
export const USER_SESSION_COOKIE = "pia_session";
export const OWNER_COOKIE = "pia_owner";
export const DEMO_USER_ID = "demo";

/** Anonymous session ids. The owner id contains ":" so a hand-set session cookie can never claim it. */
export const VALID_ID = /^[a-zA-Z0-9_-]{8,80}$/;
