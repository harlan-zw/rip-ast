import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { projectContext } from './check-context.ts'
import { executeExperiment } from './execute.ts'
import { parseManifest } from './manifest.ts'

async function main() {
  const [action, ...args] = process.argv.slice(2)
  if (action === 'attempt') {
    const [project, task, root, provenance, mode, scope] = args
    const captured = JSON.parse(readFileSync(provenance, 'utf8')) as { scenario: { id: string, symbol: string, file: string, tests: string }, capture: { original: string, files: Record<string, string> } }[]
    const row = captured.find(row => row.scenario.id === task)!
    const module = Object.entries(row.capture.files).find(([, code]) => code.includes(`function ${row.scenario.symbol}`))![0]
    const directory = join(project, '.checks')
    mkdirSync(directory, { recursive: true })
    const context = scope === 'projects' ? projectContext(task) : { args: [], testPath: '.checks/proof.test.ts' }
    const test = join(project, context.testPath)
    const wrapper = fileURLToPath(new URL('./check-command.ts', import.meta.url))
    if (mode === 'hybrid') {
      const selected = spawnSync(process.execPath, [fileURLToPath(new URL('./check-workflow.ts', import.meta.url)), 'ripide'], {
        encoding: 'utf8',
        env: { ...process.env, RIPIDE_EXPERIMENT_TASK: task, RIPIDE_EXPERIMENT_SCOPE: scope },
      })
      assert.equal(selected.status, 0, selected.stderr)
    }
    const execute = (color: string) => {
      const forced = mode !== 'direct'
      const executable = forced ? join(root, 'packages/cli/bin/ripide.mjs') : join(project, 'node_modules/vitest/vitest.mjs')
      const params = forced
        ? ['check', row.scenario.symbol, ...context.args, '--base', 'HEAD', '--json', '--artifact', `.checks/${color}.json`]
        : ['run', context.testPath, ...context.args, '--reporter=json', `--outputFile=.checks/${color}.json`]
      if (!forced)
        writeFileSync(test, `import {test, expect, vi} from 'vitest'\nimport {${row.scenario.symbol}} from '${relative(dirname(test), join(project, module))}'\n${row.scenario.tests}\n`)
      const result = spawnSync(process.execPath, [wrapper, forced ? 'ripide' : 'vitest', executable, ...params], { cwd: project, encoding: 'utf8', input: row.scenario.tests, timeout: 60000, env: { ...process.env, HOME: join(process.env.RIPIDE_EXPERIMENT_RECORD_DIRECTORY!, 'home'), RIPIDE_EXPERIMENT_PROJECT: project, RIPIDE_EXPERIMENT_TEST_PATH: test, RIPIDE_EXPERIMENT_VARIANT: 'guided' } })
      if (result.error)
        throw result.error
      if (result.status !== (color === 'red' ? 1 : 0))
        throw new Error(`Unexpected ${color} exit: ${result.status}\n${result.stderr}\n${result.stdout}`)
      return result
    }
    execute('red')
    writeFileSync(join(project, row.scenario.file), row.capture.original)
    execute('green')
    const commandsPath = join(process.env.RIPIDE_EXPERIMENT_RECORD_DIRECTORY!, 'check-commands.jsonl')
    const commands = () => readFileSync(commandsPath, 'utf8').trim().split('\n').map(line => JSON.parse(line) as { assertionPath: string, capturedArtifact: string })
    const firstGreen = commands().at(-1)!
    const firstReport = readFileSync(firstGreen.capturedArtifact)
    execute('green')
    const retry = commands().at(-1)!
    assert.notEqual(firstGreen.capturedArtifact, retry.capturedArtifact)
    assert.deepEqual(readFileSync(firstGreen.capturedArtifact), firstReport)
    assert.deepEqual(readFileSync(firstGreen.assertionPath), readFileSync(retry.assertionPath))
    rmSync(test, { force: true })
    const check = (expected: number, message?: string) => {
      const result = spawnSync(join(process.env.RIPIDE_EXPERIMENT_RECORD_DIRECTORY!, 'home/bin/check-behavior'), [], { cwd: project, encoding: 'utf8', timeout: 60000 })
      if (result.error)
        throw result.error
      assert.equal(result.status, expected, result.stderr || result.stdout)
      if (message)
        assert.ok(result.stderr.includes(message), result.stderr)
    }
    check(0)
    const green = join(directory, 'green.json')
    const greenBytes = readFileSync(green)
    rmSync(green)
    try {
      check(1, 'green.json')
    }
    finally {
      writeFileSync(green, greenBytes)
    }
    check(0)
    for (const name of ['snippet.ts', 'helper.check.ts']) {
      const helper = join(directory, name)
      writeFileSync(helper, 'export const receiptNoise = true\n', { flag: 'wx' })
      // Staging must not turn an authored helper into an original fixture file.
      try {
        const staged = spawnSync('git', ['add', '--force', '--', helper], { cwd: project, encoding: 'utf8' })
        assert.equal(staged.status, 0, staged.stderr)
        check(1, 'Remove every new code helper from .checks.')
      }
      finally {
        const reset = spawnSync('git', ['reset', '--quiet', 'HEAD', '--', helper], { cwd: project, encoding: 'utf8' })
        assert.equal(reset.status, 0, reset.stderr)
        rmSync(helper)
      }
      check(0)
    }
    if (mode !== 'direct') {
      const noise = join(project, 'receipt-noise.ts')
      writeFileSync(noise, 'export const receiptNoise = true\n', { flag: 'wx' })
      try {
        check(1, 'Record execution of the repaired function.')
      }
      finally {
        rmSync(noise)
      }
      check(0)
    }
    return
  }
  const [manifestPath, out, selectedCase] = args
  const parsed = parseManifest(JSON.parse(readFileSync(manifestPath, 'utf8')))
  if (parsed._tag === 'Err')
    throw new Error(parsed.message)
  if (selectedCase) {
    parsed.value.tasks = parsed.value.tasks.filter(task => task.id === selectedCase)
    assert.ok(parsed.value.tasks.length, 'Choose a registered check case.')
  }
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
  const provenance = parsed.value.artifacts.find(artifact => artifact.path.endsWith('/source-provenance.json'))!.path
  const scope = parsed.value.id.includes('-projects-') ? 'projects' : 'slices'
  for (const mode of ['direct', 'forced', 'hybrid'] as const)
    parsed.value.runners[mode] = { model: 'scripted', reasoning: 'none', command: [process.execPath, fileURLToPath(import.meta.url), 'attempt', '{project}', '{task}', root, provenance, mode, scope] }
  const report = await executeExperiment(parsed.value, out)
  const expected = parsed.value.tasks.length * 3 * parsed.value.repeats
  assert.equal(report.attempts.length, expected)
  assert.equal(report.attempts.filter(attempt => attempt.quality === 'passed').length, expected)
  console.log(`${expected} deterministic real-source workflows passed.`)
}
main().catch((error: unknown) => {
  console.error(error)
  process.exitCode = 1
})
