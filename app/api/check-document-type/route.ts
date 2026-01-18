import { createGoogleGenerativeAI } from "@ai-sdk/google"
import { generateObject } from "ai"
import { z } from "zod"
import { encryptFileToken } from "@/lib/crypto"
import { GoogleAIFileManager } from "@google/generative-ai/server"
import { writeFile, unlink } from "fs/promises"
import crypto from "crypto"
import path from "path"

export const maxDuration = 60

export async function POST(req: Request) {
  let tmpFilePath: string | null = null

  try {
    const formData = await req.formData()
    const file = formData.get("file") as File
    const mimeType = formData.get("mimeType") as string

    // basic diagnostics: ensure we received values
    console.log('[v0] check-document-type request:', { mimeType, hasFile: !!file })
    if (!file) {
      console.error('[v0] check-document-type: file empty')
      return Response.json({ error: 'file is required' }, { status: 400 })
    }
    if (!mimeType) {
      console.error('[v0] check-document-type: mimeType empty')
      return Response.json({ error: 'mimeType is required' }, { status: 400 })
    }

    // Validate size before processing
    const MAX_SINGLE_FILE_BYTES = 25 * 1024 * 1024 // 25MB
    if (file.size > MAX_SINGLE_FILE_BYTES) {
      console.error('[v0] check-document-type: file too large', { fileSize: file.size })
      return Response.json({ error: 'File too large' }, { status: 413 })
    }

    const apiKey = process.env.GOOGLE_API_KEY
    if (!apiKey) {
      console.error('[v0] GOOGLE_API_KEY is not set')
      return Response.json({ error: 'Server misconfiguration: GOOGLE_API_KEY is not set' }, { status: 500 })
    }

    // Write file to /tmp directory
    const arrayBuffer = await file.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)
    const ext = file.name.split('.').pop() || 'bin'
    tmpFilePath = path.join('/tmp', `upload_${crypto.randomUUID()}.${ext}`)
    await writeFile(tmpFilePath, buffer)
    console.log('[v0] check-document-type: written to tmp', tmpFilePath)

    // Upload to Google AI File Manager
    const fileManager = new GoogleAIFileManager(apiKey)
    const uploadResult = await fileManager.uploadFile(tmpFilePath, {
      mimeType,
      displayName: file.name,
    })
    console.log('[v0] check-document-type: uploaded to Google AI', {
      name: uploadResult.file.name,
      uri: uploadResult.file.uri,
    })

    // Delete local tmp file immediately
    await unlink(tmpFilePath)
    tmpFilePath = null
    console.log('[v0] check-document-type: deleted local tmp file')

    const google = createGoogleGenerativeAI({ apiKey })

    const result = await generateObject({
      model: google("gemini-2.5-flash-lite"),
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
              type: "file",
              data: uploadResult.file.uri,
              mediaType: mimeType,
            },
          ],
        },
      ],
    })

    // Generate encrypted token containing file reference
    const fileToken = encryptFileToken({
      fileUri: uploadResult.file.uri,
      name: uploadResult.file.name,
      mimeType,
      timestamp: Date.now(),
    })
    console.log('[v0] check-document-type: generated encrypted token')

    return Response.json({
      ...result.object,
      fileId: fileToken, // Return encrypted token for the next API call
    })
  } catch (error) {
    console.error("Check document error:", error)
    return Response.json({ error: "Failed to check document type" }, { status: 500 })
  } finally {
    // Cleanup tmp file if it still exists
    if (tmpFilePath) {
      try {
        await unlink(tmpFilePath)
        console.log('[v0] check-document-type: cleaned up tmp file in finally')
      } catch (err) {
        console.error('[v0] check-document-type: failed to cleanup tmp file', err)
      }
    }
  }
}

