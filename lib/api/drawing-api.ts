/**
 * Drawing API
 * Handles API communication for document processing tasks
 */

/**
 * Crops the title block from a PDF file
 * @param file The original File object to crop
 * @returns Promise resolving to a File object containing the cropped content
 */
export async function cropTitleBlock(file: File): Promise<File> {
  const formData = new FormData()
  formData.append("file", file)

  const response = await fetch("/api/crop-title-block", {
    method: "POST",
    body: formData,
  })

  if (!response.ok) {
    throw new Error(`Failed to crop PDF: ${response.status}`)
  }

  const blob = await response.blob()
  return new File([blob], file.name, { type: file.type })
}

/**
 * Extracts drawing data from a PDF file
 * @param croppedFile The cropped File object
 * @returns Promise resolving to the extracted drawing data
 */
export async function extractDrawingData(croppedFile: File): Promise<any> {
  const formData = new FormData()
  formData.append("file", croppedFile)

  const response = await fetch("/api/extract-drawing", {
    method: "POST",
    body: formData,
  })

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}))
    const errorMessage =
      errorData?.error ||
      errorData?.message ||
      `API Error (${response.status})`
    throw new Error(errorMessage)
  }

  return await response.json()
}
