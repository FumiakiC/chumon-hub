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

- Stack: Next.js **16.2.6**（App Router、ミドルウェアは `proxy.ts` 規約）/ React 19.2.5 / TypeScript / **pnpm 10.33** / Tailwind v4 / shadcn-ui(Radix) / zod / **`@google/genai`**（Gemini SDK。File API・生成とも一本化済み＝PR-07/PR-07b）。
- Gemini は File API（PR-07 #226）・生成側（PR-07b #235）とも **`@google/genai` に一本化済み**（`@google/generative-ai/server` / `ai` / `@ai-sdk/google` は撤去済み）。
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
| PR-07         | `refactor/migrate-google-genai`  | レガシーSDK→`@google/genai` 一本化（File API）           | 中〜高 | PR-06      |
| PR-07b        | `refactor/genai-generate`        | 生成側を `@google/genai` に一本化（generateObject→generateContent） | 中〜高 | PR-07 |
| PR-08         | `refactor/error-handling`        | 型安全エラー + errorUtils 整合 + 情報漏えい防止          | 中     | なし       |
| PR-09         | `perf/auth-jwks-singleton`       | `createRemoteJWKSet` をモジュールスコープへ              | 低     | なし       |
| PR-10         | `refactor/logger`                | `[v0]` 接頭辞除去 + 簡易logger化 + 秘匿情報のログ抑止    | 中     | PR-08      |
| chore         | `chore/format-baseline`          | Prettier 一括正規化 + format script + blame-ignore（**PR-06 前に先行実施**） | 低     | なし       |
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
- **実績（#203）**: `lib/ai/contracts.ts` 新設、フロント3ファイル（`lib/api/drawing-api.ts` / `hooks/use-order-processing.ts` / `app/provisional-order/hooks/use-provisional-order.ts`）を契約型参照へ一本化、`OrderExtractionResult` に存在しない常時 `undefined` 参照7項目（`issuerCompany` / `issuerAddress` / `manager` / `approver` / `desiredDeliveryDate` / `phone` / `fax`）を除去。挙動・UI・スキーマ項目は不変。ボット指摘は全件 REJECT（内訳: `safeParseFloat` デッドコード削除提案は PR-11、応答の防御的検証追加は PR-08、Prettier 正規化は別 `chore` PR へ分離）。

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
- **実績（#224）**: 新規 `lib/ai/pipeline/{types,upload,index}.ts`（計画の仮称 `lib/ai/file-upload.ts` ではなく **pipeline 土台として新設**＝owner 判断）。`validateUploadFile`(HTTP を投げない結果 union。instanceof File→400 / サイズ25MB→413 / マジックバイト→415) ＋ `withUploadedFile(params, handler, { deleteRemoteAfter })`(tmp生成→upload→即時削除→handler→`finally` cleanup。remote 寿命を `deleteRemoteAfter` で制御＝check-document-type:false でトークン手渡し / extract-drawing:true で使い切り)。抽出は `UploadedFile` を受け取る handler として整理（多段化せず **Phase 4 の継ぎ目のみ**用意。呼び出しは1経路のまま）。許可MIME・上限サイズは pipeline の単一定義。**挙動変更（計画/合意済み）**: extract-drawing にマジックバイト415・サイズ25MB(413)・upload の検出mime/ext を統一。**不変**: prompt/schema/model・`encryptFileToken` 引数・`normalizeDrawingNo`・token 手渡し・各 route の `console.error`。**縮退時のみ**: 多重不正時の優先順位が validate 先行に統一（正常運用では観測不変）。**残置(→PR-08)**: check-document-type の handler throw 時に orphan remote が残る現行挙動を保存 / `(error as any).code`。スモーク: 正常PDF OK・txt→pdf 偽装で `check-document-type` 415 を実機確認（extract-drawing は同一 `validateUploadFile` 共有）／`tsc --noEmit`・`prettier --check` 通過。ボット(Gemini Code Assist)対応: **#1** `remoteName` 代入を `unlink` 前へ＝**ACCEPT**（原 extract-drawing 挙動の復元＝`unlink` 失敗時の orphan remote 防止）。**#2/#3** `(error as any).code` の `Object.assign`/`in` ガード化＝**REJECT→PR-08**（error-handling の指定スコープ。本PRは既存パターン保存で `as any` 純増なし）。

### PR-07 `refactor/migrate-google-genai`

- **目的**: 非推奨(legacy)の `@google/generative-ai` を排し `@google/genai` に一本化。
- **対象**: PR-06 のヘルパ、`package.json`、ファイルAPI利用箇所。
- **背景**: `@google/generative-ai` は公式に legacy 化され `@google/genai` への移行が推奨（GA済み）。File API は `ai.files.upload(...)` / `ai.files.delete(...)` 形式に変わる。**着手チャットで公式移行ガイドを最新確認すること**。
- **主な変更**: `GoogleAIFileManager` 依存を撤去し `@google/genai` の Files API に置換。生成側を `@ai-sdk/google` のままにするか `@google/genai` に寄せるかを **着手時に判断・記録**。
- **受け入れ条件**: `@google/generative-ai` への参照が0 / 3経路すべて成功。
- **smoke test**: 必須。判定→トークン→注文抽出の一連フロー、図面抽出を実機確認。

- **実績（#226, merged）**: `GoogleAIFileManager`（`@google/generative-ai/server`）→ `@google/genai` の `new GoogleGenAI({ apiKey })` ＋ `ai.files.upload({ file, config })` / `ai.files.delete({ name })` に差し替え（`lib/ai/pipeline/upload.ts` の upload/delete 両方、`app/api/extract-order/route.ts` の finally delete）。upload 戻り値 `File.name`/`.uri` が **optional 型**のため guard（欠落時 throw＝**成功経路は不変**・異常時のみ既存 500 経路へ合流）を1箇所追加。`package.json` は `@google/generative-ai` 削除／`@google/genai ^2.11.0` 追加（**直接依存±0**、推移的依存は google-auth-library/gaxios/protobufjs/ws 等が増＝統合SDKの性質）。**生成側 `@ai-sdk/google` は不変**（一本化は PR-07b に分離＝owner 合意）。一次情報: `@google/genai` 2.11.0 の型定義で `ai.files.upload` の `mimeType` は `UploadFileConfig` 内が正と確認。smoke: 3経路 200（check-document-type→extract-order のクロス SDK uri 消費含む）・txt→pdf 偽装 415。ボット(Gemini Code Assist)対応: **#1** `mimeType` をトップレベルへ移す提案＝**REJECT**（型定義上 `UploadFileParameters` は `file`/`config` のみ。提案は逆に型エラー）。

### PR-07b `refactor/genai-generate`

- **目的**: 生成側（判定・抽出）を `@ai-sdk/google` から `@google/genai` に寄せ、Gemini SDK を **完全に一本化**する。PR-07（File API 差し替え）の第2段。owner 合意で PR-07 から分離。
- **対象**: `app/api/{check-document-type,extract-order,extract-drawing}/route.ts` の生成呼び出し、`lib/ai/*`（モデル/スキーマ由来）、`package.json`（`@ai-sdk/google`・`ai` が他で未使用なら撤去）。
- **背景**: `ai` の `generateObject` は zod スキーマ（単一真実源 `lib/ai/schemas.ts`）を直接消費するが、`@google/genai` は `generateContent` ＋ `config.responseSchema`（Google Schema）＋ `responseMimeType: 'application/json'`。**着手時に、zod 単一真実源から responseSchema を導出する方法（変換 or アダプタ）を一次情報で確定**し、スキーマの二重管理を避ける。
- **挙動の扱い（refactor）**: **抽出JSON出力の同値性を保存**するのが前提。`generateObject` の zod 検証に相当する後段検証（応答 JSON のパース＋zod 検証）を維持する。
- **相互作用（着手時確認）**: Gemini 3 は **thinking 既定ON**（`drawingSchema.reasoning` の手動CoTと干渉しうる）／料金体系／`thinkingConfig` 取り扱い。付録の **Gemini モデル 3.x 移行 chore**（`@ai-sdk/google` v4 のモデル文字列前提の記述含む）と統合するか分割するかを着手時に判断。
- **受け入れ条件**: 生成側の `@ai-sdk/google` / `ai` 依存が 0（撤去可能なら撤去）／3経路すべて成功／**抽出JSON が PR-07b 前後で同値**（golden set or 実書類 before-after で確認）。
- **smoke test**: 必須。判定→トークン→注文抽出、図面抽出を実機確認＋出力同値性。
- **依存**: PR-07。
- **実績（#235, merged）**: `lib/ai/generate.ts` 新設＝`generateStructured<S extends z.ZodType>`（zod 単一真実源から **`z.toJSONSchema()`**（zod v4 ファーストパーティAPI）で JSON Schema を導出し `$schema` メタキー除去→`generateContent` の `config.responseJsonSchema`+`responseMimeType:'application/json'` で実行→応答を `JSON.parse`+`schema.parse` で検証＝generateObject 相当の後段検証を維持。**thinkingConfig 非設定＝モデル既定の thinking を保存**）。3ルートの `createGoogle`+`generateObject` を置換（プロンプト全文・モデルID・text→file part 順序・token フロー・`normalizeDrawingNo`・extract-order の finally cleanup 不変）。`package.json` から `@ai-sdk/google`/`ai` 撤去＋未参照デバッグ残骸 `test-gemini.ts` 削除（依存0の必要条件）。一次情報: `@google/genai@2.12.0` 型定義で `responseJsonSchema` と `ThinkingConfig` を確認、zod 4.4.3 で3スキーマの変換を実測（`coerce`→number / `.nullable()`→anyOf / `.optional()`→required 除外）、`response.text` は thought part 除外実装（手動 reasoning CoT と非干渉）、Gemini 3.1 Flash-Lite の thinking 既定は **MINIMAL**。smoke: 3経路 200・**同一実書類の抽出JSON before-after 同値**・txt→pdf 偽装 415。ボット(Gemini Code Assist)対応: 「`z.toJSONSchema` は存在しない、`zod-to-json-schema` を導入せよ(critical)」＝**REJECT**（zod v4 公式API。実行時実証＋CI green が反証。推奨パッケージ自身が 2025-11 保守終了しネイティブAPI移行を案内。suggestion の `as any` は規約違反）。

### PR-08 `refactor/error-handling`

- **目的**: 型安全なエラー処理と、クライアントへの内部情報漏えい防止。
- **対象**: `lib/errorUtils.ts`, `lib/crypto.ts`, `app/api/*/route.ts`。
- **主な変更**:
  - `(error as any).code` を撤廃し **型付きエラー**（例: `class ConfigError extends Error { readonly code = 'ERR_SYS_CONFIG' }`）に。
  - `errorUtils` のキー不一致を修正（定義 `"API_SECRET is missing"` ↔ 実 throw `"API_SECRET is not set..."`）。includes マッチではなく **コード/型での分岐** へ。
  - `extract-drawing` / `extract-order` がクライアントに返す内部メッセージ（`Server misconfiguration: GOOGLE_API_KEY...`）を **汎用メッセージ** に統一。
- **受け入れ条件**: 5xx 応答に内部詳細が含まれない / 既知エラーが日本語で正しくマップされる。
- **smoke test**: API_SECRET 未設定など異常系を1ケース確認。
- **実績（#236, merged）**: 新規 `lib/errors.ts` を単一真実源として新設＝安定コード列 `APP_ERROR_CODES`(10種) / 型付き基底 `AppError`(readonly code) / 設定不備専用 `ConfigError`(ERR_SYS_CONFIG) / `as any` を使わない型ガード `isAppErrorCode`・`getErrorCode`(unknown→code) / サーバ用 `errorResponse`(内部 message を本文に載せず code 別の client-safe 汎用文言＋status を返す)・`validationErrorResponse`(400/413/415)。`lib/errorUtils.ts` の `resolveError` を **raw 文字列 includes 分岐から code ベース分岐へ**刷新し、機能していなかった `'API_SECRET is missing'` 分岐を廃止（クライアントには raw が到達し得ず死んでいた**実バグ**＝#204 申し送り）。`crypto.ts` は `throw new ConfigError(...)`、`check-document-type` route も `(error as any).code` を撤廃し型付き化（**`(error as any)` は repo 全体で grep 0件＝撲滅**・方針6）。`extract-order`/`extract-drawing` が返していた内部設定文言（`GOOGLE_API_KEY ...`）をクライアント応答から除去し `errorResponse` の汎用 code＋固定文言へ統一（情報漏えい防止・方針5。応答本文へのキー名露出なしを grep 確認）。フォールバック文言への raw 埋め込み・UI の「詳細: <raw>」表示を撤去（raw は内部限定）。order 経路の `handleApiResponse<S>` で成功応答を `schema.safeParse` により防御的検証しエラー code を伝播（#203 申し送りの応答検証強化。検証済みのため呼び出し側の items 冗長検証は削除）。**残置(→将来)**: check-document-type の handler throw 時の orphan remote cleanup は本PRでは**未対応**（route は `deleteRemoteAfter: false` のまま明示 cleanup なし）＝PR-06 の「PR-08 で併せて検討」項目は別 fix / Phase 4+ へ送り。ボット対応（別コミットで反映）: `resolveError` から `raw` を撤去＋成功応答の冗長 items 検証を削除。Refs #203/#204/#224。

### PR-09 `perf/auth-jwks-singleton`

- **目的**: JWKS の再取得を防ぎ jose のキャッシュを効かせる。
- **対象**: `lib/auth-cloudflare.ts`。
- **主な変更**: `createRemoteJWKSet(...)` を関数内生成→ **モジュールスコープでメモ化**（issuer 単位）。挙動は不変。
- **受け入れ条件**: 認証成功/失敗の挙動が不変。
- **smoke test**: 認証あり/なしリクエストの応答確認（development はスキップ仕様に注意）。
- **実績（#237, merged）**: `createRemoteJWKSet(new URL(JWKS_URL))` の関数内生成を、モジュールスコープの `const remoteJWKSetCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>()` ＋ ヘルパ `getRemoteJWKSet(jwksUrl)`（hit で再利用 / miss で生成＆格納・早期 return）へ。**メモ化のキーは JWKS URL**（`${ISSUER}/cdn-cgi/access/certs`。issuer と 1:1 なので「issuer ごとに1つ」＝計画の『issuer 単位』を実キー準拠に明確化）。挙動不変（dev スキップ・env 毎回読取・ISSUER/JWKS_URL 導出・`jwtVerify` の issuer/audience 検証・エラー処理は現状のまま。差分はリゾルバインスタンスの再利用のみ＝JWKS の HTTP フェッチが跨リクエストでキャッシュされる）。一次情報(jose 公式)確認済: 返り値関数が取得済み JWKS をインスタンス内部にキャッシュし cooldownDuration(既定30s)/cacheMaxAge(既定10分) の範囲で再取得抑制、キー rotation 等の再取得挙動は不変。型 `ReturnType<typeof createRemoteJWKSet>`・`as any` 不使用（方針6）。レビュー対応(別 `docs(auth)` コミット): コメント「issuer(JWKS URL)単位」→「JWKS URL（issuer ごとに1つ）単位」に修正（実キーは JWKS URL との指摘）。smoke: `tsc --noEmit` 0 / `pnpm format:check` green / `pnpm build` green（`.next` 残骸 `ENOTEMPTY: rmdir '.next/build/chunks 2'` は環境要因＝`rm -rf .next` 後に green・コード無関係）。`next dev` は NODE_ENV を development に強制し検証パスをスキップするため、**正常系 auth の実トークン確認は Cloudflare Access(Tunnel) 必須＝ステージング事項**（ローカルは異常系まで）。dev 起動で boot・extract フロー(200) 無回帰確認。

### PR-10 `refactor/logger`

- **目的**: `[v0]` 接頭辞除去、ログ整理、秘匿情報のログ抑止。
- **対象**: `app/`, `lib/`（`console.log`/`[v0]` 約29箇所）。
- **主な変更**: `lib/logger.ts`（環境で出力制御する薄いラッパ）を導入。fileUri / token / displayName 等の **秘匿値をログに出さない**（#195 Copilot High で具体化: `extract-order`/`extract-drawing` の復号トークン内容(`fileUri`,`name`)・`fileManagerName` 出力を含む）。
- **受け入れ条件**: `[v0]` が0件 / 本番想定でデバッグログが抑制される。
- **smoke test**: 主要フローでログに秘匿値が出ないことを目視。
- **実績(#238, merged)**: `lib/logger.ts` 新設（`debug`/`info` を本番=NODE_ENV=production で抑制、`warn`/`error` は常時）。全 `console.*` 実呼び出し27件を logger 経由へ置換・`[v0]` 8件除去（計画「約29箇所」は PR-04〜08 の整理で既に減少済みだった）。秘匿値ログ除去=`extract-order` の復号トークン内容(`{fileUri,name}`)・`fileManagerName`、`crop-title-block`/`use-drawing-analysis` のアップロードファイル名。`error`/`warn` レベルは1:1温存し挙動差は debug/info の本番抑制のみ＝挙動・API応答・zodスキーマ・認証/暗号ロジック不変。ボットレビュー2件（`crop-title-block`: ①`getAll('file')` が `string` を返すと `file.type` undefined で TypeError(500) ②`validateUploadFile` 未使用で magic-byte/25MB 未強制・`file.type`詐称可能）は**未変更コンテキスト行への指摘かつ挙動変更を伴う**ため**全件 REJECT-for-scope**、別 `fix/crop-title-block-validation` へ集約（`instanceof File` チェックが①を内包）。軽微差: `logger.ts` の JSDoc は英語短縮版で merge され「秘匿値を呼び出し側で渡さない」契約行は省略（動作・秘匿抑止は担保・追加対応不要）。

---

## Phase 3 — 品質ゲート

### chore `chore/format-baseline`

- **目的**: v0 由来のフォーマット非準拠（ダブルクォート等）を `.prettierrc` 準拠へ一括正規化し、以降の PR で **format-on-save 混入を構造的に防ぐ**（PR-05 で当該混入が2度発生した学びに基づく先行整備）。
- **対象**: repo 全体（`prettier --write .`）。設定変更なし＝既存 `.prettierrc`（`semi:false` / `singleQuote:true` / `trailingComma:es5` / sort-imports / tailwindcss プラグイン）をそのまま適用。よってクォート/セミコロンに加え **import 順・Tailwind class 順も正規化**される（機械的・大 diff）。
- **主な変更**: ①`package.json` に `format`(`prettier --write .`) / `format:check`(`prettier --check .`) を追加。②`.prettierignore` 新設（`node_modules` / `.next` / `out` / `build` / `coverage` / `*.tsbuildinfo` / `pnpm-lock.yaml` / **`docs/**/*.md`＝計画書・handoff の手書きフォーマット保護**）。③`.git-blame-ignore-revs` 新設し、整形の squash コミット hash を登録（`git blame` 汚染防止。GitHub 自動認識）。④`pnpm format` で一括整形。
- **順序**: 独立・順序依存なし。ただし全ファイル大 diff のため **in-flight PR が無い今（PR-06 前）に単独・短命ブランチで**実施。CI の `prettier --check` 追加は **PR-12 に相乗り**（下記）。
- **やらないこと**: コード挙動・UI・ロジックの変更（純フォーマット）。`.prettierrc` の設定変更。lint 修正（PR-11）。
- **受け入れ条件**: `pnpm format:check` が差分ゼロ / `pnpm build`（または `tsc --noEmit`）green / `git diff` にコード挙動に関わる変更が無い（フォーマットのみ）。
- **smoke test**: 不要（純フォーマット。build green で担保）。
- **実績(#204, merged)**: コード56ファイルを `.prettierrc` 準拠へ一括整形（設定変更なし・`tsc --noEmit` green・`docs/` 無変更）。`.prettierignore` は**当初計画の `docs/**/*.md` から `*.md` へ拡大**（リポジトリ直下の NOTICE/SECURITY も保護するため）し、`next-env.d.ts`・`.prettierrc` も除外に追加。整形で一度混入した `NOTICE.md`/`SECURITY.md` は原文復帰。squash hash を `.git-blame-ignore-revs` へ後追い登録。ボットレビュー5件は**純フォーマット厳守で全件 REJECT**：①`¥` の改行分割は JSX→JS 変換で出力同一＝レンダリング不変と実証（Prettier は JSX 空白を保存）／②`setValueAs`・③`as any`・④`resolveError` キー不一致（**実バグ**）・⑤内部例外の UI 露出（情報漏えい）は既存コードにつき本 PR 対象外とし、③④⑤は **PR-08(error-handling)**、②は別 fix へ申し送り。

### PR-11 `fix/lint-baseline`

- **目的**: PR-12 の lint ゲート導入前に、既存の lint エラーを解消して `pnpm lint` を green にする。
- **対象**: `hooks/use-order-processing.ts`（現状唯一の lint エラー箇所。着手時に `pnpm lint` で全件を再確認）。
- **背景**: #195 の repo 全体 lint で `react-hooks/set-state-in-effect`（`hooks/use-order-processing.ts:64` の effect 内同期 `setPreviewUrl(null)`）が顕在化。react-hooks v7 の既定ルールで、既存コードのアンチパターン。本件は依存更新とは独立。
- **主な変更**: preview URL を effect 内同期 setState ではなく、イベントハンドラでの生成（および適切な revokeObjectURL クリーンアップ）への移行、または effect 構造の見直しによって解消。プレビュー表示の挙動は不変。
- **やらないこと**: フックの機能変更・UI変更（Phase 4+/対象外）。lint エラー解消の最小修正に限定。
- **受け入れ条件**: `pnpm lint` が 0 error / プレビュー表示が従来通り。
- **smoke test**: ファイル選択→プレビュー表示、選択解除→消去が従来通り。
- **実績(#239, merged)**: squash `9b2935b`。`previewUrlRef` 追加＋`updateSelectedFile(file|null)` に selectedFile/previewUrl 更新と旧 Object URL の revoke を集約し、`useEffect` は依存 `[]`・アンマウント時 revoke のみ（body に同期 setState なし）へ変更。呼び出しは `processFile`×1・`handleRemoveFile`×2 を置換（error/logs/status 分岐は不変）。`pnpm lint` 0 error／`tsc --noEmit` 0／prettier 準拠・プレビュー挙動不変。Gemini 指摘1件は **REJECT**：「React 18 StrictMode でプレビュー破損」は ①実プロジェクトは React 19.2.7 ②提案コードは `setPreviewUrl(null)` で lint 未解消＋`eslint-disable` が非エラー行に付き "unused directive" 警告 ③StrictMode の再マウントは初回マウント時のみ（＝ファイル選択前で `previewUrlRef` は null）で主張の時系列が不成立、として一次情報(react.dev)で反証。dev 限定の Fast Refresh 差異は PR 本文で開示済み（production 影響なし）。

### PR-12 `ci/add-lint-typecheck`

- **依存**: PR-11（lint baseline が green である前提）。
- **目的**: 回帰を CI で検知できるようにする。
- **対象**: `.github/workflows/ci.yml`、必要なら `package.json` の scripts。
- **主な変更**: ビルドチェックに加え `pnpm lint` / `pnpm exec tsc --noEmit` / `pnpm format:check` のジョブを追加（`format:check` は `chore/format-baseline` で整形済みの前提。以降の format-on-save 混入を CI で検知）。
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
- [ ] フォローアップ（PR-04 派生・別チャット・`chore/`・EoL駆動）: **Gemini モデル 3.x 移行**。中央化済みのため `lib/ai/models.ts` の3値差し替えのみ（数行 diff）。一次情報（Gemini API 公式 deprecation ページ, 2026-07-05 確認）: `gemini-2.5-flash` / `gemini-2.5-flash-lite` は **shutdown 2026-10-16**。差し替え先＝classify `gemini-2.5-flash-lite`→`gemini-3.1-flash-lite`（公式後継・GA・EoL 2027-05-07）／extractOrder `gemini-2.5-flash`→`gemini-3.5-flash`（公式後継・GA・shutdown 未定）。**extractDrawing は EoL 対象外**（現行 `gemini-3.1-flash-lite` は 2027-05 まで生存）＝`gemini-3.5-flash` 化は純粋な精度アップグレードで **要測定**（境界E: golden set / 実図面 before-after。EoL 分と分割するか要判断）。着手時確認: thinking 既定（#235 で一次確認済み: 3.1 Flash-Lite は既定 **MINIMAL**、`generateStructured` は thinkingConfig 非設定＝モデル既定採用。`response.text` は thought part 除外実装のため手動CoTと非干渉。3.5 系の既定は差し替え時に再確認）／料金体系変更。SDK は `@google/genai` に一本化済み（PR-07/PR-07b 完了）のため `lib/ai/models.ts` の3値差し替えのみで波及なし。
- [x] PR-05 api-frontend-contract（**#203, merged**。`lib/ai/contracts.ts` 新設、抽出API契約型をフロント3ファイルで一本化。`OrderExtractionResult` 非存在の常時 `undefined` 参照7項目を除去。挙動・UI・スキーマ項目は不変。ボット指摘は全件 REJECT= `safeParseFloat` デッドコード削除提案は PR-11 / 応答の防御的検証追加は PR-08 / Prettier 正規化は別 `chore` PR）
- [x] PR-06 gemini-file-helper（**#224, merged**。`lib/ai/pipeline/{types,upload,index}.ts` 新設＝`validateUploadFile`(no-throw union) ＋ `withUploadedFile`(`deleteRemoteAfter` で remote 寿命制御)。両ルートをヘルパ化し extract-drawing にマジックバイト415・サイズ25MB(413) 統一。prompt/schema/model・token・`normalizeDrawingNo` 不変。ボット #1 `remoteName` 順序 ACCEPT／#2#3 `(error as any).code` 撤廃は PR-08 送り。詳細は PR-06 節「実績(#224)」）
- [x] PR-07 migrate-google-genai（**#226, merged**。File API を `@google/genai` の `ai.files.upload`/`ai.files.delete` に差し替え。upload 戻り値 name/uri の optional 型に guard 追加＝成功経路不変。生成側 `@ai-sdk/google` は据え置き。ボット(Gemini Code Assist)「`mimeType` をトップレベルへ」は **REJECT**＝型定義上 `UploadFileParameters` は `file`/`config` のみで `mimeType` は `UploadFileConfig` 内が正、提案は逆に型エラー。生成側一本化は **PR-07b** として新設。詳細は PR-07 節「実績(#226)」）
- [x] PR-07b genai-generate（**#235, merged**。`lib/ai/generate.ts` 新設＝`generateStructured`（zod v4 `z.toJSONSchema()`→`responseJsonSchema`+後段 zod 検証、thinkingConfig 非設定）。3ルート置換・`@ai-sdk/google`/`ai`/`test-gemini.ts` 撤去。抽出JSON before-after 同値を実書類で確認。ボット「`z.toJSONSchema` 不存在」は zod v4 公式APIの実証で **REJECT**。詳細は PR-07b 節「実績(#235)」）
- [x] PR-08 error-handling（**#236, merged**。`lib/errors.ts` 新設＝`APP_ERROR_CODES`/`AppError`/`ConfigError`/`getErrorCode`(型ガード)/`errorResponse`・`validationErrorResponse`(code別 client-safe 文言＋status)。`errorUtils.resolveError` を raw includes 分岐→code 分岐へ刷新し死に分岐 `'API_SECRET is missing'` を廃止（#204 実バグ是正）。`crypto.ts`/`check-document-type` の `(error as any).code` を型付き化＝**`(error as any)` 全撲滅(grep 0件)**、`extract-order`/`extract-drawing` の内部設定文言（`GOOGLE_API_KEY ...`）をクライアント応答から除去し汎用 code へ。order `handleApiResponse` に成功応答 zod 防御検証＋code 伝播。**残置**: check-document-type の orphan remote cleanup は未対応（別 fix 送り）。詳細は PR-08 節「実績(#236)」）
- [x] PR-09 auth-jwks-singleton（**#237, merged**。`lib/auth-cloudflare.ts`: `createRemoteJWKSet` を関数内生成→モジュールスコープの `Map`（**キー=JWKS URL**＝issuer ごとに1つ）でメモ化。ヘルパ `getRemoteJWKSet` 追加、値型 `ReturnType<typeof createRemoteJWKSet>`(`as any` 不使用)。jose の JWKS 内部キャッシュ(cooldownDuration 既定30s / cacheMaxAge 既定10分)を跨リクエスト有効化。挙動不変(認証成功/失敗・issuer/audience 検証・dev スキップ)。コメント文言は #237 レビューで「issuer(JWKS URL)単位」→「JWKS URL（issuer ごとに1つ）単位」に修正。詳細は PR-09 節「実績(#237)」）
- [x] PR-10 logger（**#238, merged**。`lib/logger.ts` 新設＝`debug`/`info` を本番抑制・`warn`/`error` 常時。`console.*`27件を logger 化・`[v0]`8件除去。秘匿値ログ除去=`extract-order` の `{fileUri,name}`・`fileManagerName`／`crop-title-block`・`use-drawing-analysis` のファイル名。挙動・スキーマ・認証/暗号ロジック不変。ボット2件は REJECT-for-scope→`fix/crop-title-block-validation` へ。詳細は PR-10 節「実績(#238)」）
- [x] PR-11 fix-lint-baseline（**#239, merged**。`hooks/use-order-processing.ts` の `react-hooks/set-state-in-effect` を解消＝Object URL 生成/破棄を effect からイベント起点 `updateSelectedFile` へ移し、`useEffect` はアンマウント revoke のみ（deps []）に。lint 0／tsc 0／prettier 準拠・挙動不変。Gemini「StrictMode 破損」指摘は REJECT（React 19／提案は lint 未達＋disable 位置誤り／StrictMode 再マウントは初回のみ＝選択前）。詳細は PR-11 節「実績(#239)」）
- [ ] PR-12 add-lint-typecheck

> リファクタ完了後、別計画書「Phase 4+ ロードマップ（抽出スキーマv2 / フロント業務UI / AIパイプライン最適化 / DB / PDF証憑 / ステータス棚卸し）」を起こす。
