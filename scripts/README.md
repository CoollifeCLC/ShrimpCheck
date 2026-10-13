# Icon Build Tooling

`npm run build:icons` regenerates `media/shrimp-check-icons.woff` from
`src/assets/pixel-shrimp-wiggle.svg`.

The source file is a large SVG wrapper around an embedded PNG frame, so the build
script extracts the PNG, converts the white shrimp pixels into a small monochrome
SVG glyph, and then creates a WOFF icon font for VS Code contributed icons.

Only the generated font is shipped in the VSIX. The source assets and this
tooling are excluded by `.vscodeignore`.
