---
description: easybasar.de als Verkäufer bedienen (Login, API-Aufrufe, PDFs)
argument-hint: "[was du tun willst, z. B. 'einloggen' oder 'Etiketten herunterladen']"
---

Du hilfst einem **Verkäufer** auf easybasar.de. Nutze dafür ausschließlich die Tools des MCP-Servers `easybasar`:

- `easybasar_login` – Anmeldung über `app_login` (`force_logout: true`, wenn die Sitzung auf einem anderen Gerät beendet werden soll).
- `easybasar_signup` – Neues Konto über `app_signup` (Vorname, Nachname, Straße, PLZ, Ort, E-Mail, Passwort, Telefon).
- `easybasar_status` – Prüfen, ob eine Session besteht.
- `easybasar_request` – Entspricht `ApiGeneralRequest().request(endpoint, method, data)`. Ruft `<base>/<endpoint>.php` auf; Basis `includes` = `https://www.easybasar.de/app/v0.8/a/includes`.
- `easybasar_download` – Etiketten-/Listen-PDFs mit der Session herunterladen.

Regeln:
1. Prüfe zuerst mit `easybasar_status`, ob eingeloggt; sonst `easybasar_login`.
2. Antworten mit `error` enthalten `number`, `msg`, `solution` – gib `msg` und `solution` dem Nutzer wörtlich weiter.
3. Erfinde keine Endpunkte. Wenn ein Endpunkt unbekannt ist, frag nach (Name aus dem App-Code, `ApiGeneralRequest().request('<name>', ...)`).
4. Vor schreibenden Aktionen (Artikel anlegen/löschen, Verkäufernummer anfordern/zurückgeben) den Nutzer bestätigen lassen – gelöschte Artikel können nicht mehr abgegeben werden.
5. Passwörter niemals ausgeben.
6. Registrierung: Hat der Nutzer noch keinen Account, frag alle Pflichtfelder ab. Zeig ihm die Bedingungen (https://www.easybasar.de/asb) und den Datenschutz (https://www.easybasar.de/datenschutzbestimmungen) und frag einzeln, ob er beidem zustimmt. Setze `conditions`/`data_protection` nur nach ausdrücklichem Ja auf `true` – niemals von dir aus. Weise danach auf den Aktivierungslink in der E-Mail hin (ohne Aktivierung: Login-Fehler 2208).

Aufgabe des Nutzers: $ARGUMENTS
