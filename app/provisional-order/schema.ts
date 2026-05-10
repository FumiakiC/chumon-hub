import * as z from "zod"

// ---------------------------------------------------------------------------
// Phase 1: Cropped Files
// ---------------------------------------------------------------------------

export type CropStatus = "cropping" | "cropped" | "completed"

export interface CroppedFile {
  id: string
  fileName: string
  status: CropStatus
  progress: number
  thumbnailUrl: string
  base64?: string
}

// ---------------------------------------------------------------------------
// Phase 2: Analysis Results
// ---------------------------------------------------------------------------

export type OrderItemStatus = "pending" | "cropping" | "analyzing" | "completed" | "needs_review" | "error"

export interface OrderItem {
  id: string
  fileName: string
  status: OrderItemStatus
  progress: number
  drawingNo: string
  partName: string
  material: string
  surfaceTreatment: string
  notes: string
  quantity: number | null
  thumbnailUrl: string
  needsReview: boolean
  confidence: number
  previewUrl?: string
}

// ---------------------------------------------------------------------------
// Phase 3: Order Header
// ---------------------------------------------------------------------------

export interface OrderHeader {
  recipientCompany: string
  orderNo: string
  quoteNo: string
  desiredDeliveryDate: string
  requestedDeliveryDate: string
  paymentTerms: string
  deliveryLocation: string
  inspectionDeadline: string
  issuerCompany: string
  issuerAddress: string
  phone: string
  fax: string
  manager: string
  approver: string
}

export const defaultOrderHeader: OrderHeader = {
  recipientCompany: "",
  orderNo: "",
  quoteNo: "",
  desiredDeliveryDate: "",
  requestedDeliveryDate: "",
  paymentTerms: "従来通り",
  deliveryLocation: "",
  inspectionDeadline: "納入時確認検査",
  issuerCompany: "",
  issuerAddress: "",
  phone: "",
  fax: "",
  manager: "",
  approver: "",
}

// ---------------------------------------------------------------------------
// Verification (zod schema)
// ---------------------------------------------------------------------------

export const verificationSchema = z.object({
  drawingNo: z
    .string()
    .min(1, "図面番号は必須です")
    .regex(
      /^[A-Za-z0-9]+-\d{3}$/,
      "図面番号の形式が正しくありません（例: 120925-101。末尾の用紙サイズが含まれていないか確認してください）",
    ),
  partName: z.string().min(1, "品名は必須です"),
  material: z.string().min(1, "材質は必須です"),
  quantity: z.union([
    z.number().min(1, "数量は1以上で入力してください"),
    z.literal("").refine(() => false, { message: "数量を入力してください" }),
  ]),
  surfaceTreatment: z.string().optional(),
  notes: z.string().optional(),
})

export type VerificationFormInput = z.input<typeof verificationSchema>
export type VerificationFormData = z.infer<typeof verificationSchema>
