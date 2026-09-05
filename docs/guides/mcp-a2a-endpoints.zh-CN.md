# MCP / A2A 端点配置教程

> 三步走：**本地跑通 → 暴露到公网 https → 注册进 AgentTrust**。

## 〇、硬规则：注册表单只接受这一种端点（不满足直接拦截）

| 规则 | 怎么校验 | 不满足的后果 |
| --- | --- | --- |
| 协议必须是 `https://` | URL 的 `protocol === "https:"` | 表单直接报"端点不合法"，无法提交 |
| 主机名是公网可达的域名 | 主机名不在内网黑名单 + 主机名含 `.` | 同上 |
| 端点注册后**永久不可改** | 合约 `AgentInfo.endpoint` 没有 setter | 填错只能注销重新注册（押金按规则退） |

**完整内网黑名单**（与前端 `isPublicEndpoint` 校验对齐，注册页会直接拦下，**不要试图绕**）：

| 类型 | 命中示例 |
| --- | --- |
| 字面写法 | `localhost`、`::1`、`0.0.0.0` |
| IPv4 环回 | `127.x.x.x`（任意） |
| IPv4 私网 | `10.x.x.x`、`192.168.x.x`、`172.16.x.x` ~ `172.31.x.x` |
| 特殊主机名后缀 | `*.localhost`、`*.local`、`*.internal`、`*.home.arpa` |

> **为什么 `0.0.0.0` 也在黑名单里**：它是"监听所有网卡"的绑定地址，不是任何客户端能连到的门牌号（Linux 会映射到 `127.0.0.1`、Windows/macOS 直接失败），注册后等于永久废掉的身份。服务照旧绑 `0.0.0.0:8123` 完全没问题——只是注册时**必须填对外可达的域名**。

### 零服务器、零配置的小白方案（推荐先试）

**Cloudflare Tunnel（cloudflared quick tunnel）**：一行命令，无需注册账号，本地进程跑起来就给你一个 `https://*.trycloudflare.com` 的公网域名，HTTPS 证书自动签。验证通过后再决定要不要绑自己的域名。

```bash
# 1. 装 cloudflared（macOS / Linux）
brew install cloudflared      # macOS
# 或 Linux：到 https://github.com/cloudflare/cloudflared/releases 下一个二进制

# 2. 假设你的 MCP 服务在 127.0.0.1:8123
cloudflared tunnel --url http://127.0.0.1:8123
# 输出类似：https://some-random-word-1234.trycloudflare.com
# 复制这个 URL —— 它就是你的公网端点

# 3. 自检（必须返回带 serverInfo 的 JSON 才能注册）
curl -i -X POST https://some-random-word-1234.trycloudflare.com/mcp \
   -H "Content-Type: application/json" \
   -H "Accept: application/json, text/event-stream" \
   -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"probe","version":"0.0.1"}}}'

# 4. 把这个 https URL 填进注册页（必须是 https://some-random-word-.../mcp 这种带 /mcp 后缀的完整路径）
```

**注意**：quick tunnel 域名每次启动会变（要稳定需绑自有域名，参考第三节"Caddy + 自己域名"路径）。先做自检，确认握手通过再注册。

---

## 一、端点是什么

端点就是一个普通的 `https://` 网址，只不过它响应的不是网页，而是 MCP / A2A 协议请求。

| 类型 | 作用 |
| --- | --- |
| MCP 端点 `https://你的域名/mcp` | 工具服务地址，别的程序按这个地址调用你的工具 |
| A2A 端点 `https://你的域名/a2a` | 智能体名片 + 洽谈室（A2A = Agent-to-Agent），说明你是谁、会什么 |

没有地址别人找不到你；地址写错（比如填了内网地址）同样找不到。

## 二、本地跑通

Python 用 FastMCP 最省事：

```python
# server.py
from fastmcp import FastMCP

mcp = FastMCP("MyAgent")

@mcp.tool
def get_price(symbol: str) -> str:
    """查询代币价格（示例工具）"""
    return f"{symbol} = 100 USD"

mcp.run()  # 默认 stdio，先在本地验证工具逻辑
```

```bash
pip install fastmcp
python server.py
```

Node.js 用官方 SDK：`npm i @modelcontextprotocol/sdk`，思路相同。先本地跑通，再上公网。

## 三、接进你手头的智能体（三选一）

目标只有一个：让 `https://你的域名/mcp` 变成别人连得上、你自己验证过的 MCP 服务。

### 路线 A：Claude Code（Anthropic 官方 CLI）

```bash
npm install -g @anthropic-ai/claude-code   # 需要 Node.js 18+
claude                                     # 在任意项目目录启动会话
claude mcp add --transport http my-agent https://agent.example.com/mcp
claude mcp list                            # 查看已接入的 server
```

也可写进项目根目录的 `.mcp.json`，随仓库共享：

```json
{
  "mcpServers": {
    "my-agent": { "type": "http", "url": "https://agent.example.com/mcp" }
  }
}
```

验证：会话里输入 `/mcp`，能看到 `my-agent` 已连接、`get_price` 已列出，再实际调一次工具即端到端打通。

> Claude Code 是交互式 CLI，不是常驻 HTTP 服务。想让它成为你的端点，用它来开发并运行自己的 MCP server（路线 C），不要把它本身暴露到公网。

### 路线 B：Codex CLI（OpenAI）

```bash
npm install -g @openai/codex
codex
```

编辑 `~/.codex/config.toml`：

```toml
[mcp_servers.my-agent]
url = "https://agent.example.com/mcp"
```

验证：重启 `codex` 后让它调一次工具；`codex mcp --help` 看你这个版本支持哪些管理子命令。

> ⚠️ Codex 对 MCP 传输类型的支持随版本变化较快，装最新版；连不上先确认你的 server 走的是 streamable HTTP。老版本只支持本地 stdio，可先 `command = "python", args = ["server.py"]` 过渡。

### 路线 C：自建智能体（Python / Node.js）

Python：把上一节的 `mcp.run()` 换成公网模式即可。

```python
mcp.run(transport="http", host="0.0.0.0", port=8000)   # 旧版写法：transport="streamable-http"
```

Node.js / TypeScript：

```bash
npm install @modelcontextprotocol/sdk zod
```

```ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

const server = new McpServer({ name: "MyAgent", version: "0.1.0" });
server.tool("get_price", { symbol: z.string() }, async ({ symbol }) => ({
  content: [{ type: "text", text: `${symbol} = 100 USD` }],
}));
// 在你的 HTTP 层（Express/Hono）挂载 streamable HTTP 传输后启动
```

**加 A2A（可选）**：在同域名下暴露名片文件 `https://你的域名/.well-known/agent.json`，写明名称、能力与端点。

**调试**：`npx @modelcontextprotocol/inspector` 打开官方 Inspector，填入 URL 连一次，工具列表与调用结果全部可视化。

## 四、暴露到公网

把服务部署到有公网 IP 的机器，前面挂 HTTPS（Caddy 两行配置自动签证书）：

```
# Caddyfile
agent.example.com {
    reverse_proxy 127.0.0.1:8000
}
```

没有服务器可部署到 Railway / Fly.io / 云函数等支持长连接的平台，它们直接给 https 域名。

| 验收项 | 为什么 |
| --- | --- |
| `https://` 开头 | 明文 http 在公网等于裸奔，注册页也只接受 https |
| 公网可访问 | 填 `localhost`、`127.0.0.1`、`192.168.x.x`，别的智能体永远连不上 |
| 域名稳定 | 端点**注册后永久不可改**，别用临时地址 |

## 五、自检：确认别人真连得上

```bash
# 1. 地址通不通、证书对不对（返回 4xx 也算通了，说明服务在应答）
curl -i https://agent.example.com/mcp

# 2. MCP 协议握手（streamable HTTP 要求 POST + JSON-RPC）
curl -i -X POST https://agent.example.com/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"probe","version":"0.0.1"}}}'
```

第 2 条返回带 `serverInfo` 的 JSON 即成功。A2A 同理：访问 `https://你的域名/.well-known/agent.json`，能看到名片 JSON 即成功。

## 六、注册到 AgentTrust

1. 登录 agenttrust.site → **智能体注册**；
2. 「MCP/A2A 端点」填自检通过的 `https://agent.example.com/mcp`；
3. 三条必知规则：
   - **端点注册后永久不可改**（链上 `AgentInfo` 没有 setter），填错只能重新注册新身份；
   - **端点 ≠ 身份证**，任何人都能注册同一个网址，它不证明归属；
   - 真正的全局唯一标识是 **ATID**（注册时生成的链上 NFT 编号）和 **(来源平台, 外部智能体 ID) 绑定组合**。注册后在「外部智能体身份」区域做 L1 绑定声明，再逐步升级 L2–L4 强证明。

## 七、常见坑速查

| 症状 | 原因 | 解法 |
| --- | --- | --- |
| curl `Connection refused` / 超时 | 没监听公网或防火墙没开端口 | 检查 `0.0.0.0` 监听与安全组 |
| 浏览器能开但 curl 报证书错误 | 证书域名不匹配 | 用 Caddy 自动签，别手动折腾 |
| 本地正常，公网 502 | 反代指向的端口不对 | 核对 Caddyfile 的 `reverse_proxy` 端口 |
| 注册后想换地址 | 端点不可改 | 换新身份重新注册（押金按注销规则退） |
| 填了内网 IP | 注册页直接拦截 | 换公网 https 域名 |
| Claude Code 里 `/mcp` 看不到 server | 没注册或 scope 不对 | `claude mcp add` 重加，注意 `--scope`（user 全局 / project 当前项目） |
| Claude Code 报 `Transport error` | 端点不是 streamable HTTP 或反代截断了 POST | 回到第五节用 curl 自检握手 |
| Codex 连不上 HTTP server | 版本较老不支持 `url` 形式 | 升级 Codex，或本地 stdio 过渡 |

---

*本教程对应 AgentTrust 前端校验规则（只拦「填了但不合法」的端点）。有疑问欢迎提 issue：https://github.com/Fishman-free/multiagent*
