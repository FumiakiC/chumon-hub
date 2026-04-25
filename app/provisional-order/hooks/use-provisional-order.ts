import React, { useState, useCallback, useRef } from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import {
  verificationSchema,
  type VerificationFormData,
  type CroppedFile,
  type OrderItem,
  type OrderHeader,
  defaultOrderHeader,
} from "../schema"

// ---------------------------------------------------------------------------
// Helpers (module-private)
// ---------------------------------------------------------------------------

function generateCroppedFile(fileName: string): CroppedFile {
  return {
    id: crypto.randomUUID(),
    fileName,
    status: "cropping",
    progress: 0,
    thumbnailUrl: "/placeholder.svg",
  }
}

function base64ToBlob(base64: string, mimeType: string): Blob {
  const byteCharacters = atob(base64.split(",")[1])
  const byteNumbers = new Array(byteCharacters.length)
  for (let i = 0; i < byteCharacters.length; i++) {
    byteNumbers[i] = byteCharacters.charCodeAt(i)
  }
  return new Blob([new Uint8Array(byteNumbers)], { type: mimeType })
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useProvisionalOrder() {
  // --- Phase 1 ---
  const [croppedFiles, setCroppedFiles] = useState<CroppedFile[]>([])
  const [isDragActive, setIsDragActive] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // --- Phase 2 ---
  const [orderItems, setOrderItems] = useState<OrderItem[]>([])
  const [selectedItem, setSelectedItem] = useState<OrderItem | null>(null)
  const [isSheetOpen, setIsSheetOpen] = useState(false)
  const [previewFile, setPreviewFile] = useState<CroppedFile | null>(null)
  const [isPreviewOpen, setIsPreviewOpen] = useState(false)

  // --- Phase 3 ---
  const [orderHeader, setOrderHeader] = useState<OrderHeader>(defaultOrderHeader)

  // --- Verification form ---
  const verificationForm = useForm<VerificationFormData>({
    resolver: zodResolver(verificationSchema),
    defaultValues: {
      drawingNo: "",
      partName: "",
      material: "",
      quantity: 1,
      surfaceTreatment: "",
      notes: "",
    },
  })

  // ---------------------------------------------------------------------------
  // Phase 1: Crop
  // ---------------------------------------------------------------------------

  const processCrop = useCallback(async (fileId: string, file: File) => {
    const progressInterval = setInterval(() => {
      setCroppedFiles((prev) =>
        prev.map((f) => {
          if (f.id === fileId && f.status === "cropping" && f.progress < 90) {
            return { ...f, progress: Math.min(f.progress + 15, 90) }
          }
          return f
        })
      )
    }, 150)

    try {
      const formData = new FormData()
      formData.append("file", file)

      const response = await fetch("/api/crop-title-block", {
        method: "POST",
        body: formData,
      })

      clearInterval(progressInterval)

      if (!response.ok) throw new Error("Failed to crop PDF")

      const data = await response.json()
      const croppedFile = data.croppedFiles?.[0]

      if (croppedFile && croppedFile.base64) {
        setCroppedFiles((prev) =>
          prev.map((f) =>
            f.id === fileId
              ? { ...f, progress: 100, status: "cropped", base64: croppedFile.base64 }
              : f
          )
        )
      } else {
        throw new Error("Invalid response")
      }
    } catch (error) {
      clearInterval(progressInterval)
      console.error("Crop error:", error)
      setCroppedFiles((prev) =>
        prev.map((f) =>
          f.id === fileId ? { ...f, progress: 100, status: "cropped" } : f
        )
      )
    }
  }, [])

  const handleFiles = useCallback(
    (files: FileList | null) => {
      if (!files) return
      const newFiles: Array<{ croppedFile: CroppedFile; originalFile: File }> = []
      for (let i = 0; i < files.length; i++) {
        const file = files[i]
        if (file.type === "application/pdf" || file.name.endsWith(".pdf")) {
          newFiles.push({ croppedFile: generateCroppedFile(file.name), originalFile: file })
        }
      }
      setCroppedFiles((prev) => [...prev, ...newFiles.map((f) => f.croppedFile)])
      newFiles.forEach(({ croppedFile, originalFile }) => {
        setTimeout(() => processCrop(croppedFile.id, originalFile), Math.random() * 300)
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
  // Phase 2: Analyze
  // ---------------------------------------------------------------------------

  const handleAnalyzeAll = useCallback(async () => {
    const croppedReadyFiles = croppedFiles.filter((f) => f.status === "cropped" && f.base64)
    if (croppedReadyFiles.length === 0) return

    setCroppedFiles((prev) =>
      prev.map((file) =>
        file.status === "cropped" ? { ...file, status: "completed" } : file
      )
    )

    const initialItems: OrderItem[] = croppedReadyFiles.map((file) => ({
      id: file.id,
      fileName: file.fileName,
      status: "uploading",
      progress: 0,
      drawingNo: "",
      partName: "",
      material: "",
      surfaceTreatment: "",
      notes: "",
      quantity: 1,
      thumbnailUrl: file.thumbnailUrl,
      needsReview: false,
      confidence: 0,
      previewUrl: file.base64,
    }))
    setOrderItems((prev) => [...prev, ...initialItems])

    await Promise.all(
      croppedReadyFiles.map(async (file) => {
        if (!file.base64) return

        try {
          const blob = base64ToBlob(file.base64, "application/pdf")
          const formData = new FormData()
          formData.append("file", blob, file.fileName)

          setOrderItems((prev) =>
            prev.map((item) =>
              item.id === file.id ? { ...item, status: "processing", progress: 50 } : item
            )
          )

          const response = await fetch("/api/extract-drawing", {
            method: "POST",
            body: formData,
          })
          if (!response.ok) throw new Error("API Error")

          const result = await response.json()
          setOrderItems((prev) =>
            prev.map((item) => {
              if (item.id !== file.id) return item
              return {
                ...item,
                drawingNo: result.drawingNo || "",
                partName: result.partName || "",
                material: result.material || "",
                quantity: result.quantity || 1,
                surfaceTreatment: result.surfaceTreatment || "",
                notes: result.notes || "",
                confidence: result.confidence || 0,
                needsReview: (result.confidence || 0) < 85,
                status: (result.confidence || 0) < 85 ? "review" : "completed",
                progress: 100,
              }
            })
          )
        } catch (error) {
          console.error(`Analysis failed for ${file.fileName}:`, error)
          setOrderItems((prev) =>
            prev.map((item) =>
              item.id === file.id
                ? { ...item, status: "review", needsReview: true, notes: "解析エラー発生" }
                : item
            )
          )
        }
      })
    )
  }, [croppedFiles])

  const handleVerify = useCallback(
    (item: OrderItem) => {
      setSelectedItem(item)
      verificationForm.reset({
        drawingNo: item.drawingNo,
        partName: item.partName,
        material: item.material,
        quantity: item.quantity,
        surfaceTreatment: item.surfaceTreatment,
        notes: item.notes,
      })
      setIsSheetOpen(true)
    },
    [verificationForm]
  )

  const handleDelete = useCallback((itemId: string) => {
    setOrderItems((prev) => prev.filter((item) => item.id !== itemId))
  }, [])

  const handleVerificationSubmit = useCallback(
    (data: VerificationFormData) => {
      if (!selectedItem) return
      setOrderItems((prev) =>
        prev.map((item) =>
          item.id === selectedItem.id
            ? { ...item, ...data, status: "completed", needsReview: false, confidence: 100 }
            : item
        )
      )
      setIsSheetOpen(false)
      setSelectedItem(null)
    },
    [selectedItem]
  )

  const updateItemField = useCallback(
    (itemId: string, field: keyof OrderItem, value: string | number) => {
      setOrderItems((prev) =>
        prev.map((item) => (item.id === itemId ? { ...item, [field]: value } : item))
      )
    },
    []
  )

  // ---------------------------------------------------------------------------
  // Phase 3
  // ---------------------------------------------------------------------------

  const updateOrderHeader = useCallback((field: keyof OrderHeader, value: string) => {
    setOrderHeader((prev) => ({ ...prev, [field]: value }))
  }, [])

  const handleCopyJSON = useCallback(async () => {
    const items = orderItems.map((item) => ({
      productName: item.partName,
      description: `${item.drawingNo} / ${item.material}`,
      quantity: item.quantity,
      unitPrice: 0,
      amount: 0,
    }))
    try {
      await navigator.clipboard.writeText(JSON.stringify({ ...orderHeader, items }, null, 2))
    } catch (e) {
      console.error(e)
    }
  }, [orderItems, orderHeader])

  // ---------------------------------------------------------------------------
  // Derived values
  // ---------------------------------------------------------------------------

  const croppingCount = croppedFiles.filter((f) => f.status === "cropping").length
  const croppedCount = croppedFiles.filter((f) => f.status === "cropped").length
  const completedCount = orderItems.filter((i) => i.status === "completed").length
  const reviewCount = orderItems.filter((i) => i.status === "review").length
  const processingCount = orderItems.filter(
    (i) => i.status === "uploading" || i.status === "processing"
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
