// 全站氛围背景：满幅循环视频 + 渐变遮罩，fixed 铺满视口、纯装饰。
// home 用默认遮罩（上半部较亮让视频可见），表单页（agents/login）用 intense 遮罩保证文字对比度。
// 视频无 pointer-events、无字幕内容；prefers-reduced-motion 下隐藏视频只留渐变底。
export function AmbientBackground({ intense = false }: { intense?: boolean }) {
  return (
    <div className={`ambient-bg${intense ? " ambient-bg-intense" : ""}`} aria-hidden="true">
      <video autoPlay muted loop playsInline tabIndex={-1}>
        <source src={`${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/media/hero-loop.mp4`} type="video/mp4" />
      </video>
      <div className="ambient-scrim" />
    </div>
  );
}
