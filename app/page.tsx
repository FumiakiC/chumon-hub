'use client'

import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Upload, FileText, Loader2, CheckCircle2, AlertCircle, Sparkles, FileImage, X } from 'lucide-react'
import { useState, useRef } from 'react'

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

type ProcessingStatus = 'idle' | 'uploading' | 'analyzing' | 'extracting' | 'complete' | 'error'

export default function QuoteToOrderPage() {
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [processingStatus, setProcessingStatus] = useState<ProcessingStatus>('idle')
  const [progressMessage, setProgressMessage] = useState<string>('')
  
  const [formData, setFormData] = useState<OrderFormData>({
    orderNo: '',
    quoteNo: '',
    productName: '',
    description: '',
    quantity: '',
    unitPrice: '',
    amount: '',
    totalAmount: '',
    desiredDeliveryDate: '',
    requestedDeliveryDate: '',
    paymentTerms: '',
    deliveryLocation: '',
    inspectionDeadline: '',
    recipientCompany: '',
    issuerCompany: '',
    issuerAddress: '',
    phone: '',
    fax: '',
    manager: '',
    approver: '',
  })

  const handleFormChange = (field: keyof OrderFormData, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }))
  }

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (file) {
      setSelectedFile(file)
      setError(null)

      const reader = new FileReader()
      reader.onloadend = () => {
        setPreviewUrl(reader.result as string)
      }
      reader.readAsDataURL(file)
    }
  }

  const handleDragOver = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault()
  }

  const handleDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    const file = event.dataTransfer.files[0]
    if (file) {
      setSelectedFile(file)
      setError(null)

      const reader = new FileReader()
      reader.onloadend = () => {
        setPreviewUrl(reader.result as string)
      }
      reader.readAsDataURL(file)
    }
  }

  const handleRemoveFile = () => {
    setSelectedFile(null)
    setPreviewUrl(null)
    setError(null)
    setProcessingStatus('idle')
    setProgressMessage('')
  }

  const handleTranscription = async () => {
    if (!selectedFile) {
      setError('ファイルを選択してください')
      return
    }

    setIsLoading(true)
    setError(null)
    
    setProcessingStatus('uploading')
    setProgressMessage('ファイルをアップロード中...')

    try {
      const reader = new FileReader()
      const fileData = await new Promise<string>((resolve, reject) => {
        reader.onloadend = () => {
          const base64 = (reader.result as string).split(',')[1]
          resolve(base64)
        }
        reader.onerror = reject
        reader.readAsDataURL(selectedFile)
      })

      setProcessingStatus('analyzing')
      setProgressMessage('Gemini APIで画像を解析中...')

      const response = await fetch('/api/extract-order', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          file: {
            data: fileData,
            mediaType: selectedFile.type,
          },
        }),
      })

      if (!response.ok) {
        throw new Error('APIリクエストが失敗しました')
      }

      setProcessingStatus('extracting')
      setProgressMessage('発注情報を抽出中...')

      const result = await response.json()

      if (result.error) {
        throw new Error(result.error)
      }

      // APIから返される抽出テキストをフォームに反映
      const extractedText = result.extractedText || ''
      setFormData(prev => ({
        ...prev,
        description: extractedText
      }))
      setProcessingStatus('complete')
      setProgressMessage('抽出完了しました')
    } catch (err) {
      console.error('[v0] Extraction error:', err)
      setProcessingStatus('error')
      setProgressMessage('エラーが発生しました')
      setError(err instanceof Error ? err.message : 'データの抽出に失敗しました')
    } finally {
      setIsLoading(false)
    }
  }

  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleUploadClick = () => {
    fileInputRef.current?.click()
  }

  return (
    <div className="flex min-h-screen flex-col bg-gradient-to-br from-muted/30 via-background to-muted/20">
      <div className="flex-1 p-4 md:p-8">
        <div className="mx-auto max-w-7xl">
          <Card className="elevation-3 overflow-hidden border-0">
            <div className="bg-gradient-to-r from-primary via-primary/95 to-secondary p-8 md:p-12">
              <div className="mx-auto max-w-3xl text-center">
                <div className="mb-4 flex items-center justify-center gap-2">
                  <Sparkles className="h-8 w-8 animate-pulse text-primary-foreground" />
                  <h1 className="text-balance text-4xl font-bold tracking-tight text-primary-foreground md:text-5xl">
                    Gemini APIテストアプリ
                  </h1>
                  <Sparkles className="h-8 w-8 animate-pulse text-primary-foreground" />
                </div>
                <p className="text-balance text-lg text-primary-foreground/90">
                  見積書（画像またはPDF）をアップロードすると、Gemini
                  APIが内容を読み取り、自動的に発注フォームに入力します。
                </p>
              </div>
            </div>

            <div className="flex flex-col gap-8 p-6 md:p-8 lg:flex-row lg:items-start">
              {/* 左カラム: ファイルアップロードとプレビュー - 固定 */}
              <div className="lg:sticky lg:top-8 lg:h-fit lg:w-1/2">
                <div className="space-y-6">
                  <Card className="elevation-2 border-0 bg-card p-6">
                    <div className="mb-4 flex items-center gap-2">
                      <div className="rounded-full bg-primary/10 p-2">
                        <FileImage className="h-5 w-5 text-primary" />
                      </div>
                      <h2 className="text-xl font-semibold text-foreground">
                        1. 見積書をアップロード
                      </h2>
                    </div>

                    <div
                      onDragOver={handleDragOver}
                      onDrop={handleDrop}
                      onClick={handleUploadClick}
                      className="group relative flex min-h-[200px] cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-primary/30 bg-gradient-to-br from-primary/5 to-transparent p-8 transition-all duration-300 hover:border-primary hover:from-primary/10 hover:shadow-lg"
                    >
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/*,.pdf"
                        onChange={handleFileChange}
                        className="hidden"
                        id="file-upload"
                      />
                      <div className="rounded-full bg-primary/10 p-4 transition-transform duration-300 group-hover:scale-110">
                        <Upload className="h-12 w-12 text-primary" />
                      </div>
                      <p className="mb-2 mt-4 text-center font-semibold text-foreground">
                        画像またはPDFをここにドラッグ&ドロップ
                      </p>
                      <p className="text-center text-sm text-muted-foreground">
                        またはクリックしてファイルを選択（JPG、PNG、WebP、PDF）
                      </p>
                    </div>

                    {selectedFile && (
                      <div className="elevation-1 mt-4 flex items-center gap-3 rounded-lg bg-accent p-4 transition-all duration-300 hover:elevation-2">
                        <div className="rounded-lg bg-accent-foreground/10 p-2">
                          <FileText className="h-6 w-6 text-accent-foreground" />
                        </div>
                        <div className="flex-1">
                          <p className="font-medium text-accent-foreground">
                            {selectedFile.name}
                          </p>
                          <p className="text-sm text-accent-foreground/70">
                            {(selectedFile.size / 1024).toFixed(2)} KB
                          </p>
                        </div>
                        <Button
                          onClick={handleRemoveFile}
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-accent-foreground/70 hover:bg-destructive/10 hover:text-destructive"
                        >
                          <X className="h-5 w-5" />
                        </Button>
                      </div>
                    )}

                    {previewUrl && selectedFile && (
                      <Card className="elevation-2 mt-4 border-0 bg-muted/50 p-4">
                        <div className="mb-2 flex items-center gap-2">
                          <FileImage className="h-4 w-4 text-muted-foreground" />
                          <h3 className="text-sm font-semibold text-foreground">
                            アップロード内容
                          </h3>
                        </div>
                        <div className="elevation-2 overflow-hidden rounded-lg border-2 border-border bg-white">
                          {selectedFile.type === 'application/pdf' ? (
                            <iframe
                              src={previewUrl}
                              className="h-[800px] w-full"
                              title="PDF Preview"
                            />
                          ) : (
                            <img
                              src={previewUrl || "/placeholder.svg"}
                              alt="アップロードされた見積書"
                              className="h-auto w-full"
                            />
                          )}
                        </div>
                      </Card>
                    )}
                  </Card>

                  <Button
                    onClick={handleTranscription}
                    disabled={!selectedFile || isLoading}
                    className="elevation-2 h-14 w-full rounded-xl text-lg font-semibold transition-all duration-300 hover:elevation-3 disabled:elevation-1"
                    size="lg"
                  >
                    {isLoading ? (
                      <>
                        <Loader2 className="mr-2 h-6 w-6 animate-spin" />
                        処理中...
                      </>
                    ) : (
                      <>
                        <Sparkles className="mr-2 h-6 w-6" />
                        2. 読み取り開始
                      </>
                    )}
                  </Button>

                  {(isLoading || processingStatus === 'complete' || processingStatus === 'error') && (
                    <Card className="elevation-2 border-0 bg-card p-6">
                      <div className="space-y-4">
                        <div className="flex items-center gap-4">
                          {processingStatus === 'complete' ? (
                            <div className="rounded-full bg-green-100 p-3 dark:bg-green-900/30">
                              <CheckCircle2 className="h-7 w-7 text-green-600 dark:text-green-400" />
                            </div>
                          ) : processingStatus === 'error' ? (
                            <div className="rounded-full bg-destructive/10 p-3">
                              <AlertCircle className="h-7 w-7 text-destructive" />
                            </div>
                          ) : (
                            <div className="rounded-full bg-primary/10 p-3">
                              <Loader2 className="h-7 w-7 animate-spin text-primary" />
                            </div>
                          )}
                          <div className="flex-1">
                            <p className="text-lg font-semibold text-foreground">
                              {processingStatus === 'complete'
                                ? '処理完了'
                                : processingStatus === 'error'
                                ? 'エラーが発生しました'
                                : 'Gemini API 処理中'}
                            </p>
                            <p className="text-muted-foreground">
                              {progressMessage}
                            </p>
                          </div>
                        </div>

                        {isLoading && (
                          <div className="space-y-3">
                            <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                              <div
                                className="h-full bg-gradient-to-r from-primary to-secondary transition-all duration-500"
                                style={{
                                  width:
                                    processingStatus === 'uploading'
                                      ? '33%'
                                      : processingStatus === 'analyzing'
                                      ? '66%'
                                      : processingStatus === 'extracting'
                                      ? '90%'
                                      : '100%',
                                }}
                              />
                            </div>
                            <div className="flex justify-between text-sm">
                              <span className={processingStatus === 'uploading' ? 'font-semibold text-primary' : 'text-muted-foreground'}>
                                アップロード
                              </span>
                              <span className={processingStatus === 'analyzing' ? 'font-semibold text-primary' : 'text-muted-foreground'}>
                                解析
                              </span>
                              <span className={processingStatus === 'extracting' ? 'font-semibold text-primary' : 'text-muted-foreground'}>
                                抽出
                              </span>
                            </div>
                          </div>
                        )}
                      </div>
                    </Card>
                  )}

                  {error && (
                    <div className="elevation-1 rounded-xl bg-destructive/10 p-4 text-destructive">
                      <div className="flex items-center gap-2">
                        <AlertCircle className="h-5 w-5" />
                        <p className="font-medium">{error}</p>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* 右カラム: 発注フォーム - スクロール可能 */}
              <div className="flex-1 space-y-6">
                <Card className="elevation-2 border-0 bg-card p-6">
                  <div className="mb-6 flex items-center gap-2">
                    <div className="rounded-full bg-secondary/10 p-2">
                      <FileText className="h-5 w-5 text-secondary" />
                    </div>
                    <h2 className="text-xl font-semibold text-foreground">
                      3. 発注フォーム（抽出結果）
                    </h2>
                  </div>

                  <div className="space-y-6">
                    {/* ヘッダー情報 */}
                    <Card className="elevation-1 border-0 bg-gradient-to-br from-primary/5 to-transparent p-5">
                      <h3 className="mb-4 flex items-center gap-2 font-semibold text-primary">
                        <div className="h-1 w-1 rounded-full bg-primary" />
                        基本情報
                      </h3>
                      
                      <div className="grid gap-4 sm:grid-cols-2">
                        <div>
                          <label className="mb-2 block text-sm font-medium text-muted-foreground">
                            注 No
                          </label>
                          <Input
                            value={formData.orderNo}
                            onChange={(e) => handleFormChange('orderNo', e.target.value)}
                            className="elevation-1 border-0 bg-background font-mono"
                          />
                        </div>
                        <div>
                          <label className="mb-2 block text-sm font-medium text-muted-foreground">
                            見積書 No.
                          </label>
                          <Input
                            value={formData.quoteNo}
                            onChange={(e) => handleFormChange('quoteNo', e.target.value)}
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
                            onChange={(e) => handleFormChange('recipientCompany', e.target.value)}
                            className="elevation-1 border-0 bg-background"
                          />
                        </div>
                        <div>
                          <label className="mb-2 block text-sm font-medium text-muted-foreground">
                            発注元（自社名）
                          </label>
                          <Input
                            value={formData.issuerCompany}
                            onChange={(e) => handleFormChange('issuerCompany', e.target.value)}
                            className="elevation-1 border-0 bg-background"
                          />
                        </div>
                      </div>
                    </Card>

                    {/* 商品情報 */}
                    <Card className="elevation-1 border-0 bg-gradient-to-br from-secondary/5 to-transparent p-5">
                      <h3 className="mb-4 flex items-center gap-2 font-semibold text-secondary">
                        <div className="h-1 w-1 rounded-full bg-secondary" />
                        商品情報
                      </h3>
                      
                      <div className="space-y-4">
                        <div>
                          <label className="mb-2 block text-sm font-medium text-muted-foreground">
                            品名
                          </label>
                          <Input
                            value={formData.productName}
                            onChange={(e) => handleFormChange('productName', e.target.value)}
                            className="elevation-1 border-0 bg-background"
                          />
                        </div>

                        <div>
                          <label className="mb-2 block text-sm font-medium text-muted-foreground">
                            摘要
                          </label>
                          <Textarea
                            value={formData.description}
                            onChange={(e) => handleFormChange('description', e.target.value)}
                            className="elevation-1 border-0 bg-background"
                            rows={2}
                          />
                        </div>

                        <div className="grid gap-4 sm:grid-cols-3">
                          <div>
                            <label className="mb-2 block text-sm font-medium text-muted-foreground">
                              数量
                            </label>
                            <Input
                              value={formData.quantity}
                              onChange={(e) => handleFormChange('quantity', e.target.value)}
                              className="elevation-1 border-0 bg-background"
                            />
                          </div>
                          <div>
                            <label className="mb-2 block text-sm font-medium text-muted-foreground">
                              単価
                            </label>
                            <Input
                              value={formData.unitPrice}
                              onChange={(e) => handleFormChange('unitPrice', e.target.value)}
                              className="elevation-1 border-0 bg-background font-mono"
                            />
                          </div>
                          <div>
                            <label className="mb-2 block text-sm font-medium text-muted-foreground">
                              金額
                            </label>
                            <Input
                              value={formData.amount}
                              onChange={(e) => handleFormChange('amount', e.target.value)}
                              className="elevation-1 border-0 bg-background font-mono"
                            />
                          </div>
                        </div>

                        <div className="elevation-2 rounded-lg bg-accent/20 p-4">
                          <label className="mb-2 block text-sm font-semibold text-accent-foreground">
                            合計（税抜）
                          </label>
                          <Input
                            value={formData.totalAmount}
                            onChange={(e) => handleFormChange('totalAmount', e.target.value)}
                            className="border-0 bg-accent text-lg font-bold text-accent-foreground"
                          />
                        </div>
                      </div>
                    </Card>

                    {/* 納期・条件 */}
                    <Card className="elevation-1 border-0 bg-gradient-to-br from-accent/5 to-transparent p-5">
                      <h3 className="mb-4 flex items-center gap-2 font-semibold text-accent-foreground">
                        <div className="h-1 w-1 rounded-full bg-accent" />
                        納期・条件
                      </h3>
                      
                      <div className="space-y-4">
                        <div className="grid gap-4 sm:grid-cols-2">
                          <div>
                            <label className="mb-2 block text-sm font-medium text-muted-foreground">
                              希望納期
                            </label>
                            <Input
                              value={formData.desiredDeliveryDate}
                              onChange={(e) => handleFormChange('desiredDeliveryDate', e.target.value)}
                              className="elevation-1 border-0 bg-background"
                            />
                          </div>
                          <div>
                            <label className="mb-2 block text-sm font-medium text-muted-foreground">
                              請納期
                            </label>
                            <Input
                              value={formData.requestedDeliveryDate}
                              onChange={(e) => handleFormChange('requestedDeliveryDate', e.target.value)}
                              className="elevation-1 border-0 bg-background"
                              placeholder="（空欄）"
                            />
                          </div>
                        </div>

                        <div>
                          <label className="mb-2 block text-sm font-medium text-muted-foreground">
                            支払条件
                          </label>
                          <Input
                            value={formData.paymentTerms}
                            onChange={(e) => handleFormChange('paymentTerms', e.target.value)}
                            className="elevation-1 border-0 bg-background"
                          />
                        </div>

                        <div>
                          <label className="mb-2 block text-sm font-medium text-muted-foreground">
                            受渡場所
                          </label>
                          <Input
                            value={formData.deliveryLocation}
                            onChange={(e) => handleFormChange('deliveryLocation', e.target.value)}
                            className="elevation-1 border-0 bg-background"
                          />
                        </div>

                        <div>
                          <label className="mb-2 block text-sm font-medium text-muted-foreground">
                            検査完了期日
                          </label>
                          <Input
                            value={formData.inspectionDeadline}
                            onChange={(e) => handleFormChange('inspectionDeadline', e.target.value)}
                            className="elevation-1 border-0 bg-background"
                          />
                        </div>
                      </div>
                    </Card>

                    {/* 担当者情報 */}
                    <Card className="elevation-1 border-0 bg-gradient-to-br from-primary/5 to-transparent p-5">
                      <h3 className="mb-4 flex items-center gap-2 font-semibold text-primary">
                        <div className="h-1 w-1 rounded-full bg-primary" />
                        担当者情報
                      </h3>
                      
                      <div className="space-y-4">
                        <div className="grid gap-4 sm:grid-cols-2">
                          <div>
                            <label className="mb-2 block text-sm font-medium text-muted-foreground">
                              担当
                            </label>
                            <Input
                              value={formData.manager}
                              onChange={(e) => handleFormChange('manager', e.target.value)}
                              className="elevation-1 border-0 bg-background"
                            />
                          </div>
                          <div>
                            <label className="mb-2 block text-sm font-medium text-muted-foreground">
                              承認
                            </label>
                            <Input
                              value={formData.approver}
                              onChange={(e) => handleFormChange('approver', e.target.value)}
                              className="elevation-1 border-0 bg-background"
                              placeholder="（空欄）"
                            />
                          </div>
                        </div>

                        <div>
                          <label className="mb-2 block text-sm font-medium text-muted-foreground">
                            自社住所
                          </label>
                          <Input
                            value={formData.issuerAddress}
                            onChange={(e) => handleFormChange('issuerAddress', e.target.value)}
                            className="elevation-1 border-0 bg-background"
                          />
                        </div>

                        <div className="grid gap-4 sm:grid-cols-2">
                          <div>
                            <label className="mb-2 block text-sm font-medium text-muted-foreground">
                              電話
                            </label>
                            <Input
                              value={formData.phone}
                              onChange={(e) => handleFormChange('phone', e.target.value)}
                              className="elevation-1 border-0 bg-background font-mono"
                            />
                          </div>
                          <div>
                            <label className="mb-2 block text-sm font-medium text-muted-foreground">
                              FAX
                            </label>
                            <Input
                              value={formData.fax}
                              onChange={(e) => handleFormChange('fax', e.target.value)}
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
          </Card>
        </div>
      </div>
    </div>
  )
}
