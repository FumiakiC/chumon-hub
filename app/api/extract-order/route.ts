import { generateObject } from 'ai'
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

export async function POST(req: Request) {
  try {
    const { file } = await req.json()

    if (!file || !file.data) {
      return Response.json(
        { error: 'ファイルデータが必要です' },
        { status: 400 }
      )
    }

    const { object } = await generateObject({
      model: 'google/gemini-2.5-flash-image',
      schema: orderFormSchema,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: '以下の見積書または注文書から発注フォームの情報を抽出してください。すべてのフィールドを埋めてください。情報が見つからない場合は空文字を返してください。',
            },
            {
              type: 'file',
              data: file.data,
              mediaType: file.mediaType || 'application/pdf',
            },
          ],
        },
      ],
    })

    return Response.json({ extractedData: object })
  } catch (error) {
    console.error('[v0] Gemini API error:', error)
    return Response.json(
      { error: 'データの抽出に失敗しました' },
      { status: 500 }
    )
  }
}
