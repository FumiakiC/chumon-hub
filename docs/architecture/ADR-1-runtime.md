# ADR-1: 実行基盤を k3s（AWS Lightsail）から見直す

- 状態: 検討中
- 関連: [ADR-3](ADR-3-sequencing.md)（移行順序）／[ADR-4](ADR-4-base-image.md)（本 ADR の決定時に必ず見直す）／[ADR-5](ADR-5-database.md)（DB の接続形態）／計画書「決定事項と未決事項」の「実行基盤（Cloud Run 化）」「ノードのリソース保護」「非同期ジョブ実行」「マニフェスト適用の自動化と Secret 管理」／[2026-09-19 インシデント](../incidents/2026-09-19-crop-concurrency-node-exhaustion.md) §5 の欠陥 #5

## 背景 / 課題

現行の本番は Docker → GHCR → k3s（AWS Lightsail の単一ノード）で、入口は Cloudflare Access + Tunnel。

## 選択肢

- Cloud Run（本命。サーバレス従量・scale-to-zero。Next.js は `output: "standalone"` で素直に載る）
- GKE Autopilot（k8s を継続したい場合の中間解）
- Firebase App Hosting
- 現状維持

## 現時点の傾き

Cloud Run。

## 留意点

- 秘匿情報は Secret Manager へ移す。
- `/tmp` は揮発する（短命の利用なら問題ない）。
- cold start は、イメージの縮小と、必要時の `min-instances=1` で抑える。
- Docker イメージは GKE へそのまま移せる退路がある。

## 2026-09-19 追記（実行基盤のサイズ）

#347 の適用で、Lightsail `t3.small`（2 vCPU / 2GB）のメモリ配分は「k3s が通常時（実測 764Mi、Pod 以外の合計 1025Mi）にとどまる前提」でのみ成立することが確定した。
Allocatable は `894996Ki`（約 874Mi）で、アプリ 512Mi + coredns 170Mi + 上限なしの system pods で 78% を占める。
`*-cgroup` による強制を行わない以上 **k3s 自身の使用量は制限されず、k3s が過去の peak（約 1.1G）まで振れた場合に耐える配分はこのノード上に存在しない**。

つまり #347 が保証するのは「アプリが原因でノードが死なない」までであり、「ノードが死なない」ではない。
DB・ジョブ基盤（Phase 5）を載せる段階では、この 2GB が先に破綻する。

## 次アクション

インスタンス増強またはマネージド基盤への移行を、Phase 5 着手前（Phase 4.5）に決める。決定には、選んだ構成で満たすべき容量の基準を含める。判断材料と、選んだ変更（移行・増強）の適用と容量確認の時期は、計画書 基本設計 §4「Phase 4.5 詳細計画」。
