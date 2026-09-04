import { describe, expect, it } from 'vitest'

import { normalizeField, valuesEqual } from '@/lib/eval/normalize'

describe('normalizeField', () => {
  it('図番は全角・大小・空白・ハイフン類の揺れを吸収する', () => {
    expect(normalizeField('drawingNo', '１２ｄ９２５－１０１')).toEqual({
      kind: 'text',
      value: '12D925-101',
    })
    expect(normalizeField('drawingNo', ' 12d925 ‑ 101 ')).toEqual({
      kind: 'text',
      value: '12D925-101',
    })
  })

  it('カタカナを含むフィールドの長音符はハイフンに潰さない', () => {
    expect(normalizeField('surfaceTreatment', 'クロメート')).toEqual({
      kind: 'text',
      value: 'クロメート',
    })
  })

  it('材質は半角カナ・大小・空白の揺れを吸収する', () => {
    expect(normalizeField('material', 'ｓｓ４００')).toEqual({
      kind: 'text',
      value: 'SS400',
    })
    expect(normalizeField('material', 'ｽﾃﾝﾚｽ 鋼')).toEqual({
      kind: 'text',
      value: 'ステンレス鋼',
    })
  })

  it('品名はひらがなをカタカナへ寄せる', () => {
    expect(normalizeField('partName', 'ぶらけっと')).toEqual({
      kind: 'text',
      value: 'ブラケット',
    })
  })

  it('備考は空白を畳むが除去はしない', () => {
    expect(normalizeField('notes', '面取り  0.5  以下')).toEqual({
      kind: 'text',
      value: '面取り 0.5 以下',
    })
  })

  it('空文字・null・undefined を空欄として同一視する', () => {
    expect(normalizeField('material', '')).toEqual({ kind: 'empty' })
    expect(normalizeField('material', '   ')).toEqual({ kind: 'empty' })
    expect(normalizeField('material', null)).toEqual({ kind: 'empty' })
    expect(normalizeField('material', undefined)).toEqual({ kind: 'empty' })
    expect(normalizeField('quantity', null)).toEqual({ kind: 'empty' })
  })

  it('数量は数値・全角数字・桁区切りを数値として扱う', () => {
    expect(normalizeField('quantity', 4)).toEqual({ kind: 'number', value: 4 })
    expect(normalizeField('quantity', '４')).toEqual({
      kind: 'number',
      value: 4,
    })
    expect(normalizeField('quantity', '1,200')).toEqual({
      kind: 'number',
      value: 1200,
    })
  })

  it('数値化できない数量は空欄に丸めず、必ず不一致になる形で残す', () => {
    expect(normalizeField('quantity', '2個')).toEqual({
      kind: 'text',
      value: '2個',
    })
    expect(normalizeField('quantity', '0x10')).toEqual({
      kind: 'text',
      value: '0x10',
    })
  })

  it('桁区切りが壊れた数量を数値に化けさせない', () => {
    expect(normalizeField('quantity', '1,,200')).toEqual({
      kind: 'text',
      value: '1,,200',
    })
    expect(normalizeField('quantity', '1,2')).toEqual({
      kind: 'text',
      value: '1,2',
    })
    expect(normalizeField('quantity', '1,20')).toEqual({
      kind: 'text',
      value: '1,20',
    })
    expect(normalizeField('quantity', '1,2000')).toEqual({
      kind: 'text',
      value: '1,2000',
    })
    expect(normalizeField('quantity', '1 2')).toEqual({
      kind: 'text',
      value: '1 2',
    })
  })

  it('正しい桁区切りは数値として受け付ける', () => {
    expect(normalizeField('quantity', '12,345')).toEqual({
      kind: 'number',
      value: 12345,
    })
    expect(normalizeField('quantity', '1,234,567')).toEqual({
      kind: 'number',
      value: 1234567,
    })
  })
})

describe('valuesEqual', () => {
  it('空欄どうしは一致する', () => {
    expect(
      valuesEqual(
        normalizeField('material', ''),
        normalizeField('material', null)
      )
    ).toBe(true)
  })

  it('空欄と非空欄は一致しない', () => {
    expect(
      valuesEqual(
        normalizeField('material', ''),
        normalizeField('material', 'SS400')
      )
    ).toBe(false)
  })

  it('種別が違う値は一致しない', () => {
    expect(
      valuesEqual(
        normalizeField('quantity', 2),
        normalizeField('quantity', '2個')
      )
    ).toBe(false)
  })
})
