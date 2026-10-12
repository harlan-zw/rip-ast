import { Buffer } from 'node:buffer'
import { spawnSync } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { checkCases } from './check-cases.ts'
import { sha256 } from './manifest.ts'

const [name, executable, ...args] = process.argv.slice(2)
const directory = process.env.RIPIDE_EXPERIMENT_RECORD_DIRECTORY!
const project = process.env.RIPIDE_EXPERIMENT_PROJECT
if (!project || !isAbsolute(project))
  throw new Error('Supply the absolute registered project directory.')
if (!directory || !isAbsolute(directory) || !relative(project, directory).startsWith('..'))
  throw new Error('Supply an absolute record directory outside the project.')
const selection = join(directory, 'selected-workflow.txt')
if (process.env.RIPIDE_EXPERIMENT_VARIANT === 'guided' && process.env.RIPIDE_EXPERIMENT_MODE === 'hybrid') {
  if (!existsSync(selection))
    throw new Error('Select one runner with check-workflow vitest or check-workflow ripide.')
  if (readFileSync(selection, 'utf8') !== name)
    throw new Error('Keep the selected runner for this attempt.')
}
const stdin = name === 'ripide' && args[0] === 'check' && args[1] && !args[1].startsWith('--')
  ? readFileSync(0)
  : undefined
const path = process.env.RIPIDE_EXPERIMENT_TEST_PATH ? resolve(project, process.env.RIPIDE_EXPERIMENT_TEST_PATH) : undefined
const assertions = stdin ?? (path && existsSync(path) ? readFileSync(path) : undefined)
const option = name === 'vitest' ? '--outputFile' : '--artifact'
const value = args.find(arg => arg.startsWith(`${option}=`))?.slice(option.length + 1)
  ?? (args.includes(option) ? args[args.indexOf(option) + 1] : undefined)
const artifact = value ? resolve(project, value) : undefined
const attempts = join(directory, 'check-attempts')
mkdirSync(attempts, { recursive: true, mode: 0o700 })
const attempt = mkdtempSync(join(attempts, 'attempt-'))
const capturedArtifact = artifact ? join(attempt, 'report.json') : undefined
const assertionPath = assertions ? join(attempt, 'assertions.txt') : undefined
if (assertionPath && assertions)
  writeFileSync(assertionPath, assertions, { flag: 'wx', mode: 0o400 })
const executionArgs = [...args]
if (capturedArtifact) {
  const index = args.findIndex(arg => arg === option || arg.startsWith(`${option}=`))
  if (args[index] === option)
    executionArgs[index + 1] = capturedArtifact
  else
    executionArgs[index] = `${option}=${capturedArtifact}`
}
const started = new Date().toISOString()
const sourceFile = checkCases.find(scenario => scenario.id === process.env.RIPIDE_EXPERIMENT_TASK)?.file
const sourceHash = sourceFile ? sha256(readFileSync(resolve(project, sourceFile))) : null
const result = spawnSync(process.execPath, [executable, ...executionArgs], { cwd: project, input: stdin, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })
const artifactBytes = capturedArtifact && existsSync(capturedArtifact) ? readFileSync(capturedArtifact) : undefined
if (artifact && artifactBytes) {
  mkdirSync(dirname(artifact), { recursive: true })
  writeFileSync(artifact, artifactBytes)
}
let executed = name === 'ripide'
if (name === 'vitest' && artifactBytes && path) {
  const report = JSON.parse(artifactBytes.toString()) as { testResults?: { name: string }[] }
  executed = report.testResults?.length === 1 && resolve(project, report.testResults[0].name) === path
}
appendFileSync(join(directory, 'commands.called'), `${name}\n`)
appendFileSync(join(directory, 'check-commands.jsonl'), `${JSON.stringify({ name, args, executionArgs, started, completed: new Date().toISOString(), exit: result.status, signal: result.signal, sourceHash, assertionPath, assertionHash: assertions && executed ? sha256(assertions) : null, testPath: name === 'vitest' ? path : null, artifact, capturedArtifact, artifactHash: artifactBytes ? sha256(artifactBytes) : null, stdoutBytes: Buffer.byteLength(result.stdout ?? ''), stderrBytes: Buffer.byteLength(result.stderr ?? '') })}\n`)
process.stdout.write(result.stdout ?? '')
process.stderr.write(result.stderr ?? '')
if (result.error)
  throw result.error
if (result.signal)
  throw new Error(`Check process terminated: ${result.signal}`)
process.exitCode = result.status ?? 1
