import { GoogleGenerativeAI } from "@google/generative-ai"
import { z } from 'zod'

const orderFormSchema = z.object({
  orderNo: z.string().describe('注文番号'),
  quoteNo: z.string().describe('見積書番号'),
  productName: z.string().describe('商品名'),
  description: z.string().describe('商品の説明や摘要'),
  quantity: z.string().describe('数量'),
  unitPrice: z.string().describe('単価'),
  amount: z.string().describe('金額'),
  totalAmount: z.string().describe('合計金額（税抜）'),
  desiredDeliveryDate: z.string().describe('希望納期'),
  requestedDeliveryDate: z.string().describe('請納期'),
  paymentTerms: z.string().describe('支払条件'),
  deliveryLocation: z.string().describe('受渡場所'),
  inspectionDeadline: z.string().describe('検査完了期日'),
  recipientCompany: z.string().describe('宛先企業名'),
  issuerCompany: z.string().describe('発注元企業名（自社名）'),
  issuerAddress: z.string().describe('発注元住所'),
  phone: z.string().describe('電話番号'),
  fax: z.string().describe('FAX番号'),
  manager: z.string().describe('担当者名'),
  approver: z.string().describe('承認者名'),
})

type Extracted = z.infer<typeof orderFormSchema>

async function safeGenerate(model: any, payload: any, retries = 4) {
  for (let i = 0; i < retries; i++) {
    try {
      return await model.generateContent(payload)
    } catch (error: any) {
      const status = error?.status
      if ((status === 503 || status === 429) && i < retries - 1) {
        const wait = 3000 * (i + 1)
        console.log(`[v0] retry ${i + 1}/${retries} after ${wait}ms due to ${status}`)
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
    const model = genAI.getGenerativeModel({ model: 'gemini-pro' })

    const prompt = `以下の見積書テキストから、JSONオブジェクトで次のキーのみを返してください。\n${Object.keys(orderFormSchema.shape).join(', ')}\n値が見つからない場合は空文字にしてください。\nJSONのみを返し、余計な説明を付けないでください。\n\nテキスト:\n${text}`

    const result = await safeGenerate(model, [ { text: prompt } ])
    const raw = result?.response?.candidates?.[0]?.content?.parts?.[0]?.text ?? ''

    // try to extract JSON substring
    let jsonStr = raw.trim()
    const start = jsonStr.indexOf('{')
    const end = jsonStr.lastIndexOf('}')
    if (start !== -1 && end !== -1) {
      jsonStr = jsonStr.slice(start, end + 1)
    }

    let parsed: any = null
    try {
      parsed = JSON.parse(jsonStr)
    } catch (e) {
      return Response.json({ error: 'failed to parse JSON from model output', raw }, { status: 500 })
    }

    // validate/normalize with zod
    const safe = orderFormSchema.safeParse(parsed)
    if (!safe.success) {
      // try to coerce missing fields to ''
      const obj: any = {}
      for (const k of Object.keys(orderFormSchema.shape)) {
        obj[k] = (parsed && parsed[k]) ? String(parsed[k]) : ''
      }
      return Response.json({ extractedData: obj })
    }

    return Response.json({ extractedData: safe.data })
  } catch (error) {
    console.error('[v0] parse-extracted error:', error)
    return Response.json({ error: 'failed to parse text' }, { status: 500 })
  }
}
