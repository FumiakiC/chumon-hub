import type { InputStageId } from '@/lib/eval/input-stages'
import type { CaseResult, EvalSummary } from '@/lib/eval/score'

export type EvalCaseRecord =
  | {
      caseId: string
      /** GOLDEN_SET_DIR からの相対パス。 */
      file: string
      status: 'scored'
      durationMs: number
      result: CaseResult
      /** 評価対象外だが参考値として記録（label.ts のコメント参照） */
      reference: { reasoning: string; confidence: number }
    }
  | {
      caseId: string
      /** GOLDEN_SET_DIR からの相対パス。 */
      file: string
      status: 'failed'
      durationMs: number
      error: { name: string; message: string; status?: number }
    }

export interface EvalRunResult {
  schemaVersion: 2
  runAt: string
  stage: { id: InputStageId; label: string }
  model: string
  appCommit: string | null
  /** `null` は git repo でない等で判定不能。app リポジトリの作業ツリー全体を対象に判定する。 */
  appDirty: boolean | null
  goldenCommit: string | null
  /** `null` は git repo でない等で判定不能。`labels.json` と評価対象ケースの `file` に限定して判定する。 */
  goldenDirty: boolean | null
  cases: EvalCaseRecord[]
  summary: EvalSummary
  failedCases: number
}
