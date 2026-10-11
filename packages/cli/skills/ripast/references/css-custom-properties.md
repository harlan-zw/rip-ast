# CSS custom properties

Use `css-custom-property-rename` for exact names. Put names after the `--` separator.

```bash
ripide css-custom-property-rename --json --artifact /tmp/css-plan.json -- --foo-a --theme-b
ripide css-custom-property-rename --apply --profile agent -- --foo-a --theme-b
```

Supported cases:

- Declarations, `@property` registrations, and `var()` references in CSS, SCSS, Sass, Less, PostCSS, and PCSS.
- Bare property references in `transition`, `transition-property`, and `will-change` values.
- Vue style blocks, including scoped styles and the same style languages.
- Exact JS/TS string names, CSS function values, and CSS declaration strings.
- Object keys, DOM property API arguments, and JSX style expressions in React, Next, and Solid.
- Both Vue script blocks. External blocks are scanned through their source files when the glob includes them.
- Octane TSRX through the existing project-local compiler and `RIPIDE_RUN_EXTERNAL_CODE=1` opt-in.
- Static templates, literal interpolation, and proven string concatenation.
- Complete static names beside unknown values, such as `` `var(--foo-a, ${fallback})` ``.
- Complete names in static operands beside unknown concatenation values.
- Parentheses and TypeScript `as` or `satisfies` wrappers preserve proof and dynamic warnings.

Script declaration strings require known CSS property headers or custom property headers.
The known property list comes from TypeScript 6.0.3 DOM metadata.
CSS function strings require recognised function headers, including `var()`, `calc()`, colours, and gradients.
Unknown headers stay unchanged. Inspect these strings separately when the project uses new or nonstandard CSS.

Comments, CSS quoted content, module paths, prose, markup samples, and longer names stay unchanged.
Names accept `--` followed by identifier characters: letters, digits, underscores, hyphens, and Unicode characters.
CSS identifier escapes and JS string escapes are decoded before matching.
Source bytes outside edited ranges stay unchanged. Assembled static names can be folded into one string.

Dynamic names are never rewritten without proof of their complete value.
Renaming `--foo-a` flags `` `--foo-${bar}` `` and `` `--foo-a${suffix}` ``.
Warnings contain the relative file, one-based line and column, and original expression.
SCSS and Less name interpolation also produces warnings.
Unknown expression operands with nested static candidates receive warnings, such as `` `var(${name('--foo-a')})` ``.
These warnings identify candidates. They do not prove the function returns that name.
Bounded output includes a warning page. The artifact retains all warnings and the complete plan.
Use saved-evidence paging to read omitted warnings without repeating a mutation.

```bash
ripide page --input /tmp/css-plan.json --path /warnings --limit 20
ripide page --input /tmp/css-plan.json --path /limitations
```

Every result includes `limitations`. No warnings does not prove that all runtime consumers were found.
Vue style attributes, JSX quoted style attributes, and CSS query names receive source warnings for manual review.
Attribute matching decodes entities. Warnings keep the original encoded source.
Ambiguous bare CSS values receive warnings because they can name unrelated identifiers.
For example, `animation-name: --foo-a` remains unchanged and requires review.

Limitations:

- Variable bindings, function results, and arbitrary expressions are not evaluated.
- Tagged templates remain unchanged and produce warnings for plausible matches.
- Names with no visible custom property prefix do not produce speculative warnings.
- Vue template attributes and JSX quoted attributes are not JS string sites for this command.
- Svelte markup, Stylus, CSS condition-query property names, and arbitrary identifier punctuation are unsupported.
- This command does not validate style compilation or run type verification.

Run a dry run and review warnings first. Apply uses the existing atomic write boundary.
Run the project's checks after apply. Never treat `not-applicable` verification as a passing typecheck.

Agent review procedure:

1. Save a dry-run artifact. Read every warning, including omitted warning pages.
2. Use each warning's file, location, and source to inspect the runtime value.
3. Inspect nested function arguments and ambiguous CSS identifiers before choosing which consumer to change.
4. If the value is provable, edit that consumer with the project's existing APIs and preserve its encoding.
5. If the value remains dynamic, update its producer or naming map and test the affected runtime path.
6. Inspect excluded files, external blocks, unsupported languages, unknown CSS headers, and opaque runtime producers separately.
7. Apply the reviewed plan. Run project checks and repeat the dry run to find remaining authored references.

Warnings do not block apply. Keep unresolved warnings as explicit follow-up evidence.

The public API is `runCssCustomPropertyRename(map, { cwd, glob, engine })` from `ripide-api`.
Its map supports several simultaneous renames. Each original name changes once.
Use `createVueExtension()` in the engine for Vue source regions.
Custom extensions expose authored CSS, script, or review-only regions through `cssCustomProperties`.
Missing region support refuses the operation instead of omitting those consumers.
