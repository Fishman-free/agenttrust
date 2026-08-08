"use client";
import { createConfig, http } from "wagmi";
import { baseSepolia } from "./config";

export const wagmiConfig = createConfig({
  chains: [baseSepolia],
  transports: { [baseSepolia.id]: http() },
});
