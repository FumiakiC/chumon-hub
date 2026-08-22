import { GoogleGenAI } from '@google/genai'
import crypto from 'crypto'
import { fileTypeFromBuffer } from 'file-type'
import { unlink, writeFile } from 'fs/promises'
import os from 'os'
import path from 'path'

import type { UploadedFile } from '@/lib/ai/pipeline/types'
import { logger } from '@/lib/logger'

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

/**
 * Google File API 上のリモートファイルを削除するタイミング。
 * - 'always': 成否によらず削除する（同一リクエスト内で使い切る場合）
 * - 'on-error': 失敗した場合のみ削除する（成功時は後続へ寿命を手渡す場合）
 * - 'never': ここでは削除しない（呼び出し側が寿命の責任を持つ）
 */
export type RemoteCleanupPolicy = 'always' | 'on-error' | 'never'

export interface WithUploadedFileOptions {
  /**
   * リモート（Google File API）のファイルを削除するタイミング。
   * - extract-drawing: 'always'（同一リクエスト内で使い切る）
   * - check-document-type: 'on-error'（成功時は暗号トークンで後続 extract-order へ
   *   寿命を手渡すため削除してはいけない。失敗時は手渡しが起きないので削除する）
   */
  remoteCleanup: RemoteCleanupPolicy
}

/**
 * エラーから HTTP ステータスだけを取り出す（`as any` を使わない）。
 * `@google/genai` の `ApiError` は `status: number` を持つが、`message` は API の
 * エラー応答本文そのもの（JSON 文字列）であり、リソース名などを含みうる。
 */
function getHttpStatus(error: unknown): number | undefined {
  if (typeof error === 'object' && error !== null && 'status' in error) {
    const { status } = error
    if (typeof status === 'number') return status
  }
  return undefined
}

/**
 * Google File API 上のファイルを削除する。冪等（既に存在しない場合も throw しない）。
 *
 * 削除失敗で呼び出し元のリクエストを失敗させないが、握り潰すと「検知できない orphan」
 * になるため warn を残す。ログに出すのは固定文言＋HTTPステータス＋エラー種別名のみで、
 * 例外オブジェクトはそのまま渡さない（SDK の例外メッセージは API のエラー応答本文を
 * そのまま含み、リモートファイル名などが混入しうるため）。
 */
export async function deleteRemoteFile(
  apiKey: string,
  name: string
): Promise<void> {
  try {
    const ai = new GoogleGenAI({ apiKey })
    await ai.files.delete({ name })
  } catch (error) {
    const status = getHttpStatus(error)
    const kind = error instanceof Error ? error.name : typeof error
    logger.warn(
      `Failed to delete remote file (orphan may remain). kind=${kind} status=${status ?? 'n/a'}`
    )
  }
}

/**
 * tmp 書き込み → Google File API アップロード → tmp 即時削除 → handler 実行
 * を集約する。tmp は必ず finally で後始末（冪等）。リモートファイルの寿命は
 * options.remoteCleanup で制御する。
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
  /** try 内で throw されたか（＝このリクエストが失敗したか）。 */
  let failed = false

  try {
    tmpFilePath = path.join(os.tmpdir(), `upload_${crypto.randomUUID()}.${ext}`)
    await writeFile(tmpFilePath, buffer)

    const ai = new GoogleGenAI({ apiKey })
    const uploadResult = await ai.files.upload({
      file: tmpFilePath,
      config: {
        mimeType,
        displayName,
      },
    })

    if (!uploadResult.name || !uploadResult.uri) {
      throw new Error('File API upload did not return name/uri')
    }

    remoteName = uploadResult.name

    // ローカル tmp はアップロード完了後すぐに削除（現状挙動を踏襲）。
    await unlink(tmpFilePath)
    tmpFilePath = null

    const uploaded: UploadedFile = {
      fileUri: uploadResult.uri,
      name: uploadResult.name,
      mimeType,
    }

    return await handler(uploaded)
  } catch (error) {
    failed = true
    throw error
  } finally {
    if (tmpFilePath) {
      try {
        await unlink(tmpFilePath)
      } catch {
        // 既に削除済み等は無視（冪等な後始末）。
      }
    }
    if (
      remoteName &&
      (options.remoteCleanup === 'always' ||
        (options.remoteCleanup === 'on-error' && failed))
    ) {
      await deleteRemoteFile(apiKey, remoteName)
    }
  }
}
