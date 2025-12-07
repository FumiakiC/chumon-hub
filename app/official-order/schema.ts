import { z } from "zod"

export const productItemSchema = z.object({
  productName: z.string().default(""),
  description: z.string().default(""),
  quantity: z.number().default(0),
  unitPrice: z.number().default(0),
  amount: z.number().default(0),
})

export const orderFormSchema = z.object({
  orderNo: z.string().default(""),
  quoteNo: z.string().default(""),
  items: z.array(productItemSchema).min(1),
  desiredDeliveryDate: z.string().default(""),
  requestedDeliveryDate: z.string().default(""),
  paymentTerms: z.string().default(""),
  deliveryLocation: z.string().default(""),
  inspectionDeadline: z.string().default(""),
  recipientCompany: z.string().default(""),
  issuerCompany: z.string().default(""),
  issuerAddress: z.string().default(""),
  phone: z.string().default(""),
  fax: z.string().default(""),
  manager: z.string().default(""),
  approver: z.string().default(""),
})

export type OrderFormData = z.infer<typeof orderFormSchema>
