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
  limitations: string[]
  scanned: number
  verification: Verification
  regressions: never[]
}

/** Adapter regions always point into authored source, including both Vue script blocks. */
export type CssCustomPropertyRegion
  = | { _tag: 'Css', source: string, start: number, lang: string }
    | { _tag: 'Script', source: string, start: number, filename: string }
    | { _tag: 'Review', source: string, value: string, start: number, syntax: 'Css' | 'Script', reason: string }

const NAME = /^--[-\w\u0080-\uFFFF]+$/
const IDENT = /[-\w\u0080-\uFFFF]/
const UNKNOWN = '\0'

interface Token { value: string, start: number, end: number }
interface Match { start: number, end: number, name: string, reason?: string }

const LIMITATIONS = [
  'Variable bindings, function results, and opaque names are not evaluated. Inspect runtime producers after rename.',
  'Only files included by the glob and supported source regions are scanned. Include external blocks and generated consumers separately.',
  'Style attributes, tagged templates, and CSS queries require manual review when warned. Unsupported languages require a separate search.',
  'Style compilation and type verification are skipped. Run project checks after apply.',
]

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
    // URL contents are opaque. In preprocessors, protocol slashes are not comments.
    if (/^url\(/i.test(source.slice(i))) {
      i += 4
      let depth = 1
      let quote = ''
      while (i < source.length && depth) {
        const char = source[i++]
        if (char === '\\') {
          i++
          continue
        }
        if (quote) {
          if (char === quote)
            quote = ''
        }
        else if (char === '"' || char === '\'') {
          quote = char
        }
        else if (char === '(') {
          depth++
        }
        else if (char === ')') {
          depth--
        }
      }
      tokens.push({ start, end: i, value: '<url>' })
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
    else if (previous?.value === '(' && [':', ')'].includes(tokens[index + 1]?.value))
      matches.push({ start: token.start, end: token.end, name: token.value, reason: 'CSS query requires manual review' })
  }
  return matches
}

function plausible(pattern: string, name: string): boolean {
  const parts = pattern.split(UNKNOWN).map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  return new RegExp(`^${parts.join('.*')}$`, 's').test(name)
}

type StaticValue = { _tag: 'Known', value: string | number | boolean | null } | { _tag: 'Unknown' }

function unwrapExpression(node: any): any {
  while (node && ['ParenthesizedExpression', 'TSAsExpression', 'TSSatisfiesExpression'].includes(node.type))
    node = node.expression
  return node
}

function staticValue(node: any): StaticValue {
  node = unwrapExpression(node)
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
  node = unwrapExpression(node)
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

function scriptEdits(source: string, program: any, map: ReadonlyMap<string, string>, warn: (position: number, source: string, reason?: string) => void): TextEdit[] {
  const edits: TextEdit[] = []
  const visited = new WeakSet<object>()
  function rewrite(value: string, start: number, end: number, quote: string, matches = stringMatches(value)): void {
    const replacements = matches.flatMap(match => !match.reason && map.has(match.name) ? [{ start: match.start, end: match.end, replacement: map.get(match.name)! }] : [])
    for (const match of matches.filter(match => match.reason && map.has(match.name)))
      warn(start, source.slice(start, end), match.reason)
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
      const uncertain = matches.some(match => [...map.keys()].some(name => (tagged || match.reason || match.name.includes(UNKNOWN)) && plausible(match.name, name)))
      const hidden = pattern.includes(UNKNOWN) && stringMatches(pattern.replaceAll(UNKNOWN, ' ')).some(match => map.has(match.name) && !matches.some(original => original.name === match.name))
      if (uncertain || hidden)
        warn(node.start, raw, tagged ? 'Tagged template requires manual review' : hidden ? 'Unknown CSS context requires manual review' : undefined)
      if (tagged)
        return
      const value = staticString(node)
      if (value !== undefined) {
        if (node.type === 'TemplateLiteral' && !node.expressions.length) {
          rewrite(value, node.start + 1, node.end - 1, '`')
        }
        else {
          const after = applyTextEdits(value, matches.flatMap(match => !match.reason && map.has(match.name) ? [{ start: match.start, end: match.end, replacement: map.get(match.name)! }] : []))
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
          const safe = matches.filter(match => !match.reason && !match.name.includes(UNKNOWN) && match.start >= current.cursor && match.end <= current.cursor + current.value.length)
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
      else {
        // Match against the complete expression before editing any known operand.
        const chunks = (operand: any, cursor: number): void => {
          operand = unwrapExpression(operand)
          const text = staticString(operand)
          if (text !== undefined) {
            const safe = matches.filter(match => !match.reason && match.start >= cursor && match.end <= cursor + text.length)
              .map(match => ({ ...match, start: match.start - cursor, end: match.end - cursor }))
            if (operand.type === 'Literal' && typeof operand.value === 'string') {
              rewrite(text, operand.start + 1, operand.end - 1, source[operand.start], safe)
            }
            else if (operand.type === 'TemplateLiteral' && !operand.expressions.length) {
              rewrite(text, operand.start + 1, operand.end - 1, '`', safe)
            }
            else {
              const after = applyTextEdits(text, safe.flatMap(match => map.has(match.name) ? [{ start: match.start, end: match.end, replacement: map.get(match.name)! }] : []))
              if (after !== text)
                edits.push({ start: operand.start, end: operand.end, replacement: JSON.stringify(after) })
            }
          }
          else if (operand.type === 'BinaryExpression' && operand.operator === '+') {
            chunks(operand.left, cursor)
            chunks(operand.right, cursor + patternString(operand.left).length)
          }
        }
        chunks(node, 0)
      }
      // Interpolation expressions are not standalone name sites.
      return
    }
    if (node.type === 'Literal' && typeof node.value === 'string') {
      // JSX attribute literals use HTML entities. They are not JS string sites.
      rewrite(node.value, node.start + 1, node.end - 1, source[node.start])
      return
    }
    if (node.type === 'JSXAttribute' && node.value?.type === 'Literal') {
      if (node.name?.name === 'style' && stringMatches(node.value.value).some(match => map.has(match.name)))
        warn(node.start, source.slice(node.start, node.end), 'JSX quoted style attribute requires manual review')
      return
    }
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
    const warn = (position: number, source: string, reason = 'Review dynamic CSS custom property'): void => {
      const { line, col } = posToLineCol(file.source, position)
      warnings.push(`${file.rel}:${line}:${col}: ${reason}: ${source}`)
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
      if (!Number.isInteger(region.start) || region.start < 0 || file.source.slice(region.start, region.start + region.source.length) !== region.source)
        throw new Error(`Extension returned non-authored CSS custom property source for ${file.rel}.`)
      if (region._tag === 'Review') {
        if (region.syntax === 'Css') {
          if (cssMatches(region.value, 'css').some(match => [...map.keys()].some(name => plausible(match.name, name))))
            warn(region.start, region.source, region.reason)
        }
        else {
          const prefix = 'const value = ('
          const script = `${prefix}${region.value})`
          const parsed = parseSync('ripide-style-expression.ts', script)
          if (parsed.errors.length)
            throw new Error(`Cannot inspect style expression in ${file.rel}: script parse errors.`)
          const pending = scriptEdits(script, parsed.program, map, () => warn(region.start, region.source, region.reason))
          if (pending.length)
            warn(region.start, region.source, region.reason)
        }
      }
      else if (region._tag === 'Css') {
        for (const match of cssMatches(region.source, region.lang)) {
          if (match.reason && [...map.keys()].some(name => plausible(match.name, name))) {
            warn(region.start + match.start, region.source.slice(match.start, match.end), match.reason)
          }
          else if (match.name.includes(UNKNOWN)) {
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
  return { changes, warnings: [...new Set(warnings)], limitations: [...LIMITATIONS], scanned: files.length, regressions: [], verification: { _tag: 'Skipped', reason: changes.length ? 'not-applicable' : 'no-changes' } }
}
