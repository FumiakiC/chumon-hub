import { describe, expect, it } from 'vitest'

import type { GoldenLabel } from '@/lib/eval/label'
import { scoreCase, scoreField, summarize } from '@/lib/eval/score'

const label: GoldenLabel = {
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

describe('scoreField', () => {
  it('正規化後に一致すれば match（根拠は expected）', () => {
    const result = scoreField('drawingNo', label, { drawingNo: '12d925－101' })
    expect(result.verdict).toBe('match')
    expect(result.matchedBy).toBe('expected')
  })

  it('期待も実測も空欄なら both-empty', () => {
    expect(
      scoreField('surfaceTreatment', label, { surfaceTreatment: '' }).verdict
    ).toBe('both-empty')
    expect(scoreField('notes', label, {}).verdict).toBe('both-empty')
  })

  it('空欄が正解の項目に値を埋めた場合は mismatch', () => {
    const result = scoreField('surfaceTreatment', label, {
      surfaceTreatment: '千葉',
    })
    expect(result.verdict).toBe('mismatch')
    expect(result.expectedNormalized).toBe('')
    expect(result.actualNormalized).toBe('千葉')
  })

  it('accepted に載っていれば match（根拠は accepted）', () => {
    const withAccepted: GoldenLabel = {
      ...label,
      accepted: { material: ['SS400相当', '一般構造用圧延鋼材'] },
    }
    const result = scoreField('material', withAccepted, {
      material: '一般構造用圧延鋼材',
    })
    expect(result.verdict).toBe('match')
    expect(result.matchedBy).toBe('accepted')
  })

  it('生値と正規化値の両方を記録する', () => {
    const result = scoreField('material', label, { material: ' ｓｓ４００ ' })
    expect(result.actualRaw).toBe(' ｓｓ４００ ')
    expect(result.actualNormalized).toBe('SS400')
  })
})

describe('scoreCase', () => {
  it('mismatch が無ければ allMatch（both-empty を含んでよい）', () => {
    const result = scoreCase(label, {
      drawingNo: '12D925-101',
      partName: 'ブラケット',
      material: 'SS400',
      quantity: 4,
      surfaceTreatment: '',
      notes: '',
    })
    expect(result.allMatch).toBe(true)
    expect(result.fields).toHaveLength(6)
  })

  it('1項目でも外れれば allMatch は false', () => {
    const result = scoreCase(label, { drawingNo: '12D925-101', quantity: 2 })
    expect(result.allMatch).toBe(false)
  })
})

describe('summarize', () => {
  it('both-empty を分けて数え、水増しした accuracy と厳格な accuracy を両方出す', () => {
    const results = [
      scoreCase(label, {
        drawingNo: '12D925-101',
        partName: 'ブラケット',
        material: 'SS400',
        quantity: 4,
        surfaceTreatment: '',
        notes: '',
      }),
      scoreCase(label, {
        drawingNo: '12D925-101',
        partName: 'ブラケット',
        material: '',
        quantity: 4,
        surfaceTreatment: '',
        notes: '',
      }),
    ]

    const summary = summarize(results)

    expect(summary.cases).toBe(2)
    expect(summary.allMatchCases).toBe(1)
    expect(summary.allMatchRate).toBe(0.5)

    expect(summary.byField.material).toMatchObject({
      match: 1,
      mismatch: 1,
      bothEmpty: 0,
      accuracy: 0.5,
      strictAccuracy: 0.5,
    })

    expect(summary.byField.surfaceTreatment).toMatchObject({
      match: 0,
      mismatch: 0,
      bothEmpty: 2,
      accuracy: 1,
      strictAccuracy: null,
    })
  })

  it('結果が空でも 0 除算しない', () => {
    const summary = summarize([])
    expect(summary.allMatchRate).toBe(0)
    expect(summary.byField.drawingNo.accuracy).toBe(0)
    expect(summary.byField.drawingNo.strictAccuracy).toBeNull()
  })
})
