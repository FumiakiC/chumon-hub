import { execFile } from 'node:child_process'
import { readFile, realpath } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'

import { type GoldenSet, goldenSetSchema } from '@/lib/eval/label'

const execFileAsync = promisify(execFile)

/**
 * 正規化済みの `child` が `parent` の内側（parent 自身は除く）に収まるか。
 * `path.relative` の結果が空・`..`・`..<sep>` 始まり・絶対パスなら外側とみなす。
 */
function isWithin(parent: string, child: string): boolean {
  const relative = path.relative(parent, child)
  return (
    relative !== '' &&
    relative !== '..' &&
    !relative.startsWith('..' + path.sep) &&
    !path.isAbsolute(relative)
  )
}

/**
 * golden set 内の相対パスを絶対パスへ解決する（同期・fs 非依存）。
 *
 * `label.ts` のスキーマ検証（絶対パス・`..` 拒否）に加え、解決後のパスが
 * `goldenDir` の内側に収まることを確認する多層防御。`path.relative` の結果が
 * `..` で始まる／絶対パスになる場合は外側と判定して throw する。
 * symlink 経由の脱出は `assertRealPathWithin`（fs 依存）で別途防ぐ。
 */
export function resolveGoldenFile(
  goldenDir: string,
  relativeFile: string
): string {
  if (path.isAbsolute(relativeFile)) {
    throw new Error(
      `golden file must be relative to GOLDEN_SET_DIR: ${relativeFile}`
    )
  }

  const resolvedDir = path.resolve(goldenDir)
  const resolved = path.resolve(resolvedDir, relativeFile)
  const relative = path.relative(resolvedDir, resolved)

  if (
    relative === '' ||
    relative === '..' ||
    relative.startsWith('..' + path.sep) ||
    path.isAbsolute(relative)
  ) {
    throw new Error(`golden file escapes GOLDEN_SET_DIR: ${relativeFile}`)
  }

  return resolved
}

/**
 * `filePath` を `fs.realpath` で正規化し、`goldenDir` の realpath 配下に
 * 収まっていることを確認する。symlink 経由の脱出を防ぐ最終防御。
 * 内側なら正規化後の絶対パスを返し、外側なら throw する。
 */
export async function assertRealPathWithin(
  goldenDir: string,
  filePath: string
): Promise<string> {
  const realDir = await realpath(goldenDir)
  const realFile = await realpath(filePath)

  if (!isWithin(realDir, realFile)) {
    throw new Error(`golden file escapes GOLDEN_SET_DIR: ${filePath}`)
  }

  return realFile
}

/**
 * golden set の入力パスと、repo 内 symlink が指す実体パスを dirty 判定用に集める。
 * realpath の解決に失敗した入力や goldenDir の外を指す入力は元パスだけを残す。
 */
export async function collectGoldenDirtyPaths(
  goldenDir: string,
  files: readonly string[]
): Promise<string[]> {
  const paths = new Set(files)

  let realDir: string
  try {
    realDir = await realpath(goldenDir)
  } catch {
    return [...paths]
  }

  for (const file of files) {
    try {
      const realFile = await realpath(path.resolve(goldenDir, file))
      if (isWithin(realDir, realFile)) {
        paths.add(path.relative(realDir, realFile))
      }
    } catch {
      // 欠損ファイル等は元の pathspec だけで判定を続ける。
    }
  }

  return [...paths]
}

/**
 * `<goldenDir>/labels.json` を読み、`goldenSetSchema` で検証して返す。
 * 読めない／不正な場合は fs / zod の例外をそのまま投げる。
 */
export async function loadGoldenSet(goldenDir: string): Promise<GoldenSet> {
  const labelsPath = path.join(goldenDir, 'labels.json')
  const raw = await readFile(labelsPath, 'utf8')
  return goldenSetSchema.parse(JSON.parse(raw))
}

/**
 * `dir` の git HEAD（40桁のコミットハッシュ）を返す。
 * git repo でない・git が無い等の失敗時は throw せず `null` を返す。
 * shell を経由しないよう `execFile` を使う。
 */
export async function getGitHead(dir: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('git', [
      '-C',
      dir,
      'rev-parse',
      'HEAD',
    ])
    const head = stdout.trim()
    return /^[0-9a-f]{40}$/i.test(head) ? head : null
  } catch {
    return null
  }
}

/**
 * `dir` の作業ツリーに未コミット変更があるかを返す。
 * `paths` を指定するとその範囲に限定し、gitignore 済みでも `--ignored` で dirty 扱いにする
 * （golden の入力ファイルが誤って ignore されたまま編集される事故を検出するため）。
 * `paths` が空なら作業ツリー全体を対象にし `--ignored` は付けない。
 * git repo でない・git が無い等の失敗時は throw せず `null` を返す。
 * shell を経由しないよう `execFile` を使い、pathspec マジックの誤解釈を避けるため
 * `--literal-pathspecs` を付ける。
 */
export async function getGitDirty(
  dir: string,
  paths: readonly string[] = []
): Promise<boolean | null> {
  try {
    const { stdout } = await execFileAsync('git', [
      '--literal-pathspecs',
      '-C',
      dir,
      'status',
      '--porcelain',
      ...(paths.length > 0 ? ['--ignored'] : []),
      '--',
      ...paths,
    ])
    return stdout.trim() !== ''
  } catch {
    return null
  }
}
