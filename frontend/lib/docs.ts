// 官方文档与仓库入口的单一事实来源。
// 落地页、工作台页脚等所有"文档入口"都从这里取 URL，避免散落硬编码。
export const REPO_URL = "https://github.com/Fishman-free/multiagent";

export const DOCS_URL = `${REPO_URL}/blob/main/docs/USAGE.md`;
export const DOCS_ZH_CN_URL = `${REPO_URL}/blob/main/docs/USAGE.zh-CN.md`;

export function docsUrl(locale: "en" | "zh-CN"): string {
  return locale === "zh-CN" ? DOCS_ZH_CN_URL : DOCS_URL;
}

export const README_URL = `${REPO_URL}#readme`;
