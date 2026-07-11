import { GoogleAIFileManager } from '@google/generative-ai/server'
import crypto from 'crypto'
import { fileTypeFromBuffer } from 'file-type'
import { unlink, writeFile } from 'fs/promises'
import os from 'os'
import path from 'path'

import type { UploadedFile } from '@/lib/ai/pipeline/types'

/** アップロード受け口で許可する MIME（マジックバイト検証で使用）。 */
export const ALLOWED_UPLOAD_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
  'application/pdf',
])

/** 単一ファイルの上限サイズ（25MB）。 */
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024

/**
 * validateUploadFile の結果。成功時は検証済みバッファと「検出した」メタを返す。
 * 失敗時は HTTP ステータスとメッセージを持ち、呼び出し側の route が応答を組み立てる
 * （helper は HTTP を投げない＝throw しない。型付きエラーの本格導入は PR-08）。
 */
export type UploadValidation =
  | {
      ok: true
      /** instanceof File を満たすと確定したファイル本体（displayName 取得用）。 */
      file: File
      buffer: Buffer
      /** マジックバイトで検出した MIME。 */
      mimeType: string
      /** マジックバイトで検出した拡張子（ドットなし。例: 'pdf'）。 */
      ext: string
    }
  | {
      ok: false
      status: 400 | 413 | 415
      error: string
    }

/**
 * FormData 由来のファイルを検証する。
 * - instanceof File であること（400）
 * - サイズ上限（413）
 * - マジックバイト（file-type）で実体 MIME を判定し、許可 MIME のみ通す（415）
 *
 * 返す mimeType / ext は「検出値」であり、クライアント申告値は使わない。
 */
export async function validateUploadFile(
  file: unknown
): Promise<UploadValidation> {
  if (!(file instanceof File)) {
    return { ok: false, status: 400, error: 'file is required' }
  }

  if (file.size > MAX_UPLOAD_BYTES) {
    return { ok: false, status: 413, error: 'File too large' }
  }

  const buffer = Buffer.from(await file.arrayBuffer())

  const detected = await fileTypeFromBuffer(buffer)
  if (!detected || !ALLOWED_UPLOAD_MIME_TYPES.has(detected.mime)) {
    return { ok: false, status: 415, error: 'Unsupported media type' }
  }

  return { ok: true, file, buffer, mimeType: detected.mime, ext: detected.ext }
}

/** withUploadedFile に渡す、検証済みの入力。 */
export interface UploadParams {
  buffer: Buffer
  /** アップロード時に使う MIME（validateUploadFile の検出値を渡す）。 */
  mimeType: string
  /** tmp ファイル名に使う拡張子（ドットなし）。 */
  ext: string
  /** Google File API の displayName（元ファイル名）。 */
  displayName: string
  apiKey: string
}

export interface WithUploadedFileOptions {
  /**
   * handler 完了後（および handler が throw した場合も finally で）リモートの
   * Google File API 上のファイルを削除するか。
   * - extract-drawing: true（同一リクエスト内で使い切る）
   * - check-document-type: false（暗号トークンで後続 extract-order へ寿命を手渡す）
   */
  deleteRemoteAfter: boolean
}

/**
 * tmp 書き込み → Google File API アップロード → tmp 即時削除 → handler 実行
 * を集約する。tmp は必ず finally で後始末（冪等）。リモートファイルの寿命は
 * options.deleteRemoteAfter で制御する。
 *
 * handler は upload 済みの `UploadedFile` を受け取り、任意の結果 T を返す
 * （classify / extract ステージ相当）。
 */
export async function withUploadedFile<T>(
  params: UploadParams,
  handler: (uploaded: UploadedFile) => Promise<T>,
  options: WithUploadedFileOptions
): Promise<T> {
  const { buffer, mimeType, ext, displayName, apiKey } = params

  let tmpFilePath: string | null = null
  let remoteName: string | null = null

  try {
    tmpFilePath = path.join(os.tmpdir(), `upload_${crypto.randomUUID()}.${ext}`)
    await writeFile(tmpFilePath, buffer)

    const fileManager = new GoogleAIFileManager(apiKey)
    const uploadResult = await fileManager.uploadFile(tmpFilePath, {
      mimeType,
      displayName,
    })

    // ローカル tmp はアップロード完了後すぐに削除（現状挙動を踏襲）。
    await unlink(tmpFilePath)
    tmpFilePath = null

    const uploaded: UploadedFile = {
      fileUri: uploadResult.file.uri,
      name: uploadResult.file.name,
      mimeType,
    }
    remoteName = uploaded.name

    return await handler(uploaded)
  } finally {
    if (tmpFilePath) {
      try {
        await unlink(tmpFilePath)
      } catch {
        // 既に削除済み等は無視（冪等な後始末）。
      }
    }
    if (options.deleteRemoteAfter && remoteName) {
      try {
        const fileManager = new GoogleAIFileManager(apiKey)
        await fileManager.deleteFile(remoteName)
      } catch {
        // リモート cleanup 失敗はリクエスト自体を失敗させない。
      }
    }
  }
}
