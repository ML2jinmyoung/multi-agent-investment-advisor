import type { Metadata, Viewport } from "next";
import { Geist_Mono, IBM_Plex_Sans_KR } from "next/font/google";
import { BottomNav } from "@/components/bottom-nav";
import { ServiceWorkerRegister } from "@/components/sw-register";
import { flag } from "@/lib/env";
import "./globals.css";

// Financial Trust pairing (ui-ux-pro-max): IBM Plex Sans, KR cut for Hangul
const plex = IBM_Plex_Sans_KR({ variable: "--font-plex", weight: ["400", "500", "600", "700"], subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "My AI PB",
  description: "Personal Investment Intelligence Agent",
  applicationName: "My AI PB",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, statusBarStyle: "default", title: "My AI PB" },
  icons: { icon: "/icons/icon-192.png", apple: "/icons/icon-192.png" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#f8fafc",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ko" className={`${plex.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">
        <main className="mx-auto w-full max-w-md flex-1 px-4 pt-4 pb-24">
          {flag("PUBLIC_DEMO_MODE") && (
            <p className="mb-4 text-center text-[11px] text-muted-foreground">공개 데모 · 예시 또는 직접 입력한 자산으로 분석하며 실제 계좌는 조회하지 않아요</p>
          )}
          {children}
        </main>
        <BottomNav />
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}
