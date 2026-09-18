import { PDFDocument, PDFName, degrees } from 'pdf-lib'
import { describe, expect, it } from 'vitest'

import {
  CROP_SETTINGS,
  type CropRect,
  type IsoPageSize,
  MM_TO_POINTS,
  type PageRotation,
  computeDisplayCropRect,
  cropTitleBlockPdf,
  detectPageSize,
  displayRectToUserSpace,
} from '@/lib/pdf/crop-title-block'

interface TestPage {
  size: IsoPageSize
  widthMm: number
  heightMm: number
}

const TEST_PAGES: TestPage[] = [
  { size: 'A4', widthMm: 210, heightMm: 297 },
  { size: 'A2', widthMm: 594, heightMm: 420 },
  { size: 'A2', widthMm: 100, heightMm: 100 },
]

async function makePdf(
  widthMm: number,
  heightMm: number,
  options: { rotation?: number; originXmm?: number; originYmm?: number } = {}
) {
  const document = await PDFDocument.create()
  const page = document.addPage([
    widthMm * MM_TO_POINTS,
    heightMm * MM_TO_POINTS,
  ])
  const originX = (options.originXmm ?? 0) * MM_TO_POINTS
  const originY = (options.originYmm ?? 0) * MM_TO_POINTS
  if (originX !== 0 || originY !== 0) {
    page.setMediaBox(
      originX,
      originY,
      widthMm * MM_TO_POINTS,
      heightMm * MM_TO_POINTS
    )
  }
  if (options.rotation !== undefined) {
    if (options.rotation % 90 === 0) {
      page.setRotation(degrees(options.rotation))
    } else {
      page.node.set(
        PDFName.of('Rotate'),
        document.context.obj(options.rotation)
      )
    }
  }
  return document.save()
}

interface RotationCase {
  rotation: PageRotation
  expected: CropRect
}

const TEST_RECT: CropRect = { x: 10, y: 20, width: 30, height: 40 }
const PAGE_WIDTH = 200
const PAGE_HEIGHT = 300

const ROTATION_CASES: RotationCase[] = [
  { rotation: 0, expected: { x: 10, y: 20, width: 30, height: 40 } },
  { rotation: 90, expected: { x: 140, y: 10, width: 40, height: 30 } },
  {
    rotation: 180,
    expected: { x: 160, y: 240, width: 30, height: 40 },
  },
  { rotation: 270, expected: { x: 20, y: 260, width: 40, height: 30 } },
]

function expectRect(actual: CropRect, expected: CropRect) {
  expect(actual.x).toBeCloseTo(expected.x)
  expect(actual.y).toBeCloseTo(expected.y)
  expect(actual.width).toBeCloseTo(expected.width)
  expect(actual.height).toBeCloseTo(expected.height)
}

describe('displayRectToUserSpace', () => {
  it.each(ROTATION_CASES)(
    '$rotation 度の変換式どおりに矩形を変換する',
    ({ rotation, expected }) => {
      expectRect(
        displayRectToUserSpace(TEST_RECT, PAGE_WIDTH, PAGE_HEIGHT, rotation),
        expected
      )
    }
  )
})

describe('computeDisplayCropRect', () => {
  it('ISO判定でA2へ落ちる高さ72mm未満のページでも矩形がページ内に収まる', () => {
    const displayWidth = 100 * MM_TO_POINTS
    const displayHeight = 50 * MM_TO_POINTS
    const detectedSize = detectPageSize(displayWidth, displayHeight)

    expect(detectedSize).toBe('A2')

    const rect = computeDisplayCropRect(
      displayWidth,
      displayHeight,
      detectedSize
    )

    expect(rect.x).toBeGreaterThanOrEqual(0)
    expect(rect.y).toBeGreaterThanOrEqual(0)
    expect(rect.x + rect.width).toBeLessThanOrEqual(displayWidth)
    expect(rect.y + rect.height).toBeLessThanOrEqual(displayHeight)
    expect(rect.y).toBe(0)
    expect(rect.height).toBe(displayHeight)
  })

  it('X方向も左右両端でclampし、矩形がページ内に収まる', () => {
    const displayWidth = 100 * MM_TO_POINTS
    const displayHeight = 100 * MM_TO_POINTS
    const rect = computeDisplayCropRect(displayWidth, displayHeight, 'A2')

    expect(rect.x).toBeGreaterThanOrEqual(0)
    expect(rect.x + rect.width).toBeLessThanOrEqual(displayWidth)
  })
})

describe('detectPageSize', () => {
  it.each(TEST_PAGES)(
    '$widthMm mm × $heightMm mm を $size と判定する',
    ({ size, widthMm, heightMm }) => {
      expect(
        detectPageSize(widthMm * MM_TO_POINTS, heightMm * MM_TO_POINTS)
      ).toBe(size)
    }
  )
})

describe('cropTitleBlockPdf', () => {
  it.each(TEST_PAGES)(
    '$widthMm mm × $heightMm mm を設定値とページサイズで clamp する',
    async ({ size, widthMm, heightMm }) => {
      const input = await makePdf(widthMm, heightMm)
      const result = await cropTitleBlockPdf(input)

      expect(result.ok).toBe(true)
      if (!result.ok) return

      expect(result.detectedSize).toBe(size)

      const output = await PDFDocument.load(result.pdfBytes)
      expect(output.getPageCount()).toBe(1)

      const mediaBox = output.getPage(0).getMediaBox()
      expect(mediaBox.width).toBeCloseTo(
        Math.min(
          CROP_SETTINGS[size].width * MM_TO_POINTS,
          widthMm * MM_TO_POINTS
        )
      )
      expect(mediaBox.height).toBeCloseTo(
        Math.min(
          CROP_SETTINGS[size].height * MM_TO_POINTS,
          heightMm * MM_TO_POINTS
        )
      )
    }
  )

  it('/Rotate 90 の A4 を表示上の右下でクロップし、回転を保持する', async () => {
    const input = await makePdf(210, 297, { rotation: 90 })
    const result = await cropTitleBlockPdf(input)

    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.detectedSize).toBe('A4')
    const output = await PDFDocument.load(result.pdfBytes)
    const page = output.getPage(0)

    expectRect(page.getMediaBox(), {
      x: 133 * MM_TO_POINTS,
      y: 3 * MM_TO_POINTS,
      width: 70 * MM_TO_POINTS,
      height: 290 * MM_TO_POINTS,
    })
    expectRect(page.getCropBox(), page.getMediaBox())
    expect(page.getRotation().angle).toBe(90)
  })

  it('/Rotate 180 の A4 を変換式どおりにクロップし、回転を保持する', async () => {
    const input = await makePdf(210, 297, { rotation: 180 })
    const result = await cropTitleBlockPdf(input)

    expect(result.ok).toBe(true)
    if (!result.ok) return

    const output = await PDFDocument.load(result.pdfBytes)
    const page = output.getPage(0)

    expectRect(page.getMediaBox(), {
      x: 0,
      y: 220 * MM_TO_POINTS,
      width: 210 * MM_TO_POINTS,
      height: 70 * MM_TO_POINTS,
    })
    expectRect(page.getCropBox(), page.getMediaBox())
    expect(page.getRotation().angle).toBe(180)
  })

  it('/Rotate 270 の A4 を変換式どおりにクロップし、回転を保持する', async () => {
    const input = await makePdf(210, 297, { rotation: 270 })
    const result = await cropTitleBlockPdf(input)

    expect(result.ok).toBe(true)
    if (!result.ok) return

    const output = await PDFDocument.load(result.pdfBytes)
    const page = output.getPage(0)

    expectRect(page.getMediaBox(), {
      x: 7 * MM_TO_POINTS,
      y: 4 * MM_TO_POINTS,
      width: 70 * MM_TO_POINTS,
      height: 290 * MM_TO_POINTS,
    })
    expectRect(page.getCropBox(), page.getMediaBox())
    expect(page.getRotation().angle).toBe(270)
  })

  it('MediaBox の非ゼロ原点を変換後の矩形へ加算する', async () => {
    const input = await makePdf(210, 297, {
      rotation: 90,
      originXmm: 10,
      originYmm: 20,
    })
    const result = await cropTitleBlockPdf(input)

    expect(result.ok).toBe(true)
    if (!result.ok) return

    const output = await PDFDocument.load(result.pdfBytes)
    expectRect(output.getPage(0).getMediaBox(), {
      x: 143 * MM_TO_POINTS,
      y: 23 * MM_TO_POINTS,
      width: 70 * MM_TO_POINTS,
      height: 290 * MM_TO_POINTS,
    })
  })

  it('90 の倍数でない /Rotate は 0 として扱い、例外を投げない', async () => {
    const input = await makePdf(210, 297, { rotation: 45 })
    const result = await cropTitleBlockPdf(input)

    expect(result.ok).toBe(true)
    if (!result.ok) return

    const output = await PDFDocument.load(result.pdfBytes)
    const page = output.getPage(0)
    expectRect(page.getMediaBox(), {
      x: 0,
      y: 7 * MM_TO_POINTS,
      width: 210 * MM_TO_POINTS,
      height: 70 * MM_TO_POINTS,
    })
    expect(page.getRotation().angle).toBe(0)
  })
})
