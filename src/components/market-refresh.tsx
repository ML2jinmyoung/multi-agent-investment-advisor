"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
export function MarketRefresh() {
  const router = useRouter();
  useEffect(() => {
    const timer = setInterval(() => { if (document.visibilityState === "visible") router.refresh(); }, 60_000);
    return () => clearInterval(timer);
  }, [router]);
  return <p className="text-xs text-muted-foreground">60초마다 갱신 · 거래소 지연 및 휴장 시 마지막 제공 시세 기준</p>;
}
