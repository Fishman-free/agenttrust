# MCP / A2A 端点配置教程（小白版）

> 本教程面向第一次给智能体配「对外服务地址」的读者。读完你就能回答三个问题：
> **端点是什么？怎么把它暴露到公网？填到 AgentTrust 注册页时要注意什么？**

---

## 一、先打个比方：端点 = 店铺地址

- **MCP 端点** = 你这家店的「门牌地址」。别的程序（比如 Claude、别的智能体）按这个地址找上门，就能用你店里的工具（查数据、下单、算数……）。
- **A2A 端点** = 你店的「名片 + 洽谈室」。别的智能体按这张名片就知道：你是谁、会什么、怎么跟你谈生意（A2A = Agent-to-Agent，智能体对智能体的对话协议）。

没有地址，别人找不到你；地址写错了（比如写了自己家内网地址），别人同样找不到你。

```
 用户/其他智能体
      │  按"地址"上门
      ▼
 https://你的域名/mcp   ← MCP 端点（工具服务）
 https://你的域名/a2a   ← A2A 端点（智能体名片与对话）
      │
      ▼
 你的智能体（调用工具、返回结果）
```

一句话总结：**端点就是一个普通的 https:// 网址，只不过它响应的不是网页，而是 MCP / A2A 协议的请求。**

---

## 二、第 1 步：本地把 MCP 服务跑起来

用 Python 的 FastMCP 最省事（十几行代码就是一个能用的 MCP 服务）：

```python
# server.py
from fastmcp import FastMCP

mcp = FastMCP("MyAgent")   # 你的智能体名字

@mcp.tool
def get_price(symbol: str) -> str:
    """查询代币价格（示例工具）"""
    return f"{symbol} = 100 USD"

# stdio 模式：先在本地验证工具逻辑
mcp.run()  # 默认 stdio，给 Claude Desktop 这类本地客户端用
```

```bash
pip install fastmcp
python server.py        # 本地跑通，先确认工具本身没问题
```

Node.js 用户可用官方 SDK：`npm i @modelcontextprotocol/sdk`，思路完全一样。

**本地先跑通，再考虑公网。** 不要一上来就折腾部署。

---

## 三、第 2 步：把地址暴露到公网（关键一步）

本地 stdio 只是"自家人用"。要让别的智能体访问，你需要一个**公网 https 地址**：

```python
# 只改一行：换成 HTTP 模式并监听端口
mcp.run(transport="http", host="0.0.0.0", port=8000)   # FastMCP 新版
# 旧版写法：mcp.run(transport="streamable-http")
```

然后把服务部署到任一台**有公网 IP** 的机器，并在前面挂 HTTPS（Caddy / Nginx + Let's Encrypt 都行，Caddy 最省事，两行配置自动签证书）：

```
# Caddyfile
agent.example.com {
    reverse_proxy 127.0.0.1:8000
}
```

没有服务器的替代方案：部署到云函数 / Railway / Fly.io / Vercel 等支持长连接的平台，它们直接给你 https 域名。

**验收标准（缺一不可）：**

| 要求 | 为什么 |
| --- | --- |
| `https://` 开头 | 明文 http 在公网上等于裸奔，AgentTrust 注册页也只接受 https |
| 公网可访问 | 填 `localhost`、`127.0.0.1`、`192.168.x.x`，别的智能体永远连不上 |
| 域名稳定 | AgentTrust 上**端点注册后永久不可修改**，别用临时地址 |

---

## 四、第 3 步：自检——确认别人真的连得上

部署完，别急着注册。先用命令行自己当一次"上门的客人"：

```bash
# 1. 地址通不通、证书对不对（看到 HTTP 状态码 4xx 都算"通了"，说明服务在应答）
curl -i https://agent.example.com/mcp

# 2. MCP 协议层面握手（streamable HTTP 要求 POST + JSON-RPC）
curl -i -X POST https://agent.example.com/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"probe","version":"0.0.1"}}}'
```

第 2 条命令返回一段 JSON（里面有 `serverInfo`）就说明你的 MCP 服务在公网上正常工作。
也可以用官方图形工具 **MCP Inspector**（`npx @modelcontextprotocol/inspector`）连一次，能看到工具列表就是成功。

A2A 服务同理：访问 `https://你的域名/.well-known/agent.json`，能看到一段 JSON「名片」（名字、能力、端点）即成功。

---

## 五、第 4 步：注册到 AgentTrust

1. 登录 agenttrust.site → **智能体注册**。
2. 「MCP/A2A 端点」一栏填你自检通过的 `https://agent.example.com/mcp`。
3. ⚠️ 三个必须知道的规则（都写在注册页上）：
   - **端点注册后永久不可改**——它是链上 `AgentInfo` 的一部分，没有 setter。填错只能重新注册一个新身份。
   - **端点 ≠ 身份证**。任何人都能注册同一个网址；它只是个"地址"，不证明那个智能体是你的。
   - 真正的全局唯一标识是：**ATID（注册时生成的链上 NFT 编号）** 和 **(来源平台, 外部智能体 ID) 绑定组合**。注册完成后请在「外部智能体身份」区域做 L1 绑定声明，后续再升级 L2–L4 强证明。

---

## 六、常见坑速查

| 症状 | 原因 | 解法 |
| --- | --- | --- |
| curl 返回 `Connection refused` / 超时 | 服务没监听公网，或防火墙没开端口 | 检查 `0.0.0.0` 监听与安全组 |
| 浏览器能开但 curl 报证书错误 | 证书只对 `www` 域名有效等 | 用 Caddy 自动签，别手动折腾 |
| 本地好好的，公网 502 | 反向代理指向的端口不对 | 核对 Caddyfile 的 `reverse_proxy` 端口 |
| 注册后想换地址 | 端点不可改 | 换新身份重新注册（押金按注销规则退） |
| 只写了内网 IP 就想注册 | 注册页直接拦截 | 换公网 https 域名 |

---

*本教程对应 AgentTrust 前端 PR 校验规则（只拦「填了但不合法」的端点）。有疑问欢迎提 issue：https://github.com/Fishman-free/multiagent*
