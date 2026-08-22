/**
 * Drawing API
 * Handles API communication for document processing tasks
 */
import type {
  CropTitleBlockResponse,
  DrawingExtractionResult,
} from '@/lib/ai/contracts'
import { AppError, type AppErrorCode, isAppErrorCode } from '@/lib/errors'

/**
 * 本文に `code` を持たない応答のための、HTTP ステータス由来の既定コード。
 * crop-title-block は validationErrorResponse を通らない経路（素の 400 / 500）が
 * あるため、その受け皿になる。
 */
function fallbackCodeForStatus(status: number): AppErrorCode {
  switch (status) {
    case 400:
      return 'ERR_VALIDATION'
    case 413:
      return 'ERR_FILE_TOO_LARGE'
    case 415:
      return 'ERR_UNSUPPORTED_MEDIA'
    default:
      return 'ERR_REQUEST_FAILED'
  }
}

/**
 * HTTP エラー応答をコード付きの AppError に変換する。
 * 応答本文の `code` を最優先し、無ければステータス由来の既定コードを使う。
 * message はログ用途であり、画面表示は呼び出し側が resolveError(code) で組み立てる。
 */
async function toAppError(response: Response): Promise<AppError> {
  let code = fallbackCodeForStatus(response.status)
  let message: string | undefined
  try {
    const data = await response.json()
    if (isAppErrorCode(data?.code)) code = data.code
    if (typeof data?.error === 'string') message = data.error
  } catch {
    // 本文が JSON でない場合はステータス由来の fallback をそのまま使う
  }
  return new AppError(code, message ?? `${code} (HTTP ${response.status})`)
}

/**
 * Crops the title block from a PDF file
 * @param file The original File object to crop
 * @returns Promise resolving to the Base64 string of the cropped content
 * @throws {AppError} 失敗時。`code` により呼び出し側で日本語UXへ写像できる
 */
export async function cropTitleBlock(file: File): Promise<string> {
  const formData = new FormData()
  formData.append('file', file)

  const response = await fetch('/api/crop-title-block', {
    method: 'POST',
    body: formData,
  })

  if (!response.ok) {
    throw await toAppError(response)
  }

  const data: CropTitleBlockResponse = await response.json()
  const base64 = data.croppedFiles?.[0]?.base64

  if (!base64) {
    throw new AppError('ERR_INVALID_RESULT', 'No cropped file data in response')
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
