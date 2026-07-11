import { GoogleAIFileManager } from '@google/generative-ai/server'
import crypto from 'crypto'
import { fileTypeFromBuffer } from 'file-type'
import { unlink, writeFile } from 'fs/promises'
import os from 'os'
import path from 'path'

import type { UploadedFile } from './types'

export const ALLOWED_UPLOAD_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
  'application/pdf',
])

export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024

export class UploadValidationError extends Error {
  constructor(
    message: 'File too large' | 'Unsupported media type',
    readonly status: 413 | 415
  ) {
    super(message)
    this.name = 'UploadValidationError'
  }
}

export interface UploadValidationOptions {
  skipSizeCheck?: boolean
}

interface ValidatedUploadFile {
  buffer: Buffer
  mimeType: string
  ext: string
}

export async function validateUploadFile(
  file: File,
  options: UploadValidationOptions = {}
): Promise<ValidatedUploadFile> {
  if (!options.skipSizeCheck && file.size > MAX_UPLOAD_BYTES) {
    throw new UploadValidationError('File too large', 413)
  }

  const arrayBuffer = await file.arrayBuffer()
  const buffer = Buffer.from(arrayBuffer)
  const detectedType = await fileTypeFromBuffer(buffer)

  if (!detectedType || !ALLOWED_UPLOAD_MIME_TYPES.has(detectedType.mime)) {
    throw new UploadValidationError('Unsupported media type', 415)
  }

  return {
    buffer,
    mimeType: detectedType.mime,
    ext: detectedType.ext,
  }
}

interface WithUploadedFileOptions {
  deleteUploadedFile?: boolean
  validation?: UploadValidationOptions
}

export async function withUploadedFile<T>(
  file: File,
  apiKey: string,
  handler: (uploadedFile: UploadedFile) => Promise<T>,
  options: WithUploadedFileOptions = {}
): Promise<T> {
  const deleteUploadedFile = options.deleteUploadedFile ?? true
  let tmpFilePath: string | null = null
  let uploadedFileName: string | null = null

  try {
    const validatedFile = await validateUploadFile(file, options.validation)

    tmpFilePath = path.join(
      os.tmpdir(),
      `upload_${crypto.randomUUID()}.${validatedFile.ext}`
    )
    await writeFile(tmpFilePath, validatedFile.buffer)

    const fileManager = new GoogleAIFileManager(apiKey)
    const uploadResult = await fileManager.uploadFile(tmpFilePath, {
      mimeType: validatedFile.mimeType,
      displayName: file.name,
    })

    uploadedFileName = uploadResult.file.name

    return await handler({
      fileUri: uploadResult.file.uri,
      fileName: uploadResult.file.name,
      mimeType: validatedFile.mimeType,
    })
  } finally {
    if (tmpFilePath) {
      try {
        await unlink(tmpFilePath)
      } catch {
        // no-op
      }
    }

    if (deleteUploadedFile && uploadedFileName) {
      try {
        const fileManager = new GoogleAIFileManager(apiKey)
        await fileManager.deleteFile(uploadedFileName)
      } catch {
        // no-op
      }
    }
  }
}
