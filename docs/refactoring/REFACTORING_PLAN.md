# chumon-hub リファクタリング計画書 (Master Plan)

> 目的: 1 PR = 1 Claude チャットで完結させ、新しいチャットへ引き継いでも方針がブレない形で
> 「Dependabot 対応 → アンチパターン修整 → 構造リファクタ → 開発再開」を遂行する。
>
> 運用方法:
>
> - 各 PR に着手するときは **新しい Claude チャット** を開き、`docs/refactoring/CLAUDE_HANDOFF.md` 全文 +
>   このファイルの該当 PR セクションを貼り付けてから始める。
> - 実際のコード編集は **VSCode の GitHub Copilot** に委譲してよいが、**Claude が出力する diff が正**（canonical）。
> - マージは **squash merge + ブランチ削除**。AIボット（Gemini Code Assist / GitHub Copilot）のレビューは
>   1件ずつ ACCEPT / REJECT + 理由を明記し、必要ならGitHub上に日本語で返信する。

---

## 0. 不変の前提（要約。詳細は CLAUDE_HANDOFF.md）

- Stack: Next.js **16.2.6**（App Router、ミドルウェアは `proxy.ts` 規約）/ React 19.2.5 / TypeScript / **pnpm 10.33** / Tailwind v4 / shadcn-ui(Radix) / zod / Vercel AI SDK(`ai` + `@ai-sdk/google`)。
- 現状の Gemini ファイルアップロードのみ **レガシーの `@google/generative-ai/server`** を併用（PR-07 で `@google/genai` に一本化）。
- デプロイ: Docker → GHCR → **K3s**、**Cloudflare Zero Trust(Access)** + Tunnel。
- CI: 現状 **Docker ビルドチェックのみ**（lint / typecheck / test なし）。Dependabot は **patch のみ auto-merge**。
- 開発環境: **VS Code Dev Container**（node 25 + pnpm 10.33 はコンテナ同梱、ホストに node/pnpm は無い）。`pnpm` 等のコマンドは **Dev Container 内のターミナルで実行**。秘匿は 1Password (op) で実行時注入（`pnpm dev` = op run → next dev、`pnpm dev:local` は op 非経由で `.env.local` に実値を手動設定）。
- 動作確認: マージ前に **Dev Container 内でスモークテスト**（注文書/図面PDFをアップロードし抽出が通ること）。

---

## 0.5 製品ビジョンと本リファクタの位置づけ

chumon-hub は **買い手（発注側）のツール**。最終形は「注文番号の採番 → 注文書発行 → 納品 → 検収 → 取引先への支払い完了」までを一元管理する **発注ライフサイクル基盤**。現状はその入口（書類認識と注文書発行）のプロトタイプ段階。

**通常フロー（現状）**

- `official-order`: 取引先からの **見積書** を認識 → 単価・納期が確定しているので **本注文書** を発行。
- `extract-drawing`: 機械 **図面の表題欄**（部品番号・数量・材質・表面処理）を認識 → 見積書到着前に、単価・納期＝**「協議中」** として **仮注文書** を発行。後付け機能で抽出精度は未成熟。
- 見積納期が確定し見積書が届き次第、同一案件を **本注文** として改めて発行。

**確定済みのドメイン前提（設計の親）**

- **採番**: 仮注文と本注文は **同一注文番号を引き継ぐ**。注文番号は案件ライフサイクルを通じて不変の主キーであり、仮/本は同一エンティティの **ステータス（版）違い**。別採番ではない。
- 図面と見積は **1案件の異なる入力チャネル**。両方揃って初めて本注文。
- **保存義務**: 見積書と本注文書は **5年間保存**（法定証憑）。発行済みの本注文書は不変・改ざん防止が要件。電子帳簿保存法の射程は Phase 6 着手時に一次情報で確認する。
- メール自動送受信は **スコープ外**（見送り）。

**フロントエンドの将来像**
現状は「アップロード→抽出→JSON表示」の純粋な抽出フォーム。最終形は案件一覧・仮/本注文発行・ステータス表示・検収/支払いまで持つ **業務UI** になり、**Phase 5（DB・状態遷移確定）後に作り直す**前提。よって本リファクタでフロントは作り直さない。代わりに、作り直しがバックエンドへ波及しないよう **APIの出力契約をフロントから分離**しておく（PR-05）。

> 本リファクタ自体はこのビジョンを実装しない。ただし **将来の変更を一点修正で済ませる土台** は今回のうちに作る（下記）。

### 本リファクタで「先取りする」設計（＝今回やる）

- **抽出スキーマの単一真実源化**（PR-04）: 各ルートに散る zod スキーマを `lib/ai/schemas.ts` に集約。**項目は変えない**。将来のJSON内容変更（Phase 4）を1箇所の差し替えにする。
- **API出力契約のフロント分離**（PR-05）: 抽出APIのレスポンス型を `lib/ai/schemas.ts` 由来へ一本化し、フロントはその型にのみ依存。将来のフロント作り直しでAPIを巻き込まない。
- **抽出の合成可能ステージ化**（PR-06）: アップロード/分類/抽出/検証を関数単位に分解。将来のマルチAIパイプライン（カスケード/critic）の継ぎ目を用意する。
- **モデルID中央化**（PR-04）。

### 本リファクタの「対象外」（Phase 4+。リファクタ後に別計画で着手）

- 抽出JSON・注文書フォーマットの **内容変更**（`feat/` で実施。リファクタPRに混ぜない）。
- **フロントエンドの作り直し / 新画面 / 業務UI**（Phase 5+。DB・状態遷移確定後）。
- AIパイプライン最適化（複数モデルのカスケード・critic検証・OCR×VLM）。**評価用 golden set とハーネスを先に用意**してから。
- 永続化レイヤー（DB、採番の一意性保証、状態遷移、バックアップ）。
- PDF Services API による **体裁付き証憑PDF出力 + 5年保存運用**。
- 買い手視点ステータス（仮注文→本注文→納品→検収→三方照合→支払完了）の棚卸し。

---

## 1. PR ロードマップ（実施順）

順序には依存関係がある。**Phase 0 → Phase 1 → Phase 2 → Phase 3** の順で、各Phase内は番号順を推奨。

| ID            | ブランチ                         | 内容                                                     | リスク | 依存       |
| ------------- | -------------------------------- | -------------------------------------------------------- | ------ | ---------- |
| PR-01         | `chore/pin-dependencies`         | `latest` 指定の撲滅 + package メタ整理                   | 低     | なし       |
| PR-02         | `chore/remove-dead-code`         | デッドコード(`fileCache.ts`)削除 + v0残骸                | 低     | なし       |
| PR-03         | `chore/prune-unused-deps`        | knip/depcheck で未使用依存を削除                         | 低〜中 | PR-01      |
| (DB-minor)    | (Dependabot)                     | minor 群を rebase→レビュー→merge                         | 低     | PR-03      |
| (DB-major-\*) | (Dependabot)                     | major を1つずつ別チャットで                              | 中     | PR-03      |
| PR-04         | `refactor/centralize-ai-config`  | モデルID + 抽出スキーマを中央 config 化                  | 低     | なし       |
| PR-05         | `refactor/api-frontend-contract` | API出力契約の型をフロントから分離                        | 低〜中 | PR-04      |
| PR-06         | `refactor/gemini-file-helper`    | ルート共通のアップロード/検証/cleanup + 抽出ステージ分解 | 中     | PR-04      |
| PR-07         | `refactor/migrate-google-genai`  | レガシーSDK→`@google/genai` 一本化                       | 中〜高 | PR-06      |
| PR-08         | `refactor/error-handling`        | 型安全エラー + errorUtils 整合 + 情報漏えい防止          | 中     | なし       |
| PR-09         | `perf/auth-jwks-singleton`       | `createRemoteJWKSet` をモジュールスコープへ              | 低     | なし       |
| PR-10         | `refactor/logger`                | `[v0]` 接頭辞除去 + 簡易logger化 + 秘匿情報のログ抑止    | 中     | PR-08      |
| PR-11         | `fix/lint-baseline`              | 既存 lint エラー解消（set-state-in-effect）→ lint green  | 低     | なし       |
| PR-12         | `ci/add-lint-typecheck`          | CI に lint + `tsc --noEmit` を追加                       | 低     | 上記完了後 |

---

## Phase 0 — 基盤固め（最優先・低リスク）

### PR-01 `chore/pin-dependencies`

- **目的**: `"latest"` を排し、ビルド再現性を回復する。Dependabot とも噛み合うようにする。
- **対象**: `package.json` のみ。
- **主な変更**:
  - `pnpm-lock.yaml` に固定されている実バージョンを参照し、`"latest"` の各依存を **`^x.y.z`**（または完全固定）へ置換。対象: `@ai-sdk/google`, `@google/generative-ai`, `@hookform/resolvers`, `@radix-ui/react-popover`, `@radix-ui/react-slot`, `@vercel/analytics`, `ai`, `date-fns`, `next-themes`, `react-hook-form` ほか `"latest"` 全件。
  - `"name": "my-v0-project"` → `"chumon-hub"` に変更。
- **やらないこと**: バージョンの引き上げ（あくまで現状固定。上げるのは Dependabot 側）。
- **受け入れ条件**: `pnpm install --frozen-lockfile` が無変更で通る / Docker ビルド green。
- **smoke test**: 不要（依存解決のみ）。lockfile が変わらないことを確認。

### PR-02 `chore/remove-dead-code`

- **目的**: 参照されないコードと v0 残骸を除去。
- **対象**: `lib/fileCache.ts`(削除), `README.md`(v0.dev バッジ削除)。
- **根拠**: `fileCache.ts` はどこからも import されていない（暗号化トークン方式 `lib/crypto.ts` へ移行済みの残骸。`crypto` の import 漏れもある）。
- **受け入れ条件**: `grep -r fileCache` がヒット0 / Docker ビルド green。
- **smoke test**: 不要。

### PR-03 `chore/prune-unused-deps`

- **目的**: 未使用依存を削除し、保守面積と Dependabot ノイズを縮小。
- **対象**: `package.json`(+ lockfile)。
- **手順**: `pnpm dlx knip` もしくは `depcheck` を実行し、未使用を特定して削除。
  - **確認済みで import 0 件**: `recharts`, `embla-carousel-react`, `vaul`, `input-otp`, `cmdk`, `sonner`。
  - 未使用の `@radix-ui/*` も多数ある見込み。ツール出力で確定する。
  - 未使用の **v0生成UIコンポーネント**（`components/ui/` 配下の不使用分）があればここで除去（作り直しではなく除去）。
- **注意**: `recharts` が未使用なら、Dependabot PR **#125（recharts major）は上げずにクローズ**して本PRで削除する。
- **受け入れ条件**: 削除後に Docker ビルド green / `pnpm build` 成功。
- **smoke test**: 主要画面（ホーム / official-order / provisional-order）が表示されること。

---

## Phase 1 — Dependabot 消化

> Phase 0 完了後に着手。PR-03 で消える依存の bump は無駄なので **prune を先に**行うこと。

### DB-minor（minor/patch 群）

- 対象: #165 date-fns, #153 tailwindcss, #147 zod, #154 tailwind-merge, #143 prettier-plugin-tailwindcss, #164 @types/node など（Phase 0 後に生き残ったもの）。
- 手順: 各 PR を rebase（`@dependabot rebase`）→ CHANGELOG 確認 → ビルド green → squash merge。
- 1チャットでまとめてトリアージしてよい。破壊的変更が疑われるものは major 扱いに格上げ。
- 実績: 全 PR が Phase 0 前 main から未 rebase で巻き戻し（latest 復活/削除依存復活/next 16.2.6→16.2.4）を含んでいたため rebase をマージ前必須として実施。rebase 後 #164 @types/node が 25→26 の major に化けたため batch 除外し、Node ランタイム(25)移行とセットの別 PR へ送り（クローズ）。#165 date-fns は no-op 想定が 4.4 実マイナーに化けたが利用 API(format/parse/isValid/locale)は安定 core で挙動不変・tsc green。recharts はクローズ、postcss は #175(8.5.16) で別途マージ、js-yaml(indirect) 解消。

### DB-major（1つ1チャット）

着手順の推奨: **file-type → typescript → (生存していれば) lucide-react → recharts**。

- **#116 file-type 21→22**: major。ESM/API 変更を公式 release note で確認。`check-document-type` の `fileTypeFromBuffer` に影響しうる。
- 実績(#116, merged): **コード変更ゼロ**で追従。v22 破壊的変更（Node22必須 / `fileTypeFromStream`等が web `ReadableStream` のみ受理 / サブエクスポート廃止 / 一部MIME正規化 lz・lnk 等）は唯一の利用箇所 `fileTypeFromBuffer(buffer)` に非該当。**file-type が要求する** `engines.node>=22` は本番/Dev Container の `node:25`（≥22）で充足（プロジェクト側 `package.json` に `engines` 指定は無し）。`ALLOWED_MIME_TYPES`(jpeg/png/webp/heic/heif/pdf) は正規化対象外で判定挙動不変。build green + スモーク OK。
- **#124 typescript 5→6**: major。`tsc --noEmit` で型エラーを洗い出してから。
- **#189 lucide-react 0.x→1**: アイコン import 名の変更有無を確認（旧 #161 は #189 に superseded されクローズ済み）。
- 実績(#189, merged): **コード変更ゼロ**で追従。`lucide-react` 0.577.0→1.23.0 の更新は `package.json` / `pnpm-lock.yaml` のみで、既存アイコン import 名の追従修正は不要。build green + スモーク OK。
- **#195 ai 6→7 + @ai-sdk/google 3→4（カップリング）**: コアの Gemini 抽出パイプライン。両者は `@ai-sdk/provider` の spec を共有するため同一 PR（#188 ai / #186 google を統合、#186 クローズ）。
- 実績(#195, merged): **コード変更は最小**（`createGoogleGenerativeAI` → `createGoogle` リネーム 3ルートのみ）。v7 破壊的変更（Node22+/ESM-only/system→instructions/multi-step result/telemetry の `@ai-sdk/otel` 分離）はいずれも非該当または既充足（Node25 / 全ESM / `role:"user"` のみ / `generateObject().object` は対象外 / file part は `{type:"file",data,mediaType}` で既に v7 正準形）。`ai@7.0.14` + `@ai-sdk/google@4.0.8` + `@ai-sdk/provider@4.0.2` の単一系に整合。片方だけ上げると provider spec skew（`LanguageModelV4` vs ≤`V3`）で型エラーのためカップリング必須。build green + 変更3ルートの scoped lint 0 + スモーク OK。**特記**: rebase で `package.json` の `ai` 行が main 側へ巻き戻る事故があり復旧（→ coupled major は rebase 後に両依存行の grep 確認を必須化）。format-on-save の Prettier 全体整形が混入したため canonical（リネームのみ）へ縮小し原子性を維持。Copilot 11指摘は全て既存コードでスコープ外につき REJECT（フォローアップへ）。
- **#197 @types/node 25→26 + Node ランタイム 25→26（カップリング）**: `@types/node` の major はランタイム Node の major に追従必須（単独では型/ランタイム skew）。Node 25 は odd release で EOL のため 26 系（Current、Active LTS 2026-10-28 / EOL 2029-04-30）へ移行し、型定義とセットで上げる。
- 実績(#197, merged): **アプリコード変更ゼロ**。バージョン参照差し替え4ファイルのみ（本番 `Dockerfile` 3ステージ `node:26-alpine` / Dev Container `node:26-bookworm-slim` は digest 再ピン `b16ca7b4…` / `package.json` `@types/node ^26.0.1` / `copilot-instructions.md`）。lockfile 追従は `@types/node 26.1.0`（TS6 タグ解決）+ `undici-types 8.3.0` のみで無関係な transitive 巻き込みなし。Node 26 破壊的変更（`http.writeHeader`/`_stream_*` 削除・拡張子なしCJS例外撤廃・`module.register()` runtime-deprecated・Temporal 既定有効・V8 14.6・Undici 8.0）はいずれもアプリ/Next standalone で未使用。build + `tsc --noEmit` green。`next build/dev` で `module.register()` の DEP0205 警告が出るが Next.js 内部由来・アプリ未使用・警告段階のため静観。smoke: official-order / extract-drawing 両フロー 200、Gemini File API 経路（Undici 8.0）正常。Dependabot `@types/node` PR は本 PR に内包し supersede/close。**特記**: Dev Container は digest ピン留めのため digest 未確定だとリビルド不能 → 適用順（実装→digest取得→リビルド→`pnpm install` で lockfile 追従→build/tsc→smoke）を厳守。**ボット対応**: Gemini medium（dev=glibc / prod=musl 不一致）は既存構成・本PR未改変につき REJECT（各イメージ内 install で libc 跨ぎ無し、musl 欠落は CI Docker build で検知）→ dev/prod parity は ADR 検討へ。Copilot（本番 `Dockerfile` の `npm install -g pnpm` が floating で `packageManager: pnpm@10.33.0` と乖離）は指摘妥当だが既存行・本PR未改変につき REJECT →後続 chore（`pnpm@10.33.0` pin）へ送り。
- **#125 recharts 2→3**: **未使用なら PR-03 で削除済み**。残す判断をした場合のみ対応。
- 各 major は CLAUDE_HANDOFF の「Dependabot major 用プレイブック」に従う。

---

## Phase 2 — 構造リファクタ

### PR-04 `refactor/centralize-ai-config`

- **目的**: 3ルートに散在するモデルID **と抽出スキーマ** を1箇所へ集約。将来のJSON内容変更（Phase 4）を局所化する。あわせて後続 PR-05 が参照する **型の発生源** を用意する。
- **対象**: 新規 `lib/ai/models.ts`, `lib/ai/schemas.ts`、`app/api/*/route.ts`。
- **主な変更**:
  - `GEMINI_MODELS = { classify, extractOrder, extractDrawing } as const` を定義し各ルートから参照。現行値（`gemini-2.5-flash-lite` / `gemini-2.5-flash` / `gemini-3.1-flash-lite`）は **変えない**。
  - 各ルートに直書きの zod スキーマを `lib/ai/schemas.ts` に移動し **単一の真実源** にする。**項目・型は一切変えない**（純粋な移設）。
- **やらないこと**: スキーマ項目の追加/変更（それは Phase 4 の `feat/order-schema-v2`）。世代混在（2.5 / 3.1）の是非も別Issue。
- **受け入れ条件**: 各ルートに文字列リテラルの `gemini-` と inline zod スキーマが残らない / 抽出挙動が完全に不変。
- **smoke test**: 3経路（判定 / 注文抽出 / 図面抽出）を1回ずつ、出力JSONが従来と一致。

### PR-05 `refactor/api-frontend-contract`

- **目的**: 抽出APIの **出力契約（型）をフロントエンドから分離** し、将来フロントを作り直してもAPIを巻き込まない構造にする。現状のUI・挙動は一切変えない。
- **対象**: `lib/ai/schemas.ts`（型を導出）、必要なら新規 `lib/ai/contracts.ts`、抽出結果を扱うフロント側コンポーネント/フック（例: `app/official-order/*`, `app/provisional-order/*` の表示・状態フック）。
- **主な変更**:
  - 抽出APIのレスポンス型を `lib/ai/schemas.ts` の zod スキーマから `z.infer` で導出し、**APIとフロントが共有する単一の型**として export する。
  - フロントはこの共有型にのみ依存させる。route ハンドラ内部の実装型や、その場限りの inline 型に **フロントが直接依存しない** ようにする。
  - 表示整形（フォーマット）ロジックを API 応答の構造から切り離し、presentation 層に寄せる（API の形が変わっても表示側の影響範囲を限定）。
- **やらないこと**: UIの作り直し・新画面の追加・見た目やスキーマ項目の変更。あくまで **型と依存方向の整理**（挙動・表示は不変）。
- **受け入れ条件**: フロントが import する抽出API型が `lib/ai/schemas.ts` 由来に一本化 / 画面表示が従来と同一 / `tsc --noEmit` 通過 / Docker ビルド green。
- **smoke test**: official-order / extract-drawing の抽出フローで、UI表示が従来通りであること。

### PR-06 `refactor/gemini-file-helper`

- **目的**: tmp書き込み・アップロード・cleanup・入力検証の重複解消と検証統一。あわせて抽出処理を **合成可能なステージ** に分解し、将来のマルチAIパイプラインの継ぎ目を作る。
- **対象**: 新規 `lib/ai/file-upload.ts`（必要なら `lib/ai/pipeline/` の薄い土台）、`app/api/check-document-type/route.ts`, `app/api/extract-drawing/route.ts`。
- **主な変更**:
  - `withUploadedFile(file, handler)` 的なヘルパに tmp生成→アップロード→`finally`で削除を集約。
  - **マジックバイト検証（`file-type`）を全ファイル受け口に統一**（現状 `extract-drawing` は未検証）。許可MIMEの定数も共有。
  - FormData 値が実際に `File` かを `instanceof File` で検証してから処理（非File・null を早期に弾く。現状 `formData.get('file') as File` はランタイム検証を素通り。#195 Copilot 指摘）。
  - tmp ディレクトリは `os.tmpdir()` に統一。
  - 抽出処理を「upload → classify → extract → validate」の **関数単位** に整理（呼び出しは現状の1経路のままで挙動不変。多段化＝Phase 4）。
- **やらないこと**: 複数モデルのカスケードや critic の実装（Phase 4）。
- **受け入れ条件**: 不正なファイル種別が 415 で弾かれる / 既存挙動不変。
- **smoke test**: 正常PDF + 不正ファイル（テキスト偽装）で確認。

### PR-07 `refactor/migrate-google-genai`

- **目的**: 非推奨(legacy)の `@google/generative-ai` を排し `@google/genai` に一本化。
- **対象**: PR-06 のヘルパ、`package.json`、ファイルAPI利用箇所。
- **背景**: `@google/generative-ai` は公式に legacy 化され `@google/genai` への移行が推奨（GA済み）。File API は `ai.files.upload(...)` / `ai.files.delete(...)` 形式に変わる。**着手チャットで公式移行ガイドを最新確認すること**。
- **主な変更**: `GoogleAIFileManager` 依存を撤去し `@google/genai` の Files API に置換。生成側を `@ai-sdk/google` のままにするか `@google/genai` に寄せるかを **着手時に判断・記録**。
- **受け入れ条件**: `@google/generative-ai` への参照が0 / 3経路すべて成功。
- **smoke test**: 必須。判定→トークン→注文抽出の一連フロー、図面抽出を実機確認。

### PR-08 `refactor/error-handling`

- **目的**: 型安全なエラー処理と、クライアントへの内部情報漏えい防止。
- **対象**: `lib/errorUtils.ts`, `lib/crypto.ts`, `app/api/*/route.ts`。
- **主な変更**:
  - `(error as any).code` を撤廃し **型付きエラー**（例: `class ConfigError extends Error { readonly code = 'ERR_SYS_CONFIG' }`）に。
  - `errorUtils` のキー不一致を修正（定義 `"API_SECRET is missing"` ↔ 実 throw `"API_SECRET is not set..."`）。includes マッチではなく **コード/型での分岐** へ。
  - `extract-drawing` / `extract-order` がクライアントに返す内部メッセージ（`Server misconfiguration: GOOGLE_API_KEY...`）を **汎用メッセージ** に統一。
- **受け入れ条件**: 5xx 応答に内部詳細が含まれない / 既知エラーが日本語で正しくマップされる。
- **smoke test**: API_SECRET 未設定など異常系を1ケース確認。

### PR-09 `perf/auth-jwks-singleton`

- **目的**: JWKS の再取得を防ぎ jose のキャッシュを効かせる。
- **対象**: `lib/auth-cloudflare.ts`。
- **主な変更**: `createRemoteJWKSet(...)` を関数内生成→ **モジュールスコープでメモ化**（issuer 単位）。挙動は不変。
- **受け入れ条件**: 認証成功/失敗の挙動が不変。
- **smoke test**: 認証あり/なしリクエストの応答確認（development はスキップ仕様に注意）。

### PR-10 `refactor/logger`

- **目的**: `[v0]` 接頭辞除去、ログ整理、秘匿情報のログ抑止。
- **対象**: `app/`, `lib/`（`console.log`/`[v0]` 約29箇所）。
- **主な変更**: `lib/logger.ts`（環境で出力制御する薄いラッパ）を導入。fileUri / token / displayName 等の **秘匿値をログに出さない**（#195 Copilot High で具体化: `extract-order`/`extract-drawing` の復号トークン内容(`fileUri`,`name`)・`fileManagerName` 出力を含む）。
- **受け入れ条件**: `[v0]` が0件 / 本番想定でデバッグログが抑制される。
- **smoke test**: 主要フローでログに秘匿値が出ないことを目視。

---

## Phase 3 — 品質ゲート

### PR-11 `fix/lint-baseline`

- **目的**: PR-12 の lint ゲート導入前に、既存の lint エラーを解消して `pnpm lint` を green にする。
- **対象**: `hooks/use-order-processing.ts`（現状唯一の lint エラー箇所。着手時に `pnpm lint` で全件を再確認）。
- **背景**: #195 の repo 全体 lint で `react-hooks/set-state-in-effect`（`hooks/use-order-processing.ts:64` の effect 内同期 `setPreviewUrl(null)`）が顕在化。react-hooks v7 の既定ルールで、既存コードのアンチパターン。本件は依存更新とは独立。
- **主な変更**: preview URL を effect 内同期 setState ではなく、イベントハンドラでの生成（および適切な revokeObjectURL クリーンアップ）への移行、または effect 構造の見直しによって解消。プレビュー表示の挙動は不変。
- **やらないこと**: フックの機能変更・UI変更（Phase 4+/対象外）。lint エラー解消の最小修正に限定。
- **受け入れ条件**: `pnpm lint` が 0 error / プレビュー表示が従来通り。
- **smoke test**: ファイル選択→プレビュー表示、選択解除→消去が従来通り。

### PR-12 `ci/add-lint-typecheck`

- **依存**: PR-11（lint baseline が green である前提）。
- **目的**: 回帰を CI で検知できるようにする。
- **対象**: `.github/workflows/ci.yml`、必要なら `package.json` の scripts。
- **主な変更**: ビルドチェックに加え `pnpm lint` と `pnpm exec tsc --noEmit` のジョブを追加。
- **補足**: 将来の AIパイプライン最適化（Phase 4）に向けた **評価ハーネス / golden set** の置き場をここで用意しても良い（実装は Phase 4）。
- **受け入れ条件**: PR で lint/型エラーが落ちる構成になる。
- **smoke test**: 不要（CI設定）。

---

## 付録: 完了管理

- [x] PR-01 pin-dependencies
- [x] PR-02 remove-dead-code
- [x] PR-03 prune-unused-deps
- [x] Dependabot minor 群（zod 4.4.3 / tailwindcss 4.3.1 / tailwind-merge 3.6 / prettier-plugin-tailwindcss 0.8 / date-fns 4.4。詳細は「DB-minor」の実績セクションを参照）
- [x] Dependabot major（✅ file-type #116 / typescript #124 / lucide-react #189 / ai+@ai-sdk/google #195 / @types/node+Node25→26 #197 完了。計画済み major は全消化＝recharts #125 は未使用のため PR-03 で削除＋クローズ。詳細は「DB-major」参照。ただし #124 typescript の実績は DB-major には無く CLAUDE_HANDOFF「G. 直近実績」に記載）
- [x] フォローアップ chore（#197 派生・別 PR）: 本番 `Dockerfile` の `npm install -g pnpm` を `pnpm@10.33.0` に pin（**#199, merged**。deps/builder 両ステージ。Dev Container 側は pin 済みで prod のみ不整合だったのを解消。Copilot 指摘・方針8）
- [x] フォローアップ（#197 派生・モードB）: dev(glibc/bookworm) と prod(musl/alpine) の非対称を ADR 化し、**Claude スキル `chumon-hub-dev` の `completed-form.md` §6（repo 外・Claude スキル管理の ADR ログ。repo にはファイルを持たない設計）** に記録（**ADR-4 [決定] 2026-07-04: 現状維持=アクション無し**。全 native 依存に musl prebuild 有り／CI build で欠落検知。Node musl=Experimental tier・security 版ラグ・parity ギャップを受容。**収束方向(glibc/alpine)は未定**でトリガ時決定＝ADR-1 基盤確定／musl 固有不具合／musl 非対応 native 依存追加／Node musl tier 変更。ADR ログの repo 移設は行わない方針）
- [x] PR-04 centralize-ai-config（**#201, merged**。モデルID（`GEMINI_MODELS`）＋抽出3スキーマ（`documentTypeSchema` / `orderSchema` / `drawingSchema`）を `lib/ai/{models,schemas}.ts` へ純粋移設。項目・順序・型・修飾子・describe 文言・モデル値をすべて不変で移し、3ルートは中央参照へ／不要 zod import 削除。スモーク3経路で出力JSON一致・build/tsc green・ボット指摘なし。**モデルの 3.x 移行は本PRに含めず**、下記フォローアップで実施）
- [ ] フォローアップ（PR-04 派生・別チャット・`chore/`・EoL駆動）: **Gemini モデル 3.x 移行**。中央化済みのため `lib/ai/models.ts` の3値差し替えのみ（数行 diff）。一次情報（Gemini API 公式 deprecation ページ, 2026-07-05 確認）: `gemini-2.5-flash` / `gemini-2.5-flash-lite` は **shutdown 2026-10-16**。差し替え先＝classify `gemini-2.5-flash-lite`→`gemini-3.1-flash-lite`（公式後継・GA・EoL 2027-05-07）／extractOrder `gemini-2.5-flash`→`gemini-3.5-flash`（公式後継・GA・shutdown 未定）。**extractDrawing は EoL 対象外**（現行 `gemini-3.1-flash-lite` は 2027-05 まで生存）＝`gemini-3.5-flash` 化は純粋な精度アップグレードで **要測定**（境界E: golden set / 実図面 before-after。EoL 分と分割するか要判断）。着手時確認: Gemini 3 は thinking 既定ON（`drawingSchema.reasoning` の手動CoTと干渉しうる）／料金体系変更／`@ai-sdk/google` v4 のモデル文字列・thinkingConfig 取り扱い。PR-07（`@google/genai` SDK 一本化）とは別物。
- [ ] PR-05 api-frontend-contract
- [ ] PR-06 gemini-file-helper
- [ ] PR-07 migrate-google-genai
- [ ] PR-08 error-handling
- [ ] PR-09 auth-jwks-singleton
- [ ] PR-10 logger
- [ ] PR-11 fix-lint-baseline
- [ ] PR-12 add-lint-typecheck

> リファクタ完了後、別計画書「Phase 4+ ロードマップ（抽出スキーマv2 / フロント業務UI / AIパイプライン最適化 / DB / PDF証憑 / ステータス棚卸し）」を起こす。
