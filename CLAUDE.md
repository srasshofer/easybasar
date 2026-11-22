# easybasar MCP – Hinweise für Claude

## Auslieferung (immer, wenn eine Version testbar ist)

1. `version` in `package.json` und in `src/index.ts` (`new McpServer({ version })`) erhöhen.
2. `scripts/package.sh` ausführen (baut, testet, erzeugt `release/easybasar-<version>.zip`).
3. Die ZIP-Datei per SendUserFile an den Nutzer senden.
4. Dem Nutzer genau diese drei Befehle (je eigener `bash`-Codeblock, `<version>` eingesetzt) geben:

```bash
cd /Users/s.rasshofer/Claude
```
```bash
unzip -o ~/Downloads/easybasar-<version>.zip
```
```bash
cd easybasar-<version> && bash install.sh
```

Danach: Claude Code neu starten, `/easybasar` eingeben.

`install.sh` registriert den MCP-Server benutzerweit (`claude mcp add -s user`, ersetzt ältere Versionen) und kopiert den Befehl nach `~/.claude/commands/easybasar.md`.

## API

- Basis immer Instanz `a`: `https://www.easybasar.de/app/v0.8/a/includes/<endpoint>.php`
- Nutzer sieht von Servermeldungen nur `msg` und `solution` (keine Nummern).
- Endpunkte nie erfinden – nur die vom Nutzer genannten verwenden.

## Offene Punkte (vom Nutzer vertagt)

- **JWT** (Ablauf aus `session.dart` der App bekannt, Umsetzung vertagt):
  - Login-Erfolg: Antwort hat `info`; JWT in `info.message.jwt`, Session-Instanz in `info.message.instance`.
  - JWT-Payload: `iss`, `aud`, `iat`, `exp` (Sekunden), `data.{id, user_id, first_name, last_name, email}`.
  - Session erneuern ohne Passwort: `POST app_login` mit nur `o`, `v`, `c`, `l` und Header `Authorization: Bearer <jwt>`.
    Erfolg = `info.number == 2205`; ggf. neuer JWT in `info.message.jwt` (dann ersetzen) und neue `info.message.instance`.
    Alternativ-Format: `response.data.instance`. Antwort mit `error` → JWT ungültig → neuer Login mit E-Mail/Passwort.
  - Vorher lokal `exp` prüfen; abgelaufen → gar nicht erst versuchen.
  - Auslöser: Fehler 110 (Session abgelaufen) → erneuern; scheitert das → abmelden und Login verlangen.
  - Fehler 2211 beim Login → woanders eingeloggt; Nutzer fragen, ob mit `force_logout=true` alle anderen abgemeldet werden sollen.
  - Vor jedem Login Cookies und JWT verwerfen.
  - Ziel: nur JWT speichern (nicht das Passwort).
  - Offen: ob die Session-Instanz (`instance`) bei normalen Aufrufen mitgesendet werden muss; Endpunkt/Parameter für Logout (`app_logout`?).
- **Rabatt:** Parameter für `item_tool.php` unbekannt; Erfassen mit Rabatt > 0 bricht bewusst ab.
- **Artikel bearbeiten / löschen (`itemremove`) / Meine Artikelliste:** Endpunkte fehlen.
