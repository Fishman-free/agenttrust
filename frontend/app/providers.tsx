"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { WagmiProvider } from "wagmi";
import { wagmiConfig } from "@/lib/wagmi";
import { LocaleProvider } from "@/lib/locale";
import { AuthProvider } from "@/lib/auth";
import { TxHistoryProvider } from "@/lib/tx-history";

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());
  return (
    <LocaleProvider>
      {/* reconnectOnMount：上次已成功连接的钱包，下次打开页面直接静默恢复，无需再点一次连接。 */}
      <WagmiProvider config={wagmiConfig} reconnectOnMount>
        <QueryClientProvider client={queryClient}>
          <TxHistoryProvider>
            <AuthProvider>{children}</AuthProvider>
          </TxHistoryProvider>
        </QueryClientProvider>
      </WagmiProvider>
    </LocaleProvider>
  );
}
