"use client"

import { Header } from "@/components/ui/header"
import { FileText } from "lucide-react"
import { useOrderProcessing } from "@/hooks/use-order-processing"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { orderFormSchema, type OrderFormData } from "./schema"
import { QuoteUploadPanel } from "./quote-upload-panel"
import { OrderForm } from "./order-form"

export default function QuoteToOrderPage() {
  const {
    selectedFile,
    previewUrl,
    isLoading,
    processingStatus,
    logs,
    isCopied,
    setIsCopied,
    handleFileChange,
    handleDragOver,
    handleDrop,
    handleRemoveFile,
    handleTranscription,
  } = useOrderProcessing()

  const form = useForm<OrderFormData>({
    resolver: zodResolver(orderFormSchema),
    defaultValues: {
      orderNo: "",
      quoteNo: "",
      items: [
        {
          productName: "",
          description: "",
          quantity: 0,
          unitPrice: 0,
          amount: 0,
        },
      ],
      desiredDeliveryDate: "",
      requestedDeliveryDate: "",
      paymentTerms: "",
      deliveryLocation: "",
      inspectionDeadline: "",
      recipientCompany: "",
      issuerCompany: "",
      issuerAddress: "",
      phone: "",
      fax: "",
      manager: "",
      approver: "",
    },
  })

  const { reset } = form

  const startTranscription = () =>
    handleTranscription((extracted) => {
      reset({
        orderNo: extracted.orderNo ?? "",
        quoteNo: extracted.quoteNo ?? "",
        recipientCompany: extracted.recipientCompany ?? "",
        issuerCompany: extracted.issuerCompany ?? "",
        issuerAddress: extracted.issuerAddress ?? "",
        manager: extracted.manager ?? "",
        approver: extracted.approver ?? "",
        desiredDeliveryDate: extracted.desiredDeliveryDate ?? "",
        requestedDeliveryDate: extracted.requestedDeliveryDate ?? "",
        paymentTerms: extracted.paymentTerms ?? "",
        deliveryLocation: extracted.deliveryLocation ?? "",
        inspectionDeadline: extracted.inspectionDeadline ?? "",
        phone: extracted.phone ?? "",
        fax: extracted.fax ?? "",
        items:
          extracted.items.length > 0
            ? extracted.items.map((item) => {
                const q = Number(item.quantity) || 0
                const p = Number(item.unitPrice) || 0
                return {
                  productName: item.productName,
                  description: item.description,
                  quantity: q,
                  unitPrice: p,
                  amount: q * p,
                }
              })
            : [
                {
                  productName: "",
                  description: "",
                  quantity: 0,
                  unitPrice: 0,
                  amount: 0,
                },
              ],
      })
    })

  return (
    <div className="flex min-h-screen flex-col bg-gradient-to-br from-slate-50 via-white to-blue-50/20 dark:from-slate-950 dark:via-slate-900 dark:to-slate-950">
      <Header
        transparent={false}
        showBackButton
        title={
          <div className="flex items-center gap-2">
            <FileText className="h-4 w-4 text-blue-600 dark:text-blue-400" />
            <span className="text-sm font-bold text-slate-700 dark:text-slate-300">本注文書作成</span>
          </div>
        }
      />

      <div className="flex-1 p-4 md:p-8">
        <div className="mx-auto max-w-[1600px]">
          <div className="flex flex-col gap-8 lg:flex-row lg:items-start">
            <div className="lg:sticky lg:top-24 lg:h-[calc(100vh-8rem)] lg:w-[45%] lg:overflow-y-auto no-scrollbar">
              <QuoteUploadPanel
                selectedFile={selectedFile}
                previewUrl={previewUrl}
                isLoading={isLoading}
                processingStatus={processingStatus}
                logs={logs}
                handleFileChange={handleFileChange}
                handleDragOver={handleDragOver}
                handleDrop={handleDrop}
                handleRemoveFile={handleRemoveFile}
                onStartTranscription={startTranscription}
              />
            </div>

            <OrderForm form={form} isCopied={isCopied} setIsCopied={setIsCopied} />
          </div>
        </div>
      </div>
    </div>
  )
}
