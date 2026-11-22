import { test } from "node:test";
import assert from "node:assert/strict";
import { checkItem, describeForm, isSessionError, itemToolData } from "../dist/artikel.js";
import { EasybasarError } from "../dist/client.js";

// Beispielantwort von basar_visible.php (info)
const info = {"form":{"basar_id":"000000AAAAA","price":{"currency":"EUR","value":"","item_price_min":0.5,"item_price_max":200,"item_price_div":0.5},"item_description_length":65,"item_register_description_extended":100,"item_description_fields":[{"name":"Größe","type":"inputbox","required":0,"size":6,"maxlength":6,"comment":"Nur bei Kleidung","value":"","options":[]},{"name":"Farbe","type":"inputbox","required":0,"size":7,"maxlength":7,"comment":"Nur bei Kleidung","value":"","options":[]},{"name":"Beschreibung","type":"inputbox","required":1,"size":25,"maxlength":100,"comment":"","value":"","options":[]}],"item_register_ean":false,"discount":{"discount_enabled":false,"discount_begin":"","discount_steps":[0]}},"item":{"item_actual_count":3,"item_max_count":10}};
const full = { "Größe": "104", "Farbe": "blau", "Beschreibung": "Regenjacke" };

test("gültiger Artikel", () => {
  const r = checkItem(info, { felder: full, preis: "2,50" });
  assert.equal(r.ok, true, r.fehler.join());
  assert.deepEqual(r.normalisiert, { felder: full, preis: "2.50", rabatt: undefined });
});

test("Preis: Range und Teilbarkeit durch item_price_div", () => {
  assert.match(checkItem(info, { felder: full, preis: 0.4 }).fehler.join(), /zwischen 0,50 € und 200,00 €/);
  assert.match(checkItem(info, { felder: full, preis: 200.5 }).fehler.join(), /zwischen/);
  const r = checkItem(info, { felder: full, preis: 2.3 });
  assert.match(r.fehler.join(), /Schritten von 0,50 €.*2,00 € oder 2,50 €/);
  assert.equal(checkItem(info, { felder: full, preis: 200 }).ok, true);
  assert.equal(checkItem(info, { felder: full, preis: 0.5 }).ok, true);
});

test("Pflichtfeld, Maximallänge, unbekanntes Feld", () => {
  assert.match(checkItem(info, { felder: { "Größe": "104" }, preis: 1 }).fehler.join(), /„Beschreibung“ ist ein Pflichtfeld/);
  assert.match(checkItem(info, { felder: { ...full, "Größe": "1234567" }, preis: 1 }).fehler.join(), /höchstens 6 Zeichen/);
  assert.match(checkItem(info, { felder: { ...full, Marke: "x" }, preis: 1 }).fehler.join(), /Unbekanntes Feld „Marke“/);
  assert.match(checkItem(info, { felder: { Beschreibung: "Buch" }, preis: 1 }).warnungen.join(), /„Größe“ ist leer \(Nur bei Kleidung\)/);
});

test("Rabatt nur wenn aktiviert, Nutzer wählt: kein Rabatt oder Stufe", async () => {
  assert.match(checkItem(info, { felder: full, preis: 1, rabatt: 10 }).fehler.join(), /keinen Rabatt/);
  assert.equal(checkItem(info, { felder: full, preis: 1, rabatt: 0 }).ok, true);
  const mitRabatt = structuredClone(info);
  mitRabatt.form.discount = { discount_enabled: true, discount_begin: "Sonntag, 22. November 2026 um 12:00", discount_steps: [0.1, 0.2, 0.3] };
  assert.match(checkItem(mitRabatt, { felder: full, preis: 1 }).fehler.join(), /wählen lassen: kein Rabatt, 10 %, 20 %, 30 %/);
  assert.match(checkItem(mitRabatt, { felder: full, preis: 1, rabatt: 0.25 }).fehler.join(), /25 % ist nicht erlaubt/);
  assert.equal(checkItem(mitRabatt, { felder: full, preis: 1, rabatt: 0.1 }).normalisiert.rabatt, 0.1);
  assert.equal(checkItem(mitRabatt, { felder: full, preis: 1, rabatt: 20 }).normalisiert.rabatt, 0.2, "Prozent-Eingabe");
  assert.equal(checkItem(mitRabatt, { felder: full, preis: 1, rabatt: 0 }).normalisiert.rabatt, 0, "kein Rabatt erlaubt");
  assert.equal(checkItem(mitRabatt, { felder: full, preis: 1 }, false, true).ok, true, "Bearbeiten ohne Rabattangabe");
  assert.deepEqual(describeForm(mitRabatt).rabatt.stufen.map((x) => x.anzeige), ["10 %", "20 %", "30 %"]);
});

test("POST-Daten wie die App (Beispiel Turnhose mit 10 % Rabatt)", () => {
  const mitRabatt = structuredClone(info);
  mitRabatt.form.discount = { discount_enabled: true, discount_begin: "", discount_steps: [0.1, 0.2, 0.3] };
  const r = checkItem(mitRabatt, { felder: { Beschreibung: "Turnhose BW" }, preis: 2, rabatt: 0.1 });
  assert.deepEqual(itemToolData(r.normalisiert), { price: "2,00", right: "seller", big_item: "false", item_count: "1", Beschreibung: "Turnhose BW", discount: "0.1" });
  const ohne = checkItem(mitRabatt, { felder: { Beschreibung: "Turnhose BW" }, preis: 2, rabatt: 0 });
  assert.equal(itemToolData(ohne.normalisiert).discount, undefined, "kein Rabatt → kein discount-Parameter");
});

test("Artikel-Limit", () => {
  const voll = structuredClone(info);
  voll.item = { item_actual_count: 10, item_max_count: 10 };
  assert.match(checkItem(voll, { felder: full, preis: 1 }).fehler.join(), /Limit .* erreicht.*gelöscht.*Basarleitung/);
  assert.equal(checkItem(voll, { felder: full, preis: 1 }, false).ok, true, "Bearbeiten trotz vollem Limit");
  assert.equal(describeForm(voll).artikel.frei, 0);
  assert.equal(describeForm(info).artikel.frei, 7);
});

test("Session-Fehler 110 wird erkannt", () => {
  assert.equal(isSessionError(new EasybasarError({ response: "visible", number: 110, msg: "x" })), true);
  assert.equal(isSessionError(new EasybasarError({ response: "itemremove", number: 707, msg: "x" })), false);
});
