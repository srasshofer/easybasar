// JWT: speichern statt Passwort, Session per Bearer-JWT erneuern (Mock-Server, kein easybasar.de).
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { mkdtempSync, readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const makeJwt = (n, expSec) => `${b64({ alg: "HS256" })}.${b64({ iss: "eb", exp: expSec, data: { email: "max@web.de", id: "1" } })}.sig${n}`;
const future = () => Math.floor(Date.now() / 1000) + 3600;

const st = { session: null, n: 0, validJwts: new Set(), log: [] };
const srv = http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    const ep = path.basename(new URL(req.url, "http://x").pathname, ".php");
    const data = Object.fromEntries(new URLSearchParams(body));
    const auth = req.headers.authorization ?? "";
    const ck = (req.headers.cookie ?? "").match(/PHPSESSID=([^;]+)/)?.[1];
    st.log.push({ ep, data, auth, ck });
    const json = (o, h = {}) => { res.writeHead(200, { "Content-Type": "application/json", ...h }); res.end(JSON.stringify(o)); };
    const newSession = () => { st.session = `s${++st.n}`; const jwt = makeJwt(st.n, future()); st.validJwts.add(jwt); return jwt; };
    if (ep === "app_login") {
      if (data.user) {
        if (data.password !== "pw") return json({ error: { number: 2201, msg: "Falsches Passwort.", solution: "" } });
        const jwt = newSession();
        return json({ info: { number: 2205, msg: "", solution: "", message: { jwt, instance: st.session } } }, { "Set-Cookie": `PHPSESSID=${st.session}; Path=/` });
      }
      const bearer = auth.replace(/^Bearer /, "");
      if (!st.validJwts.has(bearer)) return json({ error: { number: 2300, msg: "Token ungültig.", solution: "" } });
      const jwt = newSession();
      return json({ info: { number: 2205, msg: "", solution: "", message: { jwt, instance: st.session } } }, { "Set-Cookie": `PHPSESSID=${st.session}; Path=/` });
    }
    if (ep === "app_logout") { if (ck !== st.session) return json({ error: { number: 110, msg: "x", solution: "" } }); st.session = null; st.validJwts.clear(); return json({ info: { number: 2210, msg: "Sie wurden abgemeldet.", solution: "" } }); }
    if (!ck || ck !== st.session) return json({ error: { response: "visible", number: 110, msg: "Keine gültige Session.", solution: "" } });
    if (ep === "basar_list") return json({ data: [{ ID: "A", Basar: "Testbasar", VKNr: "201" }] });
    if (ep === "select_basar_seller_chiffre") return json({ info: { msg: "", solution: "" } });
    res.writeHead(404).end();
  });
});
await new Promise((r) => srv.listen(0, r));
const cfg = mkdtempSync(path.join(os.tmpdir(), "eb-jwt-"));
const credFile = path.join(cfg, "credentials.json");

async function start() {
  const client = new Client({ name: "t", version: "0" });
  const env = { ...process.env, EASYBASAR_API_URL: `http://127.0.0.1:${srv.address().port}`, EASYBASAR_CONFIG_DIR: cfg };
  delete env.EASYBASAR_USER; delete env.EASYBASAR_PASSWORD;
  await client.connect(new StdioClientTransport({ command: "node", args: [path.resolve("dist/index.js")], env }));
  const call = async (name, args = {}) => {
    const r = await client.callTool({ name, arguments: args });
    return { err: Boolean(r.isError), text: r.content[0].text };
  };
  return { client, call };
}

test("Login mit remember speichert nur E-Mail + JWT, nie das Passwort", async () => {
  const { client, call } = await start();
  const r = await call("easybasar_login", { user: "max(at)web.de", password: "pw", remember: true });
  assert.equal(r.err, false, r.text);
  assert.doesNotMatch(r.text, /sig\d|eyJ/, "JWT wird nicht ausgegeben");
  const saved = JSON.parse(readFileSync(credFile, "utf8"));
  assert.deepEqual(Object.keys(saved).sort(), ["jwt", "user"]);
  assert.equal(saved.user, "max@web.de");
  assert.doesNotMatch(readFileSync(credFile, "utf8"), /"pw"/);

  // Session läuft serverseitig ab → 110 → Erneuerung per Bearer-JWT → Aufruf klappt
  st.session = "abgelaufen";
  const before = st.log.length;
  const b = await call("easybasar_basare");
  assert.equal(b.err, false, b.text);
  const renew = st.log.slice(before).find((l) => l.ep === "app_login");
  assert.ok(renew, "Session wurde erneuert");
  assert.equal(renew.data.user, undefined, "kein Benutzer/Passwort beim Erneuern");
  assert.equal(renew.data.password, undefined);
  assert.deepEqual(Object.keys(renew.data).sort(), ["c", "l", "o", "v"]);
  assert.match(renew.auth, /^Bearer .+\.sig1$/);
  assert.match(JSON.parse(readFileSync(credFile, "utf8")).jwt, /sig2$/, "neuer JWT gespeichert");
  await client.close();
});

test("Neustart: gespeicherter JWT holt Session ohne Passwort", async () => {
  const { client, call } = await start();
  const before = st.log.length;
  const b = await call("easybasar_basare");
  assert.equal(b.err, false, b.text);
  const l = st.log.slice(before).find((x) => x.ep === "app_login");
  assert.match(l.auth, /^Bearer /);
  assert.equal(l.data.password, undefined);
  await client.close();
});

test("JWT ungültig → neuer Login verlangt, gespeicherte Anmeldung gelöscht", async () => {
  st.validJwts.clear();
  st.session = "abgelaufen";
  const { client, call } = await start();
  const b = await call("easybasar_basare");
  assert.equal(b.err, true);
  assert.match(b.text, /abgelaufen.*login\.sh/s);
  assert.equal(existsSync(credFile), false);
  await client.close();
});

test("abgelaufener JWT (exp) wird gar nicht erst gesendet", async () => {
  writeFileSync(credFile, JSON.stringify({ user: "max@web.de", jwt: makeJwt(99, 1000) }));
  const { client, call } = await start();
  const before = st.log.length;
  const b = await call("easybasar_basare");
  assert.equal(b.err, true);
  assert.equal(st.log.slice(before).filter((x) => x.ep === "app_login").length, 0);
  await client.close();
});

test("Altdatei mit Passwort wird beim Login auf JWT umgestellt", async () => {
  mkdirSync(cfg, { recursive: true });
  writeFileSync(credFile, JSON.stringify({ user: "max@web.de", password: "pw" }));
  const { client, call } = await start();
  const b = await call("easybasar_basare");
  assert.equal(b.err, false, b.text);
  const saved = JSON.parse(readFileSync(credFile, "utf8"));
  assert.equal(saved.password, undefined);
  assert.ok(saved.jwt);
  await client.close();
});

test("Login mit Benutzername statt E-Mail", async () => {
  const { client, call } = await start();
  const before = st.log.length;
  const r = await call("easybasar_login", { user: "max_2026", password: "pw" });
  assert.equal(r.err, false, r.text);
  assert.equal(st.log.slice(before).find((l) => l.ep === "app_login").data.user, "max_2026");
  await client.close();
});

test("Abmelden: app_logout mit Session, danach gespeicherte Anmeldung gelöscht", async () => {
  const { client, call } = await start();
  await call("easybasar_login", { user: "max", password: "pw", remember: true });
  assert.ok(existsSync(credFile));
  const r = await call("easybasar_logout");
  assert.equal(r.err, false, r.text);
  assert.equal(r.text, "Sie wurden abgemeldet.");
  const l = st.log.filter((x) => x.ep === "app_logout").at(-1);
  assert.deepEqual(l.data, {});
  assert.ok(l.ck, "mit Session-Cookie");
  assert.equal(existsSync(credFile), false);
  await client.close();
});

test("Abmelden nach Neustart: Session per JWT holen, dann app_logout", async () => {
  const { client, call } = await start();
  await call("easybasar_login", { user: "max", password: "pw", remember: true });
  await client.close();
  const c2 = await start();
  const r = await c2.call("easybasar_logout");
  assert.equal(r.text, "Sie wurden abgemeldet.");
  assert.equal(existsSync(credFile), false);
  await c2.client.close();
});

test.after(() => srv.close());
