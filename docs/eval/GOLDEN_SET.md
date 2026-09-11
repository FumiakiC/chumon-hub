# golden set とラベル形式（Phase 4a 評価ハーネス）

図面抽出（`extract-drawing`）の精度を測るための golden set の置き場所とラベル形式。
設計の正は `docs/roadmap/PHASE4_PLUS_ROADMAP.md` 基本設計 §3「Phase 4a 詳細計画」。

## 置き場所

- PDF と正解ラベルは private repo `chumon-hub-golden` に同居させる。**本リポジトリには置かない**（正解ラベル自体も機密）。
- ハーネスは環境変数 `GOLDEN_SET_DIR` でローカル clone を参照する。
- 実行結果 JSON には golden repo のコミットハッシュを記録し、モデル × ラベル版の組で測定を再現できるようにする。

## golden set repo の準備

ルート直下のラベルファイル名は `labels.json` で固定する。PDF は `pdf/` 配下へ置き、`results/` はハーネスの初回出力時に自動生成される。

    labels.json        # GoldenSet（ラベルの配列）
    pdf/<caseId>.pdf   # 墨消し済みの元図面
    results/           # ハーネスが自動生成する結果 JSON

- `labels.json` の各要素の `file` は `GOLDEN_SET_DIR` からの相対パス。
- git 管理は必須ではない（`getGitHead` は取得失敗時に `null` を返す）が、推奨する。結果 JSON の `goldenCommit` が「同じ正解ラベルで測った」ことの根拠になるためである。ラベルは許容リストを育てる過程で変化するため、コミットハッシュがないと過去の測定と比較できない。
- `getGitHead` が記録するのは `git rev-parse HEAD` の結果のみであり、作業ツリーの未コミット変更は反映されない。`labels.json` や PDF をコミットせずに編集したまま測定すると、`goldenCommit` は変わらず、実際に評価した入力と一致しないハッシュが記録される。
- このため結果 JSON には `goldenDirty` / `appDirty`（`boolean | null`）も記録される。`goldenDirty` は golden repo の `labels.json` と評価対象ケースの PDF（`--case` で絞った場合は絞った後のケースのみ）に限定した判定で、gitignore 済みの入力も dirty 扱いにする。`appDirty` は本体リポジトリの作業ツリー全体の判定。いずれも git repo でない等で判定不能な場合は `null` になる。dirty のときは実行時に stderr へ警告が出るが、実行は中断されない。
- `goldenCommit` 単独では再現性を保証しない。測定前に golden repo の変更をコミットし、`goldenDirty` / `appDirty` が `false` であることを確認してから `pnpm eval:drawing` を実行することを推奨する。
- **本体リポジトリの作業ツリー内には置かない**。正解ラベルを本体 repo にコミットする事故を防ぐためである。
- Dev Container にはホスト側ディレクトリ用の追加マウント設定がないため、ホスト側の clone はコンテナから見えない。コンテナ内かつワークスペース外（例: `/home/node/chumon-hub-golden`）に置き、`.env.local` に `GOLDEN_SET_DIR=/home/node/chumon-hub-golden` を記載する。`GOLDEN_SET_DIR` は秘匿値ではないため、`op://` 参照は不要。
- Dev Container をリビルドするとコンテナ内のデータは失われる。結果 JSON を残す場合はコンテナ外へ退避するか、リモートを持つ運用にする。

## PDF の要件

- Adobe Acrobat Pro の**墨消し（Redact）**でコンテンツ自体を削除したもの。黒塗り注釈は不可（コンテンツストリームが残る）。
- 残す領域: 表題欄（図番・品名・材質・表面処理・備考）と、数量の記載部（粗さ記号の直上。表題欄外）。
- 用紙サイズ・ページ構造は原本のまま維持する（`detectPageSize` と座標系を変えないため）。

## ラベル形式

スキーマの正は `lib/eval/label.ts`（`goldenSetSchema`）。

    [
      {
        "caseId": "dummy-001",
        "file": "pdf/dummy-001.pdf",
        "expected": {
          "drawingNo": "12D925-101",
          "partName": "ブラケット",
          "material": "SS400",
          "quantity": 4,
          "surfaceTreatment": "",
          "notes": ""
        },
        "accepted": { "material": ["一般構造用圧延鋼材"] },
        "memo": "表面処理は記載なし"
      }
    ]

  - `file` は `GOLDEN_SET_DIR` からの相対パス。絶対パス・Windows のドライブレター・`..` によるディレクトリ脱出はスキーマが拒否する（開く直前の解決後パスの包含確認はハーネス側の責務）。
- `expected` は6項目すべて必須。空欄は空文字（`quantity` は `null`）で明示する。省略可にすると「書き忘れ」と「空欄が正解」が区別できず、both-empty の集計が信用できなくなる。
- `accepted` は任意。機械的正規化で吸収できない表記ゆれを、**実際に落ちた事例から**足していく。同義語辞書を先回りで作らない。
- 未知のキーはスキーマが拒否する（ラベルのタイプミスを黙って捨てないため）。

## 判定と集計

1. 機械的正規化（`lib/eval/normalize.ts`）: NFKC・連続空白の畳み込み・空欄（`''` / `null` / `undefined`）の同一視。フィールド別に大文字化 / 空白除去 / ひらがな→カタカナ / ハイフン類統一（**図番のみ**。長音符と衝突するため）。
2. 許容リスト（`accepted`）。

集計は `match` / `mismatch` / `both-empty` の3値（`lib/eval/score.ts`）。`accuracy` は both-empty を一致に含む素の値、`strictAccuracy` は both-empty を母数から外した値で、空欄一致による水増しを見分けられるようにしている。

## 実行手順

ハーネス本体は AI（Gemini）を呼ぶため **tsx スクリプトの手動実行**とし、CI には載せない。API キーは `op run` 経由で実行時注入する。

    # golden set のローカル clone を GOLDEN_SET_DIR に設定してから実行
    pnpm eval:drawing                       # op run で GOOGLE_API_KEY を注入し全 stage を実行
    pnpm eval:drawing --stage A             # 入力段 A のみ
    pnpm eval:drawing --model <model-id>    # モデルを差し替えて before/after を測る
    pnpm eval:drawing --case dummy-001      # 特定ケースのみ（複数指定可）
    pnpm eval:drawing --out /path/to/out    # 出力先を明示

- `--stage`: `A` / `C2p` / `all`（既定 `all`）。
- `--model`: 省略時は `lib/ai/models.ts` の `GEMINI_MODELS.extractDrawing`。
- `--case`: 指定した `caseId` のみ実行（複数指定可）。
- `--out`: 結果 JSON の出力先。
- 環境変数 `GOLDEN_SET_DIR`（必須）・`GOOGLE_API_KEY`（必須）・`EVAL_OUTPUT_DIR`（任意）。`GOOGLE_API_KEY` を注入せずに実行すると理由を表示して exit 1 する。
- `op` を使わずローカルの実 API キーで実行する場合は `pnpm eval:drawing:local`（環境変数は各自で用意）。
- **CI では実行しない**（`vitest` の対象は `lib/**/*.test.ts` のみ。`scripts/**` は含まない）。

## 入力段（方式）

抽出前に PDF をどう加工して Gemini に渡すかを「入力段」として差し替え可能にする（`lib/eval/input-stages.ts`）。

- **A**: 現行 `crop-title-block` 経由。本番と同一の `cropTitleBlockPdf` を通すベースライン（最小化は効いていない）。
- **C-2′**: 墨消し済みの golden をそのまま投げる。
- C-1 / C-2 は今後 `lib/eval/input-stages.ts` に `prepare` 実装を1つ追加すれば載る（ラスタライザ等の依存追加は本 PR のスコープ外）。

## 結果 JSON

- 置き場所は既定で golden repo 側の `results/`（`--out` > `EVAL_OUTPUT_DIR` > `<GOLDEN_SET_DIR>/results` の優先順）。ファイル名は `<runAt を YYYYMMDDTHHmmssZ 形式にしたもの>-<stageId>.json`。
- `expected` / `actual` の生値（＝正解ラベルの実値）を含むため **機密であり本体 repo にはコミットしない**。
- 主なフィールド（`schemaVersion` は `2`）: `runAt`（ISO 8601 UTC） / `stage`（id・表示名） / `model` / `appCommit`（本体 repo の git HEAD） / `appDirty`（本体 repo の作業ツリー全体が未コミット変更を含むか。`null` は判定不能） / `goldenCommit`（golden repo の git HEAD） / `goldenDirty`（golden repo の `labels.json` と評価対象ケースの PDF に限定した未コミット判定。`null` は判定不能） / `cases`（ケースごとの `scored` または `failed` 記録。`scored` は per-field 判定と参考値 `reasoning`/`confidence` を含む） / `summary`（`scored` のみで集計） / `failedCases`。
- Gemini の `fileUri` やリモート `name` は結果 JSON にもログにも出さない。

## 合成ダミー

golden set が未整備でもハーネスの配線が通ることを確認するための、合成ダミー1件を生成できる（抽出精度の保証は目的ではない）。

    pnpm eval:dummy --out <repo 外のディレクトリ>      # labels.json と pdf/dummy-001.pdf を生成
    GOLDEN_SET_DIR=<同ディレクトリ> pnpm eval:drawing   # そのダミーに対して実行

出力先に既に `labels.json` がある場合は上書きせず exit 1 する（実 golden set の破壊防止）。ダミー PDF は A2 横・標準フォント（ASCII のみ）で、`CROP_SETTINGS.A2` のクロップ領域内に表題欄と数量記号を描く。
