import { PDFDocument } from 'pdf-lib'
import { describe, expect, it } from 'vitest'

import {
  CROP_SETTINGS,
  type IsoPageSize,
  MM_TO_POINTS,
  cropTitleBlockPdf,
  detectPageSize,
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

async function makePdf(widthMm: number, heightMm: number) {
  const document = await PDFDocument.create()
  document.addPage([widthMm * MM_TO_POINTS, heightMm * MM_TO_POINTS])
  return document.save()
}

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
})
