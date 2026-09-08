import {
  mkdir,
  mkdtemp,
  realpath,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { assertRealPathWithin, resolveGoldenFile } from '@/lib/eval/golden'

const GOLDEN_DIR = '/tmp/golden'
const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true }))
  )
})

describe('resolveGoldenFile', () => {
  it('通常の相対パスは goldenDir 配下に解決される', () => {
    expect(resolveGoldenFile(GOLDEN_DIR, 'pdf/dummy-001.pdf')).toBe(
      path.join(GOLDEN_DIR, 'pdf/dummy-001.pdf')
    )
  })

  it('.. で始まる通常のディレクトリ名は goldenDir 配下に解決される', () => {
    expect(resolveGoldenFile(GOLDEN_DIR, '..foo/x.pdf')).toBe(
      path.join(GOLDEN_DIR, '..foo/x.pdf')
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

describe('assertRealPathWithin', () => {
  it('goldenDir 配下の実ファイルは realpath を返す', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'golden-realpath-'))
    temporaryDirectories.push(root)
    const goldenDir = path.join(root, 'golden')
    const filePath = path.join(goldenDir, 'pdf', 'inside.pdf')
    await mkdir(path.dirname(filePath), { recursive: true })
    await writeFile(filePath, 'dummy')

    await expect(assertRealPathWithin(goldenDir, filePath)).resolves.toBe(
      await realpath(filePath)
    )
  })

  it('goldenDir の外を指す symlink は throw する', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'golden-realpath-'))
    temporaryDirectories.push(root)
    const goldenDir = path.join(root, 'golden')
    const outsidePath = path.join(root, 'outside.pdf')
    const symlinkPath = path.join(goldenDir, 'escape.pdf')
    await mkdir(goldenDir)
    await writeFile(outsidePath, 'dummy')
    await symlink(outsidePath, symlinkPath)

    await expect(assertRealPathWithin(goldenDir, symlinkPath)).rejects.toThrow()
  })
})
