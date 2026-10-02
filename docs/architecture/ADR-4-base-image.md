# ADR-4: 本番コンテナのベースイメージ（glibc/Debian vs musl/Alpine）

- 状態: 決定 2026-07-04
- 関連: [ADR-1](ADR-1-runtime.md)（最有力の再検討トリガ）／本番 `Dockerfile`／開発 `.devcontainer/Dockerfile.dev`／[`../SETUP_DEVCONTAINER.md`](../SETUP_DEVCONTAINER.md)

## 背景 / 課題

本番 `Dockerfile` は `node:26-alpine`（musl）の3ステージ、開発 `.devcontainer/Dockerfile.dev` は `node:26-bookworm-slim`（glibc）。
#197 の Gemini レビューで、dev=glibc / prod=musl の非対称が指摘された。
dev/prod parity と、Alpine の軽量性・攻撃面縮小のトレードオフである。

## 選択肢

- (A) 現状維持＝本番 alpine・dev glibc の非対称を許容する
- (B) glibc へ統一する（本番を bookworm-slim か distroless-nodejs へ）
- (C) musl へ統一する（dev を alpine へ）

## 決定と理由

- **今は (A) 現状維持＝アクション無し**（これが本 ADR の決定事項）。
  理由: native prebuild を持つ全依存（`@next/swc` / `@tailwindcss/oxide` / `lightningcss` / `@unrs/resolver-binding` / `@img/sharp`）に musl 版がある。deps は alpine 内で install するため、libc を跨いだ混入が無い。欠落は CI の Docker build で検知できる。低トラフィックで実害が小さい。base image の切替は安価で可逆である。
- **統一の方向（B か C か）は現時点で未定**。
  理由: 最適な収束先は ADR-1（Cloud Run 化 vs k3s 継続）に依存し、入力が未確定。切替コストが低く、早期に決める価値も低い（YAGNI）。方向を先に決め打ちしない。

## 受容するリスク（eyes open）

- Node.js の musl(amd64) は公式の "Experimental" tier である（Tier1/2 ではなく、CI の失敗はリリースをブロックしない）。Tier2 への昇格提案 nodejs/node #62764 が進行中で、分類は変動しうる。
- セキュリティリリース時、Alpine 版イメージが Debian 版より遅れて公開されうる（musl ビルド待ち）。緊急パッチのラグを許容する。
- parity ギャップ: musl 固有のランタイム不具合（実務上の本命は Gemini File API への outbound の DNS 挙動差で、sharp ではない）を dev（glibc）で再現できない。発生したら即、再検討のトリガとする。

## 影響範囲 / 依存

本番 `Dockerfile`。**ADR-1（実行基盤）と結合**する。
B を採る場合は distroless / bookworm 化、C を採る場合は `.devcontainer/Dockerfile.dev` と `SETUP_DEVCONTAINER.md` に波及する。

## 次アクション / 再検討トリガ

現状維持。次のいずれかで収束方向を決める。

1. **ADR-1 の基盤確定**（最有力の決定点。ADR-1 の決定時に本 ADR を必ず見直す）
2. musl 固有のランタイム不具合の発生
3. musl prebuild を持たない native 依存の追加
4. Node の musl tier の昇格・降格

トリガ 3 の評価記録: 2026-09 の `@napi-rs/canvas` 追加時は、`@napi-rs/canvas-linux-x64-musl` が公式に提供されているため非該当と判断した（計画書 基本設計 §3「Phase 4a 詳細計画」14. の訂正 2026-09-19）。

## 収束先の候補（決定ではない。トリガ時に評価する）

Cloud Run なら **(B) glibc（bookworm-slim / distroless-nodejs）が第一候補**（cold start の差は小さく、DNS・tier・parity で glibc が有利）。
k3s 継続なら (C) alpine 統一も可。
