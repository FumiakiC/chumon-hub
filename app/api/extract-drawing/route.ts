import { createGoogleGenerativeAI } from "@ai-sdk/google"
import { generateObject } from "ai"
import { z } from "zod"
import { GoogleAIFileManager } from "@google/generative-ai/server"
import { writeFile, unlink } from "fs/promises"
import path from "path"
import crypto from "crypto"

export const maxDuration = 60

const drawingSchema = z.object({
  drawingNo: z.string().describe("Drawing Number (図面番号)"),
  partName: z.string().describe("Part/Item Name (品名・部品名)"),
  material: z.string().describe("Material (材質)"),
  quantity: z.coerce.number().describe("Quantity (数量) - numeric value"),
  surfaceTreatment: z.string().optional().describe("Surface Treatment (表面処理)"),
  notes: z.string().optional().describe("Notes/Remarks (備考)"),
  confidence: z.coerce.number().describe("Confidence level (0-100)")
})

export async function POST(req: Request) {
  let fileManagerName: string | null = null
  let tmpFilePath: string | null = null

  try {
    const formData = await req.formData()
    const file = formData.get("file")
    if (!(file instanceof File)) {
      return Response.json({ error: "file is required" }, { status: 400 })
    }

    const apiKey = process.env.GOOGLE_API_KEY
    if (!apiKey) {
      console.error("[v0] GOOGLE_API_KEY is not set")
      return Response.json({ error: "Server misconfiguration: GOOGLE_API_KEY is not set" }, { status: 500 })
    }

    const arrayBuffer = await file.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)
    const mimeType = file.type || "application/pdf"
    const ext = path.extname(file.name) || ".pdf"

    tmpFilePath = path.join("/tmp", `upload_${crypto.randomUUID()}${ext}`)
    await writeFile(tmpFilePath, buffer)

    const fileManager = new GoogleAIFileManager(apiKey)
    const uploadResult = await fileManager.uploadFile(tmpFilePath, {
      mimeType,
      displayName: file.name,
    })

    fileManagerName = uploadResult.file.name
    const fileUri = uploadResult.file.uri

    await unlink(tmpFilePath)
    tmpFilePath = null
    console.log("[v0] extract-drawing: uploaded file to Google AI", {
      name: fileManagerName,
      uri: fileUri,
    })

    const google = createGoogleGenerativeAI({ apiKey })

    const result = await generateObject({
      model: google("gemini-2.5-flash"),
      schema: drawingSchema,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "あなたは日本の機械図面を読み取る熟練したAIです。提供された図面PDF(特に右下の表題欄)から、指定されたスキーマに従って情報を正確に抽出してください。\n\n【抽出ルール】\n1. drawingNo: [数字2桁][英字1桁][数字3桁]-[数字3桁] などの形式。\n2. quantity: 数値のみ。\n3. 該当がない場合は空文字を返す。\n4. confidence: 読み取りの自信度を0〜100で評価し、材質や図番が不明瞭な場合は大きく減点する。\n\nJSON形式のみを返してください。"
            },
            {
              type: "file",
              data: fileUri,
              mediaType: mimeType
            }
          ]
        }
      ]
    })

    return Response.json(result.object)
  } catch (error) {
    console.error("Extraction error:", error)
    return Response.json({ error: "Failed to extract drawing details" }, { status: 500 })
  } finally {
    if (tmpFilePath) {
      try {
        await unlink(tmpFilePath)
        console.log("[v0] extract-drawing: cleaned up tmp file")
      } catch (err) {
        console.error("[v0] extract-drawing: failed to cleanup tmp file", err)
      }
    }
    if (fileManagerName) {
      try {
        const apiKey = process.env.GOOGLE_API_KEY
        if (apiKey) {
          const fileManager = new GoogleAIFileManager(apiKey)
          await fileManager.deleteFile(fileManagerName)
          console.log("[v0] extract-drawing: deleted file from Google AI", fileManagerName)
        }
      } catch (err) {
        console.error("[v0] extract-drawing: failed to delete file from Google AI", err)
      }
    }
  }
}
