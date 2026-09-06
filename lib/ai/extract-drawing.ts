import { z } from 'zod'

import { generateStructured } from '@/lib/ai/generate'
import { GEMINI_MODELS } from '@/lib/ai/models'
import type { UploadedFile } from '@/lib/ai/pipeline/types'
import { drawingSchema } from '@/lib/ai/schemas'

export type DrawingExtraction = z.infer<typeof drawingSchema>

export const DRAWING_EXTRACTION_PROMPT =
  'あなたは日本の機械図面を読み取る熟練したAIです。提供された図面PDF（特に右下の表題欄）から、指定スキーマに従ってワンパスで正確に抽出してください。\n\n【厳格な抽出ルール】\n1. reasoning: まず図面全体を見て、特に数量判定（粗さ記号上の数字と四角囲み数字の除外）と、材質・表面処理の有無判定をステップバイステップで検討し、最初に出力すること。\n2. 図面番号 (drawingNo): 図面上に表記されている文字列をそのまま抽出すること。\n3. 数量 (quantity): 『数量』や『QTY』という項目名はありません。『粗さ記号（粗サ、▽など）』のすぐ上部にある数字が数量。図面番号の横などにある『四角で囲まれた数字』は用紙サイズ等の記号なので、絶対に数量として抽出しないこと。見つからない場合は null を出力すること。\n4. 材質 (material) と表面処理 (surfaceTreatment): 明確な記載（SS400、SUS、SOBなど）のみ抽出すること。『250227』のような数字の羅列（日付）や『千葉奎耀』のような人名（設計者・製図者など）は絶対に推測で当てはめず、空欄の場合は必ず空文字（""）を出力すること。\n5. confidence: 読み取りの自信度を0〜100で評価し、材質や図番が不明瞭な場合は大きく減点すること。\n6. JSON形式のみを返すこと。'

export function normalizeDrawingNo(rawNo: string): string {
  // "12D925-101②" や "12D925-2013" から、純粋な図番 "12D925-xxx" 部分だけを抽出
  const match = rawNo.match(/^(\d{2}[A-Za-z]\d{3}-\d{3})/)
  return match ? match[1] : rawNo
}

export async function extractDrawing(params: {
  apiKey: string
  uploaded: UploadedFile
  model?: string
}): Promise<DrawingExtraction> {
  const { apiKey, uploaded, model = GEMINI_MODELS.extractDrawing } = params

  const result = await generateStructured({
    apiKey,
    model,
    schema: drawingSchema,
    prompt: DRAWING_EXTRACTION_PROMPT,
    file: {
      fileUri: uploaded.fileUri,
      mimeType: uploaded.mimeType,
    },
  })

  return {
    ...result,
    drawingNo: normalizeDrawingNo(result.drawingNo),
  }
}
