import {
  EVALUATED_FIELDS,
  type EvaluatedField,
  type GoldenLabel,
} from '@/lib/eval/label'
import {
  formatNormalized,
  formatRaw,
  normalizeField,
  valuesEqual,
} from '@/lib/eval/normalize'

export type FieldVerdict = 'match' | 'mismatch' | 'both-empty'

/**
 * フィールド1つの判定。
 *
 * `both-empty` を `match` と分けて数えるのは、空欄一致による accuracy の水増しを
 * 可視化するため（基本設計 §3）。
 */
export interface FieldResult {
  field: EvaluatedField
  verdict: FieldVerdict
  /** 一致の根拠。`accepted` は許容リスト経由の一致。 */
  matchedBy?: 'expected' | 'accepted'
  expectedRaw: string
  actualRaw: string
  expectedNormalized: string
  actualNormalized: string
}

export interface CaseResult {
  caseId: string
  /** mismatch が1件も無い（＝ match と both-empty のみ）。 */
  allMatch: boolean
  fields: FieldResult[]
}

export interface FieldSummary {
  match: number
  mismatch: number
  bothEmpty: number
  total: number
  /** both-empty を一致として数えた素の一致率（空欄一致で水増しされる）。 */
  accuracy: number
  /** both-empty を母数から外した一致率。母数が 0 なら null。 */
  strictAccuracy: number | null
}

export interface EvalSummary {
  cases: number
  allMatchCases: number
  allMatchRate: number
  byField: Record<EvaluatedField, FieldSummary>
}

/**
 * 抽出結果（AI 出力）側の入力。
 * 評価ロジックは `drawingSchema` に直接依存せず、フィールド名で引くだけにする
 * （スキーマ v2 で項目が増えても評価側が壊れないようにするため）。
 */
export type ExtractionActual = Readonly<
  Partial<Record<EvaluatedField, unknown>>
>

function mapFields<T>(
  fn: (field: EvaluatedField) => T
): Record<EvaluatedField, T> {
  // Object.fromEntries はキーの literal 型を失うため、ここだけ型を宣言し直す。
  return Object.fromEntries(
    EVALUATED_FIELDS.map((field) => [field, fn(field)])
  ) as Record<EvaluatedField, T>
}

export function scoreField(
  field: EvaluatedField,
  label: GoldenLabel,
  actual: ExtractionActual
): FieldResult {
  const expectedValue = label.expected[field]
  const actualValue = actual[field]

  const expected = normalizeField(field, expectedValue)
  const observed = normalizeField(field, actualValue)

  const base = {
    field,
    expectedRaw: formatRaw(expectedValue),
    actualRaw: formatRaw(actualValue),
    expectedNormalized: formatNormalized(expected),
    actualNormalized: formatNormalized(observed),
  }

  if (expected.kind === 'empty' && observed.kind === 'empty') {
    return { ...base, verdict: 'both-empty' }
  }

  if (valuesEqual(expected, observed)) {
    return { ...base, verdict: 'match', matchedBy: 'expected' }
  }

  const acceptedValues: readonly unknown[] = label.accepted?.[field] ?? []
  const acceptedHit = acceptedValues.some((candidate) =>
    valuesEqual(normalizeField(field, candidate), observed)
  )
  if (acceptedHit) {
    return { ...base, verdict: 'match', matchedBy: 'accepted' }
  }

  return { ...base, verdict: 'mismatch' }
}

export function scoreCase(
  label: GoldenLabel,
  actual: ExtractionActual
): CaseResult {
  const fields = EVALUATED_FIELDS.map((field) =>
    scoreField(field, label, actual)
  )
  return {
    caseId: label.caseId,
    allMatch: fields.every((result) => result.verdict !== 'mismatch'),
    fields,
  }
}

function summarizeField(
  results: readonly CaseResult[],
  field: EvaluatedField
): FieldSummary {
  const verdicts = results.flatMap((result) =>
    result.fields.filter((entry) => entry.field === field)
  )

  const match = verdicts.filter((entry) => entry.verdict === 'match').length
  const mismatch = verdicts.filter(
    (entry) => entry.verdict === 'mismatch'
  ).length
  const bothEmpty = verdicts.filter(
    (entry) => entry.verdict === 'both-empty'
  ).length
  const total = verdicts.length
  const strictTotal = match + mismatch

  return {
    match,
    mismatch,
    bothEmpty,
    total,
    accuracy: total === 0 ? 0 : (match + bothEmpty) / total,
    strictAccuracy: strictTotal === 0 ? null : match / strictTotal,
  }
}

export function summarize(results: readonly CaseResult[]): EvalSummary {
  const allMatchCases = results.filter((result) => result.allMatch).length

  return {
    cases: results.length,
    allMatchCases,
    allMatchRate: results.length === 0 ? 0 : allMatchCases / results.length,
    byField: mapFields((field) => summarizeField(results, field)),
  }
}
