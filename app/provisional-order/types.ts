// Phase 1: Cropped Files
export type CropStatus = "cropping" | "cropped" | "completed"

export interface CroppedFile {
  id: string
  fileName: string
  status: CropStatus
  progress: number
  thumbnailUrl: string
  base64?: string
}

// Phase 2: Analysis Results
export type OrderItemStatus = "uploading" | "processing" | "completed" | "review"

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
  quantity: number
  thumbnailUrl: string
  needsReview: boolean
  confidence: number
  previewUrl?: string
}

// Phase 3: Order Header
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
