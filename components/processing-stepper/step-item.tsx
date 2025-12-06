import type { LucideIcon } from "lucide-react"

interface StepItemProps {
  icon: LucideIcon
  label: string
  isActive: boolean
  isCompleted: boolean
  isError?: boolean
  isCurrentStep?: boolean
  completedColorClass?: string // カスタム完了時の色クラス (例: "blue" for complete step)
}

export function StepItem({
  icon: Icon,
  label,
  isActive,
  isCompleted,
  isError = false,
  isCurrentStep = false,
  completedColorClass = "emerald",
}: StepItemProps) {
  // スタイル決定ロジック
  const getContainerClasses = () => {
    if (isError) {
      return "border-red-500 bg-red-50 text-red-600 scale-110 shadow-red-200 animate-shake"
    }
    if (isCompleted || isActive) {
      if (completedColorClass === "blue") {
        return "border-blue-500 bg-blue-50 text-blue-600 scale-125 shadow-blue-200"
      }
      return "border-emerald-500 bg-emerald-50 text-emerald-600 scale-110 shadow-emerald-200"
    }
    return "border-slate-200 bg-white text-slate-300"
  }

  const getLabelClasses = () => {
    if (isError) {
      return "text-red-600"
    }
    if (isCompleted || isActive) {
      if (completedColorClass === "blue") {
        return "text-blue-600"
      }
      return "text-slate-800"
    }
    return "text-slate-400"
  }

  const getIconClasses = () => {
    if (isError) {
      return "animate-pulse"
    }
    if (isCurrentStep) {
      return "animate-pulse scale-110"
    }
    return ""
  }

  const getPingClasses = () => {
    if (completedColorClass === "blue") {
      return "bg-blue-200 opacity-20"
    }
    return "bg-emerald-200 opacity-30"
  }

  return (
    <div className="flex flex-col items-center gap-2">
      <div
        className={`relative flex h-14 w-14 items-center justify-center rounded-full border-2 transition-all duration-500 shadow-lg ${getContainerClasses()}`}
      >
        {/* Ping animation for current step */}
        {isCurrentStep && !isError && (
          <div className={`absolute inset-0 animate-ping rounded-full ${getPingClasses()}`} />
        )}
        <Icon className={`h-7 w-7 transition-all duration-500 ${getIconClasses()}`} />
      </div>
      <span className={`text-sm font-bold tracking-wide transition-colors duration-300 ${getLabelClasses()}`}>
        {label}
      </span>
    </div>
  )
}
