import { GoogleGenAI } from '@google/genai'

import { generateStructured } from '@/lib/ai/generate'
import { GEMINI_MODELS } from '@/lib/ai/models'
import { orderSchema } from '@/lib/ai/schemas'
import { decryptFileToken } from '@/lib/crypto'

export const maxDuration = 60

export async function POST(req: Request) {
  let fileManagerName: string | null = null

  try {
    const body = await req.json()
    const fileIdToken = body?.fileId
    if (typeof fileIdToken !== 'string' || fileIdToken.trim() === '') {
      return Response.json(
        { error: 'fileId must be a non-empty string' },
        { status: 400 }
      )
    }

    // Decrypt the file token to get file information
    const fileTokenData = decryptFileToken(fileIdToken)
    if (!fileTokenData) {
      console.error('[v0] extract-order: failed to decrypt fileId token')
      return Response.json(
        { error: 'Invalid or expired fileId' },
        { status: 401 }
      )
    }

    const apiKey = process.env.GOOGLE_API_KEY
    if (!apiKey) {
      console.error('[v0] GOOGLE_API_KEY is not set')
      return Response.json(
        { error: 'Server misconfiguration: GOOGLE_API_KEY is not set' },
        { status: 500 }
      )
    }

    const { fileUri, name, mimeType } = fileTokenData
    fileManagerName = name // Store for cleanup in finally
    console.log('[v0] extract-order: using decrypted file token', {
      fileUri,
      name,
    })

    // Use Gemini 2.5 Flash for high-accuracy extraction
    const result = await generateStructured({
      apiKey,
      model: GEMINI_MODELS.extractOrder,
      schema: orderSchema,
      prompt: `Extract all order details from this quotation/order document into a structured JSON format.

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
      file: {
        fileUri,
        mimeType,
      },
    })

    return Response.json(result)
  } catch (error) {
    console.error('Extraction error:', error)
    return Response.json(
      { error: 'Failed to extract order details' },
      { status: 500 }
    )
  } finally {
    // Always delete the file from Google AI File Manager
    if (fileManagerName) {
      try {
        const apiKey = process.env.GOOGLE_API_KEY
        if (apiKey) {
          const ai = new GoogleGenAI({ apiKey })
          await ai.files.delete({ name: fileManagerName })
          console.log(
            '[v0] extract-order: deleted file from Google AI',
            fileManagerName
          )
        }
      } catch (err) {
        console.error(
          '[v0] extract-order: failed to delete file from Google AI',
          err
        )
      }
    }
  }
}
