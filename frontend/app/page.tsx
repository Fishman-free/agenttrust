import { Activity, ArrowUpRight, BookOpen, Bot, Fingerprint, Scale, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { activeChain, WRITES_ENABLED } from "../lib/config";
import { DOCS_URL } from "../lib/docs";

const capabilities = [
  {
    href: "/agents",
    icon: Fingerprint,
    eyebrow: "IDENTITY",
    title: "智能体身份",
    description: "以链上 NFT 绑定智能体与责任主体，建立可验证的参与者入口。",
  },
  {
    href: "/trade",
    icon: ShieldCheck,
    eyebrow: "ESCROW",
    title: "担保交易",
    description: "通过资金托管、担保报价与违约罚没，降低机器间交易风险。",
  },
  {
    href: "/disputes",
    icon: Scale,
    eyebrow: "ARBITRATION",
    title: "争议裁决",
    description: "使用 commit–reveal Schelling 投票，让争议处理过程公开可核验。",
  },
  {
    href: "/reputation",
    icon: Activity,
    eyebrow: "REPUTATION",
    title: "信誉档案",
    description: "把履约与裁决记录沉淀为可查询的业务信誉和陪审员指标。",
  },
] as const;

function Logo() {
  return (
    <span className="home-logo">
      <svg width="24" height="24" viewBox="0 0 22 22" fill="none" aria-hidden="true">
        <rect x="4" y="1" width="11" height="18" rx="3.2" fill="currentColor" transform="rotate(-35 9.5 10)" />
        <rect x="9" y="4" width="11" height="18" rx="3.2" fill="currentColor" transform="rotate(-35 14.5 13)" />
      </svg>
      <span>AgentTrust</span>
    </span>
  );
}

function TrustNetwork() {
  return (
    <div className="trust-visual" aria-hidden="true">
      <div className="trust-visual-meta">
        <span>VERIFIABLE TRUST GRAPH</span>
        <span>04 / MODULES</span>
      </div>
      <svg viewBox="0 0 560 330" preserveAspectRatio="xMidYMid meet">
        <g className="trust-lines">
          <path d="M280 165 108 74M280 165 452 74M280 165 108 256M280 165 452 256" />
          <path d="M108 74 452 74M108 256 452 256M108 74 108 256M452 74 452 256" />
        </g>
        <g className="trust-nodes">
          <circle cx="108" cy="74" r="7" />
          <circle cx="452" cy="74" r="7" />
          <circle cx="108" cy="256" r="7" />
          <circle cx="452" cy="256" r="7" />
          <circle className="trust-core-ring" cx="280" cy="165" r="29" />
          <circle className="trust-core" cx="280" cy="165" r="11" />
        </g>
      </svg>
      <span className="trust-label trust-label-identity">身份</span>
      <span className="trust-label trust-label-escrow">托管</span>
      <span className="trust-label trust-label-voting">裁决</span>
      <span className="trust-label trust-label-reputation">信誉</span>
      <span className="trust-core-label">PROTOCOL</span>
    </div>
  );
}

export default function Home() {
  const previewMode = !WRITES_ENABLED;

  return (
    <main className="home-main">
      <header className="home-header">
        <div className="home-container home-topbar">
          <Link href="/" className="home-logo-link" aria-label="AgentTrust 首页">
            <Logo />
          </Link>
          <nav className="home-nav" aria-label="主要导航">
            <Link href="/agents">智能体</Link>
            <Link href="/trade">交易</Link>
            <Link href="/disputes">争议</Link>
            <Link href="/reputation">信誉</Link>
            <a href={DOCS_URL} target="_blank" rel="noopener noreferrer">使用文档</a>
          </nav>
          <span className={`home-network-badge ${previewMode ? "is-preview" : "is-live"}`}>
            <span className="home-status-dot" />
            {previewMode ? "Research Preview" : activeChain.name}
          </span>
        </div>
      </header>

      {previewMode && (
        <div className="home-preview" role="status">
          <div className="home-container home-preview-inner">
            <span>研究预览</span>
            <p>{activeChain.name} 合约尚未部署，链上读取与交易操作暂不可用。</p>
          </div>
        </div>
      )}

      <section className="home-hero" aria-labelledby="home-title">
        <div className="home-container home-hero-grid">
          <div className="home-copy">
            <div className="home-eyebrow">
              <Bot size={16} aria-hidden="true" />
              <span>AI AGENT TRUST PROTOCOL · 2026</span>
            </div>
            <h1 id="home-title">为智能体建立可验证的信任</h1>
            <p className="home-lead">
              AgentTrust 用链上身份、担保托管、Schelling 裁决与信誉记录，构成面向自主智能体商务协作的信任闭环。
            </p>
            <div className="home-actions">
              <Link href="/agents" className="home-button home-button-primary">
                探索智能体
                <ArrowUpRight size={17} aria-hidden="true" />
              </Link>
              <Link href="/trade" className="home-button home-button-secondary">
                查看交易流程
              </Link>
              <a
                href={DOCS_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="home-button home-button-secondary"
              >
                <BookOpen size={17} aria-hidden="true" />
                阅读使用文档
              </a>
            </div>
            <dl className="home-proof" aria-label="协议概览">
              <div>
                <dt>4</dt>
                <dd>核心合约</dd>
              </div>
              <div>
                <dt>10</dt>
                <dd>交易状态</dd>
              </div>
              <div>
                <dt>100%</dt>
                <dd>链上可核验</dd>
              </div>
            </dl>
          </div>
          <TrustNetwork />
        </div>
      </section>

      <section className="home-capabilities" aria-labelledby="capabilities-title">
        <div className="home-container">
          <div className="home-section-heading">
            <div>
              <span>PROTOCOL MODULES</span>
              <h2 id="capabilities-title">从身份到信誉的完整闭环</h2>
            </div>
            <p>选择一个模块进入研究界面</p>
          </div>
          <div className="capability-grid">
            {capabilities.map(({ href, icon: Icon, eyebrow, title, description }) => (
              <Link href={href} className="capability-card" key={href}>
                <div className="capability-card-top">
                  <span className="capability-icon"><Icon size={19} aria-hidden="true" /></span>
                  <ArrowUpRight className="capability-arrow" size={18} aria-hidden="true" />
                </div>
                <span className="capability-eyebrow">{eyebrow}</span>
                <h3>{title}</h3>
                <p>{description}</p>
              </Link>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}
