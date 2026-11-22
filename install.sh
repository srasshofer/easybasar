#!/usr/bin/env bash
# Installiert den easybasar-MCP-Server für Claude Code (benutzerweit) und den Befehl /easybasar.
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR"
VERSION="$(node -p 'require("./package.json").version' 2>/dev/null || echo '?')"
echo "easybasar MCP $VERSION – Installation aus $DIR"

# Node.js >= 20
if ! command -v node >/dev/null 2>&1; then
  echo "FEHLER: Node.js fehlt. Installieren mit:  brew install node" >&2; exit 1
fi
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$NODE_MAJOR" -lt 20 ]; then
  echo "FEHLER: Node.js $(node -v) ist zu alt (mindestens 20). Aktualisieren mit:  brew upgrade node" >&2; exit 1
fi
if ! command -v claude >/dev/null 2>&1; then
  echo "FEHLER: Claude Code (claude) nicht gefunden." >&2; exit 1
fi

echo "→ Abhängigkeiten installieren …"
npm ci --omit=dev --no-audit --no-fund --loglevel=error --update-notifier=false

echo "→ MCP-Server 'easybasar' benutzerweit registrieren …"
claude mcp remove easybasar -s user >/dev/null 2>&1 || true
claude mcp add easybasar -s user \
  -e EASYBASAR_DOWNLOAD_DIR="$HOME/Downloads/easybasar" \
  -- node "$DIR/dist/index.js"

echo "→ Befehl /easybasar installieren …"
mkdir -p "$HOME/.claude/commands"
cp "$DIR/.claude/commands/easybasar.md" "$HOME/.claude/commands/easybasar.md"

echo "→ Selbsttest …"
if node "$DIR/scripts/selftest.mjs" "$DIR/dist/index.js"; then
  echo
  echo "Fertig. Claude Code neu starten (laufende Sitzungen beenden) und eingeben:  /easybasar"
  echo "PDFs landen in: $HOME/Downloads/easybasar"
else
  echo "WARNUNG: Selbsttest fehlgeschlagen – der Server startet nicht korrekt." >&2; exit 1
fi
