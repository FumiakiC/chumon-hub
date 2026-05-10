import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

const CIRCLED_NUMBERS = '①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳'
const DRAWING_NUMBER_WITH_QTY_REGEX = /^(\d{2}[A-Za-z]\d{3}-\d{3})([\d①-⑳]+)?$/

function toQuantity(value: string): number | null {
  if (!value) {
    return null
  }

  if (/^\d+$/.test(value)) {
    return Number(value)
  }

  let converted = ''
  for (const char of value) {
    if (/^\d$/.test(char)) {
      converted += char
      continue
    }

    const index = CIRCLED_NUMBERS.indexOf(char)
    if (index === -1) {
      return null
    }
    converted += String(index + 1)
  }

  return converted ? Number(converted) : null
}

export function parseDrawingNumber(input: string): { drawingNo: string; quantity: number | null } {
  const normalized = input.trim()
  const match = normalized.match(DRAWING_NUMBER_WITH_QTY_REGEX)

  if (!match) {
    return { drawingNo: normalized, quantity: null }
  }

  const [, drawingNo, qtyRaw = ''] = match
  return {
    drawingNo,
    quantity: toQuantity(qtyRaw),
  }
}
