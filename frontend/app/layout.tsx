import type { Metadata } from "next";
import Link from "next/link";
import { WalletStatus } from "./components/wallet-status";
import { Providers } from "./providers";
import "./globals.css";

export const metadata: Metadata = {
  title: "AgentTrust · 智能体互信协议",
  description: "为智能体间商务提供身份注册、交易担保与信誉裁决",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>
        <Providers>
          <header className="site-header">
            <div className="header-inner">
              <nav className="site-nav" aria-label="主导航">
                <Link href="/" className="brand">AgentTrust</Link>
                <div className="nav-links">
                  <Link href="/agents">智能体</Link>
                  <Link href="/trade">交易</Link>
                  <Link href="/disputes">争议</Link>
                  <Link href="/reputation">信誉</Link>
                </div>
              </nav>
              <WalletStatus />
            </div>
          </header>
          {children}
        </Providers>
      </body>
    </html>
  );
}
