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

async function summarize(root) {
  const issues = []
  const oldFailures = []
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
      ['sha', 'diff', 'digest'].some((key) => metadata.gates[key] !== true)
    ) {
      invalid('metadata', 'pre-measurement gate failed or incomplete')
    }
    if (
      !Array.isArray(metadata.difference) ||
      metadata.difference.some(
        (path) =>
          typeof path !== 'string' ||
          !/^(Dockerfile$|\.devcontainer\/|\.github\/|scripts\/ci\/|docs\/)/.test(
            path
          )
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
          !environment[image].user.trim()
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
        failures.push(
          `${record.id}: criterion 2 (peak ${record.memoryPeakBytes} bytes exceeds 435 MiB)`
        )
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
  const peak = (bytes) =>
    positiveInteger(bytes) ? (bytes / mib).toFixed(3) : '—'
  const time = (value) => (finiteNonnegative(value) ? value.toFixed(1) : '—')
  const markdown = [
    `# 総合判定: ${label}`,
    '',
    '## 旧の不成立',
    '',
    ...(oldFailures.length
      ? oldFailures.map((failure) => `- ${display(failure)}`)
      : ['なし']),
    '',
    '## 新の不合格（旧の不成立時は参考）',
    '',
    ...(criteriaFailures.length
      ? criteriaFailures.map((failure) => `- ${display(failure)}`)
      : ['なし']),
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
    criteriaFailures,
    incompleteRecords: issues,
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
    `${JSON.stringify({ verdict: label, exitCode, incompleteRecords: issues })}\n`
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
    criteriaFailures: [],
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
