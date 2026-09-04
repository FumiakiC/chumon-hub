import { describe, expect, it } from 'vitest'

import { goldenLabelSchema, goldenSetSchema } from '@/lib/eval/label'

const validLabel = {
  caseId: 'dummy-001',
  file: 'pdf/dummy-001.pdf',
  expected: {
    drawingNo: '12D925-101',
    partName: 'ブラケット',
    material: 'SS400',
    quantity: 4,
    surfaceTreatment: '',
    notes: '',
  },
}

describe('goldenLabelSchema', () => {
  it('必須項目が揃っていれば通る', () => {
    expect(goldenLabelSchema.parse(validLabel).caseId).toBe('dummy-001')
  })

  it('未知のキーを拒否する（ラベルのタイプミスを黙って捨てない）', () => {
    const result = goldenLabelSchema.safeParse({
      ...validLabel,
      drawingNumber: '12D925-101',
    })
    expect(result.success).toBe(false)
  })

  it('空欄の項目も省略できない（書き忘れと「空欄が正解」を区別する）', () => {
    const expected: Record<string, unknown> = { ...validLabel.expected }
    delete expected.surfaceTreatment
    const result = goldenLabelSchema.safeParse({ ...validLabel, expected })
    expect(result.success).toBe(false)
  })

  it('記載なしの数量は null で表す', () => {
    const result = goldenLabelSchema.safeParse({
      ...validLabel,
      expected: { ...validLabel.expected, quantity: null },
    })
    expect(result.success).toBe(true)
  })
})

describe('goldenSetSchema', () => {
  it('caseId の重複を弾く', () => {
    const result = goldenSetSchema.safeParse([validLabel, { ...validLabel }])
    expect(result.success).toBe(false)
  })

  it('caseId が一意なら通る', () => {
    const result = goldenSetSchema.safeParse([
      validLabel,
      { ...validLabel, caseId: 'dummy-002' },
    ])
    expect(result.success).toBe(true)
  })
})
