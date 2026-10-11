# CSS custom properties

Use `css-custom-property-rename` for exact names. Put names after the `--` separator.

```bash
ripide css-custom-property-rename --json --artifact /tmp/css-plan.json -- --foo-a --theme-b
ripide css-custom-property-rename --apply --profile agent -- --foo-a --theme-b
```

Supported cases:

- Declarations, `@property` registrations, and `var()` references in CSS, SCSS, Sass, Less, PostCSS, and PCSS.
- Vue style blocks, including scoped styles and the same style languages.
- Exact JS/TS string names, CSS function values, and CSS declaration strings.
- Object keys, DOM property API arguments, and JSX style expressions in React, Next, and Solid.
- Both Vue script blocks. External blocks are scanned through their source files when the glob includes them.
- Octane TSRX through the existing project-local compiler and `RIPIDE_RUN_EXTERNAL_CODE=1` opt-in.
- Static templates, literal interpolation, and proven string concatenation.
- Complete static names beside unknown values, such as `` `var(--foo-a, ${fallback})` ``.

Comments, CSS quoted content, module paths, prose, markup samples, and longer names stay unchanged.
Names accept `--` followed by identifier characters: letters, digits, underscores, hyphens, and Unicode characters.
CSS identifier escapes and JS string escapes are decoded before matching.
Source bytes outside edited ranges stay unchanged. Assembled static names can be folded into one string.

Dynamic names are never rewritten without proof of their complete value.
Renaming `--foo-a` flags `` `--foo-${bar}` `` and `` `--foo-a${suffix}` ``.
Warnings contain the relative file, one-based line and column, and original expression.
SCSS and Less name interpolation also produces warnings.
Bounded output includes a warning page. The artifact retains all warnings and the complete plan.
Use saved-evidence paging to read omitted warnings without repeating a mutation.

Limitations:

- Variable bindings, function results, and arbitrary expressions are not evaluated.
- Tagged templates remain unchanged and produce warnings for plausible matches.
- Names with no visible custom property prefix do not produce speculative warnings.
- Vue template attributes and JSX quoted attributes are not JS string sites for this command.
- Svelte markup, Stylus, CSS condition-query property names, and arbitrary identifier punctuation are unsupported.
- This command does not validate style compilation or run type verification.

Run a dry run and review warnings first. Apply uses the existing atomic write boundary.
Run the project's checks after apply. Never treat `not-applicable` verification as a passing typecheck.

The public API is `runCssCustomPropertyRename(map, { cwd, glob, engine })` from `ripide-api`.
Its map supports several simultaneous renames. Each original name changes once.
Use `createVueExtension()` in the engine for Vue source regions.
Custom extensions expose authored CSS or script regions through `cssCustomProperties`.
Missing region support refuses the operation instead of omitting those consumers.
