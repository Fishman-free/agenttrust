# syntax=docker/dockerfile:1
# AgentTrust 前端：多阶段构建
#   构建阶段（node:22-alpine）→ next build 静态导出 out/
#   运行阶段（nginx:alpine）→ 服务静态文件，端口 3000
#
# 为何用 nginx 服务静态导出：next export 生成 /agents.html 形式路由文件，
# 运行阶段需支持 $uri → $uri.html 回退（nginx try_files），serve 等工具无法正确处理。

# ---------- 构建阶段 ----------
FROM node:22-alpine AS builder

WORKDIR /app

# 依赖层（利用 Docker 层缓存；package-lock.json 已提交）
COPY package.json package-lock.json ./
RUN npm ci

# 源码 + 构建
# NEXT_PUBLIC_* 为构建期变量：NEXT_PUBLIC_CHAIN=anvil（默认）时使用 anvil 确定性地址，
# 浏览器侧连 http://127.0.0.1:8545（anvil 映射到宿主 8545）。
COPY . .
ARG NEXT_PUBLIC_CHAIN=anvil
ENV NEXT_PUBLIC_CHAIN=$NEXT_PUBLIC_CHAIN
RUN npm run build

# ---------- 运行阶段 ----------
FROM nginx:stable-alpine AS runner

COPY --from=builder /app/out /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 3000
