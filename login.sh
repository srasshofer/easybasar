#!/usr/bin/env bash
# easybasar-Zugangsdaten im Terminal eingeben und speichern.
set -euo pipefail
cd "$(dirname "$0")"
node scripts/login.mjs
