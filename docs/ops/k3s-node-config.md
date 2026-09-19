# k3s ノードのリソース予約と適用手順

## 目的と保護の範囲

Pod の `limits` はその Pod の上限にすぎず、OS とコントロールプレーンを含む使用量の合計がノード容量に収まることを保証しない。ノード側で OS と k3s の取り分を予約し、Pod に渡す Allocatable を減らす。あわせてアプリのメモリ上限を 512Mi に下げ、メモリ不足時の hard eviction を設定する。

[版管理する k3s 設定](../../k8s/node/10-resource-guard.yaml)はホストの `/etc/rancher/k3s/config.yaml.d/` へ置くドロップインであり、Kubernetes マニフェストではない。`kubectl apply` の対象にしない。

`enforce-node-allocatable` は既定の `pods` のままとする。`system-reserved-cgroup` / `kube-reserved-cgroup` による OS・k3s 自体への強制上限は設けない。予約は Pod 側の予算を減らす仕組みであり、OS・k3s の使用量や全 Pod の limits 総和を自動的に制限するものではない。スケジューラは requests で配置を判断するため、limits と実使用量の予算管理も継続する。

## メモリ予算

対象ノードの観測値を基にした初期予算。ノード変更時は必ず再計算する。

| 項目 | メモリ | 用途 |
|---|---|---|
| Capacity | 約 1906Mi | ノードが報告する容量（1951764Ki） |
| kube-reserved | -576Mi | k3s / apiserver / controller / scheduler / kubelet / containerd |
| system-reserved | -256Mi | sshd / systemd / journald 等 |
| eviction-hard | -200Mi | `memory.available` のしきい値。2GB ノードでは既定の 100Mi は薄い |
| Allocatable | 約 874Mi | Pod 全体に渡す予算 |
| chumon-hub | 512Mi | 1 Pod の memory limit（実測 136Mi に対する余裕込み） |
| coredns | 170Mi | 既存 memory limit |
| 残り | 約 192Mi | メモリ上限のない system pods のための余裕（実測合計 144Mi） |

丸めた数値の計算は `1906Mi - 576Mi - 256Mi - 200Mi = 874Mi` となる。Ki 単位では `1951764Ki - 1056768Ki = 894996Ki` であり、これを検証の正とする。CPU は 2 コアから 500m + 200m を予約し、Pod 全体には約 1300m を残す。アプリの CPU limit は 1000m のまま。

予約の合計（576Mi + 256Mi = 832Mi）は次の実測から決めている。ノード全体の working set 1320Mi から Pod 合計 295Mi を引いた 1025Mi が Pod 以外（OS + k3s + containerd。page cache を含む）の使用量であり、これを予約 832Mi と eviction しきい値 200Mi の合計 1032Mi で覆う。`*-cgroup` による強制を行わない以上、Allocatable に効くのは合計だけであり、kube と system への内訳は表示上の区別にすぎない。

無制限の system pods の使用量が残余に収まる保証はない。適用前後の実測と継続監視が必要。

更新中の Pod 数についても予算を守る。`replicas: 1` に既定の RollingUpdate を適用すると `maxSurge: 25%` は 1 に切り上げられ（`maxUnavailable: 25%` は 0 に切り捨てられる）、更新のたびに一時的に 2 Pod が並ぶ。memory limit の合計は 1024Mi となり上記予算を超えるため、`maxSurge: 0` / `maxUnavailable: 1` を明示して surge を禁止する。**代償として、デプロイのたびに旧 Pod の停止から新 Pod の Ready までの数十秒、サービスが停止する。** 単一ノード・`replicas: 1` の構成では無停止更新と予算遵守を両立できないため、予算側を優先する。

## 適用前の記録

以下は管理者が対象ホストと対象クラスタを確認して実施する。本ランブックを追加しただけでは本番設定は変わらない。

1. **利用者のいない時間帯を確保する。k3s の再起動は埋め込み containerd ごと落ちるため、1〜2 分のサービス断を見込む。** 単一ノード・`replicas: 1` のため無停止作業ではない。復旧操作用に Lightsail コンソールへのアクセスも確認する。
2. ノード名・接続先を確認し、適用前の実効設定と使用量を記録する。`<NODE>` は `kubectl get node` の実際のノード名に置き換える。記録には内部情報が含まれうるため、リポジトリへコミットしない。

```sh
kubectl config current-context
kubectl get node
NODE='<NODE>'
SNAPSHOT="$HOME/k3s-resource-guard-$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -m 700 "$SNAPSHOT"
kubectl get --raw "/api/v1/nodes/${NODE}/proxy/configz" > "$SNAPSHOT/configz-before.json"
kubectl describe node "$NODE" > "$SNAPSHOT/node-before.txt"
kubectl top node > "$SNAPSHOT/top-node-before.txt"
kubectl top pods -A > "$SNAPSHOT/top-pods-before.txt"
kubectl get pods -A -o wide > "$SNAPSHOT/pods-before.txt"
kubectl get deployment chumon-hub -o yaml > "$SNAPSHOT/deployment-before.yaml"
kubectl rollout history deployment/chumon-hub
```

`configz` の `kubeletconfig.evictionHard` / `kubeReserved` / `systemReserved` と、describe の Capacity / Allocatable を確認する。設定ファイルのコメントは対象ノードの事前観測に基づくため、他ノードにも同じ既定値があると仮定しない。`kubectl top` が失敗する場合は「使用量ゼロ」と扱わず、メトリクス取得環境を確認し、現行値の採取ができるまで適用判断を保留する。

3. ホストの既存設定の有無を確認し、存在する場合は保護された場所へバックアップする。

```sh
sudo test -f /etc/rancher/k3s/config.yaml
# 存在する場合のみ実行する
sudo cp -p /etc/rancher/k3s/config.yaml "$SNAPSHOT/config.yaml.original"
sudo chmod 600 "$SNAPSHOT/config.yaml.original"
```

本変更はドロップインとして配置するため、既存の `config.yaml` そのものは書き換えない。ただし同じキーは後勝ちで置き換わるため、既存の `kubelet-arg` の有無は必ず確認する（手順は「適用」を参照）。`eviction-hard` は map 全体を置き換えるため、memory のみを追記して nodefs / imagefs のしきい値を消さない。既存の追加しきい値がある場合も、削除してよいか確認する。

## 適用

1. **先に `/healthz` を含むアプリイメージを配布し、現在の probe 設定のまま起動と `/healthz` の HTTP 200 を確認する。** 古いイメージに `/healthz` probe を適用すると 404 で startupProbe が通らず、起動失敗になる。配布は本変更を `main` へ merge することで `deploy.yml` が自動的に行う（ビルド → GHCR への push → `kubectl rollout restart`）。この時点では probe はまだ `/` を見ているため、`/healthz` の確認は後述の `kubectl port-forward` で行う。既存のデプロイ完了を確認してから、以下のノード変更・手動 apply を行う。
2. 設定をドロップインとして配置し、k3s を再起動する。既存の `/etc/rancher/k3s/config.yaml` は書き換えない。配置前に、同じ `kubelet-arg` が他の場所で指定されていないかを確認する。

```sh
# 既存の kubelet-arg の有無を確認する（何も出力されなければ競合なし）
sudo grep -n 'kubelet-arg' /etc/rancher/k3s/config.yaml /etc/rancher/k3s/config.yaml.d/*.yaml 2>/dev/null
sudo grep -n 'kubelet-arg' /etc/systemd/system/k3s.service

sudo mkdir -p /etc/rancher/k3s/config.yaml.d
sudo cp k8s/node/10-resource-guard.yaml /etc/rancher/k3s/config.yaml.d/10-resource-guard.yaml
sudo systemctl restart k3s
```

既存の `kubelet-arg` が見つかった場合は、そのままコピーしない。同じキーは後から読まれた側で**置き換わる**ため、既存の指定が失われる。その場合は本ファイルのキーを `kubelet-arg+` に変えて追記にするか、既存側へ統合した内容をレビューしてから配置する。`k3s.service` の起動引数に `--kubelet-arg` がある場合は CLI 引数が設定ファイルより優先されるため、ドロップインを置いても反映されない。

3. **Pod が Running / Ready になるまで 2〜3 分待つ。** 過去の障害では再起動から 27 秒で回復しないと見切り、追加の停止・起動を行った。通常の起動・イメージ取得時間を考慮し、27 秒程度で再操作しない。API が戻るまでは接続に失敗する場合がある。

```sh
kubectl get node
kubectl get pods -A -o wide
kubectl wait --for=condition=Ready pod -l app=chumon-hub --timeout=180s
```

設定縮小時点ではアプリに旧 1Gi limit が残るため、利用を再開せず使用量を監視する。2〜3 分後も回復しない場合は `sudo systemctl status k3s` と `sudo journalctl -u k3s --since '-10 min'`、Pod の events で原因を確認し、再起動を繰り返さずロールバックを判断する。

4. ノード検証を行い、Deployment マニフェストを手動適用する。

```sh
kubectl describe node "$NODE"
kubectl get --raw "/api/v1/nodes/${NODE}/proxy/configz"
kubectl get pods -A -o wide
kubectl apply -f k8s/deployment.yaml
kubectl rollout status deployment/chumon-hub --timeout=360s
```

**現行の [deploy.yml](../../.github/workflows/deploy.yml) は `kubectl rollout restart` と状態確認だけを行い、マニフェストを apply しない。この `kubectl apply -f k8s/deployment.yaml` は手動でしか行われない。** ノード設定のコピー・k3s 再起動も自動化されていない。`k8s/` 全体を再帰的に apply するとホスト用設定まで対象になるため、ファイルを明示する。

`progressDeadlineSeconds: 300` は進捗停止の失敗判定であり、自動ロールバックではない。CI の `rollout status` は 180 秒で先に打ち切られる。ここでは Deployment の判定も観測できるよう、手動確認を 360 秒としている。なお `maxSurge: 0` のため、この apply は旧 Pod を停止してから新 Pod を起動する。数十秒の断が出る。

## 適用後の検証

```sh
kubectl get --raw "/api/v1/nodes/${NODE}/proxy/configz" > "$SNAPSHOT/configz-after.json"
kubectl describe node "$NODE" > "$SNAPSHOT/node-after.txt"
kubectl top node
kubectl top pods -A
kubectl get pods -A -o wide
kubectl get events -A --sort-by=.metadata.creationTimestamp
kubectl describe deployment chumon-hub
kubectl port-forward deployment/chumon-hub 18080:3000
```

port-forward を維持し、別ターミナルから認証ヘッダーなしで確認する。終了後は port-forward を Ctrl+C で停止する。

```sh
curl --fail --include http://127.0.0.1:18080/healthz
```

- Capacity は変わらず、Allocatable が `894996Ki`（約 874Mi）に縮んでいる。
- `configz` の `kubeReserved` が CPU 500m / memory 576Mi、`systemReserved` が CPU 200m / memory 256Mi。
- `evictionHard` に `memory.available: 200Mi`、`nodefs.available: 5%`、`imagefs.available: 5%` が反映されている。
- 既存 Pod に新たな Evicted / Pending がなく、アプリが Running / Ready。OOMKilled や再起動の増加、Node の MemoryPressure がない。
- アプリの memory limit が 512Mi、3つの probe が `/healthz`、startup 5秒/3秒/24回、liveness 30秒/10秒/5回、readiness 10秒/5秒/3回になっている。
- Deployment の `strategy` が `maxSurge: 0` / `maxUnavailable: 1` で、rollout 中に chumon-hub の Pod が 2 つ並ばない。
- `/healthz` が HTTP 200、本文 `ok`、`cache-control: no-store` を返す。`proxy.ts` は無変更で、このパスは matcher の対象外。
- `/healthz` はアプリ層では無認証のため、外部からの到達は前段の Cloudflare Access が防いでいることを確認する。Access のポリシーがホスト全体に掛かっていればよく、パス単位の除外があるとこのパスが公開される。

`/healthz` は依存サービスの健全性や処理の進捗を検証しない。同期処理がイベントループを占有すればこのルートも応答できない。今回の probe 調整は誤再起動の抑制であり、描画の別スレッド化や同時実行制御の代替ではない。利用再開後もメモリ使用量・eviction・再起動回数を監視する。

## ロールバック

ドロップインを取り除いて k3s を再起動する。既存の `/etc/rancher/k3s/config.yaml` には触れていないため、戻す対象はこの 1 ファイルだけである。

```sh
sudo mv /etc/rancher/k3s/config.yaml.d/10-resource-guard.yaml "$SNAPSHOT/"
sudo systemctl restart k3s
```

既存の `config.yaml` へ統合する形で配置した場合は、代わりに記録しておいたバックアップを戻す。

再び断が出るため利用者のいない時間帯に実施し、2〜3 分待ってノードと Pod を確認する。API 復旧後、Deployment も戻す。

```sh
kubectl rollout history deployment/chumon-hub
kubectl rollout undo deployment/chumon-hub
kubectl rollout status deployment/chumon-hub --timeout=360s
kubectl get pods -A -o wide
kubectl describe node "$NODE"
kubectl get --raw "/api/v1/nodes/${NODE}/proxy/configz"
```

別の rollout が挟まった場合は、適用前に記録した revision を `--to-revision` で指定する。`rollout undo` が戻すのは Pod template のため、Deployment 直下の `progressDeadlineSeconds` と `strategy` は戻らない。適用前に未設定だった場合は `kubectl patch deployment chumon-hub --type=merge -p '{"spec":{"progressDeadlineSeconds":null,"strategy":null}}'` で今回の明示設定を取り除き、元の既定値に戻す。明示設定があった場合は記録した値に戻す。

最後に configz・Allocatable・limits / probe を適用前の記録と比較する。緊急 undo は保存済みマニフェストを変更しないため、次回 apply 時に本変更が再適用される点にも注意する。
