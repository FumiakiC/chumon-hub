"use client"

import type React from "react"

import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Upload, FileText, FileImage, X, Trash2, Plus, Copy, Check, CalendarIcon } from "lucide-react"
import { useRef, useEffect } from "react"
import { ProcessingStepper } from "@/components/processing-stepper/processing-stepper"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Calendar } from "@/components/ui/calendar"
import { format, parse, isValid } from "date-fns"
import { ja } from "date-fns/locale"
import { cn } from "@/lib/utils"
import { useOrderProcessing } from "@/hooks/use-order-processing"
import { useForm, useFieldArray, useWatch } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"

// Zodスキーマ定義
const productItemSchema = z.object({
  productName: z.string().default(""),
  description: z.string().default(""),
  quantity: z.number().default(0),
  unitPrice: z.number().default(0),
  amount: z.number().default(0),
})

const orderFormSchema = z.object({
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

type OrderFormData = z.infer<typeof orderFormSchema>

export default function QuoteToOrderPage() {
  // カスタムフックからファイル処理とAPI通信のロジックを取得
  const {
    selectedFile,
    previewUrl,
    isLoading,
    error,
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

  // react-hook-formのセットアップ
  const {
    register,
    control,
    watch,
    setValue,
    reset,
    formState: { errors },
  } = useForm<OrderFormData>({
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

  // 動的フィールド配列の管理
  const { fields, append, remove } = useFieldArray({
    control,
    name: "items",
  })

  // フォーム全体の値を監視
  const formValues = useWatch({ control })

  // 各アイテムの quantity と unitPrice を監視し、amount を自動計算
  useEffect(() => {
    fields.forEach((field, index) => {
      const quantity = formValues.items?.[index]?.quantity ?? 0
      const unitPrice = formValues.items?.[index]?.unitPrice ?? 0
      const calculatedAmount = quantity * unitPrice
      
      // 現在の amount と計算結果が異なる場合のみ更新
      if (formValues.items?.[index]?.amount !== calculatedAmount) {
        setValue(`items.${index}.amount`, calculatedAmount, { shouldValidate: false })
      }
    })
  }, [formValues.items, fields, setValue])

  // 合計金額の計算（useWatchでリアルタイム算出）
  const watchedItems = useWatch({ control, name: "items" })
  const calculateTotal = () => {
    const total = (watchedItems ?? []).reduce((sum, item) => {
      return sum + (item?.amount ?? 0)
    }, 0)
    return total.toLocaleString("ja-JP")
  }

  const addItem = () => {
    append({
      productName: "",
      description: "",
      quantity: 0,
      unitPrice: 0,
      amount: 0,
    })
  }

  const removeItem = (index: number) => {
    if (fields.length > 1) {
      remove(index)
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
                        ※デモ仕様: 見積書や注文書をアップロードすると成功します
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
                          onClick={() =>
                            handleTranscription((extracted) => {
                              // react-hook-formのresetを使用してフォーム全体に値を流し込む
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
                                items: extracted.items.length > 0
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
                          }
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
                      const currentValues = watch()
                      const jsonString = JSON.stringify(currentValues, null, 2)
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
                    disabled={!watch("orderNo") && !watch("items")?.some(item => item?.productName)}
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
                          {...register("orderNo")}
                          className="elevation-1 border-0 bg-background font-mono"
                        />
                      </div>
                      <div>
                        <label className="mb-2 block text-sm font-medium text-muted-foreground">見積書 No.</label>
                        <Input
                          {...register("quoteNo")}
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
                          {...register("recipientCompany")}
                          className="elevation-1 border-0 bg-background"
                        />
                      </div>
                      <div>
                        <label className="mb-2 block text-sm font-medium text-muted-foreground">発注元（自社名）</label>
                        <Input
                          {...register("issuerCompany")}
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
                      <Button
                        onClick={addItem}
                        size="sm"
                        className="bg-slate-600 text-accent-foreground hover:bg-slate-600/90"
                      >
                        <Plus className="h-4 w-4 mr-1" />
                        品目を追加
                      </Button>
                    </div>

                    <p className="mb-4 text-sm text-muted-foreground">品目を追加、編集、削除できます</p>

                    <div className="space-y-4">
                      {fields.map((field, index) => (
                        <Card key={field.id} className="elevation-1 border border-border/50 bg-background p-4">
                          <div className="mb-3 flex items-center justify-between">
                            <span className="text-sm font-semibold text-muted-foreground">No. {index + 1}</span>
                            {fields.length > 1 && (
                              <Button
                                onClick={() => removeItem(index)}
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
                                  {...register(`items.${index}.productName`)}
                                  placeholder="品目名を入力"
                                  className="elevation-1 border-0 bg-muted/30"
                                />
                              </div>
                              <div>
                                <label className="mb-1.5 block text-sm font-medium text-muted-foreground">単価</label>
                                <Input
                                  type="number"
                                  {...register(`items.${index}.unitPrice`, { valueAsNumber: true })}
                                  placeholder="0"
                                  className="elevation-1 border-0 bg-muted/30 font-mono"
                                />
                              </div>
                              <div>
                                <label className="mb-1.5 block text-sm font-medium text-muted-foreground">数量</label>
                                <Input
                                  type="number"
                                  {...register(`items.${index}.quantity`, { valueAsNumber: true })}
                                  placeholder="1"
                                  className="elevation-1 border-0 bg-muted/30"
                                />
                              </div>
                              <div>
                                <label className="mb-1.5 block text-sm font-medium text-muted-foreground">小計</label>
                                <div className="flex h-10 items-center rounded-md bg-muted/50 px-3 font-mono text-sm font-semibold">
                                  ¥{((watchedItems?.[index]?.amount ?? 0) || 0).toLocaleString("ja-JP")}
                                </div>
                              </div>
                            </div>

                            <div>
                              <label className="mb-1.5 block text-sm font-medium text-muted-foreground">摘要</label>
                              <Textarea
                                {...register(`items.${index}.description`)}
                                className="elevation-1 border-0 bg-muted/30"
                                rows={2}
                              />
                            </div>
                          </div>
                        </Card>
                      ))}

                      <div className="elevation-2 rounded-lg p-4 bg-slate-600">
                        <div className="flex items-center justify-between">
                          <label className="text-sm font-semibold text-accent-foreground">合計金額（税抜き）：</label>
                          <div className="text-2xl font-bold text-accent-foreground">¥{calculateTotal()}</div>
                        </div>
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
                                  !watch("desiredDeliveryDate") && "text-muted-foreground",
                                )}
                              >
                                <CalendarIcon className="mr-2 h-4 w-4" />
                                {watch("desiredDeliveryDate") &&
                                isValid(parse(watch("desiredDeliveryDate"), "yyyyMMdd", new Date()))
                                  ? format(
                                      parse(watch("desiredDeliveryDate"), "yyyyMMdd", new Date()),
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
                                  watch("desiredDeliveryDate") &&
                                  isValid(parse(watch("desiredDeliveryDate"), "yyyyMMdd", new Date()))
                                    ? parse(watch("desiredDeliveryDate"), "yyyyMMdd", new Date())
                                    : undefined
                                }
                                onSelect={(date) => {
                                  if (date) {
                                    setValue("desiredDeliveryDate", format(date, "yyyyMMdd"))
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
                                  !watch("requestedDeliveryDate") && "text-muted-foreground",
                                )}
                              >
                                <CalendarIcon className="mr-2 h-4 w-4" />
                                {watch("requestedDeliveryDate") &&
                                isValid(parse(watch("requestedDeliveryDate"), "yyyyMMdd", new Date()))
                                  ? format(
                                      parse(watch("requestedDeliveryDate"), "yyyyMMdd", new Date()),
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
                                  watch("requestedDeliveryDate") &&
                                  isValid(parse(watch("requestedDeliveryDate"), "yyyyMMdd", new Date()))
                                    ? parse(watch("requestedDeliveryDate"), "yyyyMMdd", new Date())
                                    : undefined
                                }
                                onSelect={(date) => {
                                  if (date) {
                                    setValue("requestedDeliveryDate", format(date, "yyyyMMdd"))
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
                          {...register("paymentTerms")}
                          className="elevation-1 border-0 bg-background"
                        />
                      </div>

                      <div>
                        <label className="mb-2 block text-sm font-medium text-muted-foreground">受渡場所</label>
                        <Input
                          {...register("deliveryLocation")}
                          className="elevation-1 border-0 bg-background"
                        />
                      </div>

                      <div>
                        <label className="mb-2 block text-sm font-medium text-muted-foreground">検査完了期日</label>
                        <Input
                          {...register("inspectionDeadline")}
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
                            {...register("manager")}
                            className="elevation-1 border-0 bg-background"
                          />
                        </div>
                        <div>
                          <label className="mb-2 block text-sm font-medium text-muted-foreground">承認</label>
                          <Input
                            {...register("approver")}
                            className="elevation-1 border-0 bg-background"
                            placeholder="（空欄）"
                          />
                        </div>
                      </div>

                      <div>
                        <label className="mb-2 block text-sm font-medium text-muted-foreground">自社住所</label>
                        <Input
                          {...register("issuerAddress")}
                          className="elevation-1 border-0 bg-background"
                        />
                      </div>

                      <div className="grid gap-4 sm:grid-cols-2">
                        <div>
                          <label className="mb-2 block text-sm font-medium text-muted-foreground">電話</label>
                          <Input
                            {...register("phone")}
                            className="elevation-1 border-0 bg-background font-mono"
                          />
                        </div>
                        <div>
                          <label className="mb-2 block text-sm font-medium text-muted-foreground">FAX</label>
                          <Input
                            {...register("fax")}
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
