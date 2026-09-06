import { extractDrawing } from '@/lib/ai/extract-drawing'
import {
  checkRequestBodySize,
  readFormData,
  validateUploadFile,
  withUploadedFile,
} from '@/lib/ai/pipeline'
import {
  ConfigError,
  errorResponse,
  validationErrorResponse,
} from '@/lib/errors'
import { logger } from '@/lib/logger'

export const maxDuration = 60

export async function POST(req: Request) {
  try {
    // proxy のボディバッファ上限による切り詰めを、パース前に明示的な 413 へ落とす。
    const sizeCheck = checkRequestBodySize(req)
    if (!sizeCheck.ok) {
      logger.warn('Request rejected by the early body size guard')
      return validationErrorResponse(sizeCheck.status)
    }

    const parsed = await readFormData(req)
    if (!parsed.ok) {
      return validationErrorResponse(parsed.status)
    }

    const { formData } = parsed
    const file = formData.get('file')

    const validation = await validateUploadFile(file)
    if (!validation.ok) {
      return validationErrorResponse(validation.status)
    }

    const apiKey = process.env.GOOGLE_API_KEY
    if (!apiKey) {
      throw new ConfigError('GOOGLE_API_KEY is not set')
    }

    const responseBody = await withUploadedFile(
      {
        buffer: validation.buffer,
        mimeType: validation.mimeType,
        ext: validation.ext,
        displayName: validation.file.name,
        apiKey,
      },
      (uploaded) => extractDrawing({ apiKey, uploaded }),
      { remoteCleanup: 'always' }
    )

    return Response.json(responseBody)
  } catch (error) {
    logger.error('Extraction error:', error)
    return errorResponse(error, { code: 'ERR_EXTRACT', status: 500 })
  }
}
