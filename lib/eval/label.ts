import { z } from 'zod'

/**
 * 評価対象フィールド。
 *
 * `drawingSchema` のうち「図面から一意に読み取れる」ものだけを対象にする。
 * `reasoning`（思考過程）と `confidence`（モデルの自己申告）は正解を定義できないため
 * 評価対象外とし、結果 JSON には参考値として残す（記録はハーネス側の責務）。
 */
export const EVALUATED_FIELDS = [
  'drawingNo',
  'partName',
  'material',
  'quantity',
  'surfaceTreatment',
  'notes',
] as const

export type EvaluatedField = (typeof EVALUATED_FIELDS)[number]

/**
 * 正解値。
 *
 * 空欄は空文字（quantity は null）で**明示的に**書かせる。省略可にすると
 * 「書き忘れ」と「空欄が正解」が区別できなくなり、both-empty の集計が信用できなくなる。
 */
export const goldenExpectedSchema = z.strictObject({
  drawingNo: z.string(),
  partName: z.string(),
  material: z.string(),
  quantity: z.number().nullable(),
  surfaceTreatment: z.string(),
  notes: z.string(),
})

/**
 * 許容リスト（判定2層目）。
 *
 * 機械的正規化で吸収できない表記ゆれを、**実際に落ちた事例から育てる**ためのもの。
 * 同義語辞書を先回りで作らない（基本設計 §3）。expected と同じ正規化を通して比較する。
 */
export const goldenAcceptedSchema = z.strictObject({
  drawingNo: z.array(z.string()).optional(),
  partName: z.array(z.string()).optional(),
  material: z.array(z.string()).optional(),
  quantity: z.array(z.number().nullable()).optional(),
  surfaceTreatment: z.array(z.string()).optional(),
  notes: z.array(z.string()).optional(),
})

export const goldenLabelSchema = z.strictObject({
  /** golden set 内で一意なケース ID。結果 JSON のキーになる。 */
  caseId: z.string().min(1),
  /** `GOLDEN_SET_DIR` からの相対パス（墨消し済みの元図面 PDF）。 */
  file: z.string().min(1),
  expected: goldenExpectedSchema,
  accepted: goldenAcceptedSchema.optional(),
  /** ラベル作成時の判断メモ。評価には使わない。 */
  memo: z.string().optional(),
})

/**
 * golden set 全体（ラベルファイル1本の中身）。
 * `caseId` の重複はケースの取り違えを招くため、読み込み時点で弾く。
 */
export const goldenSetSchema = z
  .array(goldenLabelSchema)
  .refine(
    (labels) =>
      new Set(labels.map((label) => label.caseId)).size === labels.length,
    { message: 'caseId が重複しています' }
  )

export type GoldenExpected = z.infer<typeof goldenExpectedSchema>
export type GoldenAccepted = z.infer<typeof goldenAcceptedSchema>
export type GoldenLabel = z.infer<typeof goldenLabelSchema>
export type GoldenSet = z.infer<typeof goldenSetSchema>
