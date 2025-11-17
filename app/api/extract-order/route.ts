import { GoogleGenerativeAI } from "@google/generative-ai"





export async function POST(req: Request) {
  try {
    const { file } = await req.json()
    if (!file || !file.data) {
      return Response.json({ error: "ファイルデータが必要です" }, { status: 400 })
    }

    const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY!)
    
    // gemini-pro-vision を使用（PDF Vision対応）
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" })

    async function safeGenerate(model, payload, retries = 5) {
      for (let i = 0; i < retries; i++) {
        try {
          return await model.generateContent(payload)
        } catch (error) {
          if ((error as any)?.status === 503 && i < retries - 1) {
            const waitTime = 5000 * (i + 1) // 5秒、10秒、15秒...指数バックオフ
            console.log(`[v0] 503 Error: Retry ${i + 1}/${retries} after ${waitTime}ms`)
            await new Promise(res => setTimeout(res, waitTime))
            continue
          }
          throw error
        }
      }
    }

    const result = await safeGenerate(model, [
      { text: "このPDFからテキストを抽出してください。" },
      { inlineData: { data: file.data, mimeType: file.mediaType || "application/pdf" } }
    ])

    const text = result?.response?.candidates?.[0]?.content?.parts?.[0]?.text ?? ""
    return Response.json({ extractedText: text })
  } catch (error) {
    console.error("[v0] Gemini API error:", error)
    return Response.json({ error: "データの抽出に失敗しました" }, { status: 500 })
  }
}
