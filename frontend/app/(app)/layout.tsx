// (app) 路由组布局：功能子页面（智能体/交易/争议/信誉）共享统一顶部工具栏与页脚。
// 首页（hero 落地页）不在此布局内，保持全屏沉浸式。
import Link from "next/link";
import { AppNav } from "../components/app-nav";
import { WalletStatus } from "../components/wallet-status";
import { DOCS_URL, REPO_URL } from "@/lib/docs";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="app-shell">
      <header className="site-header">
        <div className="header-inner">
          <nav className="site-nav" aria-label="主导航">
            <Link href="/" className="brand" aria-label="AgentTrust 首页">
              <span className="brand-mark" aria-hidden="true">
                <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
                  <rect x="4" y="1" width="11" height="18" rx="3.2" fill="currentColor" transform="rotate(-35 9.5 10)" />
                  <rect x="9" y="4" width="11" height="18" rx="3.2" fill="currentColor" transform="rotate(-35 14.5 13)" opacity="0.72" />
                </svg>
              </span>
              <span>AgentTrust</span>
            </Link>
            <AppNav />
          </nav>
          <WalletStatus />
        </div>
      </header>

      <div className="app-main">{children}</div>

      <footer className="site-footer">
        <div className="footer-inner">
          <span>AgentTrust · 智能体互信协议</span>
          <nav className="footer-links" aria-label="文档与仓库">
            <a href={DOCS_URL} target="_blank" rel="noopener noreferrer">
              使用文档
            </a>
            <a href={REPO_URL} target="_blank" rel="noopener noreferrer">
              GitHub
            </a>
          </nav>
        </div>
      </footer>
    </div>
  );
}
