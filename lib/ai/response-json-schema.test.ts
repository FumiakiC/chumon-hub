// このスナップショットは Gemini への入力そのものであり、差分が出たら意図した変更か確認する。
// プロパティの順序も入力の一部であるため、文字列で固定している。
// drawingSchema の差分は評価ハーネスでの再測定対象（基準: docs/roadmap/PHASE4_PLUS_ROADMAP.md §3.2）。
// generateStructured に新しいスキーマを渡す場合は、このテストにも追加する。
import { describe, expect, it } from 'vitest'

import { toResponseJsonSchema } from '@/lib/ai/response-json-schema'
import {
  documentTypeSchema,
  drawingSchema,
  orderSchema,
} from '@/lib/ai/schemas'

describe('toResponseJsonSchema', () => {
  it.each([
    { name: 'documentTypeSchema', schema: documentTypeSchema },
    { name: 'orderSchema', schema: orderSchema },
    { name: 'drawingSchema', schema: drawingSchema },
  ])('$name の Gemini 入力を固定する', ({ schema }) => {
    const responseJsonSchema = toResponseJsonSchema(schema)

    expect(responseJsonSchema).not.toHaveProperty('$schema')
    expect(JSON.stringify(responseJsonSchema, null, 2)).toMatchSnapshot()
  })
})
