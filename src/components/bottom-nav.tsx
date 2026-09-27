"use client";

import { Home, Sparkles, UserRound, Wallet } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const tabs = [
  { href: "/", label: "홈", icon: Home },
  { href: "/assets", label: "자산", icon: Wallet },
  { href: "/agent", label: "AI PB", icon: Sparkles },
  { href: "/policy", label: "원칙", icon: UserRound },
] as const;

export function BottomNav() {
  const pathname = usePathname();
  return (
    <nav className="fixed inset-x-0 bottom-0 z-50 border-t bg-background/95 backdrop-blur">
      <ul className="mx-auto flex max-w-md justify-around pb-[env(safe-area-inset-bottom)]">
        {tabs.map(({ href, label, icon: Icon }) => {
          const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
          return (
            <li key={href}>
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "relative flex min-h-14 min-w-16 flex-col items-center justify-center gap-0.5 px-3 text-xs transition-colors",
                  active ? "font-semibold text-brand" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {active && <span aria-hidden className="absolute inset-x-4 top-0 h-0.5 rounded-full bg-brand" />}
                <Icon className="size-5" strokeWidth={active ? 2.4 : 1.8} />
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
