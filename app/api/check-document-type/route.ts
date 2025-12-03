import { createGoogleGenerativeAI } from "@ai-sdk/google"
import { generateObject } from "ai"
import { z } from "zod"
import { generateFileId, cacheFile, startFileCacheMaintenance } from "@/lib/fileCache"

export const maxDuration = 60

// Lazy start cache maintenance per request to avoid multiple timers in serverless

export async function POST(req: Request) {
  try {
    // Ensure cache maintenance is running (singleton via globalThis)
    startFileCacheMaintenance()
    const { fileBase64, mimeType } = await req.json()

    // basic diagnostics: ensure we received values
    console.log('[v0] check-document-type request:', { mimeType, hasBase64: !!fileBase64 })
    if (!fileBase64) {
      console.error('[v0] check-document-type: fileBase64 empty')
      return Response.json({ error: 'fileBase64 is required' }, { status: 400 })
    }
    if (!mimeType) {
      console.error('[v0] check-document-type: mimeType empty')
      return Response.json({ error: 'mimeType is required' }, { status: 400 })
    }

    // Normalize to a data URL. Some SDKs/models expect `data:<mime>;base64,<data>`.
    const dataUrl = `data:${mimeType};base64,${fileBase64}`
    // log a small sample to help debugging (avoid full dump)
    console.log('[v0] check-document-type: dataUrl sample length', dataUrl.length)
    console.log('[v0] check-document-type: dataUrl prefix', dataUrl.slice(0, 120))

    const apiKey = process.env.GOOGLE_API_KEY
    if (!apiKey) {
      console.error('[v0] GOOGLE_API_KEY is not set')
      return Response.json({ error: 'Server misconfiguration: GOOGLE_API_KEY is not set' }, { status: 500 })
    }

    const google = createGoogleGenerativeAI({ apiKey })

    // Validate size before sending to model or caching
    const approxBytes = Math.floor((fileBase64.length * 3) / 4)
    const MAX_SINGLE_FILE_BYTES = 50 * 1024 * 1024 // keep in sync with lib/fileCache
    if (approxBytes > MAX_SINGLE_FILE_BYTES) {
      console.error('[v0] check-document-type: file too large', { approxBytes })
      return Response.json({ error: 'File too large' }, { status: 413 })
    }

    const result = await generateObject({
      model: google("gemini-2.5-flash"),
      schema: z.object({
        isQuotation: z.boolean().describe("Whether the document is a quotation, estimate, or purchase order form"),
        documentType: z
          .string()
          .describe("The specific type of the document (e.g., Quotation, Invoice, Receipt, Other)"),
        reason: z.string().describe("Short reason for the classification in Japanese"),
      }),
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
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
                type: "image",
                // provide the data URL form so the model/SDK receives mime info
                image: dataUrl,
              },
          ],
        },
      ],
    })

    // Cache the file for subsequent API calls
    const fileId = generateFileId()
    try {
      cacheFile(fileId, fileBase64, mimeType)
    } catch (e) {
      console.error('[v0] check-document-type: cacheFile error', e)
      return Response.json({ error: 'Failed to cache file' }, { status: 500 })
    }
    console.log('[v0] check-document-type: cached file with ID', fileId)

    return Response.json({
      ...result.object,
      fileId, // Return fileId for the next API call
    })
  } catch (error) {
    console.error("Check document error:", error)
    return Response.json({ error: "Failed to check document type" }, { status: 500 })
  }
}
