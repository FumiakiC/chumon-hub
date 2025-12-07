"use client"

import type React from "react"
import type { LogEntry } from "@/types/logEntry" // Import LogEntry type

import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Upload, FileText, FileImage, X, Trash2, Plus, Copy, Check, CalendarIcon } from "lucide-react"
import { useState, useRef, useEffect } from "react"
import { ProcessingStepper } from "@/components/processing-stepper/processing-stepper"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Calendar } from "@/components/ui/calendar"
import { format, parse, isValid } from "date-fns"
import { ja } from "date-fns/locale"
import { cn } from "@/lib/utils"
import { z } from "zod"
import { Switch } from "@/components/ui/switch"
import { Label } from "@/components/ui/label"

// APIレスポンスの各アイテムの検証スキーマ
const ExtractedItemSchema = z.object({
  productName: z.string(),
  quantity: z.number(),
  unitPrice: z.number(),
  amount: z.number(),
  description: z.string().optional(),
})

// スキーマから型を自動生成
type ExtractedItem = z.infer<typeof ExtractedItemSchema>

// 配列用のスキーマ
const ExtractedItemsSchema = z.array(ExtractedItemSchema)

// ユーティリティ関数: カンマや全角数字を正しく処理して数値に変換
const safeParseFloat = (value: string): number => {
  // カンマをすべて削除
  let cleaned = value.replace(/,/g, "")
  
  // 全角数字（０-９）を半角数字に変換
  cleaned = cleaned.replace(/[０-９]/g, (char) => {
    return String.fromCharCode(char.charCodeAt(0) - 0xFEE0)
  })
  
  // Number.parseFloatで変換
  const parsed = Number.parseFloat(cleaned)
  
  // NaNの場合は0を返す
  return isNaN(parsed) ? 0 : parsed
}

interface ProductItem {
  id: string
  productName: string
  description: string
  quantity: string
  unitPrice: string
  amount: string
}

interface OrderFormData {
  orderNo: string
  quoteNo: string
  items: ProductItem[]
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

type ProcessingStatus = "idle" | "uploading" | "flash_check" | "pro_extraction" | "complete" | "error"

export default function QuoteToOrderPage() {
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [processingStatus, setProcessingStatus] = useState<ProcessingStatus>("idle")
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [extractedJson, setExtractedJson] = useState<Record<string, string> | null>(null)
  const [isCopied, setIsCopied] = useState(false)
  const [isItemsEditing, setIsItemsEditing] = useState(false)

  const [formData, setFormData] = useState<OrderFormData>({
    orderNo: "",
    quoteNo: "",
    items: [
      {
        id: crypto.randomUUID(),
        productName: "",
        description: "",
        quantity: "",
        unitPrice: "",
        amount: "",
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
  })

  const handleFormChange = (field: keyof OrderFormData, value: string) => {
    setFormData((prev) => ({ ...prev, [field]: value }))
  }

  const handleItemChange = (id: string, field: keyof ProductItem, value: string) => {
    setFormData((prev) => ({
      ...prev,
      items: prev.items.map((item) => {
        if (item.id === id) {
          const updatedItem = { ...item, [field]: value }

          if (field === "quantity" || field === "unitPrice") {
            const qty = safeParseFloat(field === "quantity" ? value : updatedItem.quantity)
            const price = safeParseFloat(field === "unitPrice" ? value : updatedItem.unitPrice)
            updatedItem.amount = (qty * price).toString()
          }

          return updatedItem
        }
        return item
      }),
    }))
  }

  const addItem = () => {
    setFormData((prev) => ({
      ...prev,
      items: [
        ...prev.items,
        {
          id: crypto.randomUUID(),
          productName: "",
          description: "",
          quantity: "",
          unitPrice: "",
          amount: "",
        },
      ],
    }))
  }

  const removeItem = (id: string) => {
    setFormData((prev) => ({
      ...prev,
      items: prev.items.filter((item) => item.id !== id),
    }))
  }

  const calculateTotal = () => {
    const total = formData.items.reduce((sum, item) => {
      return sum + safeParseFloat(item.amount)
    }, 0)
    return total.toLocaleString("ja-JP")
  }

  // Object URLのライフサイクル管理（自動生成・破棄）
  useEffect(() => {
    if (!selectedFile) {
      // ファイルなしの場合：previewUrlをクリア
      setPreviewUrl(null)
      return
    }

    // 新しいObject URLを生成
    const objectUrl = URL.createObjectURL(selectedFile)
    setPreviewUrl(objectUrl)

    // クリーンアップ：コンポーネントアンマウント時やSelectedFileが変更されたときに実行
    return () => {
      URL.revokeObjectURL(objectUrl)
    }
  }, [selectedFile])

  const processFile = (file: File) => {
    if (!file) return

    setSelectedFile(file)
    setError(null)
    setLogs([])
    setProcessingStatus("idle")
    setExtractedJson(null)
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    processFile(file)
  }

  const handleDragOver = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault()
  }

  const handleDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    const file = event.dataTransfer.files[0]
    if (!file) return
    processFile(file)
  }

  const handleRemoveFile = () => {
    setSelectedFile(null)
    setError(null)
    setProcessingStatus("idle")
    setLogs([])
    if (fileInputRef.current) fileInputRef.current.value = ""
  }

  const addLog = (message: string, type: "info" | "success" | "error" = "info") => {
    const now = new Date()
    const timeString = now.toLocaleTimeString("ja-JP", {
      hour12: false,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })
    setLogs((prev) => [...prev, { timestamp: timeString, message, type }])
  }

  const handleTranscription = async () => {
    if (!selectedFile) {
      setError("ファイルを選択してください")
      return
    }

    setIsLoading(true)
    setError(null)
    setLogs([])

    setProcessingStatus("uploading")
    addLog("ファイルアップロードを開始...", "info")

    try {
      const formData = new FormData()
      formData.append("file", selectedFile)
      formData.append("mimeType", selectedFile.type)

      await new Promise((r) => setTimeout(r, 800))
      addLog(`アップロード完了。書類タイプの判定を開始します。`, "success")

      setProcessingStatus("flash_check")
      addLog("Gemini 2.5 Flash-lite で書類タイプを判定中...", "info")

      const checkResponse = await fetch("/api/check-document-type", {
        method: "POST",
        body: formData,
      })

      if (!checkResponse.ok) throw new Error("判定APIエラー")
      const checkResult = await checkResponse.json()

      if (!checkResult.isQuotation) {
        addLog(`判定結果: ❌ 見積書・発注書ではありません (${checkResult.documentType})。処理を中断します。`, "error")
        addLog(`理由: ${checkResult.reason}`, "error")
        setProcessingStatus("error")
        setIsLoading(false)
        return
      }

      addLog(`判定結果: ✅ ${checkResult.documentType}と認定。Step 2へ進みます。`, "success")

      setProcessingStatus("pro_extraction")
      addLog("Gemini 2.5 Flash で詳細データを抽出中...", "info")

      const response = await fetch("/api/extract-order", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          fileId: checkResult.fileId, // Use cached file
        }),
      })

      if (!response.ok) {
        throw new Error("APIリクエストが失敗しました")
      }

      const result = await response.json()

      if (result.error) {
        throw new Error(result.error)
      }

      // Store the raw JSON response for copy functionality
      setExtractedJson(result)

      // APIレスポンスから直接 items を取得
      const extracted = result

      // Zodスキーマでランタイム検証
      const parseResult = ExtractedItemsSchema.safeParse(extracted.items ?? [])

      if (!parseResult.success) {
        console.error("[v0] Validation failed:", parseResult.error)
        throw new Error("データの形式が不正です")
      }

      const items = parseResult.data // 型は ExtractedItem[] として保証される

      const mappedItems: ProductItem[] = items.map((item) => ({
        id: crypto.randomUUID(),
        productName: item.productName ?? "",
        description: item.description ?? "",
        quantity: (item.quantity ?? 0).toString(),
        unitPrice: (item.unitPrice ?? 0).toString(),
        amount: (item.amount ?? 0).toString(),
      }))

      // merge into existing formData to avoid replacing structure
      setFormData((prev) => ({
        ...prev,
        orderNo: extracted.orderNo ?? prev.orderNo,
        quoteNo: extracted.quoteNo ?? prev.quoteNo,
        recipientCompany: extracted.recipientCompany ?? prev.recipientCompany,
        issuerCompany: extracted.issuerCompany ?? prev.issuerCompany,
        issuerAddress: extracted.issuerAddress ?? prev.issuerAddress,
        manager: extracted.manager ?? prev.manager,
        approver: extracted.approver ?? prev.approver,
        desiredDeliveryDate: extracted.desiredDeliveryDate ?? prev.desiredDeliveryDate,
        requestedDeliveryDate: extracted.requestedDeliveryDate ?? prev.requestedDeliveryDate,
        paymentTerms: extracted.paymentTerms ?? prev.paymentTerms,
        deliveryLocation: extracted.deliveryLocation ?? prev.deliveryLocation,
        inspectionDeadline: extracted.inspectionDeadline ?? prev.inspectionDeadline,
        phone: extracted.phone ?? prev.phone,
        fax: extracted.fax ?? prev.fax,
        items: mappedItems.length > 0 ? mappedItems : prev.items,
      }))

      setProcessingStatus("complete")
      addLog("データ抽出完了。JSONパース成功。", "success")
    } catch (err) {
      console.error("[v0] Extraction error:", err)
      setProcessingStatus("error")
      addLog("エラーが発生しました", "error")
      setError(err instanceof Error ? err.message : "データの抽出に失敗しました")
    } finally {
      setIsLoading(false)
    }
  }

  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleUploadClick = () => {
    fileInputRef.current?.click()
  }

  return (
    <div className="flex min-h-screen flex-col bg-gradient-to-br from-slate-50 via-white to-blue-50/20 dark:from-slate-950 dark:via-slate-900 dark:to-slate-950">
      <div className="flex-1 p-4 md:p-8">
        <div className="mx-auto max-w-[1600px]">
          <div className="mb-8 text-center">
            <h1 className="text-3xl font-bold text-slate-800 dark:text-slate-100 md:text-4xl">
              Gemini API Test Web App
            </h1>
            <p className="mt-2 text-slate-500 dark:text-slate-400">
              アップロードされた見積書を自動解析し、発注データを作成するWebアプリケーションです
            </p>
          </div>

          <div className="flex flex-col gap-8 lg:flex-row lg:items-start">
            <div className="lg:sticky lg:top-8 lg:h-[calc(100vh-4rem)] lg:w-[45%] lg:overflow-y-auto no-scrollbar">
              <div className="space-y-6">
                <Card className="elevation-2 border-0 bg-white p-6 dark:bg-slate-900">
                  <div className="mb-6 flex items-center gap-3">
                    <FileText className="h-6 w-6 text-slate-600 dark:text-slate-400" />
                    <h2 className="text-xl font-bold text-slate-800 dark:text-slate-100">見積書アップロード</h2>
                  </div>

                  {!selectedFile ? (
                    <div
                      onDragOver={handleDragOver}
                      onDrop={handleDrop}
                      onClick={handleUploadClick}
                      className="group relative flex min-h-[240px] cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-slate-200 bg-slate-50/50 transition-all duration-300 hover:border-blue-400 hover:bg-blue-50/30 dark:border-slate-700 dark:bg-slate-800/50"
                    >
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/*,.pdf"
                        onChange={handleFileChange}
                        className="hidden"
                        id="file-upload"
                      />
                      <div className="mb-4 rounded-full bg-blue-100 p-4 text-blue-500 transition-transform duration-300 group-hover:-translate-y-1 group-hover:scale-110 dark:bg-blue-900/30 dark:text-blue-400">
                        <Upload className="h-10 w-10" />
                      </div>
                      <p className="text-lg font-semibold text-slate-700 dark:text-slate-200">
                        クリックまたはドラッグ＆ドロップでPDFを選択
                      </p>
                      <p className="mt-2 text-sm text-slate-400 dark:text-slate-500">
                        見積書や注文書をアップロードすると成功します
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      <div className="flex items-center gap-3 rounded-lg border border-blue-100 bg-blue-50 p-4 text-blue-700 dark:border-blue-900/50 dark:bg-blue-900/20 dark:text-blue-300">
                        <FileText className="h-5 w-5" />
                        <span className="flex-1 font-medium truncate">{selectedFile.name}</span>
                        <Button
                          onClick={handleRemoveFile}
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-blue-700 hover:bg-blue-200/50 dark:text-blue-300 dark:hover:bg-blue-800/50"
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </div>

                      {processingStatus === "idle" && (
                        <Button
                          onClick={handleTranscription}
                          className="w-full bg-blue-600 text-white hover:bg-blue-700 dark:bg-blue-600 dark:hover:bg-blue-500"
                        >
                          読み取り開始
                        </Button>
                      )}
                    </div>
                  )}

                  {(logs.length > 0 || processingStatus !== "idle") && (
                    <div className="mt-6 overflow-hidden rounded-xl bg-slate-950 p-6 font-mono text-sm text-slate-300 shadow-inner">
                      <div className="flex flex-col gap-2">
                        {logs.map((log, index) => (
                          <div key={index} className="flex gap-3">
                            <span className="shrink-0 text-slate-500">[{log.timestamp}]</span>
                            <span
                              className={
                                log.type === "success"
                                  ? "text-emerald-400"
                                  : log.type === "error"
                                    ? "text-red-400"
                                    : "text-slate-200"
                              }
                            >
                              {log.message}
                            </span>
                          </div>
                        ))}
                        {isLoading && (
                          <div className="mt-2 flex items-center gap-2 text-blue-400 animate-pulse">
                            <span className="h-2 w-2 rounded-full bg-blue-400" />
                            <span>Processing...</span>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {(logs.length > 0 || processingStatus !== "idle") && (
                    <ProcessingStepper status={processingStatus} logs={logs} />
                  )}
                </Card>

                {previewUrl && selectedFile && (
                  <Card className="elevation-2 overflow-hidden border-0 bg-white p-4 dark:bg-slate-900">
                    <div className="mb-4 flex items-center gap-2">
                      <FileImage className="h-5 w-5 text-slate-500" />
                      <h3 className="font-semibold text-slate-700 dark:text-slate-200">プレビュー</h3>
                    </div>
                    <div className="overflow-hidden rounded-lg border border-slate-200 bg-slate-100 dark:border-slate-800 dark:bg-slate-950">
                      {selectedFile.type === "application/pdf" ? (
                        <iframe src={previewUrl} className="h-[800px] w-full" title="PDF Preview" />
                      ) : (
                        <img
                          src={previewUrl || "/placeholder.svg"}
                          alt="アップロードされた見積書"
                          className="h-auto w-full object-contain"
                        />
                      )}
                    </div>
                  </Card>
                )}
              </div>
            </div>

            <div className="flex-1 space-y-6 lg:min-w-[50%]">
              <Card className="elevation-2 border-0 bg-white p-8 dark:bg-slate-900">
                <div className="mb-6 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="rounded-full bg-secondary/10 p-2">
                      <FileText className="h-5 w-5 text-secondary" />
                    </div>
                    <h2 className="text-xl font-bold text-foreground">発注フォーム（抽出結果）</h2>
                  </div>
                  <Button
                    onClick={() => {
                      if (!navigator.clipboard) {
                        console.error("[v0] Clipboard API not available.")
                        return
                      }
                      const jsonString = JSON.stringify(formData, null, 2)
                      navigator.clipboard
                        .writeText(jsonString)
                        .then(() => {
                          console.log("[v0] formData copied to clipboard")
                          setIsCopied(true)
                          setTimeout(() => setIsCopied(false), 2000)
                        })
                        .catch((err) => {
                          console.error("[v0] Failed to copy:", err)
                        })
                    }}
                    variant="outline"
                    size="sm"
                    className="gap-2"
                    disabled={!formData.orderNo && !formData.items.some((item) => item.productName)}
                  >
                    {isCopied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                    {isCopied ? "コピーしました" : "コピー"}
                  </Button>
                </div>

                <div className="space-y-6">
                  <Card className="elevation-1 border-0 bg-gradient-to-br from-primary/5 to-transparent p-5">
                    <h3 className="mb-4 flex items-center gap-2 font-semibold text-primary">
                      <div className="h-1 w-1 rounded-full bg-primary" />
                      基本情報
                    </h3>

                    <div className="grid gap-4 sm:grid-cols-2">
                      <div>
                        <label className="mb-2 block text-sm font-medium text-muted-foreground">注 No</label>
                        <Input
                          value={formData.orderNo}
                          onChange={(e) => handleFormChange("orderNo", e.target.value)}
                          className="elevation-1 border-0 bg-background font-mono"
                        />
                      </div>
                      <div>
                        <label className="mb-2 block text-sm font-medium text-muted-foreground">見積書 No.</label>
                        <Input
                          value={formData.quoteNo}
                          onChange={(e) => handleFormChange("quoteNo", e.target.value)}
                          className="elevation-1 border-0 bg-background font-mono"
                        />
                      </div>
                    </div>

                    <div className="mt-4 grid gap-4 sm:grid-cols-2">
                      <div>
                        <label className="mb-2 block text-sm font-medium text-muted-foreground">
                          宛先（相手企業名）
                        </label>
                        <Input
                          value={formData.recipientCompany}
                          onChange={(e) => handleFormChange("recipientCompany", e.target.value)}
                          className="elevation-1 border-0 bg-background"
                        />
                      </div>
                      <div>
                        <label className="mb-2 block text-sm font-medium text-muted-foreground">発注元（自社名）</label>
                        <Input
                          value={formData.issuerCompany}
                          onChange={(e) => handleFormChange("issuerCompany", e.target.value)}
                          className="elevation-1 border-0 bg-background"
                        />
                      </div>
                    </div>
                  </Card>

                  <Card className="elevation-1 border-0 bg-gradient-to-br from-secondary/5 to-transparent p-5">
                    <div className="mb-4 flex items-center justify-between">
                      <h3 className="flex items-center gap-2 font-semibold text-secondary">
                        <div className="h-1 w-1 rounded-full bg-secondary" />
                        品目一覧
                      </h3>
                      <div className="flex items-center gap-4">
                        <div className="flex items-center gap-2">
                          <Switch id="items-edit-mode" checked={isItemsEditing} onCheckedChange={setIsItemsEditing} />
                          <Label
                            htmlFor="items-edit-mode"
                            className="text-sm text-muted-foreground cursor-pointer w-24 text-left inline-block"
                          >
                            {isItemsEditing ? "編集モード" : "ロック中"}
                          </Label>
                        </div>
                        <Button
                          onClick={addItem}
                          size="sm"
                          disabled={!isItemsEditing}
                          className="bg-slate-600 text-accent-foreground hover:bg-slate-600/90"
                        >
                          <Plus className="h-4 w-4 mr-1" />
                          品目を追加
                        </Button>
                      </div>
                    </div>

                    <p className="mb-4 text-sm text-muted-foreground">
                      {isItemsEditing ? "品目を追加、編集、削除できます" : "編集するにはトグルをONにしてください"}
                    </p>

                    <div className="space-y-4">
                      {(formData.items ?? []).map((item, index) => (
                        <Card key={item.id} className="elevation-1 border border-border/50 bg-background p-4">
                          <div className="mb-3 flex items-center justify-between">
                            <span className="text-sm font-semibold text-muted-foreground">No. {index + 1}</span>
                            {isItemsEditing && formData.items.length > 1 && (
                              <Button
                                onClick={() => removeItem(item.id)}
                                variant="ghost"
                                size="sm"
                                className="h-8 text-destructive hover:bg-destructive/10 hover:text-destructive"
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            )}
                          </div>

                          <div className="space-y-3">
                            <div className="grid gap-3 sm:grid-cols-4">
                              <div>
                                <label className="mb-1.5 block text-sm font-medium text-muted-foreground">品目名</label>
                                <Input
                                  value={item.productName}
                                  onChange={(e) => handleItemChange(item.id, "productName", e.target.value)}
                                  placeholder="品目名を入力"
                                  className="elevation-1 border-0 bg-muted/30"
                                  disabled={!isItemsEditing}
                                />
                              </div>
                              <div>
                                <label className="mb-1.5 block text-sm font-medium text-muted-foreground">単価</label>
                                <Input
                                  type="number"
                                  value={item.unitPrice}
                                  onChange={(e) => handleItemChange(item.id, "unitPrice", e.target.value)}
                                  placeholder="0"
                                  className="elevation-1 border-0 bg-muted/30 font-mono"
                                  disabled={!isItemsEditing}
                                />
                              </div>
                              <div>
                                <label className="mb-1.5 block text-sm font-medium text-muted-foreground">数量</label>
                                <Input
                                  type="number"
                                  value={item.quantity}
                                  onChange={(e) => handleItemChange(item.id, "quantity", e.target.value)}
                                  placeholder="1"
                                  className="elevation-1 border-0 bg-muted/30"
                                  disabled={!isItemsEditing}
                                />
                              </div>
                              <div>
                                <label className="mb-1.5 block text-sm font-medium text-muted-foreground">小計</label>
                                <div className="flex h-10 items-center rounded-md bg-muted/50 px-3 font-mono text-sm font-semibold">
                                  ¥{(Number.parseFloat(item.amount) || 0).toLocaleString("ja-JP")}
                                </div>
                              </div>
                            </div>

                            <div>
                              <label className="mb-1.5 block text-sm font-medium text-muted-foreground">摘要</label>
                              <Textarea
                                value={item.description}
                                onChange={(e) => handleItemChange(item.id, "description", e.target.value)}
                                className="elevation-1 border-0 bg-muted/30"
                                rows={2}
                                disabled={!isItemsEditing}
                              />
                            </div>
                          </div>
                        </Card>
                      ))}
                    </div>

                    <div className="elevation-2 rounded-lg p-4 bg-slate-600">
                      <div className="flex items-center justify-between">
                        <label className="text-sm font-semibold text-accent-foreground">合計金額（税抜き）：</label>
                        <div className="text-2xl font-bold text-accent-foreground">¥{calculateTotal()}</div>
                      </div>
                    </div>
                  </Card>

                  <Card className="elevation-1 border-0 bg-gradient-to-br from-accent/5 to-transparent p-5">
                    <h3 className="mb-4 flex items-center gap-2 font-semibold text-primary">
                      <div className="h-1 w-1 rounded-full bg-primary" />
                      納期・条件
                    </h3>

                    <div className="space-y-4">
                      <div className="grid gap-4 sm:grid-cols-2">
                        <div>
                          <label className="mb-2 block text-sm font-medium text-muted-foreground">希望納期</label>
                          <Popover>
                            <PopoverTrigger asChild>
                              <Button
                                variant="outline"
                                className={cn(
                                  "w-full justify-start text-left font-normal elevation-1 border-0 bg-background",
                                  !formData.desiredDeliveryDate && "text-muted-foreground",
                                )}
                              >
                                <CalendarIcon className="mr-2 h-4 w-4" />
                                {formData.desiredDeliveryDate &&
                                isValid(parse(formData.desiredDeliveryDate, "yyyyMMdd", new Date()))
                                  ? format(
                                      parse(formData.desiredDeliveryDate, "yyyyMMdd", new Date()),
                                      "yyyy年MM月dd日",
                                      { locale: ja },
                                    )
                                  : "日付を選択"}
                              </Button>
                            </PopoverTrigger>
                            <PopoverContent className="w-auto p-0" align="start">
                              <Calendar
                                mode="single"
                                selected={
                                  formData.desiredDeliveryDate &&
                                  isValid(parse(formData.desiredDeliveryDate, "yyyyMMdd", new Date()))
                                    ? parse(formData.desiredDeliveryDate, "yyyyMMdd", new Date())
                                    : undefined
                                }
                                onSelect={(date) => {
                                  if (date) {
                                    handleFormChange("desiredDeliveryDate", format(date, "yyyyMMdd"))
                                  }
                                }}
                                locale={ja}
                              />
                            </PopoverContent>
                          </Popover>
                        </div>
                        <div>
                          <label className="mb-2 block text-sm font-medium text-muted-foreground">請納期</label>
                          <Popover>
                            <PopoverTrigger asChild>
                              <Button
                                variant="outline"
                                className={cn(
                                  "w-full justify-start text-left font-normal elevation-1 border-0 bg-background",
                                  !formData.requestedDeliveryDate && "text-muted-foreground",
                                )}
                              >
                                <CalendarIcon className="mr-2 h-4 w-4" />
                                {formData.requestedDeliveryDate &&
                                isValid(parse(formData.requestedDeliveryDate, "yyyyMMdd", new Date()))
                                  ? format(
                                      parse(formData.requestedDeliveryDate, "yyyyMMdd", new Date()),
                                      "yyyy年MM月dd日",
                                      { locale: ja },
                                    )
                                  : "日付を選択"}
                              </Button>
                            </PopoverTrigger>
                            <PopoverContent className="w-auto p-0" align="start">
                              <Calendar
                                mode="single"
                                selected={
                                  formData.requestedDeliveryDate &&
                                  isValid(parse(formData.requestedDeliveryDate, "yyyyMMdd", new Date()))
                                    ? parse(formData.requestedDeliveryDate, "yyyyMMdd", new Date())
                                    : undefined
                                }
                                onSelect={(date) => {
                                  if (date) {
                                    handleFormChange("requestedDeliveryDate", format(date, "yyyyMMdd"))
                                  }
                                }}
                                locale={ja}
                              />
                            </PopoverContent>
                          </Popover>
                        </div>
                      </div>

                      <div>
                        <label className="mb-2 block text-sm font-medium text-muted-foreground">支払条件</label>
                        <Input
                          value={formData.paymentTerms}
                          onChange={(e) => handleFormChange("paymentTerms", e.target.value)}
                          className="elevation-1 border-0 bg-background"
                        />
                      </div>

                      <div>
                        <label className="mb-2 block text-sm font-medium text-muted-foreground">受渡場所</label>
                        <Input
                          value={formData.deliveryLocation}
                          onChange={(e) => handleFormChange("deliveryLocation", e.target.value)}
                          className="elevation-1 border-0 bg-background"
                        />
                      </div>

                      <div>
                        <label className="mb-2 block text-sm font-medium text-muted-foreground">検査完了期日</label>
                        <Input
                          value={formData.inspectionDeadline}
                          onChange={(e) => handleFormChange("inspectionDeadline", e.target.value)}
                          className="elevation-1 border-0 bg-background"
                        />
                      </div>
                    </div>
                  </Card>

                  <Card className="elevation-1 border-0 bg-gradient-to-br from-primary/5 to-transparent p-5">
                    <h3 className="mb-4 flex items-center gap-2 font-semibold text-primary">
                      <div className="h-1 w-1 rounded-full bg-primary" />
                      担当者情報
                    </h3>

                    <div className="space-y-4">
                      <div className="grid gap-4 sm:grid-cols-2">
                        <div>
                          <label className="mb-2 block text-sm font-medium text-muted-foreground">担当</label>
                          <Input
                            value={formData.manager}
                            onChange={(e) => handleFormChange("manager", e.target.value)}
                            className="elevation-1 border-0 bg-background"
                          />
                        </div>
                        <div>
                          <label className="mb-2 block text-sm font-medium text-muted-foreground">承認</label>
                          <Input
                            value={formData.approver}
                            onChange={(e) => handleFormChange("approver", e.target.value)}
                            className="elevation-1 border-0 bg-background"
                            placeholder="（空欄）"
                          />
                        </div>
                      </div>

                      <div>
                        <label className="mb-2 block text-sm font-medium text-muted-foreground">自社住所</label>
                        <Input
                          value={formData.issuerAddress}
                          onChange={(e) => handleFormChange("issuerAddress", e.target.value)}
                          className="elevation-1 border-0 bg-background"
                        />
                      </div>

                      <div className="grid gap-4 sm:grid-cols-2">
                        <div>
                          <label className="mb-2 block text-sm font-medium text-muted-foreground">電話</label>
                          <Input
                            value={formData.phone}
                            onChange={(e) => handleFormChange("phone", e.target.value)}
                            className="elevation-1 border-0 bg-background font-mono"
                          />
                        </div>
                        <div>
                          <label className="mb-2 block text-sm font-medium text-muted-foreground">FAX</label>
                          <Input
                            value={formData.fax}
                            onChange={(e) => handleFormChange("fax", e.target.value)}
                            className="elevation-1 border-0 bg-background font-mono"
                          />
                        </div>
                      </div>
                    </div>
                  </Card>
                </div>
              </Card>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
