# k3s 本番と repo のマニフェストの照合

## 目的と位置づけ

repo の `k8s/` と本番（k3s）の実体が一致しているかを、秘匿値を出力せずに確かめる手順と、その結果の記録。

[`deploy.yml`](../../.github/workflows/deploy.yml) はマニフェストを apply しない（[k3s-node-config.md](k3s-node-config.md)）。手動の `kubectl` 操作で本番を変えると、repo と本番は乖離する。**repo のマニフェストをレビューしても、本番を検証したことにはならない。**

本書は計画書のエポック表 1b の `fix/manifest-drift` の ①（repo と本番を揃え、手動で行った Secret 化を記録する）にあたる。② CI での差分検出と ③ `deploy.yml` での自動 apply は、計画書「決定事項と未決事項」の「マニフェスト適用の自動化と Secret 管理」のとおり、ADR-1 の決定より先に着手しない。k3s を撤去するときに、本書と `tools/` を削除する。

## 道具

| ファイル | 用途 |
|---|---|
| [`tools/collect_live_state.py`](tools/collect_live_state.py) | 本番の Deployment（chumon-hub・cloudflared）・Service・旧 ReplicaSet・Secret のキーを、repo の指定コミットと照合する。段階1は読み取りだけ。段階2はサーバー側 dry-run の `kubectl diff` |
| [`tools/apply_service_portname.py`](tools/apply_service_portname.py) | 2026-10-10 の Service のポート名の是正に使った。状態確認（`--status`）と切り戻し（`--rollback`）も持つ |

両方に共通する規則: `kubectl` の生のエラー文と、検証していない値を表示しない。失敗したら、操作名・終了コード・分類だけを出して止まる。

`collect_live_state.py`:

- 値を出すのは、repo の値と一致した値・数値・既知の安全な値だけ。それ以外は伏せて「未確認」として数える。**未確認 0 は、秘匿値が無いことの証明ではない**（既知の安全な値以外が見つからなかったという意味）。
- 取得したオブジェクトをファイルに保存しない。段階2で `kubectl diff` が内部で作る一時ファイルは tmpfs（`/dev/shm`）上の専用ディレクトリに置き、削除を確認する。`/dev/shm` が tmpfs でない場合と、swap が有効または状態を読めない場合は止まる（`--accept-swap` で明示的に許可しない限り）。

`apply_service_portname.py`:

- 想定外の値は数えずに止まる。想定外の変更は、件数と spec / metadata のどちらの配下かだけを出す。
- 書き込みは JSON Patch で、確認時の uid・`resourceVersion`・last-applied 注釈を `test` 操作の条件にする。
- 切り戻し情報（uid と書き込み前後の last-applied 注釈。repo の公開済みの内容と一致することを確認したもの）を、スクリプトと同じ場所の `svc-portname-work/`（0700、ファイルは 0600）に保存する。取得したオブジェクトそのものは保存しない。
- 終了コード 5〜7（書き込み後の確認失敗・結果不明・拒否）のときは、再試行や切り戻しをせず、読み取りだけの `--status` で状態を確かめる。

## 照合の手順

本番ホストで実行する。k3s 同梱の `kubectl` は既定で `/etc/rancher/k3s/k3s.yaml`（root だけが読める）を使うため、`sudo` を付ける。context は `default`（2026-10-10 時点）。

```sh
SHA=<比較元にする main の完全な 40 桁のコミット SHA>
# 毎回、新しい空のディレクトリに取得する。取得が途中で失敗すると .part のまま残り、実行用の名前のファイルは作られない
D=$(mktemp -d)
curl -fsSL "https://raw.githubusercontent.com/FumiakiC/chumon-hub/$SHA/docs/ops/tools/collect_live_state.py" -o "$D/collect_live_state.py.part" \
  && mv "$D/collect_live_state.py.part" "$D/collect_live_state.py" && echo "取得: 成功" || echo "取得: 失敗（ここで止める）"
# 段階1（読み取りだけ）
sudo python3 -I "$D/collect_live_state.py" --context default --sha "$SHA" > ~/drift-stage1.txt 2>&1; echo "exit=$?" >> ~/drift-stage1.txt
# 段階2（段階1で比較対象の未確認・平文が 0 のときだけ動く）
sudo python3 -I "$D/collect_live_state.py" --context default --sha "$SHA" --diff > ~/drift-stage2.txt 2>&1; echo "exit=$?" >> ~/drift-stage2.txt
rm -r "$D"
```

- 取得に失敗したときは、そこで止める。新しいディレクトリには実行用の名前のファイルが無いので、続けて実行しても古い版は動かない（`python3` がファイルを開けずに終了する）。ホストに残った旧版を実行しないため、固定のパスに取得して上書きする形にはしない。
- `| tee` で受けると終了コードが失われるため、上の形でファイルに書き、終了コードを追記する。

| 終了コード | 意味 |
|---|---|
| 0 | 採取が完了し、全項目を満たした（段階2なら差分なし） |
| 1 | 段階2で差分あり |
| 2 | 前提条件の不備（context・`--sha` の形式・tmpfs・swap など） |
| 3 | 外部コマンドや後片付けの失敗 |
| 10 | 採取は完了したが未完了の項目がある（未確認・平文・repo との相違・必須 Secret の欠落・復旧用 digest の未確保など） |

照合する時期:

- `k8s/` のマニフェストを手動で apply する前（[k3s-node-config.md](k3s-node-config.md) の「適用」4.）。`kubectl get deploy chumon-hub -o yaml` の全文は平文の秘匿値を含みうるため、差分の確認には使わない。
- 本番で `kubectl` の手動操作（patch・edit・set・create secret など）をした後。操作の内容は、値を伏せて本書の「経緯の記録」に追記する。
- 上のどちらも無くても、前回の照合から 3 か月以内に照合する（Cloud Run への移行が延びた場合の歯止め）。

## 2026-10-10 の照合と是正

比較元は main の `1dabc2baa6d67070d1440854f27b807b61b9277d`。

| 段階 | 結果 |
|---|---|
| 段階1（初回） | 比較対象の3オブジェクトで未確認 0・平文 0。repo との相違は Service の `ports[0].name`（repo は `http`、本番は無し）の1件。Deployment の `limits.cpu`（repo は `"1000m"`、本番は `"1"`）も相違と判定したが、API サーバーによる表記の正規化で値は同じ（スクリプトを修正済み） |
| 段階2 | deployment・tunnel は差分なし、service は差分あり |
| 是正 | Service に `ports[0].name: http` を反映（下記） |
| 再照合 | 3オブジェクトとも未確認 0・平文 0・相違 0。段階2も差分なし（終了コード 0） |

その他の結果:

- 旧 ReplicaSet: chumon-hub は 11 件（すべて 2026-10 の作成）、cloudflared は 2 件（2026-01-10 と 2026-02-12 の作成）。いずれも平文・未確認を検出しなかった。chumon-hub に 2026-09-19 より前の版は残っていない（`revisionHistoryLimit: 10`）。
- 稼働中のイメージ: `ghcr.io/fumiakic/chumon-hub@sha256:e728e6814ffaa7fe3008293dbcd0e798d99995c1fdd3bc93f19763b8b6f1739a`（revision 210）。
- repo のマニフェストが参照する Secret とキーは、すべて存在した。`ghcr-secret` の型と必須キーも適合した（認証情報が有効かどうかは検証していない）。

### Service のポート名の是正

repo の `k8s/service.yaml` には 2026-01-12（`ac7b50c`）に `name: http` が加わったが、本番の Service の現在値と last-applied 注釈には無かった。2026-10-10 22:40（JST）に、`tools/apply_service_portname.py --apply` で反映した。

- 方式: `kubectl apply` ではなく JSON Patch で書き込んだ。確認時の uid・`resourceVersion`・last-applied 注釈を `test` 操作で条件にし、変えたのは `ports[0].name` と last-applied 注釈（`kubectl apply` が書くのと同じ内容）だけ。書き込む前に、サーバー側 dry-run で変わるのがこの2つだけであることを確かめた。
- 確認: EndpointSlice のポート名が `http`・ready 1、ClusterIP 経由の `/healthz` が `ok`、Cloudflare Access 経由のログインと解析の動作。Pod は再起動していない。
- 切り戻し情報（uid と書き込み前後の注釈）は、本番ホストのスクリプトと同じ場所の `svc-portname-work/` にある。`fix/manifest-drift` ① の完了後に削除する。

## Secret の構成

値は記録しない。いずれも手作業で作ったもので、repo には作成手順だけがある（ルートの README）。本番の秘匿の正をどこに置くかは、計画書の「マニフェスト適用の自動化と Secret 管理」で扱う。

| Secret | 型 | キー | 参照元 |
|---|---|---|---|
| `chumon-hub-secret` | `Opaque` | `API_SECRET` / `CLOUDFLARE_AUDIENCE` / `CLOUDFLARE_TEAM_DOMAIN` / `GOOGLE_API_KEY` | Deployment chumon-hub の env（`secretKeyRef`） |
| `tunnel-credentials` | `Opaque` | `TUNNEL_TOKEN` | Deployment cloudflared の env（`secretKeyRef`） |
| `ghcr-secret` | `kubernetes.io/dockerconfigjson` | `.dockerconfigjson` | Deployment chumon-hub の `imagePullSecrets` |

## 経緯の記録

管理情報（`managedFields`）は、どの管理者がどのフィールドを持つかを示すもので、操作の履歴ではない。下表の「管理情報」は 2026-10-10 時点の管理情報から読める推定、「記憶」は owner の記憶である。監査ログは無いため、これ以上は確認できない。時刻は JST。

| 日時 | 出来事 | 根拠 |
|---|---|---|
| 2026-01-10 | `chumon-hub-secret`（`GOOGLE_API_KEY`）と `tunnel-credentials` を作成。Service と cloudflared を apply | 管理情報（作成時の管理者が持つキーは `GOOGLE_API_KEY` だけ） |
| 2026-01-24 | `kubectl set env` で Deployment に Cloudflare の2値を追加した。平文の `value` で入ったとみられる | 管理情報（`kubectl-set` が両 env の `name` を持つ）。平文だったことは、2026-09-19 の apply が型不整合で拒否された事実（[k3s-node-config.md](k3s-node-config.md)）からの推定 |
| 2026-01-27 | repo の `deployment.yaml` が Cloudflare の2値を `secretKeyRef` に変えた（`f3e3edf`）。本番は平文のまま残った | git の履歴 |
| 2026-08-12 | `ghcr-secret` を作り直した（トークンの期限切れに伴う更新） | 管理情報（作成日時）と記憶 |
| 2026-09-19 13:47 | `chumon-hub-secret` に `API_SECRET`・`CLOUDFLARE_AUDIENCE`・`CLOUDFLARE_TEAM_DOMAIN` を patch した。`API_SECRET` はこのとき Secret に新しく足した | 管理情報と記憶 |
| 2026-09-19 13:47 | Deployment の Cloudflare の2値を `secretKeyRef` に patch した | 管理情報 |
| 2026-09-19 13:49 | main の `deployment.yaml` を apply した（#347） | 管理情報、[k3s-node-config.md](k3s-node-config.md) |
| 2026-10-10 22:40 | Service に `ports[0].name: http` を反映した | 本書の「Service のポート名の是正」 |

未確認: 2026-09-19 より前に、`API_SECRET` がアプリにどう渡っていたか。アプリは `API_SECRET` が無いとトークンの暗号化で失敗する作り（`lib/crypto.ts`）。現在は Secret 経由で渡っていることを確認済み。

## 本番にだけある項目

repo のマニフェストに無く本番にだけある項目は、2026-10-10 の時点ですべて次のどちらかで、人が足した設定は無かった。

- API の既定値: `revisionHistoryLimit`、`terminationGracePeriodSeconds`、`dnsPolicy`、`restartPolicy`、`schedulerName`、`securityContext`、probe の `scheme` と `successThreshold`、ポートの `protocol`、`terminationMessagePath` と `terminationMessagePolicy`、cloudflared の `imagePullPolicy`・`strategy`・`progressDeadlineSeconds`、Service の `clusterIP`・`ipFamilies`・`ipFamilyPolicy`・`sessionAffinity`・`internalTrafficPolicy`・`type`
- 自動で付く値: `deployment.kubernetes.io/revision` 注釈、`kubectl rollout restart` が付ける `restartedAt` 注釈、last-applied 注釈

## 確認の範囲

### 照合スクリプトの対象と対象外

- 対象: `default` namespace の Deployment（chumon-hub・cloudflared）と Service（chumon-hub-service）、その2つの Deployment が所有する ReplicaSet、repo のマニフェストが参照する Secret（キー名・型・管理情報だけ）、稼働中の Pod のイメージ digest。
- 対象外（名前の一覧だけ取得した）: 上記以外のリソースと、他の namespace のリソースの中身。CRD は名前だけ。
- 対象外: ノードの k3s 設定（[k3s-node-config.md](k3s-node-config.md) で扱う）。Cloudflare 側の設定。

### 別途確認した項目（2026-10-10）

本番では k3s 同梱の Traefik と `svclb-traefik`（ノードの 80/443 で待ち受ける）が動いているが、chumon-hub への経路には使っていない（入口は Cloudflare Tunnel から Service へ）。Traefik を通る迂回路が無いことを、次のとおり確かめた。

- Ingress、IngressRoute（HTTP・TCP・UDP）、Gateway、HTTPRoute、GRPCRoute は 0 件（`kubectl get` の名前の一覧）。
- Traefik の起動引数のうち provider の指定は `kubernetescrd` と `kubernetesingress` だけで、Gateway API の provider は有効になっていない。
- Lightsail のファイアウォールで、80/443 は IPv4・IPv6 とも閉じている（owner がコンソールで確認）。

Cloudflare 側の設定（owner がダッシュボードで確認）:

- Tunnel の公開アプリケーションルートは1件で、パスは全体（`*`）、Service URL は `http://chumon-hub-service:80`。Service 名とポート番号で指しており、ポート名には依存しない。どのルートにも当たらない要求は 404 を返す（キャッチオールルール）。
- Access のアプリケーションの宛先は、この公開ホスト名の全体（パスの指定なし）。

Service のポート名の是正の後に、Cloudflare Tunnel と Access を経由したログインと解析が動くことを確認した（owner による動作確認）。

Traefik を止めるかどうか（メモリの節約）は k3s の構成変更になるため、本書では扱わない。

### 未確認

- Cloudflare Access のポリシーの内容と、同じ公開ホスト名にパスを指定した別のアプリケーション（Bypass のポリシーを含む）が無いこと。パスを指定したアプリケーションは、ホスト全体のアプリケーションより優先される。`/healthz` はアプリ側では認証なしのため、パス単位の除外があると公開される（[k3s-node-config.md](k3s-node-config.md) の「適用後の検証」）。
- 操作の履歴（監査ログが無い）。経緯の記録の「未確認」も参照。
