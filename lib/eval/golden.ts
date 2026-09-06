import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'

import { type GoldenSet, goldenSetSchema } from '@/lib/eval/label'

const execFileAsync = promisify(execFile)

/**
 * golden set 内の相対パスを絶対パスへ解決する。
 *
 * `label.ts` のスキーマ検証（絶対パス・`..` 拒否）に加え、解決後のパスが
 * `goldenDir` の内側に収まることを確認する多層防御。`path.relative` の結果が
 * `..` で始まる／絶対パスになる場合は外側と判定して throw する。
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
    relative.startsWith('..') ||
    path.isAbsolute(relative)
  ) {
    throw new Error(`golden file escapes GOLDEN_SET_DIR: ${relativeFile}`)
  }

  return resolved
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
