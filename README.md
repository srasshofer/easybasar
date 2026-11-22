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
4. Eingabedialog des MCP-Clients (Elicitation) mit Option „speichern“ – das Passwort läuft dabei nicht durch das Sprachmodell. Lässt sich dort kein `@` eingeben, `(at)` schreiben.

Empfohlen: einmalig im Terminal `bash login.sh` im Installationsordner – fragt E-Mail und Passwort (verdeckt), prüft sie bei easybasar und speichert sie. `install.sh` bietet das am Ende an.

Gespeichert wird nur nach erfolgreichem Login und nur auf Wunsch (`remember: true`, Häkchen im Dialog oder `login.sh`) – und zwar **nur E-Mail und JWT, nie das Passwort** (Datei mit Rechten 0600). Läuft die Session ab (Fehler 110), holt der Server mit dem JWT eine neue (`app_login` mit `Authorization: Bearer <jwt>`, ohne Passwort). Ist auch der JWT abgelaufen, wird die gespeicherte Anmeldung gelöscht und ein neuer Login verlangt. Alte Dateien mit Passwort werden beim nächsten Login auf JWT umgestellt. Löschen: `easybasar_logout` mit `forget: true`.

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
- `easybasar_basar_waehlen` – Basar per `data.ID` auswählen und dem Server mitteilen (`select_basar_seller_chiffre` mit `basar_id`, `privileg=seller`, `mod_seller=true`). Voraussetzung für alle Artikel-Aktionen. Der Server merkt sich die Auswahl in der Session; deshalb wird sie vor jedem Formular-Abruf und direkt vor `item_tool` erneut gesetzt (auch nach einem automatischen Re-Login).
- `easybasar_artikel_formular` – Erfassungsformular des gewählten Basars (`basar_visible.php`, `update=reset_form`, `privileg=seller`): Felder aus `item_description_fields`, Preis-Range, Rabatt, `item_actual_count`/`item_max_count`
- `easybasar_artikel_pruefen` – prüft Felder (Pflicht, `maxlength`), Preis (`item_price_min` ≤ Preis ≤ `item_price_max`, Vielfaches von `item_price_div`, in Cent gerechnet), Rabatt (nur wenn `discount_enabled`, nur Werte aus `discount_steps`, vom Nutzer gewählt) und das Artikel-Limit
- `easybasar_artikel_erfassen` – lädt Formular, prüft und sendet an `item_tool.php`: `price` (z. B. `2.50`), `right=seller`, `big_item=false`, `item_count=1` und je Feld aus `item_description_fields` ein Parameter mit dessen Namen (z. B. `Größe`, `Farbe`, `Beschreibung`). Gibt Meldung und Artikelnummer (`info.additional`) zurück.
- `easybasar_artikel_bearbeiten` – `item_tool.php` mit `price`, `right=seller`, `big_item=false`, `action=edit`, `NumberEdit=<Artikelnummer>`, den nicht-leeren Beschreibungsfeldern und ggf. `discount`
- `easybasar_artikel_loeschen` – `api/php/api_sel_actions.php` (Basis `php`, wie `requestExtended` der App) mit `action=itemDeleteFinal` und `iid[]` (mehrfach möglich)
- `easybasar_request` – beliebiger Endpunkt (`endpoint`, `method`, `data`, `base`); loggt bei Bedarf automatisch (neu) ein
- `easybasar_download` – Datei/PDF speichern (Standard-Basis `pdf`, Ziel `EASYBASAR_DOWNLOAD_DIR`, Standard `./downloads`)

## Meldungen vom Server

easybasar antwortet mit `error` oder `info`, z. B.

```json
{"info":{"response":"itemremove","number":707,"msg":"Artikel wurde gelöscht 1","solution":"","additional":1,"message":{}}}
```

Die Tools geben davon **nur `msg` und `solution`** aus (bei `error` als Tool-Fehler) – ohne Nummer und ohne `response`/`additional`/`message`. Weitere Felder der Antwort (Nutzdaten) folgen als JSON.
