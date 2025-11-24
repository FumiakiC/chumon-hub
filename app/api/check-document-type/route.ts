import { createGoogleGenerativeAI } from "@ai-sdk/google"
import { generateObject } from "ai"
import { z } from "zod"

export const maxDuration = 60

export async function POST(req: Request) {
  try {
    const { fileBase64, mimeType } = await req.json()

    // basic diagnostics: ensure we received values
    console.log('[v0] check-document-type request:', { mimeType, hasBase64: !!fileBase64 })
    if (!fileBase64) {
      console.error('[v0] check-document-type: fileBase64 empty')
      return Response.json({ error: 'fileBase64 is required' }, { status: 400 })
    }
    if (!mimeType) {
      console.error('[v0] check-document-type: mimeType empty')
      return Response.json({ error: 'mimeType is required' }, { status: 400 })
    }

    // Normalize to a data URL. Some SDKs/models expect `data:<mime>;base64,<data>`.
    const dataUrl = `data:${mimeType};base64,${fileBase64}`
    // log a small sample to help debugging (avoid full dump)
    console.log('[v0] check-document-type: dataUrl sample length', dataUrl.length)
    console.log('[v0] check-document-type: dataUrl prefix', dataUrl.slice(0, 120))

    const apiKey = process.env.GOOGLE_API_KEY
    if (!apiKey) {
      console.error('[v0] GOOGLE_API_KEY is not set')
      return Response.json({ error: 'Server misconfiguration: GOOGLE_API_KEY is not set' }, { status: 500 })
    }

    const google = createGoogleGenerativeAI({ apiKey })

    const result = await generateObject({
      model: google("gemini-2.5-flash"),
      schema: z.object({
        isQuotation: z.boolean().describe("Whether the document is a quotation, estimate, or purchase order form"),
        documentType: z
          .string()
          .describe("The specific type of the document (e.g., Quotation, Invoice, Receipt, Other)"),
        reason: z.string().describe("Short reason for the classification"),
      }),
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "Analyze this image and determine if it is a quotation (見積書) or an order form (注文書/発注書). Return true for isQuotation if it is either.",
            },
              {
                type: "image",
                // provide the data URL form so the model/SDK receives mime info
                image: dataUrl,
              },
          ],
        },
      ],
    })

    return Response.json(result.object)
  } catch (error) {
    console.error("Check document error:", error)
    return Response.json({ error: "Failed to check document type" }, { status: 500 })
  }
}
