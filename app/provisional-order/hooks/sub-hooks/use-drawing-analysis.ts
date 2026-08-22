import { Dispatch, SetStateAction, useCallback, useRef, useState } from 'react'

import { extractDrawingData } from '@/lib/api/drawing-api'
import { logger } from '@/lib/logger'

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
  // Authoritative re-entrancy gate. The `isAnalyzing` state drives the disabled
  // button, but state updates are asynchronous, so the ref is what actually
  // prevents a second run from starting.
  const isRunningRef = useRef(false)
  const [isAnalyzing, setIsAnalyzing] = useState(false)

  /**
   * Execute analysis for all cropped files
   * Implements chunked processing (2 files at a time) with rate limiting
   */
  const handleAnalyzeAll = useCallback(async () => {
    if (isRunningRef.current) return

    const croppedReadyFiles = croppedFiles.filter(
      (f) => f.status === 'cropped' && f.base64
    )
    if (croppedReadyFiles.length === 0) return

    isRunningRef.current = true
    setIsAnalyzing(true)

    try {
      // An order item's id is the identity of the *row*, independent of the
      // input file. Reusing CroppedFile.id made duplicated rows share an id, so
      // UPDATE_ITEM / REMOVE_ITEM matched every duplicate at once.
      const targets = croppedReadyFiles.map((file) => ({
        file,
        itemId: crypto.randomUUID(),
      }))

      // Consume the source files before the first await: once a row exists for
      // them, they must never be picked up by another run.
      const consumedIds = new Set(croppedReadyFiles.map((f) => f.id))
      setCroppedFiles((prev) =>
        prev.map((f) =>
          consumedIds.has(f.id) ? { ...f, status: 'completed' as const } : f
        )
      )

      // Create initial order items
      const initialItems: OrderItem[] = targets.map(({ file, itemId }) => ({
        id: itemId,
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
      for (let i = 0; i < targets.length; i += chunkSize) {
        const chunk = targets.slice(i, i + chunkSize)
        await Promise.all(
          chunk.map(async ({ file, itemId }) => {
            if (!file.base64) return

            try {
              // Mark as cropping
              dispatch({
                type: 'UPDATE_ITEM',
                payload: {
                  id: itemId,
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
                  id: itemId,
                  changes: { status: 'analyzing', progress: 50 },
                },
              })

              // Extract drawing data
              const result = await extractDrawingData(fileObject)

              // Update item with extracted data
              dispatch({
                type: 'UPDATE_ITEM',
                payload: {
                  id: itemId,
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
              logger.error('Analysis failed for cropped file:', error)
              const errorMessage =
                error instanceof Error
                  ? error.message
                  : '予期しないエラーが発生しました'
              dispatch({
                type: 'UPDATE_ITEM',
                payload: {
                  id: itemId,
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
        if (i + chunkSize < targets.length) {
          await new Promise((resolve) => setTimeout(resolve, 2000))
        }
      }
    } finally {
      isRunningRef.current = false
      setIsAnalyzing(false)
    }
  }, [croppedFiles, dispatch, setCroppedFiles])

  return {
    handleAnalyzeAll,
    isAnalyzing,
  }
}
