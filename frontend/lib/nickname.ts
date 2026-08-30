"use client";

/**
 * 账户昵称：按钱包地址存放在本浏览器的展示名。
 * 纯前端偏好，不上传、不上链；换浏览器或清缓存即失效。
 */

import { useCallback, useEffect, useState } from "react";

export const NICKNAME_KEY = "agenttrust.nicknames";
export const NICKNAME_MAX = 24;

type NicknameMap = Record<string, string>;

function readAll(): NicknameMap {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(NICKNAME_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
    const result: NicknameMap = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === "string" && value.trim()) result[key.toLowerCase()] = value.slice(0, NICKNAME_MAX);
    }
    return result;
  } catch {
    return {};
  }
}

function writeAll(map: NicknameMap): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(NICKNAME_KEY, JSON.stringify(map));
  } catch {
    // 写入失败只影响展示名。
  }
}

export function readNickname(address?: string): string | undefined {
  if (!address) return undefined;
  return readAll()[address.toLowerCase()];
}

export function useNickname(address?: string) {
  const key = address?.toLowerCase();
  const [nickname, setNickname] = useState<string>();

  // localStorage 是外部数据源，只能在挂载后读取，否则与 SSR 输出不一致。
  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect */
    setNickname(key ? readAll()[key] : undefined);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [key]);

  const save = useCallback(
    (value: string) => {
      if (!key) return;
      const trimmed = value.trim().slice(0, NICKNAME_MAX);
      const map = readAll();
      if (trimmed) map[key] = trimmed;
      else delete map[key];
      writeAll(map);
      setNickname(trimmed || undefined);
    },
    [key],
  );

  return { nickname, save };
}
