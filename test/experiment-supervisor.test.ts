import type { Manifest } from '../evals/experiment/manifest.ts'
import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { it } from 'vitest'
import { sha256 } from '../evals/experiment/manifest.ts'
import { startSupervisedCommand, watchSupervisedCommand } from '../evals/experiment/supervisor.ts'

const native = it.runIf(process.env.RIPIDE_SYSTEMD_PREFLIGHT === '1')

it.each([
  { command: ['node'], cwd: '/tmp', directory: '/tmp/supervisor', deadlineMs: 100 },
  { command: [process.execPath], cwd: '/tmp', directory: '/tmp/supervisor', deadlineMs: 0 },
])('refuses invalid dispatch before contacting the manager', async (options) => {
  await assert.rejects(startSupervisedCommand(options), /absolute|positive|Linux/)
})

native('retains command deadlines and complete traces after its foreground watcher dies', async () => {
  const root = mkdtempSync(join(tmpdir(), 'ripide-supervisor-'))
  const marker = join(root, 'dispatch.txt')
  const report = join(root, 'report.json')
  const service = join(root, 'service.ts')
  const recorder = new URL('../evals/experiment/recorder.ts', import.meta.url).pathname
  const supervisor = new URL('../evals/experiment/supervisor.ts', import.meta.url).pathname
  writeFileSync(service, `import { writeFileSync } from 'node:fs'
import { recordCommand } from ${JSON.stringify(recorder)}
writeFileSync(${JSON.stringify(marker)}, 'once')
const record = await recordCommand({ command: [process.execPath, '-e', 'setInterval(() => {}, 1000)'], cwd: ${JSON.stringify(root)}, directory: ${JSON.stringify(join(root, 'command'))}, phase: 'verification', role: 'controller', timeoutMs: 1500, tracing: 'strace' })
writeFileSync(${JSON.stringify(report)}, JSON.stringify(record))
`)
  const watcher = join(root, 'watcher.ts')
  writeFileSync(watcher, `import { watchSupervisedCommand } from ${JSON.stringify(supervisor)}
await watchSupervisedCommand(process.argv[2])
`)
  const directory = join(root, 'supervision')
  try {
    await startSupervisedCommand({ command: [process.execPath, service], cwd: root, directory, deadlineMs: 15000 })
    const foreground = spawn(process.execPath, [watcher, directory], { stdio: 'ignore' })
    const closed = new Promise(resolve => foreground.once('close', resolve))
    const deadline = Date.now() + 10000
    while (!existsSync(marker) && Date.now() < deadline)
      await new Promise(resolve => setTimeout(resolve, 10))
    assert.equal(existsSync(marker), true)
    foreground.kill('SIGTERM')
    await closed
    const outcome = await watchSupervisedCommand(directory)
    assert.equal(outcome._tag, 'Completed')
    const record = JSON.parse(readFileSync(report, 'utf8'))
    assert.equal(record.exit._tag, 'TimedOut')
    assert.equal(record.childLifecycle._tag, 'ProvenComplete')
    assert.equal(readFileSync(marker, 'utf8'), 'once')
    assert.deepEqual(await watchSupervisedCommand(directory), outcome)
    await assert.rejects(startSupervisedCommand({ command: [process.execPath, service], cwd: root, directory, deadlineMs: 15000 }), /exist|fresh/i)
  }
  finally { rmSync(root, { recursive: true, force: true }) }
}, 30000)

native('bounds detached descendants when the controller cannot enforce its own deadline', async () => {
  const root = mkdtempSync(join(tmpdir(), 'ripide-supervisor-timeout-'))
  const pidFile = join(root, 'child.pid')
  const service = join(root, 'service.ts')
  writeFileSync(service, `import { spawn } from 'node:child_process'
import { writeFileSync } from 'node:fs'
const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { detached: true, stdio: 'ignore' })
writeFileSync(${JSON.stringify(pidFile)}, String(child.pid))
setInterval(() => {}, 1000)
`)
  try {
    const directory = join(root, 'supervision')
    await startSupervisedCommand({ command: [process.execPath, service], cwd: root, directory, deadlineMs: 2000 })
    const outcome = await watchSupervisedCommand(directory)
    assert.equal(outcome._tag, 'Failed')
    assert.equal(outcome.result, 'timeout')
    assert.match(execFileSync('systemctl', ['--user', 'show', outcome.unit, '--property=LoadState'], { encoding: 'utf8' }), /LoadState=not-found/)
    const pid = Number(readFileSync(pidFile, 'utf8'))
    if (existsSync(`/proc/${pid}/stat`))
      assert.match(readFileSync(`/proc/${pid}/stat`, 'utf8'), /\) Z /)
    assert.deepEqual(await watchSupervisedCommand(directory), outcome)
  }
  finally { rmSync(root, { recursive: true, force: true }) }
}, 15000)

native('preserves environment values and literal command arguments', async () => {
  const root = mkdtempSync(join(tmpdir(), 'ripide supervisor env-'))
  const result = join(root, 'value.json')
  const service = join(root, 'service.ts')
  const value = 'quotes " and \' and \\ and $HOME and `literal`\nnext line'
  const previous = process.env.RIPIDE_SUPERVISOR_PROBE
  process.env.RIPIDE_SUPERVISOR_PROBE = value
  writeFileSync(service, `import { writeFileSync } from 'node:fs'
writeFileSync(${JSON.stringify(result)}, JSON.stringify({ value: process.env.RIPIDE_SUPERVISOR_PROBE, arguments: process.argv.slice(2) }))
`)
  try {
    const directory = join(root, 'supervision')
    await startSupervisedCommand({ command: [process.execPath, service, '$HOME', '%n'], cwd: root, directory, deadlineMs: 5000 })
    assert.equal((await watchSupervisedCommand(directory))._tag, 'Completed')
    assert.deepEqual(JSON.parse(readFileSync(result, 'utf8')), { value, arguments: ['$HOME', '%n'] })
  }
  finally {
    if (previous === undefined)
      delete process.env.RIPIDE_SUPERVISOR_PROBE
    else
      process.env.RIPIDE_SUPERVISOR_PROBE = previous
    rmSync(root, { recursive: true, force: true })
  }
})

native('finishes all registered arms after CLI interruption without redispatching', async () => {
  const root = mkdtempSync(join(tmpdir(), 'ripide-supervisor-cli-'))
  const marker = join(root, 'dispatches.txt')
  const actor = join(root, 'actor.ts')
  const manifestPath = join(root, 'manifest.json')
  const out = join(root, 'results')
  const cli = new URL('../evals/experiment/cli.ts', import.meta.url).pathname
  writeFileSync(actor, `import { appendFileSync } from 'node:fs'
appendFileSync(${JSON.stringify(marker)}, 'arm\\n')
await new Promise(resolve => setTimeout(resolve, 400))
console.log(JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 1, cached_input_tokens: 0, output_tokens: 1 } }))
`)
  const manifest: Manifest = {
    id: 'supervised',
    study: 'pilot',
    pilotHash: null,
    seed: 42,
    repeats: 1,
    cache: 'uncontrolled',
    timeoutMs: 5000,
    timeoutPolicy: 'stop-study',
    repairs: 0,
    commonInstructions: 'Preserve source.',
    artifacts: [],
    versions: [],
    usageImports: [],
    tracing: 'strace',
    endpoint: 'delivery-completed',
    usageBoundary: 'complete-responses-through-command-close',
    runners: Object.fromEntries(['direct', 'forced', 'hybrid'].map(mode => [mode, { model: 'scripted', reasoning: 'none', command: [process.execPath, actor] }])) as Manifest['runners'],
    tasks: [{ id: 'preserve', cohort: 'mechanical', operation: 'preserve', prompt: 'Preserve source.', source: { _tag: 'Files', files: { 'source.ts': 'export const value = 1\n' } }, expected: {}, generatedDirectories: [], setup: [], checks: [], symbols: [], qualityGates: [] }],
  }
  writeFileSync(manifestPath, JSON.stringify(manifest))
  try {
    const foreground = spawn(process.execPath, [cli, 'run', '--manifest', manifestPath, '--out', out], { stdio: 'ignore' })
    const closed = new Promise(resolve => foreground.once('close', resolve))
    const deadline = Date.now() + 10000
    while (!existsSync(marker) && Date.now() < deadline)
      await new Promise(resolve => setTimeout(resolve, 10))
    assert.equal(existsSync(marker), true)
    foreground.kill('SIGTERM')
    await closed
    const [first, second] = await Promise.all([watchSupervisedCommand(`${out}.supervisor`), watchSupervisedCommand(`${out}.supervisor`)])
    assert.equal(first._tag, 'Completed')
    assert.deepEqual(second, first)
    const report = JSON.parse(readFileSync(join(out, 'report.json'), 'utf8'))
    assert.deepEqual(report.attempts.map((attempt: { quality: string }) => attempt.quality), ['passed', 'passed', 'passed'])
    assert.equal(readFileSync(marker, 'utf8'), 'arm\narm\narm\n')
    const progress = JSON.parse(readFileSync(join(out, 'progress.json'), 'utf8'))
    assert.equal(progress.active, null)
    assert.equal(progress.attempts.length, 3)
    for (const record of progress.records) {
      const bytes = readFileSync(record.path)
      assert.equal(sha256(bytes), record.sha256)
      assert.equal(JSON.parse(bytes.toString()).childLifecycle._tag, 'ProvenComplete')
    }
  }
  finally { rmSync(root, { recursive: true, force: true }) }
}, 30000)
