"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useAccount } from "wagmi";

/**
 * 账户资料（昵称 / 头像）保存在浏览器本地，按地址分组。
 * 这些字段纯属本地展示用的便捷信息，永远不上链、不同步。
 */

const STORAGE_KEY = "agenttrust.profiles";

export type ProfileRecord = {
  nickname?: string;
  avatar?: string;
  updatedAt: number;
};

type ProfileMap = Record<string, ProfileRecord>;

const MAX_AVATAR_BYTES = 4 * 1024 * 1024;
const AVATAR_EDGE = 256;
const JPEG_QUALITY = 0.82;

export type ProfileApi = {
  /** 已加载完成；在 hydration 之前为 false，避免服务端/客户端首帧不一致。 */
  ready: boolean;
  nickname: string;
  avatar?: string;
  setNickname: (value: string) => void;
  setAvatar: (value?: string) => void;
  /** 已在本浏览器命名的其它账户，用于「切换账户」列表。 */
  knownAccounts: string[];
  profileOf: (address?: string) => ProfileRecord | undefined;
};

const defaultApi: ProfileApi = {
  ready: false,
  nickname: "",
  avatar: undefined,
  setNickname: () => { },
  setAvatar: () => { },
  knownAccounts: [],
  profileOf: () => undefined,
};

const ProfileContext = createContext<ProfileApi>(defaultApi);

export function useProfile(): ProfileApi {
  return useContext(ProfileContext);
}

function read(): ProfileMap {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    return parsed as ProfileMap;
  } catch {
    return {};
  }
}

/** 把选中的图片压成 256px 的 JPEG data URL，避免 localStorage 被撑爆。 */
export async function fileToAvatar(file: File): Promise<string> {
  if (!file.type.startsWith("image/")) throw new Error("unsupported-type");
  if (file.size > MAX_AVATAR_BYTES) throw new Error("too-large");

  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("read-failed"));
    reader.readAsDataURL(file);
  });

  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const element = new Image();
    element.onload = () => resolve(element);
    element.onerror = () => reject(new Error("decode-failed"));
    element.src = dataUrl;
  });

  const canvas = document.createElement("canvas");
  canvas.width = AVATAR_EDGE;
  canvas.height = AVATAR_EDGE;
  const context = canvas.getContext("2d");
  if (!context) return dataUrl;

  const side = Math.min(image.width, image.height);
  context.drawImage(
    image,
    (image.width - side) / 2,
    (image.height - side) / 2,
    side,
    side,
    0,
    0,
    AVATAR_EDGE,
    AVATAR_EDGE,
  );
  return canvas.toDataURL("image/jpeg", JPEG_QUALITY);
}

export function ProfileProvider({ children }: { children: ReactNode }) {
  const { address } = useAccount();
  const [profiles, setProfiles] = useState<ProfileMap>({});
  const [ready, setReady] = useState(false);

  useEffect(() => {
    // localStorage 是外部数据源，只在 hydration 之后读取，保证首帧 HTML 与服务端一致。
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setProfiles(read());
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready || typeof window === "undefined") return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(profiles));
    } catch {
      // 容量超限时保留内存态即可，不清空用户已有数据。
    }
  }, [profiles, ready]);

  const key = address?.toLowerCase();
  const record = key ? profiles[key] : undefined;

  const patch = useCallback((next: Partial<ProfileRecord>) => {
    if (!key) return;
    setProfiles((current) => ({
      ...current,
      [key]: { ...current[key], ...next, updatedAt: Date.now() },
    }));
  }, [key]);

  const setNickname = useCallback((value: string) => patch({ nickname: value }), [patch]);
  const setAvatar = useCallback((value?: string) => patch({ avatar: value }), [patch]);

  const knownAccounts = useMemo(
    () => Object.keys(profiles).filter((entry) => Boolean(profiles[entry]?.nickname || profiles[entry]?.avatar)),
    [profiles],
  );

  const profileOf = useCallback((target?: string) => {
    if (!target) return undefined;
    return profiles[target.toLowerCase()];
  }, [profiles]);

  const value = useMemo<ProfileApi>(
    () => ({
      ready,
      nickname: record?.nickname ?? "",
      avatar: record?.avatar,
      setNickname,
      setAvatar,
      knownAccounts,
      profileOf,
    }),
    [ready, record?.nickname, record?.avatar, setNickname, setAvatar, knownAccounts, profileOf],
  );

  return <ProfileContext.Provider value={value}>{children}</ProfileContext.Provider>;
}
