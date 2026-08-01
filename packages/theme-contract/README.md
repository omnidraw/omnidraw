# `@omnidraw/theme-contract`

Small, state-free theme and semantic canvas-color contracts shared by the
theme runtime and durable canvas validation. It has no browser, renderer,
canvas engine, database, or service dependency.

The canvas product vocabulary is intentionally fixed to `transparent`,
`neutral`, `red`, `yellow`, `green`, and `blue`. Themes resolve those stable
codes to role-specific concrete sRGB colors.
