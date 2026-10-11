import type { CssClassSourceOptions } from './css-class-source.ts'
import type { FileChange, TextEdit } from './util.ts'
import type { Verification } from './verification.ts'
import { parseSync } from 'oxc-parser'
import { cssSyntax, readCssClassSourceFiles } from './css-class-source.ts'
import { applyTextEdits, parseSourceFile, posToLineCol } from './util.ts'

export type CssCustomPropertyRenameOptions = CssClassSourceOptions
export interface CssCustomPropertyRenameResult {
  changes: FileChange[]
  warnings: string[]
  scanned: number
  verification: Verification
  regressions: never[]
}

/** Adapter regions always point into authored source, including both Vue script blocks. */
export type CssCustomPropertyRegion
  = | { _tag: 'Css', source: string, start: number, lang: string }
    | { _tag: 'Script', source: string, start: number, filename: string }

const NAME = /^--[-\w\u0080-\uFFFF]+$/
const IDENT = /[-\w\u0080-\uFFFF]/
const UNKNOWN = '\0'

interface Token { value: string, start: number, end: number }
interface Match { start: number, end: number, name: string }

/** A lossless token walk, not a stylesheet printer. Strings and comments are opaque. */
function cssMatches(source: string, lang: string): Match[] {
  const tokens: Token[] = []
  const syntax = cssSyntax(lang)
  for (let i = 0; i < source.length;) {
    const start = i
    if (/\s/.test(source[i])) {
      i++
      continue
    }
    if (source.startsWith('/*', i) || (syntax.lineComments && source.startsWith('//', i))) {
      const block = source[i + 1] === '*'
      const end = source.indexOf(block ? '*/' : '\n', i + 2)
      i = end === -1 ? source.length : end + (block ? 2 : 0)
      continue
    }
    if (source[i] === '"' || source[i] === '\'') {
      const quote = source[i++]
      while (i < source.length) {
        if (source[i] === '\\') {
          i += 2
          continue
        }
        if (source[i++] === quote)
          break
      }
      tokens.push({ start, end: i, value: '<string>' })
      continue
    }
    if (IDENT.test(source[i]) || source[i] === UNKNOWN || source[i] === '\\') {
      let value = ''
      while (i < source.length) {
        if (IDENT.test(source[i]) || source[i] === UNKNOWN) {
          value += source[i++]
          continue
        }
        if (source[i] === '\\') {
          const escape = /^\\([\da-f]{1,6})(?:\r\n|[\t\n\f\r ])?|^\\([^\r\n])/i.exec(source.slice(i))
          if (!escape)
            break
          const code = escape[1] ? Number.parseInt(escape[1], 16) : undefined
          value += code === undefined ? escape[2] : String.fromCodePoint(code && code <= 0x10FFFF ? code : 0xFFFD)
          i += escape[0].length
          continue
        }
        // Preprocessor interpolation has unknown runtime contents.
        if (source.startsWith('#{', i) || source.startsWith('@{', i)) {
          const end = source.indexOf('}', i + 2)
          value += UNKNOWN
          i = end === -1 ? source.length : end + 1
          continue
        }
        break
      }
      tokens.push({ value, start, end: i })
      continue
    }
    tokens.push({ value: source[i], start, end: ++i })
  }
  const matches: Match[] = []
  for (const [index, token] of tokens.entries()) {
    if (!token.value.startsWith('--') && !(token.value.includes(UNKNOWN) && token.value.includes('--')))
      continue
    const previous = tokens[index - 1]
    const before = tokens[index - 2]
    const declaration = tokens[index + 1]?.value === ':' && (!previous || ['{', ';', '}'].includes(previous.value) || (syntax.indented && /[\r\n]/.test(source.slice(previous.end, token.start))))
    const reference = previous?.value === '(' && before?.value.toLowerCase() === 'var' && [',', ')'].includes(tokens[index + 1]?.value)
    const registration = previous?.value === 'property' && before?.value === '@'
    if (declaration || reference || registration)
      matches.push({ start: token.start, end: token.end, name: token.value })
  }
  return matches
}

function plausible(pattern: string, name: string): boolean {
  const parts = pattern.split(UNKNOWN).map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  return new RegExp(`^${parts.join('.*')}$`, 's').test(name)
}

type StaticValue = { _tag: 'Known', value: string | number | boolean | null } | { _tag: 'Unknown' }

function staticValue(node: any): StaticValue {
  if (node?.type === 'ParenthesizedExpression' || node?.type === 'TSAsExpression' || node?.type === 'TSSatisfiesExpression')
    return staticValue(node.expression)
  if (node?.type === 'Literal' && (node.value === null || ['string', 'number', 'boolean'].includes(typeof node.value)))
    return { _tag: 'Known', value: node.value }
  if (node?.type === 'BinaryExpression' && node.operator === '+') {
    const left = staticValue(node.left)
    const right = staticValue(node.right)
    if (left._tag === 'Unknown' || right._tag === 'Unknown')
      return { _tag: 'Unknown' }
    return { _tag: 'Known', value: typeof left.value === 'string' || typeof right.value === 'string' ? String(left.value) + String(right.value) : Number(left.value) + Number(right.value) }
  }
  if (node?.type === 'TemplateLiteral') {
    let value = ''
    for (const [index, quasi] of node.quasis.entries()) {
      if (typeof quasi.value.cooked !== 'string')
        return { _tag: 'Unknown' }
      value += quasi.value.cooked
      if (index < node.expressions.length) {
        const expression = staticValue(node.expressions[index])
        if (expression._tag === 'Unknown')
          return expression
        value += String(expression.value)
      }
    }
    return { _tag: 'Known', value }
  }
  return { _tag: 'Unknown' }
}

function staticString(node: any): string | undefined {
  const result = staticValue(node)
  return result._tag === 'Known' ? String(result.value) : undefined
}

function patternString(node: any): string {
  const value = staticString(node)
  if (value !== undefined)
    return value
  if (node?.type === 'TemplateLiteral')
    return node.quasis.map((quasi: any, index: number) => (quasi.value.cooked ?? quasi.value.raw) + (index < node.expressions.length ? patternString(node.expressions[index]) : '')).join('')
  if (node?.type === 'BinaryExpression' && node.operator === '+')
    return patternString(node.left) + patternString(node.right)
  return UNKNOWN
}

function stringMatches(value: string): Match[] {
  if (NAME.test(value) || (value.includes(UNKNOWN) && value.includes('--') && !/[^-\w\u0080-\uFFFF\0]/.test(value)))
    return [{ start: 0, end: value.length, name: value }]
  // Recognise CSS payloads, without treating prose or HTML samples as styles.
  const trimmed = value.trimStart()
  const delimiter = trimmed.search(/[:(]/)
  const header = trimmed.slice(0, delimiter).trimEnd().replaceAll(UNKNOWN, 'a')
  const cssHeader = delimiter !== -1 && (NAME.test(header) || /^[-\w]+$/.test(header))
  if (/<\/?[a-z]/i.test(value) || (!cssHeader && !/^[^{};]+\{/.test(trimmed)))
    return []
  return cssMatches(value, 'css')
}

function encodeContent(value: string, quote: string): string {
  let encoded = JSON.stringify(value).slice(1, -1)
  if (quote === '\'')
    encoded = encoded.replace(/'/g, '\\\'')
  if (quote === '`')
    encoded = encoded.replace(/`/g, '\\`').replace(/\$\{/g, '\\${')
  return encoded
}

function scriptEdits(source: string, program: any, map: ReadonlyMap<string, string>, warn: (position: number, source: string) => void): TextEdit[] {
  const edits: TextEdit[] = []
  const visited = new WeakSet<object>()
  function rewrite(value: string, start: number, end: number, quote: string, matches = stringMatches(value)): void {
    const replacements = matches.flatMap(match => map.has(match.name) ? [{ start: match.start, end: match.end, replacement: map.get(match.name)! }] : [])
    if (!replacements.length)
      return
    const raw = source.slice(start, end)
    if (raw === value) {
      edits.push(...replacements.map(edit => ({ start: start + edit.start, end: start + edit.end, replacement: edit.replacement })))
    }
    else {
      edits.push({ start, end, replacement: encodeContent(applyTextEdits(value, replacements), quote) })
    }
  }
  function walk(node: any): void {
    if (!node || typeof node !== 'object' || visited.has(node))
      return
    visited.add(node)
    const tagged = node.type === 'TaggedTemplateExpression'
    const template = tagged ? node.quasi : node
    if (tagged || node.type === 'TemplateLiteral' || (node.type === 'BinaryExpression' && node.operator === '+')) {
      const pattern = patternString(template)
      const matches = stringMatches(pattern)
      const raw = source.slice(node.start, node.end)
      if (matches.some(match => [...map.keys()].some(name => (tagged || match.name.includes(UNKNOWN)) && plausible(match.name, name))))
        warn(node.start, raw)
      if (tagged)
        return
      const value = staticString(node)
      if (value !== undefined) {
        if (node.type === 'TemplateLiteral' && !node.expressions.length) {
          rewrite(value, node.start + 1, node.end - 1, '`')
        }
        else {
          const after = applyTextEdits(value, matches.flatMap(match => map.has(match.name) ? [{ start: match.start, end: match.end, replacement: map.get(match.name)! }] : []))
          if (after !== value)
            edits.push({ start: node.start, end: node.end, replacement: node.type === 'TemplateLiteral' ? `\`${encodeContent(after, '`')}\`` : JSON.stringify(after) })
        }
        return
      }
      if (node.type === 'TemplateLiteral') {
        // Combine quasis across proven expressions. Unknown expressions split authored ranges.
        let cursor = 0
        let chunk: { value: string, start: number, end: number, cursor: number } | undefined
        const flush = (): void => {
          if (!chunk)
            return
          const current = chunk
          const safe = matches.filter(match => !match.name.includes(UNKNOWN) && match.start >= current.cursor && match.end <= current.cursor + current.value.length)
          rewrite(current.value, current.start, current.end, '`', safe.map(match => ({ ...match, start: match.start - current.cursor, end: match.end - current.cursor })))
          chunk = undefined
        }
        for (const [index, quasi] of node.quasis.entries()) {
          const text = quasi.value.cooked ?? quasi.value.raw
          const rangeStart = source[quasi.start] === '`' || source[quasi.start] === '}' ? quasi.start + 1 : quasi.start
          const rangeEnd = rangeStart + quasi.value.raw.length
          if (!chunk)
            chunk = { value: '', start: rangeStart, end: rangeEnd, cursor }
          chunk.value += text
          chunk.end = rangeEnd
          cursor += text.length
          if (index < node.expressions.length) {
            const expression = staticString(node.expressions[index])
            if (expression === undefined)
              flush()
            else chunk.value += expression
            cursor += patternString(node.expressions[index]).length
          }
        }
        flush()
      }
      // Partial concatenations and interpolation expressions are not standalone name sites.
      return
    }
    if (node.type === 'Literal' && typeof node.value === 'string') {
      // JSX attribute literals use HTML entities. They are not JS string sites.
      rewrite(node.value, node.start + 1, node.end - 1, source[node.start])
      return
    }
    if (node.type === 'JSXAttribute' && node.value?.type === 'Literal')
      return
    if (node.type === 'ImportDeclaration' || node.type === 'ExportAllDeclaration' || node.type === 'ImportExpression')
      return
    if (node.type === 'CallExpression' && node.callee?.name === 'require')
      return
    for (const [key, child] of Object.entries(node)) {
      if (['loc', 'range', 'comments', 'parent', 'metadata'].includes(key) || (key === 'source' && node.type === 'ExportNamedDeclaration'))
        continue
      if (Array.isArray(child))
        child.forEach(walk)
      else if (child && typeof child === 'object')
        walk(child)
    }
  }
  walk(program)
  return edits
}

export async function runCssCustomPropertyRename(map: ReadonlyMap<string, string>, opts: CssCustomPropertyRenameOptions = {}): Promise<CssCustomPropertyRenameResult> {
  for (const [from, to] of map) {
    if (!NAME.test(from) || !NAME.test(to))
      throw new Error('Each CSS custom property must start with -- and contain only identifier characters.')
  }
  const changes: FileChange[] = []
  const warnings: string[] = []
  const files = map.size ? readCssClassSourceFiles(opts, ['.tsrx']) : []
  for (const file of files) {
    const warn = (position: number, source: string): void => {
      const { line, col } = posToLineCol(file.source, position)
      warnings.push(`${file.rel}:${line}:${col}: Review dynamic CSS custom property: ${source}`)
    }
    const extension = file.engine?.extensions.find(extension => extension.suffixes.some(suffix => file.abs.endsWith(suffix)))
    let regions: CssCustomPropertyRegion[]
    if (extension) {
      if (!extension.cssCustomProperties)
        throw new Error(`Extension ${extension.name} cannot rename CSS custom properties.`)
      regions = extension.cssCustomProperties(file)
    }
    else if (/\.(?:css|scss|sass|less|postcss|pcss)$/.test(file.abs)) {
      regions = [{ _tag: 'Css', source: file.source, start: 0, lang: file.abs }]
    }
    else {
      regions = [{ _tag: 'Script', source: file.source, start: 0, filename: file.abs }]
    }
    const edits: TextEdit[] = []
    for (const region of regions) {
      if (file.source.slice(region.start, region.start + region.source.length) !== region.source)
        throw new Error(`Extension returned non-authored CSS custom property source for ${file.rel}.`)
      if (region._tag === 'Css') {
        for (const match of cssMatches(region.source, region.lang)) {
          if (match.name.includes(UNKNOWN)) {
            if ([...map.keys()].some(name => plausible(match.name, name)))
              warn(region.start + match.start, region.source.slice(match.start, match.end))
          }
          else if (map.has(match.name)) {
            edits.push({ start: region.start + match.start, end: region.start + match.end, replacement: map.get(match.name)! })
          }
        }
      }
      else {
        const parsed = region.filename.endsWith('.tsrx')
          ? { program: parseSourceFile(region.filename, region.source, file.cwd).program, errors: [] }
          : parseSync(region.filename, region.source)
        if (parsed.errors.length)
          throw new Error(`Cannot rename CSS custom properties in ${file.rel}: script parse errors.`)
        edits.push(...scriptEdits(region.source, parsed.program, map, (position, source) => warn(region.start + position, source)).map(edit => ({ ...edit, start: region.start + edit.start, end: region.start + edit.end })))
      }
    }
    const after = applyTextEdits(file.source, edits)
    if (after !== file.source)
      changes.push({ path: file.abs, rel: file.rel, before: file.source, after })
  }
  return { changes, warnings, scanned: files.length, regressions: [], verification: { _tag: 'Skipped', reason: changes.length ? 'not-applicable' : 'no-changes' } }
}
