'use client'

import { Copy, FileText } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Header } from '@/components/ui/header'

import { AnalysisTable } from './components/AnalysisTable'
import { UploadPanel } from './components/UploadPanel'
import { VerificationSheet } from './components/VerificationSheet'
import { useProvisionalOrder } from './hooks/use-provisional-order'

export default function ProvisionalOrderPage() {
  const {
    croppedFiles,
    isDragActive,
    fileInputRef,
    croppingCount,
    croppedCount,
    handleDragOver,
    handleDragLeave,
    handleDrop,
    handleFileInput,
    handleDeleteCroppedFile,
    handlePreviewFile,
    handleAnalyzeAll,
    orderItems,
    selectedItem,
    isSheetOpen,
    setIsSheetOpen,
    previewFile,
    isPreviewOpen,
    setIsPreviewOpen,
    completedCount,
    reviewCount,
    processingCount,
    handleVerify,
    handleDelete,
    handleVerificationSubmit,
    updateItemField,
    verificationForm,
    handleCopyJSON,
  } = useProvisionalOrder()

  return (
    <div className="flex min-h-screen flex-col bg-gradient-to-br from-slate-50 via-white to-blue-50/20 dark:from-slate-950 dark:via-slate-900 dark:to-slate-950">
      <Header
        transparent={false}
        showBackButton
        title={
          <div className="flex items-center gap-2">
            <FileText className="h-4 w-4 text-blue-600 dark:text-blue-400" />
            <span className="text-sm font-bold text-slate-700 dark:text-slate-300">
              仮注文書作成
            </span>
          </div>
        }
      />

      <div className="flex-1 p-4 md:p-8">
        <div className="mx-auto max-w-[1600px] space-y-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h1 className="text-2xl font-bold tracking-tight">
                図面一括解析
              </h1>
              <p className="text-muted-foreground text-sm">
                PDF図面の表題欄を自動クロップして解析します
              </p>
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                className="gap-2"
                onClick={handleCopyJSON}
                disabled={orderItems.length === 0}
              >
                <Copy className="size-4" /> JSONコピー
              </Button>
            </div>
          </div>

          <div className="flex flex-col gap-6 lg:flex-row">
            <UploadPanel
              croppedFiles={croppedFiles}
              isDragActive={isDragActive}
              croppingCount={croppingCount}
              croppedCount={croppedCount}
              fileInputRef={fileInputRef}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onFileInput={handleFileInput}
              onDeleteFile={handleDeleteCroppedFile}
              onPreviewFile={handlePreviewFile}
              onAnalyzeAll={handleAnalyzeAll}
            />

            <AnalysisTable
              orderItems={orderItems}
              completedCount={completedCount}
              reviewCount={reviewCount}
              processingCount={processingCount}
              onUpdateItemField={updateItemField}
              onVerify={handleVerify}
              onDelete={handleDelete}
            />
          </div>
        </div>
      </div>

      <VerificationSheet
        isPreviewOpen={isPreviewOpen}
        onPreviewOpenChange={setIsPreviewOpen}
        previewFile={previewFile}
        isSheetOpen={isSheetOpen}
        onSheetOpenChange={setIsSheetOpen}
        selectedItem={selectedItem}
        verificationForm={verificationForm as any}
        onVerificationSubmit={handleVerificationSubmit}
      />
    </div>
  )
}
