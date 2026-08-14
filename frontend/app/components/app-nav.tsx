"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV_ITEMS = [
  { href: "/agents", label: "智能体" },
  { href: "/trade", label: "交易" },
  { href: "/disputes", label: "争议" },
  { href: "/reputation", label: "信誉" },
] as const;

export function AppNav() {
  const pathname = usePathname();

  return (
    <div className="nav-links">
      {NAV_ITEMS.map(({ href, label }) => {
        const active = pathname === href;
        return (
          <Link
            key={href}
            href={href}
            className={active ? "nav-link is-active" : "nav-link"}
            aria-current={active ? "page" : undefined}
          >
            {label}
          </Link>
        );
      })}
    </div>
  );
}
