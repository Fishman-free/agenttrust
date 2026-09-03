"use client";

import Link from "next/link";
import { LogOut, UserRound } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useLocale } from "@/lib/locale";

export function AuthStatus() {
  const { state, account, logout } = useAuth();
  const { dictionary: t } = useLocale();
  if (state === "loading") return <span className="auth-status is-muted">{t.auth.checking}</span>;
  if (state !== "authenticated") return <Link className="button button-primary" href="/login/">{t.auth.login}</Link>;
  return <section className="auth-status" aria-label={t.auth.status}>
    <span><UserRound size={14} aria-hidden="true" />{account?.identities.find((identity) => identity.email)?.email ?? account?.wallets[0]?.slice(0, 8) ?? t.auth.signedIn}</span>
    <button type="button" className="auth-signout" onClick={() => void logout()} aria-label={t.auth.logout}><LogOut size={14} aria-hidden="true" /></button>
  </section>;
}
