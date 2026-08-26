"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useLocale } from "@/lib/locale";

export function AppNav() {
  const pathname = usePathname();
  const { dictionary: t } = useLocale();
  const items = [{ href: "/agents", label: t.common.agents }, { href: "/trade", label: t.common.trade }, { href: "/disputes", label: t.common.disputes }, { href: "/reputation", label: t.common.reputation }];
  return <div className="nav-links">{items.map(({ href, label }) => {
    const active = pathname === href;
    return <Link key={href} href={href} className={active ? "nav-link is-active" : "nav-link"} aria-current={active ? "page" : undefined}>{label}</Link>;
  })}</div>;
}
