# ステージ 1: 依存関係のインストール (Deps)
FROM node:20-alpine AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app

# パッケージ定義ファイルをコピー
COPY package.json pnpm-lock.yaml* ./

# pnpm を有効化して依存関係をインストール
RUN corepack enable pnpm && pnpm i --frozen-lockfile

# ステージ 2: ビルダー (Builder)
FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Next.js のビルドを実行
# 修正: ENV key=value 形式に変更
ENV NEXT_TELEMETRY_DISABLED=1
RUN corepack enable pnpm && pnpm run build

# ステージ 3: ランナー (Runner)
FROM node:20-alpine AS runner
WORKDIR /app

# 修正: ENV key=value 形式に変更
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# セキュリティのため非ルートユーザーを作成
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

# 公開用ファイルとスタンドアロンビルドのコピー
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs

EXPOSE 3000

# 修正: ENV key=value 形式に変更
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

CMD ["node", "server.js"]