import { createGoogleGenerativeAI } from "@ai-sdk/google"
import { generateObject } from "ai"
import { z } from "zod"

export const maxDuration = 60

// Define the schema for the order form extraction
const orderSchema = z.object({
  orderNo: z.string().describe("Order Number (注番/注文番号)"),
  quoteNo: z.string().describe("Quotation Number (見積No)"),
  productName: z.string().describe("Main Product Name (品名) - if multiple, combine or list main one"),
  description: z.string().describe("Description or Summary (摘要)"),
  quantity: z.string().describe("Quantity (数量)"),
  unitPrice: z.string().describe("Unit Price (単価)"),
  amount: z.string().describe("Amount (金額)"),
  totalAmount: z.string().describe("Total Amount (合計金額)"),
  desiredDeliveryDate: z.string().describe("Desired Delivery Date (希望納期)"),
  requestedDeliveryDate: z.string().describe("Requested/Confirmed Delivery Date (請納期)"),
  paymentTerms: z.string().describe("Payment Terms (支払条件)"),
  deliveryLocation: z.string().describe("Delivery Location (受渡場所)"),
  inspectionDeadline: z.string().describe("Inspection Deadline (検査完了期日)"),
  recipientCompany: z.string().describe("Recipient Company Name (宛先会社名/殿)"),
  issuerCompany: z.string().describe("Issuer Company Name (発注元/自社名)"),
  issuerAddress: z.string().describe("Issuer Address (自社住所)"),
  phone: z.string().describe("Phone Number (電話番号)"),
  fax: z.string().describe("FAX Number"),
  manager: z.string().describe("Manager Name (担当)"),
  approver: z.string().describe("Approver Name (承認)"),
})

export async function POST(req: Request) {
  try {
    const { fileBase64, mimeType } = await req.json()

    const apiKey = process.env.GOOGLE_API_KEY
    if (!apiKey) {
      console.error('[v0] GOOGLE_API_KEY is not set')
      return Response.json({ error: 'Server misconfiguration: GOOGLE_API_KEY is not set' }, { status: 500 })
    }

    if (!fileBase64 || !mimeType) {
      return Response.json({ error: 'fileBase64 and mimeType are required' }, { status: 400 })
    }

    // normalize to data URL for image input
    const dataUrl = `data:${mimeType};base64,${fileBase64}`
    console.log('[v0] extract-order request:', { mimeType, dataUrlLength: dataUrl.length })

    const google = createGoogleGenerativeAI({ apiKey })

    // Use Gemini 1.5 Pro for high-accuracy extraction
    const result = await generateObject({
      model: google("gemini-2.5-pro"),
      schema: orderSchema,
      messages: [
        {
          role: "user",
            content: [
            {
              type: "text",
              text: "Extract all order details from this quotation/order document into a structured JSON format. Be precise with numbers and text. If a field is missing, leave it as an empty string. Important: For numeric fields such as quantity, unitPrice, amount, and totalAmount, do NOT include thousand-separator commas (e.g. \"1,234\" -> \"1234\"). Do not include currency symbols. Return only the JSON fields matching the schema.",
            },
            {
              type: "image",
              image: dataUrl,
            },
          ],
        },
      ],
    })

    // result.object should match the schema, but sanitize numeric-like fields server-side as a safety net
    const numericKeys = ['quantity', 'unitPrice', 'amount', 'totalAmount']
    const obj: any = result.object ?? {}
    for (const k of numericKeys) {
      if (obj && obj[k] != null) {
        obj[k] = String(obj[k]).replace(/,/g, '').replace(/[¥$]/g, '').trim()
      }
    }

    return Response.json(obj)
  } catch (error) {
    console.error("Extraction error:", error)
    return Response.json({ error: "Failed to extract order details" }, { status: 500 })
  }
}
