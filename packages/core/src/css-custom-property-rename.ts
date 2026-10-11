import type { CssClassSourceOptions } from './css-class-source.ts'
import type { FileChange, TextEdit } from './util.ts'
import type { Verification } from './verification.ts'
import { parseSync } from 'oxc-parser'
import { cssSyntax, decodeJsxAttribute, readCssClassSourceFiles } from './css-class-source.ts'
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
// CSSStyleProperties names from TypeScript 6.0.3 lib.dom.d.ts. No runtime metadata dependency.
const CSS_PROPERTIES = new Set(`
-webkit-align-content -webkit-align-items -webkit-align-self -webkit-animation -webkit-animation-delay
-webkit-animation-direction -webkit-animation-duration -webkit-animation-fill-mode
-webkit-animation-iteration-count -webkit-animation-name -webkit-animation-play-state
-webkit-animation-timing-function -webkit-appearance -webkit-backface-visibility -webkit-background-clip
-webkit-background-origin -webkit-background-size -webkit-border-bottom-left-radius
-webkit-border-bottom-right-radius -webkit-border-radius -webkit-border-top-left-radius
-webkit-border-top-right-radius -webkit-box-align -webkit-box-flex -webkit-box-ordinal-group -webkit-box-orient
-webkit-box-pack -webkit-box-shadow -webkit-box-sizing -webkit-filter -webkit-flex -webkit-flex-basis
-webkit-flex-direction -webkit-flex-flow -webkit-flex-grow -webkit-flex-shrink -webkit-flex-wrap
-webkit-justify-content -webkit-line-clamp -webkit-mask -webkit-mask-box-image -webkit-mask-box-image-outset
-webkit-mask-box-image-repeat -webkit-mask-box-image-slice -webkit-mask-box-image-source
-webkit-mask-box-image-width -webkit-mask-clip -webkit-mask-composite -webkit-mask-image -webkit-mask-origin
-webkit-mask-position -webkit-mask-repeat -webkit-mask-size -webkit-order -webkit-perspective
-webkit-perspective-origin -webkit-text-fill-color -webkit-text-size-adjust -webkit-text-stroke
-webkit-text-stroke-color -webkit-text-stroke-width -webkit-transform -webkit-transform-origin
-webkit-transform-style -webkit-transition -webkit-transition-delay -webkit-transition-duration
-webkit-transition-property -webkit-transition-timing-function -webkit-user-select accent-color align-content
align-items align-self alignment-baseline all anchor-name anchor-scope animation animation-composition
animation-delay animation-direction animation-duration animation-fill-mode animation-iteration-count
animation-name animation-play-state animation-range animation-range-end animation-range-start
animation-timeline animation-timing-function appearance aspect-ratio backdrop-filter backface-visibility
background background-attachment background-blend-mode background-clip background-color background-image
background-origin background-position background-position-x background-position-y background-repeat
background-size baseline-shift baseline-source block-size border border-block border-block-color
border-block-end border-block-end-color border-block-end-style border-block-end-width border-block-start
border-block-start-color border-block-start-style border-block-start-width border-block-style
border-block-width border-bottom border-bottom-color border-bottom-left-radius border-bottom-right-radius
border-bottom-style border-bottom-width border-collapse border-color border-end-end-radius
border-end-start-radius border-image border-image-outset border-image-repeat border-image-slice
border-image-source border-image-width border-inline border-inline-color border-inline-end
border-inline-end-color border-inline-end-style border-inline-end-width border-inline-start
border-inline-start-color border-inline-start-style border-inline-start-width border-inline-style
border-inline-width border-left border-left-color border-left-style border-left-width border-radius
border-right border-right-color border-right-style border-right-width border-spacing border-start-end-radius
border-start-start-radius border-style border-top border-top-color border-top-left-radius
border-top-right-radius border-top-style border-top-width border-width bottom box-decoration-break box-shadow
box-sizing break-after break-before break-inside caption-side caret-color clear clip clip-path clip-rule color
color-interpolation color-interpolation-filters color-scheme column-count column-fill column-gap column-rule
column-rule-color column-rule-style column-rule-width column-span column-width columns contain
contain-intrinsic-block-size contain-intrinsic-height contain-intrinsic-inline-size contain-intrinsic-size
contain-intrinsic-width container container-name container-type content content-visibility counter-increment
counter-reset counter-set cursor cx cy d direction display dominant-baseline dynamic-range-limit empty-cells
field-sizing fill fill-opacity fill-rule filter flex flex-basis flex-direction flex-flow flex-grow flex-shrink
flex-wrap float flood-color flood-opacity font font-family font-feature-settings font-kerning
font-language-override font-optical-sizing font-palette font-size font-size-adjust font-stretch font-style
font-synthesis font-synthesis-small-caps font-synthesis-style font-synthesis-weight font-variant
font-variant-alternates font-variant-caps font-variant-east-asian font-variant-emoji font-variant-ligatures
font-variant-numeric font-variant-position font-variation-settings font-weight forced-color-adjust gap grid
grid-area grid-auto-columns grid-auto-flow grid-auto-rows grid-column grid-column-end grid-column-gap
grid-column-start grid-gap grid-row grid-row-end grid-row-gap grid-row-start grid-template grid-template-areas
grid-template-columns grid-template-rows height hyphenate-character hyphenate-limit-chars hyphens
image-orientation image-rendering inline-size inset inset-block inset-block-end inset-block-start inset-inline
inset-inline-end inset-inline-start isolation justify-content justify-items justify-self left letter-spacing
lighting-color line-break line-height list-style list-style-image list-style-position list-style-type margin
margin-block margin-block-end margin-block-start margin-bottom margin-inline margin-inline-end
margin-inline-start margin-left margin-right margin-top marker marker-end marker-mid marker-start mask
mask-clip mask-composite mask-image mask-mode mask-origin mask-position mask-repeat mask-size mask-type
math-depth math-shift math-style max-block-size max-height max-inline-size max-width min-block-size min-height
min-inline-size min-width mix-blend-mode object-fit object-position offset offset-anchor offset-distance
offset-path offset-position offset-rotate opacity order orphans outline outline-color outline-offset
outline-style outline-width overflow overflow-anchor overflow-block overflow-clip-margin overflow-inline
overflow-wrap overflow-x overflow-y overscroll-behavior overscroll-behavior-block overscroll-behavior-inline
overscroll-behavior-x overscroll-behavior-y padding padding-block padding-block-end padding-block-start
padding-bottom padding-inline padding-inline-end padding-inline-start padding-left padding-right padding-top
page page-break-after page-break-before page-break-inside paint-order perspective perspective-origin
place-content place-items place-self pointer-events position position-anchor position-area position-try
position-try-fallbacks position-try-order position-visibility print-color-adjust quotes r resize right rotate
row-gap ruby-align ruby-position rx ry scale scroll-behavior scroll-margin scroll-margin-block
scroll-margin-block-end scroll-margin-block-start scroll-margin-bottom scroll-margin-inline
scroll-margin-inline-end scroll-margin-inline-start scroll-margin-left scroll-margin-right scroll-margin-top
scroll-padding scroll-padding-block scroll-padding-block-end scroll-padding-block-start scroll-padding-bottom
scroll-padding-inline scroll-padding-inline-end scroll-padding-inline-start scroll-padding-left
scroll-padding-right scroll-padding-top scroll-snap-align scroll-snap-stop scroll-snap-type scroll-timeline
scroll-timeline-axis scroll-timeline-name scrollbar-color scrollbar-gutter scrollbar-width
shape-image-threshold shape-margin shape-outside shape-rendering stop-color stop-opacity stroke
stroke-dasharray stroke-dashoffset stroke-linecap stroke-linejoin stroke-miterlimit stroke-opacity stroke-width
tab-size table-layout text-align text-align-last text-anchor text-autospace text-box text-box-edge
text-box-trim text-combine-upright text-decoration text-decoration-color text-decoration-line
text-decoration-skip-ink text-decoration-style text-decoration-thickness text-emphasis text-emphasis-color
text-emphasis-position text-emphasis-style text-indent text-justify text-orientation text-overflow
text-rendering text-shadow text-transform text-underline-offset text-underline-position text-wrap
text-wrap-mode text-wrap-style timeline-scope top touch-action transform transform-box transform-origin
transform-style transition transition-behavior transition-delay transition-duration transition-property
transition-timing-function translate unicode-bidi user-select vector-effect vertical-align view-timeline
view-timeline-axis view-timeline-inset view-timeline-name view-transition-class view-transition-name visibility
white-space white-space-collapse widows width will-change word-break word-spacing word-wrap writing-mode x y
z-index zoom
`.trim().split(/\s+/))
const UNKNOWN = '\0'
const PROPERTY_REFERENCES = new Set(['transition', 'transition-property', 'will-change'])
const CSS_FUNCTIONS = new Set('var calc min max clamp rgb rgba hsl hsla hwb lab lch oklab oklch color color-mix light-dark linear-gradient repeating-linear-gradient radial-gradient repeating-radial-gradient conic-gradient repeating-conic-gradient'.split(' '))

interface Token { value: string, start: number, end: number }
interface Match { start: number, end: number, name: string, reason?: string }

const LIMITATIONS = [
  'Variable bindings, function results, and opaque names are not evaluated. Inspect runtime producers after rename.',
  'Only files included by the glob and supported source regions are scanned. Include external blocks and generated consumers separately.',
  'Style attributes, tagged templates, and CSS queries require manual review when warned. Unsupported languages require a separate search.',
  'Style compilation and type verification are skipped. Run project checks after apply.',
  'Script CSS payloads require recognised declaration or function headers. Inspect unknown headers separately.',
  'Value-only script strings beginning with custom property names require manual review. Their CSS property is unknown.',
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
  let property = ''
  let depth = 0
  for (const [index, token] of tokens.entries()) {
    const previous = tokens[index - 1]
    const before = tokens[index - 2]
    if (['{', ';', '}'].includes(token.value) || (syntax.indented && previous && /[\r\n]/.test(source.slice(previous.end, token.start))))
      property = ''
    if (token.value === ':' && previous && (!before || ['{', ';', '}'].includes(before.value) || (syntax.indented && /[\r\n]/.test(source.slice(before.end, previous.start)))))
      property = previous.value.toLowerCase().replace(/^-(?:webkit|moz|ms|o)-/, '')
    if (token.value === '(')
      depth++
    else if (token.value === ')')
      depth = Math.max(0, depth - 1)
    if (!token.value.startsWith('--') && !(token.value.includes(UNKNOWN) && token.value.includes('--')))
      continue
    const declaration = tokens[index + 1]?.value === ':' && (!previous || ['{', ';', '}'].includes(previous.value) || (syntax.indented && /[\r\n]/.test(source.slice(previous.end, token.start))))
    const reference = previous?.value === '(' && before?.value.toLowerCase() === 'var' && [',', ')'].includes(tokens[index + 1]?.value)
    const registration = previous?.value === 'property' && before?.value === '@'
    const propertyReference = depth === 0 && PROPERTY_REFERENCES.has(property)
    if (declaration || reference || registration || propertyReference)
      matches.push({ start: token.start, end: token.end, name: token.value })
    else if (!property && previous?.value === '(' && [':', ')'].includes(tokens[index + 1]?.value))
      matches.push({ start: token.start, end: token.end, name: token.value, reason: 'CSS query requires manual review' })
    else if (property)
      matches.push({ start: token.start, end: token.end, name: token.value, reason: 'Ambiguous CSS value requires manual review' })
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
  const cssHeader = delimiter !== -1 && (trimmed[delimiter] === ':' ? NAME.test(header) || CSS_PROPERTIES.has(header.toLowerCase()) : CSS_FUNCTIONS.has(header.toLowerCase()))
  if (/<\/?[a-z]/i.test(value))
    return []
  if (!cssHeader && !/^[^{};]+\{/.test(trimmed)) {
    // A bare value has no property context. Reuse CSS token boundaries, but never edit it.
    if (!/^\0*--/.test(trimmed))
      return []
    const prefix = '--ripide-review:'
    return cssMatches(prefix + value, 'css').filter(match => match.start >= prefix.length).map(match => ({ ...match, start: match.start - prefix.length, end: match.end - prefix.length, reason: 'Value-only CSS string requires manual review' }))
  }
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
  function containsCandidate(node: any): boolean {
    if (!node || typeof node !== 'object')
      return false
    if (node.type === 'ImportExpression' || (node.type === 'CallExpression' && node.callee?.name === 'require'))
      return false
    if (stringMatches(patternString(node)).some(match => [...map.keys()].some(name => plausible(match.name, name))))
      return true
    return Object.entries(node).some(([key, child]) => !['loc', 'range', 'comments', 'parent', 'metadata'].includes(key) && (Array.isArray(child) ? child.some(containsCandidate) : containsCandidate(child)))
  }
  function opaqueCandidate(node: any): boolean {
    node = unwrapExpression(node)
    if (staticString(node) !== undefined)
      return false
    if (node?.type === 'TemplateLiteral')
      return node.expressions.some(opaqueCandidate)
    if (node?.type === 'BinaryExpression' && node.operator === '+')
      return opaqueCandidate(node.left) || opaqueCandidate(node.right)
    return containsCandidate(node)
  }
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
      const nested = pattern.includes(UNKNOWN) && opaqueCandidate(template)
      if (uncertain || hidden || nested)
        warn(node.start, raw, tagged ? 'Tagged template requires manual review' : nested ? 'Unknown expression contains a CSS custom property candidate' : hidden ? 'Unknown CSS context requires manual review' : matches.find(match => match.reason && [...map.keys()].some(name => plausible(match.name, name)))?.reason)
      if (tagged)
        return
      const value = staticString(node)
      if (value !== undefined) {
        if (node.type === 'TemplateLiteral' && !node.expressions.length) {
          rewrite(value, node.start + 1, node.end - 1, '`', matches.filter(match => !match.reason))
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
      if (node.name?.name === 'style' && cssMatches(decodeJsxAttribute(node.value.value), 'css').some(match => map.has(match.name)))
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
        edits.push(...scriptEdits(region.source, parsed.program, map, (position, source, reason) => warn(region.start + position, source, reason)).map(edit => ({ ...edit, start: region.start + edit.start, end: region.start + edit.end })))
      }
    }
    const after = applyTextEdits(file.source, edits)
    if (after !== file.source)
      changes.push({ path: file.abs, rel: file.rel, before: file.source, after })
  }
  return { changes, warnings: [...new Set(warnings)], limitations: [...LIMITATIONS], scanned: files.length, regressions: [], verification: { _tag: 'Skipped', reason: changes.length ? 'not-applicable' : 'no-changes' } }
}
