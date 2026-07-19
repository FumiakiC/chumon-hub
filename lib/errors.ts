/**
 * 型付きエラーとエラーコード（サーバ／クライアント共通の単一の真実源）。
 *
 * - サーバは応答本文に「安全な汎用メッセージ」＋機械可読な `code` のみを返し、
 *   内部詳細（環境変数名・スタック等）は `console.error` に留めてクライアントへ出さない。
 * - クライアントは `code` で分岐して日本語UXを組み立てる（lib/errorUtils.ts）。
 */

/** 機械可読なエラーコード（安定・サーバ↔クライアント共有）。 */
export const APP_ERROR_CODES = [
  'ERR_SYS_CONFIG', // サーバ設定不備（環境変数未設定など）。詳細は絶対に露出しない
  'ERR_VALIDATION', // 入力不正（400）
  'ERR_FILE_TOO_LARGE', // ファイルサイズ超過（413）
  'ERR_UNSUPPORTED_MEDIA', // 非対応MIME（415）
  'ERR_UNAUTHORIZED', // トークン無効・期限切れ（401）
  'ERR_CLASSIFY', // 書類判定の失敗
  'ERR_EXTRACT', // 抽出の失敗
  'ERR_INVALID_RESULT', // 応答の形状が不正
  'ERR_REQUEST_FAILED', // リクエスト失敗（汎用）
  'ERR_UNKNOWN', // 予期せぬ
] as const

export type AppErrorCode = (typeof APP_ERROR_CODES)[number]

/** 任意値が AppErrorCode か（`as any` を使わない型ガード）。 */
export function isAppErrorCode(value: unknown): value is AppErrorCode {
  return (
    typeof value === 'string' &&
    (APP_ERROR_CODES as readonly string[]).includes(value)
  )
}

/**
 * コードを持つ型付きエラーの基底。`message` はサーバ内部ログ用途であり、
 * クライアント応答本文にそのまま載せない。
 */
export class AppError extends Error {
  readonly code: AppErrorCode

  constructor(
    code: AppErrorCode,
    message: string,
    options?: { cause?: unknown }
  ) {
    super(message, options)
    this.name = 'AppError'
    this.code = code
  }
}

/** サーバ設定不備（環境変数未設定など）専用の型付きエラー。 */
export class ConfigError extends AppError {
  constructor(message: string, options?: { cause?: unknown }) {
    super('ERR_SYS_CONFIG', message, options)
    this.name = 'ConfigError'
  }
}

/**
 * unknown から安定コードを取り出す（`as any` を使わない）。
 * AppError インスタンス、または `code` 文字列を持つ素のオブジェクトを認識する。
 */
export function getErrorCode(error: unknown): AppErrorCode | undefined {
  if (error instanceof AppError) return error.code
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const { code } = error as { code: unknown }
    if (isAppErrorCode(code)) return code
  }
  return undefined
}

/** 各コードに対するクライアント安全な汎用メッセージ（内部詳細を含めない）。 */
const CLIENT_SAFE_MESSAGE: Record<AppErrorCode, string> = {
  ERR_SYS_CONFIG: 'System configuration error. Contact administrator.',
  ERR_VALIDATION: 'Invalid request.',
  ERR_FILE_TOO_LARGE: 'File too large.',
  ERR_UNSUPPORTED_MEDIA: 'Unsupported media type.',
  ERR_UNAUTHORIZED: 'Invalid or expired token.',
  ERR_CLASSIFY: 'Failed to classify document.',
  ERR_EXTRACT: 'Failed to extract details.',
  ERR_INVALID_RESULT: 'Invalid result.',
  ERR_REQUEST_FAILED: 'Request failed.',
  ERR_UNKNOWN: 'Unexpected error.',
}

/** 各コードの既定 HTTP ステータス。 */
const STATUS_BY_CODE: Record<AppErrorCode, number> = {
  ERR_SYS_CONFIG: 500,
  ERR_VALIDATION: 400,
  ERR_FILE_TOO_LARGE: 413,
  ERR_UNSUPPORTED_MEDIA: 415,
  ERR_UNAUTHORIZED: 401,
  ERR_CLASSIFY: 500,
  ERR_EXTRACT: 500,
  ERR_INVALID_RESULT: 500,
  ERR_REQUEST_FAILED: 500,
  ERR_UNKNOWN: 500,
}

/**
 * unknown を安全な JSON 応答に変換する（サーバ route の catch 用）。
 * AppError ならそのコードに対応する汎用メッセージ＋ステータスを返す。
 * それ以外は fallback を使う。内部 `message` は本文に載せない。
 */
export function errorResponse(
  error: unknown,
  fallback: { code: AppErrorCode; status: number }
): Response {
  if (error instanceof AppError) {
    return Response.json(
      { error: CLIENT_SAFE_MESSAGE[error.code], code: error.code },
      { status: STATUS_BY_CODE[error.code] }
    )
  }
  return Response.json(
    { error: CLIENT_SAFE_MESSAGE[fallback.code], code: fallback.code },
    { status: fallback.status }
  )
}

/** validateUploadFile の失敗ステータスを、コード付きの安全な応答へ変換する。 */
export function validationErrorResponse(status: 400 | 413 | 415): Response {
  const code: AppErrorCode =
    status === 413
      ? 'ERR_FILE_TOO_LARGE'
      : status === 415
        ? 'ERR_UNSUPPORTED_MEDIA'
        : 'ERR_VALIDATION'
  return Response.json({ error: CLIENT_SAFE_MESSAGE[code], code }, { status })
}
