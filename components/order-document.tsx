"use client"

interface OrderFormData {
  orderNo: string
  quoteNo: string
  productName: string
  description: string
  quantity: string
  unitPrice: string
  amount: string
  totalAmount: string
  desiredDeliveryDate: string
  requestedDeliveryDate: string
  paymentTerms: string
  deliveryLocation: string
  inspectionDeadline: string
  recipientCompany: string
  issuerCompany: string
  issuerAddress: string
  phone: string
  fax: string
  manager: string
  approver: string
}

interface OrderDocumentProps {
  data: OrderFormData
  type: "order" | "acceptance"
}

export function OrderDocument({ data, type }: OrderDocumentProps) {
  const isOrder = type === "order"

  return (
    <div className="print-document bg-white p-8 text-black">
      {/* Header Section */}
      <div className="mb-6 flex items-start justify-between">
        <div className="flex-1">
          <div className="mb-4 text-sm">
            <div className="mb-1">注 No</div>
            <div className="font-bold">{data.orderNo || "　"}</div>
          </div>
        </div>
        <div className="text-center">
          <h1 className="mb-2 text-2xl font-bold">{isOrder ? "注 文 書" : "注 文 請 書"}</h1>
        </div>
        <div className="flex-1"></div>
      </div>

      {/* Recipient */}
      <div className="mb-8">
        <div className="mb-2 flex items-baseline gap-2">
          <span className="text-lg font-bold">{data.recipientCompany || "　"}</span>
          <span className="text-base">殿</span>
        </div>
      </div>

      {/* Quote Reference */}
      <div className="mb-4 text-sm">
        <span>貴見積書 No. </span>
        <span className="ml-2 font-mono">{data.quoteNo || "　"}</span>
      </div>

      {/* Main Table */}
      <div className="mb-6">
        <table className="w-full border-collapse border border-black text-sm">
          <thead>
            <tr>
              <th className="border border-black bg-gray-100 p-2 text-center font-bold">品 名</th>
              <th className="border border-black bg-gray-100 p-2 text-center font-bold">摘 要</th>
              <th className="border border-black bg-gray-100 p-2 text-center font-bold">数 量</th>
              <th className="border border-black bg-gray-100 p-2 text-center font-bold">単 価</th>
              <th className="border border-black bg-gray-100 p-2 text-center font-bold">金 額</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="border border-black p-2">{data.productName || "　"}</td>
              <td className="border border-black p-2">{data.description || "　"}</td>
              <td className="border border-black p-2 text-center font-mono">{data.quantity || "　"}</td>
              <td className="border border-black p-2 text-right font-mono">{data.unitPrice || "　"}</td>
              <td className="border border-black p-2 text-right font-mono">{data.amount || "　"}</td>
            </tr>
            {/* Empty rows for spacing */}
            <tr className="h-12">
              <td className="border border-black p-2">&nbsp;</td>
              <td className="border border-black p-2">&nbsp;</td>
              <td className="border border-black p-2">&nbsp;</td>
              <td className="border border-black p-2">&nbsp;</td>
              <td className="border border-black p-2">&nbsp;</td>
            </tr>
            <tr className="h-12">
              <td className="border border-black p-2">&nbsp;</td>
              <td className="border border-black p-2">&nbsp;</td>
              <td className="border border-black p-2">&nbsp;</td>
              <td className="border border-black p-2">&nbsp;</td>
              <td className="border border-black p-2">&nbsp;</td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Total Section */}
      <div className="mb-8 flex justify-end">
        <div className="w-64">
          <div className="flex items-center justify-between border-b border-black py-2">
            <span className="font-bold">合計（税抜）</span>
            <span className="font-mono text-lg font-bold">{data.totalAmount || "　"}</span>
          </div>
        </div>
      </div>

      {/* Confirmation Text */}
      <div className="mb-6 text-sm">
        {isOrder ? <p>上記の通り注文致します</p> : <p>上記の通り注文お請け致します</p>}
      </div>

      {/* Terms and Conditions Grid */}
      <div className="mb-8 grid grid-cols-2 gap-x-8 gap-y-3 text-sm">
        <div>
          <span className="font-bold">希望納期: </span>
          <span>{data.desiredDeliveryDate || "　"}</span>
        </div>
        <div>
          <span className="font-bold">請納期: </span>
          <span>{data.requestedDeliveryDate || "（空欄）"}</span>
        </div>
        <div>
          <span className="font-bold">支払条件: </span>
          <span>{data.paymentTerms || "　"}</span>
        </div>
        <div>
          <span className="font-bold">受渡場所: </span>
          <span>{data.deliveryLocation || "　"}</span>
        </div>
        <div className="col-span-2">
          <span className="font-bold">検査完了期日: </span>
          <span>{data.inspectionDeadline || "　"}</span>
        </div>
      </div>

      {/* Footer - Company Info */}
      <div className="mt-12 flex justify-between border-t-2 border-black pt-6">
        <div className="flex-1">
          <div className="mb-2 text-base font-bold">{data.issuerCompany || "　"}</div>
          <div className="mb-1 text-sm">{data.issuerAddress || "　"}</div>
          <div className="mb-1 text-sm">
            <span className="font-bold">電話: </span>
            <span className="font-mono">{data.phone || "　"}</span>
          </div>
          <div className="mb-1 text-sm">
            <span className="font-bold">FAX: </span>
            <span className="font-mono">{data.fax || "　"}</span>
          </div>
        </div>

        <div className="flex gap-8 text-sm">
          <div>
            <div className="mb-2 font-bold">担当</div>
            <div className="text-center">{data.manager || "　"}</div>
          </div>
          <div>
            <div className="mb-2 font-bold">承認</div>
            <div className="text-center">{data.approver || "（空欄）"}</div>
          </div>
        </div>
      </div>

      {/* Notes Section */}
      <div className="mt-8 text-xs text-gray-600">
        <p>消費税等額分を加算した額を支払います</p>
        {isOrder && <p className="mt-1">（納品書・請求書に注No.を御記載下さい）</p>}
      </div>

      {/* Bottom margin for spacing */}
      <div className="mt-8 text-center text-sm text-gray-500">以下余白</div>
    </div>
  )
}
