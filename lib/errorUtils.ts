import { type AppErrorCode, getErrorCode } from '@/lib/errors'

/** コード別の日本語UX（メッセージ＋対応）。 */
const ERROR_BY_CODE: Record<AppErrorCode, { ja: string; action: string }> = {
  ERR_SYS_CONFIG: {
    ja: 'サーバー設定エラーが発生しました。',
    action: 'システム管理者に連絡してください。',
  },
  ERR_VALIDATION: {
    ja: 'リクエストの内容が正しくありません。',
    action: 'ファイルや入力内容を確認して、再試行してください。',
  },
  ERR_FILE_TOO_LARGE: {
    ja: 'アップロードエラー: ファイルサイズが大きすぎます。',
    action: 'ファイルを圧縮するか、別のファイルを試してください。',
  },
  ERR_UNSUPPORTED_MEDIA: {
    ja: '対応していないファイル形式です。',
    action: 'PDF または画像（JPEG/PNG/WebP/HEIC）を使用してください。',
  },
  ERR_UNAUTHORIZED: {
    ja: 'ファイルの有効期限が切れているか、無効です。',
    action: 'お手数ですが、最初からやり直してください。',
  },
  ERR_CLASSIFY: {
    ja: '判定APIでエラーが発生しました。',
    action:
      '少し待ってから再試行してください。解消しない場合は管理者へ連絡してください。',
  },
  ERR_EXTRACT: {
    ja: 'データ抽出でエラーが発生しました。',
    action:
      '少し待ってから再試行してください。解消しない場合は管理者へ連絡してください。',
  },
  ERR_INVALID_RESULT: {
    ja: '抽出結果の形式が不正です。',
    action: '別のファイルを試すか、入力フォーマットを確認してください。',
  },
  ERR_REQUEST_FAILED: {
    ja: 'APIリクエストに失敗しました。',
    action: 'ネットワーク接続を確認し、再試行してください。',
  },
  ERR_UNKNOWN: {
    ja: 'エラーが発生しました。',
    action: 'システム管理者にログを共有して問い合わせてください。',
  },
}

/**
 * エラーを画面表示用に解決する。機械可読コードで分岐し（文字列 includes マッチは廃止）、
 * コードが無い場合は固定の汎用メッセージ（ERR_UNKNOWN）を返す。内部詳細（元メッセージ）は
 * 返さない。必要なら呼び出し側が元の error を直接ログすること。
 */
export function resolveError(error: unknown): {
  message: string
  action: string
} {
  const code = getErrorCode(error)
  const info = code ? ERROR_BY_CODE[code] : ERROR_BY_CODE.ERR_UNKNOWN

  return { message: info.ja, action: info.action }
}
