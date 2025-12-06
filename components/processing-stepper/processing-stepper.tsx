import { Upload, ShieldCheck, Brain, CheckCircle2, X } from "lucide-react"
import type { LogEntry } from "@/types/logEntry"
import { StepItem } from "./step-item"
import { ProgressBar } from "./progress-bar"

type ProcessingStatus = "idle" | "uploading" | "flash_check" | "pro_extraction" | "complete" | "error"

interface ProcessingStepperProps {
  status: ProcessingStatus
  logs: LogEntry[]
}

export function ProcessingStepper({ status, logs }: ProcessingStepperProps) {
  // Flash判定エラーかどうかを判定
  const isFlashCheckError = status === "error" && logs.some((l) => l.message.includes("判定結果: ❌"))

  // 各ステップのアクティブ/完了状態を計算
  const isUploadActive = status !== "idle"
  const isUploadCurrent = status === "uploading"

  const isFlashCheckCompleted = ["flash_check", "pro_extraction", "complete"].includes(status)
  const isFlashCheckCurrent = status === "flash_check"

  const isProExtractionCompleted = ["pro_extraction", "complete"].includes(status)
  const isProExtractionCurrent = status === "pro_extraction"

  const isComplete = status === "complete"

  return (
    <div className="mt-8 flex justify-between px-4">
      {/* Step 1: Upload */}
      <StepItem
        icon={Upload}
        label="Upload"
        isActive={isUploadActive}
        isCompleted={isUploadActive}
        isCurrentStep={isUploadCurrent}
      />

      {/* Progress Bar 1 */}
      <ProgressBar isActive={isFlashCheckCompleted} />

      {/* Step 2: Flash判定 */}
      <StepItem
        icon={isFlashCheckError ? X : ShieldCheck}
        label="Flash判定"
        isActive={isFlashCheckCompleted}
        isCompleted={isFlashCheckCompleted}
        isError={isFlashCheckError}
        isCurrentStep={isFlashCheckCurrent}
      />

      {/* Progress Bar 2 */}
      <ProgressBar isActive={isProExtractionCompleted} />

      {/* Step 3: Flash抽出 */}
      <StepItem
        icon={Brain}
        label="Flash抽出"
        isActive={isProExtractionCompleted}
        isCompleted={isProExtractionCompleted}
        isCurrentStep={isProExtractionCurrent}
      />

      {/* Progress Bar 3 */}
      <ProgressBar isActive={isComplete} variant="complete" />

      {/* Step 4: 完了 */}
      <StepItem
        icon={CheckCircle2}
        label="完了"
        isActive={isComplete}
        isCompleted={isComplete}
        isCurrentStep={isComplete}
        completedColorClass="blue"
      />
    </div>
  )
}
