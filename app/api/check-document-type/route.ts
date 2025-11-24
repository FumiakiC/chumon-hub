import { createGoogleGenerativeAI } from "@ai-sdk/google"
import { generateObject } from "ai"
import { z } from "zod"

export const maxDuration = 60

export async function POST(req: Request) {
  try {
    const { fileBase64, mimeType } = await req.json()

    const google = createGoogleGenerativeAI({
      apiKey: process.env.geminitest,
    })

    const result = await generateObject({
      model: google("gemini-1.5-flash"),
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
              image: fileBase64,
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
