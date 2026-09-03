# MCP / A2A Endpoint Setup Guide (Beginner-Friendly)

> Chinese version (primary): [docs/guides/mcp-a2a-endpoints.zh-CN.md](./mcp-a2a-endpoints.zh-CN.md)
>
> This is the English companion of the same tutorial. After reading it you can answer:
> **What is an endpoint? How do I expose one publicly? What should I watch out for when registering on AgentTrust?**

## 1. The analogy: an endpoint is your shop address

- **MCP endpoint** = your shop's street address. Other programs (Claude, other agents) walk up to it and use your tools (fetch data, place orders, compute...).
- **A2A endpoint** = your business card + meeting room. Other agents read it to learn who you are, what you can do, and how to negotiate (A2A = Agent-to-Agent).

```
 User / other agent
      │  visits the "address"
      ▼
 https://your.domain/mcp   ← MCP endpoint (tool service)
 https://your.domain/a2a   ← A2A endpoint (agent card & conversation)
      │
      ▼
 Your agent (calls tools, returns results)
```

In short: **an endpoint is an ordinary https:// URL that answers MCP / A2A protocol requests instead of web pages.**

## 2. Step 1 — Run MCP locally

Fastest path is Python's FastMCP:

```python
# server.py
from fastmcp import FastMCP

mcp = FastMCP("MyAgent")

@mcp.tool
def get_price(symbol: str) -> str:
    """Look up a token price (sample tool)."""
    return f"{symbol} = 100 USD"

mcp.run()  # stdio mode: verify tool logic locally first
```

```bash
pip install fastmcp
python server.py
```

Node users: `npm i @modelcontextprotocol/sdk` — same idea.

## 3. Step 2 — Expose it publicly

```python
mcp.run(transport="http", host="0.0.0.0", port=8000)
```

Deploy to a machine with a public IP and put HTTPS in front (Caddy is easiest):

```
agent.example.com {
    reverse_proxy 127.0.0.1:8000
}
```

No server? Use Railway / Fly.io / cloud functions — they hand you an https domain.

**Checklist (all required):** `https://` · publicly reachable (no `localhost`, `127.0.0.1`, or private IPs) · a stable domain — **endpoints can never be changed after registration**.

## 4. Step 3 — Probe it yourself

```bash
curl -i https://agent.example.com/mcp

curl -i -X POST https://agent.example.com/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"probe","version":"0.0.1"}}}'
```

A JSON response containing `serverInfo` means your MCP service works publicly. For A2A, `GET /.well-known/agent.json` should return the agent card JSON.

## 5. Step 4 — Register on AgentTrust

1. Sign in at agenttrust.site → **Agent Registration**.
2. Paste your verified `https://agent.example.com/mcp` into the MCP/A2A endpoint field.
3. Three rules to remember:
   - The endpoint is **immutable on-chain** after registration (no setter on `AgentInfo.endpoint`).
   - An endpoint is **not an identity** — anyone can register the same URL, and it proves no ownership.
   - The globally unique anchors are the **ATID** (ERC-721 token id) and the **(platform, externalAgentId) binding**. Complete the L1 binding after registration, then upgrade to L2–L4 proofs.

## 6. Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| `Connection refused` / timeout | Not listening on 0.0.0.0, or firewall closed | Check bind address and security group |
| Certificate errors | Cert doesn't cover the host | Use Caddy automatic TLS |
| 502 behind proxy | Wrong upstream port | Verify `reverse_proxy` target |
| Want to change endpoint later | Endpoints are immutable | Register a new identity; deposit is withdrawable per deregistration rules |
| Private IP rejected | Registration-page validation | Use a public https domain |

---

*Questions? Open an issue: https://github.com/Fishman-free/multiagent*
