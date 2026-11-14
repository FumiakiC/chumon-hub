// Temporary PR-only measurement fixtures; remove before merging this PR.
import { createCanvas } from '@napi-rs/canvas'
import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'

import {
  MM_TO_POINTS,
  computeDisplayCropRect,
  detectPageSize,
} from '@/lib/pdf/crop-title-block'

class FixtureError extends Error {
  readonly code = 'ERR_MEMORY_FIXTURE'
}

function randomSource(seed: number): () => number {
  let value = seed >>> 0
  return () => {
    value = (Math.imul(value, 1664525) + 1013904223) >>> 0
    return value / 0x100000000
  }
}

async function makeFixture(id: number, directory: string) {
  const landscape = id !== 0
  const widthMm = id === 1 ? 594 : landscape ? 841 : 210
  const heightMm = id === 1 ? 420 : landscape ? 594 : 297
  const width = widthMm * MM_TO_POINTS
  const height = heightMm * MM_TO_POINTS
  const document = await PDFDocument.create()
  const fixedDate = new Date('2000-01-01T00:00:00.000Z')
  document.setCreationDate(fixedDate)
  document.setModificationDate(fixedDate)
  document.setProducer('chumon-hub synthetic memory fixture')
  document.setCreator('chumon-hub synthetic memory fixture')
  document.setTitle(`F${id} synthetic drawing`)
  const page = document.addPage([width, height])
  const font = await document.embedFont(StandardFonts.Helvetica)
  const iso = detectPageSize(width, height)
  const crop = computeDisplayCropRect(width, height, iso)
  const random = randomSource(0x12345678 + id)
  const images: {
    width: number
    height: number
    pixels: number
    colorSpace: string
    dpi: number
  }[] = []

  if (id === 1 || id === 2) {
    const imageWidth = id === 1 ? 3374 : 4768
    const imageHeight = id === 1 ? 2390 : 3370
    const canvas = createCanvas(imageWidth, imageHeight)
    const context = canvas.getContext('2d')
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, imageWidth, imageHeight)
    context.lineWidth = 2
    for (let index = 0; index < 4000; index += 1) {
      context.strokeStyle = id === 2 && index % 5 === 0 ? '#285080' : '#202020'
      const x = Math.floor(random() * imageWidth)
      const y = Math.floor(random() * imageHeight)
      context.beginPath()
      context.moveTo(x, y)
      context.lineTo(
        Math.min(imageWidth - 1, x + 10 + Math.floor(random() * 180)),
        y + Math.floor(random() * 60)
      )
      context.stroke()
    }
    const image = await document.embedPng(canvas.toBuffer('image/png'))
    page.drawImage(image, { x: 0, y: 0, width, height })
    images.push({
      width: imageWidth,
      height: imageHeight,
      pixels: imageWidth * imageHeight,
      colorSpace: 'DeviceRGB',
      dpi: 144,
    })
  }

  if (id === 3) {
    for (let index = 0; index < 20_000; index += 1) {
      const x = random() * width
      const y = random() * height
      page.drawLine({
        start: { x, y },
        end: {
          x: Math.min(width, x + random() * 40),
          y: Math.min(height, y + random() * 20),
        },
        color: rgb(0, 0, 0),
        thickness: 0.4,
      })
    }
  }

  if (id !== 0) {
    page.drawLine({
      start: { x: crop.x + 18, y: crop.y + 18 },
      end: { x: crop.x + crop.width - 18, y: crop.y + 18 },
      color: rgb(0, 0, 0),
      thickness: 2,
    })
  }
  for (const [index, text] of [
    `SYNTHETIC FIXTURE F${id}`,
    'PART BRACKET  MATERIAL SS400',
    'DRAWING DEMO  QUANTITY 4',
  ].entries()) {
    page.drawText(text, {
      x: crop.x + 24,
      y: crop.y + 40 + index * 24,
      font,
      size: 14,
      color: rgb(0, 0, 0),
    })
  }

  const bytes = await document.save()
  if (bytes.byteLength >= 25_000_000) {
    throw new FixtureError(`F${id} is not below 25 MB`)
  }
  await writeFile(resolve(directory, `F${id}.pdf`), bytes, { flag: 'wx' })
  return {
    fixture: `F${id}`,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    bytes: bytes.byteLength,
    page: {
      widthPt: width,
      heightPt: height,
      widthMm,
      heightMm,
      iso,
      orientation: landscape ? 'landscape' : 'portrait',
    },
    images,
  }
}

async function main() {
  if (!process.argv[2]) throw new FixtureError('Output directory is required')
  const directory = resolve(process.argv[2])
  await mkdir(directory, { recursive: true })
  const fixtures = []
  for (let id = 0; id < 4; id += 1) {
    const fixture = await makeFixture(id, directory)
    fixtures.push(fixture)
    process.stdout.write(`${JSON.stringify(fixture)}\n`)
  }
  await writeFile(
    resolve(directory, 'manifest.json'),
    `${JSON.stringify(fixtures, null, 2)}\n`,
    { flag: 'wx' }
  )
}

main().catch(() => {
  process.stderr.write('ERR_MEMORY_FIXTURE: fixture generation failed\n')
  process.exitCode = 1
})
