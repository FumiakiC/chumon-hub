# docs — 文書の索引と「正」の所在

この repo の文書が、それぞれ何の「正（Source of Truth）」なのかを示す索引。
人・Copilot・その他の AI アシスタントは、作業の前にまずここを読む。

## 優先順位

- **現在の挙動**の正は、最新の `main` のコード。
- **これからの要件・設計・決定事項と未決事項・エポック順序・申し送り**の正は [`roadmap/PHASE4_PLUS_ROADMAP.md`](roadmap/PHASE4_PLUS_ROADMAP.md)。
- **アーキテクチャ決定**（実行基盤・認証認可・永続化など）の正は [`architecture/`](architecture/README.md) の ADR。計画書からは ADR 番号で参照する。
- 「履歴」に分類した文書は当時の記録であり、現行の指示として適用しない。現行の文書と矛盾する場合は現行の側に従う。
- repo 外の資料（Claude スキル `chumon-hub-dev` など、AI アシスタント向けの手順書）は役割と手順だけを持ち、計画・決定・進捗の正は持たない。repo の文書と矛盾する場合は repo に従う。

## 分類

| 分類 | 文書 | 内容 |
|---|---|---|
| 正（現行） | [`roadmap/PHASE4_PLUS_ROADMAP.md`](roadmap/PHASE4_PLUS_ROADMAP.md) | Phase 4+ の要件定義・基本設計・決定事項と未決事項・エポック表・申し送り |
| ADR | [`architecture/`](architecture/README.md) | アーキテクチャ決定の記録。一覧と運用ルールは同ディレクトリの README |
| 運用手順 | [`ops/k3s-node-config.md`](ops/k3s-node-config.md) | k3s ノードのリソース予約と適用手順 |
| 運用手順 | [`ops/dependabot-automerge.md`](ops/dependabot-automerge.md) | Dependabot auto-merge の構成（GitHub App トークン・自動マージの対象）、グループ除外依存のマージ前の確認、条件の切り替え、ローテーション、切り分け |
| 運用手順 | [`SETUP_DEVCONTAINER.md`](SETUP_DEVCONTAINER.md) | Dev Container と 1Password の初回セットアップ、main への直接 push を防ぐ pre-push フック |
| インシデント | [`incidents/2026-08-20-next-16.3.1-standalone.md`](incidents/2026-08-20-next-16.3.1-standalone.md) | Next.js 16.3.1 の standalone 起動不全による本番デプロイ失敗 |
| インシデント | [`incidents/2026-09-19-crop-concurrency-node-exhaustion.md`](incidents/2026-09-19-crop-concurrency-node-exhaustion.md) | クロップの同時実行によるノード資源枯渇。§5 に未対応の欠陥が残る |
| 評価 | [`eval/GOLDEN_SET.md`](eval/GOLDEN_SET.md) | golden set の置き場所とラベル形式（実データは private repo） |
| 履歴 | [`refactoring/REFACTORING_PLAN.md`](refactoring/REFACTORING_PLAN.md) | リファクタ Phase 0〜3（PR-01〜12、2026-07 完了）の計画と完了記録 |
| 履歴 | [`refactoring/CLAUDE_HANDOFF.md`](refactoring/CLAUDE_HANDOFF.md) | リファクタ期の申し送り（2026-09-24 凍結） |
| 参照 | [`images/`](images/) | ルート README 用の画像 |

## 文書を追加・変更するとき

- 新しい文書は、この表に分類を付けて追加する。どこにも当てはまらない文書を作る前に、既存の文書の節で足りないかを確かめる。
- 文書を「履歴」へ移すときは、冒頭に凍結日と、現行の正がどこにあるかを書く。
