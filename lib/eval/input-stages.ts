import { cropTitleBlockPdf } from '@/lib/pdf/crop-title-block'

export type InputStageId = 'A' | 'C2p'

export interface StageSource {
  buffer: Uint8Array
  fileName: string
}

export interface StageOutput {
  buffer: Buffer
  mimeType: 'application/pdf'
  displayName: string
}

export interface InputStage {
  id: InputStageId
  /** 人向け表示名。例: "A: crop-title-block 経由" / "C-2′: 墨消し済み golden をそのまま" */
  label: string
  prepare(source: StageSource): Promise<StageOutput>
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
        displayName: source.fileName,
      }
    },
  },
}
