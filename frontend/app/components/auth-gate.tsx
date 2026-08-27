"use client";

import { useEffect } from "react";
import { canonicalLoginUrl, sanitizeReturnTo, useAuth } from "@/lib/auth";
import { useLocale } from "@/lib/locale";
import { WalletBindingGate } from "./wallet-binding-gate";

export function AuthGate({ children }: { children: React.ReactNode }) {
  const { state } = useAuth();
  const { dictionary: t } = useLocale();

  useEffect(() => {
    if (state !== "anonymous" && state !== "unavailable") return;
    const returnTo = sanitizeReturnTo(`${window.location.pathname}${window.location.search}`);
    const target = state === "unavailable"
      ? canonicalLoginUrl(returnTo)
      : `${window.location.origin}/login/?returnTo=${encodeURIComponent(returnTo)}`;
    window.location.replace(target);
  }, [state]);

  if (state !== "authenticated") {
    return <main className="auth-gate" aria-busy="true"><p>{state === "unavailable" ? t.auth.redirectingCanonical : t.auth.checking}</p></main>;
  }
  return <WalletBindingGate>{children}</WalletBindingGate>;
}
