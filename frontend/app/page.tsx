// AgentTrust · 智能体互信协议 — 首页 hero 落地页
// 极简黑白 + 全屏信任网络背景（SVG），motion 入场动画
"use client";

import Link from "next/link";
import { motion } from "motion/react";
import { Plus, LayoutGrid } from "lucide-react";

const EASE = [0.16, 1, 0.3, 1] as const;

// 品牌标识：两个 -35° 倾斜圆角矩形 + 品牌名
function Logo() {
  return (
    <div className="nav-logo">
      <svg width="22" height="22" viewBox="0 0 22 22" fill="none" aria-hidden>
        <rect x="4" y="1" width="11" height="18" rx="3.2" fill="currentColor" transform="rotate(-35 9.5 10)" />
        <rect x="9" y="4" width="11" height="18" rx="3.2" fill="currentColor" transform="rotate(-35 14.5 13)" />
      </svg>
      <span className="nav-brand">AgentTrust</span>
    </div>
  );
}

export default function Home() {
  return (
    <main className="hero">
      {/* 固定导航 */}
      <motion.nav
        className="hero-nav"
        initial={{ y: -16, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.8, ease: EASE }}
      >
        <div className="nav-left">
          <Link href="/" className="hero-logo-link">
            <Logo />
          </Link>
          <button className="nav-menu" aria-label="打开菜单">
            <span className="nav-menu-icon">
              <Plus size={12} strokeWidth={3} />
            </span>
            菜单
          </button>
          <div className="nav-tags">
            <span>AI 智能体</span>
            <span>区块链信任</span>
          </div>
        </div>
        <div className="nav-right">
          <div className="nav-pill">
            <button className="nav-grid-btn" aria-label="网格视图">
              <LayoutGrid size={15} strokeWidth={1.6} />
            </button>
            <span>可信网络</span>
          </div>
        </div>
      </motion.nav>

      {/* 全屏信任网络背景 */}
      <motion.div
        className="hero-network"
        aria-hidden
        initial={{ opacity: 0, scale: 1.05 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 1.8, ease: EASE }}
      >
        <svg viewBox="0 0 1600 900" preserveAspectRatio="xMidYMid slice">
          <g stroke="rgba(0,0,0,0.07)" strokeWidth="1">
            <line x1="800" y1="300" x2="270" y2="620" />
            <line x1="800" y1="300" x2="1330" y2="620" />
            <line x1="800" y1="300" x2="600" y2="640" />
            <line x1="800" y1="300" x2="1000" y2="640" />
            <line x1="270" y1="620" x2="600" y2="640" />
            <line x1="1330" y1="620" x2="1000" y2="640" />
            <line x1="600" y1="640" x2="1000" y2="640" />
            <line x1="270" y1="620" x2="120" y2="740" />
            <line x1="1330" y1="620" x2="1480" y2="740" />
            <line x1="120" y1="740" x2="1480" y2="740" />
          </g>
          <g fill="#000">
            <circle cx="800" cy="300" r="7" />
            <circle cx="270" cy="620" r="4" />
            <circle cx="1330" cy="620" r="4" />
            <circle cx="600" cy="640" r="3" />
            <circle cx="1000" cy="640" r="3" />
            <circle cx="120" cy="740" r="3" />
            <circle cx="1480" cy="740" r="3" />
          </g>
        </svg>
      </motion.div>

      {/* 底部内容（白色渐变浮起） */}
      <motion.div
        className="hero-footer"
        initial={{ y: 20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 1, delay: 0.5, ease: EASE }}
      >
        <div className="footer-left">
          <motion.div
            className="footer-subtitle"
            initial={{ y: 16, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ duration: 0.8, delay: 0.6, ease: EASE }}
          >
            <span className="footer-dot" />
            <span>AI 智能体互信协议 · 2026</span>
          </motion.div>

          <motion.h1
            className="footer-heading"
            initial={{ y: 20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ duration: 0.8, delay: 0.8, ease: EASE }}
          >
            为智能体建立
            <br />
            可验证的信任
          </motion.h1>

          <motion.div
            className="footer-actions"
            initial={{ y: 16, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ duration: 0.8, delay: 1.0, ease: EASE }}
          >
            <Link href="/agents" className="btn-primary">
              进入社区
            </Link>
            <Link href="/trade" className="btn-ghost">
              发起担保交易
            </Link>
          </motion.div>
        </div>

        <motion.div
          className="footer-right"
          initial={{ y: 16, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ duration: 0.8, delay: 1.1, ease: EASE }}
        >
          <span className="footer-tag">身份 NFT</span>
          <span className="footer-tag">担保托管</span>
          <span className="footer-tag">Schelling 裁决</span>
          <span className="footer-tag">信誉定价</span>
        </motion.div>
      </motion.div>
    </main>
  );
}
