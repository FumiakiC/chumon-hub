import { Dispatch, SetStateAction, useCallback } from 'react'

import { extractDrawingData } from '@/lib/api/drawing-api'

import type { CroppedFile, OrderItem } from '../../schema'
import type { OrderAction } from './use-order-items'

/**
 * Converts a Base64 string to a Blob
 * Supports both with and without data URI prefix
 */
async function base64ToBlob(base64: string, mimeType: string): Promise<Blob> {
  const base64String = base64.includes(',') ? base64.split(',')[1] : base64
  const response = await fetch(`data:${mimeType};base64,${base64String}`)
  return response.blob()
}

/**
 * Manages drawing analysis logic and progress tracking
 */
export function useDrawingAnalysis(
  croppedFiles: CroppedFile[],
  dispatch: Dispatch<OrderAction>,
  setCroppedFiles: Dispatch<SetStateAction<CroppedFile[]>>
) {
  /**
   * Execute analysis for all cropped files
   * Implements chunked processing (2 files at a time) with rate limiting
   */
  const handleAnalyzeAll = useCallback(async () => {
    const croppedReadyFiles = croppedFiles.filter(
      (f) => f.status === 'cropped' && f.base64
    )
    if (croppedReadyFiles.length === 0) return

    // Create initial order items
    const initialItems: OrderItem[] = croppedReadyFiles.map((file) => ({
      id: file.id,
      fileName: file.fileName,
      status: 'pending',
      progress: 0,
      drawingNo: '',
      partName: '',
      material: '',
      surfaceTreatment: '',
      notes: '',
      quantity: null,
      thumbnailUrl: file.thumbnailUrl,
      needsReview: false,
      confidence: 0,
      previewUrl: file.base64,
    }))
    dispatch({ type: 'ADD_ITEMS', payload: initialItems })

    // Process files in chunks (2 at a time)
    const chunkSize = 2
    for (let i = 0; i < croppedReadyFiles.length; i += chunkSize) {
      const chunk = croppedReadyFiles.slice(i, i + chunkSize)
      await Promise.all(
        chunk.map(async (file) => {
          if (!file.base64) return

          try {
            // Mark as cropping
            dispatch({
              type: 'UPDATE_ITEM',
              payload: {
                id: file.id,
                changes: { status: 'cropping', progress: 25 },
              },
            })

            // Convert Base64 to Blob
            const blob = await base64ToBlob(file.base64, 'application/pdf')
            const fileObject = new File([blob], file.fileName, {
              type: 'application/pdf',
            })

            // Mark as analyzing
            dispatch({
              type: 'UPDATE_ITEM',
              payload: {
                id: file.id,
                changes: { status: 'analyzing', progress: 50 },
              },
            })

            // Extract drawing data
            const result = await extractDrawingData(fileObject)

            // Update item with extracted data
            dispatch({
              type: 'UPDATE_ITEM',
              payload: {
                id: file.id,
                changes: {
                  drawingNo: result.drawingNo || '',
                  partName: result.partName || '',
                  material: result.material || '',
                  quantity: result.quantity ?? null,
                  surfaceTreatment: result.surfaceTreatment || '',
                  notes: result.notes || '',
                  confidence: result.confidence || 0,
                  needsReview: (result.confidence || 0) < 85,
                  status:
                    (result.confidence || 0) < 85
                      ? 'needs_review'
                      : 'completed',
                  progress: 100,
                },
              },
            })
          } catch (error) {
            console.error(`Analysis failed for ${file.fileName}:`, error)
            const errorMessage =
              error instanceof Error
                ? error.message
                : '予期しないエラーが発生しました'
            dispatch({
              type: 'UPDATE_ITEM',
              payload: {
                id: file.id,
                changes: {
                  status: 'error',
                  needsReview: true,
                  notes: errorMessage,
                },
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
  }, [croppedFiles, dispatch])

  return {
    handleAnalyzeAll,
  }
}
