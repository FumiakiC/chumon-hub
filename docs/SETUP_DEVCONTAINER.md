# Dev Container セットアップ手順（1Password 秘匿注入）

このプロジェクトは **VS Code Dev Container** で開発し、**秘匿情報を一切ハードコードせず** 1Password CLI (`op`) で実行時に注入します。
新しいマシン／クローン直後はこの手順で一度だけ環境を整えれば、以降は1コマンドで開発を開始できます。

## セキュリティモデル（先に全体像）

秘匿は2つの認証主体で扱います。**実値はコミットにもイメージにも含めず、永続化しません**（起動中はプロセスの環境変数として存在し、同一ユーザーの他プロセスからは参照され得ます）。

| 対象 | 誰が読むか | 置き場所 |
|------|-----------|---------|
| アプリのシークレット（`GOOGLE_API_KEY` 等） | コンテナ内の **サービスアカウント** | **専用 Vault**（例 `chumon-hub-dev`）。Personal/Private は不可 |
| サービスアカウントトークン (`ops_...`) | **ホストのあなた**（Touch ID / デスクトップ連携） | Personal Vault でOK |

`.env.local` には実値ではなく `op://` 参照だけを書き、`op run` が起動時に解決します。

---

## 0. 前提

- VS Code ＋ **Dev Containers 拡張**
- Docker（Docker Desktop など）
- 1Password アカウント＋デスクトップアプリ＋CLI（`op`）
- ベースイメージは digest 固定済み（`.devcontainer/Dockerfile.dev`）。再現性はリポジトリ側で担保されています。

## 1. 一度だけの準備（ホスト側 / macOS 想定）

1. **デスクトップ連携を有効化**：1Password 8 → Settings → Developer → 「Connect with 1Password CLI」をオン。あわせて Settings → Security → Touch ID をオン。
   - 確認：ターミナルで `op vault list`（Touch ID が出れば連携OK）。
2. **`code` コマンドを導入**：VS Code で `Cmd+Shift+P` →「Shell Command: Install 'code' command in PATH」。
3. **専用 Vault を作成**：例 `chumon-hub-dev`。
   - ⚠️ サービスアカウントは **Personal/Private Vault にアクセスできない**ため、専用 Vault が必須。
4. **アプリのシークレットを専用 Vault に保存**（item/field は任意の命名）：
   - `GOOGLE_API_KEY` / `API_SECRET` / `CLOUDFLARE_TEAM_DOMAIN` / `CLOUDFLARE_AUDIENCE`
5. **サービスアカウントを作成**：1Password.com → Developer → Service Accounts → Create。
   - `chumon-hub-dev` Vault への **read 権限のみ**付与（最小権限）。
   - 表示される **トークン（`ops_...`）を控える**（再表示不可）。
6. **SA トークンを 1Password に保存**：Personal Vault に item（例 `chumon-hub-sa`、field `credential`）として保存。
   - これはホストのあなたが Touch ID で読むので Personal でOK。
7. **`.env.local` を作成**（`.gitignore` 済み・コミットしない）。`.env.example` を参考に op:// 参照で記述：
   ```
   GOOGLE_API_KEY=op://chumon-hub-dev/gemini/api-key
   API_SECRET=op://chumon-hub-dev/app/api-secret
   CLOUDFLARE_TEAM_DOMAIN=op://chumon-hub-dev/cloudflare/team-domain
   CLOUDFLARE_AUDIENCE=op://chumon-hub-dev/cloudflare/audience
   ```
   形式は `op://<Vault>/<Item>/<Field>`。item/field 名は手順4の実際の綴りに合わせる。

## 2. 毎回の起動（トークンをディスクに残さない）

macOS では Dock/Spotlight 起動の VS Code はシェルの環境変数を継承しないため、**ターミナルから `code` で起動**します。
`~/.zshrc` に次の関数を追加すると一語で起動できます：

```bash
chumon() {
  # ↓ あなたのクローン先に置き換える（例: "$HOME/src/chumon-hub" や "$HOME/dev/chumon-hub"）
  local repo="$HOME/src/chumon-hub"
  local t
  t="$(op read 'op://Personal/chumon-hub-sa/credential')" || { echo "op read 失敗（Touch ID/連携を確認）"; return 1; }
  OP_SERVICE_ACCOUNT_TOKEN="$t" code "$repo"
}
```

- リポジトリ内で実行する運用なら、パス指定をやめて `code .`（カレントディレクトリを開く）でも可。

- `source ~/.zshrc` 後、**`chumon`** で「Touch ID → トークン注入 → VS Code 起動」。
- トークンは 1Password と当該 VS Code プロセスのメモリにのみ存在し、ファイル/レジストリには残りません。
- ⚠️ 既存の VS Code は **Cmd+Q で完全終了**してから実行（既存ウィンドウだとトークンが入りません）。
- `devcontainer.json` が `${localEnv:OP_SERVICE_ACCOUNT_TOKEN}` でコンテナへ転送します。

## 3. コンテナ内で起動・検証

VS Code 起動後、**Dev Containers: Reopen in Container**（初回や `remoteEnv` 変更後は Rebuild）。コンテナ内ターミナルで：

```bash
echo "${OP_SERVICE_ACCOUNT_TOKEN:0:4}"          # ops_ なら転送OK
op whoami                                         # サービスアカウントが表示されれば認証OK
op read "op://chumon-hub-dev/gemini/api-key"      # 値が出れば参照解決OK
pnpm dev                                          # op run が .env.local を解決して起動（http://localhost:3000）
```

## 4. op を使わない場合（`pnpm dev:local`）

`op` を介さず起動したいときは、`.env.local` に **実値（プレーンテキスト）** を手動で設定する必要があります。`op://` 参照のままだと名前解決されず、そのままリテラル文字列として渡ってしまうためです（このファイルは絶対にコミットしない）。設定後 `pnpm dev:local` で起動します。

## 5. macOS で高速化する（任意）: ワークスペースを volume にクローン

macOS では bind-mount の I/O が遅く、ワークスペース配下の `node_modules` / `.next` の読み書きがボトルネックになりがちです（pnpm の store がワークスペース内に作られている場合はそれも）。
これを根本的に解消するなら、ホストのフォルダを bind-mount する代わりに、**リポジトリを名前付き volume にクローンして開く**方式が最もクリーンです（個別の symlink 不要でまとめて高速化）。

手順：
1. VS Code を **op トークン付きで起動**する。clone-in-volume の初回はローカルに clone が無いので、フォルダを開かず次で起動：`OP_SERVICE_ACCOUNT_TOKEN="$(op read 'op://Personal/chumon-hub-sa/credential')" code`（ローカル clone が既にあれば `chumon` でも可）。トークンは clone-in-volume でも `${localEnv:OP_SERVICE_ACCOUNT_TOKEN}` でコンテナへ転送される。
2. コマンドパレット（`Cmd+Shift+P`）→ **「Dev Containers: Clone Repository in Container Volume...」** → リポジトリを選択／URL 入力。
3. VS Code が名前付き volume を作成し、その中へクローンしてコンテナを起動。ワークスペース全体が volume 上になるため、`node_modules` / `.next`（および pnpm store がワークスペース内に作られる場合はそれも）が高速。
4. 2回目以降は Recent から同じ volume-backed ワークスペースを開く。

クローン後、コンテナ内で `.env.local`（op:// 参照）を作成し、§3 の検証 → `pnpm dev` へ（op を使わない場合の `.env.local` の扱いは §4 を参照）。

トレードオフ（理解した上で選ぶ）：
- ソースは**ホストのファイルシステムに存在せず、Docker volume 内**にある。Git 操作は VS Code のソース管理／コンテナ内ターミナルで完結する。
- ホスト側の Finder/他エディタからは見えない（コンテナ内で完結して開発する前提なら問題なし）。

bind-mount 版（`chumon` でローカルフォルダを開く）も引き続き有効です。速度が気にならなければそちらで構いません。

## 6. main への直接 push の防止（pre-push フック）

main へのコード変更は PR で行い、CI（quality / build-check）を通してからマージします。`ci.yml` は pull_request でしか起動しないため、main へ直接 push したコード変更は CI を通らずに本番デプロイ（`deploy.yml`）を起動します。これを防ぐため、`.githooks/pre-push` が main への push を次のとおり判定します。

- 許可：main に新しく載るコミットが、すべて `docs/` 配下だけを変更する fast-forward 更新（計画書など docs だけの変更は、引き続き main へ直接 push できる）
- 拒否：`docs/` の外を変更するコミットを1つでも含む push（コミット単位で判定するため、変更とその revert の組も拒否）、マージコミット、non-fast-forward 更新（force push）、main の削除・新規作成、リモートの main の先端がローカルに無い場合（先に `git fetch` する）

このフックはローカルの誤操作を防ぐためのもので、権限制御ではありません。フックを設定していない clone、Web 上の編集、API からの push には効きません。また、フックはチェックアウト中の作業ツリーにある `.githooks/pre-push` が使われるため、それを含まないブランチ（フックの導入前に main から分けたブランチなど）では働きません。そうしたブランチは最新の main に rebase してから push します。許可する範囲の `docs/` は `deploy.yml` の `paths-ignore` に含まれるため、docs だけの push は通常デプロイを起動しません（1,000 を超えるコミットの push など、GitHub がパスで絞り込めない場合は起動します）。

### 6.1 有効化

Dev Container の作成時・再作成時に、`postCreateCommand` がこのリポジトリのローカル設定 `core.hooksPath` を `.githooks` にします。既存のコンテナ、bind-mount 版のローカル clone、その他の clone では、次の確認をしてから手動で1回設定します（`core.hooksPath` を設定すると、それまでのフックの置き場所にあるフックは使われなくなるため）。

```bash
echo '[1] core.hooksPath'; git config --show-origin --get-all core.hooksPath || echo '(未設定)'
d=$(git rev-parse --git-path hooks); echo "[2] フックの置き場所: $d"
if [ -d "$d" ]; then find "$d" -mindepth 1 -maxdepth 1 ! -name '*.sample'; else echo '(ディレクトリなし)'; fi
```

- [1] が `(未設定)` で、[2] の下に何も出ない（または `(ディレクトリなし)`）なら、`git config --local core.hooksPath .githooks` を実行する。
- 既存の設定やフックがある場合は、その内容を確認し、`.githooks` へ移すか廃止するかを決めてから設定する。

設定後は、最新の `origin/main` を起点に `docs/` の外を変更したブランチで `git push --dry-run origin HEAD:main` を実行し、`[pre-push-main-guard]` で始まる行とともに拒否されることを確かめます（`--dry-run` なので何も送信しません）。

### 6.2 拒否されたとき

`[pre-push-main-guard]` で始まる行に、拒否の理由、該当するコミット（短縮 SHA と件名）、`docs/` の外のパスが出ます。main へのコード変更は作業ブランチに push して PR を出してください。想定外の拒否であれば、push をやり直す前に原因を確認します。

### 6.3 例外の運用ルール

- フックを迂回して main へ直接 push するのは、owner が明示的に判断した例外に限る。そのときの手段は `git push --no-verify` に限り、設定の変更やフックの削除・無効化では迂回しない。
- 誤って main に入ったコード変更の取り消しも、原則は revert の PR で行う。PR を待てない場合に限り、owner の判断で上記の手段を使う。迂回した push は CI を通らずにデプロイを起動しうる。
- AI エージェント（Copilot 等）は独断で迂回しない。拒否されたら作業を止めて状況を報告する（`.github/copilot-instructions.md` に記載）。

### 6.4 フックを変更するとき

回帰テスト `bash scripts/githooks/test-pre-push.sh` を実行します（CI の quality ジョブでも実行されます）。`deploy.yml` の `paths-ignore` を変える場合は、`docs/` がその範囲に含まれる関係を保ちます。

## トラブルシュート早見表

| 症状 | 原因 | 対処 |
|------|------|------|
| `echo $OP_SERVICE_ACCOUNT_TOKEN` が空 | ホスト未設定／VS Code 未再起動 | `chumon` で起動し直し、Rebuild Container |
| `op whoami` がエラー | トークン無効／未転送 | トークン再確認。`${localEnv:...}` はホスト環境を見る |
| `op read` が vault/item not found | SA に Vault 権限が無い／Personal に保存／綴り違い | 専用 Vault に read 付与、op:// の綴り確認 |
| 値が `op://...` のまま | `.env.local` がプレースホルダ／`dev:local` を op:// 参照で実行 | op:// 参照に修正、または dev:local 用に実値を記述 |
| 認証を求められる/SA が使われない | `OP_CONNECT_HOST`/`OP_CONNECT_TOKEN` が SA トークンより優先 | Connect 系の環境変数を解除 |
| コマンドが vault 指定を要求 | SA 呼び出しでは多くのコマンドで `--vault` 必須 | `--vault chumon-hub-dev` を付ける |
| push が `[pre-push-main-guard]` で拒否される | main へ docs/ の外の変更・マージ・force push 等を push しようとした | 作業ブランチに push して PR を出す（§6.2） |
| main へ docs/ の外の変更を push しても拒否されない | `core.hooksPath` が未設定（既存のコンテナ・別の clone）、またはチェックアウト中のブランチに `.githooks/pre-push` が無い | §6.1 の確認と設定を行う。ブランチが古ければ最新の main に rebase する |

最初に確認すべきは **`op whoami`**。通れば認証は解決、あとは Vault 権限と op:// の綴りだけの問題に切り分けられます。