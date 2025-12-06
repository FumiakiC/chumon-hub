interface ProgressBarProps {
  isActive: boolean
  variant?: "default" | "complete"
}

export function ProgressBar({ isActive, variant = "default" }: ProgressBarProps) {
  const getBarClasses = () => {
    if (!isActive) {
      return "bg-slate-100"
    }
    if (variant === "complete") {
      return "bg-gradient-to-r from-emerald-400 to-blue-500 shadow-sm"
    }
    return "bg-gradient-to-r from-emerald-400 to-emerald-500 shadow-sm"
  }

  return <div className={`mt-7 h-1 flex-1 mx-4 rounded-full transition-all duration-700 ${getBarClasses()}`} />
}
