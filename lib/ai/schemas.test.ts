import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import { drawingSchema } from '@/lib/ai/schemas'

describe('drawingSchema', () => {
  it('Gemini に渡す JSON Schema のキー集合を固定する', () => {
    const jsonSchema = z.toJSONSchema(drawingSchema)

    // このキー集合は Gemini への入力そのものであり、変更時は golden set の再測定が必要。
    expect(Object.keys(jsonSchema.properties ?? {})).toEqual([
      'reasoning',
      'drawingNo',
      'partName',
      'material',
      'quantity',
      'surfaceTreatment',
      'confidence',
    ])
  })

  it('入力に notes が含まれていても解析結果から除外する', () => {
    const result = drawingSchema.parse({
      reasoning: '表題欄を確認した',
      drawingNo: '12D925-101',
      partName: 'ブラケット',
      material: 'SS400',
      quantity: 4,
      surfaceTreatment: '',
      notes: '図面本文の注記',
      confidence: 95,
    })

    expect(result).not.toHaveProperty('notes')
  })
})
