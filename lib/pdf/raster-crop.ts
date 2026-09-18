import { createCanvas } from '@napi-rs/canvas'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'

import { ConfigError } from '@/lib/errors'
import { logger } from '@/lib/logger'
import {
  type IsoPageSize,
  computeDisplayCropRect,
  detectPageSize,
} from '@/lib/pdf/crop-title-block'

/**
 * 出力画素数の上限。RGBA 4 バイト/画素で約 64MB。
 * A1（594mm × 841mm ≒ 1684pt × 2384pt）を 300dpi でページ全体描画すると
 * 約 7015 × 9933 ≒ 6970 万画素になり、切り出しをしても高 DPI では容易に
 * 数千万画素へ達する。RGBA バッファ（幅 × 高さ × 4）が 64MB を超えないよう、
 * 16,000,000 画素（≒ 64MB）を上限とする。
 */
export const MAX_RENDER_PIXELS = 16_000_000

/** ラスタライズ切り出しの標準 DPI。 */
const DEFAULT_DPI = 300

/** PDF ユーザー空間は 72 単位/インチ。dpi/72 が描画スケールになる。 */
const POINTS_PER_INCH = 72

export type RasterCropResult =
  | {
      ok: true
      pngBytes: Uint8Array
      detectedSize: IsoPageSize
      widthPx: number
      heightPx: number
      dpi: number
    }
  | { ok: false; reason: 'no-pages' | 'too-many-pixels' }

export const PDFJS_DATA_FILES = {
  standard_fonts: ['LiberationSans-Regular.ttf', 'FoxitDingbats.pfb'],
  wasm: ['jbig2.wasm', 'openjpeg.wasm', 'qcms_bg.wasm'],
  cmaps: ['UniJIS-UCS2-H.bcmap'],
  iccs: ['CGATS001Compat-v2-micro.icc'],
} as const

const dataUrls = new Map<string, string | ConfigError>()
const pdfjsWarnMarker = Symbol.for('chumon-hub.pdfjsWarn')
type MarkedWarn = typeof console.warn & { [pdfjsWarnMarker]?: boolean }

if (!(console.warn as MarkedWarn)[pdfjsWarnMarker]) {
  const originalWarn = console.warn.bind(console)
  console.warn = Object.assign(
    (...args: unknown[]) => {
      const message = args[0]
      if (typeof message === 'string' && message.startsWith('Warning: ')) {
        logger.warn('PDF renderer emitted a warning')
        logger.debug(message)
        return
      }
      originalWarn(...args)
    },
    { [pdfjsWarnMarker]: true }
  )
}

/**
 * pdfjs-dist に同梱されたデータのディレクトリを解決する。
 * pdfjs の仕様に合わせ、末尾はセパレータ付きで返す。
 */
export function resolvePdfjsDataUrl(subdirectory: string): string {
  const cached = dataUrls.get(subdirectory)
  if (cached instanceof ConfigError) throw cached
  if (cached !== undefined) return cached

  try {
    const files = Object.entries(PDFJS_DATA_FILES).find(
      ([directory]) => directory === subdirectory
    )?.[1]
    if (!files) throw new ConfigError('Unknown PDF renderer data directory')

    const require = createRequire(import.meta.url)
    const pkgPath = require.resolve('pdfjs-dist/package.json')
    const dataUrl = path.join(path.dirname(pkgPath), subdirectory) + path.sep
    if (!files.every((file) => existsSync(path.join(dataUrl, file)))) {
      throw new ConfigError('PDF renderer bundled data is missing')
    }
    dataUrls.set(subdirectory, dataUrl)
    return dataUrl
  } catch (error) {
    const configError =
      error instanceof ConfigError
        ? error
        : new ConfigError('Cannot resolve PDF renderer bundled data', {
            cause: error,
          })
    dataUrls.set(subdirectory, configError)
    throw configError
  }
}

/**
 * PDF の 1 ページ目の表題欄領域「だけ」をラスタライズして PNG を返す。
 *
 * ページ全体を描いてから切り抜く実装にはしない（A1 を高 DPI で描くとメモリが
 * 跳ねるため）。切り出し矩形サイズのキャンバスを用意し、render の `transform` で
 * 領域原点をキャンバス左上へ平行移動して、その領域だけを描画する。
 *
 * 画素数は 切り出し幅(pt) * dpi / 72 の四捨五入。高さも同じ。
 *
 * 基準箱の注意（この PR では対処せずコメントのみ）:
 * - pdfjs の `getViewport` は **CropBox（MediaBox との交差）** を基準に表示座標系を
 *   組み立てる。一方 `cropTitleBlockPdf` は **MediaBox** を基準に切り出す。
 *   CropBox ≠ MediaBox の PDF では両者の切り出し領域がずれうる。
 * - ここで `detectPageSize` に渡す表示サイズは viewport 由来（= CropBox 基準・
 *   /Rotate 適用後）である。用紙判定と矩形計算はこの表示座標系で一貫して行う。
 */
export async function rasterizeCropRegion(
  input: Uint8Array,
  options?: { dpi?: number }
): Promise<RasterCropResult> {
  const dpi = options?.dpi ?? DEFAULT_DPI
  const scale = dpi / POINTS_PER_INCH

  // pdfjs は `getDocument` の内部で `Buffer` を明示的に拒否する
  // （"Please provide binary data as `Uint8Array`, rather than `Buffer`." を throw）。
  // 評価ハーネスは node:fs の readFile が返す Buffer を渡してくるため、素の
  // Uint8Array へ正規化する。さらに pdfjs は渡したバッファを detach するので、
  // 呼び出し側の入力を壊さないよう必ず複製を渡す（input 自体は渡さない）。
  const data = new Uint8Array(input.byteLength)
  data.set(input)

  // 信頼できない PDF を読む。pdfjs 6.3.289 では eval を使う経路そのものが無く、
  // CVE-2024-4367 の回避策として使われていた `isEvalSupported` も廃止済み。
  // 将来 pdfjs の依存を差し替える場合は、eval 経路の有無を再確認すること。
  // 標準フォント・WASMデコーダ・定義済みCMap・ICCプロファイルはすべて
  // pdfjs-distの同梱データから解決し、OSや外部ネットワークに依存させない。
  // これらを未指定にすると警告だけで処理が続き、文字や画像が無言で欠落しうる。
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs')

  const loadingTask = getDocument({
    data,
    useSystemFonts: false,
    standardFontDataUrl: resolvePdfjsDataUrl('standard_fonts'),
    wasmUrl: resolvePdfjsDataUrl('wasm'),
    cMapUrl: resolvePdfjsDataUrl('cmaps'),
    iccUrl: resolvePdfjsDataUrl('iccs'),
  })

  try {
    // 解析自体の失敗（loadingTask.promise の reject）は握り潰さず伝播させる。
    const pdfDocument = await loadingTask.promise
    if (pdfDocument.numPages === 0) {
      return { ok: false, reason: 'no-pages' }
    }

    const page = await pdfDocument.getPage(1)

    // viewport は /Rotate 適用済みの表示座標系を返す。この経路では
    // displayRectToUserSpace は使わない。
    const viewport = page.getViewport({ scale })

    // 表示サイズ（pt）は viewport を scale で割って求める。
    const displayWidthPt = viewport.width / scale
    const displayHeightPt = viewport.height / scale

    const detectedSize = detectPageSize(displayWidthPt, displayHeightPt)
    const cropRect = computeDisplayCropRect(
      displayWidthPt,
      displayHeightPt,
      detectedSize
    )

    const widthPx = Math.round((cropRect.width * dpi) / POINTS_PER_INCH)
    const heightPx = Math.round((cropRect.height * dpi) / POINTS_PER_INCH)

    // DoS 対策: 描画に入る前に画素数上限を確認する。
    if (widthPx * heightPx > MAX_RENDER_PIXELS) {
      return { ok: false, reason: 'too-many-pixels' }
    }

    const canvas = createCanvas(widthPx, heightPx)
    const context = canvas.getContext('2d')

    // PDF の背景は透明なので、描画前に白で塗りつぶす。
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, widthPx, heightPx)

    // 領域だけを描画する。pdfjs は左上原点なので Y を反転して平行移動量を求める。
    // offsetX は切り出し左端、offsetY は表示座標系（左下原点）の上端に対応する。
    const offsetX = cropRect.x * scale
    const offsetY = (displayHeightPt - cropRect.y - cropRect.height) * scale

    const renderTask = page.render({
      canvas: canvas as unknown as HTMLCanvasElement,
      viewport,
      transform: [1, 0, 0, 1, -offsetX, -offsetY],
    })
    await renderTask.promise

    const pngBytes = await canvas.encode('png')

    return {
      ok: true,
      pngBytes,
      detectedSize,
      widthPx,
      heightPx,
      dpi,
    }
  } finally {
    // loadingTask を必ず破棄してドキュメント・worker・メモリを解放する。
    await loadingTask.destroy()
  }
}
