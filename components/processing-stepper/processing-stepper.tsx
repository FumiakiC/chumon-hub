import { Upload, ShieldCheck, Brain, CheckCircle2, X } from "lucide-react"
import type { LogEntry } from "@/types/logEntry"
import { StepItem } from "./step-item"
import { ProgressBar } from "./progress-bar"
import type { LucideIcon } from "lucide-react"

export type ProcessingStatus = "idle" | "uploading" | "flash_check" | "pro_extraction" | "complete" | "error" | "cancelled"

const STEP_ORDER: ProcessingStatus[] = ["uploading", "flash_check", "pro_extraction", "complete"]

interface StepConfig {
  id: ProcessingStatus
  icon: LucideIcon
  label: string
  completedColorClass?: "blue"
  progressVariant?: "complete"
}

const STEP_CONFIGS: StepConfig[] = [
  { id: "uploading", icon: Upload, label: "Upload" },
  { id: "flash_check", icon: ShieldCheck, label: "Flash判定" },
  { id: "pro_extraction", icon: Brain, label: "Flash抽出" },
  { id: "complete", icon: CheckCircle2, label: "完了", completedColorClass: "blue", progressVariant: "complete" },
]

function getStepIndex(status: ProcessingStatus): number {
  if (status === "idle") return 0 // idle時は最初のステップを準備完了状態として表示
  if (status === "error" || status === "cancelled") return -1 // エラー時・キャンセル時は別途ハンドリング
  return STEP_ORDER.indexOf(status)
}

function getStepState(stepId: ProcessingStatus, currentStatus: ProcessingStatus) {
  const stepIndex = STEP_ORDER.indexOf(stepId)
  const currentIndex = getStepIndex(currentStatus)

  return {
    isCompleted: currentIndex >= stepIndex,
    isCurrentStep: currentStatus === stepId,
    isActive: currentIndex >= stepIndex,
  }
}

interface ProcessingStepperProps {
  status: ProcessingStatus
  logs: LogEntry[]
}

export function ProcessingStepper({ status, logs }: ProcessingStepperProps) {
  // Flash判定エラーかどうかを判定
  const isFlashCheckError = status === "error" && logs.some((l) => l.message.includes("判定結果: ❌"))

  // エラー時は flash_check のインデックスまで進んだとみなす
  const effectiveStatus = isFlashCheckError ? "flash_check" : status

  return (
    <div className="mt-8 flex justify-between px-4">
      {STEP_CONFIGS.map((step, index) => {
        const state = getStepState(step.id, effectiveStatus)
        const isFlashCheckStep = step.id === "flash_check"

        // Flash判定ステップでエラーの場合はXアイコンに差し替え
        const icon = isFlashCheckStep && isFlashCheckError ? X : step.icon

        return (
          <div key={step.id} className="contents">
            <StepItem
              icon={icon}
              label={step.label}
              isActive={state.isActive}
              isCompleted={state.isCompleted}
              isError={isFlashCheckStep && isFlashCheckError}
              isCurrentStep={state.isCurrentStep}
              completedColorClass={step.completedColorClass}
            />

            {/* 最後のステップ以外にはプログレスバーを表示 */}
            {index < STEP_CONFIGS.length - 1 && (
              <ProgressBar
                isActive={getStepState(STEP_CONFIGS[index + 1].id, effectiveStatus).isActive}
                variant={STEP_CONFIGS[index + 1].progressVariant}
              />
            )}
          </div>
        )
      })}
    </div>
  )
}
