import { NextRequest, NextResponse } from "next/server"
import { PDFDocument } from "pdf-lib"

// 単位変換定数: 1mm ≒ 2.8346ポイント
const MM_TO_POINTS = 2.8346

// ISO用紙サイズ定義（mm単位）
const ISO_SIZES = {
  A4: { width: 210, height: 297 },
  A3: { width: 297, height: 420 },
  A2: { width: 420, height: 594 },
  A1: { width: 594, height: 841 },
} as const

// 各用紙サイズに対するクロップ領域設定（mm単位）
// ※ これらの値は後で微調整可能です
// 原点は右下隅: offsetX = 右端からの左方向オフセット, offsetY = 下端からの上方向オフセット
const CROP_SETTINGS = {
  A1: {
    width: 200, // クロップ幅
    height: 110, // クロップ高さ
    offsetX: 0, // 右端からのオフセット（左方向）
    offsetY: 0, // 下端からのオフセット（上方向）
  },
  A2: {
    width: 198,
    height: 60,
    offsetX: 10,
    offsetY: 12,
  },
  A3: {
    width: 210,
    height: 85,
    offsetX: 5,
    offsetY: 7,
  },
  A4: {
    width: 290,
    height: 70,
    offsetX: 4,
    offsetY: 7,
  },
} as const

type ISOSize = keyof typeof ISO_SIZES

interface CroppedFile {
  fileName: string
  base64: string
}

/**
 * ページサイズからISO用紙サイズを判定
 * @param widthPt ページ幅（ポイント）
 * @param heightPt ページ高さ（ポイント）
 * @returns 検出されたISO用紙サイズ
 */
function detectPageSize(widthPt: number, heightPt: number): ISOSize {
  const widthMm = widthPt / MM_TO_POINTS
  const heightMm = heightPt / MM_TO_POINTS

  // 許容誤差（mm）- 印刷時の微小な誤差を考慮
  const TOLERANCE = 5

  // 縦横どちらの向きでも対応（横向き/縦向き）
  for (const [size, dimensions] of Object.entries(ISO_SIZES)) {
    const { width: isoWidth, height: isoHeight } = dimensions

    // 縦向きチェック
    if (
      Math.abs(widthMm - isoWidth) <= TOLERANCE &&
      Math.abs(heightMm - isoHeight) <= TOLERANCE
    ) {
      return size as ISOSize
    }

    // 横向きチェック
    if (
      Math.abs(widthMm - isoHeight) <= TOLERANCE &&
      Math.abs(heightMm - isoWidth) <= TOLERANCE
    ) {
      return size as ISOSize
    }
  }

  // デフォルトはA2（最も一般的な図面サイズ）
  console.warn(
    `Unknown page size: ${widthMm.toFixed(1)}mm x ${heightMm.toFixed(1)}mm. Defaulting to A2.`
  )
  return "A2"
}

export async function POST(request: NextRequest) {
  try {
    // FormDataを取得
    const formData = await request.formData()
    const files = formData.getAll("file") as File[]

    if (!files || files.length === 0) {
      return NextResponse.json(
        { error: "ファイルがアップロードされていません" },
        { status: 400 }
      )
    }

    const croppedFiles: CroppedFile[] = []

    // 各ファイルを処理
    for (const file of files) {
      // PDFファイルかチェック
      if (!file.type.includes("pdf") && !file.name.endsWith(".pdf")) {
        console.warn(`Skipping non-PDF file: ${file.name}`)
        continue
      }

      try {
        // ファイルをArrayBufferとして読み込む
        const arrayBuffer = await file.arrayBuffer()
        const uint8Array = new Uint8Array(arrayBuffer)

        // PDFドキュメントをロード
        const pdfDoc = await PDFDocument.load(uint8Array)

        // ページ数を確認
        const pageCount = pdfDoc.getPageCount()
        if (pageCount === 0) {
          console.warn(`No pages found in: ${file.name}`)
          continue
        }

        // 1ページ目を取得
        const page = pdfDoc.getPage(0)
        const { width: pageWidth, height: pageHeight } = page.getSize()

        // ページサイズを検出
        const detectedSize = detectPageSize(pageWidth, pageHeight)
        const cropConfig = CROP_SETTINGS[detectedSize]

        // ログ出力: 検出されたページサイズ
        const widthMm = (pageWidth / MM_TO_POINTS).toFixed(1)
        const heightMm = (pageHeight / MM_TO_POINTS).toFixed(1)
        console.log(
          `[${file.name}] Detected size: ${detectedSize} (${widthMm}mm x ${heightMm}mm) | ` +
            `Crop: ${cropConfig.width}mm x ${cropConfig.height}mm`
        )

        // クロップ領域をポイント単位に変換
        const cropWidth = cropConfig.width * MM_TO_POINTS
        const cropHeight = cropConfig.height * MM_TO_POINTS
        const offsetX = cropConfig.offsetX * MM_TO_POINTS
        const offsetY = cropConfig.offsetY * MM_TO_POINTS

        // クロップ領域が元のページサイズを超えないか確認
        const actualCropWidth = Math.min(cropWidth, pageWidth)
        const actualCropHeight = Math.min(cropHeight, pageHeight)

        // 右下を原点とした座標を計算（PDFの原点は左下）
        // cropX: 右端から左にoffsetX、そこからさらに左にcropWidth分
        // cropY: 下端から上にoffsetY
        const cropX = pageWidth - actualCropWidth - offsetX
        const cropY = offsetY

        // 新しいPDFドキュメントを作成
        const croppedPdfDoc = await PDFDocument.create()

        // 元のページから新しいページにコピー
        const [copiedPage] = await croppedPdfDoc.copyPages(pdfDoc, [0])

        // クロップボックスを設定
        copiedPage.setCropBox(cropX, cropY, actualCropWidth, actualCropHeight)

        // メディアボックスもクロップボックスに合わせて設定
        copiedPage.setMediaBox(cropX, cropY, actualCropWidth, actualCropHeight)

        // 新しいページサイズを設定（実際のクロップ領域に合わせる）
        copiedPage.setSize(actualCropWidth, actualCropHeight)

        // ページを追加
        croppedPdfDoc.addPage(copiedPage)

        // PDFをバイト配列として保存
        const croppedPdfBytes = await croppedPdfDoc.save()

        // Base64に変換（Data URI形式）
        const base64String = Buffer.from(croppedPdfBytes).toString("base64")
        const dataUri = `data:application/pdf;base64,${base64String}`

        croppedFiles.push({
          fileName: file.name,
          base64: dataUri,
        })
      } catch (fileError) {
        console.error(`Error processing file ${file.name}:`, fileError)
        // 個別のファイルエラーは警告として処理し、処理を続行
        continue
      }
    }

    // 処理結果がない場合
    if (croppedFiles.length === 0) {
      return NextResponse.json(
        { error: "有効なPDFファイルを処理できませんでした" },
        { status: 400 }
      )
    }

    // 成功レスポンス
    return NextResponse.json({
      croppedFiles,
    })
  } catch (error) {
    console.error("Error in crop-title-block API:", error)
    return NextResponse.json(
      { error: "PDFのクロップ処理中にエラーが発生しました" },
      { status: 500 }
    )
  }
}
