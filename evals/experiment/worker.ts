import { readFileSync } from 'node:fs'
import { executeExperiment } from './execute.ts'
import { parseManifest } from './manifest.ts'

async function main() {
  const [input, out, authorization] = process.argv.slice(2)
  if (!input || !out || !['scripted', 'allow-model-calls'].includes(authorization))
    throw new Error('Provide a supervisor input, output directory, and model authorization.')
  const parsed = parseManifest(JSON.parse(readFileSync(input, 'utf8')))
  if (parsed._tag === 'Err')
    throw new Error(parsed.message)
  const report = await executeExperiment(parsed.value, out, { allowModelCalls: authorization === 'allow-model-calls' })
  console.log(JSON.stringify({ manifestHash: report.manifestHash, attempts: report.attempts.length, summaries: report.summaries }, null, 2))
  if (report.attempts.some(attempt => attempt.quality !== 'passed'))
    process.exitCode = 1
}

main().catch((error: unknown) => {
  console.error((error as Error).message)
  process.exitCode = 1
})
