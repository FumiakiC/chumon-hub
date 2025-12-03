import { GoogleGenerativeAI } from "@google/generative-ai"
import { z } from 'zod'

// 1. 【重要】数値クリーニング用の再利用可能なスキーマを作成
// これを使えば、文字列でも数値でも、全角/半角カンマを除去してきれいな文字列にします
const cleanNumberSchema = z.union([z.string(), z.number()]) // 文字列か数値を受け入れる
  .transform((val) => {
    // 文字列に変換し、半角カンマ(,)、全角カンマ(，)、スペースを除去
    return String(val).replace(/[,，\s]/g, '').trim();
  });

// 2. 明細行スキーマ（数値項目に cleanNumberSchema を適用）
const itemSchema = z.object({
  productName: z.coerce.string().describe('商品名'),
  quantity: cleanNumberSchema.describe('数量'),    // ← ここに適用
  unitPrice: cleanNumberSchema.describe('単価'),   // ← ここに適用
  amount: cleanNumberSchema.describe('金額'),      // ← ここに適用
})

// 3. 親スキーマ
const orderFormSchema = z.object({
  orderNo: z.coerce.string().describe('注文番号'),
  quoteNo: z.coerce.string().describe('見積書番号'),
  
  items: z.array(itemSchema).describe('見積もりの明細行リスト'),

  totalAmount: cleanNumberSchema.describe('合計金額（税抜）'), // ← ここに適用

  desiredDeliveryDate: z.coerce.string().describe('希望納期'),
  requestedDeliveryDate: z.coerce.string().describe('請納期'),
  paymentTerms: z.coerce.string().describe('支払条件'),
  deliveryLocation: z.coerce.string().describe('受渡場所'),
  inspectionDeadline: z.coerce.string().describe('検査完了期日'),
  recipientCompany: z.coerce.string().describe('宛先企業名'),
  issuerCompany: z.coerce.string().describe('発注元企業名（自社名）'),
  issuerAddress: z.coerce.string().describe('発注元住所'),
  phone: z.coerce.string().describe('電話番号'),
  fax: z.coerce.string().describe('FAX番号'),
  manager: z.coerce.string().describe('担当者名'),
  approver: z.coerce.string().describe('承認者名'),
})

async function safeGenerate(model: any, payload: any, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      return await model.generateContent(payload)
    } catch (error: any) {
      const status = error?.status || error?.response?.status
      if ((status === 503 || status === 429) && i < retries - 1) {
        const wait = 2000 * Math.pow(2, i)
        await new Promise(r => setTimeout(r, wait))
        continue
      }
      throw error
    }
  }
}

export async function POST(req: Request) {
  try {
    const { text } = await req.json()
    if (!text) return Response.json({ error: 'text is required' }, { status: 400 })

    const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY!)
    const model = genAI.getGenerativeModel({ 
      model: 'gemini-2.5-flash',
      generationConfig: { responseMimeType: "application/json" }
    })

    const headerFields = Object.entries(orderFormSchema.shape)
      .filter(([key]) => key !== 'items')
      .map(([key, zodType]) => `"${key}": "${(zodType as any).description}"`)
      .join(',\n')
    
    const itemFields = Object.entries(itemSchema.shape)
      .map(([key, zodType]) => `"${key}": "${(zodType as any).description}"`)
      .join(',\n')

    const prompt = `
      あなたはデータ抽出アシスタントです。以下の見積書テキストから情報を抽出し、JSON形式で返してください。
      
      ### 出力スキーマ構造:
      {
        ${headerFields},
        "items": [
          {
            ${itemFields}
          }
        ]
      }

      ### ルール:
      1. 明細行が複数ある場合は "items" 配列に追加してください。
      2. 値が見つからない場合は空文字 "" にしてください。
      3. 数値はカンマを含めないでください。

      ### テキスト:
      ${text}
    `

    const result = await safeGenerate(model, prompt)
    const rawText = result.response.text()

    let parsed: any = {}
    try {
      parsed = JSON.parse(rawText)
    } catch (e) {
      return Response.json({ error: 'Invalid JSON', raw: rawText }, { status: 500 })
    }

    // ★重要: 手動のループ処理やreplace処理はすべて削除しました。
    // ZodのsafeParseを実行した瞬間に、schema内の .transform() が発動し、
    // 自動的にカンマが除去されます。

    const safe = orderFormSchema.safeParse(parsed)

    if (!safe.success) {
        console.warn("Schema validation failed", safe.error)
        // 失敗時もフォールバックとしてパース結果を返す（ただしtransformが効かない可能性があるため注意）
        // ただ、今回はcoerceを使っているので型エラーは起きにくくなっています
        return Response.json({ extractedData: parsed, warning: "Validation failed" })
    }

    return Response.json({ extractedData: safe.data })

  } catch (error) {
    console.error('[v0] parse-extracted error:', error)
    return Response.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
