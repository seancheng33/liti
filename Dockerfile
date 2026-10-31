# ============================================================
# 砺题 Liti —— 多阶段构建镜像
# 构建：docker build -t liti .
# 运行：docker run -p 8080:8080 liti
# ============================================================

# ---------- 阶段 1：构建 ----------
# 服务器本地已有 node:20-alpine 镜像（node >= 20 满足项目要求），避免重新下载 node:22
FROM node:20-alpine AS builder

# 国内 npm 镜像，加速依赖安装
# 跳过 electron 二进制下载（桌面壳只在本地跑，镜像用不到）
ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1
# node-gyp 编译原生模块时从 npmmirror 下载 node headers（better-sqlite3 在 musl 上无 prebuilt，需源码编译）
ENV npm_config_disturl=https://npmmirror.com/mirrors/node
ENV NODEJS_ORG_MIRROR=https://npmmirror.com/mirrors/node

# 原生模块（argon2 / better-sqlite3）编译依赖
RUN apk add --no-cache python3 make g++

WORKDIR /app

# 全局装 pnpm（走 npmmirror，避免 corepack 从被墙源拉 pnpm）
# 注意：node headers 镜像已通过上方 ENV npm_config_disturl 配置，node-gyp 会读它
RUN npm config set registry https://registry.npmmirror.com \
    && npm install -g pnpm@9 \
    && pnpm config set registry https://registry.npmmirror.com

# 先装依赖（利用缓存层）
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY server/package.json server/
COPY web/package.json web/
COPY electron/package.json electron/

RUN pnpm install --frozen-lockfile

# 复制源码
COPY tsconfig.base.json ./
COPY server/ server/
COPY web/ web/

# 编译后端 + 构建前端（前端先跑一遍 tsc 类型检查，vite 本身不校验类型）
RUN pnpm --filter @liti/server build \
    && pnpm --filter @liti/web typecheck \
    && pnpm --filter @liti/web build

# ---------- 阶段 2：运行时 ----------
FROM node:20-alpine AS runner

# 原生模块运行时依赖
RUN apk add --no-cache dumb-init

ENV NODE_ENV=production
ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1
ENV npm_config_disturl=https://npmmirror.com/mirrors/node
ENV NODEJS_ORG_MIRROR=https://npmmirror.com/mirrors/node
WORKDIR /app

# 全局装 pnpm（生产依赖安装用）
RUN npm config set registry https://registry.npmmirror.com \
    && npm install -g pnpm@9 \
    && pnpm config set registry https://registry.npmmirror.com

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY server/package.json server/
COPY web/package.json web/
COPY electron/package.json electron/

# 安装生产依赖（原生模块需重新编译，故带构建工具链）
RUN apk add --no-cache python3 make g++ \
    && pnpm install --frozen-lockfile --prod \
    && apk del python3 make g++

# 复制编译产物（保持 server/dist、web/dist 相对结构）
COPY --from=builder /app/server/dist ./server/dist
COPY --from=builder /app/web/dist ./web/dist

# 数据目录（SQLite 默认落这里，用 volume 持久化）
RUN mkdir -p /app/data
VOLUME ["/app/data"]

EXPOSE 8080

# 启动时自动执行迁移（server.ts 内部 migrate）+ 托管前端
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "server/dist/server.js"]
