import { test } from "node:test";
import assert from "node:assert/strict";
import { itemAllGetData, loadItems, findItems } from "../dist/liste.js";

const sample = {"itemlist":{"241":{"updatetime":"2026-11-22 05:29:46","reset":1,"add":[{"time":1370785094,"id":"9479","number":"20115715","print":0,"status":0,"edit":1,"selected":0,"chiffre":"201","desc":"L schwarz Kinder Skibrille Briko","discount":0,"price":5.5,"sold_discount":0,"sold_price":5.5},{"time":1370785094,"id":"9480","number":"20116910","print":0,"status":0,"edit":1,"selected":0,"chiffre":"201","desc":"128 Blau ADIDAS Digitale Kinder Uhr - ADK1889","discount":0,"price":6.5,"sold_discount":0,"sold_price":6.5},{"time":1795321786,"id":"27002241","number":"4110000167149","print":0,"status":0,"edit":1,"selected":0,"chiffre":"201","desc":"42 gelb Skisocken HEAD","discount":0,"price":3,"sold_discount":0,"sold_price":3}]}}};

test("item_all_get: modul + base64-JSON wie in der App", () => {
  const d = itemAllGetData(["erfasst", "verkauft"]);
  assert.equal(d.privileg, "seller");
  assert.equal(d.modul, "270,272");
  const [p1, p2] = d.modullist_param.split(",").map((x) => Buffer.from(x, "base64").toString("utf8"));
  assert.equal(p1, '{"id":"270","type":"register_items","discount":false,"utf8":"€","showBasarSelect":"0"}');
  assert.deepEqual(JSON.parse(p2).id, "272");
});

test("Antwort auswerten, Artikel per Nummer finden", async () => {
  const items = await loadItems({ request: async () => sample }, ["erfasst"]);
  assert.equal(items.length, 3);
  assert.deepEqual(items[2], { liste: "Erfasst", id: "27002241", artikelnummer: "4110000167149", beschreibung: "42 gelb Skisocken HEAD", preis: 3, rabatt: undefined, verkaufspreis: undefined, gedruckt: false, bearbeitbar: true, verkaeufernummer: "201" });
  const { found, missing } = findItems(items, ["4110000167149", "999"]);
  assert.equal(found[0].id, "27002241");
  assert.deepEqual(missing, ["999"]);
});

test("mehrere Listen: je Liste ein Aufruf, Zuordnung unabhängig vom Antwort-Schlüssel", async () => {
  const calls = [];
  const api = { request: async (ep, m, d) => { calls.push(d.modul); return d.modul === "272"
    ? { itemlist: { "999": { add: [{ id: "5", number: "55", desc: "verkauft", price: 2, sold_price: 2, edit: 0 }] } } }
    : sample; } };
  const items = await loadItems(api, ["erfasst", "verkauft"]);
  assert.deepEqual(calls, ["270", "272"]);
  assert.equal(items.filter((i) => i.liste === "Erfasst").length, 3);
  assert.equal(items.find((i) => i.artikelnummer === "55").liste, "Verkauft");
});
