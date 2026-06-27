# Dev Container セットアップ手順（1Password 秘匿注入）

このプロジェクトは **VS Code Dev Container** で開発し、**秘匿情報を一切ハードコードせず** 1Password CLI (`op`) で実行時に注入します。
新しいマシン／クローン直後はこの手順で一度だけ環境を整えれば、以降は1コマンドで開発を開始できます。

## セキュリティモデル（先に全体像）

秘匿は2つの認証主体で扱います。**実値はリポジトリにもイメージにも残りません。**

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
  local t
  t="$(op read 'op://Personal/chumon-hub-sa/credential')" || { echo "op read 失敗（Touch ID/連携を確認）"; return 1; }
  OP_SERVICE_ACCOUNT_TOKEN="$t" code "$HOME/Documents/Git/chumon-hub"
}
```

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

`op` を介さず起動したいときは、`.env.local` に **op:// 参照ではなく実値（プレーンテキスト）** を手動で記述し、`pnpm dev:local` を使います（このファイルは絶対にコミットしない）。

## トラブルシュート早見表

| 症状 | 原因 | 対処 |
|------|------|------|
| `echo $OP_SERVICE_ACCOUNT_TOKEN` が空 | ホスト未設定／VS Code 未再起動 | `chumon` で起動し直し、Rebuild Container |
| `op whoami` がエラー | トークン無効／未転送 | トークン再確認。`${localEnv:...}` はホスト環境を見る |
| `op read` が vault/item not found | SA に Vault 権限が無い／Personal に保存／綴り違い | 専用 Vault に read 付与、op:// の綴り確認 |
| 値が `op://...` のまま | `.env.local` がプレースホルダ／`dev:local` を op:// 参照で実行 | op:// 参照に修正、または dev:local 用に実値を記述 |
| 認証を求められる/SA が使われない | `OP_CONNECT_HOST`/`OP_CONNECT_TOKEN` が SA トークンより優先 | Connect 系の環境変数を解除 |
| コマンドが vault 指定を要求 | SA 呼び出しでは多くのコマンドで `--vault` 必須 | `--vault chumon-hub-dev` を付ける |

最初に確認すべきは **`op whoami`**。通れば認証は解決、あとは Vault 権限と op:// の綴りだけの問題に切り分けられます。
