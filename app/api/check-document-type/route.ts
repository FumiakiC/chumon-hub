import { createGoogle } from '@ai-sdk/google'
import { generateObject } from 'ai'

import { GEMINI_MODELS } from '@/lib/ai/models'
import {
  MAX_UPLOAD_BYTES,
  UploadValidationError,
  withUploadedFile,
} from '@/lib/ai/pipeline'
import { documentTypeSchema } from '@/lib/ai/schemas'
import { encryptFileToken } from '@/lib/crypto'

export const maxDuration = 60

export async function POST(req: Request) {
  try {
    const formData = await req.formData()
    const file = formData.get('file')
    const mimeType = formData.get('mimeType') as string

    if (!(file instanceof File)) {
      return Response.json({ error: 'file is required' }, { status: 400 })
    }
    if (!mimeType) {
      return Response.json({ error: 'mimeType is required' }, { status: 400 })
    }

    if (file.size > MAX_UPLOAD_BYTES) {
      return Response.json({ error: 'File too large' }, { status: 413 })
    }

    const apiKey = process.env.GOOGLE_API_KEY
    if (!apiKey) {
      return Response.json(
        {
          error: 'System Configuration Error',
          code: 'ERR_SYS_CONFIG',
          message: 'Contact administrator',
        },
        { status: 500 }
      )
    }

    const google = createGoogle({ apiKey })

    const response = await withUploadedFile(
      file,
      apiKey,
      async (uploadedFile) => {
        const result = await generateObject({
          model: google(GEMINI_MODELS.classify),
          schema: documentTypeSchema,
          messages: [
            {
              role: 'user',
              content: [
                {
                  type: 'text',
                  text: `この画像を分析して、見積書または注文書/発注書かどうかを判定してください。

【見積書・注文書の必須要素】
- 「見積書」「注文書」「発注書」「Quotation」「Purchase Order」などのタイトル
- 金額・単価・数量の明細
- 発行元・宛先の企業名や担当者
- 日付や見積番号/注文番号

【除外すべき書類（これらは false）】
- 請求書（Invoice / 請求書）
- 領収書（Receipt / 領収証）
- 納品書（Delivery Note / 納品書）
- 契約書、仕様書、その他のビジネス文書
- 不鮮明な画像や書類以外の画像

上記の必須要素が揃っている場合のみ isQuotation を true にしてください。
documentType には具体的な書類種別を記載してください（例: 見積書、注文書、請求書、その他）。
reason フィールドには判定理由を日本語で簡潔に記載してください（例: 「見積書のタイトルと金額明細が確認できるため」「請求書のため除外」など）。`,
                },
                {
                  type: 'file',
                  data: uploadedFile.fileUri,
                  mediaType: uploadedFile.mimeType,
                },
              ],
            },
          ],
        })

        const fileToken = encryptFileToken({
          fileUri: uploadedFile.fileUri,
          name: uploadedFile.fileName,
          mimeType: uploadedFile.mimeType,
          timestamp: Date.now(),
        })

        return {
          ...result.object,
          fileId: fileToken,
        }
      },
      {
        deleteUploadedFile: false,
        validation: { skipSizeCheck: true },
      }
    )

    return Response.json(response)
  } catch (error) {
    if (error instanceof UploadValidationError) {
      return Response.json({ error: error.message }, { status: error.status })
    }

    return Response.json(
      { error: 'Failed to check document type' },
      { status: 500 }
    )
  }
}
