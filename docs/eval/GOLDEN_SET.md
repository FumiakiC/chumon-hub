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

- `expected` は6項目すべて必須。空欄は空文字（`quantity` は `null`）で明示する。省略可にすると「書き忘れ」と「空欄が正解」が区別できず、both-empty の集計が信用できなくなる。
- `accepted` は任意。機械的正規化で吸収できない表記ゆれを、**実際に落ちた事例から**足していく。同義語辞書を先回りで作らない。
- 未知のキーはスキーマが拒否する（ラベルのタイプミスを黙って捨てないため）。

## 判定と集計

1. 機械的正規化（`lib/eval/normalize.ts`）: NFKC・連続空白の畳み込み・空欄（`''` / `null` / `undefined`）の同一視。フィールド別に大文字化 / 空白除去 / ひらがな→カタカナ / ハイフン類統一（**図番のみ**。長音符と衝突するため）。
2. 許容リスト（`accepted`）。

集計は `match` / `mismatch` / `both-empty` の3値（`lib/eval/score.ts`）。`accuracy` は both-empty を一致に含む素の値、`strictAccuracy` は both-empty を母数から外した値で、空欄一致による水増しを見分けられるようにしている。
