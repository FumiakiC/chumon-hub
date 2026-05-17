import { createGoogleGenerativeAI } from "@ai-sdk/google"
import { generateObject } from "ai"
import { z } from "zod"
import { GoogleAIFileManager } from "@google/generative-ai/server"
import { writeFile, unlink } from "fs/promises"
import os from "os"
import path from "path"
import crypto from "crypto"

export const maxDuration = 60

function normalizeDrawingNo(rawNo: string): string {
  // "12D925-101②" や "12D925-2013" から、純粋な図番 "12D925-xxx" 部分だけを抽出
  const match = rawNo.match(/^(\d{2}[A-Za-z]\d{3}-\d{3})/)
  return match ? match[1] : rawNo
}

const drawingSchema = z.object({
  reasoning: z
    .string()
    .describe("抽出の思考プロセス。まず図面全体（特に右下の表題欄）を確認し、「数量の特定（粗さ記号の上の数字、四角囲み数字の除外）」「材質・表面処理の有無」について、どのように判断したかステップバイステップで言語化してください。"),
  drawingNo: z.string().describe("Drawing Number (図面番号)"),
  partName: z.string().describe("Part/Item Name (品名・部品名)"),
  material: z
    .string()
    .describe("Material (材質) ※明確な記載（SS400、SUS、SOBなど）のみ抽出すること。記載がない場合は必ず空文字(\"\")にすること。人名や日付を誤って入れないこと。"),
  quantity: z.number().nullable().describe("数量。※『数量』や『QTY』という項目名はありません。「粗さ記号（粗サ、▽など）」のすぐ上部に、何の脈絡もなく単独で記載されている数字が数量です。それを見つけて数値として抽出してください。注意：図面番号の横などにある四角で囲まれた数字（用紙サイズ等の記号）は絶対に数量として抽出しないこと。"),
  surfaceTreatment: z
    .string()
    .optional()
    .describe("Surface Treatment (表面処理) ※明確な記載（SS400、SUS、SOBなど）のみ抽出すること。記載がない場合は必ず空文字(\"\")にすること。人名や日付を誤って入れないこと。"),
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

    tmpFilePath = path.join(os.tmpdir(), `upload_${crypto.randomUUID()}${ext}`)
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
      model: google("gemini-3.1-flash-lite"),
      schema: drawingSchema,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "あなたは日本の機械図面を読み取る熟練したAIです。提供された図面PDF（特に右下の表題欄）から、指定スキーマに従ってワンパスで正確に抽出してください。\n\n【厳格な抽出ルール】\n1. 図面番号 (drawingNo): 図面上に表記されている文字列をそのまま抽出すること。\n2. 数量 (quantity): 『数量』や『QTY』という項目名はありません。『粗さ記号（粗サ、▽など）』のすぐ上部にある数字が数量。図面番号の横などにある『四角で囲まれた数字』は用紙サイズ等の記号なので、絶対に数量として抽出しないこと。\n3. 材質 (material) と表面処理 (surfaceTreatment): 明確な記載（SS400、SUS、SOBなど）のみ抽出すること。『250227』のような数字の羅列（日付）や『千葉奎耀』のような人名（設計者・製図者など）は絶対に推測で当てはめず、空欄の場合は必ず空文字（\"\"）を出力すること。\n4. reasoning: 図面全体を見て、特に数量判定（粗さ記号上の数字と四角囲み数字の除外）と、材質・表面処理の有無判定をステップバイステップで記述すること。\n5. JSON形式のみを返すこと。"
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

    const normalizedResult = {
      ...result.object,
      drawingNo: normalizeDrawingNo(result.object.drawingNo),
    }

    return Response.json(normalizedResult)
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
