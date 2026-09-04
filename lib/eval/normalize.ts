import type { EvaluatedField } from '@/lib/eval/label'

/**
 * 正規化済みの値（判定1層目の出力）。
 *
 * - `empty`: 記載なし。`''` / `null` / `undefined` を同一視する。
 * - `number`: 数値として比較する（quantity）。
 * - `text`: 文字列として比較する。
 *
 * kind が異なる値は常に不一致になる。数値化できない quantity を黙って空欄に
 * 丸めると誤抽出が both-empty に化けるため、`text` として残し必ず mismatch に落とす。
 */
export type NormalizedValue =
  | { kind: 'empty' }
  | { kind: 'number'; value: number }
  | { kind: 'text'; value: string }

/**
 * ハイフンとして同一視する文字。**図番にのみ**適用する。
 * 長音符 U+30FC を含むため、カタカナを含むフィールドに適用すると
 * 「クロメート」→「クロメ-ト」のように意味が壊れる。
 */
const HYPHEN_LIKE = /[-\u2010-\u2015\u2212\u30FC\uFF0D]/g

/** ひらがな（U+3041〜U+3096）。カタカナへは +0x60 でそのまま写せる。 */
const HIRAGANA = /[\u3041-\u3096]/g

/** 10 進の整数・小数のみを数値として受け付ける（`Number()` の緩い変換を使わない）。 */
const DECIMAL_NUMBER = /^-?\d+(?:\.\d+)?$/

interface TextFieldSpec {
  kind: 'text'
  /** 大文字化する（英字の大小を同一視する）。 */
  upperCase: boolean
  /** 空白を全て除去する（語中の空白の有無を同一視する）。 */
  stripSpaces: boolean
  /** ハイフン類を `-` に統一する（図番のみ。上記 HYPHEN_LIKE の注意を参照）。 */
  unifyHyphens: boolean
  /** ひらがなをカタカナに寄せる。 */
  katakana: boolean
}

type FieldSpec = TextFieldSpec | { kind: 'number' }

const FIELD_SPECS: Record<EvaluatedField, FieldSpec> = {
  // 図番は英数記号のみ。全角/半角・大小・空白・ハイフン類の揺れだけを吸収する。
  drawingNo: {
    kind: 'text',
    upperCase: true,
    stripSpaces: true,
    unifyHyphens: true,
    katakana: false,
  },
  // 品名・材質・表面処理は語中の空白とかなの揺れを吸収する。
  partName: {
    kind: 'text',
    upperCase: true,
    stripSpaces: true,
    unifyHyphens: false,
    katakana: true,
  },
  material: {
    kind: 'text',
    upperCase: true,
    stripSpaces: true,
    unifyHyphens: false,
    katakana: true,
  },
  surfaceTreatment: {
    kind: 'text',
    upperCase: true,
    stripSpaces: true,
    unifyHyphens: false,
    katakana: true,
  },
  // 備考は自由記述。空白の畳み込みまでに留め、内容の揺れは accepted で吸収する。
  notes: {
    kind: 'text',
    upperCase: false,
    stripSpaces: false,
    unifyHyphens: false,
    katakana: false,
  },
  quantity: { kind: 'number' },
}

/** NFKC 正規化 → 連続空白を半角スペース1つに畳む → 前後を trim。 */
export function normalizeBase(value: string): string {
  return value.normalize('NFKC').replace(/\s+/g, ' ').trim()
}

/** ひらがなをカタカナへ写す。 */
export function toKatakana(value: string): string {
  return value.replace(HIRAGANA, (char) =>
    String.fromCharCode(char.charCodeAt(0) + 0x60)
  )
}

function normalizeNumber(value: unknown): NormalizedValue {
  if (value === null || value === undefined) return { kind: 'empty' }

  if (typeof value === 'number') {
    if (Number.isFinite(value)) return { kind: 'number', value }
    // NaN / Infinity は数値として比較できないので、必ず不一致になる形で残す。
    return { kind: 'text', value: String(value) }
  }

  const raw = typeof value === 'string' ? value : String(value)
  const compact = normalizeBase(raw).replace(/[\s,]/g, '')
  if (compact === '') return { kind: 'empty' }
  if (!DECIMAL_NUMBER.test(compact)) return { kind: 'text', value: compact }
  return { kind: 'number', value: Number(compact) }
}

function normalizeText(value: unknown, spec: TextFieldSpec): NormalizedValue {
  if (value === null || value === undefined) return { kind: 'empty' }

  const raw = typeof value === 'string' ? value : String(value)
  let normalized = normalizeBase(raw)
  if (spec.unifyHyphens) normalized = normalized.replace(HYPHEN_LIKE, '-')
  if (spec.stripSpaces) normalized = normalized.replace(/\s+/g, '')
  if (spec.upperCase) normalized = normalized.toUpperCase()
  if (spec.katakana) normalized = toKatakana(normalized)

  if (normalized === '') return { kind: 'empty' }
  return { kind: 'text', value: normalized }
}

/** フィールド別の規則で値を正規化する。 */
export function normalizeField(
  field: EvaluatedField,
  value: unknown
): NormalizedValue {
  const spec = FIELD_SPECS[field]
  return spec.kind === 'number'
    ? normalizeNumber(value)
    : normalizeText(value, spec)
}

/** 正規化済みの値どうしを比較する。 */
export function valuesEqual(a: NormalizedValue, b: NormalizedValue): boolean {
  if (a.kind === 'empty' || b.kind === 'empty') return a.kind === b.kind
  if (a.kind === 'number' && b.kind === 'number') return a.value === b.value
  if (a.kind === 'text' && b.kind === 'text') return a.value === b.value
  return false
}

/** レポート表示用の文字列（空欄は空文字）。 */
export function formatNormalized(value: NormalizedValue): string {
  return value.kind === 'empty' ? '' : String(value.value)
}

/** レポート表示用に生値をそのまま文字列化する（空欄は空文字）。 */
export function formatRaw(value: unknown): string {
  if (value === null || value === undefined) return ''
  return typeof value === 'string' ? value : String(value)
}
