// 官方文档与仓库入口的单一事实来源。
// 落地页、工作台页脚等所有"文档入口"都从这里取 URL，避免散落硬编码。
export const REPO_URL = "https://github.com/Fishman-free/multiagent";

export const DOCS_URL = `${REPO_URL}/blob/main/docs/USAGE.md`;
export const DOCS_ZH_CN_URL = `${REPO_URL}/blob/main/docs/USAGE.zh-CN.md`;

// 面向小白的操作教程（docs/guides/，与本仓库同库维护）。
// 中文版是主版本；英文版为同一份步骤的英文对照。
export const GUIDE_MCP_ZH_CN_URL = `${REPO_URL}/blob/main/docs/guides/mcp-a2a-endpoints.zh-CN.md`;
export const GUIDE_MCP_URL = `${REPO_URL}/blob/main/docs/guides/mcp-a2a-endpoints.md`;
export const GUIDE_TRADING_ZH_CN_URL = `${REPO_URL}/blob/main/docs/guides/trusted-trading.zh-CN.md`;
export const GUIDE_TRADING_URL = `${REPO_URL}/blob/main/docs/guides/trusted-trading.md`;

export function docsUrl(locale: "en" | "zh-CN"): string {
  return locale === "zh-CN" ? DOCS_ZH_CN_URL : DOCS_URL;
}

/** MCP/A2A 端点配置教程（注册智能体的用户大概率卡在"端点填什么"）。 */
export function mcpGuideUrl(locale: "en" | "zh-CN"): string {
  return locale === "zh-CN" ? GUIDE_MCP_ZH_CN_URL : GUIDE_MCP_URL;
}

/** 可信交易完整流程教程（给第一次来的用户一条从登录到结算的路径）。 */
export function tradingGuideUrl(locale: "en" | "zh-CN"): string {
  return locale === "zh-CN" ? GUIDE_TRADING_ZH_CN_URL : GUIDE_TRADING_URL;
}

export const README_URL = `${REPO_URL}#readme`;
