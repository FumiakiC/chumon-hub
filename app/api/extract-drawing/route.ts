import { createGoogle } from '@ai-sdk/google'
import { GoogleAIFileManager } from '@google/generative-ai/server'
import { generateObject } from 'ai'
import crypto from 'crypto'
import { unlink, writeFile } from 'fs/promises'
import os from 'os'
import path from 'path'

import { GEMINI_MODELS } from '@/lib/ai/models'
import { drawingSchema } from '@/lib/ai/schemas'

export const maxDuration = 60

function normalizeDrawingNo(rawNo: string): string {
  // "12D925-101②" や "12D925-2013" から、純粋な図番 "12D925-xxx" 部分だけを抽出
  const match = rawNo.match(/^(\d{2}[A-Za-z]\d{3}-\d{3})/)
  return match ? match[1] : rawNo
}

export async function POST(req: Request) {
  let fileManagerName: string | null = null
  let tmpFilePath: string | null = null

  try {
    const formData = await req.formData()
    const file = formData.get('file')
    if (!(file instanceof File)) {
      return Response.json({ error: 'file is required' }, { status: 400 })
    }

    const apiKey = process.env.GOOGLE_API_KEY
    if (!apiKey) {
      console.error('[v0] GOOGLE_API_KEY is not set')
      return Response.json(
        { error: 'Server misconfiguration: GOOGLE_API_KEY is not set' },
        { status: 500 }
      )
    }

    const arrayBuffer = await file.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)
    const mimeType = file.type || 'application/pdf'
    const ext = path.extname(file.name) || '.pdf'

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
    console.log('[v0] extract-drawing: uploaded file to Google AI', {
      name: fileManagerName,
      uri: fileUri,
    })

    const google = createGoogle({ apiKey })

    const result = await generateObject({
      model: google(GEMINI_MODELS.extractDrawing),
      schema: drawingSchema,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: 'あなたは日本の機械図面を読み取る熟練したAIです。提供された図面PDF（特に右下の表題欄）から、指定スキーマに従ってワンパスで正確に抽出してください。\n\n【厳格な抽出ルール】\n1. reasoning: まず図面全体を見て、特に数量判定（粗さ記号上の数字と四角囲み数字の除外）と、材質・表面処理の有無判定をステップバイステップで検討し、最初に出力すること。\n2. 図面番号 (drawingNo): 図面上に表記されている文字列をそのまま抽出すること。\n3. 数量 (quantity): 『数量』や『QTY』という項目名はありません。『粗さ記号（粗サ、▽など）』のすぐ上部にある数字が数量。図面番号の横などにある『四角で囲まれた数字』は用紙サイズ等の記号なので、絶対に数量として抽出しないこと。見つからない場合は null を出力すること。\n4. 材質 (material) と表面処理 (surfaceTreatment): 明確な記載（SS400、SUS、SOBなど）のみ抽出すること。『250227』のような数字の羅列（日付）や『千葉奎耀』のような人名（設計者・製図者など）は絶対に推測で当てはめず、空欄の場合は必ず空文字（""）を出力すること。\n5. confidence: 読み取りの自信度を0〜100で評価し、材質や図番が不明瞭な場合は大きく減点すること。\n6. JSON形式のみを返すこと。',
            },
            {
              type: 'file',
              data: fileUri,
              mediaType: mimeType,
            },
          ],
        },
      ],
    })

    const normalizedResult = {
      ...result.object,
      drawingNo: normalizeDrawingNo(result.object.drawingNo),
    }

    return Response.json(normalizedResult)
  } catch (error) {
    console.error('Extraction error:', error)
    return Response.json(
      { error: 'Failed to extract drawing details' },
      { status: 500 }
    )
  } finally {
    if (tmpFilePath) {
      try {
        await unlink(tmpFilePath)
        console.log('[v0] extract-drawing: cleaned up tmp file')
      } catch (err) {
        console.error('[v0] extract-drawing: failed to cleanup tmp file', err)
      }
    }
    if (fileManagerName) {
      try {
        const apiKey = process.env.GOOGLE_API_KEY
        if (apiKey) {
          const fileManager = new GoogleAIFileManager(apiKey)
          await fileManager.deleteFile(fileManagerName)
          console.log(
            '[v0] extract-drawing: deleted file from Google AI',
            fileManagerName
          )
        }
      } catch (err) {
        console.error(
          '[v0] extract-drawing: failed to delete file from Google AI',
          err
        )
      }
    }
  }
}
