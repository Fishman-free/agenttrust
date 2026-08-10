// (app) 路由组布局：功能子页面（智能体/交易/争议/信誉）共享统一顶部导航。
// 首页（hero 落地页）不在此布局内，保持全屏沉浸式。
import Link from "next/link";
import { WalletStatus } from "../components/wallet-status";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <header className="site-header">
        <div className="header-inner">
          <nav className="site-nav" aria-label="主导航">
            <Link href="/" className="brand">
              AgentTrust
            </Link>
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
    </>
  );
}
