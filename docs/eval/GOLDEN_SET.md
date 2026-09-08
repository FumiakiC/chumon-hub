# golden set とラベル形式（Phase 4a 評価ハーネス）

図面抽出（`extract-drawing`）の精度を測るための golden set の置き場所とラベル形式。
設計の正は `docs/roadmap/PHASE4_PLUS_ROADMAP.md` 基本設計 §3「Phase 4a 詳細計画」。

## 置き場所

- PDF と正解ラベルは private repo `chumon-hub-golden` に同居させる。**本リポジトリには置かない**（正解ラベル自体も機密）。
- ハーネスは環境変数 `GOLDEN_SET_DIR` でローカル clone を参照する。
- 実行結果 JSON には golden repo のコミットハッシュを記録し、モデル × ラベル版の組で測定を再現できるようにする。

## PDF の要件

- Adobe Acrobat Pro の**墨消し（Redact）**でコンテンツ自体を削除したもの。黒塗り注釈は不可（コンテンツストリームが残る）。
- 残す領域: 表題欄（図番・品名・材質・表面処理・備考）と、数量の記載部（粗さ記号の直上。表題欄外）。
- 用紙サイズ・ページ構造は原本のまま維持する（`detectPageSize` と座標系を変えないため）。

## ディレクトリ構成（`GOLDEN_SET_DIR`）

    labels.json        # GoldenSet（ラベルの配列）
    pdf/<caseId>.pdf   # 墨消し済みの元図面

`labels.json` の各要素の `file` は `GOLDEN_SET_DIR` からの相対パス。

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
- 主なフィールド: `schemaVersion` / `runAt`（ISO 8601 UTC） / `stage`（id・表示名） / `model` / `appCommit`（本体 repo の git HEAD） / `goldenCommit`（golden repo の git HEAD） / `cases`（ケースごとの `scored` または `failed` 記録。`scored` は per-field 判定と参考値 `reasoning`/`confidence` を含む） / `summary`（`scored` のみで集計） / `failedCases`。
- Gemini の `fileUri` やリモート `name` は結果 JSON にもログにも出さない。

## 合成ダミー

golden set が未整備でもハーネスの配線が通ることを確認するための、合成ダミー1件を生成できる（抽出精度の保証は目的ではない）。

    pnpm eval:dummy --out <repo 外のディレクトリ>      # labels.json と pdf/dummy-001.pdf を生成
    GOLDEN_SET_DIR=<同ディレクトリ> pnpm eval:drawing   # そのダミーに対して実行

出力先に既に `labels.json` がある場合は上書きせず exit 1 する（実 golden set の破壊防止）。ダミー PDF は A2 横・標準フォント（ASCII のみ）で、`CROP_SETTINGS.A2` のクロップ領域内に表題欄と数量記号を描く。
