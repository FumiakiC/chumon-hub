"use client"

import { UploadCloud, Trash2, Play, CheckCircle2, Crop } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Spinner } from "@/components/ui/spinner"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { cn } from "@/lib/utils"
import type { CroppedFile, CropStatus } from "../schema"

// ---------------------------------------------------------------------------
// Sub-component: status badge
// ---------------------------------------------------------------------------

function CropStatusBadge({ status }: { status: CropStatus }) {
  switch (status) {
    case "cropping":
      return (
        <Badge variant="secondary" className="gap-1">
          <Spinner className="size-3" /> クロップ中
        </Badge>
      )
    case "cropped":
      return (
        <Badge
          variant="secondary"
          className="gap-1 bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400"
        >
          <Crop className="size-3" /> クロップ済
        </Badge>
      )
    case "completed":
      return (
        <Badge
          variant="secondary"
          className="gap-1 bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"
        >
          <CheckCircle2 className="size-3" /> 解析済
        </Badge>
      )
  }
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface UploadPanelProps {
  croppedFiles: CroppedFile[]
  isDragActive: boolean
  croppingCount: number
  croppedCount: number
  fileInputRef: React.RefObject<HTMLInputElement | null>
  onDragOver: (e: React.DragEvent) => void
  onDragLeave: (e: React.DragEvent) => void
  onDrop: (e: React.DragEvent) => void
  onFileInput: (e: React.ChangeEvent<HTMLInputElement>) => void
  onDeleteFile: (fileId: string) => void
  onPreviewFile: (file: CroppedFile) => void
  onAnalyzeAll: () => void
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function UploadPanel({
  croppedFiles,
  isDragActive,
  croppingCount,
  croppedCount,
  fileInputRef,
  onDragOver,
  onDragLeave,
  onDrop,
  onFileInput,
  onDeleteFile,
  onPreviewFile,
  onAnalyzeAll,
}: UploadPanelProps) {
  return (
    <Card className="lg:w-1/3">
      <CardHeader className="bg-muted/50 border-b">
        <div className="flex justify-between items-center">
          <div className="flex items-center gap-2">
            <Badge variant="outline">Phase 1</Badge>
            <CardTitle className="text-lg">アップロード</CardTitle>
          </div>
          {croppedFiles.length > 0 && (
            <div className="flex gap-2">
              {croppingCount > 0 && <Spinner className="size-4" />}
              <span className="text-xs text-muted-foreground">{croppedFiles.length}件</span>
            </div>
          )}
        </div>
      </CardHeader>

      <CardContent className="p-4 space-y-4">
        {/* Drop zone */}
        <div
          className={cn(
            "rounded-lg border-2 border-dashed p-6 text-center transition-colors",
            isDragActive ? "border-primary bg-primary/5" : "hover:bg-muted/50"
          )}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
        >
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            accept=".pdf"
            multiple
            onChange={onFileInput}
          />
          <div className="flex flex-col items-center gap-3">
            <UploadCloud className="size-8 text-muted-foreground" />
            <p className="text-sm">PDFをドラッグ＆ドロップ</p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => fileInputRef.current?.click()}
            >
              ファイル選択
            </Button>
          </div>
        </div>

        {/* File list */}
        {croppedFiles.length > 0 && (
          <div className="rounded-lg border max-h-[400px] overflow-y-auto">
            <Table>
              <TableHeader className="sticky top-0 bg-background z-10">
                <TableRow>
                  <TableHead>ファイル</TableHead>
                  <TableHead className="w-[100px]">状態</TableHead>
                  <TableHead className="w-[50px]"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {croppedFiles.map((file) => (
                  <TableRow key={file.id}>
                    <TableCell className="py-2">
                      <div className="flex flex-col gap-1">
                        <span
                          className="text-xs font-medium truncate max-w-[150px]"
                          title={file.fileName}
                        >
                          {file.fileName}
                        </span>
                        {file.base64 && (
                          <button
                            type="button"
                            className="text-[10px] text-blue-600 cursor-pointer underline text-left"
                            onClick={() => onPreviewFile(file)}
                          >
                            プレビュー確認
                          </button>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="py-2">
                      <CropStatusBadge status={file.status} />
                    </TableCell>
                    <TableCell className="py-2">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-6"
                        onClick={() => onDeleteFile(file.id)}
                      >
                        <Trash2 className="size-3" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        {/* Analyze trigger */}
        {croppedCount > 0 && (
          <Button
            onClick={onAnalyzeAll}
            className="w-full gap-2"
          >
            <Play className="size-4" /> すべて解析 ({croppedCount}件)
          </Button>
        )}
      </CardContent>
    </Card>
  )
}
