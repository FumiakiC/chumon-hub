import path from 'node:path'
import { describe, expect, it } from 'vitest'

import { resolveGoldenFile } from '@/lib/eval/golden'

const GOLDEN_DIR = '/tmp/golden'

describe('resolveGoldenFile', () => {
  it('通常の相対パスは goldenDir 配下に解決される', () => {
    expect(resolveGoldenFile(GOLDEN_DIR, 'pdf/dummy-001.pdf')).toBe(
      path.join(GOLDEN_DIR, 'pdf/dummy-001.pdf')
    )
  })

  it('親ディレクトリへ脱出する相対パスは throw する', () => {
    expect(() => resolveGoldenFile(GOLDEN_DIR, '../x.pdf')).toThrow()
  })

  it('中間で親へ抜ける相対パスは throw する', () => {
    expect(() => resolveGoldenFile(GOLDEN_DIR, 'pdf/../../x.pdf')).toThrow()
  })

  it('絶対パスは goldenDir 配下を指していても throw する', () => {
    expect(() =>
      resolveGoldenFile(GOLDEN_DIR, path.join(GOLDEN_DIR, 'pdf/x.pdf'))
    ).toThrow()
  })
})
