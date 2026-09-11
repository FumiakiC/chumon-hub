import { execFile } from 'node:child_process'
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
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'

import {
  assertRealPathWithin,
  getGitDirty,
  resolveGoldenFile,
} from '@/lib/eval/golden'

const execFileAsync = promisify(execFile)

const GOLDEN_DIR = '/tmp/golden'
const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true }))
  )
})

/** テスト用の git repo を一時ディレクトリに作り、ローカル設定で user.name/email を与える。 */
async function initTempGitRepo(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'golden-dirty-'))
  temporaryDirectories.push(root)
  await execFileAsync('git', ['-C', root, 'init', '--quiet'])
  await execFileAsync('git', ['-C', root, 'config', 'user.name', 'Test User'])
  await execFileAsync('git', [
    '-C',
    root,
    'config',
    'user.email',
    'test@example.com',
  ])
  return root
}

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

describe('getGitDirty', () => {
  it('全ファイルコミット済みで paths 指定なら false', async () => {
    const root = await initTempGitRepo()
    await writeFile(path.join(root, 'labels.json'), '{}')
    await execFileAsync('git', ['-C', root, 'add', 'labels.json'])
    await execFileAsync('git', ['-C', root, 'commit', '--quiet', '-m', 'init'])

    await expect(getGitDirty(root, ['labels.json'])).resolves.toBe(false)
  })

  it('paths 内の追跡ファイルを変更すると true', async () => {
    const root = await initTempGitRepo()
    await writeFile(path.join(root, 'labels.json'), '{}')
    await execFileAsync('git', ['-C', root, 'add', 'labels.json'])
    await execFileAsync('git', ['-C', root, 'commit', '--quiet', '-m', 'init'])
    await writeFile(path.join(root, 'labels.json'), '{"changed":true}')

    await expect(getGitDirty(root, ['labels.json'])).resolves.toBe(true)
  })

  it('paths 内に未追跡ファイルがあると true', async () => {
    const root = await initTempGitRepo()
    await writeFile(path.join(root, 'labels.json'), '{}')
    await execFileAsync('git', ['-C', root, 'add', 'labels.json'])
    await execFileAsync('git', ['-C', root, 'commit', '--quiet', '-m', 'init'])
    await mkdir(path.join(root, 'pdf'))
    await writeFile(path.join(root, 'pdf', 'dummy-001.pdf'), 'dummy')

    await expect(
      getGitDirty(root, ['labels.json', 'pdf/dummy-001.pdf'])
    ).resolves.toBe(true)
  })

  it('paths 内のファイルが .gitignore 済みでも true', async () => {
    const root = await initTempGitRepo()
    await writeFile(path.join(root, '.gitignore'), 'pdf/\n')
    await writeFile(path.join(root, 'labels.json'), '{}')
    await execFileAsync('git', ['-C', root, 'add', '.gitignore', 'labels.json'])
    await execFileAsync('git', ['-C', root, 'commit', '--quiet', '-m', 'init'])
    await mkdir(path.join(root, 'pdf'))
    await writeFile(path.join(root, 'pdf', 'dummy-001.pdf'), 'dummy')

    await expect(
      getGitDirty(root, ['labels.json', 'pdf/dummy-001.pdf'])
    ).resolves.toBe(true)
  })

  it('paths 外に未追跡ファイルがあるだけなら false', async () => {
    const root = await initTempGitRepo()
    await writeFile(path.join(root, 'labels.json'), '{}')
    await execFileAsync('git', ['-C', root, 'add', 'labels.json'])
    await execFileAsync('git', ['-C', root, 'commit', '--quiet', '-m', 'init'])
    await mkdir(path.join(root, 'results'))
    await writeFile(path.join(root, 'results', 'x.json'), '{}')

    await expect(getGitDirty(root, ['labels.json'])).resolves.toBe(false)
  })

  it('paths 未指定で未追跡ファイルがあれば true', async () => {
    const root = await initTempGitRepo()
    await writeFile(path.join(root, 'labels.json'), '{}')
    await execFileAsync('git', ['-C', root, 'add', 'labels.json'])
    await execFileAsync('git', ['-C', root, 'commit', '--quiet', '-m', 'init'])
    await mkdir(path.join(root, 'results'))
    await writeFile(path.join(root, 'results', 'x.json'), '{}')

    await expect(getGitDirty(root)).resolves.toBe(true)
  })

  it('git repo でないディレクトリは null', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'golden-not-git-'))
    temporaryDirectories.push(root)

    await expect(getGitDirty(root, ['labels.json'])).resolves.toBeNull()
  })
})
