import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { createFixtureManifest } from './fixtures.ts'
import { parseManifest } from './manifest.ts'
import { archiveMessage } from './recorder.ts'
import { startSupervisedCommand, supervisorDeadline, watchSupervisedCommand } from './supervisor.ts'

async function main() {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: { 'manifest': { type: 'string' }, 'out': { type: 'string' }, 'allow-model-calls': { type: 'boolean', default: false }, 'text': { type: 'string' }, 'installed': { type: 'boolean', default: false }, 'nuxt': { type: 'boolean', default: false }, 'repeats': { type: 'string', default: '1' } } })
  if (!values.out)
    throw new Error('Provide --out in a private scratch directory.')
  const out = resolve(values.out)
  const supervisor = `${out}.supervisor`
  if (positionals[0] === 'watch') {
    const outcome = await watchSupervisedCommand(supervisor)
    console.log(JSON.stringify(outcome))
    if (outcome._tag === 'Failed')
      process.exitCode = 1
    return
  }
  if (positionals[0] === 'fixture') {
    mkdirSync(out, { recursive: true, mode: 0o700 })
    const manifest = createFixtureManifest(process.cwd(), Number(values.repeats), values.installed, values.nuxt)
    const path = resolve(out, 'fixture-manifest.json')
    writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx', mode: 0o600 })
    console.log(path)
    return
  }
  if (positionals[0] === 'steering') {
    if (!values.text)
      throw new Error('Provide the readable steering text before dispatch.')
    console.log(JSON.stringify(archiveMessage(out, 'controller', 'steering', values.text)))
    return
  }
  if (positionals[0] !== 'run' || !values.manifest)
    throw new Error('Use fixture, steering, run --manifest FILE --out NEW_DIRECTORY, or watch --out DIRECTORY.')
  const parsed = parseManifest(JSON.parse(readFileSync(values.manifest, 'utf8')))
  if (parsed._tag === 'Err')
    throw new Error(parsed.message)
  if (!values['allow-model-calls'] && Object.values(parsed.value.runners).some(runner => runner.model !== 'scripted'))
    throw new Error('Model execution is disabled. Register and authorize the model run separately.')
  if (existsSync(out))
    throw new Error('Choose a fresh experiment output directory.')
  const registration = await startSupervisedCommand({
    command: [process.execPath, '--experimental-strip-types', fileURLToPath(new URL('./worker.ts', import.meta.url)), resolve(supervisor, 'input.json'), out, values['allow-model-calls'] ? 'allow-model-calls' : 'scripted'],
    cwd: process.cwd(),
    directory: supervisor,
    deadlineMs: supervisorDeadline(parsed.value),
    input: `${JSON.stringify(parsed.value, null, 2)}\n`,
  })
  console.log(JSON.stringify({ unit: registration.unit, out, supervisor, reconnect: `watch --out ${out}` }))
  const outcome = await watchSupervisedCommand(supervisor)
  console.log(JSON.stringify(outcome))
  if (outcome._tag === 'Failed')
    process.exitCode = 1
}
main().catch((error: unknown) => {
  console.error((error as Error).message)
  process.exitCode = 1
})
