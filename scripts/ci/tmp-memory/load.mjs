// Temporary PR-only harness; remove before merging this PR.
import { spawnSync } from 'node:child_process'
import { createHash, createPrivateKey, sign } from 'node:crypto'
import { appendFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'
import { performance } from 'node:perf_hooks'
import { setTimeout as sleep } from 'node:timers/promises'

const targetStopped = new AbortController()
let measurementDeadline = null
if (process.argv[2] === 'load') {
  process.on('SIGTERM', () => targetStopped.abort())
}

class HarnessError extends Error {
  constructor(code) {
    super(code)
    this.code = code
  }
}

function required(name) {
  const value = process.env[name]
  if (!value) throw new HarnessError(`MISSING_${name}`)
  return value
}

function positiveInteger(name) {
  const number = Number(required(name))
  if (!Number.isSafeInteger(number) || number <= 0) {
    throw new HarnessError(`INVALID_${name}`)
  }
  return number
}

async function json(path, value) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`)
}

function failureRecord(number, concurrency, reason) {
  return {
    number,
    round: number === 0 ? 0 : Math.ceil(number / concurrency),
    pass: false,
    reason,
    status: null,
    durationMs: 0,
    width: null,
    height: null,
    pngSha256: null,
  }
}

async function load() {
  const output = required('MEMORY_REQUESTS_FILE')
  const completion = required('MEMORY_COMPLETION_FILE')
  const concurrency = positiveInteger('CONCURRENCY')
  const rounds = positiveInteger('ROUNDS')
  await writeFile(output, '', { flag: 'wx' })
  const materials = required('CROP_SMOKE_MATERIAL_DIR')
  const issuer = `https://${required('CLOUDFLARE_TEAM_DOMAIN')}.cloudflareaccess.com`
  const audience = required('CLOUDFLARE_AUDIENCE')
  const appUrl = required('CROP_SMOKE_APP_URL')
  const fixture = await readFile(required('MEMORY_FIXTURE'))
  const privateKey = createPrivateKey(
    await readFile(join(materials, 'private.pem'))
  )
  const jwks = JSON.parse(await readFile(join(materials, 'jwks.json'), 'utf8'))
  const key = jwks.keys?.[0]
  if (!key || typeof key.kid !== 'string') {
    throw new HarnessError('INVALID_JWKS')
  }
  // Resolve the decoder from the new production image, not the measured image.
  const requireFromApp = createRequire(
    process.env.MEMORY_APP_PACKAGE || '/app/package.json'
  )
  const { createCanvas, loadImage } = requireFromApp('@napi-rs/canvas')
  const preflight = await fetch(`${issuer}/cdn-cgi/access/certs`, {
    signal: AbortSignal.timeout(15_000),
  })
  if (preflight.status !== 200) throw new HarnessError('IDP_PREFLIGHT_HTTP')
  const published = await preflight.json()
  if (
    !published.keys?.some((candidate) =>
      ['kid', 'alg', 'use', 'kty', 'n', 'e'].every(
        (field) => candidate[field] === key[field]
      )
    )
  ) {
    throw new HarnessError('IDP_PREFLIGHT_JWKS')
  }
  let failures = 0
  // Serialize appends even when two requests complete together.
  let writes = Promise.resolve()
  async function request(number) {
    const started = performance.now()
    const record = failureRecord(number, concurrency, 'REQUEST_FAILED')
    try {
      if (targetStopped.signal.aborted) {
        throw new HarnessError('TARGET_TERMINATED_NOT_SENT')
      }
      const now = Math.floor(Date.now() / 1000)
      const header = Buffer.from(
        JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: key.kid })
      ).toString('base64url')
      const payload = Buffer.from(
        JSON.stringify({
          iss: issuer,
          aud: audience,
          iat: now,
          exp: now + 300,
          email: 'memory-harness@smoke.invalid',
        })
      ).toString('base64url')
      const unsigned = `${header}.${payload}`
      const token = `${unsigned}.${sign(
        'RSA-SHA256',
        Buffer.from(unsigned),
        privateKey
      ).toString('base64url')}`
      const form = new FormData()
      form.append(
        'file',
        new Blob([fixture], { type: 'application/pdf' }),
        'synthetic.pdf'
      )
      const response = await fetch(`${appUrl}/api/crop-title-block`, {
        method: 'POST',
        headers: { 'Cf-Access-Jwt-Assertion': token },
        body: form,
        signal: AbortSignal.any([
          AbortSignal.timeout(120_000),
          targetStopped.signal,
        ]),
      })
      record.status = response.status
      if (response.status !== 200) {
        await response.body?.cancel()
        throw new HarnessError('HTTP_STATUS')
      }
      let body
      try {
        body = await response.json()
      } catch (error) {
        if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
          throw error
        }
        throw new HarnessError('INVALID_JSON')
      }
      if (
        !Array.isArray(body?.croppedFiles) ||
        body.croppedFiles.length !== 1
      ) {
        throw new HarnessError('CROPPED_FILES_COUNT')
      }
      const base64 = body.croppedFiles[0]?.base64
      const prefix = 'data:image/png;base64,'
      if (typeof base64 !== 'string' || !base64.startsWith(prefix)) {
        throw new HarnessError('PNG_DATA_URI')
      }
      const encoded = base64.slice(prefix.length)
      if (
        !encoded ||
        encoded.length % 4 !== 0 ||
        !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)
      ) {
        throw new HarnessError('PNG_BASE64')
      }
      const png = Buffer.from(encoded, 'base64')
      record.pngSha256 = createHash('sha256').update(png).digest('hex')
      if (png.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') {
        throw new HarnessError('PNG_SIGNATURE')
      }
      let image
      try {
        image = await loadImage(png)
      } catch {
        throw new HarnessError('PNG_DECODE')
      }
      record.width = image.width
      record.height = image.height
      if (
        !Number.isSafeInteger(image.width) ||
        !Number.isSafeInteger(image.height) ||
        image.width <= 0 ||
        image.height <= 0
      ) {
        throw new HarnessError('PNG_DIMENSIONS')
      }
      const canvas = createCanvas(image.width, image.height)
      const context = canvas.getContext('2d')
      context.drawImage(image, 0, 0)
      const { data } = context.getImageData(0, 0, image.width, image.height)
      let dark = false
      for (let offset = 0; offset < data.length; offset += 4) {
        if (
          data[offset + 3] === 255 &&
          data[offset] < 128 &&
          data[offset + 1] < 128 &&
          data[offset + 2] < 128
        ) {
          dark = true
          break
        }
      }
      if (!dark) throw new HarnessError('NO_DARK_PIXELS')
      record.pass = true
      record.reason = null
    } catch (error) {
      record.reason =
        targetStopped.signal.aborted && !(error instanceof HarnessError)
          ? 'TARGET_TERMINATED'
          : error instanceof HarnessError
            ? error.code
            : error?.name === 'TimeoutError' || error?.name === 'AbortError'
              ? 'REQUEST_TIMEOUT'
              : 'REQUEST_ERROR'
      failures += 1
    }
    record.durationMs = performance.now() - started
    writes = writes.then(() =>
      appendFile(output, `${JSON.stringify(record)}\n`)
    )
    await writes
  }
  await request(0)
  for (let round = 0; round < rounds; round += 1) {
    await Promise.all(
      Array.from({ length: concurrency }, (_, index) =>
        request(1 + round * concurrency + index)
      )
    )
  }
  await json(completion, {
    complete: true,
    requests: 1 + concurrency * rounds,
    failures,
  })
  process.exitCode = failures === 0 ? 0 : 1
}

function docker(args, { allowFailure = false } = {}) {
  const remaining =
    measurementDeadline === null ? 20_000 : measurementDeadline - Date.now()
  if (remaining <= 0) throw new HarnessError('MEASUREMENT_TIMEOUT')
  const result = spawnSync('docker', args, {
    encoding: 'utf8',
    timeout: Math.max(1, Math.min(20_000, remaining)),
    maxBuffer: 32 * 1024 * 1024,
  })
  if (result.status !== 0 && !allowFailure) {
    throw new HarnessError(
      measurementDeadline !== null && Date.now() >= measurementDeadline
        ? 'MEASUREMENT_TIMEOUT'
        : 'DOCKER_COMMAND_FAILED'
    )
  }
  return {
    ok: result.status === 0,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
  }
}

function inspect(name) {
  const result = docker(['inspect', name], { allowFailure: true })
  if (!result.ok) return null
  try {
    return JSON.parse(result.stdout)[0]
  } catch {
    throw new HarnessError('INVALID_DOCKER_INSPECT')
  }
}

function infrastructure(code) {
  throw new HarnessError(code)
}

async function cgroupFor(state) {
  const pid = state.Pid
  if (!Number.isSafeInteger(pid) || pid <= 0) {
    infrastructure('INVALID_TARGET_PID')
  }
  const membership = await readFile(`/proc/${pid}/cgroup`, 'utf8')
  const path = membership
    .split('\n')
    .find((line) => line.startsWith('0::'))
    ?.slice(3)
  if (!path || !path.startsWith('/') || path.split('/').includes('..')) {
    infrastructure('CGROUP_V2_PATH_MISSING')
  }
  return join('/sys/fs/cgroup', path)
}

async function peakFor(state) {
  const path = await cgroupFor(state)
  const value = (await readFile(join(path, 'memory.peak'), 'utf8')).trim()
  if (!/^[1-9][0-9]*$/.test(value) || !Number.isSafeInteger(Number(value))) {
    infrastructure('INVALID_MEMORY_PEAK')
  }
  return Number(value)
}

const memoryStatKeys = [
  'anon',
  'file',
  'kernel',
  'shmem',
  'sock',
  'slab',
  'file_mapped',
]
const memoryEventKeys = ['low', 'high', 'max', 'oom', 'oom_kill']

function diagnosticNumber(text) {
  if (!/^[0-9]+$/.test(text) || !Number.isSafeInteger(Number(text))) {
    throw new HarnessError('READ_FAILED')
  }
  return Number(text)
}

function diagnosticFields(text, keys) {
  const fields = new Map(
    text
      .trim()
      .split('\n')
      .map((line) => line.trim().split(/\s+/))
  )
  return Object.fromEntries(
    keys.map((key) => [
      key,
      fields.has(key) ? diagnosticNumber(fields.get(key)) : null,
    ])
  )
}

function memoryObserver(directory, record, started, initialState) {
  let path = null
  let phase = 'startup'
  let timer = null
  let pending = null
  let stopped = false
  function issue(scope, reason) {
    const code = `${scope}:${reason}`
    if (!record.diagnostics.includes(code)) record.diagnostics.push(code)
  }
  async function locate(state) {
    if (path) return
    try {
      path = await cgroupFor(state)
    } catch {
      throw new HarnessError('CGROUP_PATH_UNAVAILABLE')
    }
  }
  async function attempt(scope, state, action) {
    try {
      await locate(state)
      await action()
      return true
    } catch (error) {
      let reason = error instanceof HarnessError ? error.code : 'READ_FAILED'
      if (path) {
        try {
          await stat(path)
        } catch (missing) {
          if (missing?.code === 'ENOENT') reason = 'TARGET_EXITED'
        }
      }
      issue(scope, reason)
      return false
    }
  }
  async function sample(scope, state, samplePhase) {
    return attempt(scope, state, async () => {
      const elapsedMs = Date.now() - started
      const memoryCurrent = diagnosticNumber(
        (await readFile(join(path, 'memory.current'), 'utf8')).trim()
      )
      const fields = diagnosticFields(
        await readFile(join(path, 'memory.stat'), 'utf8'),
        memoryStatKeys
      )
      try {
        await appendFile(
          join(directory, 'memory-samples.jsonl'),
          `${JSON.stringify({ elapsedMs, phase: samplePhase, memoryCurrent, stat: fields })}\n`
        )
      } catch {
        throw new HarnessError('WRITE_FAILED')
      }
    })
  }
  function tick() {
    if (stopped || pending) return
    pending = sample('SAMPLING', initialState, phase)
      .then((ok) => {
        if (!ok) {
          stopped = true
          clearInterval(timer)
        }
      })
      .finally(() => {
        pending = null
      })
  }
  timer = setInterval(tick, 1000)
  tick()
  return {
    load() {
      phase = 'load'
    },
    exited() {
      issue('SAMPLING', 'TARGET_EXITED')
      stopped = true
      clearInterval(timer)
    },
    async stop() {
      stopped = true
      clearInterval(timer)
      await pending
    },
    async final(state) {
      if (state?.Running !== true) {
        const reason =
          state?.Running === false ? 'TARGET_EXITED' : 'CGROUP_PATH_UNAVAILABLE'
        issue('FINAL_SAMPLE', reason)
        issue('MEMORY_EVENTS', reason)
        return
      }
      await sample('FINAL_SAMPLE', state, 'final')
      await attempt('MEMORY_EVENTS', state, async () => {
        const events = diagnosticFields(
          await readFile(join(path, 'memory.events'), 'utf8'),
          memoryEventKeys
        )
        if (Object.values(events).some((value) => value === null)) {
          throw new HarnessError('READ_FAILED')
        }
        try {
          await json(join(directory, 'memory-events.json'), events)
        } catch {
          throw new HarnessError('WRITE_FAILED')
        }
      })
    },
  }
}

async function measureOne(context, run, fixture, image) {
  const { root, prefix, network, newImage, materials } = context
  const directory = join(root, 'runs', `${image}-${fixture}-${run}`)
  await mkdir(directory, { recursive: true })
  const target = `${prefix}-target`
  const loader = `${prefix}-load`
  const idp = `${prefix}-idp`
  const started = Date.now()
  const deadline = started + 600_000
  measurementDeadline = deadline
  const record = {
    image,
    fixture,
    run,
    memoryPeakBytes: null,
    peakMissingReason: null,
    state: null,
    restartCount: null,
    warning: null,
    durationMs: 0,
    infrastructure: null,
    diagnostics: [],
    targetGlibcTunables: null,
  }
  let loaderStarted = false
  let peakError = null
  let primaryError = null
  let observer = null
  function verifyInfrastructure() {
    if (Date.now() >= deadline) infrastructure('MEASUREMENT_TIMEOUT')
    const provider = inspect(idp)
    if (!provider?.State.Running) infrastructure('IDP_NOT_RUNNING')
  }
  try {
    verifyInfrastructure()
    docker([
      'run',
      '-d',
      '--name',
      target,
      '--memory=512m',
      '--memory-swap=512m',
      '--cpus=1',
      '--network',
      network,
      '-p',
      '127.0.0.1::3000',
      '-e',
      'CLOUDFLARE_TEAM_DOMAIN',
      '-e',
      'CLOUDFLARE_AUDIENCE',
      '-e',
      'NODE_EXTRA_CA_CERTS=/smoke-materials/ca.crt',
      '-v',
      `${materials}/tls/ca.crt:/smoke-materials/ca.crt:ro`,
      ...(image === 'new'
        ? ['-e', `GLIBC_TUNABLES=${context.newTargetGlibcTunables}`]
        : []),
      image === 'old' ? required('OLD_IMAGE') : newImage,
    ])
    const targetStarted = Date.now()
    const info = inspect(target)
    const environment = info?.Config?.Env
    const tunables = Array.isArray(environment)
      ? environment.filter(
          (value) =>
            typeof value === 'string' && value.startsWith('GLIBC_TUNABLES=')
        )
      : []
    record.targetGlibcTunables =
      tunables[0]?.slice('GLIBC_TUNABLES='.length) ?? null
    if (
      !Array.isArray(environment) ||
      environment.some((value) => typeof value !== 'string') ||
      tunables.length > 1 ||
      record.targetGlibcTunables !==
        (image === 'new' ? context.newTargetGlibcTunables : null)
    ) {
      record.diagnostics.push('TARGET_SETTING:MISMATCH')
    }
    observer = memoryObserver(directory, record, targetStarted, info?.State)
    const binding = info?.NetworkSettings?.Ports?.['3000/tcp']?.[0]?.HostPort
    if (!binding) infrastructure('TARGET_PORT_MISSING')
    let ready = false
    const readyDeadline = Date.now() + 60_000
    while (Date.now() < readyDeadline) {
      verifyInfrastructure()
      if (!inspect(target)?.State.Running) {
        observer.exited()
        break
      }
      try {
        const response = await fetch(`http://127.0.0.1:${binding}/`, {
          signal: AbortSignal.timeout(
            Math.max(1, Math.min(2000, readyDeadline - Date.now()))
          ),
        })
        await response.body?.cancel()
        if (response.status === 200) {
          ready = true
          break
        }
      } catch (error) {
        if (
          error?.name !== 'TypeError' &&
          error?.name !== 'TimeoutError' &&
          error?.name !== 'AbortError'
        ) {
          throw error
        }
      }
      await sleep(Math.min(500, Math.max(0, readyDeadline - Date.now())))
    }
    if (!ready) {
      const requests = Array.from(
        { length: 1 + context.concurrency * context.rounds },
        (_, number) =>
          failureRecord(number, context.concurrency, 'TARGET_NOT_READY')
      )
      await writeFile(
        join(directory, 'requests.jsonl'),
        requests.map((value) => JSON.stringify(value) + '\n').join('')
      )
      await json(join(directory, 'completion.json'), {
        complete: true,
        requests: requests.length,
        failures: requests.length,
      })
    } else {
      observer.load()
      docker([
        'run',
        '-d',
        '--name',
        loader,
        '--entrypoint',
        'node',
        '--network',
        network,
        '-e',
        'CLOUDFLARE_TEAM_DOMAIN',
        '-e',
        'CLOUDFLARE_AUDIENCE',
        '-e',
        `CONCURRENCY=${context.concurrency}`,
        '-e',
        `ROUNDS=${context.rounds}`,
        '-e',
        'NODE_EXTRA_CA_CERTS=/smoke-materials/ca.crt',
        '-e',
        'CROP_SMOKE_MATERIAL_DIR=/smoke-materials',
        '-e',
        `CROP_SMOKE_APP_URL=http://${target}:3000`,
        '-e',
        `MEMORY_FIXTURE=/fixtures/${fixture}.pdf`,
        '-e',
        'MEMORY_REQUESTS_FILE=/results/requests.jsonl',
        '-e',
        'MEMORY_COMPLETION_FILE=/results/completion.json',
        '-v',
        `${process.cwd()}/scripts/ci:/smoke-scripts:ro`,
        '-v',
        `${materials}/jwt/private.pem:/smoke-materials/private.pem:ro`,
        '-v',
        `${materials}/jwt/jwks.json:/smoke-materials/jwks.json:ro`,
        '-v',
        `${materials}/tls/ca.crt:/smoke-materials/ca.crt:ro`,
        '-v',
        `${root}/fixtures:/fixtures:ro`,
        '-v',
        `${directory}:/results`,
        newImage,
        '/smoke-scripts/tmp-memory/load.mjs',
        'load',
      ])
      loaderStarted = true
      let terminationSignaled = false
      while (true) {
        verifyInfrastructure()
        const worker = inspect(loader)
        if (!worker) infrastructure('LOAD_CONTAINER_MISSING')
        if (!worker.State.Running) {
          if (
            worker.State.OOMKilled ||
            ![0, 1].includes(worker.State.ExitCode)
          ) {
            infrastructure('LOAD_CONTAINER_FAILED')
          }
          break
        }
        const currentTarget = inspect(target)
        if (!currentTarget) infrastructure('TARGET_CONTAINER_MISSING')
        if (!currentTarget.State.Running && !terminationSignaled) {
          observer.exited()
          docker(['kill', '--signal=SIGTERM', loader])
          terminationSignaled = true
        }
        await sleep(1000)
      }
      let completion
      try {
        completion = JSON.parse(
          await readFile(join(directory, 'completion.json'), 'utf8')
        )
      } catch {
        infrastructure('LOAD_RESULT_MISSING')
      }
      if (
        completion?.complete !== true ||
        completion.requests !== 1 + context.concurrency * context.rounds ||
        !Number.isSafeInteger(completion.failures) ||
        completion.failures < 0 ||
        completion.failures > completion.requests
      ) {
        infrastructure('LOAD_RESULT_INCOMPLETE')
      }
      let requests
      try {
        const text = await readFile(join(directory, 'requests.jsonl'), 'utf8')
        requests = text
          .trimEnd()
          .split('\n')
          .map((line) => JSON.parse(line))
      } catch {
        infrastructure('LOAD_REQUEST_RESULTS_MISSING_OR_INVALID')
      }
      if (
        requests.length !== completion.requests ||
        new Set(requests.map((request) => request?.number)).size !==
          completion.requests
      ) {
        infrastructure('LOAD_REQUEST_RESULTS_INCOMPLETE')
      }
    }
    verifyInfrastructure()
  } catch (error) {
    primaryError =
      error instanceof HarnessError ? error.code : 'MEASUREMENT_IO_FAILED'
  } finally {
    await observer?.stop()
    measurementDeadline = null
    if (
      primaryError === 'MEASUREMENT_TIMEOUT' &&
      inspect(loader)?.State.Running
    ) {
      await json(
        join(directory, 'load-state-before-timeout.json'),
        inspect(loader).State
      )
      docker(['kill', '--signal=SIGKILL', loader])
    }
    // Capture the target before stopping it, so Running/ExitCode describe the test.
    const targetInfo = inspect(target)
    record.state = targetInfo?.State ?? null
    record.restartCount = targetInfo?.RestartCount ?? null
    await json(join(directory, 'target-state.json'), {
      State: record.state,
      RestartCount: record.restartCount,
    })
    for (const [name, file] of [
      [target, 'target.log'],
      [idp, 'idp.log'],
      [loader, 'load.log'],
    ]) {
      const logs = docker(['logs', name], { allowFailure: true })
      await writeFile(join(directory, file), logs.stdout + logs.stderr)
      if (name === target && targetInfo) {
        if (!logs.ok) primaryError ||= 'TARGET_LOGS_UNREADABLE'
        else {
          record.warning = (logs.stdout + logs.stderr).includes(
            'PDF renderer emitted a warning'
          )
        }
      }
    }
    const providerState = inspect(idp)?.State ?? null
    if (!providerState?.Running) primaryError ||= 'IDP_NOT_RUNNING'
    await json(join(directory, 'idp-state.json'), providerState)
    await json(
      join(directory, 'load-state.json'),
      loaderStarted ? (inspect(loader)?.State ?? null) : null
    )
    await observer?.final(record.state)
    if (record.state?.Running === false) {
      record.peakMissingReason = 'TARGET_EXITED_BEFORE_READ'
    } else if (record.state?.Running === true) {
      try {
        record.memoryPeakBytes = await peakFor(record.state)
      } catch {
        // A non-OOM exit can also race with the host-side read.
        let latest = null
        try {
          latest = inspect(target)
        } catch {
          peakError = 'MEMORY_PEAK_UNREADABLE'
        }
        if (latest?.State?.Running === false) {
          record.state = latest.State
          record.restartCount = latest.RestartCount
          record.peakMissingReason = 'TARGET_EXITED_DURING_READ'
          await json(join(directory, 'target-state.json'), {
            State: record.state,
            RestartCount: record.restartCount,
          })
        } else {
          peakError = 'MEMORY_PEAK_UNREADABLE'
        }
      }
    } else {
      peakError = 'MEMORY_PEAK_UNREADABLE'
    }
    record.infrastructure = primaryError || peakError
    record.durationMs = Date.now() - started
    await json(join(directory, 'measurement.json'), record)
    for (const name of [loader, target]) {
      if (inspect(name)) docker(['rm', '-f', name])
    }
  }
  return record.infrastructure
}

async function measure() {
  const root = resolve(required('MEMORY_ROOT'))
  const metadataFile = join(root, 'metadata.json')
  const metadata = JSON.parse(await readFile(metadataFile, 'utf8'))
  const context = {
    root,
    prefix: required('MEMORY_PREFIX'),
    network: required('MEMORY_NETWORK'),
    newImage: required('NEW_IMAGE'),
    materials: required('MEMORY_MATERIALS'),
    concurrency: positiveInteger('CONCURRENCY'),
    rounds: positiveInteger('ROUNDS'),
  }
  const runs = positiveInteger('RUNS')
  await mkdir(join(root, 'runs'), { recursive: true })
  // The new image runs the loader as UID 1001; it must be able to append results.
  const { chmod, chown } = await import('node:fs/promises')
  const finishBy = metadata.startedAtMs + 115 * 60_000
  try {
    if (process.env.NEW_TARGET_GLIBC_TUNABLES !== 'glibc.malloc.arena_max=2') {
      infrastructure('INVALID_NEW_TARGET_GLIBC_TUNABLES')
    }
    context.newTargetGlibcTunables = process.env.NEW_TARGET_GLIBC_TUNABLES
    for (let run = 1; run <= runs; run += 1) {
      for (const fixture of ['F0', 'F1', 'F2', 'F3']) {
        for (const image of run % 2 === 1 ? ['old', 'new'] : ['new', 'old']) {
          if (Date.now() + 600_000 >= finishBy) {
            infrastructure('JOB_SAVE_BUDGET')
          }
          const directory = join(root, 'runs', `${image}-${fixture}-${run}`)
          await mkdir(directory, { recursive: true })
          await chmod(directory, 0o755)
          // Invoked with sudo by the workflow; never relax key permissions.
          await chown(directory, 1001, 1001)
          const reason = await measureOne(context, run, fixture, image)
          if (reason) infrastructure(reason)
        }
      }
    }
    metadata.measurementsComplete = true
  } catch (error) {
    metadata.infrastructure.push(
      error instanceof HarnessError ? error.code : 'MEASUREMENT_HOST_FAILED'
    )
    process.exitCode = 2
  } finally {
    await json(metadataFile, metadata)
  }
}

async function main() {
  if (process.argv[2] === 'load') return load()
  if (process.argv[2] === 'measure') return measure()
  throw new HarnessError('INVALID_COMMAND')
}

main().catch(async (error) => {
  const code = error instanceof HarnessError ? error.code : 'HARNESS_FAILED'
  process.stderr.write(`${code}\n`)
  if (process.argv[2] === 'load' && process.env.MEMORY_COMPLETION_FILE) {
    try {
      await json(process.env.MEMORY_COMPLETION_FILE, {
        complete: false,
        infrastructure: code,
      })
    } catch {
      process.stderr.write('COMPLETION_WRITE_FAILED\n')
    }
  }
  process.exitCode = 2
})
