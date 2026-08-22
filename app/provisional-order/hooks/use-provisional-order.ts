import React, { useCallback, useRef, useState } from 'react'
import { useForm } from 'react-hook-form'

import { zodResolver } from '@hookform/resolvers/zod'

import type { CropTitleBlockResponse } from '@/lib/ai/contracts'
import { logger } from '@/lib/logger'

import {
  type CroppedFile,
  type OrderHeader,
  type OrderItem,
  type VerificationFormData,
  type VerificationFormInput,
  defaultOrderHeader,
  verificationSchema,
} from '../schema'
import { useDrawingAnalysis } from './sub-hooks/use-drawing-analysis'
import { useOrderItems } from './sub-hooks/use-order-items'

// ---------------------------------------------------------------------------
// Helpers (module-private)
// ---------------------------------------------------------------------------

function generateCroppedFile(fileName: string): CroppedFile {
  return {
    id: crypto.randomUUID(),
    fileName,
    status: 'cropping',
    progress: 0,
    thumbnailUrl: '/placeholder.svg',
  }
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useProvisionalOrder() {
  // --- Sub-hooks ---
  const orderItemsHook = useOrderItems()
  const { orderItems, dispatch, removeFile, updateItemField } = orderItemsHook

  // --- Phase 1 ---
  const [croppedFiles, setCroppedFiles] = useState<CroppedFile[]>([])
  const [isDragActive, setIsDragActive] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // --- Phase 2 ---
  const [selectedItem, setSelectedItem] = useState<OrderItem | null>(null)
  const [isSheetOpen, setIsSheetOpen] = useState(false)
  const [previewFile, setPreviewFile] = useState<CroppedFile | null>(null)
  const [isPreviewOpen, setIsPreviewOpen] = useState(false)

  // Analysis hook
  const { handleAnalyzeAll, isAnalyzing } = useDrawingAnalysis(
    croppedFiles,
    dispatch,
    setCroppedFiles
  )

  // --- Phase 3 ---
  const [orderHeader, setOrderHeader] =
    useState<OrderHeader>(defaultOrderHeader)

  // --- Verification form ---
  const verificationForm = useForm<
    VerificationFormInput,
    unknown,
    VerificationFormData
  >({
    resolver: zodResolver(verificationSchema),
    defaultValues: {
      drawingNo: '',
      partName: '',
      material: '',
      quantity: '',
      surfaceTreatment: '',
      notes: '',
    },
  })

  // ---------------------------------------------------------------------------
  // Phase 1: Crop
  // ---------------------------------------------------------------------------

  const processCrop = useCallback(async (fileId: string, file: File) => {
    const progressInterval = setInterval(() => {
      setCroppedFiles((prev) =>
        prev.map((f) => {
          if (f.id === fileId && f.status === 'cropping' && f.progress < 90) {
            return { ...f, progress: Math.min(f.progress + 15, 90) }
          }
          return f
        })
      )
    }, 150)

    try {
      const formData = new FormData()
      formData.append('file', file)

      const response = await fetch('/api/crop-title-block', {
        method: 'POST',
        body: formData,
      })

      clearInterval(progressInterval)

      if (!response.ok) throw new Error('Failed to crop PDF')

      const data: CropTitleBlockResponse = await response.json()
      const croppedFile = data.croppedFiles?.[0]

      if (croppedFile && croppedFile.base64) {
        setCroppedFiles((prev) =>
          prev.map((f) =>
            f.id === fileId
              ? {
                  ...f,
                  progress: 100,
                  status: 'cropped',
                  base64: croppedFile.base64,
                }
              : f
          )
        )
      } else {
        throw new Error('Invalid response')
      }
    } catch (error) {
      clearInterval(progressInterval)
      logger.error('Crop error:', error)
      setCroppedFiles((prev) =>
        prev.map((f) =>
          f.id === fileId ? { ...f, progress: 100, status: 'cropped' } : f
        )
      )
    }
  }, [])

  const handleFiles = useCallback(
    (files: FileList | null) => {
      if (!files) return
      const newFiles: Array<{ croppedFile: CroppedFile; originalFile: File }> =
        []
      for (let i = 0; i < files.length; i++) {
        const file = files[i]
        if (file.type === 'application/pdf' || file.name.endsWith('.pdf')) {
          newFiles.push({
            croppedFile: generateCroppedFile(file.name),
            originalFile: file,
          })
        }
      }
      setCroppedFiles((prev) => [
        ...prev,
        ...newFiles.map((f) => f.croppedFile),
      ])
      newFiles.forEach(({ croppedFile, originalFile }) => {
        setTimeout(
          () => processCrop(croppedFile.id, originalFile),
          Math.random() * 300
        )
      })
    },
    [processCrop]
  )

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragActive(true)
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragActive(false)
  }, [])

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
      setIsDragActive(false)
      handleFiles(e.dataTransfer.files)
    },
    [handleFiles]
  )

  const handleFileInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      handleFiles(e.target.files)
    },
    [handleFiles]
  )

  const handleDeleteCroppedFile = useCallback((fileId: string) => {
    setCroppedFiles((prev) => prev.filter((f) => f.id !== fileId))
  }, [])

  const handlePreviewFile = useCallback((file: CroppedFile) => {
    setPreviewFile(file)
    setIsPreviewOpen(true)
  }, [])

  // ---------------------------------------------------------------------------
  // Phase 2: Verify & Update
  // ---------------------------------------------------------------------------

  const handleVerify = useCallback(
    (item: OrderItem) => {
      setSelectedItem(item)
      verificationForm.reset({
        drawingNo: item.drawingNo,
        partName: item.partName,
        material: item.material,
        quantity: item.quantity ?? '',
        surfaceTreatment: item.surfaceTreatment,
        notes: item.notes,
      })
      setIsSheetOpen(true)
    },
    [verificationForm]
  )

  const handleDelete = useCallback(
    (itemId: string) => {
      removeFile(itemId)
    },
    [removeFile]
  )

  const handleVerificationSubmit = useCallback(
    (data: VerificationFormData) => {
      if (!selectedItem) return
      dispatch({
        type: 'UPDATE_ITEM',
        payload: {
          id: selectedItem.id,
          changes: {
            ...data,
            quantity: data.quantity === '' ? null : data.quantity,
            status: 'completed',
            needsReview: false,
            confidence: 100,
          },
        },
      })
      setIsSheetOpen(false)
      setSelectedItem(null)
    },
    [dispatch, selectedItem]
  )

  // ---------------------------------------------------------------------------
  // Phase 3
  // ---------------------------------------------------------------------------

  const updateOrderHeader = useCallback(
    (field: keyof OrderHeader, value: string) => {
      setOrderHeader((prev) => ({ ...prev, [field]: value }))
    },
    []
  )

  const handleCopyJSON = useCallback(async () => {
    const items = orderItems.map((item) => ({
      productName: item.partName,
      description: `${item.drawingNo} / ${item.material}`,
      quantity: item.quantity,
      unitPrice: 0,
      amount: 0,
    }))
    try {
      await navigator.clipboard.writeText(
        JSON.stringify({ ...orderHeader, items }, null, 2)
      )
    } catch (e) {
      logger.error(e)
    }
  }, [orderItems, orderHeader])

  // ---------------------------------------------------------------------------
  // Derived values
  // ---------------------------------------------------------------------------

  const croppingCount = croppedFiles.filter(
    (f) => f.status === 'cropping'
  ).length
  const croppedCount = croppedFiles.filter((f) => f.status === 'cropped').length
  const completedCount = orderItems.filter(
    (i) => i.status === 'completed'
  ).length
  const reviewCount = orderItems.filter(
    (i) => i.status === 'needs_review'
  ).length
  const processingCount = orderItems.filter(
    (i) =>
      i.status === 'pending' ||
      i.status === 'cropping' ||
      i.status === 'analyzing'
  ).length

  return {
    // Phase 1
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
    isAnalyzing,
    // Phase 2
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
    // Phase 3
    orderHeader,
    updateOrderHeader,
    handleCopyJSON,
  }
}
