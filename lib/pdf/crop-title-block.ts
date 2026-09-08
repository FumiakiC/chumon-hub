import { PDFDocument } from 'pdf-lib'

import { logger } from '@/lib/logger'

// 単位変換定数: 1mm ≒ 2.8346ポイント
export const MM_TO_POINTS = 2.8346

// ISO用紙サイズ定義（mm単位）
const ISO_SIZES = {
  A4: { width: 210, height: 297 },
  A3: { width: 297, height: 420 },
  A2: { width: 420, height: 594 },
  A1: { width: 594, height: 841 },
} as const

export type IsoPageSize = 'A1' | 'A2' | 'A3' | 'A4'

// 各用紙サイズに対するクロップ領域設定（mm単位）
// ※ これらの値は後で微調整可能です
// 原点は右下隅: offsetX = 右端からの左方向オフセット, offsetY = 下端からの上方向オフセット
export const CROP_SETTINGS: Record<
  IsoPageSize,
  { width: number; height: number; offsetX: number; offsetY: number }
> = {
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
}

export type CropTitleBlockResult =
  | { ok: true; pdfBytes: Uint8Array; detectedSize: IsoPageSize }
  | { ok: false; reason: 'no-pages' }

/**
 * ページサイズからISO用紙サイズを判定
 * @param widthPt ページ幅（ポイント）
 * @param heightPt ページ高さ（ポイント）
 * @returns 検出されたISO用紙サイズ
 */
export function detectPageSize(widthPt: number, heightPt: number): IsoPageSize {
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
      return size as IsoPageSize
    }

    // 横向きチェック
    if (
      Math.abs(widthMm - isoHeight) <= TOLERANCE &&
      Math.abs(heightMm - isoWidth) <= TOLERANCE
    ) {
      return size as IsoPageSize
    }
  }

  // デフォルトはA2（最も一般的な図面サイズ）
  logger.warn(
    `Unknown page size: ${widthMm.toFixed(1)}mm x ${heightMm.toFixed(1)}mm. Defaulting to A2.`
  )
  return 'A2'
}

export async function cropTitleBlockPdf(
  input: Uint8Array
): Promise<CropTitleBlockResult> {
  const pdfDoc = await PDFDocument.load(input)

  const pageCount = pdfDoc.getPageCount()
  if (pageCount === 0) {
    return { ok: false, reason: 'no-pages' }
  }

  const page = pdfDoc.getPage(0)
  const { width: pageWidth, height: pageHeight } = page.getSize()

  const detectedSize = detectPageSize(pageWidth, pageHeight)
  const cropConfig = CROP_SETTINGS[detectedSize]

  const widthMm = (pageWidth / MM_TO_POINTS).toFixed(1)
  const heightMm = (pageHeight / MM_TO_POINTS).toFixed(1)
  logger.debug(
    `Detected size: ${detectedSize} (${widthMm}mm x ${heightMm}mm) | ` +
      `Crop: ${cropConfig.width}mm x ${cropConfig.height}mm`
  )

  const cropWidth = cropConfig.width * MM_TO_POINTS
  const cropHeight = cropConfig.height * MM_TO_POINTS
  const offsetX = cropConfig.offsetX * MM_TO_POINTS
  const offsetY = cropConfig.offsetY * MM_TO_POINTS

  const actualCropWidth = Math.min(cropWidth, pageWidth)
  const actualCropHeight = Math.min(cropHeight, pageHeight)

  const cropX = Math.max(0, pageWidth - actualCropWidth - offsetX)
  const cropY = Math.max(0, offsetY)

  const croppedPdfDoc = await PDFDocument.create()
  const [copiedPage] = await croppedPdfDoc.copyPages(pdfDoc, [0])

  copiedPage.setCropBox(cropX, cropY, actualCropWidth, actualCropHeight)
  copiedPage.setMediaBox(cropX, cropY, actualCropWidth, actualCropHeight)

  croppedPdfDoc.addPage(copiedPage)

  const pdfBytes = await croppedPdfDoc.save()
  return { ok: true, pdfBytes, detectedSize }
}
