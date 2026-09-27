"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Re-fetches server data every 60s while the tab is visible. Renders nothing; pages show their own "as of" line. */
export function MarketRefresh() {
  const router = useRouter();
  useEffect(() => {
    const timer = setInterval(() => { if (document.visibilityState === "visible") router.refresh(); }, 60_000);
    return () => clearInterval(timer);
  }, [router]);
  return null;
}
