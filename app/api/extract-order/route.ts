import { createGoogleGenerativeAI } from "@ai-sdk/google"
import { generateObject } from "ai"
import { z } from "zod"
import { getCachedFile, startFileCacheMaintenance } from "@/lib/fileCache"
import { verifyFileId } from "@/lib/crypto"
import { GoogleAIFileManager } from "@google/generative-ai/server"

export const maxDuration = 60

// Define the schema for the order form extraction
const orderSchema = z.object({
  items: z.array(
    z.object({
      productName: z.string().describe("Product Name (品名)"),
      quantity: z.coerce.number().describe("Quantity (数量)"),
      unitPrice: z.coerce.number().describe("Unit Price (単価) - numeric value without comma or currency symbol"),
      amount: z.coerce.number().describe("Amount/Subtotal (金額) - numeric value without comma or currency symbol"),
      description: z.string().optional().describe("Description or remarks (摘要)"),
    })
  ).describe("Line items array (明細行の配列)"),
  orderNo: z.string().describe("Order Number (注番) - Extract the ID strictly matching the format: 'S' + YYMMDD (date) + '-' + SerialNumber (e.g., S251106-008). It is usually found in '件名' or 'No.'. Ignore any other IDs like 'MGG...'."),
  quoteNo: z.string().describe("Quotation Number (見積No)"),
  totalAmount: z.string().describe("Total Amount (合計金額)"),
  requestedDeliveryDate: z.string().describe("Requested/Confirmed Delivery Date (請納期/納入期日) - Extract '納入期日' or '納期' here. Format as YYYYMMDD (e.g., 20251114). Do NOT use slashes or other separators."),
  paymentTerms: z.string().describe("Payment Terms (支払条件)"),
  deliveryLocation: z.string().describe("Delivery Location (受渡場所) - Do NOT infer from the recipient's address or company name. If '受渡場所' is not explicitly labeled, return an empty string."),
  inspectionDeadline: z.string().describe("Inspection Deadline (検査完了期日)"),
  recipientCompany: z.string().describe("Order Recipient / Vendor Name (発注先/見積発行元) - The company that issued this quotation (e.g. 株式会社 山口製作所)"),
})

export async function POST(req: Request) {
  let fileManagerName: string | null = null

  try {
    // Ensure cache maintenance is running (singleton via globalThis)
    startFileCacheMaintenance()
    const body = await req.json()
    const fileIdToken = body?.fileId
    if (typeof fileIdToken !== 'string' || fileIdToken.trim() === '') {
      return Response.json({ error: 'fileId must be a non-empty string' }, { status: 400 })
    }

    const rawFileId = verifyFileId(fileIdToken)
    if (!rawFileId) {
      return Response.json({ error: 'fileId signature verification failed or expired' }, { status: 401 })
    }

    const apiKey = process.env.GOOGLE_API_KEY
    if (!apiKey) {
      console.error('[v0] GOOGLE_API_KEY is not set')
      return Response.json({ error: 'Server misconfiguration: GOOGLE_API_KEY is not set' }, { status: 500 })
    }

    // Resolve file data from cache
    const cached = getCachedFile(rawFileId)
    if (!cached) {
      console.error('[v0] extract-order: cache miss for fileId', rawFileId)
      return Response.json({ error: 'File cache expired' }, { status: 410 })
    }

    const { fileUri, name, mimeType } = cached
    fileManagerName = name // Store for cleanup in finally
    console.log('[v0] extract-order: using cached file', { fileId: rawFileId, fileUri, name })

    const google = createGoogleGenerativeAI({ apiKey })

    // Use Gemini 2.5 Flash for high-accuracy extraction
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

CRITICAL INSTRUCTIONS for line items:
1. Extract ALL line items/products as an array in the "items" field.
2. Each item object MUST contain:
   - productName: Product name (品名)
   - quantity: Quantity as a NUMBER without commas (e.g., 1, 2, 100)
   - unitPrice: Unit price as a NUMBER without commas or currency symbols (e.g., 800000, 120000)
   - amount: Subtotal for this line item as a NUMBER (quantity × unitPrice)
   - description: Optional remarks or specifications

3. For numeric fields (quantity, unitPrice, amount):
   - Convert all values to pure numbers
   - Remove thousand-separator commas (e.g., "1,234" → 1234)
   - Remove currency symbols (¥, $, etc.)
   - Do NOT return strings for these fields; return actual numbers

4. Preserve other fields at the root level (orderNo, quoteNo, totalAmount, etc.).

5. If a field is not found, use an empty string "" or null as appropriate.

6. Be extremely thorough - extract ALL line items from tables or lists.

Return only valid JSON matching the schema.`,
            },
            {
              type: "file",
              data: fileUri,
              mediaType: mimeType,
            },
          ],
        },
      ],
    })

    return Response.json(result.object)
  } catch (error) {
    console.error("Extraction error:", error)
    return Response.json({ error: "Failed to extract order details" }, { status: 500 })
  } finally {
    // Always delete the file from Google AI File Manager
    if (fileManagerName) {
      try {
        const apiKey = process.env.GOOGLE_API_KEY
        if (apiKey) {
          const fileManager = new GoogleAIFileManager(apiKey)
          await fileManager.deleteFile(fileManagerName)
          console.log('[v0] extract-order: deleted file from Google AI', fileManagerName)
        }
      } catch (err) {
        console.error('[v0] extract-order: failed to delete file from Google AI', err)
      }
    }
  }
}
