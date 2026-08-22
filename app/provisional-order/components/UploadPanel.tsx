'use client'

import {
  AlertCircle,
  CheckCircle2,
  Crop,
  Play,
  Trash2,
  UploadCloud,
} from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Spinner } from '@/components/ui/spinner'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

import { cn } from '@/lib/utils'

import type { CropStatus, CroppedFile } from '../schema'

// ---------------------------------------------------------------------------
// Sub-component: status badge
// ---------------------------------------------------------------------------

function CropStatusBadge({ status }: { status: CropStatus }) {
  switch (status) {
    case 'cropping':
      return (
        <Badge variant="secondary" className="gap-1">
          <Spinner className="size-3" /> クロップ中
        </Badge>
      )
    case 'cropped':
      return (
        <Badge
          variant="secondary"
          className="gap-1 bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400"
        >
          <Crop className="size-3" /> クロップ済
        </Badge>
      )
    case 'error':
      return (
        <Badge
          variant="secondary"
          className="gap-1 bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
        >
          <AlertCircle className="size-3" /> 失敗
        </Badge>
      )
    case 'completed':
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
  isAnalyzing: boolean
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
  isAnalyzing,
}: UploadPanelProps) {
  return (
    <Card className="lg:w-1/3">
      <CardHeader className="bg-muted/50 border-b">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Badge variant="outline">Phase 1</Badge>
            <CardTitle className="text-lg">アップロード</CardTitle>
          </div>
          {croppedFiles.length > 0 && (
            <div className="flex gap-2">
              {croppingCount > 0 && <Spinner className="size-4" />}
              <span className="text-muted-foreground text-xs">
                {croppedFiles.length}件
              </span>
            </div>
          )}
        </div>
      </CardHeader>

      <CardContent className="space-y-4 p-4">
        {/* Drop zone */}
        <div
          className={cn(
            'rounded-lg border-2 border-dashed p-6 text-center transition-colors',
            isDragActive ? 'border-primary bg-primary/5' : 'hover:bg-muted/50'
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
            <UploadCloud className="text-muted-foreground size-8" />
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
          <div className="max-h-[400px] overflow-y-auto rounded-lg border">
            <Table>
              <TableHeader className="bg-background sticky top-0 z-10">
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
                          className="max-w-[150px] truncate text-xs font-medium"
                          title={file.fileName}
                        >
                          {file.fileName}
                        </span>
                        {file.base64 && (
                          <button
                            type="button"
                            className="cursor-pointer text-left text-[10px] text-blue-600 underline"
                            onClick={() => onPreviewFile(file)}
                          >
                            プレビュー確認
                          </button>
                        )}
                        {file.status === 'error' && file.errorMessage && (
                          <span
                            className="max-w-[150px] text-[10px] text-red-600 dark:text-red-400"
                            title={
                              file.errorAction
                                ? `${file.errorMessage} ${file.errorAction}`
                                : file.errorMessage
                            }
                          >
                            {file.errorMessage}
                          </span>
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
        {(croppedCount > 0 || isAnalyzing) && (
          <Button
            onClick={onAnalyzeAll}
            disabled={isAnalyzing || croppedCount === 0}
            className="w-full gap-2"
          >
            {isAnalyzing ? (
              <>
                <Spinner className="size-4" /> 解析中...
              </>
            ) : (
              <>
                <Play className="size-4" /> すべて解析 ({croppedCount}件)
              </>
            )}
          </Button>
        )}
      </CardContent>
    </Card>
  )
}
