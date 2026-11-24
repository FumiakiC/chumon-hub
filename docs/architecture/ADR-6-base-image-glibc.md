# ADR-6: 本番と開発のコンテナを glibc（Debian trixie-slim）に揃える

- 状態: 決定 2026-10-17（揃える方向と、ベースイメージを digest で固定する方針を決めた。実装と検証は別の PR で行う）。2026-10-18 に次アクションの条件 2 を訂正（実行ユーザーの主グループ）。2026-11-15 に、実装の PR（#399）の測定の結果により、runner の `GLIBC_TUNABLES` の追加と、条件 9 で読む値を追記。2026-11-16 に、条件 3 の確認の時点を訂正（マージの前は設定の検査、マージの後は実際の検知）。**実装**: #399（2026-11-16 にマージし、k3s の本番を切り替えた）。適用の後の確認のうち、切り替えの直後の分（条件 9 の記録）と、24 時間後の確認（条件 8。2026-11-17 に実施し、正常だった）は実施した。Dependabot の実際の検知（条件 3）は、2026-11-17 のジョブのログで確かめた（更新 PR での 4 か所の FROM の一致は、更新が不要だったため未確認）。7 日後の確認（条件 8）は、2026-11-24 に実施し、正常だった。切り替えの直後・24 時間後・7 日後の確認を実施し、観測した範囲で、停止・切り戻しの条件（条件 8）に当たらなかった。同じ日に、切り替えの後の repo と本番の照合を行い、相違は無かった。残る確認は、退避と復帰の手順（条件 7）の実地の確認と、ベースの更新 PR での 4 か所の FROM の一致の確認である
- 関連: [ADR-4](ADR-4-base-image.md)（本 ADR で置換）／[ADR-1](ADR-1-runtime.md)（ADR-4 の再検討トリガ 1 の発火元）／計画書 基本設計 §4「移行エポック詳細計画」の順序 1／本番 `Dockerfile`／開発 `.devcontainer/Dockerfile.dev`／`.github/dependabot.yml`／`.github/workflows/dependabot-auto-merge.yml`／`.github/workflows/deploy.yml`／[`../ops/branch-and-deploy.md`](../ops/branch-and-deploy.md)／[2026-09-19 インシデント](../incidents/2026-09-19-crop-concurrency-node-exhaustion.md)

## 背景 / 課題

[ADR-4](ADR-4-base-image.md)（2026-07-04）は、本番 `node:26-alpine`（musl）と開発 `node:26-bookworm-slim`（glibc）の非対称を当面許容し、揃える方向を未定とした。2026-10-17 の時点で、ADR-4 の再検討トリガのうち次の 2 つが発火している。

- トリガ 1（ADR-1 の基盤確定）: 2026-10-11 に ADR-1 で Cloud Run の採用を決めた。計画書は、揃える方向を STG の試行の前に決めるとしている。イメージを後から変えると、測った容量と初回応答を測り直すことになるため。
- トリガ 4（Node の musl の tier の昇格・降格）: Node.js の `BUILDING.md` で、Linux x64 の musl は v26.11.0 から Tier 2 になった（v26.10.0 までは Experimental）。ADR-4 の「受容するリスク」の 1 点目は、v26.11.0 以降は当てはまらない。

## 確かめた事実（2026-10-16〜17。公式の一次情報）

出典は、版を固定できるものはタグかコミットで示す。Cloud Run と Debian の文書は版を固定できないため、参照日（2026-10-17）で示す。

- **Node.js の platform list**（[v26.11.0 の `BUILDING.md`](https://github.com/nodejs/node/blob/v26.11.0/BUILDING.md)）: glibc の x64 は Tier 1 で、条件は kernel >= 4.18、glibc >= 2.28。kernel の条件には「古い版でも動きうる」という注が付く。musl の x64 は Tier 2 で、条件は kernel >= 6.12、musl >= 1.2.5。こちらには同じ注が無い。Tier 2 の定義には「基盤の問題で、これらのプラットフォームのバイナリの公開が遅れることがある」とあり、Tier 1 の定義にはこの但し書きが無い。[v26.10.0 の `BUILDING.md`](https://github.com/nodejs/node/blob/v26.10.0/BUILDING.md) では、musl の x64 は Experimental（kernel >= 3.10、musl >= 1.1.19）だった。昇格は [nodejs/node#63737](https://github.com/nodejs/node/pull/63737)。
- **Cloud Run の実行環境**（[Execution environments](https://docs.cloud.google.com/run/docs/about-execution-environments)）: 第 1 世代は gVisor を基にし、システムコールの大半（すべてではない）をエミュレーションする。第 2 世代は microVM で、システムコールのエミュレーションではなく Linux との完全な互換性を持ち、512 MiB 以上のメモリを要する。サービスの既定は「指定なし」で、Cloud Run が適した実行環境を選ぶ。どちらの世代についても、カーネルの版は文書に無い。
- **Cloud Run の開発のヒント**（[General development tips](https://docs.cloud.google.com/run/docs/tips)）: image streaming により、イメージのサイズはコンテナの起動時間に影響しない。最小のベースイメージを勧める理由は、セキュリティ（余分なパッケージを減らす）である。
- **公式の node イメージ**（[docker-library/official-images の `library/node`](https://github.com/docker-library/official-images/blob/979088541a1879f13d9336db64e520ac712db12b/library/node)、コミット `9790885`）: `26` と `26-slim` は Debian 13（trixie）を指す。`26-trixie-slim` と `26-bookworm-slim` がある。
- **Debian 12（bookworm）**（[Security support for Bookworm handed over to the LTS team](https://www.debian.org/News/2026/20260712)）: 2026-07-12 に通常のセキュリティ支援を終え、LTS チームが引き継いだ（LTS は 2028-06-30 まで）。開発コンテナは今これに載っている。
- **distroless**（[GoogleContainerTools/distroless の `README.md`](https://github.com/GoogleContainerTools/distroless/blob/7e55c167b7c993f738e933c3bc0f46190a5b367d/README.md)、コミット `7e55c16`）: `gcr.io/distroless/nodejs26-debian13` がある。distroless はパッケージマネージャやシェルを含まず、タグは `latest` / `nonroot` / `debug` / `debug-nonroot` だけである。

## 選択肢

- (A) 現状維持（本番 alpine・開発 glibc の非対称を許容する）
- (B1) glibc の Debian trixie-slim に揃える（本番の 3 ステージと開発を、すべて `node:26-trixie-slim` にする）
- (B2) ビルドは trixie-slim、本番の runner を distroless（`nodejs26-debian13`）にする
- (C) musl に揃える（開発も alpine にする）

## 決定と理由

**(B1) を採る。** 本番 `Dockerfile` の 3 ステージと、開発 `.devcontainer/Dockerfile.dev` を、`node:26-trixie-slim` に揃える。あわせて、両方のベースイメージを digest で固定し、更新は Dependabot の PR で取り込む。

理由:

1. 開発と本番で、libc と Debian の世代が揃う。ADR-4 で受容していた parity のギャップ（musl 固有の DNS の挙動差など、開発で再現できない不具合）が無くなる。
2. Cloud Run の上で、musl の Tier 2 の条件（kernel >= 6.12）を満たすかを、文書から確かめられない。glibc の Tier 1 は条件が緩く、古いカーネルでも動きうるという注がある。どちらの場合も、実行環境が報告するカーネルの版を STG で診断情報として記録する（下記「次アクション」）。
3. musl の x64 は Tier 2 になったが、セキュリティリリースの際に musl 版のバイナリが遅れうるリスクは、Tier 2 の定義のうえで残る。Tier 1 の定義にはこの但し書きが無い。
4. Cloud Run では、イメージのサイズは起動時間に影響しないので、alpine の小ささは起動の面では理由にならない。ただし、これはアプリの初期化やメモリの使い方が alpine と同じになるという意味ではない。初回応答とメモリは測る対象に残す（下記「受容するリスク」）。

検討の途中で挙げ、理由から外したもの: 「musl の x64 は Experimental なので抜ける」は、v26.11.0 で Tier 2 になったため理由にしない。Debian 12 の LTS への移管は、サポートの終了ではないので理由にしない（上の「確かめた事実」に背景として書くにとどめる）。

**(A) を採らない理由**: Tier 2 になり、ネイティブ依存はすべて musl 版を持ち、CI は本番イメージの中で描画まで確かめているので、(A) でも動く。(A) と (B1) の差は、上の 1〜3 の価値と、切り替えの検証のコスト（下記「受容するリスク」のメモリを含む）の比較になる。ベースイメージの切り替えは安価で可逆なので、(B1) を採る。

**(B2) を今は採らない理由**: 攻撃面はさらに小さくなるが、シェルが無いことで障害の調査の手段が変わり、タグに Node の版を持たないため digest の固定が前提になるなど、運用の形が変わる。いま (B2) でなければ塞げない具体的な failure mode は無い。Phase 4.5 の脅威モデルで再評価する。

**(C) を採らない理由**: (C) にしても、上の 2・3 は解消せず、開発の環境まで musl の条件に寄せることになる。

**digest で固定する理由**: ベースイメージの更新を PR として扱い、CI を通してから取り込むため。今の本番 `Dockerfile` は可変のタグを参照しており、同じコミットを再ビルドすると、ベースの更新が入った別のイメージになりうる（`deploy.yml` の `paths-ignore` のコメント）。STG と本番が同じイメージであることは、一度ビルドしたイメージを同じ digest で昇格させる方式（[`../ops/branch-and-deploy.md`](../ops/branch-and-deploy.md)）で保つもので、ベースの固定はその代わりにならない。固定しても完全な再現ビルドにはならない（ビルドの途中でネットワークから取得するもの、たとえば開発イメージの apt のパッケージは固定の対象外）。固定は、更新の PR を取り込んで再ビルド・再デプロイする運用とセットで行う。更新を取り込まなければ、ベースのセキュリティ修正が止まる。

**更新の PR は自動マージしない**: 現行の `deploy.yml` では、main へのマージで本番へデプロイされるため。自動マージの対象は、`dependabot-auto-merge.yml` の許可リストにあるグループ（`npm-patch` / `nextjs` / `react`）の patch に限られており、docker の更新は今の条件のままで対象外になる。この許可リストを docker の更新に広げない。

## 受容するリスク（eyes open）

- **メモリの出方**: glibc と musl はメモリアロケータが違い、ネイティブ依存（`@napi-rs/canvas`）を並行して動かしたときの RSS の出方が変わりうる。k3s の本番はアプリのメモリ上限が 512Mi で、[2026-09-19 インシデント](../incidents/2026-09-19-crop-concurrency-node-exhaustion.md)と同じ系統の問題になりうる。実装の PR で、マージの前に旧・新のイメージのメモリを比べ、適用の後にも本番で確かめる（下記「次アクション」）。 2026-11-15 追記: 実装の PR（#399）の測定（CI の合成入力。本番の入力での実測ではない）で、設定なしの trixie-slim は、A1 ベクタの入力の `memory.peak` が旧の 1.15 倍を超えた（run 43714693914）。runner に `GLIBC_TUNABLES=glibc.malloc.arena_max=2:glibc.malloc.mmap_threshold=131072` を足した測定は、承認済みの基準をすべて満たした（run 43717123101）。この設定を外す、または変えるときは、メモリの比較を測り直す。
- **イメージのサイズ**: Debian の slim は alpine より大きい。Cloud Run の起動時間には影響しないが、レジストリの容量と、k3s で pull する時間は増える。
- **攻撃面**: slim でも、alpine より含まれるパッケージが多い。(B2) の distroless は Phase 4.5 の脅威モデルで再評価する。
- **実行環境のカーネル**: glibc でも、Cloud Run のどちらの世代のカーネルが Tier 1 の条件に合うかは、文書に無い。STG で診断情報として記録するが、それで条件に合うことを証明したことにはしない。

## 影響範囲 / 依存

- 実装の PR で変えるもの: 本番 `Dockerfile`（3 ステージのベース、`apk add --no-cache libc6-compat` の削除、非 root のユーザーの作成のコマンド、runner の `GLIBC_TUNABLES`。最後の項目は 2026-11-15 追記）、開発 `.devcontainer/Dockerfile.dev`（ベースと、本番を alpine と説明しているコメント）、`.github/dependabot.yml`（docker のエコシステムを `/` と `/.devcontainer` に追加）、`.github/workflows/deploy.yml` の `paths-ignore` のコメント、[`../ops/branch-and-deploy.md`](../ops/branch-and-deploy.md) の「ベースイメージを可変のタグで参照している」という記述。
- 実装の PR は、現行の `deploy.yml` では main へのマージで k3s の本番へデプロイされる。Cloud Run の準備だけでは済まない。
- 計画書 基本設計 §4「移行エポック詳細計画」の順序 1: 実装と検証は、STG の試行の前に終える。

## 次アクション / 再検討トリガ

次アクション: 実装の PR（`chore/`）を 1 本で行い、開発と本番を同じ PR で変える。受け入れ条件は次のとおり。

**マージの前**（現行の `deploy.yml` では、main へのマージで k3s の本番へ自動でデプロイされるため、本番へ出る前に満たす）:

1. CI の品質ゲート・Docker のビルド・本番イメージ内のラスタ依存のチェック・起動スモーク・クロップのスモークが通る。
2. 完成した runner のイメージで、`@napi-rs/canvas` の読み込み、PDF のクロップ、非 root のユーザーによる一時ディレクトリへの書き込みができる。非 root の実行ユーザーの uid（1001）は維持し、主グループは nodejs（gid 1001）に統一する。旧イメージの実測の gid と変更の理由は、実装の PR に記録する（2026-10-18 訂正。BusyBox の `adduser --system` はグループの指定が無いと主グループを nogroup にするため、旧イメージの gid は 1001 ではない可能性が高い）。
3. Dependabot が、`/` と `/.devcontainer` の両方のベースイメージの更新を検知する。2026-11-16 訂正: Dependabot は既定のブランチの `.github/dependabot.yml` を読むため、実際の検知は、マージの前には確かめられない。マージの前は、設定を検査する（docker のエコシステムが 2 つのディレクトリを対象にしていること、使っているキーが GitHub の公式の文書にあること、ベースが両方の Dockerfile の FROM の行に直接書かれていること）。実際の検知と、設定のエラーが無いことは、マージの後に確かめる。2026-11-17 の記録（#399）: Dependabot のジョブ `1710373005`（2026-11-17 07:16:32〜07:17:02 JST。対象のコミットは `0264b84`）のログで、`/` と `/.devcontainer` のそれぞれについて、`node 26-trixie-slim` の更新の確認が実行され、どちらも更新は不要（`No update needed`）だった。ジョブは成功し、PR は作られていない。ログには警告のメッセージがあるが、両方のディレクトリの更新の確認は完了している。ログに、ファイルの名前は出ていない。`/.devcontainer` で FROM を持つファイルは `Dockerfile.dev` だけなので、このファイルが読まれたと読めるが、ログで直接は確かめていない。更新が不要だったため、更新 PR で 4 か所の FROM が同じ digest にそろうことは、まだ確かめていない。更新 PR のたびに確かめる。
4. `dependabot-auto-merge.yml` の許可リストを変えていない。
5. Dev Container を作り直し、品質ゲートとスモークテストが通る。
6. **メモリの比較**: 旧・新の runner のイメージを、同じ入力・同じ並列度（クロップを in-flight 上限の 2 まで同時に流す）・同じメモリの上限（512Mi）で比べる。入力は機密を含まない fixture とし、展開の負荷が高い PDF を含める（CI のクロップのスモークの PDF は 1 ページの小さな合成 PDF なので、それだけでは足りない）。採用の基準（新しいイメージのメモリの最大値の許容範囲など）は、測定の前に PR に書いて owner が承認する。測定の結果に合わせて基準を緩めない。
7. **切り戻しと、通常のデプロイへの復帰の手順**を定める。手順は次を扱う。
   - 切り替えの前に、本番で稼働中のイメージの digest を控え（[`../ops/k3s-live-state.md`](../ops/k3s-live-state.md) の記録と同じ方式）、その digest のイメージをレジストリから消さない。
   - 切り戻しの方法。現行の Deployment は `:latest` を `imagePullPolicy: Always` で参照し、`deploy.yml` は `kubectl rollout restart` だけを行う。そのため、`kubectl rollout undo` では戻らない（1 つ前の ReplicaSet も `:latest` を参照しており、新しいイメージを pull する）。revert して再ビルドしても、可変のタグのために切り替え前と別のイメージになりうる。
   - 通常のデプロイへの復帰。Deployment を旧 digest に固定して戻すと、以後の `rollout restart` は旧イメージを再起動し続ける。main へのマージが本番に反映されないまま、デプロイは成功と表示され、repo のマニフェストとも乖離する（[`../ops/k3s-live-state.md`](../ops/k3s-live-state.md)）。修正版を検証した後に、Deployment を repo のマニフェストどおりに戻す手順と、切り戻しの間の main へのマージ（Dependabot を含む）の扱いを決める。
8. **適用後の停止・切り戻しの条件**を書いておく（例: OOMKilled・Pod の再起動・メモリの最大値が 6. で承認した基準を超える）。 2026-11-24 の記録（#399）: 切り替えの直後（2026-11-16）・24 時間後（2026-11-17）・7 日後（2026-11-24）の確認を実施し、観測した範囲で、停止・切り戻しの条件に当たらなかった。時点ごとの記録は、9. の後ろにある。

**適用の後**（k3s の本番）:

9. 本番で、切り替えの前後のメモリを比べる（クロップを in-flight 上限まで同時に流したときの、Pod のメモリの最大値）。これは適用後の確認で、6. の比較の代わりではない。8. の条件に当たったら、7. の手順で切り戻す。 2026-11-15 訂正: 読む値は、アプリのコンテナの cgroup の `memory.peak` とする（Pod 全体の値ではない）。測定のための本番の再起動は行わず、同じ入力を流す直前と直後の値を記録する。旧と新では稼働の時間が違うため、本番の結果から新旧の厳密な比は判定しない。新旧の比較は 6. で行い、本番では 8. の条件と、機能・安定性を確かめる。2026-11-16 の記録（#399）: 同じ合成の入力（84 要求）を流した直後の `memory.peak` は、切り替えの前（alpine、`sha256:fe1501549950c0f0b2e32de29547af4a379bbb29f891bdb618d4afd5f071f2a5`）が 347.74MiB、切り替えの後（trixie-slim、`sha256:5f2ef41b8240c8a658e087efda33e9208094da9d98dd8216f811c6c921eec55f`）が 381.02MiB で、どちらも 435MiB 以下だった。どちらも 84 要求がすべて出力の検査に合格し、OOM・再起動・描画の警告は無かった。前後で稼働の時間が違うため、この 2 つの値を新旧の比としては判定しない。本番に出たイメージは、main で再ビルドしたもので、6. で測ったイメージ（`sha256:07ae8395cdabeec2bbc941bd790e7340909535f16652a148cbf5d6012eef9a1b`）とは別である。2026-11-17 の記録（#399。8. の 24 時間後の確認）: rollout の完了から約 24 時間 37 分後に、同じコンテナが稼働していた（Pod・コンテナの ID・開始時刻・imageID が、切り替えの直後と同じ）。再起動は 0、`memory.events` は全項目 0、`memory.peak` は 381.02MiB（切り替えの直後の負荷の後と同じ値）だった。ノードの圧迫は無く、取得できた範囲で、Failed の Pod・関連するイベント・描画の警告は無かった。通常の画面からのクロップと解析は成功した（owner の報告）。この間に、別のデプロイは無かった。8. の条件に当たらなかったため、Dependabot Auto Merge を有効に戻し、本番の更新を控える凍結を解いた。6. で測った一時イメージの版は、GHCR から削除した。7 日後の確認は未実施である。2026-11-24 の記録（#399。8. の 7 日後の確認）: rollout の完了から約 7 日 23 時間後（2026-11-24 21:53〜21:59 JST）に、同じコンテナが稼働していた（Pod・コンテナの ID・開始時刻・imageID が、切り替えの直後・24 時間後と同じ。再起動は 0）。通常の画面からのスモークの前と後に読んだ `memory.peak` は、どちらも 381.02MiB で、切り替えの直後の負荷の後から変わっていない。`memory.events` は全項目 0 だった。ノードの圧迫と Failed の Pod は無く、確認の時点で保持されていた Warning のイベントは 0 件だった。アクセス・クロップ・解析は正常だった（owner の報告）。確かめた Actions の履歴（2026-11-16 以降の 30 件）の範囲で、`deploy.yml` の run は #399 のデプロイの 1 件だけだった。コンテナのログの描画の警告は、この日は数えていない。8. の条件に当たらなかった。3 つの時点の観測で、続けて監視した記録ではない。同じ日に、切り替えの後の repo と本番の照合を行い、相違は無かった（[`k3s-live-state.md`](../ops/k3s-live-state.md) の「経緯の記録」）。残る確認は、7. の退避と復帰の実地の確認と、ベースの更新 PR での 4 か所の FROM の一致の確認である。

あわせて、STG の試行では、実行環境の世代と、実行環境が報告する `uname -r` の値を、診断情報として記録する。この値だけで、Node のサポート条件に合うことの証明にはしない。第 1 世代はシステムコールをエミュレーションするため、報告される版の番号だけでは互換性を判断できない。

再検討トリガ:

1. glibc 固有の不具合、またはメモリの増加によって、k3s の現行の上限や、ADR-1 で承認する容量の基準を満たせない。
2. Phase 4.5 の脅威モデルで、runner の攻撃面を (B2) まで縮める必要があると判断した。
3. Node.js の platform list で、glibc の x64 の tier や条件が変わった。
4. Debian 13（trixie）の通常のセキュリティ支援の終了が近づいた。
