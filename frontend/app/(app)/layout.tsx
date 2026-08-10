// (app) 路由组布局：功能子页面（智能体/交易/争议/信誉）共享统一导航。
// 首页 page.tsx（hero 落地页）不在此布局内，保持全屏沉浸式。
import Link from "next/link";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <nav className="app-nav">
        <Link href="/" className="app-nav-brand">
          Pactum
        </Link>
        <div className="app-nav-links">
          <Link href="/agents">智能体</Link>
          <Link href="/trade">交易</Link>
          <Link href="/disputes">争议</Link>
          <Link href="/reputation">信誉</Link>
        </div>
      </nav>
      <div className="app-body">{children}</div>
    </>
  );
}
