# ベースイメージは ADR-6 により node:26-trixie-slim（glibc）を digest で固定する。
# 3 ステージとも同じ digest にすること。更新は Dependabot の PR で取り込む（自動マージしない）。
# Dependabot は FROM 行だけを読み ARG を解決しないため、ベースは FROM に直接書く。
# digest 再取得例: docker buildx imagetools inspect node:26-trixie-slim --format '{{json .Manifest.Digest}}'

# ステージ 1: 依存関係のインストール (Deps)
FROM node:26-trixie-slim@sha256:0d1e33586362bb9e608c4e751e7a9e7edb55c9ac11461ed5666af696cc461dd4 AS deps
WORKDIR /app

# パッケージ定義ファイルをコピー
COPY package.json pnpm-lock.yaml* ./

# pnpm を有効化して依存関係をインストール
# ----- 修正前 (Node.js v20) -----
# RUN corepack enable pnpm && pnpm i --frozen-lockfile
# ----- 修正前２ -----
# RUN npm install -g corepack && corepack enable pnpm && pnpm i --frozen-lockfile
# ----- 修正後 (corepackを使わず、直接pnpmをインストール) -----
RUN npm install -g pnpm@10.33.0 && pnpm i --frozen-lockfile

# ステージ 2: ビルダー (Builder)
FROM node:26-trixie-slim@sha256:0d1e33586362bb9e608c4e751e7a9e7edb55c9ac11461ed5666af696cc461dd4 AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Next.js のビルドを実行
ENV NEXT_TELEMETRY_DISABLED=1
# ----- 修正前 (Node.js v20) -----
# RUN corepack enable pnpm && pnpm run build
# ----- 修正前２ -----
# RUN npm install -g corepack && corepack enable pnpm && pnpm run build
# ----- 修正後 (corepackを使わず、直接pnpmをインストール) -----
RUN npm install -g pnpm@10.33.0 && pnpm run build

# ステージ 3: ランナー (Runner)
FROM node:26-trixie-slim@sha256:0d1e33586362bb9e608c4e751e7a9e7edb55c9ac11461ed5666af696cc461dd4 AS runner
WORKDIR /app

# 修正: ENV key=value 形式に変更
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# セキュリティのため非ルートユーザーを作成
# uid 1001 を維持し、主グループは nodejs（gid 1001）にする（ADR-6 条件 2）。
# ホームは alpine の adduser --system と同じく作成する。
RUN groupadd --system --gid 1001 nodejs \
 && useradd --system --uid 1001 --gid nodejs --create-home --home-dir /home/nextjs \
      --shell /usr/sbin/nologin nextjs

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