#!/usr/bin/env bash
# Baut, testet und packt release/easybasar-<version>.zip (Ordner easybasar-<version>/ im ZIP).
set -euo pipefail
cd "$(dirname "$0")/.."
npm test
VERSION="$(node -p 'require("./package.json").version')"
NAME="easybasar-$VERSION"
STAGE="$(mktemp -d)/$NAME"
mkdir -p "$STAGE/.claude/commands" "$STAGE/scripts" release
cp -R dist "$STAGE/dist"
cp package.json package-lock.json install.sh login.sh README.md ANLEITUNG.txt "$STAGE/"
cp scripts/selftest.mjs scripts/login.mjs "$STAGE/scripts/"
cp .claude/commands/easybasar.md "$STAGE/.claude/commands/"
rm -f "release/$NAME.zip"
(cd "$(dirname "$STAGE")" && zip -qr -X "$OLDPWD/release/$NAME.zip" "$NAME")
echo "release/$NAME.zip"
