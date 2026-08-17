# Brand assets

`assets/` stores the original Unframe brand artwork. Applications own the copies
that they bundle and must not import files across application boundaries.

- `icon.svg`: primary on-screen brand mark.
- `icon.png`: raster fallback for contexts that cannot consume the SVG source.
- `light-header.png`, `dark-header.png`, `light-font-header.png`: composed brand images for metadata and media use.
- `favicon/`: source favicon set and web app manifest.

Copy required artwork into the owning application's asset directory and import
that local copy. Keep copied artwork byte-identical to its matching original.
