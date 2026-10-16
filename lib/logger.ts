export type LogFields = Readonly<
  Record<string, string | number | boolean | undefined>
>

export type ErrorLogFields = {
  name: string
  status?: number
  code?: string
  causeCode?: string
}

function readErrorProperty(error: object, key: string): unknown {
  try {
    return Reflect.get(error, key)
  } catch {
    // Unreadable fields are omitted so logging cannot replace the original error.
    return undefined
  }
}

/**
 * ApiError の message は API の応答本文そのもので、JSON.parse の例外は入力の
 * 一部を含むため、message と stack は残さない。
 * 正規表現は値の形式を制限するだけで、安全性の保証ではない。
 * name と code は自前のクラスとライブラリが付ける値を前提とする。
 *
 * Error 判定と対象プロパティの読み取りで発生した同期例外は外へ伝播させない。
 * 取得不能な任意項目は省略し、name が判定不能なら UnknownError にする。
 * getter／Proxy の任意の副作用や処理の終了までは保証しない。
 */
export function toErrorLogFields(error: unknown): ErrorLogFields {
  const fields: ErrorLogFields = { name: typeof error }
  let isError = false
  try {
    isError = error instanceof Error
  } catch {
    fields.name = 'UnknownError'
  }

  if (typeof error !== 'object' || error === null) return fields

  if (isError) {
    const name = readErrorProperty(error, 'name')
    fields.name =
      typeof name === 'string' && /^[A-Za-z_$][A-Za-z0-9_$]{0,63}$/.test(name)
        ? name
        : 'UnknownError'
  }

  const status = readErrorProperty(error, 'status')
  if (
    typeof status === 'number' &&
    Number.isInteger(status) &&
    status >= 100 &&
    status <= 599
  ) {
    fields.status = status
  }

  const code = readErrorProperty(error, 'code')
  if (typeof code === 'string' && /^[A-Z][A-Z0-9_]{0,63}$/.test(code)) {
    fields.code = code
  }

  const cause = readErrorProperty(error, 'cause')
  if (typeof cause === 'object' && cause !== null) {
    const causeCode = readErrorProperty(cause, 'code')
    if (
      typeof causeCode === 'string' &&
      /^[A-Z][A-Z0-9_]{0,63}$/.test(causeCode)
    ) {
      fields.causeCode = causeCode
    }
  }

  return fields
}

/**
 * Thin console wrapper used to centralize application logging.
 * Debug and info logs are suppressed in production.
 */
export const logger = {
  debug: (...data: unknown[]) => {
    if (process.env.NODE_ENV !== 'production') {
      console.debug(...data)
    }
  },
  info: (message: string, fields?: LogFields) => {
    if (process.env.NODE_ENV !== 'production') {
      if (fields === undefined) console.info(message)
      else console.info(message, fields)
    }
  },
  warn: (message: string, fields?: LogFields) => {
    if (fields === undefined) console.warn(message)
    else console.warn(message, fields)
  },
  error: (message: string, fields?: LogFields) => {
    if (fields === undefined) console.error(message)
    else console.error(message, fields)
  },
}
