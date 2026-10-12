import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { checkCases } from './check-cases.ts'
import { workflowInstructions } from './check-context.ts'

const [runner] = process.argv.slice(2)
if (process.argv.length !== 3 || !['vitest', 'ripide'].includes(runner))
  throw new Error('Usage: check-workflow vitest|ripide')
const directory = process.env.RIPIDE_EXPERIMENT_RECORD_DIRECTORY
const scenario = checkCases.find(row => row.id === process.env.RIPIDE_EXPERIMENT_TASK)
if (!directory || !scenario)
  throw new Error('Supply the record directory and registered check case.')
const path = join(directory, 'selected-workflow.txt')
if (existsSync(path)) {
  if (readFileSync(path, 'utf8') !== runner)
    throw new Error('Keep the selected runner for this attempt.')
}
else {
  writeFileSync(path, runner, { flag: 'wx', mode: 0o400 })
}
console.log(workflowInstructions(runner === 'vitest' ? 'direct' : 'forced', scenario, process.env.RIPIDE_EXPERIMENT_SCOPE ?? 'slices', 'guided'))
