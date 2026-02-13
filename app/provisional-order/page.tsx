"use client"

import React, { useState, useCallback, useRef } from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import * as z from "zod"
import {
  UploadCloud,
  CheckCircle2,
  AlertTriangle,
  Eye,
  Trash2,
  FileText,
  FolderOpen,
  X,
  Crop,
  Play,
  Image as ImageIcon,
  Copy,
} from "lucide-react"
import { toast } from "sonner" // ※プロジェクトにsonnerがない場合は削除または適宜変更

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { Spinner } from "@/components/ui/spinner"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetFooter,
} from "@/components/ui/sheet"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Header } from "@/components/ui/header"

// --- Types ---

// Phase 1: Cropped Files
type CropStatus = "cropping" | "cropped" | "completed"

interface CroppedFile {
  id: string
  fileName: string
  status: CropStatus
  progress: number
  thumbnailUrl: string
  base64?: string
}

// Phase 2: Analysis Results
type OrderItemStatus = "uploading" | "processing" | "completed" | "review"

interface OrderItem {
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

// Order Header
interface OrderHeader {
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

const defaultOrderHeader: OrderHeader = {
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

// Zod schema
const verificationSchema = z.object({
  drawingNo: z.string().min(1, "図面番号は必須です"),
  partName: z.string().min(1, "品名は必須です"),
  material: z.string().min(1, "材質は必須です"),
  quantity: z.coerce.number().min(1, "数量は1以上で入力してください"),
  surfaceTreatment: z.string().optional(),
  notes: z.string().optional(),
})

type VerificationFormData = z.infer<typeof verificationSchema>

// Helper: Base64 to Blob conversion
const base64ToBlob = (base64: string, mimeType: string) => {
  const byteCharacters = atob(base64.split(',')[1])
  const byteNumbers = new Array(byteCharacters.length)
  for (let i = 0; i < byteCharacters.length; i++) {
    byteNumbers[i] = byteCharacters.charCodeAt(i)
  }
  const byteArray = new Uint8Array(byteNumbers)
  return new Blob([byteArray], { type: mimeType })
}

// Mock generator for cropped file
const generateCroppedFile = (fileName: string): CroppedFile => {
  return {
    id: crypto.randomUUID(),
    fileName,
    status: "cropping",
    progress: 0,
    thumbnailUrl: "/placeholder.svg",
  }
}

export default function ProvisionalOrderPage() {
  // Phase 1 State
  const [croppedFiles, setCroppedFiles] = useState<CroppedFile[]>([])
  const [isDragActive, setIsDragActive] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const folderInputRef = useRef<HTMLInputElement>(null)

  // Phase 2 State
  const [orderItems, setOrderItems] = useState<OrderItem[]>([])
  const [selectedItem, setSelectedItem] = useState<OrderItem | null>(null)
  const [isSheetOpen, setIsSheetOpen] = useState(false)
  const [previewFile, setPreviewFile] = useState<CroppedFile | null>(null)
  const [isPreviewOpen, setIsPreviewOpen] = useState(false)

  // Phase 3 State
  const [orderHeader, setOrderHeader] = useState<OrderHeader>(defaultOrderHeader)

  const verificationForm = useForm<VerificationFormData>({
    resolver: zodResolver(verificationSchema),
    defaultValues: {
      drawingNo: "",
      partName: "",
      material: "",
      quantity: 1,
      surfaceTreatment: "",
      notes: "",
    },
  })

  // --- Phase 1: Crop Processing ---
  const processCrop = useCallback(async (fileId: string, file: File) => {
    try {
      const progressInterval = setInterval(() => {
        setCroppedFiles((prev) =>
          prev.map((f) => {
            if (f.id === fileId && f.status === "cropping" && f.progress < 90) {
              return { ...f, progress: Math.min(f.progress + 15, 90) }
            }
            return f
          })
        )
      }, 150)

      const formData = new FormData()
      formData.append("file", file)

      const response = await fetch("/api/crop-title-block", {
        method: "POST",
        body: formData,
      })

      clearInterval(progressInterval)

      if (!response.ok) {
        throw new Error("Failed to crop PDF")
      }

      const data = await response.json()
      const croppedFile = data.croppedFiles?.[0]

      if (croppedFile && croppedFile.base64) {
        setCroppedFiles((prev) =>
          prev.map((f) =>
            f.id === fileId
              ? { ...f, progress: 100, status: "cropped", base64: croppedFile.base64 }
              : f
          )
        )
      } else {
        throw new Error("Invalid response")
      }
    } catch (error) {
      console.error("Crop error:", error)
      setCroppedFiles((prev) =>
        prev.map((f) =>
          f.id === fileId ? { ...f, progress: 100, status: "cropped" } : f // エラーでも一旦croppedにしておく
        )
      )
    }
  }, [])

  const handleFiles = useCallback(
    (files: FileList | null) => {
      if (!files) return
      const newFiles: Array<{ croppedFile: CroppedFile; originalFile: File }> = []
      for (let i = 0; i < files.length; i++) {
        const file = files[i]
        if (file.type === "application/pdf" || file.name.endsWith(".pdf")) {
          newFiles.push({
            croppedFile: generateCroppedFile(file.name),
            originalFile: file,
          })
        }
      }
      setCroppedFiles((prev) => [...prev, ...newFiles.map((f) => f.croppedFile)])
      newFiles.forEach(({ croppedFile, originalFile }) => {
        // 少しずらして開始
        setTimeout(() => processCrop(croppedFile.id, originalFile), Math.random() * 300)
      })
    },
    [processCrop]
  )

  // --- Phase 2: Analyze Processing (Modified for API Integration) ---
  const handleAnalyzeAll = useCallback(async () => {
    // 1. Filter ready files
    const croppedReadyFiles = croppedFiles.filter((f) => f.status === "cropped" && f.base64)
    if (croppedReadyFiles.length === 0) return

    // 2. Mark Phase 1 files as completed
    setCroppedFiles((prev) =>
      prev.map((file) =>
        file.status === "cropped" ? { ...file, status: "completed" } : file
      )
    )

    // 3. Initialize Order Items with "uploading" status
    const initialItems: OrderItem[] = croppedReadyFiles.map((file) => ({
      id: file.id,
      fileName: file.fileName,
      status: "uploading",
      progress: 0,
      drawingNo: "",
      partName: "",
      material: "",
      surfaceTreatment: "",
      notes: "",
      quantity: 1,
      thumbnailUrl: file.thumbnailUrl,
      needsReview: false,
      confidence: 0,
      previewUrl: file.base64,
    }))
    setOrderItems((prev) => [...prev, ...initialItems])

    // 4. Process each file sequentially (Upload + Analyze via API)
    for (const file of croppedReadyFiles) {
      if (!file.base64) continue

      try {
        // Convert Base64 to Blob for FormData
        const blob = base64ToBlob(file.base64, "application/pdf")
        const formData = new FormData()
        formData.append("file", blob, file.fileName) // ファイル名は必須

        // Update status to processing
        setOrderItems((prev) =>
          prev.map((i) =>
            i.id === file.id ? { ...i, status: "processing", progress: 50 } : i
          )
        )

        // Call the Extraction API
        const response = await fetch("/api/extract-drawing", {
          method: "POST",
          body: formData,
        })

        if (!response.ok) throw new Error("API Error")

        const result = await response.json()

        // Update item with analysis result
        setOrderItems((prev) =>
          prev.map((item) => {
            if (item.id === file.id) {
              return {
                ...item,
                drawingNo: result.drawingNo || "",
                partName: result.partName || "",
                material: result.material || "",
                quantity: result.quantity || 1,
                surfaceTreatment: result.surfaceTreatment || "",
                notes: result.notes || "",
                confidence: result.confidence || 0,
                needsReview: (result.confidence || 0) < 85,
                status: (result.confidence || 0) < 85 ? "review" : "completed",
                progress: 100,
              }
            }
            return item
          })
        )
      } catch (error) {
        console.error(`Analysis failed for ${file.fileName}:`, error)
        // Fallback to review status on error
        setOrderItems((prev) =>
          prev.map((item) =>
            item.id === file.id
              ? { ...item, status: "review", needsReview: true, notes: "解析エラー発生" }
              : item
          )
        )
      }
    }
  }, [croppedFiles])

  // --- Event Handlers & Helpers ---

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragActive(true)
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragActive(false)
  }, [])

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
      setIsDragActive(false)
      handleFiles(e.dataTransfer.files)
    },
    [handleFiles]
  )

  const handleFileInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      handleFiles(e.target.files)
    },
    [handleFiles]
  )

  const handleDeleteCroppedFile = (fileId: string) => {
    setCroppedFiles((prev) => prev.filter((file) => file.id !== fileId))
  }

  const handlePreviewFile = (file: CroppedFile) => {
    setPreviewFile(file)
    setIsPreviewOpen(true)
  }

  const handleVerify = (item: OrderItem) => {
    setSelectedItem(item)
    verificationForm.reset({
      drawingNo: item.drawingNo,
      partName: item.partName,
      material: item.material,
      quantity: item.quantity,
      surfaceTreatment: item.surfaceTreatment,
      notes: item.notes,
    })
    setIsSheetOpen(true)
  }

  const handleDelete = (itemId: string) => {
    setOrderItems((prev) => prev.filter((item) => item.id !== itemId))
  }

  const handleVerificationSubmit = (data: VerificationFormData) => {
    if (!selectedItem) return
    setOrderItems((prev) =>
      prev.map((item) =>
        item.id === selectedItem.id
          ? {
              ...item,
              ...data,
              status: "completed",
              needsReview: false,
              confidence: 100,
            }
          : item
      )
    )
    setIsSheetOpen(false)
    setSelectedItem(null)
  }

  const updateItemField = (
    itemId: string,
    field: keyof OrderItem,
    value: string | number
  ) => {
    setOrderItems((prev) =>
      prev.map((item) => (item.id === itemId ? { ...item, [field]: value } : item))
    )
  }

  const updateOrderHeader = (field: keyof OrderHeader, value: string) => {
    setOrderHeader((prev) => ({ ...prev, [field]: value }))
  }

  const handleCopyJSON = async () => {
    const items = orderItems.map((item) => ({
      productName: item.partName,
      description: `${item.drawingNo} / ${item.material}`,
      quantity: item.quantity,
      unitPrice: 0,
      amount: 0,
    }))
    const payload = { ...orderHeader, items }
    try {
      await navigator.clipboard.writeText(JSON.stringify(payload, null, 2))
      // toast.success("Copied!") // sonnerがあれば有効化
    } catch (e) {
      console.error(e)
    }
  }

  // --- Render Helpers ---

  const getStatusIcon = (status: OrderItemStatus, needsReview: boolean) => {
    switch (status) {
      case "uploading":
      case "processing":
        return <Spinner className="size-5 text-blue-500" />
      case "completed":
        return <CheckCircle2 className="size-5 text-emerald-500" />
      case "review":
        return <AlertTriangle className="size-5 text-amber-500" />
      default:
        return needsReview ? (
          <AlertTriangle className="size-5 text-amber-500" />
        ) : (
          <CheckCircle2 className="size-5 text-emerald-500" />
        )
    }
  }

  const getCropStatusBadge = (status: CropStatus) => {
    switch (status) {
      case "cropping":
        return (
          <Badge variant="secondary" className="gap-1">
            <Spinner className="size-3" /> クロップ中
          </Badge>
        )
      case "cropped":
        return (
          <Badge variant="secondary" className="gap-1 bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400">
            <Crop className="size-3" /> クロップ済
          </Badge>
        )
      case "completed":
        return (
          <Badge variant="secondary" className="gap-1 bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">
            <CheckCircle2 className="size-3" /> 解析済
          </Badge>
        )
    }
  }

  const croppingCount = croppedFiles.filter((f) => f.status === "cropping").length
  const croppedCount = croppedFiles.filter((f) => f.status === "cropped").length
  const completedCropCount = croppedFiles.filter((f) => f.status === "completed").length
  const completedCount = orderItems.filter((i) => i.status === "completed").length
  const reviewCount = orderItems.filter((i) => i.status === "review").length
  const processingCount = orderItems.filter(
    (i) => i.status === "uploading" || i.status === "processing"
  ).length

  return (
    <div className="flex min-h-screen flex-col bg-gradient-to-br from-slate-50 via-white to-blue-50/20 dark:from-slate-950 dark:via-slate-900 dark:to-slate-950">
      <Header
        transparent={false}
        showBackButton
        title={
          <div className="flex items-center gap-2">
            <FileText className="h-4 w-4 text-blue-600 dark:text-blue-400" />
            <span className="text-sm font-bold text-slate-700 dark:text-slate-300">
              仮注文書作成
            </span>
          </div>
        }
      />

      <div className="flex-1 p-4 md:p-8">
        <div className="mx-auto max-w-[1600px] space-y-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h1 className="text-2xl font-bold tracking-tight">図面一括解析</h1>
              <p className="text-muted-foreground text-sm">
                PDF図面の表題欄を自動クロップして解析します
              </p>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" className="gap-2" onClick={handleCopyJSON} disabled={orderItems.length === 0}>
                <Copy className="size-4" /> JSONコピー
              </Button>
            </div>
          </div>

          <div className="flex flex-col lg:flex-row gap-6">
            {/* --- Phase 1: Upload & Crop --- */}
            <Card className="lg:w-1/3">
              <CardHeader className="bg-muted/50 border-b">
                <div className="flex justify-between items-center">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline">Phase 1</Badge>
                    <CardTitle className="text-lg">アップロード</CardTitle>
                  </div>
                  {croppedFiles.length > 0 && (
                    <div className="flex gap-2">
                      {croppingCount > 0 && <Spinner className="size-4" />}
                      <span className="text-xs text-muted-foreground">{croppedFiles.length}件</span>
                    </div>
                  )}
                </div>
              </CardHeader>
              <CardContent className="p-4 space-y-4">
                <div
                  className={cn(
                    "rounded-lg border-2 border-dashed p-6 text-center transition-colors",
                    isDragActive ? "border-primary bg-primary/5" : "hover:bg-muted/50"
                  )}
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onDrop={handleDrop}
                >
                  <input ref={fileInputRef} type="file" className="hidden" accept=".pdf" multiple onChange={handleFileInput} />
                  <div className="flex flex-col items-center gap-3">
                    <UploadCloud className="size-8 text-muted-foreground" />
                    <p className="text-sm">PDFをドラッグ＆ドロップ</p>
                    <Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()}>
                      ファイル選択
                    </Button>
                  </div>
                </div>

                {/* Cropped Files List */}
                {croppedFiles.length > 0 && (
                  <div className="rounded-lg border max-h-[400px] overflow-y-auto">
                    <Table>
                      <TableHeader className="sticky top-0 bg-background z-10">
                        <TableRow>
                          <TableHead>ファイル</TableHead>
                          <TableHead className="w-[100px]">状態</TableHead>
                          <TableHead className="w-[50px]"></TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {croppedFiles.map((file) => (
                          <TableRow key={file.id}>
                            <TableCell className="py-2">
                              <div className="flex flex-col gap-1">
                                <span className="text-xs font-medium truncate max-w-[150px]" title={file.fileName}>
                                  {file.fileName}
                                </span>
                                {file.base64 && (
                                  <div 
                                    className="text-[10px] text-blue-600 cursor-pointer underline"
                                    onClick={() => handlePreviewFile(file)}
                                  >
                                    プレビュー確認
                                  </div>
                                )}
                              </div>
                            </TableCell>
                            <TableCell className="py-2">{getCropStatusBadge(file.status)}</TableCell>
                            <TableCell className="py-2">
                              <Button variant="ghost" size="icon" className="size-6" onClick={() => handleDeleteCroppedFile(file.id)}>
                                <Trash2 className="size-3" />
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}

                {croppedCount > 0 && (
                  <Button onClick={handleAnalyzeAll} className="w-full gap-2" disabled={croppedCount === 0}>
                    <Play className="size-4" /> すべて解析 ({croppedCount}件)
                  </Button>
                )}
              </CardContent>
            </Card>

            {/* --- Phase 2: Analysis Results --- */}
            <Card className="lg:w-2/3">
              <CardHeader className="bg-muted/50 border-b">
                <div className="flex justify-between items-center">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline">Phase 2</Badge>
                    <CardTitle className="text-lg">解析結果</CardTitle>
                  </div>
                  {orderItems.length > 0 && (
                    <div className="flex gap-2 text-xs">
                      <Badge variant="secondary" className="gap-1"><CheckCircle2 className="size-3 text-emerald-500" /> {completedCount}</Badge>
                      {reviewCount > 0 && <Badge variant="secondary" className="gap-1"><AlertTriangle className="size-3 text-amber-500" /> {reviewCount}</Badge>}
                      {processingCount > 0 && <Badge variant="secondary" className="gap-1"><Spinner className="size-3" /> {processingCount}</Badge>}
                    </div>
                  )}
                </div>
              </CardHeader>
              <CardContent className="p-0">
                <div className="max-h-[600px] overflow-y-auto">
                  <Table>
                    <TableHeader className="sticky top-0 bg-background z-10">
                      <TableRow>
                        <TableHead className="w-[50px]">状態</TableHead>
                        <TableHead>図面番号</TableHead>
                        <TableHead>品名</TableHead>
                        <TableHead>材質</TableHead>
                        <TableHead className="w-[80px]">数量</TableHead>
                        <TableHead className="w-[80px]">操作</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {orderItems.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={6} className="h-32 text-center text-muted-foreground">
                            解析結果がここに表示されます
                          </TableCell>
                        </TableRow>
                      ) : (
                        orderItems.map((item) => (
                          <TableRow key={item.id} className={cn(item.needsReview && "bg-amber-50/50 dark:bg-amber-950/10")}>
                            <TableCell>
                              <div className="flex justify-center">{getStatusIcon(item.status, item.needsReview)}</div>
                            </TableCell>
                            <TableCell>
                              <Input value={item.drawingNo} onChange={(e) => updateItemField(item.id, "drawingNo", e.target.value)} className="h-8" />
                            </TableCell>
                            <TableCell>
                              <Input value={item.partName} onChange={(e) => updateItemField(item.id, "partName", e.target.value)} className="h-8" />
                            </TableCell>
                            <TableCell>
                              <Input value={item.material} onChange={(e) => updateItemField(item.id, "material", e.target.value)} className="h-8" />
                            </TableCell>
                            <TableCell>
                              <Input type="number" value={item.quantity} onChange={(e) => updateItemField(item.id, "quantity", parseInt(e.target.value) || 0)} className="h-8" />
                            </TableCell>
                            <TableCell>
                              <div className="flex gap-1">
                                <Button variant="ghost" size="icon" className="size-8" onClick={() => handleVerify(item)}>
                                  <Eye className="size-4" />
                                </Button>
                                <Button variant="ghost" size="icon" className="size-8 text-destructive" onClick={() => handleDelete(item.id)}>
                                  <Trash2 className="size-4" />
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          </div>
          
          {/* Phase 3: Header Info (Optional) - 省略または必要に応じて追加 */}
          
        </div>
      </div>

      {/* Sheets: Preview & Verify */}
      <Sheet open={isPreviewOpen} onOpenChange={setIsPreviewOpen}>
        <SheetContent>
           <SheetHeader><SheetTitle>プレビュー</SheetTitle></SheetHeader>
           <div className="mt-4 aspect-video bg-muted rounded border overflow-hidden">
             {previewFile?.base64 && <iframe src={previewFile.base64} className="w-full h-full" />}
           </div>
        </SheetContent>
      </Sheet>

      <Sheet open={isSheetOpen} onOpenChange={setIsSheetOpen}>
        <SheetContent className="sm:max-w-lg overflow-y-auto">
          <SheetHeader>
            <SheetTitle>データ確認・修正</SheetTitle>
            <SheetDescription>抽出結果を確認してください</SheetDescription>
          </SheetHeader>
          {selectedItem && (
            <div className="py-4 space-y-4">
              <div className="aspect-[16/9] bg-muted rounded border overflow-hidden relative">
                 {selectedItem.previewUrl ? (
                   <iframe src={selectedItem.previewUrl} className="w-full h-full" />
                 ) : (
                   <div className="flex items-center justify-center h-full text-muted-foreground">プレビューなし</div>
                 )}
                 <Badge className="absolute bottom-2 left-2">信頼度: {selectedItem.confidence}%</Badge>
              </div>
              <form onSubmit={verificationForm.handleSubmit(handleVerificationSubmit)} className="space-y-4">
                 <div className="grid gap-2">
                   <Label>図面番号</Label>
                   <Input {...verificationForm.register("drawingNo")} />
                 </div>
                 <div className="grid gap-2">
                   <Label>品名</Label>
                   <Input {...verificationForm.register("partName")} />
                 </div>
                 <div className="grid grid-cols-2 gap-4">
                    <div className="grid gap-2">
                      <Label>材質</Label>
                      <Input {...verificationForm.register("material")} />
                    </div>
                    <div className="grid gap-2">
                      <Label>数量</Label>
                      <Input type="number" {...verificationForm.register("quantity")} />
                    </div>
                 </div>
                 <Button type="submit" className="w-full">確認完了</Button>
              </form>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  )
}