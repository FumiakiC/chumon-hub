# GitHub Copilot Instructions — chumon-hub

> このファイルは VSCode / GitHub Copilot が自動参照する。Copilot はコード補完・編集の際に
> 以下の規約に従うこと。リファクタリングの全体計画は `docs/refactoring/REFACTORING_PLAN.md` を参照。

## プロダクト背景（最小限）

- chumon-hub は **買い手（発注側）のツール**。最終形は注文番号の採番→注文書発行→納品→検収→支払い完了までを一元管理する発注ライフサイクル基盤。現状はプロトタイプ段階。
- `official-order` は **見積書** を認識して **本注文書** を発行。`extract-drawing` は **機械図面の表題欄**（部品番号・数量・材質・表面処理）を認識し、見積前に単価・納期＝「協議中」で **仮注文書** を発行する。
- **仮注文と本注文は同一注文番号を引き継ぐ**（同一エンティティのステータス/版違い。別採番にしない）。
- DB・PDF出力・証憑保存・ステータス管理は **現時点ではスコープ外**（将来 Phase 4+）。これらの依存（DBドライバ・PDFライブラリ等）を今は追加しない。

## プロジェクト構成

- Next.js **16**（App Router）。ミドルウェアは **`proxy.ts` 規約**（`middleware.ts` ではない。Next.js 16 でリネーム済み）。
- React 19 / TypeScript / Tailwind v4 / shadcn-ui(Radix) / zod。
- デプロイ: Docker → GHCR → K3s、Cloudflare Zero Trust(Access) + Tunnel。

## 開発環境

- 開発は **VS Code Dev Container** 内で行う（node 25 + pnpm はコンテナ同梱、ホストに node/pnpm は無い）。`pnpm` 等のコマンドは Dev Container のターミナルで実行する。
- 開発サーバは `pnpm dev`（= op run で秘匿注入 → next dev）。op を使わない場合は `pnpm dev:local`（この場合 `.env.local` には op:// 参照ではなく実際の値を手動で記述する）。
- 秘匿情報は 1Password (op) で実行時注入し、ハードコードしない（`.env.local` は op:// 参照、コミットしない。op 非使用時のみローカルでプレーンテキストの実値を記述）。

## パッケージ管理

- **pnpm のみ**（npm / yarn のコマンドや lockfile を生成しない）。
- 依存は `latest` 指定にしない。`^x.y.z` か完全固定で明示する。
- 新しい重量級依存を安易に追加しない。既存（Radix / zod / ai-sdk）で実現できないか先に検討する。

## TypeScript / コード規約

- **`as any` 禁止**。`unknown` + 型ガード、または適切な型定義を使う。
- エラーは **型付きエラークラス**（例: `class ConfigError extends Error { readonly code = 'ERR_SYS_CONFIG' }`）で表現し、
  `error.code` / `instanceof` で分岐する。`(error as any).code` のような書き方をしない。
- 例外メッセージや内部状態を **クライアント応答に含めない**。ユーザー向け文言は `lib/errorUtils.ts` 経由で日本語化する。
  `errorUtils` の判定キーは **実際に throw される文言/コードと必ず一致** させる。

## AI / Gemini

- モデル ID を route 内にハードコードしない（PR-04 で `lib/ai/models.ts` を導入予定）。導入後は **`lib/ai/models.ts` の中央 config** から参照する。
- 抽出の zod スキーマは route に直書きしない（PR-04 で `lib/ai/schemas.ts` を導入予定）。導入後は **`lib/ai/schemas.ts` を単一の真実源** とする。
  スキーマ項目の **内容変更はリファクタPRで行わない**（別途 `feat/` で扱う）。
- 抽出処理は「upload → classify → extract → validate」の **関数単位（合成可能なステージ）** で書く。1ファイルの巨大ハンドラにしない。
- **フロントエンドは抽出APIのレスポンス型を `lib/ai/schemas.ts` 由来（`z.infer`）の共有型からのみ参照** する。route 内部の実装型やその場限りの inline 型に直接依存しない。表示整形は API 応答の構造から分離し presentation 層に置く（将来フロントを作り直してもAPIを巻き込まないため）。
- Gemini SDK は原則 **`@google/genai`（統合SDK）** を使う。現状ファイルアップロードは `@google/generative-ai/server` を併用しているため（PR-07 で移行予定）、**新規実装では legacy を増やさない**。
- ファイルアップロード受け口では必ず **`file-type` によるマジックバイト検証** を行い、許可 MIME 以外は 415 を返す。
- 一時ファイルは `os.tmpdir()` を使い、`finally` で確実に削除する。Gemini File API にアップロードしたファイルも `finally` で削除する。

## 抽出データと業務データの分離（重要な設計境界）

- AI が抽出した生JSON（信頼度・要確認を含みうる）を **そのまま「確定した業務データ」として扱わない**。
- 単価・納期は「協議中（確定前）」という状態を取りうる。未確定値を確定値と混同するロジックを書かない。
- （将来の DB / 状態管理は Phase 4+。今は上記の前提を壊さないことだけ守る。）

## ロギング / セキュリティ

- `[v0]` 接頭辞を新規に追加しない。`lib/logger.ts` が存在する場合はそれを使う（PR-10 で導入予定）。
- **秘匿情報をログに出さない**: API キー、`API_SECRET`、暗号化トークン、Gemini の `fileUri` / `file.name`、アップロードファイル名など。
- 秘匿値の受け渡しは AES-256-GCM トークン（`lib/crypto.ts`）。TTL とフォーマット検証を壊さない。

## フォーマット（`.prettierrc` 準拠）

- セミコロンなし / シングルクォート / インデント2スペース / `trailingComma: es5`。
- import 順は `@trivago/prettier-plugin-sort-imports` 設定に従う（react → next → 3rd party → `@/components` → `@/lib` → `@/*` → 相対）。
- Tailwind クラスは `prettier-plugin-tailwindcss` のソート順を尊重。

## ディレクトリ規約

- API ルート: `app/api/<name>/route.ts`。
- 共有ロジック: `lib/`（AI 関連は `lib/ai/`：`models.ts` / `schemas.ts` / `file-upload.ts` 等）。
- UI: `components/ui/`（shadcn）, 機能別は `app/<feature>/components/`。

## やってはいけないこと（リファクタ時）

- 「リファクタPR」で **挙動・スキーマ項目を同時に変えない**。変更が必要なら理由をコミット/PR本文に明記し、別PRに分ける。
- 動作中の認証・暗号トークン・抽出スキーマ・採番ルールを、根拠なく変更しない。
- 大量ファイルにまたがる無関係な整形を1PRに混ぜない。

## コミット規約

- **Conventional Commits**（`feat:` / `fix:` / `chore:` / `refactor:` / `perf:` / `ci:` / `docs:`）。
- 本文は日本語可。1PR=1関心事。
