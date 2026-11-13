#!/usr/bin/env bash
# Regenerate committed PNGs from the editable SVG; requires Inkscape only for editing.
set -euo pipefail
project_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"

# Toolbar, extension-manager (including high-density Firefox), and Chrome store sizes.
for size in 16 32 48 64 128; do
    inkscape "$project_dir/icons/icon.svg" --export-type=png \
        --export-width="$size" --export-height="$size" \
        --export-filename="$project_dir/icons/icon-$size.png" >/dev/null
done
