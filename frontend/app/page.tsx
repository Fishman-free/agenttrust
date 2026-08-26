"use client";

import { Activity, ArrowUpRight, BookOpen, Bot, Fingerprint, Scale, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { activeChain, WRITES_ENABLED } from "../lib/config";
import { docsUrl } from "../lib/docs";
import { formatMessage, useLocale } from "../lib/locale";
import { LanguageSwitch } from "./components/language-switch";

function Logo() {
  return <span className="home-logo"><svg width="24" height="24" viewBox="0 0 22 22" fill="none" aria-hidden="true"><rect x="4" y="1" width="11" height="18" rx="3.2" fill="currentColor" transform="rotate(-35 9.5 10)" /><rect x="9" y="4" width="11" height="18" rx="3.2" fill="currentColor" transform="rotate(-35 14.5 13)" /></svg><span>AgentTrust</span></span>;
}

function TrustNetwork({ labels, meta }: { labels: readonly [string, string, string, string]; meta: readonly [string, string, string] }) {
  return <div className="trust-visual" aria-hidden="true">
    <div className="trust-visual-meta"><span>{meta[0]}</span><span>{meta[1]}</span></div>
    <svg viewBox="0 0 560 330" preserveAspectRatio="xMidYMid meet"><g className="trust-lines"><path d="M280 165 108 74M280 165 452 74M280 165 108 256M280 165 452 256" /><path d="M108 74 452 74M108 256 452 256M108 74 108 256M452 74 452 256" /></g><g className="trust-nodes"><circle cx="108" cy="74" r="7" /><circle cx="452" cy="74" r="7" /><circle cx="108" cy="256" r="7" /><circle cx="452" cy="256" r="7" /><circle className="trust-core-ring" cx="280" cy="165" r="29" /><circle className="trust-core" cx="280" cy="165" r="11" /></g></svg>
    <span className="trust-label trust-label-identity">{labels[0]}</span><span className="trust-label trust-label-escrow">{labels[1]}</span><span className="trust-label trust-label-voting">{labels[2]}</span><span className="trust-label trust-label-reputation">{labels[3]}</span><span className="trust-core-label">{meta[2]}</span>
  </div>;
}

export default function Home() {
  const { locale, dictionary: t } = useLocale();
  const previewMode = !WRITES_ENABLED;
  const capabilities = [
    { href: "/agents", icon: Fingerprint, eyebrow: t.home.identityEyebrow, title: t.home.capabilityIdentity, description: t.home.capabilityIdentityDesc },
    { href: "/trade", icon: ShieldCheck, eyebrow: t.home.escrowEyebrow, title: t.home.capabilityEscrow, description: t.home.capabilityEscrowDesc },
    { href: "/disputes", icon: Scale, eyebrow: t.home.arbitrationEyebrow, title: t.home.capabilityArbitration, description: t.home.capabilityArbitrationDesc },
    { href: "/reputation", icon: Activity, eyebrow: t.home.reputationEyebrow, title: t.home.capabilityReputation, description: t.home.capabilityReputationDesc },
  ] as const;
  const documentationUrl = docsUrl(locale);
  return <main className="home-main">
    <header className="home-header"><div className="home-container home-topbar">
      <Link href="/" className="home-logo-link" aria-label={t.common.agentTrustHome}><Logo /></Link>
      <nav className="home-nav" aria-label={t.common.primaryNav}><Link href="/agents">{t.common.agents}</Link><Link href="/trade">{t.common.trade}</Link><Link href="/disputes">{t.common.disputes}</Link><Link href="/reputation">{t.common.reputation}</Link><a href={documentationUrl} target="_blank" rel="noopener noreferrer">{t.common.usageDocs}</a></nav>
      <LanguageSwitch />
      <span className={`home-network-badge ${previewMode ? "is-preview" : "is-live"}`}><span className="home-status-dot" />{previewMode ? t.home.preview : activeChain.name}</span>
    </div></header>
    {previewMode && <div className="home-preview" role="status"><div className="home-container home-preview-inner"><span>{t.home.preview}</span><p>{formatMessage(t.home.previewMessage, { chain: activeChain.name })}</p></div></div>}
    <section className="home-hero" aria-labelledby="home-title"><div className="home-container home-hero-grid"><div className="home-copy">
      <div className="home-eyebrow"><Bot size={16} aria-hidden="true" /><span>{t.home.protocolYear}</span></div>
      <h1 id="home-title">{t.home.title}</h1><p className="home-lead">{t.home.lead}</p>
      <div className="home-actions"><Link href="/agents" className="home-button home-button-primary">{t.home.explore}<ArrowUpRight size={17} aria-hidden="true" /></Link><Link href="/trade" className="home-button home-button-secondary">{t.home.viewTrade}</Link><a href={documentationUrl} target="_blank" rel="noopener noreferrer" className="home-button home-button-secondary"><BookOpen size={17} aria-hidden="true" />{t.home.readDocs}</a></div>
      <dl className="home-proof" aria-label={t.home.overview}><div><dt>4</dt><dd>{t.home.coreContracts}</dd></div><div><dt>10</dt><dd>{t.home.tradeStates}</dd></div><div><dt>100%</dt><dd>{t.home.verifiable}</dd></div></dl>
    </div><TrustNetwork labels={[t.home.graphIdentity, t.home.graphEscrow, t.home.graphVoting, t.home.graphReputation]} meta={[t.home.trustGraph, t.home.moduleCount, t.home.protocol]} /></div></section>
    <section className="home-capabilities" aria-labelledby="capabilities-title"><div className="home-container"><div className="home-section-heading"><div><span>{t.home.protocolModules}</span><h2 id="capabilities-title">{t.home.modulesTitle}</h2></div><p>{t.home.modulesHint}</p></div><div className="capability-grid">{capabilities.map(({ href, icon: Icon, eyebrow, title, description }) => <Link href={href} className="capability-card" key={href}><div className="capability-card-top"><span className="capability-icon"><Icon size={19} aria-hidden="true" /></span><ArrowUpRight className="capability-arrow" size={18} aria-hidden="true" /></div><span className="capability-eyebrow">{eyebrow}</span><h3>{title}</h3><p>{description}</p></Link>)}</div></div></section>
  </main>;
}
