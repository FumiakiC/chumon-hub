import { cropTitleBlockPdf } from '@/lib/pdf/crop-title-block'
import { MAX_RENDER_PIXELS, rasterizeCropRegion } from '@/lib/pdf/raster-crop'

export type InputStageId = 'A' | 'C2p' | 'C1'

export interface StageSource {
  buffer: Uint8Array
  fileName: string
}

export interface StageOutput {
  buffer: Buffer
  mimeType: 'application/pdf' | 'image/png'
  /** tmp ファイル名に使う拡張子（ドットなし）。 */
  ext: 'pdf' | 'png'
  displayName: string
}

export interface StagePrepareOptions {
  dpi: number
}

export interface InputStage {
  id: InputStageId
  /** 人向け表示名。例: "A: crop-title-block 経由" / "C-2′: 墨消し済み golden をそのまま" */
  label: string
  prepare(
    source: StageSource,
    options: StagePrepareOptions
  ): Promise<StageOutput>
}

type StagePreparationErrorCode =
  | 'ERR_STAGE_NO_PAGES'
  | 'ERR_STAGE_TOO_MANY_PIXELS'

class StagePreparationError extends Error {
  readonly name = 'StagePreparationError'

  constructor(
    readonly code: StagePreparationErrorCode,
    message: string
  ) {
    super(message)
  }
}

export const INPUT_STAGES: Record<InputStageId, InputStage> = {
  A: {
    id: 'A',
    label: 'A: crop-title-block 経由',
    async prepare(source) {
      const result = await cropTitleBlockPdf(source.buffer)
      if (!result.ok) {
        throw new Error(`No pages found in PDF: ${source.fileName}`)
      }

      return {
        buffer: Buffer.from(result.pdfBytes),
        mimeType: 'application/pdf',
        ext: 'pdf',
        displayName: source.fileName,
      }
    },
  },
  C2p: {
    id: 'C2p',
    label: 'C-2′: 墨消し済み golden をそのまま',
    async prepare(source) {
      return {
        buffer: Buffer.isBuffer(source.buffer)
          ? source.buffer
          : Buffer.from(source.buffer),
        mimeType: 'application/pdf',
        ext: 'pdf',
        displayName: source.fileName,
      }
    },
  },
  C1: {
    id: 'C1',
    label: 'C-1: ラスタライズ→クロップ (PNG)',
    async prepare(source, options) {
      const result = await rasterizeCropRegion(source.buffer, {
        dpi: options.dpi,
      })
      if (!result.ok) {
        // 失敗理由が分かる固定文言にする（ファイル名・PDF 内容は含めない）。
        if (result.reason === 'no-pages') {
          throw new StagePreparationError(
            'ERR_STAGE_NO_PAGES',
            'ラスタライズに失敗しました: PDF にページがありません'
          )
        }
        throw new StagePreparationError(
          'ERR_STAGE_TOO_MANY_PIXELS',
          `ラスタライズに失敗しました: 切り出し画素数が上限（${MAX_RENDER_PIXELS} px）を超えました`
        )
      }

      const pngName = source.fileName.replace(/\.[^.]+$/, '') + '.png'
      return {
        buffer: Buffer.from(result.pngBytes),
        mimeType: 'image/png',
        ext: 'png',
        displayName: pngName,
      }
    },
  },
}
