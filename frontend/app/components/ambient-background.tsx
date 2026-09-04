// 全站氛围背景：一份满幅循环视频 + 渐变遮罩 + 噪点，fixed 铺满视口、纯装饰。
// home 用默认遮罩（上半部较亮让视频可见），表单页（agents/login）用 intense 遮罩保证文字对比度。
// 视频无 pointer-events、无字幕内容；prefers-reduced-motion 下隐藏视频只留渐变底。
//
// variant="echo"：把同一套氛围背景（品牌光晕 + 竖向渐变 + 细网格）用纯 CSS 复刻一份，
// 铺在落地页的各个区块里。整页只解码一份视频，其余区块靠复刻层保持背景质感，
// 否则深入页面的区块会退化成纯色底，也避免多路视频把低端机拖垮。
export function AmbientBackground({
  intense = false,
  variant = "video",
  tone = 1,
}: {
  intense?: boolean;
  variant?: "video" | "echo";
  tone?: 1 | 2 | 3 | 4;
}) {
  if (variant === "echo") {
    return <div className={`ambient-echo ambient-echo-${tone}`} aria-hidden="true" />;
  }

  return (
    <div className={`ambient-bg${intense ? " ambient-bg-intense" : ""}`} aria-hidden="true">
      <video autoPlay muted loop playsInline tabIndex={-1}>
        <source src={`${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/media/hero-loop.mp4`} type="video/mp4" />
      </video>
      <div className="ambient-scrim" />
      <div className="ambient-grain" />
    </div>
  );
}
