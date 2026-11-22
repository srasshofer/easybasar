# easybasar MCP (Verkäufer)

MCP-Server, der die App-API von easybasar.de anspricht – als Nachbau von `ApiGeneralRequest().request(...)` aus der easybasar-App. In Claude Code über **`/easybasar`** aufrufbar.

## Setup

```bash
npm install
npm run build
claude   # im Repo starten; .mcp.json registriert den Server "easybasar"
```

## Login zur Laufzeit

`easybasar_login` (Benutzer = E-Mail-Adresse) sucht Zugangsdaten in dieser Reihenfolge:

1. direkt übergebene `user`/`password`
2. gespeicherte Daten in `~/.config/easybasar-mcp/credentials.json` (bzw. `$EASYBASAR_CONFIG_DIR`)
3. Umgebungsvariablen `EASYBASAR_USER` / `EASYBASAR_PASSWORD` (optional)
4. Eingabedialog des MCP-Clients (Elicitation) mit Option „speichern“ – das Passwort läuft dabei nicht durch das Sprachmodell

Gespeichert wird nur nach erfolgreichem Login und nur auf Wunsch (`remember: true` oder Häkchen im Dialog). Die Datei ist **unverschlüsselt** (Rechte 0600). Löschen: `easybasar_logout` mit `forget: true`.

Dann in Claude Code: `/easybasar einloggen und meine Basare anzeigen`.

## URLs

| Basis       | URL |
|-------------|-----|
| `includes`  | `https://www.easybasar.de/app/v0.8/a/includes` (Login: `app_login.php`) |
| `php`       | `…/includes/api/php` |
| `pdf`       | `…/includes/Pdf` |
| `userfiles` | `https://www.easybasar.de/userfiles` |
| `pdfs`      | `https://www.easybasar.de/pdfs` |

Endpunkte werden als `<basis>/<endpoint>.php` aufgerufen, Parameter als `application/x-www-form-urlencoded`.

Nach dem Login läuft alles über das **Session-Cookie**: Es wird bei jedem Aufruf mitgeschickt (auch über Redirects), vom Server gelöschte Cookies werden entfernt, und jeder (Re-)Login startet mit leerer Cookie-Liste. Setzt der Login kein Cookie, gilt er als fehlgeschlagen. Bei Session-Fehlern (`error.response = "login"` oder Nr. 110 „keine gültige Session“) wird einmal automatisch neu eingeloggt. Da `basar_list.php` ohne Session eine leere Liste statt eines Fehlers liefert, wird bei leerer Liste ebenfalls einmal neu eingeloggt. Test: `npm test`.

## Tools

- `easybasar_login` – `app_login` mit `user` (E-Mail), `password`, `o=a`, `v=v0.8`, `c=1.0.0`, `l=de`, optional `force_logout=true`
- `easybasar_signup` – neues Konto über `app_signup`; `conditions` und `data_protection` müssen `true` sein (nur nach Zustimmung des Nutzers). Danach Aktivierungslink in der E-Mail klicken.
- `easybasar_logout` – Session beenden, optional gespeicherte Zugangsdaten löschen
- `easybasar_status` – Session-Status und letzte Login-Antwort
- `easybasar_basare` – Basare laden (`basar_list.php`, `action=app`); genau ein Basar → automatisch ausgewählt
- `easybasar_basar_waehlen` – Basar per `data.ID` auswählen (Voraussetzung für alle Artikel-Aktionen)
- `easybasar_artikel_formular` – Erfassungsformular des gewählten Basars (`basar_visible.php`, `update=reset_form`, `privileg=seller`): Felder aus `item_description_fields`, Preis-Range, Rabatt, `item_actual_count`/`item_max_count`
- `easybasar_artikel_pruefen` – prüft Felder (Pflicht, `maxlength`), Preis (`item_price_min` ≤ Preis ≤ `item_price_max`, Vielfaches von `item_price_div`, in Cent gerechnet), Rabatt (nur wenn `discount_enabled`, nur Werte aus `discount_steps`, vom Nutzer gewählt) und das Artikel-Limit
- `easybasar_request` – beliebiger Endpunkt (`endpoint`, `method`, `data`, `base`); loggt bei Bedarf automatisch (neu) ein
- `easybasar_download` – Datei/PDF speichern (Standard-Basis `pdf`, Ziel `EASYBASAR_DOWNLOAD_DIR`, Standard `./downloads`)

## Meldungen vom Server

easybasar antwortet mit `error` oder `info`, z. B.

```json
{"info":{"response":"itemremove","number":707,"msg":"Artikel wurde gelöscht 1","solution":"","additional":1,"message":{}}}
```

Die Tools geben davon **nur `msg` und `solution`** aus (bei `error` als Tool-Fehler) – ohne Nummer und ohne `response`/`additional`/`message`. Weitere Felder der Antwort (Nutzdaten) folgen als JSON.
