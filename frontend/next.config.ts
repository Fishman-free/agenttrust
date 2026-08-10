import type { NextConfig } from "next";

// 静态导出：next build 生成 out/（GitHub Pages 等任意静态托管可部署）。
// basePath：GitHub Pages 常见子路径部署（https://<user>.github.io/<repo>/），
// 不设置会导致 /_next 静态资源 404。通过 NEXT_PUBLIC_BASE_PATH 注入（如 /multiagent），
// 本地开发默认不设（空），不影响 http://localhost:3000。
const basePath = process.env.NEXT_PUBLIC_BASE_PATH;

const nextConfig: NextConfig = {
  output: "export",
  // 每个路由输出为 /route/index.html，静态服务器无需为深链配置 .html 重写。
  trailingSlash: true,
  ...(basePath ? { basePath } : {}),
};

export default nextConfig;
