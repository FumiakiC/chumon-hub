import { createCanvas, loadImage } from '@napi-rs/canvas'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { PDFDocument, StandardFonts, degrees, rgb } from 'pdf-lib'
import { describe, expect, it, vi } from 'vitest'

import { ConfigError } from '@/lib/errors'
import { logger } from '@/lib/logger'
import {
  MM_TO_POINTS,
  type PageRotation,
  computeDisplayCropRect,
  displayRectToUserSpace,
} from '@/lib/pdf/crop-title-block'
import {
  MAX_RENDER_PIXELS,
  PDFJS_DATA_FILES,
  rasterizeCropRegion,
  resolvePdfjsDataUrl,
} from '@/lib/pdf/raster-crop'

const A4_WIDTH_PT = 210 * MM_TO_POINTS
const A4_HEIGHT_PT = 297 * MM_TO_POINTS
const ROTATIONS: PageRotation[] = [0, 90, 180, 270]

interface DecodedPng {
  width: number
  height: number
  data: Uint8ClampedArray
}

async function decodePng(pngBytes: Uint8Array): Promise<DecodedPng> {
  const image = await loadImage(Buffer.from(pngBytes))
  const canvas = createCanvas(image.width, image.height)
  const context = canvas.getContext('2d')
  context.drawImage(image, 0, 0)
  return {
    width: image.width,
    height: image.height,
    data: context.getImageData(0, 0, image.width, image.height).data,
  }
}

function countPixels(
  data: Uint8ClampedArray,
  predicate: (red: number, green: number, blue: number) => boolean
): number {
  let count = 0
  for (let index = 0; index < data.length; index += 4) {
    if (predicate(data[index], data[index + 1], data[index + 2])) {
      count += 1
    }
  }
  return count
}

async function makeA4PdfWithDisplayRect(
  rotation: PageRotation,
  placement: 'crop' | 'outside'
): Promise<Uint8Array> {
  const document = await PDFDocument.create()
  const page = document.addPage([A4_WIDTH_PT, A4_HEIGHT_PT])
  page.setRotation(degrees(rotation))

  const displayWidth =
    rotation === 90 || rotation === 270 ? A4_HEIGHT_PT : A4_WIDTH_PT
  const displayHeight =
    rotation === 90 || rotation === 270 ? A4_WIDTH_PT : A4_HEIGHT_PT
  const cropRect = computeDisplayCropRect(displayWidth, displayHeight, 'A4')

  const displayRect =
    placement === 'crop'
      ? cropRect
      : {
          x: 0,
          y: displayHeight - 20 * MM_TO_POINTS,
          width: 20 * MM_TO_POINTS,
          height: 20 * MM_TO_POINTS,
        }

  const userRect = displayRectToUserSpace(
    displayRect,
    A4_WIDTH_PT,
    A4_HEIGHT_PT,
    rotation
  )
  page.drawRectangle({
    x: userRect.x,
    y: userRect.y,
    width: userRect.width,
    height: userRect.height,
    color: rgb(0, 0, 0),
    borderWidth: 0,
  })

  return document.save()
}

async function makeHelveticaPdf(): Promise<Uint8Array> {
  const document = await PDFDocument.create()
  const page = document.addPage([A4_WIDTH_PT, A4_HEIGHT_PT])
  // StandardFonts.Helvetica はフォントプログラムを埋め込まず、PDF の標準14フォントを
  // 名前で参照する。pdfjs-dist 同梱の standard_fonts を読めないと文字が欠落する。
  const font = await document.embedFont(StandardFonts.Helvetica)
  const cropRect = computeDisplayCropRect(A4_WIDTH_PT, A4_HEIGHT_PT, 'A4')
  page.drawText('CHUMON HUB 1234567890', {
    x: cropRect.x + 10 * MM_TO_POINTS,
    y: cropRect.y + 25 * MM_TO_POINTS,
    size: 24,
    font,
    color: rgb(0, 0, 0),
  })
  return document.save()
}

describe('rasterizeCropRegion', () => {
  it.each(['crop', 'outside'] as const)(
    '#343 原点・幅・高さが異なるCropBoxの右下を基準に描画する: %s',
    async (placement) => {
      const document = await PDFDocument.create()
      const page = document.addPage([A4_WIDTH_PT + 200, A4_HEIGHT_PT + 300])
      const originX = 50
      const originY = 100
      page.setCropBox(originX, originY, A4_WIDTH_PT, A4_HEIGHT_PT)
      const cropRect = computeDisplayCropRect(A4_WIDTH_PT, A4_HEIGHT_PT, 'A4')
      const rectangle =
        placement === 'crop'
          ? {
              x: originX + cropRect.x,
              y: originY + cropRect.y,
              width: cropRect.width,
              height: cropRect.height,
            }
          : {
              x: originX + cropRect.x,
              y: originY + cropRect.height + 30,
              width: 20,
              height: 20,
            }
      page.drawRectangle({ ...rectangle, color: rgb(0, 0, 0) })
      page.drawRectangle({
        x: A4_WIDTH_PT + 160,
        y: 10,
        width: 20,
        height: 20,
        color: rgb(1, 0, 0),
      })

      const result = await rasterizeCropRegion(await document.save(), {
        dpi: 72,
      })
      expect(result.ok).toBe(true)
      if (!result.ok) return

      expect(result.detectedSize).toBe('A4')
      expect(result.widthPx).toBe(Math.round(cropRect.width))
      expect(result.heightPx).toBe(Math.round(cropRect.height))
      const image = await decodePng(result.pngBytes)
      const matchingPixels = countPixels(image.data, (red, green, blue) =>
        placement === 'crop'
          ? red < 32 && green < 32 && blue < 32
          : red > 240 && green > 240 && blue > 240
      )
      expect(matchingPixels / (image.width * image.height)).toBeGreaterThan(
        0.98
      )
      expect(
        countPixels(
          image.data,
          (red, green, blue) => red > 200 && green < 32 && blue < 32
        )
      ).toBe(0)
    }
  )

  it.each(ROTATIONS)(
    '/Rotate $0 の切り出し領域と一致する黒矩形をほぼ黒く描画する',
    async (rotation) => {
      const input = await makeA4PdfWithDisplayRect(rotation, 'crop')
      const result = await rasterizeCropRegion(input, { dpi: 72 })

      expect(result.ok).toBe(true)
      if (!result.ok) return

      const image = await decodePng(result.pngBytes)
      const darkPixels = countPixels(
        image.data,
        (red, green, blue) => red < 32 && green < 32 && blue < 32
      )
      expect(darkPixels / (image.width * image.height)).toBeGreaterThan(0.98)
    }
  )

  it.each(ROTATIONS)(
    '/Rotate $0 の切り出し領域外にある黒矩形を描画せず、ほぼ白になる',
    async (rotation) => {
      const input = await makeA4PdfWithDisplayRect(rotation, 'outside')
      const result = await rasterizeCropRegion(input, { dpi: 72 })

      expect(result.ok).toBe(true)
      if (!result.ok) return

      const image = await decodePng(result.pngBytes)
      const whitePixels = countPixels(
        image.data,
        (red, green, blue) => red > 240 && green > 240 && blue > 240
      )
      expect(whitePixels / (image.width * image.height)).toBeGreaterThan(0.99)
    }
  )

  it('NodeのBuffer入力を受け付け、呼び出し側の入力をdetachしない', async () => {
    const pdfBytes = await makeA4PdfWithDisplayRect(0, 'crop')
    const input = Buffer.from(pdfBytes)
    const originalByteLength = input.byteLength

    const result = await rasterizeCropRegion(input, { dpi: 72 })

    expect(Buffer.isBuffer(input)).toBe(true)
    expect(result.ok).toBe(true)
    expect(input.byteLength).toBe(originalByteLength)
    expect(input.byteLength).toBeGreaterThan(0)
  })

  it('出力PNGの幅と高さを切り出しpt×dpi/72の四捨五入で求める', async () => {
    const input = await makeA4PdfWithDisplayRect(0, 'crop')
    const dpi = 144
    const result = await rasterizeCropRegion(input, { dpi })

    expect(result.ok).toBe(true)
    if (!result.ok) return

    const cropRect = computeDisplayCropRect(A4_WIDTH_PT, A4_HEIGHT_PT, 'A4')
    const expectedWidth = Math.round((cropRect.width * dpi) / 72)
    const expectedHeight = Math.round((cropRect.height * dpi) / 72)
    const image = await decodePng(result.pngBytes)

    expect(result.widthPx).toBe(expectedWidth)
    expect(result.heightPx).toBe(expectedHeight)
    expect(image.width).toBe(expectedWidth)
    expect(image.height).toBe(expectedHeight)
  })

  it('画素数上限を超えるdpiでは描画せずtoo-many-pixelsを返す', async () => {
    const input = await makeA4PdfWithDisplayRect(0, 'crop')
    const result = await rasterizeCropRegion(input, { dpi: 1000 })

    expect(result).toEqual({ ok: false, reason: 'too-many-pixels' })

    const cropRect = computeDisplayCropRect(A4_WIDTH_PT, A4_HEIGHT_PT, 'A4')
    const widthPx = Math.round((cropRect.width * 1000) / 72)
    const heightPx = Math.round((cropRect.height * 1000) / 72)
    expect(widthPx * heightPx).toBeGreaterThan(MAX_RENDER_PIXELS)
  })

  it('pdfjs同梱データの代表ファイルが実在する', () => {
    for (const [subdirectory, files] of Object.entries(PDFJS_DATA_FILES)) {
      const dataUrl = resolvePdfjsDataUrl(subdirectory)
      expect(dataUrl.endsWith(path.sep)).toBe(true)

      for (const file of files) {
        expect(existsSync(path.join(dataUrl, file))).toBe(true)
      }
    }
  })

  it('非埋め込みHelveticaを警告なしで同梱標準フォントから描画する', async () => {
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => undefined)

    try {
      const input = await makeHelveticaPdf()
      const result = await rasterizeCropRegion(input, { dpi: 144 })

      expect(result.ok).toBe(true)
      if (!result.ok) return

      const image = await decodePng(result.pngBytes)
      const darkPixels = countPixels(
        image.data,
        (red, green, blue) => red < 96 && green < 96 && blue < 96
      )

      expect(darkPixels).toBeGreaterThan(1_000)
      expect(warnSpy).not.toHaveBeenCalled()
    } finally {
      warnSpy.mockRestore()
    }
  })

  it('存在しない同梱データディレクトリはConfigErrorになる', () => {
    expect(() => resolvePdfjsDataUrl('missing-data')).toThrow(ConfigError)
  })

  it('pdfjs警告は固定warnと原文のみのdebugに振り分ける', () => {
    const wrappedWarn = console.warn
    const consoleWarnSpy = vi
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined)
    const consoleDebugSpy = vi
      .spyOn(console, 'debug')
      .mockImplementation(() => undefined)
    const warnSpy = vi.spyOn(logger, 'warn')
    const debugSpy = vi.spyOn(logger, 'debug')
    try {
      wrappedWarn('Warning: synthetic pdfjs warning', 'must not be forwarded')
      expect(warnSpy).toHaveBeenCalledExactlyOnceWith(
        'PDF renderer emitted a warning'
      )
      expect(debugSpy).toHaveBeenCalledExactlyOnceWith(
        'Warning: synthetic pdfjs warning'
      )
      expect(consoleWarnSpy).toHaveBeenCalledExactlyOnceWith(
        'PDF renderer emitted a warning'
      )
      expect(consoleDebugSpy).toHaveBeenCalledExactlyOnceWith(
        'Warning: synthetic pdfjs warning'
      )
    } finally {
      warnSpy.mockRestore()
      debugSpy.mockRestore()
      consoleWarnSpy.mockRestore()
      consoleDebugSpy.mockRestore()
    }
  })

  it('再ロードでも警告ラッパーは二重適用されない', async () => {
    const wrappedWarn = console.warn
    vi.resetModules()
    await import('@/lib/pdf/raster-crop')
    expect(console.warn).toBe(wrappedWarn)
  })

  it('代表ファイル欠落はConfigErrorになり、検証結果を再利用する', async () => {
    vi.resetModules()
    const existsSpy = vi.fn(() => false)
    vi.doMock('node:fs', () => ({ existsSync: existsSpy }))
    try {
      const { resolvePdfjsDataUrl: resolveDataUrl } =
        await import('@/lib/pdf/raster-crop')
      const { ConfigError: ReloadedConfigError } = await import('@/lib/errors')
      expect(() => resolveDataUrl('standard_fonts')).toThrow(
        ReloadedConfigError
      )
      expect(() => resolveDataUrl('standard_fonts')).toThrow(
        ReloadedConfigError
      )
      expect(existsSpy).toHaveBeenCalledTimes(1)
      existsSpy.mockReturnValue(true)
      const dataUrl = resolveDataUrl('wasm')
      expect(resolveDataUrl('wasm')).toBe(dataUrl)
      expect(existsSpy).toHaveBeenCalledTimes(1 + PDFJS_DATA_FILES.wasm.length)
    } finally {
      vi.doUnmock('node:fs')
      vi.resetModules()
    }
  })
})
