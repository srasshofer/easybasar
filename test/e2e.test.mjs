// Kompletter Ablauf über das MCP-Protokoll gegen einen Mock-Server (kein Zugriff auf easybasar.de).
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const form = {"form":{"basar_id":"000000AAAAA","price":{"currency":"EUR","value":"","item_price_min":0.5,"item_price_max":200,"item_price_div":0.5},"item_description_length":65,"item_register_description_extended":100,"item_description_fields":[{"name":"Größe","type":"inputbox","required":0,"size":6,"maxlength":6,"comment":"Nur bei Kleidung","value":"","options":[]},{"name":"Farbe","type":"inputbox","required":0,"size":7,"maxlength":7,"comment":"Nur bei Kleidung","value":"","options":[]},{"name":"Beschreibung","type":"inputbox","required":1,"size":25,"maxlength":100,"comment":"","value":"","options":[]}],"item_register_ean":false,"discount":{"discount_enabled":false,"discount_begin":"","discount_steps":[0]}},"item":{"item_actual_count":3,"item_max_count":10}};
const posts = [];
let selected = null; // Server-seitige Basar-Auswahl der Session
const basarList = [{ ID: "000000AAAAA", Basar: "easybasar Test Bazaar", VKNr: "201" }, { ID: "000000BBBBB", Basar: "Zweiter Basar", VKNr: "17" }];
const srv = http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    const pathname = new URL(req.url, "http://x").pathname;
    const ep = path.basename(pathname, ".php");
    const sp = new URLSearchParams(body);
    const data = Object.fromEntries(sp);
    if (sp.getAll("iid[]").length > 1) data["iid[]"] = sp.getAll("iid[]");
    data.__path = pathname.includes("/includes/api/php/") ? "php" : "includes";
    posts.push({ ep, data });
    const json = (o, h = {}) => { res.writeHead(200, { "Content-Type": "application/json", ...h }); res.end(JSON.stringify(o)); };
    const authed = (req.headers.cookie ?? "").includes("PHPSESSID=s1");
    if (ep === "app_login") return json({ info: { msg: "Willkommen", solution: "" } }, { "Set-Cookie": "PHPSESSID=s1; Path=/" });
    if (!authed) return json({ error: { response: "visible", number: 110, msg: "Keine gültige Session.", solution: "" } });
    if (ep === "basar_list") return json({ data: basarList });
    if (ep === "select_basar_seller_chiffre") {
      if (!basarList.some((b) => b.ID === data.basar_id)) return json({ error: { msg: "Unbekannter Basar", solution: "" } });
      selected = data.basar_id;
      return json({ info: { response: "select", number: 1, msg: "", solution: "" } });
    }
    if (!selected) return json({ error: { response: "visible", number: 500, msg: "Kein Basar gewählt.", solution: "" } });
    if (ep === "basar_visible") return json({ info: { ...form, form: { ...form.form, basar_id: selected } } });
    if (ep === "item_all_get") return json({"itemlist":{"270":{"reset":1,"add":[{"id":"9479","number":"20115715","print":0,"status":0,"edit":1,"chiffre":"201","desc":"L schwarz Kinder Skibrille Briko","discount":0,"price":5.5,"sold_price":5.5},{"id":"27002241","number":"4110000167149","print":0,"status":0,"edit":1,"chiffre":"201","desc":"42 gelb Skisocken HEAD","discount":0,"price":3,"sold_price":3},{"id":"1","number":"777","edit":0,"desc":"gesperrt","price":1}]}}});
    if (ep === "api_sel_actions") {
      if (data.__path !== "php") return res.writeHead(404).end();
      const n = [].concat(data["iid[]"]).length;
      return json({ info: { response: "itemremove", number: 707, msg: `Artikel wurde gelöscht ${n}`, solution: "", additional: n, message: {} } });
    }
    if (ep === "item_tool" && data.action === "edit") return json({ info: { response: "item_tool", number: 265, msg: `Artikel wurde geändert ${data.NumberEdit}`, solution: "", additional: data.NumberEdit, message: {} } });
    if (ep === "item_tool") return json({ info: { response: "item_tool", number: 264, msg: "Artikel wurde erfasst 4110000167149", solution: "", additional: "4110000167149", message: {} } });
    res.writeHead(404).end();
  });
});
await new Promise((r) => srv.listen(0, r));

const client = new Client({ name: "e2e", version: "0" });
await client.connect(new StdioClientTransport({
  command: "node",
  args: [path.resolve("dist/index.js")],
  env: { ...process.env, EASYBASAR_API_URL: `http://127.0.0.1:${srv.address().port}`,
         EASYBASAR_CONFIG_DIR: mkdtempSync(path.join(os.tmpdir(), "eb-")), EASYBASAR_USER: "a@b.de", EASYBASAR_PASSWORD: "pw" },
}));
const call = async (name, args = {}) => {
  const r = await client.callTool({ name, arguments: args });
  return { err: Boolean(r.isError), text: r.content[0].text };
};

test("mehrere Basare: erst Auswahl, dann beim Server setzen", async () => {
  const r = await call("easybasar_artikel_formular");
  assert.equal(r.err, true);
  assert.match(r.text, /Bitte zuerst einen Basar auswählen/);
  const w = await call("easybasar_basar_waehlen", { id: "000000AAAAA" });
  assert.equal(w.err, false, w.text);
  assert.deepEqual(posts.find((p) => p.ep === "select_basar_seller_chiffre").data, { basar_id: "000000AAAAA", privileg: "seller", mod_seller: "true", __path: "includes" });
  assert.equal(selected, "000000AAAAA");
});

test("Artikel erfassen: Login → Basar → Formular → item_tool", async () => {
  const bad = await call("easybasar_artikel_erfassen", { felder: { Beschreibung: "Jacke" }, preis: 2.3, bestaetigt: true });
  assert.equal(bad.err, true);
  assert.match(bad.text, /Schritten von 0,50/);
  assert.equal(posts.filter((p) => p.ep === "item_tool").length, 0, "ungültiger Artikel wird nicht gesendet");

  const r = await call("easybasar_artikel_erfassen", {
    felder: { "Größe": "104", Farbe: "blau", Beschreibung: "Regenjacke" }, preis: "2,50", bestaetigt: true,
  });
  assert.equal(r.err, false, r.text);
  assert.match(r.text, /^Artikel wurde erfasst 4110000167149/);
  assert.doesNotMatch(r.text, /264/);
  assert.match(r.text, /"artikelnummer": "4110000167149"/);
  assert.match(r.text, /"freiePlaetze": 6/);

  const { __path, ...sent } = posts.find((p) => p.ep === "item_tool").data;
  assert.deepEqual(sent, { price: "2.50", right: "seller", big_item: "false", item_count: "1", "Größe": "104", Farbe: "blau", Beschreibung: "Regenjacke" });
  assert.deepEqual(posts.find((p) => p.ep === "basar_visible").data, { update: "reset_form", privileg: "seller", __path: "includes" });
  assert.deepEqual(posts.find((p) => p.ep === "basar_list").data, { action: "app", __path: "includes" });
  const i = posts.findIndex((p) => p.ep === "item_tool");
  assert.equal(posts[i - 1].ep, "select_basar_seller_chiffre", "Basar direkt vor item_tool gesetzt");
});

test("Artikel bearbeiten: action=edit, NumberEdit, nur nicht-leere Felder, Rabatt als discount", async () => {
  const r = await call("easybasar_artikel_bearbeiten", { artikelnummer: "4110000167149", felder: { Farbe: "rot" }, preis: 3, bestaetigt: true });
  assert.equal(r.err, false, r.text);
  assert.match(r.text, /^Artikel wurde geändert 4110000167149/);
  const { __path, ...sent } = posts.filter((p) => p.ep === "item_tool").at(-1).data;
  assert.deepEqual(sent, { price: "3.00", right: "seller", big_item: "false", action: "edit", NumberEdit: "4110000167149", Farbe: "rot" });
  const bad = await call("easybasar_artikel_bearbeiten", { artikelnummer: "4110000167149", preis: 3.2, bestaetigt: true });
  assert.equal(bad.err, true);
  assert.match(bad.text, /Schritten/);
});

test("Artikelliste: item_all_get mit Modul 270", async () => {
  const r = await call("easybasar_artikel_liste", {});
  assert.equal(r.err, false, r.text);
  assert.match(r.text, /"anzahl": 3/);
  assert.match(r.text, /"artikelnummer": "4110000167149"/);
  assert.equal(posts.filter((p) => p.ep === "item_all_get").at(-1).data.modul, "270");
});

test("Artikel löschen: Nummer → ID aus Liste, api/php, itemDeleteFinal, iid[]", async () => {
  const r = await call("easybasar_artikel_loeschen", { artikelnummern: ["4110000167149", "20115715"], bestaetigt: true });
  assert.equal(r.err, false, r.text);
  assert.match(r.text, /^Artikel wurde gelöscht 2/);
  assert.doesNotMatch(r.text, /707/);
  const d = posts.filter((p) => p.ep === "api_sel_actions").at(-1).data;
  assert.equal(d.__path, "php");
  assert.equal(d.action, "itemDeleteFinal");
  assert.deepEqual(d["iid[]"], ["27002241", "9479"]);
  const n = posts.filter((p) => p.ep === "api_sel_actions").length;
  const miss = await call("easybasar_artikel_loeschen", { artikelnummern: ["4110000167149", "000"], bestaetigt: true });
  assert.equal(miss.err, true);
  assert.match(miss.text, /Nicht .* gefunden: 000\. Nichts gelöscht/);
  assert.equal(posts.filter((p) => p.ep === "api_sel_actions").length, n, "bei unbekannter Nummer nichts senden");
  const no = await call("easybasar_artikel_loeschen", { artikelnummern: ["4110000167149"] });
  assert.equal(no.err, true, "ohne Bestätigung kein Löschen");
});

test("Bearbeiten: unbekannter oder gesperrter Artikel wird nicht gesendet", async () => {
  assert.match((await call("easybasar_artikel_bearbeiten", { artikelnummer: "000", preis: 1, bestaetigt: true })).text, /nicht unter den erfassten/);
  assert.match((await call("easybasar_artikel_bearbeiten", { artikelnummer: "777", preis: 1, bestaetigt: true })).text, /kann nicht mehr bearbeitet/);
});

test("ohne Bestätigung kein Erfassen", async () => {
  const r = await call("easybasar_artikel_erfassen", { felder: { Beschreibung: "x" }, preis: 1 });
  assert.equal(r.err, true);
});

test.after(async () => { await client.close(); srv.close(); });
