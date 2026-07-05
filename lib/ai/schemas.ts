import { z } from 'zod'

export const documentTypeSchema = z.object({
  isQuotation: z
    .boolean()
    .describe(
      'Whether the document is a quotation, estimate, or purchase order form'
    ),
  documentType: z
    .string()
    .describe(
      'The specific type of the document (e.g., Quotation, Invoice, Receipt, Other)'
    ),
  reason: z
    .string()
    .describe('Short reason for the classification in Japanese'),
})

export const orderSchema = z.object({
  items: z
    .array(
      z.object({
        productName: z.string().describe('Product Name (品名)'),
        quantity: z.coerce.number().describe('Quantity (数量)'),
        unitPrice: z.coerce
          .number()
          .describe(
            'Unit Price (単価) - numeric value without comma or currency symbol'
          ),
        amount: z.coerce
          .number()
          .describe(
            'Amount/Subtotal (金額) - numeric value without comma or currency symbol'
          ),
        description: z
          .string()
          .optional()
          .describe('Description or remarks (摘要)'),
      })
    )
    .describe('Line items array (明細行の配列)'),
  orderNo: z
    .string()
    .describe(
      "Order Number (注番) - Extract the ID strictly matching the format: 'S' + YYMMDD (date) + '-' + SerialNumber (e.g., S251106-008). It is usually found in '件名' or 'No.'. Ignore any other IDs like 'MGG...'."
    ),
  quoteNo: z.string().describe('Quotation Number (見積No)'),
  totalAmount: z.string().describe('Total Amount (合計金額)'),
  requestedDeliveryDate: z
    .string()
    .describe(
      "Requested/Confirmed Delivery Date (請納期/納入期日) - Extract '納入期日' or '納期' here. Format as YYYYMMDD (e.g., 20251114). Do NOT use slashes or other separators."
    ),
  paymentTerms: z.string().describe('Payment Terms (支払条件)'),
  deliveryLocation: z
    .string()
    .describe(
      "Delivery Location (受渡場所) - Do NOT infer from the recipient's address or company name. If '受渡場所' is not explicitly labeled, return an empty string."
    ),
  inspectionDeadline: z.string().describe('Inspection Deadline (検査完了期日)'),
  recipientCompany: z
    .string()
    .describe(
      'Order Recipient / Vendor Name (発注先/見積発行元) - The company that issued this quotation (e.g. 株式会社 山口製作所)'
    ),
})

export const drawingSchema = z.object({
  reasoning: z
    .string()
    .describe(
      '抽出の思考プロセス。まず図面全体（特に右下の表題欄）を確認し、「数量の特定（粗さ記号の上の数字、四角囲み数字の除外）」「材質・表面処理の有無」について、どのように判断したかステップバイステップで言語化してください。'
    ),
  drawingNo: z.string().describe('Drawing Number (図面番号)'),
  partName: z.string().describe('Part/Item Name (品名・部品名)'),
  material: z
    .string()
    .describe(
      'Material (材質) ※明確な記載（SS400、SUS、SOBなど）のみ抽出すること。記載がない場合は必ず空文字("")にすること。人名や日付を誤って入れないこと。'
    ),
  quantity: z
    .number()
    .nullable()
    .describe(
      '数量。『数量』や『QTY』という項目名はありません。『粗さ記号（粗サ、▽など）』のすぐ上部に単独で記載されている数字が数量です。それを見つけて数値として抽出してください。図面番号の横などにある四角で囲まれた数字（用紙サイズ等の記号）は絶対に数量として抽出しないこと。見つからない場合は null を出力してください。'
    ),
  surfaceTreatment: z
    .string()
    .optional()
    .describe(
      'Surface Treatment (表面処理) ※明確な記載（めっき、塗装、アルマイト、無電解ニッケル、四三酸化鉄皮膜など）のみ抽出すること。記載がない場合は必ず空文字("")にすること。人名や日付を誤って入れないこと。'
    ),
  notes: z.string().optional().describe('Notes/Remarks (備考)'),
  confidence: z.coerce.number().describe('Confidence level (0-100)'),
})
