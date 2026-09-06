import { NextRequest, NextResponse } from 'next/server'

import {
  checkRequestBodySize,
  readFormData,
  validateUploadFile,
} from '@/lib/ai/pipeline'
import { validationErrorResponse } from '@/lib/errors'
import { logger } from '@/lib/logger'
import { cropTitleBlockPdf } from '@/lib/pdf/crop-title-block'

interface CroppedFile {
  fileName: string
  base64: string
}

export async function POST(request: NextRequest) {
  try {
    // proxy のボディバッファ上限による切り詰めを、パース前に明示的な 413 へ落とす。
    const sizeCheck = checkRequestBodySize(request)
    if (!sizeCheck.ok) {
      logger.warn('Request rejected by the early body size guard')
      return validationErrorResponse(sizeCheck.status)
    }

    // FormDataを取得（パース失敗は壊れた入力なので 400。500 に落とさない）
    const parsed = await readFormData(request)
    if (!parsed.ok) {
      return validationErrorResponse(parsed.status)
    }

    const { formData } = parsed
    // `as File[]` は string エントリを File と偽って通し、後段の file.type 参照で
    // TypeError → 500 を招くため除去する。実体の検証は validateUploadFile に委譲。
    const files = formData.getAll('file')

    if (!files || files.length === 0) {
      return NextResponse.json(
        { error: 'ファイルがアップロードされていません' },
        { status: 400 }
      )
    }

    const croppedFileResults: (CroppedFile | null)[] = []

    // OOM回避のため並列処理を避け、1件ずつ順次処理する
    for (const file of files) {
      // 入力検証は集中実装に委譲する（instanceof File → 400 / 25MB 超過 → 413 /
      // マジックバイト不一致 → 415）。申告値 file.type・拡張子は詐称可能なので信頼しない。
      const validation = await validateUploadFile(file)
      if (!validation.ok) {
        logger.warn(`Upload validation failed (status: ${validation.status})`)
        return validationErrorResponse(validation.status)
      }

      // 許可 MIME には画像も含まれるが、本ルートは pdf-lib に渡すため PDF のみ通す。
      if (validation.mimeType !== 'application/pdf') {
        logger.warn('Rejecting non-PDF upload')
        return validationErrorResponse(415)
      }

      try {
        // 検証済みバッファをそのまま使う（arrayBuffer の二重読み込みと余分なコピーを避ける）
        const cropResult = await cropTitleBlockPdf(validation.buffer)

        if (!cropResult.ok) {
          logger.warn('No pages found in PDF')
          croppedFileResults.push(null)
          continue
        }

        // Base64に変換（Data URI形式）
        const base64String = Buffer.from(cropResult.pdfBytes).toString('base64')
        const dataUri = `data:application/pdf;base64,${base64String}`

        croppedFileResults.push({
          fileName: validation.file.name,
          base64: dataUri,
        })
      } catch (fileError) {
        logger.error('Error processing file:', fileError)
        // 個別のファイルエラーは警告として処理し、処理を続行
        croppedFileResults.push(null)
      }
    }

    const croppedFiles = croppedFileResults.filter(
      (croppedFile): croppedFile is CroppedFile => croppedFile !== null
    )

    // 処理結果がない場合
    if (croppedFiles.length === 0) {
      return NextResponse.json(
        { error: '有効なPDFファイルを処理できませんでした' },
        { status: 400 }
      )
    }

    // 成功レスポンス
    return NextResponse.json({
      croppedFiles,
    })
  } catch (error) {
    logger.error('Error in crop-title-block API:', error)
    return NextResponse.json(
      { error: 'PDFのクロップ処理中にエラーが発生しました' },
      { status: 500 }
    )
  }
}
