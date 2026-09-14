import { PDFDocument, degrees } from 'pdf-lib'

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

// ページの回転角（/Rotate）。pdf-lib は読み取り時に 90 の倍数を保証しないため、
// 正規化して 90 の倍数でない場合は 0 として扱う。
export type PageRotation = 0 | 90 | 180 | 270

export interface CropRect {
  x: number
  y: number
  width: number
  height: number
}

/**
 * 表示（/Rotate 適用後）座標系の矩形を PDF ユーザー空間の矩形へ変換する。
 * pageWidth / pageHeight は MediaBox の幅・高さ（未回転）。MediaBox 原点の加算は呼び出し側で行う。
 */
export function displayRectToUserSpace(
  rect: CropRect,
  pageWidth: number,
  pageHeight: number,
  rotation: PageRotation
): CropRect {
  const { x: dx, y: dy, width: dw, height: dh } = rect
  const W = pageWidth
  const H = pageHeight

  switch (rotation) {
    case 90:
      return { x: W - dy - dh, y: dx, width: dh, height: dw }
    case 180:
      return { x: W - dx - dw, y: H - dy - dh, width: dw, height: dh }
    case 270:
      return { x: dy, y: H - dx - dw, width: dh, height: dw }
    case 0:
    default:
      return { x: dx, y: dy, width: dw, height: dh }
  }
}

/**
 * 任意の角度を 0/90/180/270 に正規化する。90 の倍数でない場合は 0 を返す。
 */
function normalizeRotation(angle: number): PageRotation {
  const normalized = ((angle % 360) + 360) % 360
  if (
    normalized === 0 ||
    normalized === 90 ||
    normalized === 180 ||
    normalized === 270
  ) {
    return normalized
  }
  return 0
}

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

  const rawAngle = page.getRotation().angle
  const rotation = normalizeRotation(rawAngle)
  const isNonOrthogonalRotation = rotation === 0 && rawAngle % 90 !== 0
  if (isNonOrthogonalRotation) {
    logger.warn(
      `Non-orthogonal page rotation: ${rawAngle}deg. Treating as 0deg.`
    )
  }

  // MediaBox は未回転の幅・高さと原点を返す。
  const mediaBox = page.getMediaBox()

  // 表示（/Rotate 適用後）サイズ。90/270 は幅・高さを入れ替える。
  const displayWidth =
    rotation === 90 || rotation === 270 ? mediaBox.height : mediaBox.width
  const displayHeight =
    rotation === 90 || rotation === 270 ? mediaBox.width : mediaBox.height

  const detectedSize = detectPageSize(displayWidth, displayHeight)
  const cropConfig = CROP_SETTINGS[detectedSize]

  const widthMm = (displayWidth / MM_TO_POINTS).toFixed(1)
  const heightMm = (displayHeight / MM_TO_POINTS).toFixed(1)
  logger.debug(
    `Detected size: ${detectedSize} (${widthMm}mm x ${heightMm}mm, rotation ${rotation}deg) | ` +
      `Crop: ${cropConfig.width}mm x ${cropConfig.height}mm`
  )

  const cropWidth = cropConfig.width * MM_TO_POINTS
  const cropHeight = cropConfig.height * MM_TO_POINTS
  const offsetX = cropConfig.offsetX * MM_TO_POINTS
  const offsetY = cropConfig.offsetY * MM_TO_POINTS

  // 以降の矩形計算はすべて表示座標系で行う。
  // 原点は右下: offsetX は右端から左方向、offsetY は下端から上方向。
  const actualCropWidth = Math.min(cropWidth, displayWidth)
  const actualCropHeight = Math.min(cropHeight, displayHeight)

  const cropX = Math.max(0, displayWidth - actualCropWidth - offsetX)
  const cropY = Math.max(0, offsetY)

  // 表示座標系の矩形を PDF ユーザー空間へ変換し、MediaBox 原点を加算する。
  const userRect = displayRectToUserSpace(
    { x: cropX, y: cropY, width: actualCropWidth, height: actualCropHeight },
    mediaBox.width,
    mediaBox.height,
    rotation
  )
  const finalX = userRect.x + mediaBox.x
  const finalY = userRect.y + mediaBox.y

  const croppedPdfDoc = await PDFDocument.create()
  const [copiedPage] = await croppedPdfDoc.copyPages(pdfDoc, [0])

  copiedPage.setCropBox(finalX, finalY, userRect.width, userRect.height)
  copiedPage.setMediaBox(finalX, finalY, userRect.width, userRect.height)

  // 不正な /Rotate は 0 扱いに正規化し、クロップ座標と表示の向きを一致させる。
  if (isNonOrthogonalRotation) {
    copiedPage.setRotation(degrees(0))
  }

  croppedPdfDoc.addPage(copiedPage)

  const pdfBytes = await croppedPdfDoc.save()
  return { ok: true, pdfBytes, detectedSize }
}
