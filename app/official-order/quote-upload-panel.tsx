"use client"

import { useRef, type ChangeEvent, type DragEvent } from "react"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { FileText, FileImage, Upload, X } from "lucide-react"
import { ProcessingStepper } from "@/components/processing-stepper/processing-stepper"
import type { LogEntry } from "@/types/logEntry"

const processingStatuses = ["idle", "uploading", "flash_check", "pro_extraction", "complete", "error"] as const

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

  const handleUploadClick = () => {
    fileInputRef.current?.click()
  }

  return (
    <div className="space-y-6">
      <Card className="elevation-2 border-0 bg-white p-6 dark:bg-slate-900">
        <div className="mb-6 flex items-center gap-3">
          <FileText className="h-6 w-6 text-slate-600 dark:text-slate-400" />
          <h2 className="text-xl font-bold text-slate-800 dark:text-slate-100">見積書アップロード</h2>
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
            <div className="flex items-center gap-3 rounded-lg border border-blue-100 bg-blue-50 p-4 text-blue-700 dark:border-blue-900/50 dark:bg-blue-900/20 dark:text-blue-300">
              <FileText className="h-5 w-5" />
              <span className="flex-1 font-medium truncate">{selectedFile.name}</span>
              <Button
                onClick={handleRemoveFile}
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-blue-700 hover:bg-blue-200/50 dark:text-blue-300 dark:hover:bg-blue-800/50"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>

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

        {(logs.length > 0 || processingStatus !== "idle") && (
          <div className="mt-6 overflow-hidden rounded-xl bg-slate-950 p-6 font-mono text-sm text-slate-300 shadow-inner">
            <div className="flex flex-col gap-2">
              {logs.map((log, index) => (
                <div key={index} className="flex gap-3">
                  <span className="shrink-0 text-slate-500">[{log.timestamp}]</span>
                  <span
                    className={
                      log.type === "success"
                        ? "text-emerald-400"
                        : log.type === "error"
                          ? "text-red-400"
                          : "text-slate-200"
                    }
                  >
                    {log.message}
                  </span>
                </div>
              ))}
              {isLoading && (
                <div className="mt-2 flex items-center gap-2 text-blue-400 animate-pulse">
                  <span className="h-2 w-2 rounded-full bg-blue-400" />
                  <span>Processing...</span>
                </div>
              )}
            </div>
          </div>
        )}

        {(logs.length > 0 || processingStatus !== "idle") && (
          <ProcessingStepper status={processingStatus} logs={logs} />
        )}
      </Card>

      {previewUrl && selectedFile && (
        <Card className="elevation-2 overflow-hidden border-0 bg-white p-4 dark:bg-slate-900">
          <div className="mb-4 flex items-center gap-2">
            <FileImage className="h-5 w-5 text-slate-500" />
            <h3 className="font-semibold text-slate-700 dark:text-slate-200">プレビュー</h3>
          </div>
          <div className="overflow-hidden rounded-lg border border-slate-200 bg-slate-100 dark:border-slate-800 dark:bg-slate-950">
            {selectedFile.type === "application/pdf" ? (
              <iframe src={previewUrl} className="h-[800px] w-full" title="PDF Preview" />
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
