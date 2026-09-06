import { ApiError } from '@google/genai'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { parseArgs } from 'node:util'

import { extractDrawing } from '@/lib/ai/extract-drawing'
import { GEMINI_MODELS } from '@/lib/ai/models'
import { withUploadedFile } from '@/lib/ai/pipeline'
import { getGitHead, loadGoldenSet, resolveGoldenFile } from '@/lib/eval/golden'
import {
  INPUT_STAGES,
  type InputStage,
  type InputStageId,
} from '@/lib/eval/input-stages'
import type { GoldenLabel } from '@/lib/eval/label'
import type { EvalCaseRecord, EvalRunResult } from '@/lib/eval/result'
import { type CaseResult, scoreCase, summarize } from '@/lib/eval/score'

function fail(message: string): never {
  process.stderr.write(`${message}\n`)
  process.exit(1)
}

function parseStageArg(value: string | undefined): InputStageId[] {
  const stage = value ?? 'all'
  if (stage === 'all') return ['A', 'C2p']
  if (stage === 'A' || stage === 'C2p') return [stage]
  fail(
    `--stage は A / C2p / all のいずれかを指定してください（指定値: ${stage}）`
  )
}

/** ISO 8601 UTC を YYYYMMDDTHHmmssZ 形式へ変換する。 */
function toFileTimestamp(iso: string): string {
  return iso.replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')
}

async function runStage(
  stage: InputStage,
  labels: readonly GoldenLabel[],
  options: {
    goldenDir: string
    apiKey: string
    model: string
    appCommit: string | null
    goldenCommit: string | null
  }
): Promise<EvalRunResult> {
  const runAt = new Date().toISOString()
  const cases: EvalCaseRecord[] = []
  const scored: CaseResult[] = []

  // OOM / レート制限回避のため直列で処理する（並列にしない）。
  for (const label of labels) {
    const startedAt = Date.now()
    try {
      const resolved = resolveGoldenFile(options.goldenDir, label.file)
      const buffer = await readFile(resolved)
      const output = await stage.prepare({
        buffer,
        fileName: path.basename(label.file),
      })

      const actual = await withUploadedFile(
        {
          buffer: output.buffer,
          mimeType: output.mimeType,
          ext: 'pdf',
          displayName: output.displayName,
          apiKey: options.apiKey,
        },
        (uploaded) =>
          extractDrawing({
            apiKey: options.apiKey,
            uploaded,
            model: options.model,
          }),
        { remoteCleanup: 'always' }
      )

      const result = scoreCase(label, actual)
      scored.push(result)
      cases.push({
        caseId: label.caseId,
        file: label.file,
        status: 'scored',
        durationMs: Date.now() - startedAt,
        result,
        reference: {
          reasoning: actual.reasoning,
          confidence: actual.confidence,
        },
      })
    } catch (error) {
      // 1件の失敗で run 全体を止めない。ApiError の message は API 応答本文を
      // 含みうるため、固定文言と HTTP status のみ記録する。
      const errorRecord =
        error instanceof ApiError
          ? {
              name: error.name,
              message: 'Gemini API error',
              status: error.status,
            }
          : error instanceof Error
            ? { name: error.name, message: error.message }
            : { name: 'UnknownError', message: String(error) }
      const statusText =
        'status' in errorRecord ? `, status=${errorRecord.status}` : ''
      process.stderr.write(
        `failed: ${label.caseId} (${errorRecord.name}${statusText}) ${errorRecord.message}\n`
      )
      cases.push({
        caseId: label.caseId,
        file: label.file,
        status: 'failed',
        durationMs: Date.now() - startedAt,
        error: errorRecord,
      })
    }
  }

  return {
    schemaVersion: 1,
    runAt,
    stage: { id: stage.id, label: stage.label },
    model: options.model,
    appCommit: options.appCommit,
    goldenCommit: options.goldenCommit,
    cases,
    summary: summarize(scored),
    failedCases: cases.filter((entry) => entry.status === 'failed').length,
  }
}

function printSummary(run: EvalRunResult, outputPath: string): void {
  const { summary } = run
  process.stdout.write(`\n=== stage ${run.stage.id} (${run.stage.label}) ===\n`)
  process.stdout.write(`model: ${run.model}\n`)
  process.stdout.write(
    `cases: ${summary.cases} / allMatchRate: ${(summary.allMatchRate * 100).toFixed(1)}% / failed: ${run.failedCases}\n`
  )
  process.stdout.write('per-field:\n')
  for (const [field, stats] of Object.entries(summary.byField)) {
    const strict =
      stats.strictAccuracy === null
        ? 'n/a'
        : `${(stats.strictAccuracy * 100).toFixed(1)}%`
    process.stdout.write(
      `  ${field.padEnd(16)} match=${stats.match} mismatch=${stats.mismatch} both-empty=${stats.bothEmpty} strictAccuracy=${strict}\n`
    )
  }
  process.stdout.write(`written: ${outputPath}\n`)
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      stage: { type: 'string' },
      model: { type: 'string' },
      case: { type: 'string', multiple: true },
      out: { type: 'string' },
    },
  })

  const goldenDir = process.env.GOLDEN_SET_DIR
  if (!goldenDir) {
    fail(
      'GOLDEN_SET_DIR が設定されていません。golden set のローカル clone パスを指定してください。'
    )
  }

  const apiKey = process.env.GOOGLE_API_KEY
  if (!apiKey) {
    fail(
      'GOOGLE_API_KEY が設定されていません。op run 経由で API キーを注入してください。'
    )
  }

  const stageIds = parseStageArg(values.stage)
  const model = values.model ?? GEMINI_MODELS.extractDrawing
  const caseFilter = values.case ? new Set(values.case) : null

  const outputDir =
    values.out ?? process.env.EVAL_OUTPUT_DIR ?? path.join(goldenDir, 'results')

  const allLabels = await loadGoldenSet(goldenDir)
  const labels = caseFilter
    ? allLabels.filter((label) => caseFilter.has(label.caseId))
    : allLabels

  if (labels.length === 0) {
    fail('対象ケースがありません（--case の指定を確認してください）。')
  }

  const appCommit = await getGitHead(process.cwd())
  const goldenCommit = await getGitHead(goldenDir)

  await mkdir(outputDir, { recursive: true })

  for (const stageId of stageIds) {
    const stage = INPUT_STAGES[stageId]
    const run = await runStage(stage, labels, {
      goldenDir,
      apiKey,
      model,
      appCommit,
      goldenCommit,
    })

    const fileName = `${toFileTimestamp(run.runAt)}-${stageId}.json`
    const outputPath = path.join(outputDir, fileName)
    await writeFile(outputPath, `${JSON.stringify(run, null, 2)}\n`, 'utf8')

    printSummary(run, outputPath)
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error)
  process.stderr.write(`${message}\n`)
  process.exit(1)
})
