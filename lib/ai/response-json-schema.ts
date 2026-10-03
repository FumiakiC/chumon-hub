import { z } from 'zod'

export function toResponseJsonSchema(schema: z.ZodType) {
  const responseJsonSchema = z.toJSONSchema(schema)
  delete responseJsonSchema.$schema
  return responseJsonSchema
}
