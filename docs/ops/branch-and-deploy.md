# ブランチ戦略とデプロイの流れ

## 目的と位置づけ

ブランチの規則と、main から本番までのデプロイの流れの正。今ある規則は「現行」、Cloud Run への移行（計画書のエポック表 2b「移行エポック」）で導入するものは「移行エポックで導入」と書き分ける。

決定の要約と日付は、計画書「決定事項と未決事項」の「ブランチ戦略とデプロイの流れ」にある。次の事項は、それぞれの文書が正で、本書には写さない。

| 事項 | 正 |
|---|---|
| pre-push フックの判定・有効化・拒否されたときの対処・フックを変更するときの手順 | [`../SETUP_DEVCONTAINER.md`](../SETUP_DEVCONTAINER.md) §6 |
| Dependabot auto-merge の構成と自動マージの対象 | [`dependabot-automerge.md`](dependabot-automerge.md) |
| Cloud Run への切り替えの条件と、切り替えまで（k3s との並行稼働中）の切り戻し | 計画書 基本設計 §4「移行エポック詳細計画」 |
| CI/CD の権限境界の脅威分析 | 計画書 基本設計 §4「Phase 4.5 詳細計画」の成果物 7（脅威モデル） |

## 1. ブランチの規則（現行）

- GitHub Flow で進める。作業は `<type>/<scope>` の短命なブランチで行い、PR を出して CI を通し、squash merge して、マージ後にブランチを削除する。`<type>` は Conventional Commits の type（`feat` / `fix` / `chore` / `refactor` / `perf` / `ci` / `docs`）。1 PR = 1 関心事。
- main は常にデプロイできる状態に保つ。main への push は、現行では本番へのデプロイを起動し（§2）、移行エポックの後は STG へのデプロイを起動する（§3）ため。GitHub の GitHub flow の解説はデプロイを扱っておらず、この規則は本 repo のものである。
- staging などの環境ごとのブランチ（Git Flow 型）は作らない。移行エポックの後、STG と本番の違いは、ブランチではなく、同じイメージをどこまで昇格させたかで表す（§3）。hotfix 用のブランチも作らない（§3.6）。

### 1.1 main への直接 push

- `docs/` だけの変更は、owner が main へ直接 push してよい（計画書の反映など）。判定するのはローカルの pre-push フックで、仕組みは [`../SETUP_DEVCONTAINER.md`](../SETUP_DEVCONTAINER.md) §6。
- 例外として、`docs/ops/tools/` は本番の権限で実行するコードなので、`docs/` の下にあっても直接 push せず、必ず PR とレビューを通す（[`k3s-live-state.md`](k3s-live-state.md)）。pre-push フックはこれを `docs/` の変更として通すため、この例外はフックでは強制されない。`tools/` は k3s の撤去とともに削除する予定である（同書）。
- AI エージェント（Copilot 等）は、`docs/` だけの変更も含めて main へ直接 push しない（`.github/copilot-instructions.md`）。
- サーバー側では、bypass なしのルールセットで main の削除と force push を禁止している（計画書「決定事項と未決事項」の「main への直接 push の防止」）。フックはローカルの誤操作を防ぐもので、権限制御ではない。

### 1.2 フックを迂回するとき

2026-10-12 に [`../SETUP_DEVCONTAINER.md`](../SETUP_DEVCONTAINER.md) §6.3 から移した。移すときに、デプロイの起動先が移行エポックで変わるため「（現行では本番）」を補った。

- フックを迂回して main へ直接 push するのは、owner が明示的に判断した例外に限る。そのときの手段は `git push --no-verify` に限り、設定の変更やフックの削除・無効化では迂回しない。
- 誤って main に入ったコード変更の取り消しも、原則は revert の PR で行う。PR を待てない場合に限り、owner の判断で上記の手段を使う。迂回した push は、CI を通らずにデプロイ（現行では本番）を起動しうる。
- AI エージェント（Copilot 等）は独断で迂回しない。拒否されたら作業を止めて状況を報告する（`.github/copilot-instructions.md` に記載）。

## 2. デプロイの流れ（現行。k3s）

移行エポックで §3 に置き換える。

- main への push（`docs/**` と `**.md` だけの変更を除く）で [`deploy.yml`](../../.github/workflows/deploy.yml) が起動し、イメージをビルドして GHCR の `:latest` に push し、k3s の Deployment を `rollout restart` する。STG は無く、本番への反映に承認は無い。
- ビルドするのは、起動した SHA ではなく、checkout の時点の main である（#374）。待機中に置き換えられた run や re-run が、古いコードを `:latest` にしないため。ジョブサマリに、起動した SHA・ビルドした SHA・digest を記録する。
- 手動の再デプロイは main からの `workflow_dispatch` で行い、run の Re-run は使わない（手順と理由は [`dependabot-automerge.md`](dependabot-automerge.md) の「障害時の切り分けと巻き戻し」）。
- 巻き戻しは main の revert で行う（計画書 エポック表 1c の②③）。
- Dependabot の自動マージの分も、マージでそのまま本番にデプロイされる。

## 3. デプロイの流れ（移行エポックで導入。Cloud Run）

```text
作業ブランチ → PR（CI）→ squash merge
  → main でイメージを 1 回だけビルド（digest が決まる）
  → STG へ自動でデプロイし、スモーク
  → production environment の承認
  → STG で確かめたのと同じ digest を本番へ昇格（再ビルドしない）
```

### 3.1 ビルド

- main へのマージで、イメージを 1 回だけビルドする。STG と本番は、そのイメージを digest で参照する。
- commit SHA と image digest は別の識別子である。現行はベースイメージを可変のタグで参照しているため、同じコミットから作っても別のイメージになりうる（`deploy.yml` の `paths-ignore` のコメント）。何を確かめて何を本番に出したかを後から辿れるように、「commit SHA → image digest → STG の revision → スモークの結果」を対応づけて記録する。

### 3.2 STG

- main へのマージのたびに、STG へ自動でデプロイしてスモークを行う。スモークの範囲は、計画書 基本設計 §4「移行エポック詳細計画」の「STG のスモークの範囲」。
- スモークが確かめた revision と、昇格させる digest を一致させる。そのために、検証中は STG の検証対象の revision を固定するか、検証中の更新を直列化する（どちらにするかは §4）。

### 3.3 本番への昇格

- 本番へは、STG で確かめたのと同じ digest を昇格させる（`gcloud run deploy SERVICE --image=REGISTRY/IMAGE@sha256:DIGEST --region=REGION --project=PROJECT`）。昇格のために再ビルドしない。サービス名・リージョン・プロジェクトは明示する。非対話の job では、サービス名やリージョンを省くと入力を求められずに失敗しうる。
- 昇格の job は GitHub Environments の `production` を参照し、required reviewers の承認を経て動く。承認者は owner 1人。
  - required reviewers は、GitHub Free・Pro・Team では public の repo でだけ使える。repo を private にするなら、この前提が崩れる。
  - prevent self-review は有効にしない。有効にすると、デプロイを起動した人はそのデプロイを承認できず、承認者が owner 1人では昇格できなくなる。
  - production の deployment branches は main に限る。
- 急ぎの修正は §3.6、Dependabot の分は §3.7。

### 3.4 本番の権限の分離

- 本番の GCP の権限は、STG と分ける（STG は別の GCP プロジェクトに置く。計画書「決定事項と未決事項」の「STG 環境」）。
- 本番へデプロイする資格情報は、Workload Identity Federation で得る。信頼条件は、対象の repository と production environment に限る。job が environment を参照すると、OIDC トークンの `sub` は、既定の形式では `repo:<owner>/<repo>:environment:<environment の名前>` になる。
- environment を参照する job の `sub` には ref が入らない。そのため branch の制限は、production の deployment branches（main に限る）で行う。
- ビルドの job と STG の job には、本番の権限を渡さない。これらの job の `sub` は、production の信頼条件に一致しない。
- 信頼条件は、実際のトークンの `sub` の形式を確かめてから設定する。形式は repo の作成時期と設定で変わる（2026-07-15 より後に作った repo と、オプトインした repo では、owner と repo の ID を含む形式になる）。
- 防げないこと: 本節の仕組みが防ぐのは、ビルドや STG の job、main 以外のブランチのワークフローが本番の権限に届くことで、owner 自身による設定の変更までは防がない。
  - GitHub の側: owner は repo の管理者なので、environment の保護の設定と main のワークフローの定義を変えられる。また、管理者は既定で environment の保護を迂回できる（迂回を禁じる設定がある。§4）。
  - GCP の側: WIF の信頼条件と本番の IAM を変えるには、GitHub とは別に GCP の権限が要る。owner が GCP 側の管理権限も持つ場合は、これらも変えられる。
- 現行の経路では、リポジトリの書き込み権限が本番へのデプロイ権限に等しい（計画書 エポック表 1c の②③）。本節の仕組みを入れると、本番への反映に production の承認が加わる。CI/CD の権限境界の分析は、Phase 4.5 の成果物 7（脅威モデル）で行う。

### 3.5 切り戻し

本番を Cloud Run に切り替えた後の、Cloud Run の中での切り戻しを扱う。切り替えまで（k3s との並行稼働中）の切り戻しは、計画書 基本設計 §4「移行エポック詳細計画」の「切り戻し」。

- 基本は、保持してある前の本番の revision へトラフィックを戻す（`gcloud run services update-traffic SERVICE --to-revisions=REVISION=100 --region=REGION --project=PROJECT`）。revision は作成後に変更できず、イメージと、環境変数・メモリの上限・同時実行数などの設定を一組で持つ。タグを指定してデプロイしても、revision はデプロイの時点で解決した digest を使い続ける。
- ただし、前の revision が残っている保証は無い。サービスあたりの revision が 1,000 を超えると、古いものから自動で削除される。トラフィックを受けられない revision は、最新のものを除いて手動でも削除できる（Manage revisions）。Cloud Run resource model にも、使われていない revision の削除への言及があるが、1,000 件の上限との関係や、追加の削除条件・時期は明記されていない。
- そのため、digest での再デプロイでも戻せるようにしておく。本番に出した digest・設定・Secret のバージョンを一組で保持し、その digest のイメージをレジストリから消さない（revision を削除してもイメージは消えないが、レジストリの側の削除は別に起きうる）。Secret を `latest` で参照すると、戻した revision でも、インスタンスの起動時にその時点の最新の値を読むため、バージョンを固定する（[ADR-1](../architecture/ADR-1-runtime.md) の「秘匿」）。
- IAM・ingress など、サービス側の設定は revision に含まれないため、トラフィックを戻しても戻らない。別に戻す（構成のコード管理。計画書の「移行エポック詳細計画」の切り替えの条件 9）。
- DB の導入後は、前のアプリが今のスキーマで動くことも、切り戻しの条件になる（Phase 4.5 の成果物 4「移行・ロールバック方針」）。

### 3.6 急ぎの修正

hotfix 用のブランチは作らない。`fix/` のブランチから同じ流れ（PR・CI・マージ・STG・承認）で出し、承認だけを急ぐ。

### 3.7 Dependabot

- 自動マージの分（対象は [`dependabot-automerge.md`](dependabot-automerge.md)）は、STG まで自動で進み、本番への昇格は手動で承認する。
- STG のスモークが通った後の自動の昇格は、この流れで運用してから判断する。

### 3.8 現行の `deploy.yml` から変わること

- 現行（#374）は、run がどの SHA で起動しても、checkout の時点の main をビルドし、`:latest` として本番に出す。main 以外を載せないことに加えて、待機中に置き換えられた run や古い run でも、本番をその時点の main に寄せる仕組みである。計画書のエポック表 1c の②③は、この「checkout で解決した main だけを本番に載せる」性質を、実行基盤を変えるときにも引き継ぐとしていた。
- 移行後は、この性質を、STG で確かめた digest の承認と昇格に置き換える（2026-10-12。計画書のエポック表 1c の②③にも追記した）。本番に何を載せるかは、承認で決める。main 以外を載せない点は、ビルドを main へのマージに限ることと、production の deployment branches を main に限ることで保つ。checkout の時点の main をビルドする方式は `:latest` の上書きへの対策なので、digest で昇格する方式に変えるときに見直す。
- 本番は、承認を経て実際に反映された digest で、main の先端とは一致しないことがある。承認されても、反映前に失敗すれば本番は以前のままである。昇格が並行すれば、承認の順と反映の順は一致しない（GitHub の environment の承認と `concurrency` は別の仕組みである）。本番への昇格の直列化と、古い昇格による上書きの扱いは §4。

## 4. 導入時に決めること

移行エポックでデプロイの経路を作るときに決め、本書に記録する。

- STG の検証対象の revision を固定するか、検証中の更新を直列化するか（§3.2）。
- 承認待ちの古い run の扱い。承認されない job は 30 日で自動的に失敗する。ワークフローの `concurrency` では、同じグループで実行中と待機中は 1 つずつまでで、新しい run が来ると待機中の run は取り消される。
- 本番への昇格の直列化と、古い昇格による上書きの扱い（§3.8）。承認の順と反映の順は一致しないため、後で承認した digest が反映された後に、先に承認した昇格が反映されて、本番を古い digest に戻すことがありうる。`concurrency` は environment の承認とは別の仕組みなので、承認とは別に決める。
- 「commit SHA → image digest → STG の revision → スモークの結果」の記録の形と置き場所（§3.1）。
- イメージの置き場所。Cloud Run は Artifact Registry を勧めており、GHCR の private のイメージは Artifact Registry のリモートリポジトリを経由して使う。
- 管理者による environment の保護の迂回を禁じるか（§3.4）。

導入時には、現行の流れを前提にした次の記述も書き換える: 本書の §2、[`dependabot-automerge.md`](dependabot-automerge.md)（マージから本番へのデプロイを前提にした節）、[`../SETUP_DEVCONTAINER.md`](../SETUP_DEVCONTAINER.md) §6（main への直接 push が本番のデプロイを起動するという説明）、`.github/copilot-instructions.md` の「デプロイ」。

## 5. 根拠にした一次情報（2026-10-12 に確認）

- GitHub Docs: [GitHub flow](https://docs.github.com/en/get-started/using-github/github-flow)
- GitHub Docs: [Deployments and environments](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments)（required reviewers が使えるプラン、prevent self-reviews、deployment branches、管理者による迂回）
- GitHub Docs: [Control deployments](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/control-deployments)（承認待ちの job の 30 日、`concurrency`）
- GitHub Docs: [OpenID Connect reference](https://docs.github.com/en/actions/reference/security/oidc)（`sub` と `environment`、`sub` の形式の変更）
- Google Cloud: [Rollbacks, gradual rollouts, and traffic migration](https://docs.cloud.google.com/run/docs/rollouts-rollbacks-traffic-migration)（トラフィックを前の revision へ戻す）
- Google Cloud: [Cloud Run resource model](https://docs.cloud.google.com/run/docs/resource-model)（revision の不変性、使われていない revision の削除への言及。1,000 件の上限との関係と、追加の削除条件・時期は明記されていない）
- Google Cloud: [Manage revisions](https://docs.cloud.google.com/run/docs/managing/revisions)（サービスあたり 1,000 の上限と自動の削除、手動の削除と削除できない条件）
- Google Cloud: [Deploying container images](https://docs.cloud.google.com/run/docs/deploying)（タグの digest への解決、使えるレジストリ）
- Google Cloud: [Restrict network ingress](https://docs.cloud.google.com/run/docs/securing/ingress)（ingress はサービスの設定）
- Google Cloud SDK 570.0.0 の `gcloud run deploy --help` / `gcloud run services update-traffic --help`（`SERVICE` は引数か対話の入力で与える）。資格情報の無い環境での実行で、非対話のとき、`SERVICE` を省いた `gcloud run deploy` と、リージョンの設定（`run/region`）が無い状態で `--region` を省いた `update-traffic` が失敗することを確認した（2026-10-12）
