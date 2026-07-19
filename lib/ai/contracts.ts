import type { z } from 'zod'

import type {
  checkDocumentTypeResponseSchema,
  documentTypeSchema,
  drawingSchema,
  orderSchema,
} from '@/lib/ai/schemas'

export type DocumentTypeResult = z.infer<typeof documentTypeSchema>
export type OrderExtractionResult = z.infer<typeof orderSchema>
export type DrawingExtractionResult = z.infer<typeof drawingSchema>
export type OrderLineItem = OrderExtractionResult['items'][number]

export type CheckDocumentTypeResponse = z.infer<
  typeof checkDocumentTypeResponseSchema
>

export type CropTitleBlockResponse = {
  croppedFiles: {
    fileName: string
    base64: string
  }[]
}
