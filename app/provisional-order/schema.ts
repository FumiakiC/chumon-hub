import * as z from "zod"

export type OrderItemStatus = "uploading" | "processing" | "completed" | "review"

export interface OrderItem {
  id: string
  fileName: string
  status: OrderItemStatus
  progress: number
  drawingNo: string
  partName: string
  material: string
  quantity: number
  surfaceTreatment?: string
  notes?: string
  thumbnailUrl: string
  needsReview: boolean
  confidence: number
}

export const verificationSchema = z.object({
  drawingNo: z.string().min(1, "図面番号は必須です"),
  partName: z.string().min(1, "品名は必須です"),
  material: z.string().min(1, "材質は必須です"),
  quantity: z.coerce.number().min(1, "数量は1以上で入力してください"),
  surfaceTreatment: z.string().optional(),
  notes: z.string().optional(),
})

export type VerificationFormData = z.infer<typeof verificationSchema>
