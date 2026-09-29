# Dependabot auto-merge の GitHub App トークン化

## 目的と原因

`GITHUB_TOKEN` で有効化した auto-merge のマージは、後続のワークフローを起動しない。これは GitHub の仕様である（`workflow_dispatch` / `repository_dispatch` を除く）。

そのため、patch アップデートの自動マージ分が [deploy.yml](../../.github/workflows/deploy.yml) で本番に反映されていなかった。

[dependabot-auto-merge.yml](../../.github/workflows/dependabot-auto-merge.yml) で、auto-merge を GitHub App のトークンで有効化するように変更して解消した。

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

1. `fetch-metadata` で更新種別を取得する（`GITHUB_TOKEN`・read）。
2. patch のときだけ、1Password から Client ID と秘密鍵を step output に読み込む。
3. `create-github-app-token` で、本リポジトリ限定・contents / pull-requests write のトークンを発行する。トークンはジョブ終了時に失効する。
4. `gh pr merge --auto --squash` で auto-merge を有効化する。

minor / major では資格情報を読まない。

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

5. SA トークンを Dependabot secret として登録する。

```sh
op read 'op://Personal/chumon-hub-ci-sa/credential' | gh secret set OP_SERVICE_ACCOUNT_TOKEN --app dependabot --repo FumiakiC/chumon-hub
```

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

## 動作確認

- Dependabot の patch PR で、Dependabot Auto Merge ワークフローの 3 ステップ（1Password 読み込み・App トークン発行・auto-merge 有効化）が成功する。
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
2. Dependabot secret `OP_SERVICE_ACCOUNT_TOKEN` を更新する。
3. 旧トークンを失効させる。

## 障害時の切り分けと巻き戻し

| 症状 | 想定原因 |
|---|---|
| 1Password ステップが失敗する | Dependabot secret が未登録、Actions secret 側に登録している、SA に vault 権限がない |
| トークン発行が失敗する | Client ID と鍵の不一致、App が未インストール、PEM の改行消失 |
| auto-merge の有効化が失敗する | リポジトリ設定の Allow auto-merge がオフ、App の権限不足 |
| マージ後にデプロイが起動しない | 有効化主体が `github-actions[bot]` のまま（旧ワークフローで処理された PR） |

旧ワークフローで処理された PR は、PR に以下をコメントして再実行する。

```text
@dependabot rebase
```

### 巻き戻し

本変更の PR を revert する。auto-merge は `GITHUB_TOKEN` 方式に戻り、**デプロイされない欠陥も戻る。**
