import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { AppError } from '@/lib/errors'

import {
  CROP_CONCURRENCY,
  cropTitleBlock,
  extractDrawingData,
} from './drawing-api'

const file = new File(['%PDF-1.7'], 'fixture.pdf', { type: 'application/pdf' })
const cropped = { base64: 'data:image/png;base64,AA==', mimeType: 'image/png' }

function successResponse() {
  return Response.json({
    croppedFiles: [{ fileName: 'fixture.pdf', ...cropped }],
  })
}

describe('drawing API', () => {
  const fetchMock = vi.fn<typeof fetch>()

  beforeEach(() => {
    vi.useFakeTimers()
    vi.spyOn(Math, 'random').mockReturnValue(0.5)
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('preserves successful crop requests and returns PNG data', async () => {
    fetchMock.mockResolvedValueOnce(successResponse())
    await expect(cropTitleBlock(file)).resolves.toEqual(cropped)
    expect(CROP_CONCURRENCY).toBe(2)
    expect(fetchMock).toHaveBeenCalledOnce()
    const [url, options] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/crop-title-block')
    expect(options?.method).toBe('POST')
    expect(options?.body).toBeInstanceOf(FormData)
    expect((options?.body as FormData).get('file')).toBe(file)
    expect(vi.getTimerCount()).toBe(0)
  })

  it.each([null, 'invalid', 'Wed, 21 Oct 2015 07:28:00 GMT', '0', '-1', '1.5'])(
    'retries at 2000ms then 4000ms for Retry-After %s',
    async (header) => {
      const limited = () =>
        new Response('Busy', {
          status: 429,
          headers: header === null ? {} : { 'Retry-After': header },
        })
      fetchMock
        .mockResolvedValueOnce(limited())
        .mockResolvedValueOnce(limited())
        .mockResolvedValueOnce(successResponse())
      const result = cropTitleBlock(file)
      await vi.advanceTimersByTimeAsync(1999)
      expect(fetchMock).toHaveBeenCalledTimes(1)
      await vi.advanceTimersByTimeAsync(1)
      expect(fetchMock).toHaveBeenCalledTimes(2)
      await vi.advanceTimersByTimeAsync(3999)
      expect(fetchMock).toHaveBeenCalledTimes(2)
      await vi.advanceTimersByTimeAsync(1)
      await expect(result).resolves.toEqual(cropped)
      expect(fetchMock).toHaveBeenCalledTimes(3)
      expect(vi.getTimerCount()).toBe(0)
    }
  )

  it('honors each Retry-After header even when the 429 body has another code', async () => {
    fetchMock
      .mockResolvedValueOnce(
        Response.json(
          { code: 'ERR_VALIDATION' },
          { status: 429, headers: { 'Retry-After': '3' } }
        )
      )
      .mockResolvedValueOnce(
        new Response('Busy', { status: 429, headers: { 'Retry-After': '1' } })
      )
      .mockResolvedValueOnce(successResponse())
    const result = cropTitleBlock(file)
    await vi.advanceTimersByTimeAsync(2999)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(999)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(1)
    await expect(result).resolves.toEqual(cropped)
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('stops retrying as soon as the second attempt succeeds', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response('Busy', { status: 429 }))
      .mockResolvedValueOnce(successResponse())
    const result = cropTitleBlock(file)
    await vi.runAllTimersAsync()
    await expect(result).resolves.toEqual(cropped)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it.each(['text', 'wrong-code'])(
    'stops after three 429 responses with %s bodies',
    async (body) => {
      fetchMock.mockImplementation(async () =>
        body === 'text'
          ? new Response('Busy', { status: 429 })
          : Response.json({ code: 'ERR_VALIDATION' }, { status: 429 })
      )
      const result = cropTitleBlock(file)
      const rejected = expect(result).rejects.toMatchObject({
        code: 'ERR_TOO_MANY_REQUESTS',
      })
      const typed = expect(result).rejects.toBeInstanceOf(AppError)
      await vi.runAllTimersAsync()
      await rejected
      await typed
      expect(fetchMock).toHaveBeenCalledTimes(3)
      expect(vi.getTimerCount()).toBe(0)
    }
  )

  it.each([
    [400, 'ERR_VALIDATION'],
    [413, 'ERR_FILE_TOO_LARGE'],
    [415, 'ERR_UNSUPPORTED_MEDIA'],
    [401, 'ERR_UNAUTHORIZED'],
    [500, 'ERR_REQUEST_FAILED'],
  ] as const)('does not retry status %s', async (status, code) => {
    fetchMock.mockResolvedValueOnce(
      Response.json({ error: 'Request rejected' }, { status })
    )
    await expect(cropTitleBlock(file)).rejects.toMatchObject({ code })
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('does not retry a non-429 response even if its body contains the rate limit code', async () => {
    fetchMock.mockResolvedValueOnce(
      Response.json({ code: 'ERR_TOO_MANY_REQUESTS' }, { status: 500 })
    )
    await expect(cropTitleBlock(file)).rejects.toMatchObject({
      code: 'ERR_TOO_MANY_REQUESTS',
    })
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
  })

  it.each(['throw', 'reject'])(
    'propagates fetch %s unchanged without retry',
    async (mode) => {
      const error = new TypeError('Network unavailable')
      fetchMock.mockImplementation(() => {
        if (mode === 'throw') throw error
        return Promise.reject(error)
      })
      await expect(cropTitleBlock(file)).rejects.toBe(error)
      expect(fetchMock).toHaveBeenCalledOnce()
      expect(vi.getTimerCount()).toBe(0)
    }
  )

  it('does not retry a network failure following a 429', async () => {
    const error = new TypeError('Network unavailable')
    fetchMock
      .mockResolvedValueOnce(new Response('Busy', { status: 429 }))
      .mockRejectedValueOnce(error)
    const rejected = expect(cropTitleBlock(file)).rejects.toBe(error)
    await vi.runAllTimersAsync()
    await rejected
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('preserves invalid crop result validation', async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ croppedFiles: [] }))
    await expect(cropTitleBlock(file)).rejects.toMatchObject({
      code: 'ERR_INVALID_RESULT',
    })
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it('preserves the successful extraction request and JSON response', async () => {
    const extracted = { parts: [] }
    fetchMock.mockResolvedValueOnce(Response.json(extracted))
    await expect(extractDrawingData(file)).resolves.toEqual(extracted)
    expect(fetchMock).toHaveBeenCalledOnce()
    const [url, options] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/extract-drawing')
    expect(options?.method).toBe('POST')
    expect(options?.body).toBeInstanceOf(FormData)
    expect((options?.body as FormData).get('file')).toBe(file)
    expect(vi.getTimerCount()).toBe(0)
  })
})
