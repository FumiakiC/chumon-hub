import { createGoogleGenerativeAI } from "@ai-sdk/google"
import { generateObject } from "ai"
import { z } from "zod"
import { getCachedFile, startFileCacheMaintenance } from "@/lib/fileCache"

export const maxDuration = 60

// Lazy start in handler to avoid multiple timers in serverless

// Define the schema for the order form extraction
const orderSchema = z.object({
  orderNo: z.string().describe("Order Number (注番/注文番号)"),
  quoteNo: z.string().describe("Quotation Number (見積No)"),
  productName: z.string().describe("All Product Names (品名) - combine all products with comma or space separation, e.g., 'サーバーA(テスト用), ノートPC B (開発用), ネットワーク機器セット'"),
  description: z.string().describe("Description or Summary (摘要)"),
  quantity: z.string().describe("All Quantities (数量) - list all quantities in order separated by spaces, e.g., '1 2 1'"),
  unitPrice: z.string().describe("All Unit Prices (単価) - list all unit prices in order separated by spaces, e.g., '800000 120000 15000'"),
  amount: z.string().describe("Amount (金額) - if multiple items, this may be subtotal or empty"),
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
    // Ensure cache maintenance is running (singleton via globalThis)
    startFileCacheMaintenance()
    const { fileBase64: providedFileBase64, mimeType: providedMimeType, fileId } = await req.json()

    const apiKey = process.env.GOOGLE_API_KEY
    if (!apiKey) {
      console.error('[v0] GOOGLE_API_KEY is not set')
      return Response.json({ error: 'Server misconfiguration: GOOGLE_API_KEY is not set' }, { status: 500 })
    }

    // Resolve file data: prefer cache by fileId, fallback to provided payload
    let fileBase64: string | undefined = providedFileBase64
    let mimeType: string | undefined = providedMimeType

    if (fileId) {
      const cached = getCachedFile(fileId)
      if (cached) {
        console.log('[v0] extract-order: using cached file', fileId)
        fileBase64 = cached.fileBase64
        mimeType = cached.mimeType
      } else {
        console.warn('[v0] extract-order: fileId provided but cache miss', fileId)
      }
    }

    if (!fileBase64 || !mimeType) {
      const errorMessage = fileId
        ? 'File cache expired. Please re-upload the file.'
        : 'fileBase64 and mimeType are required'
      return Response.json({ error: errorMessage }, { status: 400 })
    }

    // Validate size before proceeding
    const approxBytes = Math.floor((fileBase64.length * 3) / 4)
    const MAX_SINGLE_FILE_BYTES = 50 * 1024 * 1024 // keep in sync with lib/fileCache
    if (approxBytes > MAX_SINGLE_FILE_BYTES) {
      console.error('[v0] extract-order: file too large', { approxBytes })
      return Response.json({ error: 'File too large' }, { status: 413 })
    }

    // normalize to data URL for image input
    const dataUrl = `data:${mimeType};base64,${fileBase64}`
    console.log('[v0] extract-order request:', { mimeType, dataUrlLength: dataUrl.length })

    const google = createGoogleGenerativeAI({ apiKey })

    // Use Gemini 2.5 Pro for high-accuracy extraction
    const result = await generateObject({
      model: google("gemini-2.5-flash"),
      schema: orderSchema,
      messages: [
        {
          role: "user",
            content: [
            {
              type: "text",
              text: `Extract all order details from this quotation/order document into a structured JSON format.

CRITICAL INSTRUCTIONS for multiple line items:
1. If the document contains MULTIPLE line items/products, you MUST extract ALL of them:
   - productName: Combine ALL product names separated by commas (e.g., "サーバーA(テスト用), ノートPC B (開発用), ネットワーク機器セット")
   - quantity: List ALL quantities in the same order, separated by spaces (e.g., "1 2 1")
   - unitPrice: List ALL unit prices in the same order, separated by spaces (e.g., "800000 120000 15000")

2. For numeric fields (quantity, unitPrice, amount, totalAmount):
   - Do NOT include thousand-separator commas (convert "1,234" to "1234")
   - Do NOT include currency symbols (¥, $, etc.)

3. If a field is not found in the document, leave it as an empty string "".

4. Be extremely thorough - check the entire document for all line items in tables or lists.

Return only valid JSON matching the schema.`,
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
