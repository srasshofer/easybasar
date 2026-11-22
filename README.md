# easybasar MCP (Verkäufer)

MCP-Server, der die App-API von easybasar.de anspricht – als Nachbau von `ApiGeneralRequest().request(...)` aus der easybasar-App. In Claude Code über **`/easybasar`** aufrufbar.

## Setup

```bash
npm install
npm run build
export EASYBASAR_USER='dein-benutzername'
export EASYBASAR_PASSWORD='dein-passwort'
claude   # im Repo starten; .mcp.json registriert den Server "easybasar"
```

Dann in Claude Code: `/easybasar einloggen und meine Basare anzeigen`.

## URLs

| Basis       | URL |
|-------------|-----|
| `includes`  | `https://www.easybasar.de/app/v0.8/a/includes` (Login: `app_login.php`) |
| `php`       | `…/includes/api/php` |
| `pdf`       | `…/includes/Pdf` |
| `userfiles` | `https://www.easybasar.de/userfiles` |
| `pdfs`      | `https://www.easybasar.de/pdfs` |

Endpunkte werden als `<basis>/<endpoint>.php` aufgerufen, Parameter als `application/x-www-form-urlencoded`. Session-Cookies werden über alle Aufrufe gehalten.

## Tools

- `easybasar_login` – `app_login` mit `user`, `password`, `o=a`, `v=v0.8`, `c=1.0.0`, `l=de`, optional `force_logout=true`
- `easybasar_status` – Session-Status und letzte Login-Antwort
- `easybasar_request` – beliebiger Endpunkt (`endpoint`, `method`, `data`, `base`); loggt bei Bedarf automatisch (neu) ein
- `easybasar_download` – Datei/PDF speichern (Standard-Basis `pdf`, Ziel `EASYBASAR_DOWNLOAD_DIR`, Standard `./downloads`)

Fehler der API (`{"error": {"number", "msg", "solution", ...}}`) werden als Tool-Fehler durchgereicht.
