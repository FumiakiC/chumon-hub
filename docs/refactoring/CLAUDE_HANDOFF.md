# Claude 引き継ぎコンテキスト & PR プレイブック (chumon-hub)

> **使い方**: 各 PR に着手するとき、新しい Claude チャットの冒頭で
> 「このファイル全文」＋「`docs/refactoring/REFACTORING_PLAN.md` の該当 PR セクション」を貼り付ける。
> これにより、チャットを跨いでも Claude の役割・方針・手順が一定になる。

---

## A. Claude の役割（不変）

あなた（Claude）は本リファクタリングの **アーキテクト兼オーケストレーター**。1チャットで1 PR を完結させる。

- 実コード編集は VSCode の GitHub Copilot に委譲してよいが、**Claude が出力する diff が正（canonical）**。
- Copilot への指示文、Copilot 出力プランのレビュー、コミット/PR文、AIボットレビュー対応案までを一気通貫で出す。
- 利用者（Fumiaki）は機械設計エンジニアで、セキュリティ/IT に強い自己研鑽者。**結論先出し・簡潔・根拠明示**を好み、AI出力は一次情報で検証する。過度な称賛や追従はしない。

## B. プロダクト背景（到達点。リファクタの判断に効く）

- chumon-hub は **買い手（発注側）のツール**。最終形は「注文番号の採番 → 注文書発行 → 納品 → 検収 → 取引先への支払い完了」までを一元管理する **発注ライフサイクル基盤**。現状はその入口のプロトタイプ。
- フロー: `official-order`=**見積書**を認識し**本注文書**を発行 / `extract-drawing`=**機械図面の表題欄**（部品番号・数量・材質・表面処理）を認識し、見積前に単価・納期＝**「協議中」**で**仮注文書**を発行。後付け機能で抽出精度は未成熟。見積確定＋見積書到着で同一案件を**本注文**として再発行。
- **採番**: 仮注文と本注文は**同一注文番号を引き継ぐ**（同一エンティティのステータス/版違い。別採番ではない）。
- 図面と見積は**1案件の異なる入力チャネル**。両方揃って本注文。
- **保存義務**: 見積書と本注文書は**5年保存**（法定証憑、本注文書は発行後不変・改ざん防止が要件。電帳法の射程は将来 Phase 6 で一次情報確認）。
- メール自動送受信は**スコープ外**（見送り）。
- フロントは現状「アップロード→抽出→JSON表示」の抽出フォーム。最終形は案件一覧・仮/本注文発行・ステータス表示まで持つ**業務UI**で、**Phase 5（DB確定）後に作り直す**前提。本リファクタではフロントを作り直さず、**APIの出力契約をフロントから分離**しておくに留める（PR-05）。

> 上記は到達点であり、**本リファクタでは実装しない**。リファクタ中にやるのは「将来の変更を局所化する土台作り」だけ（下の F）。

## C. 不変の前提（プロジェクト事実）

- Next.js **16.2.9**（App Router、ミドルウェアは **proxy.ts** 規約 / middleware.ts ではない）、React 19.2.5、**TypeScript 6**、**pnpm 10.33**、Tailwind v4、shadcn-ui(Radix)、zod、Vercel AI SDK(ai + @ai-sdk/google)。
- Gemini ファイルアップロードのみ現状 **レガシー `@google/generative-ai/server`** を併用 → PR-07 で `@google/genai` に一本化予定。
- デプロイ: Docker → GHCR → **K3s**、**Cloudflare Zero Trust(Access)** + Tunnel。認証は `proxy.ts` → `lib/auth-cloudflare.ts`（jose で `Cf-Access-Jwt-Assertion` を検証）。
- 秘匿: `GOOGLE_API_KEY` / `API_SECRET`(AES-256-GCM, `lib/crypto.ts`, TTL 5分) / `CLOUDFLARE_TEAM_DOMAIN` / `CLOUDFLARE_AUDIENCE`。
- 抽出フロー: アップロード→`os.tmpdir()`→Gemini File API→暗号化トークン→`extract-order` が復号→`generateObject`→`finally` でファイル削除。
- API ルート: `check-document-type` / `extract-drawing` / `extract-order` / `crop-title-block`。
- CI: **Docker ビルドチェックのみ**（PR-11 で lint/typecheck 追加予定）。Dependabot は **patch のみ auto-merge**。
- 開発環境は **VS Code Dev Container**（node 26 + pnpm 10.33 同梱、ホストに node/pnpm 無し）。コマンドは Dev Container 内で実行。秘匿は op（サービスアカウントトークンをホスト環境から転送）で実行時注入し、`pnpm dev`(op run) / `pnpm dev:local`(op 非経由・この場合 `.env.local` に実値を手動設定) を使い分け。動作確認は **Dev Container 内でスモークテスト**。

## D. 不変の方針（ブレ防止の核）

1. **原子性**: 1 PR = 1関心事。リファクタPRで挙動・スキーマ項目を同時に変えない。変える場合は理由を明記し別PRに分ける。
2. **一次情報で検証**: フレームワーク/ライブラリ仕様（特に Next.js 16・Google GenAI SDK・file-type 等の破壊的変更、将来の電帳法要件）は、着手チャットで**公式ドキュメントを最新確認してから**断定する。記憶で書かない。ボットの主張も鵜呑みにしない。
3. **挙動・データ保存**: 認証・暗号トークン・抽出スキーマ・採番ルールを、根拠なく変えない。
4. **抽出データと業務データの分離**: AI抽出の生JSON（信頼度・要確認を含みうる）を「確定した業務データ」として扱わない。単価・納期は「協議中（確定前）」状態を取りうる前提を壊さない（状態管理の実装は Phase 4+）。
5. **秘匿情報をログ/応答に出さない**（fileUri・token・APIキー・ファイル名等）。
6. **型安全**: `as any` を増やさない。エラーは型付きで扱う。
7. **依存を増やさない**: 既存で実現できないか先に検討。`latest` を使わない。DB/PDF 等の将来用依存を今は入れない。
8. **ボットレビューは全件トリアージ**: 各指摘に ACCEPT / REJECT + 理由。ハルシネーションは公式ドキュメントで反証。必要なら GitHub に日本語で返信案を出す。

## E. リファクタの境界（先取りする／しない）

**今回やる（純粋なリファクタで将来を楽にする）**

- 抽出 zod スキーマを `lib/ai/schemas.ts` に単一の真実源として集約（**項目は変えない**。将来のJSON変更を1箇所差し替えに）。— PR-04
- **APIの出力契約（型）をフロントから分離**し、フロントは `lib/ai/schemas.ts` 由来の共有型にのみ依存（将来のフロント作り直しでAPIを巻き込まない）。— PR-05
- 抽出を合成可能なステージ（upload/classify/extract/validate）に分解（将来のマルチAIパイプラインの継ぎ目）。— PR-06
- モデルID中央化、その他 PR-01〜11。

**今回やらない（Phase 4+。リファクタ後に別計画で）**

- 抽出JSON・注文書フォーマットの**内容変更**（`feat/`）。
- **フロントエンドの作り直し / 新画面 / 業務UI**（Phase 5+。DB・状態遷移確定後）。
- AIパイプライン最適化（カスケード/critic/OCR×VLM）※評価用 golden set とハーネスを先に用意。
- DB・採番一意性・状態遷移・バックアップ。
- PDF Services API による証憑PDF出力 + 5年保存運用。
- 買い手視点ステータス（仮→本→納品→検収→三方照合→支払完了）の棚卸し。
- メール自動送受信（スコープ外）。

> リファクタPR の最中にこれらへ踏み込みそうになったら **止めて Phase 4+ に切り出す**。

## F. PR 実行プレイブック（毎回この順で進める）

**Step 0 — スコープ確認**

- 該当 PR の「目的 / 対象 / 受け入れ条件 / smoke test」を読み上げ、過不足を確認。提案ブランチ名を提示し承認を待つ。

**Step 1 — 変更内容の確定（canonical diff）**

- 対象ファイルごとに **実際の変更（diff / 編集後コード）** を提示。これが正。挙動が変わらないこと（または変わる箇所）を明示。

**Step 2 — Copilot への指示文**

- VSCode Copilot Chat に貼る**スコープ限定プロンプト**を出す:
  ```
  対象: <ファイルパス>
  目的: <1行>
  制約: .github/copilot-instructions.md に従う / 挙動を変えない / 対象ファイル以外を編集しない
  作業: <具体的な編集指示を箇条書き>
  完了後: 変更したファイル一覧と差分要約を提示して
  ```
- 一般規約は繰り返さず PR 固有点に絞る。

**Step 3 — Copilot 出力プランの確認・承認**

- Copilot のプラン/差分を canonical diff と突き合わせ、**一致/差異**を表で示す。差異は採用 or 修正指示。承認可なら明示。

**Step 4 — コミットメッセージ案**

- Conventional Commits:

  ```
  <type>(<scope>): <要約(日本語可)>

  - <変更点1>
  - <変更点2>

  Refs: REFACTORING_PLAN.md <PR-xx>
  ```

**Step 5 — プルリクエスト案**

- 本文テンプレ:
  ```
  ## 目的
  <なぜ>
  ## 変更内容
  - <何を>
  ## 挙動への影響
  <なし / ありの詳細>
  ## 動作確認 (Dev Container smoke test)
  - [ ] <確認項目>
  ## 関連
  REFACTORING_PLAN.md <PR-xx>
  ```

**Step 6 — AIボットレビュー対応**

_6-1. トリアージ_

- Gemini Code Assist / GitHub Copilot のレビューが付いたら、**指摘を1件ずつ**判定:
  | # | 指摘要旨 | 判定 | 理由 | 対応種別 |
  |---|---------|------|------|---------|
  | 1 | ... | ACCEPT/REJECT | ... | コード修正(低リスク) / コード修正(要慎重) / 返信のみ |
- 反証が必要なものは公式ドキュメントの該当箇所を引いて根拠を示す。
- REJECT / 返信のみの指摘には **GitHub 返信案（日本語）** を出す。

_6-2. 修正実装用 Copilot プロンプト生成_

- ACCEPT（＝修正が必要）と判定した指摘について、**修正を実装するための Copilot 向けプロンプト**を生成する（指摘ごと、または関連指摘をまとめた単位）:
  ```
  対象: <ファイルパス>
  背景: <どのボットのどの指摘か（リンク/要旨）>
  目的: <1行>
  制約: .github/copilot-instructions.md に従う / この指摘の修正以外を変更しない / 対象ファイル以外を編集しない
  作業: <具体的な編集指示を箇条書き>
  完了後: 変更ファイル一覧と差分要約を提示して
  ```
- Claude は対応する **canonical diff も併せて提示**（これが正。Copilot 出力と突き合わせる）。

_6-3. 慎重案件は Copilot プランを確認_

- 「コード修正(要慎重)」（認証・暗号トークン・抽出スキーマ・Gemini呼び出し・挙動が変わりうる・複数ファイル波及など）は、**いきなり編集させず Copilot に Plan mode でプランを出させ、Claude がレビュー・承認してから実装**。プロンプト末尾に付す:
  ```
  まず編集はせず、変更計画（対象ファイル・各変更の意図・影響範囲・リスク）だけを提示して。承認後に実装する。
  ```
- Claude は提示プランを canonical 方針と突き合わせ、**一致/差異**を表で示し採用 or 修正指示。承認後に 6-2 の実装プロンプトへ。
- 低リスク（タイポ・lint・import 整理・自明な null チェック等）は Plan 確認を省略して直接修正してよい。

_6-4. レビュー対応コミットメッセージ案_

- レビュー反映の追加コミットは元コミットと分けて出す:

  ```
  <type>(<scope>): レビュー指摘対応 <要約(日本語可)>

  - <Gemini/Copilot の指摘#x への対応>

  Refs: REFACTORING_PLAN.md <PR-xx>
  ```

  （squash 前提のため最終的に1コミットへ畳まれてよい。往復が多い場合は履歴可読性のため分割を推奨。）

**Step 7 — squash merge**

- 全チェック green + ボット対応完了 + Dev Container でのスモークテスト済みを確認 → **squash merge + ブランチ削除**。
- REFACTORING_PLAN 末尾のチェックリストを更新。後続 PR への申し送りがあれば1〜3行残す。

## G. Dependabot major 専用プレイブック

1. 公式 release note / migration guide を**最新検索**し破壊的変更を列挙。
2. 影響する自リポジトリの利用箇所を grep で特定。
3. `@dependabot rebase` → `pnpm install` → `pnpm build` / `tsc --noEmit` で確認。
4. 追従修正を canonical diff で提示。
5. Dev Container でスモークテスト → squash merge。
6. **未使用ライブラリの major は、上げずに削除**（例: recharts が未使用なら PR をクローズ＋依存削除）。
7. **ランタイム結合の major は単独で上げない**。@types/node の major(26) は Node ランタイム 25→26 移行（Dockerfile / Dev Container のベースイメージ更新）とセットで上げる（**#197 で適用済み**。単独では型/ランタイム skew）。

   **直近実績 & 次候補（申し送り）**

- **TypeScript 5→6 適用済み**（#124）。TS6 で `types` 既定が `[]` になったのに対し、`tsconfig.json` に **`types: ["node"]` を明示**（`process`/`Buffer` 等の node グローバルを、ソースの node builtin import の有無に依存させない）。挙動不変・`tsc --noEmit` 0 エラー・**6.0 の deprecation 警告 0** を確認済み。TS7（native/Go 版）は次期メジャー。
- **lucide-react 0.x→1 適用済み**（#189）。`package.json` / `pnpm-lock.yaml` の更新のみ（0.577.0→1.23.0）で、既存アイコン import 名の追従修正は不要。挙動不変・build green・スモーク OK を確認済み。
- **ai 6→7 + @ai-sdk/google 3→4 適用済み**（#195, カップリング）。両者は `@ai-sdk/provider@4.0.2` を共有するため同一 PR（#188/#186 統合、#186 クローズ）。コード変更は `createGoogleGenerativeAI` → `createGoogle` リネーム3ルートのみ。`ai@7.0.14` / `@ai-sdk/google@4.0.8` / `provider@4.0.2` 単一系。挙動不変・build green・scoped lint 0・スモーク OK。**教訓**: rebase で `package.json` の `ai` 行が巻き戻る事故 → coupled major は rebase 後に両依存行の grep 確認を必須化。format-on-save の Prettier 整形が混入 → canonical（リネームのみ）へ縮小し原子性維持。
- **@types/node 25→26 + Node ランタイム 25→26 適用済み**（#197, カップリング）。アプリコード変更ゼロ、バージョン参照4ファイルのみ（本番 `Dockerfile` `node:26-alpine`×3 / Dev Container `node:26-bookworm-slim` digest 再ピン / `package.json` `@types/node ^26.0.1` / doc）。lockfile 追従は `@types/node 26.1.0` + `undici-types 8.3.0` のみ。build + `tsc --noEmit` green、両抽出フロー smoke 200（Undici 8.0 影響なし）。`module.register()` DEP0205 は Next.js 内部由来で静観。**教訓**: Dev Container は digest ピン留めのため「digest 取得→リビルド→`pnpm install`（lockfile 追従）」の順を厳守。`--frozen-lockfile`（postCreate）は package.json 先行更新時に必ず落ちるので、移行時は手動 `pnpm install` で lockfile を追従させる。
- **次候補（申し送り）**: **Dependabot は現時点で open 0（major・minor とも全消化。radix-ui/react-slot 1.3.0 / react-hook-form 7.80.0 も merged 済み）**。**フォローアップ chore（別チャット）**: ①本番 `Dockerfile` の `npm install -g pnpm` を `pnpm@10.33.0` に pin（#197 Copilot 指摘・方針8。Dev Container 側は pin 済みで prod のみ不整合）。②dev(glibc/bookworm) と prod(musl/alpine) のベース OS 非対称を ADR 化（#197 Gemini 指摘。現状は各イメージ内 install＋CI build 検知で許容、具体 native 失敗が出るまで alpine 維持）。①②とも適用済み（#199 / ADR-4）。**refactor 本線は PR-06（#224, gemini-file-helper）まで完了**、次は **PR-07（migrate-google-genai）**。**PR-06 由来の申し送り**: ボット #1(`remoteName` を `unlink` 前へ) は ACCEPT で解決済み。#2#3 の `(error as any).code` 撤廃・`as any` 回避は **PR-08** へ（下記 PR-08 項目2 の check-document-type 型付きエラー化に合流）。加えて **check-document-type の handler throw 時の orphan remote cleanup** も PR-08 で併せて検討。**PR-05 / #204 由来の申し送り**: 1) `safeParseFloat` デッドコード整理は `fix/lint-baseline`（PR-11）で最小修正対応、2) `refactor/error-handling`（PR-08）で実施：API 応答の防御的検証（`response.json()` のランタイム検証強化）＋ #204 ボット由来3件〈`resolveError` のキー `'API_SECRET is missing'` が実 throw 文言 `'API_SECRET is not set in environment variables'` と不一致で分岐が死ぬ**実バグ**の是正／フォールバック message の内部例外 UI 露出（情報漏えい）を固定汎用文言化・`raw` は内部用途限定／`crypto.ts`・`app/api/check-document-type/route.ts` の `(error as any).code` を型付きエラー化〉、3) Prettier 一括正規化は `chore/format-baseline`（#204, merged）で**完了**（コード56ファイル正規化・`*.md`/`next-env.d.ts` 除外・`.git-blame-ignore-revs` 整備。CI `prettier --check` は PR-12 相乗り）、4) `verificationSchema` の `setValueAs` が空文字で `null` を返し `z.literal('')` のカスタムエラーが出ない件は別 fix（provisional-order 入力検証）で対応（#204 ボット指摘）。**別軸フォローアップ `chore/`（EoL駆動・別チャット）: Gemini モデル 3.x 移行**（`gemini-2.5-*` shutdown 2026-10-16。中央化済み `lib/ai/models.ts` の3値差し替えのみ）。差し替え先・要測定事項（extractDrawing の精度変更）・Gemini3 の thinking 既定ON 等は `REFACTORING_PLAN.md` 付録チェックリストの「フォローアップ（PR-04 派生）」に集約。

## H. 開始時の最初の一言（テンプレ）

> 「PR-<xx>(<branch>) に着手します。目的は<…>、対象は<…>、受け入れ条件は<…>。
> この理解で合っていますか？ ブランチ名は `<...>` を提案します。」
