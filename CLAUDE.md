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
- `ApiGeneralRequest().request` → Basis `includes`; `ApiGeneralRequest().requestExtended` → Basis `php` (`…/includes/api/php/`).
- Nutzer sieht von Servermeldungen nur `msg` und `solution` (keine Nummern).
- Endpunkte nie erfinden – nur die vom Nutzer genannten verwenden.

## Offene Punkte (vom Nutzer vertagt)

- **JWT** ist umgesetzt (0.7.0): Login übernimmt `info.message.jwt`; Session-Erneuerung per `app_login` mit `o/v/c/l` + `Authorization: Bearer <jwt>` (Erfolg `info.number == 2205`, neuer JWT ersetzt den alten). Gespeichert wird nur `{user, jwt}`, nie das Passwort. Fehler 2211 → Nutzer fragen, dann `force_logout=true`. Logout-Endpunkt wird nicht gebraucht.
- **Rabatt** (bestätigt): Parameter `discount` als Anteil (`0.1` = 10 %) bei Erfassen und Bearbeiten; Stufen aus `discount_steps`; „kein Rabatt“ = Parameter weglassen. Preis wird wie in der App mit Komma gesendet (`2,00`), leere Felder werden weggelassen.
- **Artikelliste** (`item_all_get`) liefert `id` (intern, für `iid[]` beim Löschen) und `number` (Barcode). Die Schlüssel in `itemlist` sind IDs der Artikeltabelle, nicht Modul-IDs → jede Liste einzeln abfragen. Nicht lokal speichern – vor Bearbeiten/Löschen frisch laden.
- **Bearbeiten:** `NumberEdit` = Artikelnummer (`number`, Barcode) – vom Nutzer bestätigt.
