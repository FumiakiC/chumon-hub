import { useState, useEffect, useRef } from "react"
import { z } from "zod"
import type { LogEntry } from "@/types/logEntry"

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

type ProcessingStatus = "idle" | "uploading" | "flash_check" | "pro_extraction" | "complete" | "error" | "cancelled"

export function useOrderProcessing() {
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [processingStatus, setProcessingStatus] = useState<ProcessingStatus>("idle")
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [extractedJson, setExtractedJson] = useState<Record<string, string> | null>(null)
  const [isCopied, setIsCopied] = useState(false)
  const abortControllerRef = useRef<AbortController | null>(null)

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
    if (isLoading && abortControllerRef.current) {
      abortControllerRef.current.abort()
      setSelectedFile(null)
      setError(null)
      // ログは残したままにする
    } else {
      setSelectedFile(null)
      setError(null)
      setProcessingStatus("idle")
      setLogs([])
    }
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

  const handleTranscription = async (
    onExtracted: (data: {
      orderNo?: string
      quoteNo?: string
      recipientCompany?: string
      issuerCompany?: string
      issuerAddress?: string
      manager?: string
      approver?: string
      desiredDeliveryDate?: string
      requestedDeliveryDate?: string
      paymentTerms?: string
      deliveryLocation?: string
      inspectionDeadline?: string
      phone?: string
      fax?: string
      items: ProductItem[]
    }) => void
  ) => {
    if (!selectedFile) {
      setError("ファイルを選択してください")
      return
    }

    setIsLoading(true)
    setError(null)
    setLogs([])
    abortControllerRef.current = new AbortController()
    const signal = abortControllerRef.current.signal

    setProcessingStatus("uploading")
    addLog("ファイルアップロードを開始...", "info")

    try {
      const formData = new FormData()
      formData.append("file", selectedFile)
      formData.append("mimeType", selectedFile.type)

      await new Promise((r) => setTimeout(r, 800))
      if (signal.aborted) {
        throw new DOMException("処理が中断されました", "AbortError")
      }
      addLog(`アップロード完了。ファイルID: files/${Math.random().toString(36).substring(7)}`, "success")

      setProcessingStatus("flash_check")
      addLog("Gemini 2.5 Flash-lite で書類タイプを判定中...", "info")

      const checkResponse = await fetch("/api/check-document-type", {
        method: "POST",
        body: formData,
        signal: signal,
      })

      if (!checkResponse.ok) throw new Error("判定APIエラー")
      const checkResult = await checkResponse.json()
      if (signal.aborted) {
        throw new DOMException("処理が中断されました", "AbortError")
      }

      if (!checkResult.isQuotation) {
        addLog(`判定結果: ❌ 見積書・発注書ではありません (${checkResult.documentType})。処理を中断します。`, "error")
        addLog(`理由: ${checkResult.reason}`, "error")
        setProcessingStatus("error")
        setIsLoading(false)
        return
      }

      addLog(`判定結果: ✅ ${checkResult.documentType}と認定。次のステップに移行します。`, "success")

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
        signal: signal,
      })

      if (!response.ok) {
        throw new Error("APIリクエストが失敗しました")
      }

      const result = await response.json()
      if (signal.aborted) {
        throw new DOMException("処理が中断されました", "AbortError")
      }

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

      // コールバックで抽出データを渡す
      onExtracted({
        orderNo: extracted.orderNo,
        quoteNo: extracted.quoteNo,
        recipientCompany: extracted.recipientCompany,
        issuerCompany: extracted.issuerCompany,
        issuerAddress: extracted.issuerAddress,
        manager: extracted.manager,
        approver: extracted.approver,
        desiredDeliveryDate: extracted.desiredDeliveryDate,
        requestedDeliveryDate: extracted.requestedDeliveryDate,
        paymentTerms: extracted.paymentTerms,
        deliveryLocation: extracted.deliveryLocation,
        inspectionDeadline: extracted.inspectionDeadline,
        phone: extracted.phone,
        fax: extracted.fax,
        items: mappedItems,
      })

      setProcessingStatus("complete")
      addLog("データ抽出完了。JSONパース成功。", "success")
    } catch (err) {
      console.error("[v0] Extraction error:", err)
      if (err instanceof DOMException && err.name === "AbortError") {
        addLog("ユーザーの操作により処理を停止しました", "info")
        setProcessingStatus("cancelled")
        
        // 3秒後に自動的にidleステータスに戻す
        setTimeout(() => {
          setProcessingStatus("idle")
          setLogs([])
        }, 3000)
      } else {
        setProcessingStatus("error")
        addLog("エラーが発生しました", "error")
        setError(err instanceof Error ? err.message : "データの抽出に失敗しました")
      }
    } finally {
      abortControllerRef.current = null
      setIsLoading(false)
    }
  }

  return {
    // State
    selectedFile,
    previewUrl,
    isLoading,
    error,
    processingStatus,
    logs,
    extractedJson,
    isCopied,
    setIsCopied,
    
    // Functions
    processFile,
    handleFileChange,
    handleDragOver,
    handleDrop,
    handleRemoveFile,
    addLog,
    handleTranscription,
  }
}
