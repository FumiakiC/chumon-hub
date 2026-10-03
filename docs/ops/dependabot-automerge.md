# Dependabot auto-merge の構成と運用

## GitHub App トークンにした理由

`GITHUB_TOKEN` で有効化した auto-merge のマージは、後続のワークフローを起動しない。これは GitHub の仕様である（`workflow_dispatch` / `repository_dispatch` を除く）。

そのため、patch アップデートの自動マージ分が [deploy.yml](../../.github/workflows/deploy.yml) で本番に反映されていなかった。

[dependabot-auto-merge.yml](../../.github/workflows/dependabot-auto-merge.yml) で、auto-merge を GitHub App のトークンで有効化するように変更して解消した。

## 自動マージの対象

auto-merge を有効化するのは、次の両方を満たす PR だけである。判定は dependabot-auto-merge.yml の `Decide auto-merge eligibility` ステップが行う。

- `fetch-metadata` の `update-type` が `version-update:semver-patch` である（PR 内で最大の semver 変更）。
- `fetch-metadata` の `dependency-group` が、許可リスト `npm-patch` / `nextjs` / `react` のいずれかである。

次の PR は対象外で、手動でマージする。

- グループ除外依存（`@google/genai` / `pdfjs-dist` / `@napi-rs/canvas` / `zod`）の更新。patch を含む。マージ前の確認は「グループ除外依存の更新をマージする前の確認」の節。
- セキュリティ更新。グループ化されているかどうかを問わない。
- minor / major の更新。

許可リストは [dependabot.yml](../../.github/dependabot.yml) のグループ名の写しである。自動マージ対象のグループを追加・改名する場合は、同じ PR で許可リストも更新する。写し漏れは、自動マージされない側に倒れる。

決定の内容と根拠は、計画書の「決定事項と未決事項」表の「グループ除外依存の patch 自動マージ」にある。

## 構成要素と所在

秘匿値そのものは本書に記載しない。

| 構成要素 | 所在・設定 | 備考 |
|---|---|---|
| GitHub App | 権限は Contents RW / Pull requests RW、Webhook 無効 | インストール先は本リポジトリのみ |
| 1Password vault | `chumon-hub-ci` | |
| 1Password item | `github-app-automerge`（Secure Note） | field `client-id`（text）と添付ファイル `private-key`（PEM） |
| 1Password サービスアカウント | `chumon-hub-ci-automerge` | `chumon-hub-ci` の Read Items のみ（作成後は変更不可）。Dev Container 用 SA とは別。トークンは Personal vault の item `chumon-hub-ci-sa`（field `credential`）に保管 |
| Dependabot secret | `OP_SERVICE_ACCOUNT_TOKEN` | Dependabot 起動のワークフローは Dependabot secrets しか参照できないため、Actions secret ではない |

## 処理の流れ

1. `fetch-metadata` で更新種別（`update-type`）とグループ名（`dependency-group`）を取得する（`GITHUB_TOKEN`・read）。
2. 自動マージの対象かどうかを1ステップで判定し、判定に使った値と結果をログに出す。
3. 対象のときだけ、1Password から Client ID と秘密鍵を step output に読み込む。
4. `create-github-app-token` で、本リポジトリ限定・contents / pull-requests write のトークンを発行する。トークンはジョブ終了時に失効する。
5. `gh pr merge --auto --squash` で auto-merge を有効化する。

3〜5 は、2 の判定結果だけを条件にする。対象外の PR では資格情報を読まない。

ジョブは、PR 作成者とイベント主体がともに Dependabot の run でだけ動く。人が reopen / push した run はスキップされる（その run には Dependabot secrets が渡らないため）。

マージ後の `deploy.yml` は `concurrency` で直列化している。

## 初回セットアップと事前確認

### セットアップ手順

**すべてホスト Mac のターミナルで実施する。Dev Container 内では Personal vault を読めない。**

1. GitHub App を作成する（権限・Webhook・インストール先は「構成要素と所在」のとおり）。
2. vault を作成する。

```sh
op vault create chumon-hub-ci
```

3. item を作成する。PEM はフィールドに貼らず、ファイル添付で保存する（改行保持のため）。

```sh
op item create --category "Secure Note" --title github-app-automerge --vault chumon-hub-ci 'client-id[text]=<Client ID>' "private-key[file]=<pemのパス>"
```

保存後にローカルの `.pem` を削除する。

4. 1Password.com のウィザードでサービスアカウントを作成し、「Save in 1Password」で Personal に保存する。既定名「Service Account Auth Token: …」は改名する。

```sh
op item edit '<既定名>' --vault Personal --title chumon-hub-ci-sa
```

5. SA トークンを Dependabot secret として登録する。`op read` が失敗して空値で上書きしないよう、トークンを確認してから登録する。対話シェルに貼る前提のため `exit` は使わない。

```sh
SA="$(op read 'op://Personal/chumon-hub-ci-sa/credential')"
if [ "${SA:0:4}" = "ops_" ]; then
  printf '%s' "$SA" | gh secret set OP_SERVICE_ACCOUNT_TOKEN --app dependabot --repo FumiakiC/chumon-hub
else
  echo "NG: トークンを取得できないため登録しない"
fi
unset SA
```

gh を使わない場合は、GitHub の Web UI で登録する。

1. 1Password で `Personal` vault の item `chumon-hub-ci-sa` を開き、field `credential` の値が `ops_` で始まることを確かめてからコピーする。
2. リポジトリの **Settings** を開き、サイドバーの「Security」節で **Secrets and variables** → **Dependabot** を選ぶ。
3. **New repository secret** を押す。**Name** に `OP_SERVICE_ACCOUNT_TOKEN` を入力し、値を貼り付けて **Add secret** を押す。登録済みの値を差し替えるときは、一覧の `OP_SERVICE_ACCOUNT_TOKEN` の **Update** から行う。
4. **Dependabot** の一覧（**Actions** の一覧ではない）に `OP_SERVICE_ACCOUNT_TOKEN` が表示されることを確かめる。

### 事前確認

SA トークンで必要な値だけが読めることを確認する。鍵本体は画面に出さない。

```sh
SA="$(op read 'op://Personal/chumon-hub-ci-sa/credential')"
[ "${SA:0:4}" = "ops_" ] && echo OK || echo NG
```

`OK` のときだけ以下に進む。`SA` が空のまま進むと、SA としての検証にならない。

```sh
OP_SERVICE_ACCOUNT_TOKEN="$SA" op vault list
OP_SERVICE_ACCOUNT_TOKEN="$SA" op read 'op://chumon-hub-ci/github-app-automerge/client-id'
OP_SERVICE_ACCOUNT_TOKEN="$SA" op read 'op://chumon-hub-ci/github-app-automerge/private-key' | head -c 31; echo
OP_SERVICE_ACCOUNT_TOKEN="$SA" op read 'op://chumon-hub-ci/github-app-automerge/private-key' | wc -l
unset SA
```

- `op vault list` に `chumon-hub-ci` のみが表示される。
- client-id が読み出せる。
- private-key の `head -c 31` が `-----BEGIN RSA PRIVATE KEY-----` である。
- private-key の `wc -l` が 20 行以上である。

**zsh は対話時に `#` をコメントとして扱わない。** コメント付きのコマンドを貼る場合は、先に以下を実行する。

```sh
setopt interactivecomments
```

## グループ除外依存の更新をマージする前の確認

`@google/genai` / `pdfjs-dist` / `@napi-rs/canvas` / `zod` の更新は、patch を含めて手動でマージする。何を確認するかの正は計画書の「決定事項と未決事項」表の「グループ除外依存の patch 自動マージ」で、本節はその手順である。

### 準備

Dev Container 内で、PR のブランチを取得して依存を入れる。

```sh
git fetch origin
git switch <PR のブランチ名>
pnpm install --frozen-lockfile
```

測定は、未コミットの変更が無い状態で行う（結果 JSON の `appDirty` / `goldenDirty` が `false`。[GOLDEN_SET.md](../eval/GOLDEN_SET.md)）。

### 依存ごとの確認

| 依存 | 確認 |
|---|---|
| `@google/genai` | C1 を測定する。ハーネスの対象は `extractDrawing` のみのため、`classify` / `extractOrder` は「見積書側のスモーク」で確かめる |
| `pdfjs-dist` / `@napi-rs/canvas` | リリースノートに描画に関わる変更があれば、C1 を測定する |
| `zod` | CI の test で `lib/ai/response-json-schema.test.ts` のスナップショットが red になったら、差分をレビューし、意図した変更であることを確かめる。その後にスナップショットを更新して PR のブランチにコミット・push し、C1 を測定する |

スナップショットの更新:

```sh
pnpm exec vitest run --update lib/ai/response-json-schema.test.ts
```

C1 の測定は、計画書 §3.2 の before と同じ条件（dpi 300・4 run）で行う。次を4回実行する。

```sh
pnpm eval:drawing --stage C1
```

結果は、次の2つを分けて記録する。

- 計画書 §3「Phase 4a 詳細計画」14. の受け入れ条件 (a)(b)(c) ごとの合否（#355 と同じ）
- 計画書 §3.2 の「before の基準」にある直近の before との差分

受け入れ条件に合格しても、before から低下していないとは限らない。低下した項目があれば、確認した内容とマージを判断した理由を記録に残す。

`@google/genai` の更新と、スナップショットが変わる `zod` の更新では、この測定が新しい before になる。マージ後に計画書 §3.2 の「before の基準」を更新する。

### 見積書側のスモーク

`classify` / `extractOrder` には golden set もハーネスも無い。測定手段が決まるまでの暫定として、代表例で疎通と基本動作を確かめる。抽出精度全体の回帰評価ではない。

入力と期待結果は、private repo `chumon-hub-golden` の `smoke/` に置く。取引先の実データになりうるため、本リポジトリ（公開）には置かない。置くものは次のとおり。

- 見積書1件と図面1件。それぞれに ID を付け、記録には ID を使う（ファイル名には取引先名が入りうるため）。図面は golden set のケースを使ってよく、その場合は caseId を ID にする。
- 見積書と図面それぞれの期待分類。`isQuotation` の値と、`documentType` として許容する表記である。`documentType` は列挙型ではない自由記述なので、許容する表記を列挙する。
- 見積書の期待結果（主要項目・明細・数量）。

1. 「準備」の状態で `pnpm dev` を起動する。
2. 本注文書作成の画面で見積書をアップロードする。処理ログの判定結果が「✅ `<documentType>`と認定。」であること（`isQuotation` が `true`）と、`documentType` が許容する表記のいずれかであることを確かめる。続けて解析まで進み、解析結果の主要項目・明細・数量が期待結果と一致することを確かめる。
3. 同じ画面で図面をアップロードする。処理ログの判定結果が「❌ 見積書・発注書ではありません (`<documentType>`)。処理を中断します。」であること（`isQuotation` が `false`）と、`documentType` が許容する表記のいずれかであることを確かめる。

許容する表記に無い `documentType` が出た場合は不合格とする。表記ゆれと判断して許容する表記に加える場合は、理由とともに private 側にコミットしてから確かめ直す。

「その他」のように種別を特定しない値は、「図面」の表記ゆれとして加えない。図面で「その他」も合格とする場合、確かめられるのは「見積書ではないと判断できた」ことまでで、「図面として識別できた」こととは区別する。期待分類ではこの2つを分けて列挙し、記録にはどちらに該当したかを書く。

### 記録

PR は公開されるため、公開側には評価指標と合否だけを書き、再現に要るデータは private 側に置く。

PR のコメント（公開）に書くもの:

- 本体のコミット（測定・確認に使った PR の head の SHA。C1 では結果 JSON の `appCommit`）と、更新後の依存のバージョン
- golden 側のコミット（C1 では結果 JSON の `goldenCommit`。スモークでは `smoke/` を読んだ時点の HEAD）
- 使用したケース（C1 は対象ケース。全件なら件数。スモークは `smoke/` の ID）
- C1 の受け入れ条件ごとの合否と値、直近の before との差分、低下があればその確認内容とマージを判断した理由
- スモークの項目ごとの合否

抽出した値と、取引先を特定できる情報（ファイル名など）は書かない。

private 側（`chumon-hub-golden`）には、C1 の結果 JSON を commit・push する（ハーネスの既定の出力先は golden repo の `results/`）。スモークの不一致の詳細（抽出した値など）を残す場合も、private 側に置く。

## 自動マージの条件を変えたときの切り替え

条件を変えても、有効化済みの auto-merge は解除されない。条件を狭める変更を main にマージした後は、次の順で既存の PR を処理する。一覧はどれも全件を確かめ、取得の上限で切れた一覧では判断しない。

1. 旧定義の run が残っていないことを確かめる。旧定義の run は、後から auto-merge を有効化しうる。gh では、未完了の状態ごとに絞り込んだ一覧が、すべて空であることを確かめる。絞り込みはサーバー側で行われるため、空であれば該当する run は無い。1件でも出れば、完了を待ってから取り直す。

```sh
for s in requested queued pending waiting in_progress; do
  echo "== $s"
  gh run list --repo FumiakiC/chumon-hub --workflow dependabot-auto-merge.yml --status "$s" --json databaseId,displayTitle,createdAt
done
```

Web UI では、**Actions** タブで「Dependabot Auto Merge」を選び、一覧の全ページで、完了していない run（実行中・待機中）が無いことを確かめる。

2. auto-merge が有効な Dependabot の PR を洗い出す。gh では次を実行し、`total=` の件数が `--limit` 未満であることを確かめる。`--limit` と同じなら、`--limit` を増やして取り直す。

```sh
gh pr list --repo FumiakiC/chumon-hub --app dependabot --state open --limit 200 --json number,title,autoMergeRequest --jq '"total=\(length)", (.[] | select(.autoMergeRequest != null) | "\(.number) \(.title)")'
```

Web UI では、**Pull requests** タブで `is:pr is:open author:app/dependabot` を検索し、全ページの PR を開いて、マージボックスに **Disable auto-merge** が表示されるかで見分ける。

3. 洗い出した PR ごとに、新しい条件の対象かどうかを判定する。判定は「patch であること」と「許可リストのグループであること」の両方で行う。`nextjs` / `react` のグループは minor も含むため、グループ名だけでは判定できない。題名（`the npm-patch group` / `the nextjs group` / `the react group` を含むか）は、候補を絞る目安にだけ使う。
   - **新定義の判定ログがある場合**: PR の現在の head に対する Dependabot Auto Merge の run に `Decide auto-merge eligibility` ステップがあれば、そのログの `eligible` に従う。`eligible=false` なら auto-merge を解除する。
   - **判定ログが無い場合**: auto-merge を解除してから、手動で確かめる。PR の Dependabot のコミットのメッセージで、`updated-dependencies` の各依存の `update-type` がすべて `version-update:semver-patch` で、かつ `dependency-group` が許可リストにあれば対象である。対象と確かめた PR は、4. で auto-merge を有効化し直させる。

判定ログの確認（gh）。run が複数あれば最新のものを見る。run が無い場合と、最後のコマンドで何も出ない場合（旧定義の run）は、判定ログが無い。

```sh
gh pr view <PR番号> --repo FumiakiC/chumon-hub --json headRefName,headRefOid
gh run list --repo FumiakiC/chumon-hub --workflow dependabot-auto-merge.yml --branch <headRefName> --commit <headRefOid> --json databaseId,createdAt
gh run view <databaseId> --repo FumiakiC/chumon-hub --log | grep -E "update-type='[^\$']*' dependency-group='[^\$']*' eligible=(true|false)"
```

コミットのメッセージの確認（gh）。Web UI では、PR の **Commits** タブで Dependabot のコミットを開く。

```sh
gh pr view <PR番号> --repo FumiakiC/chumon-hub --json commits --jq '.commits[0].messageBody'
```

auto-merge の解除は、Web UI では PR のマージボックスの **Disable auto-merge** を押す。gh では次を実行する。

```sh
gh pr merge <PR番号> --disable-auto --repo FumiakiC/chumon-hub
```

4. 対象と確かめた PR と、最新の main で CI を通し直したい PR には、`@dependabot rebase` とコメントする。新定義の run が判定し、対象の PR だけ auto-merge を有効化する。

## 動作確認

- 許可リストのグループの patch PR で、判定ステップのログが `eligible=true` になり、3 ステップ（1Password 読み込み・App トークン発行・auto-merge 有効化）が成功する。
- 対象外の PR（グループ除外依存の更新、minor / major、セキュリティ更新）で、判定ステップのログが `eligible=false` になり、3 ステップがスキップされる。
- PR タイムラインで、auto-merge を有効化した主体が App の bot になっている。
- マージ後に Build and Deploy が push で起動し、rollout まで成功する。

## ローテーション

### App 秘密鍵

1. App 設定で新しい秘密鍵を生成する。
2. 1Password の添付ファイル `private-key` を差し替える。
3. 次回実行の成功を確認する。
4. 旧鍵を削除する。

### SA トークン

1. SA トークンを再発行する。
2. Dependabot secret `OP_SERVICE_ACCOUNT_TOKEN` を更新する（gh または Web UI。手順は「セットアップ手順」の 5.）。
3. 旧トークンを失効させる。

## 障害時の切り分けと巻き戻し

| 症状 | 想定原因 |
|---|---|
| 1Password ステップが失敗する | Dependabot secret が未登録、Actions secret 側に登録している、SA に vault 権限がない |
| トークン発行が失敗する | Client ID と鍵の不一致、App が未インストール、PEM の改行消失 |
| auto-merge の有効化が失敗する | リポジトリ設定の Allow auto-merge がオフ、App の権限不足 |
| マージ後にデプロイが起動しない | 有効化主体が `github-actions[bot]` のまま（旧ワークフローで処理された PR） |
| patch なのに auto-merge が有効化されない | 自動マージの対象外（グループ除外依存の更新・セキュリティ更新）。判定ステップのログの `update-type` / `dependency-group` で確かめる。自動マージ対象のグループを追加・改名し、許可リストの更新が漏れた場合もこうなる。`fetch-metadata` が Dependabot のコミットを検証できなかった場合は両方が空になる（`Dependabot metadata` ステップのログに警告が出る） |

旧ワークフローで処理された PR は、マージ済みかどうかで対処が異なる。

- **未マージ**: auto-merge を一度無効化してから、Dependabot にリベースさせてワークフローを再実行する。再実行した run が App のトークンで auto-merge を有効化し直す。

```sh
gh pr merge <PR番号> --disable-auto --repo FumiakiC/chumon-hub
```

Web UI では、PR のマージボックスで **Disable auto-merge** を押す。

```text
@dependabot rebase
```

- **マージ済み**: `deploy.yml` は push でのみ起動し（docs のみの変更を除く）、手動で起動する手段はない。main に次の push が入れば、その時点の main がビルドされ、未反映分もまとめて本番に出る。

### 巻き戻し

- **GitHub App トークン化（#356）を戻す**: #356 を revert する。auto-merge は `GITHUB_TOKEN` 方式に戻り、**デプロイされない欠陥も戻る。**
- **許可リストによる対象の限定（計画書 1c ④）を戻す**: その PR を revert する。グループ除外依存の patch と、patch のセキュリティ更新も、再び自動マージされる。
