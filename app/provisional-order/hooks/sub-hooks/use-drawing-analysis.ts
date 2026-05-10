import { useState, useCallback, Dispatch, SetStateAction } from "react"
import { extractDrawingData } from "@/lib/api/drawing-api"
import type { CroppedFile, OrderItem } from "../../schema"
import type { OrderAction } from "./use-order-items"

// Helper function
function base64ToBlob(base64: string, mimeType: string): Blob {
  const byteCharacters = atob(base64.split(",")[1])
  const byteNumbers = new Array(byteCharacters.length)
  for (let i = 0; i < byteCharacters.length; i++) {
    byteNumbers[i] = byteCharacters.charCodeAt(i)
  }
  return new Blob([new Uint8Array(byteNumbers)], { type: mimeType })
}

/**
 * Manages drawing analysis logic and progress tracking
 */
export function useDrawingAnalysis(
  croppedFiles: CroppedFile[],
  dispatch: Dispatch<OrderAction>,
  orderItems: OrderItem[],
  setCroppedFiles: Dispatch<SetStateAction<CroppedFile[]>>
) {
  const [isAnalyzing, setIsAnalyzing] = useState(false)

  /**
   * Execute analysis for all cropped files
   * Implements chunked processing (2 files at a time) with rate limiting
   */
  const handleAnalyzeAll = useCallback(async () => {
    const croppedReadyFiles = croppedFiles.filter((f) => f.status === "cropped" && f.base64)
    if (croppedReadyFiles.length === 0) return

    setIsAnalyzing(true)

    // Mark cropped files as completed
    setCroppedFiles((prev) =>
      prev.map((file) =>
        file.status === "cropped" ? { ...file, status: "completed" } : file
      )
    )

    // Create initial order items
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
      quantity: null,
      thumbnailUrl: file.thumbnailUrl,
      needsReview: false,
      confidence: 0,
      previewUrl: file.base64,
    }))
    dispatch({ type: "ADD_ITEMS", payload: initialItems })

    // Process files in chunks (2 at a time)
    const chunkSize = 2
    for (let i = 0; i < croppedReadyFiles.length; i += chunkSize) {
      const chunk = croppedReadyFiles.slice(i, i + chunkSize)
      await Promise.all(
        chunk.map(async (file) => {
          if (!file.base64) return

          try {
            const blob = base64ToBlob(file.base64, "application/pdf")
            const fileObject = new File([blob], file.fileName, { type: "application/pdf" })

            // Update progress to "processing"
            dispatch({
              type: "UPDATE_ITEM",
              payload: { id: file.id, changes: { status: "processing", progress: 50 } },
            })

            // Extract drawing data
            const result = await extractDrawingData(fileObject)

            // Update item with extracted data
            dispatch({
              type: "UPDATE_ITEM",
              payload: {
                id: file.id,
                changes: {
                  drawingNo: result.drawingNo || "",
                  partName: result.partName || "",
                  material: result.material || "",
                  quantity: result.quantity ?? null,
                  surfaceTreatment: result.surfaceTreatment || "",
                  notes: result.notes || "",
                  confidence: result.confidence || 0,
                  needsReview: (result.confidence || 0) < 85,
                  status: (result.confidence || 0) < 85 ? "review" : "completed",
                  progress: 100,
                },
              },
            })
          } catch (error) {
            console.error(`Analysis failed for ${file.fileName}:`, error)
            dispatch({
              type: "UPDATE_ITEM",
              payload: {
                id: file.id,
                changes: { status: "review", needsReview: true, notes: "解析エラー発生" },
              },
            })
          }
        })
      )

      // Rate limiting: wait 2 seconds before processing next chunk
      if (i + chunkSize < croppedReadyFiles.length) {
        await new Promise((resolve) => setTimeout(resolve, 2000))
      }
    }

    setIsAnalyzing(false)
  }, [croppedFiles, dispatch, setCroppedFiles])

  /**
   * Calculate analysis progress
   */
  const totalProgress = (() => {
    if (orderItems.length === 0) return 0
    const totalProgress = orderItems.reduce((sum, item) => sum + item.progress, 0)
    return Math.round(totalProgress / orderItems.length)
  })()

  return {
    isAnalyzing,
    handleAnalyzeAll,
    totalProgress,
  }
}
