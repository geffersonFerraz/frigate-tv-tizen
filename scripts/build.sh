#!/usr/bin/env bash
# Package app/ into build/FrigateTV.wgt (unsigned).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
python3 -c 'import sys, xml.etree.ElementTree as ET; ET.parse(sys.argv[1])' "$ROOT/app/config.xml"
for f in "$ROOT"/app/js/*.js; do node --check "$f"; done
rm -rf "$ROOT/build" && mkdir -p "$ROOT/build"
(cd "$ROOT/app" && zip -qr -X "$ROOT/build/FrigateTV.wgt" .)
echo "Built $ROOT/build/FrigateTV.wgt"
