// Temporary PR-only comparison; remove before merging this PR.
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

const fixtures = ['F0', 'F1', 'F2', 'F3']
const images = ['old', 'new']
const expectedConstants = {
  peakLimitMiB: 435,
  relativeLimit: 1.15,
  runs: 3,
  rounds: 10,
  concurrency: 2,
}
const allowedDifferencePaths = new Set([
  '.github/workflows/tmp-base-image-memory.yml',
  'scripts/ci/tmp-memory/fixtures.ts',
  'scripts/ci/tmp-memory/load.mjs',
  'scripts/ci/tmp-memory/summarize.mjs',
  'app/api/crop-title-block/route.ts',
  'lib/concurrency/serialized-in-flight.ts',
  'lib/concurrency/serialized-in-flight.test.ts',
])
const mib = 1024 * 1024
const finiteNonnegative = (value) =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0
const integer = (value) => Number.isSafeInteger(value) && value >= 0
const positiveInteger = (value) => integer(value) && value > 0
const hash = (value) =>
  typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
const object = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
const display = (value) =>
  String(value).replaceAll('|', '\\|').replaceAll('\n', ' ')

function validRuntime(runtime) {
  return (
    object(runtime) &&
    object(runtime.versions) &&
    Object.keys(runtime.versions).length > 0 &&
    Object.values(runtime.versions).every(
      (value) => typeof value === 'string' && value.length > 0
    ) &&
    ['node', 'v8', 'uv'].every(
      (key) =>
        typeof runtime.versions[key] === 'string' && runtime.versions[key]
    ) &&
    object(runtime.musl) &&
    typeof runtime.musl.path === 'string' &&
    runtime.musl.path.startsWith('/') &&
    typeof runtime.musl.version === 'string' &&
    /\bVersion\s+\d+\.\d+\.\d+\b/.test(runtime.musl.version) &&
    hash(runtime.musl.sha256) &&
    object(runtime.canvas) &&
    typeof runtime.canvas.packageVersion === 'string' &&
    runtime.canvas.packageVersion.length > 0 &&
    object(runtime.canvas.nativeBinary) &&
    typeof runtime.canvas.nativeBinary.path === 'string' &&
    runtime.canvas.nativeBinary.path.startsWith('/') &&
    hash(runtime.canvas.nativeBinary.sha256) &&
    object(runtime.canvas.platformPackage) &&
    typeof runtime.canvas.platformPackage.name === 'string' &&
    runtime.canvas.platformPackage.name.startsWith('@napi-rs/canvas-') &&
    typeof runtime.canvas.platformPackage.version === 'string' &&
    runtime.canvas.platformPackage.version.length > 0
  )
}

function sameRuntime(oldRuntime, newRuntime) {
  if (!validRuntime(oldRuntime) || !validRuntime(newRuntime)) return false
  const versionKeys = Object.keys(oldRuntime.versions).sort()
  return (
    JSON.stringify(versionKeys) ===
      JSON.stringify(Object.keys(newRuntime.versions).sort()) &&
    versionKeys.every(
      (key) => oldRuntime.versions[key] === newRuntime.versions[key]
    ) &&
    ['path', 'version', 'sha256'].every(
      (key) => oldRuntime.musl[key] === newRuntime.musl[key]
    ) &&
    oldRuntime.canvas.packageVersion === newRuntime.canvas.packageVersion &&
    ['path', 'sha256'].every(
      (key) =>
        oldRuntime.canvas.nativeBinary[key] ===
        newRuntime.canvas.nativeBinary[key]
    ) &&
    ['name', 'version'].every(
      (key) =>
        oldRuntime.canvas.platformPackage[key] ===
        newRuntime.canvas.platformPackage[key]
    )
  )
}

function majorRuntimeRows(metadata) {
  const oldRuntime = metadata?.environment?.old?.runtime
  const newRuntime = metadata?.environment?.new?.runtime
  const rows = []
  if (object(oldRuntime?.versions) || object(newRuntime?.versions)) {
    const keys = [
      ...new Set([
        ...Object.keys(oldRuntime?.versions ?? {}),
        ...Object.keys(newRuntime?.versions ?? {}),
      ]),
    ].sort()
    for (const key of keys) {
      rows.push({
        item: `process.versions.${key}`,
        old: oldRuntime?.versions?.[key] ?? null,
        new: newRuntime?.versions?.[key] ?? null,
      })
    }
  }
  const fields = [
    ['musl loader path', (runtime) => runtime?.musl?.path],
    ['musl version', (runtime) => runtime?.musl?.version],
    ['musl SHA-256', (runtime) => runtime?.musl?.sha256],
    ['@napi-rs/canvas version', (runtime) => runtime?.canvas?.packageVersion],
    [
      'canvas native binary path',
      (runtime) => runtime?.canvas?.nativeBinary?.path,
    ],
    [
      'canvas native binary SHA-256',
      (runtime) => runtime?.canvas?.nativeBinary?.sha256,
    ],
    [
      'canvas platform package',
      (runtime) => runtime?.canvas?.platformPackage?.name,
    ],
    [
      'canvas platform package version',
      (runtime) => runtime?.canvas?.platformPackage?.version,
    ],
  ]
  for (const [item, value] of fields) {
    rows.push({
      item,
      old: value(oldRuntime) ?? null,
      new: value(newRuntime) ?? null,
    })
  }
  return rows
}

function median(values) {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2
}

function abnormal(record) {
  return (
    record.state?.Running !== true ||
    record.state?.ExitCode !== 0 ||
    record.state?.Dead === true ||
    Boolean(record.state?.Error) ||
    record.restartCount !== 0
  )
}

const diagnosticStatKeys = [
  'anon',
  'file',
  'kernel',
  'shmem',
  'sock',
  'slab',
  'file_mapped',
]
const diagnosticEventKeys = ['low', 'high', 'max', 'oom', 'oom_kill']

async function diagnosticsFor(root, metadata, measurements) {
  const issues = []
  const issue = (id, reason) => issues.push(`${id}: ${reason}`)
  function recordedIssues(id, values) {
    if (!Array.isArray(values)) {
      issue(id, 'DIAGNOSTICS_MISSING_OR_INVALID')
      return
    }
    for (const value of values) {
      issue(
        id,
        typeof value === 'string' && /^[A-Z_]+(?::[A-Z_a-z]+)?$/.test(value)
          ? value
          : 'INVALID_DIAGNOSTIC_CODE'
      )
    }
  }
  async function read(file, id) {
    try {
      return await readFile(file, 'utf8')
    } catch {
      issue(id, 'FILE_UNAVAILABLE')
      return null
    }
  }
  recordedIssues('metadata', metadata?.diagnostics)
  const runtimes = images.map((image) => ({
    image,
    runtime: metadata?.environment?.[image]?.runtime ?? null,
  }))
  const rows = []
  for (const image of images) {
    for (const fixture of fixtures) {
      for (let run = 1; run <= 3; run += 1) {
        const id = `${image}-${fixture}-${run}`
        const record = measurements.find((entry) => entry.id === id)
        recordedIssues(id, record?.diagnostics)
        const directory = join(root, 'runs', record?.directory ?? id)
        const text = await read(
          join(directory, 'memory-samples.jsonl'),
          `${id}/samples`
        )
        const samples = []
        let previous = null
        if (text !== null) {
          const lines = text.split('\n')
          if (lines.at(-1) === '') lines.pop()
          for (const [index, line] of lines.entries()) {
            let sample
            try {
              sample = JSON.parse(line)
            } catch {
              issue(`${id}/sample[${index}]`, 'INVALID_JSON')
              continue
            }
            if (
              !object(sample) ||
              !finiteNonnegative(sample.elapsedMs) ||
              !['startup', 'load', 'final'].includes(sample.phase) ||
              !integer(sample.memoryCurrent) ||
              !object(sample.stat) ||
              diagnosticStatKeys.some(
                (key) =>
                  !(sample.stat[key] === null || integer(sample.stat[key]))
              )
            ) {
              issue(`${id}/sample[${index}]`, 'INVALID_SAMPLE')
              continue
            }
            if (previous !== null && sample.elapsedMs < previous) {
              issue(`${id}/sample[${index}]`, 'SAMPLE_TIME_OUT_OF_ORDER')
            }
            previous = sample.elapsedMs
            samples.push(sample)
          }
        }
        if (!samples.length) issue(id, 'NO_SAMPLES')
        if (samples.filter((sample) => sample.phase === 'final').length !== 1) {
          issue(id, 'FINAL_SAMPLE_MISSING_OR_DUPLICATE')
        } else if (samples.at(-1)?.phase !== 'final') {
          issue(id, 'FINAL_SAMPLE_NOT_LAST')
        }
        const eventsText = await read(
          join(directory, 'memory-events.json'),
          `${id}/events`
        )
        let events = null
        if (eventsText !== null) {
          try {
            const value = JSON.parse(eventsText)
            if (
              object(value) &&
              diagnosticEventKeys.every((key) => integer(value[key]))
            )
              events = value
            else issue(`${id}/events`, 'INVALID_EVENTS')
          } catch {
            issue(`${id}/events`, 'INVALID_JSON')
          }
        }
        let maximum = null
        let maxIntervalMs = null
        for (const [index, sample] of samples.entries()) {
          if (maximum === null || sample.memoryCurrent > maximum.memoryCurrent)
            maximum = sample
          if (index > 0) {
            const gap = sample.elapsedMs - samples[index - 1].elapsedMs
            if (gap >= 0) maxIntervalMs = Math.max(maxIntervalMs ?? 0, gap)
          }
        }
        rows.push({
          image,
          fixture,
          run,
          sampleCount: samples.length,
          maxIntervalMs,
          maximum,
          events,
        })
      }
    }
  }
  return { issues, runtimes, rows }
}

function diagnosticMarkdown(diagnostics) {
  const number = (value) => (integer(value) ? String(value) : '—')
  return [
    '',
    '## 診断（判定には使わない）',
    '',
    '### memory.current が最大だったサンプルの内訳。各項目の個別の最大値ではない。1 秒ごとの採取のため、ピークの瞬間を外しうる。ピークの総量は memory.peak',
    '',
    'メモリの値はバイト、経過時間・最大間隔はミリ秒。',
    '',
    '| Image | Fixture | Run | elapsedMs | phase | memoryCurrent | anon | file | kernel | shmem | slab | events.max | events.oom | events.oom_kill | サンプル数 | 最大間隔 ms |',
    '|---|---|---:|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|',
    ...diagnostics.rows.map(
      ({ image, fixture, run, maximum, events, sampleCount, maxIntervalMs }) =>
        `| ${image} | ${fixture} | ${run} | ${number(maximum?.elapsedMs)} | ${maximum?.phase ?? '—'} | ${number(maximum?.memoryCurrent)} | ${number(maximum?.stat.anon)} | ${number(maximum?.stat.file)} | ${number(maximum?.stat.kernel)} | ${number(maximum?.stat.shmem)} | ${number(maximum?.stat.slab)} | ${number(events?.max)} | ${number(events?.oom)} | ${number(events?.oom_kill)} | ${sampleCount} | ${number(maxIntervalMs)} |`
    ),
    '',
    '### 診断データの不備',
    '',
    ...(diagnostics.issues.length
      ? diagnostics.issues.map((value) => `- ${display(value)}`)
      : ['なし']),
  ]
}

async function summarize(root) {
  const issues = []
  const oldFailures = []
  const oldKnownPeakExceedances = []
  const criteriaFailures = []
  function invalid(id, reason) {
    issues.push(`${id}: ${reason}`)
  }
  async function readJson(file, id) {
    try {
      return JSON.parse(await readFile(file, 'utf8'))
    } catch {
      invalid(id, 'JSON missing or invalid')
      return null
    }
  }
  const metadata = await readJson(join(root, 'metadata.json'), 'metadata')
  if (!object(metadata)) {
    invalid('metadata', 'object required')
  } else {
    if (!positiveInteger(metadata.startedAtMs)) {
      invalid('metadata', 'invalid start timestamp')
    }
    if (
      !/^[a-f0-9]{40}$/.test(metadata.headSha ?? '') ||
      metadata.headSha !== metadata.expectedHeadSha
    ) {
      invalid('metadata', 'checkout SHA missing or mismatched')
    }
    if (
      metadata.oldSourceSha !== 'e0d6a9f533c0e207d6da8c93f14edb961b1347b9' ||
      metadata.oldImage !==
        'ghcr.io/fumiakic/chumon-hub@sha256:62110fdcb824aa2d53cbf24322a10fa1974a17ce3df8c25067b02699b96bd115'
    ) {
      invalid('metadata', 'old source/image mismatch')
    }
    if (
      !object(metadata.constants) ||
      Object.entries(expectedConstants).some(
        ([key, value]) => metadata.constants[key] !== value
      )
    ) {
      invalid('metadata', 'fixed measurement constants missing or changed')
    }
    if (
      !object(metadata.gates) ||
      ['sha', 'diff', 'digest', 'majorRuntime'].some(
        (key) => metadata.gates[key] !== true
      )
    ) {
      invalid('metadata', 'pre-measurement gate failed or incomplete')
    }
    const oldRuntime = metadata.environment?.old?.runtime
    const newRuntime = metadata.environment?.new?.runtime
    const runtimeMatches = sameRuntime(oldRuntime, newRuntime)
    const expectedRuntimeRows = majorRuntimeRows(metadata).map((row) => ({
      ...row,
      matched: row.old !== null && row.old === row.new,
    }))
    if (
      !object(metadata.majorRuntime) ||
      metadata.majorRuntime.label !== '主要ランタイムの版一致' ||
      metadata.majorRuntime.matched !== runtimeMatches ||
      !Array.isArray(metadata.majorRuntime.rows) ||
      metadata.majorRuntime.rows.length !== expectedRuntimeRows.length ||
      expectedRuntimeRows.some((row, index) => {
        const recorded = metadata.majorRuntime.rows[index]
        return (
          !object(recorded) ||
          recorded.item !== row.item ||
          recorded.old !== row.old ||
          recorded.new !== row.new ||
          recorded.matched !== row.matched
        )
      }) ||
      metadata.gates?.majorRuntime !== runtimeMatches
    ) {
      invalid(
        'metadata',
        '主要ランタイムの版一致 missing, failed, or inconsistent'
      )
    }
    if (
      !Array.isArray(metadata.difference) ||
      metadata.difference.some(
        (path) =>
          typeof path !== 'string' ||
          !(path.startsWith('docs/') || allowedDifferencePaths.has(path))
      )
    ) {
      invalid('metadata', 'changed-file allowlist missing or violated')
    }
    if (
      metadata.preparationComplete !== true ||
      metadata.measurementsComplete !== true
    ) {
      invalid('metadata', 'preparation or measurements did not finish')
    }
    if (!Array.isArray(metadata.infrastructure)) {
      invalid('metadata', 'infrastructure status missing')
    } else {
      for (const reason of metadata.infrastructure) {
        invalid('infrastructure', display(reason))
      }
    }
    const environment = metadata.environment
    if (
      !object(environment) ||
      ['kernel', 'dockerVersion'].some(
        (key) =>
          typeof environment[key] !== 'string' || !environment[key].trim()
      ) ||
      environment.cgroupFilesystem !== 'cgroup2fs' ||
      images.some(
        (image) =>
          !object(environment[image]) ||
          !/^sha256:[a-f0-9]{64}$/.test(environment[image].id ?? '') ||
          typeof environment[image].user !== 'string' ||
          !environment[image].user.trim() ||
          !validRuntime(environment[image].runtime)
      )
    ) {
      invalid(
        'metadata',
        'environment/image ID/runtime user missing or invalid'
      )
    }
  }

  let directories = []
  try {
    directories = await readdir(join(root, 'runs'), { withFileTypes: true })
  } catch {
    invalid('runs', 'measurement directory missing')
  }
  const measurements = []
  const byKey = new Map()
  const dimensionSets = new Map(
    images.flatMap((image) =>
      fixtures.map((fixture) => [`${image}-${fixture}`, new Set()])
    )
  )
  for (const entry of directories) {
    if (!entry.isDirectory()) {
      invalid(entry.name, 'unexpected entry in measurement directory')
      continue
    }
    const directory = join(root, 'runs', entry.name)
    const record = await readJson(
      join(directory, 'measurement.json'),
      entry.name
    )
    if (!object(record)) {
      invalid(entry.name, 'measurement object required')
      continue
    }
    if (
      !images.includes(record.image) ||
      !fixtures.includes(record.fixture) ||
      !integer(record.run) ||
      record.run < 1 ||
      record.run > 3
    ) {
      invalid(entry.name, 'invalid image/fixture/run')
      continue
    }
    const id = `${record.image}-${record.fixture}-${record.run}`
    if (byKey.has(id)) invalid(entry.name, `duplicate combination ${id}`)
    else byKey.set(id, record)
    const validState =
      object(record.state) &&
      typeof record.state.OOMKilled === 'boolean' &&
      typeof record.state.Running === 'boolean' &&
      typeof record.state.Dead === 'boolean' &&
      typeof record.state.Error === 'string' &&
      integer(record.state.ExitCode) &&
      (!('Pid' in record.state) || integer(record.state.Pid)) &&
      integer(record.restartCount)
    if (!validState) {
      invalid(id, 'invalid State or RestartCount')
    }
    if (!(
      (positiveInteger(record.memoryPeakBytes) &&
        record.peakMissingReason === null) ||
      (record.memoryPeakBytes === null &&
        validState &&
        record.state.Running === false &&
        ['TARGET_EXITED_BEFORE_READ', 'TARGET_EXITED_DURING_READ'].includes(
          record.peakMissingReason
        ))
    )) {
      invalid(id, 'invalid memory.peak or peakMissingReason for State')
    }
    if (
      !finiteNonnegative(record.durationMs) ||
      typeof record.warning !== 'boolean'
    ) {
      invalid(id, 'invalid duration or warning flag')
    }
    if (record.infrastructure !== null) {
      invalid(id, `infrastructure ${display(record.infrastructure)}`)
    }
    const completion = await readJson(
      join(directory, 'completion.json'),
      `${id}/completion`
    )
    if (
      completion?.complete !== true ||
      completion.requests !== 21 ||
      !integer(completion.failures) ||
      completion.failures > 21
    ) {
      invalid(id, 'missing or invalid load completion')
    }
    let requests = []
    try {
      const lines = (
        await readFile(join(directory, 'requests.jsonl'), 'utf8')
      ).split('\n')
      if (lines.at(-1) === '') lines.pop()
      requests = lines.map((line) => JSON.parse(line))
    } catch {
      invalid(id, 'request JSONL missing or invalid (including partial lines)')
    }
    if (requests.length !== 21) {
      invalid(id, `expected 21 requests, found ${requests.length}`)
    }
    const numbers = new Set()
    for (const [index, request] of requests.entries()) {
      const requestId = `${id}/request[${index}]`
      if (!object(request)) {
        invalid(requestId, 'request object required')
        continue
      }
      if (
        !integer(request.number) ||
        request.number > 20 ||
        numbers.has(request.number)
      ) {
        invalid(requestId, 'invalid or duplicate request number')
      }
      numbers.add(request.number)
      if (
        !integer(request.round) ||
        request.round !==
          (request.number === 0 ? 0 : Math.ceil(request.number / 2)) ||
        !finiteNonnegative(request.durationMs) ||
        typeof request.pass !== 'boolean' ||
        !(
          request.status === null ||
          (integer(request.status) &&
            request.status >= 100 &&
            request.status <= 599)
        ) ||
        !(request.width === null || integer(request.width)) ||
        !(request.height === null || integer(request.height)) ||
        !(request.pngSha256 === null || hash(request.pngSha256))
      ) {
        invalid(requestId, 'invalid request field')
      }
      if (request.pass === true) {
        if (
          request.status !== 200 ||
          request.reason !== null ||
          !positiveInteger(request.width) ||
          !positiveInteger(request.height) ||
          !hash(request.pngSha256)
        ) {
          invalid(requestId, 'inconsistent successful request')
        } else {
          dimensionSets
            .get(`${record.image}-${record.fixture}`)
            ?.add(`${request.width}×${request.height}`)
        }
      } else if (
        typeof request.reason !== 'string' ||
        !/^[A-Z][A-Z0-9_]*$/.test(request.reason)
      ) {
        invalid(requestId, 'failure reason missing or invalid')
      }
    }
    for (let number = 0; number <= 20; number += 1) {
      if (!numbers.has(number)) invalid(id, `missing request number ${number}`)
    }
    const passed = requests.filter((request) => request?.pass === true).length
    if (completion && completion.failures !== requests.length - passed) {
      invalid(id, 'completion failure count does not match requests')
    }
    const durations = requests
      .map((request) => request?.durationMs)
      .filter(finiteNonnegative)
    const dimensions = [
      ...new Set(
        requests
          .filter(
            (request) =>
              positiveInteger(request?.width) &&
              positiveInteger(request?.height)
          )
          .map((request) => `${request.width}×${request.height}`)
      ),
    ]
    const result = {
      ...record,
      id,
      directory: entry.name,
      requests,
      passed,
      medianMs: median(durations),
      maximumMs: durations.length ? Math.max(...durations) : null,
      dimensions,
      abnormalExit: abnormal(record),
    }
    measurements.push(result)
  }
  if (directories.filter((entry) => entry.isDirectory()).length !== 24) {
    invalid('runs', 'expected exactly 24 measurement directories')
  }
  if (measurements.length !== 24) {
    invalid(
      'runs',
      `expected 24 measurement records, found ${measurements.length}`
    )
  }
  for (const image of images) {
    for (const fixture of fixtures) {
      for (let run = 1; run <= 3; run += 1) {
        const id = `${image}-${fixture}-${run}`
        if (!byKey.has(id)) invalid(id, 'measurement missing')
      }
    }
  }
  const complete = issues.length === 0
  if (complete) {
    for (const record of measurements) {
      const failures = record.image === 'old' ? oldFailures : criteriaFailures
      if (record.passed !== 21) {
        const reasons = new Map()
        for (const request of record.requests.filter(
          (request) => !request.pass
        )) {
          reasons.set(request.reason, (reasons.get(request.reason) ?? 0) + 1)
        }
        failures.push(
          `${record.id}: criterion 1 (${21 - record.passed}/21 requests failed; ${[...reasons].map(([reason, count]) => `${reason}: ${count}`).join(', ')})`
        )
      }
      if (record.state.OOMKilled) {
        failures.push(`${record.id}: criterion 1 (OOMKilled)`)
      }
      if (record.abnormalExit) {
        failures.push(
          `${record.id}: criterion 1 (abnormal exit; Running=${record.state.Running}, ExitCode=${record.state.ExitCode}, Dead=${record.state.Dead}, hasError=${Boolean(record.state.Error)}, RestartCount=${record.restartCount})`
        )
      }
      if (record.warning) {
        failures.push(`${record.id}: criterion 1 (renderer warning)`)
      }
      if (
        record.memoryPeakBytes !== null &&
        record.memoryPeakBytes > 435 * mib
      ) {
        const exceedance = `${record.id}: peak ${record.memoryPeakBytes} bytes exceeds 435 MiB`
        if (record.image === 'old') oldKnownPeakExceedances.push(exceedance)
        else criteriaFailures.push(`${record.id}: criterion 2 (${exceedance})`)
      }
    }
    for (const fixture of fixtures) {
      const old = dimensionSets.get(`old-${fixture}`)
      const current = dimensionSets.get(`new-${fixture}`)
      if (old.size > 1) {
        oldFailures.push(
          `old-${fixture}: criterion 1 (output dimensions differ across requests/runs: ${[...old].join(', ')})`
        )
      }
      if (current.size > 1) {
        criteriaFailures.push(
          `new-${fixture}: criterion 1 (output dimensions differ across requests/runs: ${[...current].join(', ')})`
        )
      }
      if (old.size && current.size && new Set([...old, ...current]).size > 1) {
        criteriaFailures.push(
          `new-${fixture}: criterion 1 (output dimensions differ from old; old=${[...old].join(', ')}, new=${[...current].join(', ')})`
        )
      }
    }
  }

  const roundCompletions = images.flatMap((image) =>
    fixtures.map((fixture) => {
      const durations = []
      for (const record of measurements.filter(
        (measurement) =>
          measurement.image === image && measurement.fixture === fixture
      )) {
        for (let round = 1; round <= 10; round += 1) {
          const pair = record.requests.filter(
            (request) => request?.round === round && request.number !== 0
          )
          if (
            pair.length === 2 &&
            pair.every((request) => finiteNonnegative(request.durationMs))
          ) {
            durations.push(Math.max(pair[0].durationMs, pair[1].durationMs))
          }
        }
      }
      return {
        image,
        fixture,
        roundCount: durations.length,
        medianMs: median(durations),
        maximumMs: durations.length ? Math.max(...durations) : null,
      }
    })
  )

  const maxima = fixtures.map((fixture) => {
    const maximum = (image) => {
      const peaks = measurements
        .filter(
          (record) =>
            record.fixture === fixture &&
            record.image === image &&
            positiveInteger(record.memoryPeakBytes)
        )
        .map((record) => record.memoryPeakBytes)
      return peaks.length ? Math.max(...peaks) : null
    }
    const old = maximum('old')
    const current = maximum('new')
    // Compare the exact 115/100 boundary without floating-point rounding.
    if (
      complete &&
      old !== null &&
      current !== null &&
      BigInt(current) * 100n > BigInt(old) * 115n
    ) {
      criteriaFailures.push(`${fixture}: criterion 3 (new/old exceeds 1.15)`)
    }
    return {
      fixture,
      oldPeakBytes: old,
      newPeakBytes: current,
      ratio: old && current !== null ? current / old : null,
    }
  })
  const verdict =
    issues.length || oldFailures.length
      ? '中断'
      : criteriaFailures.length
        ? '不合格'
        : '合格'
  const label =
    complete && oldFailures.length
      ? `${verdict}（旧イメージが基準を満たさない）`
      : verdict
  const exitCode = verdict === '合格' ? 0 : verdict === '不合格' ? 1 : 2
  const diagnostics = await diagnosticsFor(root, metadata, measurements)
  const peak = (bytes) =>
    positiveInteger(bytes) ? (bytes / mib).toFixed(3) : '—'
  const time = (value) => (finiteNonnegative(value) ? value.toFixed(1) : '—')
  const markdown = [
    '# 修正効果の判定（ADR-6 の採用判定ではない）',
    '',
    `## 総合判定: ${label}`,
    '',
    '## 主要ランタイムの版一致',
    '',
    `結果: ${metadata?.majorRuntime?.matched === true ? '一致' : '中断または不一致'}`,
    '',
    '| 項目 | 旧 | 新 | 一致 |',
    '|---|---|---|---|',
    ...majorRuntimeRows(metadata).map(
      ({ item, old, new: current }) =>
        `| ${display(item)} | ${display(old ?? '—')} | ${display(current ?? '—')} | ${old !== null && old === current ? 'はい' : 'いいえ'} |`
    ),
    '',
    '## 旧の既知の基準 2 超過',
    '',
    ...(oldKnownPeakExceedances.length
      ? oldKnownPeakExceedances.map((failure) => `- ${display(failure)}`)
      : ['なし']),
    '',
    '## 旧の不成立（基準2超過を除く）',
    '',
    ...(oldFailures.length
      ? oldFailures.map((failure) => `- ${display(failure)}`)
      : ['なし']),
    '',
    '## 新の不合格',
    '',
    ...(criteriaFailures.length
      ? criteriaFailures.map((failure) => `- ${display(failure)}`)
      : ['なし']),
    '',
    '## fixture ごとの1ラウンド完了時間（参考・判定には不使用）',
    '',
    '| Image | Fixture | ラウンド数 | 中央値 ms | 最大 ms |',
    '|---|---|---:|---:|---:|',
    ...roundCompletions.map(
      (entry) =>
        `| ${entry.image} | ${entry.fixture} | ${entry.roundCount} | ${time(entry.medianMs)} | ${time(entry.maximumMs)} |`
    ),
    '',
    '## fixture ごとの新旧最大値',
    '',
    '| Fixture | 旧 最大 MiB | 新 最大 MiB | 新/旧 | 絶対上限 MiB | 相対上限 |',
    '|---|---:|---:|---:|---:|---:|',
    ...maxima.map(
      (entry) =>
        `| ${entry.fixture} | ${peak(entry.oldPeakBytes)} | ${peak(entry.newPeakBytes)} | ${entry.ratio?.toFixed(4) ?? '—'} | 435 | 1.15 |`
    ),
    '',
    '## 24 回の詳細（所要時間はウォームアップを含む要求単位）',
    '',
    '| Image | Fixture | Run | memory.peak MiB | peakMissingReason | OOMKilled | 異常終了 | 要求 合格/計画 | 中央値 ms | 最大 ms | 幅×高さ | 警告 |',
    '|---|---|---:|---:|---|---|---|---:|---:|---:|---|---|',
  ]
  for (const image of images) {
    for (const fixture of fixtures) {
      for (let run = 1; run <= 3; run += 1) {
        const record = measurements.find(
          (value) =>
            value.image === image &&
            value.fixture === fixture &&
            value.run === run
        )
        markdown.push(
          record
            ? `| ${image} | ${fixture} | ${run} | ${peak(record.memoryPeakBytes)} | ${display(record.peakMissingReason ?? '—')} | ${record.state?.OOMKilled ?? '—'} | ${record.abnormalExit} | ${record.passed}/21 | ${time(record.medianMs)} | ${time(record.maximumMs)} | ${record.dimensions.join(', ') || '—'} | ${record.warning ?? '—'} |`
            : `| ${image} | ${fixture} | ${run} | — | — | — | — | 0/21 (missing) | — | — | — | — |`
        )
      }
    }
  }
  markdown.push(
    ...diagnosticMarkdown(diagnostics),
    '',
    '## 環境・SHA・差分・実行ユーザー',
    '',
    '```json',
    JSON.stringify(
      {
        expectedHeadSha: metadata?.expectedHeadSha ?? null,
        headSha: metadata?.headSha ?? null,
        oldSourceSha: metadata?.oldSourceSha ?? null,
        oldImage: metadata?.oldImage ?? null,
        newImage: metadata?.newImage ?? null,
        constants: metadata?.constants ?? null,
        gates: metadata?.gates ?? null,
        environment: metadata?.environment ?? null,
        difference: metadata?.difference ?? null,
      },
      null,
      2
    ),
    '```',
    '',
    '## 不完全な記録の識別子',
    '',
    ...(issues.length
      ? issues.map((issue) => `- ${display(issue)}`)
      : ['なし']),
    ''
  )
  const result = {
    verdict,
    label,
    exitCode,
    oldFailures,
    oldKnownPeakExceedances,
    criteriaFailures,
    incompleteRecords: issues,
    diagnosticIssues: diagnostics.issues,
    diagnostics: {
      runtimes: diagnostics.runtimes,
      measurements: diagnostics.rows,
    },
    roundCompletions,
    metadata,
    maxima,
    measurements,
  }
  await writeFile(
    join(root, 'result.json'),
    `${JSON.stringify(result, null, 2)}\n`
  )
  await writeFile(join(root, 'summary.md'), markdown.join('\n'))
  process.stdout.write(
    `主要ランタイムの版一致: ${metadata?.majorRuntime?.matched === true ? '一致' : '不成立'}\n${JSON.stringify({ verdict: label, exitCode, incompleteRecords: issues })}\n`
  )
  return exitCode
}

const root = resolve(process.argv[2] || process.env.MEMORY_ROOT || '.')
try {
  await mkdir(root, { recursive: true })
  process.exitCode = await summarize(root)
} catch {
  const result = {
    verdict: '中断',
    label: '中断',
    exitCode: 2,
    oldFailures: [],
    oldKnownPeakExceedances: [],
    criteriaFailures: [],
    diagnosticIssues: [],
    incompleteRecords: ['summarize: unexpected I/O or aggregation failure'],
  }
  process.stderr.write('SUMMARY_FAILED\n')
  try {
    await writeFile(join(root, 'result.json'), JSON.stringify(result) + '\n')
    await writeFile(
      join(root, 'summary.md'),
      '# 総合判定: 中断\n\n## 不完全な記録の識別子\n\n- summarize: aggregation failed\n'
    )
  } catch {
    process.stderr.write('SUMMARY_WRITE_FAILED\n')
  }
  process.exitCode = 2
}
