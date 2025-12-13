"use client"

import { useRef, useState, useEffect, type ChangeEvent, type DragEvent } from "react"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { FileText, FileImage, Upload, X, ChevronDown, ChevronUp, Terminal } from "lucide-react"
import { ProcessingStepper } from "@/components/processing-stepper/processing-stepper"
import type { LogEntry } from "@/types/logEntry"
import { cn } from "@/lib/utils"

const processingStatuses = [
  "idle",
  "uploading",
  "flash_check",
  "pro_extraction",
  "complete",
  "error",
  "cancelled",
] as const

type ProcessingStatus = (typeof processingStatuses)[number]

type QuoteUploadPanelProps = {
  selectedFile: File | null
  previewUrl: string | null
  isLoading: boolean
  processingStatus: ProcessingStatus
  logs: LogEntry[]
  handleFileChange: (e: ChangeEvent<HTMLInputElement>) => void
  handleDragOver: (event: DragEvent<HTMLDivElement>) => void
  handleDrop: (event: DragEvent<HTMLDivElement>) => void
  handleRemoveFile: () => void
  onStartTranscription: () => void
}

export function QuoteUploadPanel({
  selectedFile,
  previewUrl,
  isLoading,
  processingStatus,
  logs,
  handleFileChange,
  handleDragOver,
  handleDrop,
  handleRemoveFile,
  onStartTranscription,
}: QuoteUploadPanelProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const logContainerRef = useRef<HTMLDivElement>(null)
  const [isLogOpen, setIsLogOpen] = useState(false)

  const handleUploadClick = () => {
    fileInputRef.current?.click()
  }

  const lastLog = logs.length > 0 ? logs[logs.length - 1] : null

  useEffect(() => {
    if (logContainerRef.current && isLogOpen) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight
    }
  }, [logs, isLogOpen])

  return (
    <div className="space-y-6">
      <Card className="elevation-2 border-0 bg-white p-6 dark:bg-slate-900">
        <div className="mb-6 flex items-center gap-3">
          <FileText className="h-6 w-6 text-slate-600 dark:text-slate-400" />
          <h2 className="text-xl font-bold text-slate-800 dark:text-slate-100">見積書アップロード</h2>
        </div>

        <div className="mb-6">
          <ProcessingStepper status={processingStatus} logs={logs} />
        </div>

        {!selectedFile ? (
          <div
            onDragOver={handleDragOver}
            onDrop={handleDrop}
            onClick={handleUploadClick}
            className="group relative flex min-h-[240px] cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-slate-200 bg-slate-50/50 transition-all duration-300 hover:border-blue-400 hover:bg-blue-50/30 dark:border-slate-700 dark:bg-slate-800/50"
          >
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*,.pdf"
              onChange={handleFileChange}
              className="hidden"
              id="file-upload"
            />
            <div className="mb-4 rounded-full bg-blue-100 p-4 text-blue-500 transition-transform duration-300 group-hover:-translate-y-1 group-hover:scale-110 dark:bg-blue-900/30 dark:text-blue-400">
              <Upload className="h-10 w-10" />
            </div>
            <p className="text-lg font-semibold text-slate-700 dark:text-slate-200">
              クリックまたはドラッグ&ドロップでファイルを選択
            </p>
            <p className="mt-2 text-sm text-slate-400 dark:text-slate-500">見積書をアップロードして解析を開始します</p>
          </div>
        ) : (
          <div className="space-y-4">
            <Card className="overflow-hidden border border-slate-200 dark:border-slate-700">
              <div className="flex items-center gap-4 p-4">
                {/* Dynamic thumbnail/icon */}
                <div className="shrink-0">
                  {selectedFile.type.includes("image") && previewUrl ? (
                    <div className="h-16 w-16 overflow-hidden rounded-lg border border-slate-200 dark:border-slate-700">
                      <img
                        src={previewUrl || "/placeholder.svg"}
                        alt="ファイルプレビュー"
                        className="h-full w-full object-cover"
                      />
                    </div>
                  ) : (
                    <div className="flex h-16 w-16 items-center justify-center rounded-lg bg-slate-100 dark:bg-slate-800">
                      <FileText className="h-8 w-8 text-slate-500 dark:text-slate-400" />
                    </div>
                  )}
                </div>

                {/* File info */}
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-slate-800 dark:text-slate-200">{selectedFile.name}</p>
                  <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                    {(selectedFile.size / 1024).toFixed(1)} KB
                  </p>
                </div>

                {/* Remove button */}
                <Button
                  onClick={handleRemoveFile}
                  variant="ghost"
                  size="icon"
                  className="shrink-0 h-9 w-9 text-slate-500 hover:bg-slate-100 hover:text-red-600 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-red-400"
                >
                  <X className="h-5 w-5" />
                </Button>
              </div>
            </Card>

            {processingStatus === "idle" && (
              <Button
                onClick={onStartTranscription}
                className="w-full bg-blue-600 text-white hover:bg-blue-700 dark:bg-blue-600 dark:hover:bg-blue-500"
              >
                読み取り開始
              </Button>
            )}
          </div>
        )}

        <div className="mt-6 rounded-xl bg-slate-50 border border-slate-100 dark:bg-slate-950 dark:border-slate-800 overflow-hidden">
          <div
            className={cn(
              "flex items-center justify-between p-4 cursor-pointer transition-colors",
              processingStatus === "error"
                ? "bg-red-50 hover:bg-red-100/70 dark:bg-red-900/20 dark:hover:bg-red-900/30"
                : "hover:bg-slate-100/50 dark:hover:bg-slate-900/50",
            )}
            onClick={() => setIsLogOpen(!isLogOpen)}
          >
            <div className="flex items-center gap-3 overflow-hidden">
              {isLoading ? (
                <div className="flex items-center gap-2 text-blue-600 dark:text-blue-400 animate-pulse shrink-0 whitespace-nowrap">
                  <span className="h-2 w-2 rounded-full bg-current" />
                  <span className="text-sm font-medium">処理中...</span>
                </div>
              ) : processingStatus === "complete" ? (
                <span className="text-sm font-medium text-emerald-600 dark:text-emerald-400 shrink-0 whitespace-nowrap">
                  完了しました
                </span>
              ) : processingStatus === "error" ? (
                <span className="text-sm font-medium text-red-600 dark:text-red-400 shrink-0 whitespace-nowrap">
                  エラーが発生しました
                </span>
              ) : processingStatus === "cancelled" ? (
                <span className="text-sm font-medium text-blue-600 dark:text-blue-400 shrink-0 whitespace-nowrap">
                  キャンセルされました
                </span>
              ) : processingStatus === "idle" ? (
                <span className="text-sm font-medium text-slate-500 dark:text-slate-500 shrink-0 whitespace-nowrap">
                  準備完了
                </span>
              ) : (
                <span className="text-sm font-medium text-slate-600 dark:text-slate-400 shrink-0 whitespace-nowrap">
                  待機中
                </span>
              )}

                {lastLog && !isLogOpen && (
                  <span className="text-sm text-slate-500 truncate border-l border-slate-200 pl-3 ml-1 dark:border-slate-700 min-w-0">
                    {lastLog.message}
                  </span>
                )}
              </div>
              <Button variant="ghost" size="sm" className="h-6 w-6 p-0 text-slate-400">
                {isLogOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              </Button>
            </div>

          <div
            className={cn(
              "overflow-hidden transition-all duration-300 ease-in-out bg-slate-950",
              isLogOpen ? "max-h-[300px] border-t border-slate-200 dark:border-slate-800" : "max-h-0",
            )}
          >
            <div
              ref={logContainerRef}
              className="p-4 font-mono text-xs text-slate-300 space-y-1.5 h-full max-h-[284px] overflow-y-auto custom-scrollbar"
            >
              <div className="flex items-center gap-2 text-slate-500 mb-2 pb-2 border-b border-slate-800">
                <Terminal className="h-3 w-3" />
                <span>Processing Logs</span>
              </div>
              {logs.length > 0 ? (
                logs.map((log, index) => (
                  <div key={index} className="flex gap-3 animate-in fade-in slide-in-from-left-2 duration-300">
                    <span className="shrink-0 text-slate-600">[{log.timestamp}]</span>
                    <span
                      className={
                        log.type === "success"
                          ? "text-emerald-400"
                          : log.type === "error"
                            ? "text-red-400"
                            : "text-slate-300"
                      }
                    >
                      {log.message}
                    </span>
                  </div>
                ))
              ) : (
                <div className="text-slate-500 italic pl-1">
                  待機中...
                </div>
              )}
            </div>
          </div>
        </div>
      </Card>

      {previewUrl && selectedFile && (
        <Card className="elevation-2 overflow-hidden border-0 bg-white p-4 dark:bg-slate-900">
          <div className="mb-4 flex items-center gap-2">
            <FileImage className="h-5 w-5 text-slate-500" />
            <h3 className="font-semibold text-slate-700 dark:text-slate-200">プレビュー</h3>
          </div>
          <div className="overflow-hidden rounded-lg border border-slate-200 bg-slate-100 dark:border-slate-800 dark:bg-slate-950">
            {selectedFile.type === "application/pdf" ? (
              <iframe src={previewUrl} className="h-[1024px] w-full" title="PDF Preview" />
            ) : (
              <img
                src={previewUrl || "/placeholder.svg"}
                alt="アップロードされた見積書"
                className="h-auto w-full object-contain"
              />
            )}
          </div>
        </Card>
      )}
    </div>
  )
}
