export const ERROR_MESSAGES = {
  abort: '処理が中断されました',
  upload: 'アップロードに失敗しました',
  check: '判定APIエラー',
  extract: 'データの抽出に失敗しました',
  validation: 'データの形式が不正です',
  generic: '予期せぬエラーが発生しました',
} as const

/**
 * 正規化されたエラーメッセージを返すユーティリティ。
 * 未知のエラーは汎用メッセージにフォールバックします。
 */
export function resolveError(error: unknown): string {
  if (error instanceof DOMException && error.name === 'AbortError') {
    return ERROR_MESSAGES.abort
  }
  if (error instanceof Error) {
    return error.message || ERROR_MESSAGES.generic
  }
  return ERROR_MESSAGES.generic
}
