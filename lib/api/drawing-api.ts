/**
 * Drawing API
 * Handles API communication for document processing tasks
 */
import type {
  CropTitleBlockResponse,
  DrawingExtractionResult,
} from '@/lib/ai/contracts'

/**
 * Crops the title block from a PDF file
 * @param file The original File object to crop
 * @returns Promise resolving to the Base64 string of the cropped content
 */
export async function cropTitleBlock(file: File): Promise<string> {
  const formData = new FormData()
  formData.append('file', file)

  const response = await fetch('/api/crop-title-block', {
    method: 'POST',
    body: formData,
  })

  if (!response.ok) {
    throw new Error(`Failed to crop PDF: ${response.status}`)
  }

  const data: CropTitleBlockResponse = await response.json()
  const base64 = data.croppedFiles?.[0]?.base64

  if (!base64) {
    throw new Error('No cropped file data in response')
  }

  return base64
}

/**
 * Extracts drawing data from a PDF file
 * @param croppedFile The cropped File object
 * @returns Promise resolving to the extracted drawing data
 */
export async function extractDrawingData(
  croppedFile: File
): Promise<DrawingExtractionResult> {
  const formData = new FormData()
  formData.append('file', croppedFile)

  const response = await fetch('/api/extract-drawing', {
    method: 'POST',
    body: formData,
  })

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}))
    const errorMessage =
      errorData?.error || errorData?.message || `API Error (${response.status})`
    throw new Error(errorMessage)
  }

  return await response.json()
}
