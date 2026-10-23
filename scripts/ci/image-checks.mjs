// 手元で実行: docker run --rm --platform linux/amd64 --entrypoint node -v "$PWD/scripts/ci:/smoke-scripts:ro" <image> /smoke-scripts/image-checks.mjs
// 全文が必要な場合は手元で確認: docker run --rm --platform linux/amd64 --entrypoint node <image> -e "require('/app/node_modules/@napi-rs/canvas')"
import assert from 'node:assert/strict'
import {
  lstat,
  mkdtemp,
  readFile,
  rm,
  rmdir,
  stat,
  unlink,
  writeFile,
} from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

class ImageCheckError extends Error {
  code = 'ERR_IMAGE_CHECK'

  constructor(operation, expected, cause) {
    super('Production image check failed', { cause })
    this.name = 'ImageCheckError'
    this.operation = operation
    this.expected = expected
  }
}

async function step(operation, expected, action) {
  try {
    return await action()
  } catch (error) {
    throw new ImageCheckError(operation, expected, error)
  }
}

function diagnostics(error) {
  const chain = []
  for (let depth = 0; error != null && depth < 5; depth++) {
    const name =
      typeof error.name === 'string' &&
      /^[A-Za-z_$][A-Za-z0-9_$]{0,63}$/.test(error.name)
        ? error.name
        : 'UnknownError'
    const entry = { name }
    if (
      typeof error.code === 'string' &&
      /^[A-Z0-9_]{1,64}$/.test(error.code)
    ) {
      entry.code = error.code
    }
    const tokens = new Set()
    if (typeof error.message === 'string') {
      for (const pattern of [
        /\blib[\w+.-]*\.so(?:\.\d+)*\b/g,
        /\bGLIBC(?:XX)?_\d+(?:\.\d+)*\b/g,
        /@napi-rs\/canvas-[a-z0-9-]+/g,
      ]) {
        for (const [token] of error.message.matchAll(pattern)) {
          tokens.add(token)
          if (tokens.size === 10) break
        }
        if (tokens.size === 10) break
      }
    }
    entry.tokens = [...tokens]
    chain.push(entry)
    error = error.cause
  }
  return chain
}

async function runCheck(name, action) {
  try {
    await action()
    process.stdout.write(`PASS ${name}\n`)
  } catch (error) {
    const failures = error instanceof AggregateError ? error.errors : [error]
    const details = failures.map((failure) => ({
      operation:
        failure instanceof ImageCheckError ? failure.operation : 'run check',
      expected:
        failure instanceof ImageCheckError
          ? failure.expected
          : 'check succeeds',
      errors: diagnostics(
        failure instanceof ImageCheckError ? failure.cause : failure
      ),
    }))
    process.stderr.write(`FAIL ${name} ${JSON.stringify(details)}\n`)
    process.exitCode = 1
  }
}

await runCheck('canvas PNG', async () => {
  const { createCanvas } = await step(
    'load @napi-rs/canvas',
    'native binding loads from /app/package.json',
    () => createRequire('/app/package.json')('@napi-rs/canvas')
  )
  await step(
    'draw and encode PNG',
    '2x2 PNG with valid signature',
    async () => {
      const canvas = createCanvas(2, 2)
      canvas.getContext('2d').fillRect(0, 0, 2, 2)
      const png = await canvas.encode('png')
      assert(png.length > 8)
      assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a')
    }
  )
})

// 素の Node の require.resolve はバンドラの書き換えを受けないため、
// アプリと同じ cwd 基点で確認し、解決基点のずれを見逃さない。
const pdfjsRoot = join(process.cwd(), 'node_modules', 'pdfjs-dist')
const files = {
  standard_fonts: ['LiberationSans-Regular.ttf', 'FoxitDingbats.pfb'],
  wasm: ['jbig2.wasm', 'openjpeg.wasm', 'qcms_bg.wasm'],
  cmaps: ['UniJIS-UCS2-H.bcmap'],
  iccs: ['CGATS001Compat-v2-micro.icc'],
}
for (const [directory, names] of Object.entries(files)) {
  await runCheck(`pdfjs ${directory}`, async () => {
    for (const name of names) {
      await step(`stat ${directory}/${name}`, 'isFile() === true', async () => {
        assert((await stat(join(pdfjsRoot, directory, name))).isFile())
      })
    }
  })
}

await runCheck('runtime user', async () => {
  const actual = await step(
    'read uid/gid',
    'uid and gid are available',
    () => ({
      uid: process.getuid(),
      gid: process.getgid(),
    })
  )
  await step(
    `validate uid/gid (uid=${actual.uid}, gid=${actual.gid})`,
    'uid=1001 and gid=1001',
    () => assert.deepEqual(actual, { uid: 1001, gid: 1001 })
  )
})

async function assertRemoved(path) {
  await assert.rejects(lstat(path), { code: 'ENOENT' })
}

await runCheck('temp directory', async () => {
  let directory
  const failures = []
  try {
    directory = await step(
      'create temp directory',
      'mkdtemp succeeds under os.tmpdir()',
      () => mkdtemp(join(tmpdir(), 'chumon-image-check-'))
    )
    const file = join(directory, 'probe.txt')
    const content = 'chumon-hub production image temp check\n'
    await step('create and write temp file', 'write succeeds', () =>
      writeFile(file, content, { flag: 'wx' })
    )
    await step('read temp file', 'content matches written value', async () => {
      assert.equal(await readFile(file, 'utf8'), content)
    })
    await step('delete temp file', 'file is absent after unlink', async () => {
      await unlink(file)
      await assertRemoved(file)
    })
    await step(
      'delete temp directory',
      'directory is absent after rmdir',
      async () => {
        await rmdir(directory)
        await assertRemoved(directory)
      }
    )
  } catch (error) {
    failures.push(error)
  } finally {
    if (directory !== undefined) {
      try {
        await step(
          'cleanup temp directory',
          'created directory and its contents are absent',
          async () => {
            await rm(directory, { recursive: true, force: true })
            await assertRemoved(directory)
          }
        )
      } catch (error) {
        failures.push(error)
      }
    }
  }
  if (failures.length > 0) {
    throw new AggregateError(failures, 'Temporary filesystem check failed')
  }
})
