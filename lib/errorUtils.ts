export const ERROR_DEFINITIONS: Record<string, { ja: string; action: string }> = {
  "API_SECRET is missing": {
    ja: "サーバー設定エラー: APIシークレットが設定されていません。",
    action: "システム管理者に『環境変数 API_SECRET の設定』を依頼してください。",
  },
  "File too large": {
    ja: "アップロードエラー: ファイルサイズが大きすぎます。",
    action: "ファイルを圧縮するか、別の画像を試してください。",
  },
  "判定APIエラー": {
    ja: "判定APIでエラーが発生しました。",
    action: "少し待ってから再試行してください。解消しない場合は管理者へ連絡してください。",
  },
  "データの形式が不正です": {
    ja: "抽出結果の形式が不正です。",
    action: "別のファイルを試すか、入力フォーマットを確認してください。",
  },
  "APIリクエストが失敗しました": {
    ja: "APIリクエストに失敗しました。",
    action: "ネットワーク接続を確認し、再試行してください。",
  },
}

export function resolveError(error: unknown) {
  const rawMessage = error instanceof Error ? (error.message || "予期せぬエラー") : "予期せぬエラー"

  for (const [key, info] of Object.entries(ERROR_DEFINITIONS)) {
    if (rawMessage.includes(key)) {
      return { message: info.ja, action: info.action, raw: rawMessage }
    }
  }

  return {
    message: `エラーが発生しました: ${rawMessage}`,
    action: "システム管理者にログを共有して問い合わせてください。",
    raw: rawMessage,
  }
}
