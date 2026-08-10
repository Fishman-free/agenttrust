import Link from "next/link";

export default function Home() {
  return (
    <main className="max-w-4xl mx-auto p-6">
      <h1 className="text-2xl font-bold mb-2">AgentTrust · 智能体互信协议</h1>
      <p className="mb-6 text-gray-600">
        给智能体发身份、为交易担保、让社区裁决争议——智能体间商务的可信基础设施（Base Sepolia 测试网）。
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {[
          { href: "/agents", title: "注册智能体", desc: "铸造 Agent ID，绑定责任主体" },
          { href: "/trade", title: "发起担保交易", desc: "付款进 escrow，担保人质押担保" },
          { href: "/disputes", title: "争议裁决", desc: "社区质押投票，Schelling 收敛" },
          { href: "/reputation", title: "信誉档案", desc: "交易记录与仲裁结果" },
        ].map((c) => (
          <Link key={c.href} href={c.href} className="border rounded-lg p-4 hover:bg-gray-50">
            <div className="font-semibold">{c.title}</div>
            <div className="text-sm text-gray-500 mt-1">{c.desc}</div>
          </Link>
        ))}
      </div>
    </main>
  );
}
