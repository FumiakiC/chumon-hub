import { GoogleGenAI } from '@google/genai'
import { z } from 'zod'

interface GenerateStructuredParams<S extends z.ZodType> {
  apiKey: string
  model: string
  schema: S
  prompt: string
  file: {
    fileUri: string
    mimeType: string
  }
}

export async function generateStructured<S extends z.ZodType>({
  apiKey,
  model,
  schema,
  prompt,
  file,
}: GenerateStructuredParams<S>): Promise<z.infer<S>> {
  const responseJsonSchema = z.toJSONSchema(schema)
  delete responseJsonSchema.$schema

  const ai = new GoogleGenAI({ apiKey })
  const response = await ai.models.generateContent({
    model,
    contents: [
      {
        role: 'user',
        parts: [
          { text: prompt },
          {
            fileData: {
              fileUri: file.fileUri,
              mimeType: file.mimeType,
            },
          },
        ],
      },
    ],
    config: {
      responseMimeType: 'application/json',
      responseJsonSchema,
    },
  })

  const { text } = response
  if (text === undefined || text === '') {
    throw new Error('Model returned no text response')
  }

  return schema.parse(JSON.parse(text))
}
