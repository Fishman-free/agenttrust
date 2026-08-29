"use client";

import Link from "next/link";
import { AppNav } from "../components/app-nav";
import { AccountMenu } from "../components/account-menu";
import { LanguageSwitch } from "../components/language-switch";
import { docsUrl, REPO_URL } from "@/lib/docs";
import { useLocale } from "@/lib/locale";
import { AuthGate } from "../components/auth-gate";
import { AuthStatus } from "../components/auth-status";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { locale, dictionary: t } = useLocale();
  return <div className="app-shell">
    <header className="site-header"><div className="header-inner"><nav className="site-nav" aria-label={t.common.primaryNav}>
      <Link href="/" className="brand" aria-label={t.common.agentTrustHome}><span className="brand-mark" aria-hidden="true"><svg width="22" height="22" viewBox="0 0 22 22" fill="none"><rect x="4" y="1" width="11" height="18" rx="3.2" fill="currentColor" transform="rotate(-35 9.5 10)" /><rect x="9" y="4" width="11" height="18" rx="3.2" fill="currentColor" transform="rotate(-35 14.5 13)" opacity="0.72" /></svg></span><span>AgentTrust</span></Link><AppNav />
    </nav><div className="header-tools"><LanguageSwitch /><AuthStatus /><AccountMenu /></div></div></header>
    <div className="app-main"><AuthGate>{children}</AuthGate></div>
    <footer className="site-footer"><div className="footer-inner"><span>{t.app.footer}</span><nav className="footer-links" aria-label={t.common.docsAndRepo}><a href={docsUrl(locale)} target="_blank" rel="noopener noreferrer">{t.common.usageDocs}</a><a href={REPO_URL} target="_blank" rel="noopener noreferrer">GitHub</a></nav></div></footer>
  </div>;
}
