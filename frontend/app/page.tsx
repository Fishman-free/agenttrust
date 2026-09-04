"use client";

import { Activity, ArrowUpRight, BookOpen, Bot, Fingerprint, GraduationCap, MessageSquarePlus, Scale, ShieldCheck, Wallet } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { activeChain, WRITES_ENABLED } from "../lib/config";
import { docsUrl, mcpGuideUrl, tradingGuideUrl } from "../lib/docs";
import { formatMessage, useLocale } from "../lib/locale";
import { AmbientBackground } from "./components/ambient-background";
import { FeedbackSheet } from "./components/feedback-sheet";
import { LanguageSwitch } from "./components/language-switch";

function Logo() {
  return <span className="home-logo"><svg width="24" height="24" viewBox="0 0 22 22" fill="none" aria-hidden="true"><rect x="4" y="1" width="11" height="18" rx="3.2" fill="currentColor" transform="rotate(-35 9.5 10)" /><rect x="9" y="4" width="11" height="18" rx="3.2" fill="currentColor" transform="rotate(-35 14.5 13)" /></svg><span>AgentTrust</span></span>;
}

export default function Home() {
  const { locale, dictionary: t } = useLocale();
  const previewMode = !WRITES_ENABLED;
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const capabilities = [
    { href: "/agents", icon: Fingerprint, eyebrow: t.home.identityEyebrow, title: t.home.capabilityIdentity, description: t.home.capabilityIdentityDesc },
    { href: "/trade", icon: ShieldCheck, eyebrow: t.home.escrowEyebrow, title: t.home.capabilityEscrow, description: t.home.capabilityEscrowDesc },
    { href: "/disputes", icon: Scale, eyebrow: t.home.arbitrationEyebrow, title: t.home.capabilityArbitration, description: t.home.capabilityArbitrationDesc },
    { href: "/reputation", icon: Activity, eyebrow: t.home.reputationEyebrow, title: t.home.capabilityReputation, description: t.home.capabilityReputationDesc },
  ] as const;
  const documentationUrl = docsUrl(locale);
  const guideUrl = tradingGuideUrl(locale);
  // 首屏统计条只放链上可核验的真实常量，不做营销数字：
  // 押金 / 守护人数量 / 绑定层级 / 交易状态数全部来自合约与 deployments。
  const stats = [
    { value: "0.01 ETH", label: t.home.statDepositLabel },
    { value: "2-3", label: t.home.statGuardiansLabel },
    { value: "L1-L4", label: t.home.statLevelsLabel },
    { value: "10", label: t.home.statStatesLabel },
  ] as const;
  return <main className="home-main">
    {/* 全页氛围背景：视频 fixed 铺满整页（不只是首屏），下方内容直接压在视频+遮罩上 */}
    <AmbientBackground />
    <header className="home-header"><div className="home-container home-topbar">
      <Link href="/" className="home-logo-link" aria-label={t.common.agentTrustHome}><Logo /></Link>
      <nav className="home-nav" aria-label={t.common.primaryNav}><Link href="/agents">{t.common.agents}</Link><Link href="/trade">{t.common.trade}</Link><Link href="/disputes">{t.common.disputes}</Link><Link href="/reputation">{t.common.reputation}</Link><a href={documentationUrl} target="_blank" rel="noopener noreferrer">{t.common.usageDocs}</a></nav>
      <div className="home-account-actions"><LanguageSwitch /><button type="button" className="feedback-trigger" onClick={() => setFeedbackOpen(true)}><MessageSquarePlus size={15} aria-hidden="true" />{t.feedback.trigger}</button><Link href="/login/" className="home-login-link">{t.auth.login}</Link></div>
      <span className={`home-network-badge ${previewMode ? "is-preview" : "is-live"}`}><span className="home-status-dot" />{previewMode ? t.home.preview : activeChain.name}</span>
    </div></header>
    <FeedbackSheet open={feedbackOpen} onClose={() => setFeedbackOpen(false)} />
    {previewMode && <div className="home-preview" role="status"><div className="home-container home-preview-inner"><span>{t.home.preview}</span><p>{formatMessage(t.home.previewMessage, { chain: activeChain.name })}</p></div></div>}
    {/* 首屏：满屏 hero（标题 / 副标题 / CTA / 协议指标）。视频已在页面根部 fixed 铺满。 */}
    <section className="home-hero-stage" aria-labelledby="home-title">
      <div className="home-hero-inner">
        {/* 信任行：钱包 / 智能体 / 裁决三枚交叠圆环 + 对齐标识。纯装饰，图标不给文字名。 */}
        <div className="home-trust home-anim-d0" aria-hidden="true">
          <span className="home-trust-ring"><span><Wallet /></span></span>
          <span className="home-trust-ring"><span><Bot /></span></span>
          <span className="home-trust-ring"><span><Scale /></span></span>
          <span className="home-trust-pill">{t.home.trustPill}</span>
        </div>
        <h1 id="home-title" className="home-headline home-anim-d1">{t.home.title}</h1>
        <p className="home-lead-hero home-anim-d2">{t.home.lead}</p>
        <div className="home-actions home-anim-d3">
          <Link href="/agents" className="home-button home-button-primary">{t.home.explore}<ArrowUpRight size={17} aria-hidden="true" /></Link>
          <a href={guideUrl} target="_blank" rel="noopener noreferrer" className="home-button home-button-secondary"><GraduationCap size={17} aria-hidden="true" />{t.home.guideCta}</a>
          <a href={documentationUrl} target="_blank" rel="noopener noreferrer" className="home-button home-button-secondary"><BookOpen size={17} aria-hidden="true" />{t.home.readDocs}</a>
        </div>
        <dl className="home-stats home-anim-d4" aria-label={t.home.overview}>{stats.map(({ value, label }) => <div key={label}><dt>{value}</dt><dd>{label}</dd></div>)}</dl>
      </div>
    </section>
    <section className="home-capabilities" aria-labelledby="capabilities-title"><div className="home-container"><div className="home-section-heading"><div><span>{t.home.protocolModules}</span><h2 id="capabilities-title">{t.home.modulesTitle}</h2></div><p>{t.home.modulesHint}</p></div><div className="capability-grid">{capabilities.map(({ href, icon: Icon, eyebrow, title, description }) => <Link href={href} className="capability-card" key={href}><div className="capability-card-top"><span className="capability-icon"><Icon size={19} aria-hidden="true" /></span><ArrowUpRight className="capability-arrow" size={18} aria-hidden="true" /></div><span className="capability-eyebrow">{eyebrow}</span><h3>{title}</h3><p>{description}</p></Link>)}</div></div></section>
    {/* 新手教程区：两条行式链接（无卡片框），直达 GitHub 上的两份教程 */}
    <section className="home-guides" aria-labelledby="guides-title"><div className="home-container"><div className="home-section-heading"><div><span>{t.home.guidesEyebrow}</span><h2 id="guides-title">{t.home.guidesTitle}</h2></div></div><a className="guide-row" href={mcpGuideUrl(locale)} target="_blank" rel="noopener noreferrer"><span className="guide-icon"><BookOpen size={20} aria-hidden="true" /></span><span className="guide-copy"><h3>{t.home.guideMcpTitle}</h3><p>{t.home.guideMcpDesc}</p></span><ArrowUpRight className="guide-arrow" size={20} aria-hidden="true" /></a><a className="guide-row" href={tradingGuideUrl(locale)} target="_blank" rel="noopener noreferrer"><span className="guide-icon"><GraduationCap size={20} aria-hidden="true" /></span><span className="guide-copy"><h3>{t.home.guideTradingTitle}</h3><p>{t.home.guideTradingDesc}</p></span><ArrowUpRight className="guide-arrow" size={20} aria-hidden="true" /></a></div></section>
    <section className="home-story"><div className="home-container">
      <div className="story-heading"><span>{t.home.flowEyebrow}</span><h2>{t.home.flowTitle}</h2></div>
      <ol className="flow-list">{t.home.flowSteps.map((step, index) => <li key={step}><span>{String(index + 1).padStart(2, "0")}</span><strong>{step}</strong></li>)}</ol>
      <div className="story-grid"><article><span>{t.home.rolesEyebrow}</span><h2>{t.home.rolesTitle}</h2><ul>{t.home.roles.map((role) => <li key={role}>{role}</li>)}</ul></article><article><span>{t.home.levelsEyebrow}</span><h2>{t.home.levelsTitle}</h2><ul>{t.home.levels.map((level) => <li key={level}>{level}</li>)}</ul></article></div>
      <article className="recovery-panel"><span>{t.home.recoveryEyebrow}</span><h2>{t.home.recoveryTitle}</h2><p>{t.home.recoveryBody}</p></article>
      <aside className="testnet-warning" role="note"><ShieldCheck size={22} aria-hidden="true" /><div><strong>{t.home.testnetTitle}</strong><p>{t.home.testnetBody}</p></div></aside>
    </div></section>
  </main>;
}
