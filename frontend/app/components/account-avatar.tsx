"use client";

import { useMemo } from "react";

/**
 * 头像：有上传图就显示图，否则按地址生成稳定的双色渐变 + 昵称/地址首字符。
 * 同一地址永远得到同一个占位图形，便于在多账户间快速辨认。
 */
export function AccountAvatar({
  address,
  avatar,
  nickname,
  size = 36,
}: {
  address?: string;
  avatar?: string;
  nickname?: string;
  size?: number;
}) {
  const { from, to, initial } = useMemo(() => {
    const seed = (address ?? "0x").toLowerCase().replace(/^0x/, "");
    let hash = 0;
    for (let i = 0; i < seed.length; i += 1) hash = (hash * 31 + seed.charCodeAt(i)) % 360;
    const hue = hash;
    const label = nickname?.trim();
    return {
      from: `hsl(${hue} 72% 62%)`,
      to: `hsl(${(hue + 42) % 360} 74% 48%)`,
      initial: (label ? label[0] : (address ? address[2] : "?")).toUpperCase(),
    };
  }, [address, nickname]);

  if (avatar) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        className="account-avatar-image"
        src={avatar}
        alt=""
        width={size}
        height={size}
        style={{ width: size, height: size }}
      />
    );
  }

  return (
    <span
      className="account-avatar-fallback"
      aria-hidden="true"
      style={{
        width: size,
        height: size,
        fontSize: Math.max(11, Math.round(size * 0.42)),
        backgroundImage: `linear-gradient(140deg, ${from}, ${to})`,
      }}
    >
      {initial}
    </span>
  );
}
