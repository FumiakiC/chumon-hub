/**
 * 抽出パイプラインのステージ共通型。
 *
 * PR-06 で導入する「薄い土台」。現状のステージは upload / validate のみ
 * （実体は `./upload.ts`）。classify / extract は各 API ルートの handler が
 * この `UploadedFile` を受け取る形で担い、将来のマルチAIパイプライン
 * （カスケード / critic = Phase 4）の継ぎ目とする。呼び出しは現状の1経路のまま。
 */

/** Google File API へアップロード済みのファイル参照（handler へ渡す入力）。 */
export interface UploadedFile {
  /** Google File API の参照 URI（generateContent の file part に渡す）。 */
  fileUri: string
  /** Google File API 上のリソース名（cleanup 時の deleteFile に使う）。 */
  name: string
  /** マジックバイトで検出した実体 MIME（クライアント申告値ではない）。 */
  mimeType: string
}
