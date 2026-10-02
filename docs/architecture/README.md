# ADR（アーキテクチャ決定記録）

実行基盤・認証認可・永続化・可観測性など、発注機能とは別軸のアーキテクチャ決定の正。
要件・設計・エポック順序の正は [`../roadmap/PHASE4_PLUS_ROADMAP.md`](../roadmap/PHASE4_PLUS_ROADMAP.md) で、計画書からは ADR 番号で参照する。

## 一覧

| ADR | タイトル | 状態 |
|---|---|---|
| [ADR-1](ADR-1-runtime.md) | 実行基盤を k3s（AWS Lightsail）から見直す | 検討中 |
| [ADR-2](ADR-2-in-app-identity.md) | 認証認可を Cloudflare Access からアプリ内 CIAM へ | 決定（暫定）2026-07-25 |
| [ADR-3](ADR-3-sequencing.md) | インフラ・認証・DB の移行順序 | 検討中 |
| [ADR-4](ADR-4-base-image.md) | 本番コンテナのベースイメージ（glibc/Debian vs musl/Alpine） | 決定 2026-07-04 |
| [ADR-5](ADR-5-database.md) | DB 選定 | 検討中 |

## 運用ルール

- 1 ADR = 1 ファイル。ファイル名は `ADR-<番号>-<英語の短い slug>.md`。番号は再利用しない。
- 状態は `検討中` / `決定（暫定）` / `決定` / `棄却` / `置換` のいずれか。状態を変えたら、この一覧と ADR 本文の両方を更新する。
- 検討中の ADR には、同じファイルに日付付きで追記してよい。決定済みの ADR を覆すときは新しい番号で起こし、旧 ADR の状態を `置換` にして置換先を書く。
- サービスの仕様・料金・期限は変動する。決定の根拠にする前に、公式の一次情報で再確認する。
- ADR の写しを repo 外（AI アシスタントのスキル等）に持たない。

## 経緯

2026-10-02 まで、ADR は repo 外（Claude スキル `chumon-hub-dev` の `completed-form.md` §6）に置いていた。
repo 外では Copilot・ボットレビュー・他の AI アシスタントから参照できず、ADR-3 が「移行順序」と「DB 選定」の二義で使われる状態が生じたため、repo へ移設した。
これにより、[`../refactoring/REFACTORING_PLAN.md`](../refactoring/REFACTORING_PLAN.md) にある「ADR ログの repo 移設は行わない」方針は撤回する。

移設時の変更は次の4点のみで、各 ADR の決定内容は移設前と変えていない。

- DB 選定を ADR-3 から ADR-5 として分離した（ADR-3 は順序だけを扱う）。
- 箇条書きの断片を文に整え、関連文書へのリンクを追記した。
- ADR-4 の開発用 Dockerfile のパスを実在のパス（`.devcontainer/Dockerfile.dev`）に直した。
- ADR-3 の結合関係にあった「Cloud Run 化は Access / Tunnel の撤去とセット」を、同じ ADR の傾き（Access は ③ まで併存）と ADR-2 に合わせ、Tunnel と Access の撤去時期に分けて書いた（#359 のレビュー指摘）。

## テンプレート

```markdown
# ADR-<n>: <タイトル>

- 状態: 検討中 | 決定（暫定） | 決定 | 棄却 | 置換（日付）
- 関連: <計画書の節 / 他 ADR / インシデント>

## 背景 / 課題

## 選択肢

## 決定（または現時点の傾き）と理由

## 影響範囲 / 依存（他 ADR・エポックとの関係）

## 次アクション / 再検討トリガ
```
