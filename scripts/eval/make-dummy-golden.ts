import { access, mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'

import { goldenSetSchema } from '@/lib/eval/label'
import { CROP_SETTINGS, MM_TO_POINTS } from '@/lib/pdf/crop-title-block'

function fail(message: string): never {
  process.stderr.write(`${message}\n`)
  process.exit(1)
}

function mm(value: number): number {
  return value * MM_TO_POINTS
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath)
    return true
  } catch (error) {
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 'ENOENT'
    ) {
      return false
    }
    throw error
  }
}

async function makeDummyPdf(): Promise<Uint8Array> {
  const document = await PDFDocument.create()
  const pageWidthMm = 594
  const pageHeightMm = 420
  const page = document.addPage([mm(pageWidthMm), mm(pageHeightMm)])
  const font = await document.embedFont(StandardFonts.Helvetica)
  const black = rgb(0, 0, 0)

  const crop = CROP_SETTINGS.A2
  const cropX = pageWidthMm - crop.width - crop.offsetX
  const cropY = crop.offsetY

  // 表題欄はクロップ領域内の左側に配置し、右側に数量記号用の余白を残す。
  const frameX = cropX + 5
  const frameY = cropY + 5
  const frameWidth = 155
  const frameHeight = 50

  page.drawRectangle({
    x: mm(frameX),
    y: mm(frameY),
    width: mm(frameWidth),
    height: mm(frameHeight),
    borderColor: black,
    borderWidth: 1,
  })

  for (const y of [frameY + 16, frameY + 32]) {
    page.drawLine({
      start: { x: mm(frameX), y: mm(y) },
      end: { x: mm(frameX + frameWidth), y: mm(y) },
      color: black,
      thickness: 0.7,
    })
  }

  const textOptions = { font, size: 12, color: black }
  page.drawText('MATERIAL SS400', {
    x: mm(frameX + 4),
    y: mm(frameY + 5),
    ...textOptions,
  })
  page.drawText('NAME BRACKET', {
    x: mm(frameX + 4),
    y: mm(frameY + 21),
    ...textOptions,
  })
  page.drawText('DWG NO 12D925-101', {
    x: mm(frameX + 4),
    y: mm(frameY + 37),
    ...textOptions,
  })

  // 同じクロップ領域内かつ表題欄の外側に、粗さ記号を模した V と数量を配置。
  const symbolX = cropX + crop.width - 19
  const symbolY = cropY + 15
  page.drawLine({
    start: { x: mm(symbolX), y: mm(symbolY + 8) },
    end: { x: mm(symbolX + 4), y: mm(symbolY) },
    color: black,
    thickness: 1.2,
  })
  page.drawLine({
    start: { x: mm(symbolX + 4), y: mm(symbolY) },
    end: { x: mm(symbolX + 8), y: mm(symbolY + 8) },
    color: black,
    thickness: 1.2,
  })
  page.drawText('4', {
    x: mm(symbolX + 2.5),
    y: mm(symbolY + 12),
    ...textOptions,
  })

  return document.save()
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      out: { type: 'string' },
    },
  })

  if (!values.out) {
    fail('--out <dir> は必須です。')
  }

  const outputDir = path.resolve(values.out)
  const labelsPath = path.join(outputDir, 'labels.json')
  if (await exists(labelsPath)) {
    fail(`既存の labels.json は上書きしません: ${labelsPath}`)
  }

  const pdfDir = path.join(outputDir, 'pdf')
  const pdfPath = path.join(pdfDir, 'dummy-001.pdf')
  await mkdir(pdfDir, { recursive: true })

  const labels = goldenSetSchema.parse([
    {
      caseId: 'dummy-001',
      file: 'pdf/dummy-001.pdf',
      expected: {
        drawingNo: '12D925-101',
        partName: 'BRACKET',
        material: 'SS400',
        quantity: 4,
        surfaceTreatment: '',
        notes: '',
      },
      memo: '合成ダミー。ハーネスの配線確認用であり、抽出精度を保証しない。',
    },
  ])

  const pdfBytes = await makeDummyPdf()
  await writeFile(pdfPath, pdfBytes)
  await writeFile(labelsPath, `${JSON.stringify(labels, null, 2)}\n`, {
    encoding: 'utf8',
    flag: 'wx',
  })

  process.stdout.write(`created: ${labelsPath}\n`)
  process.stdout.write(`created: ${pdfPath}\n`)
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error)
  process.stderr.write(`${message}\n`)
  process.exit(1)
})
