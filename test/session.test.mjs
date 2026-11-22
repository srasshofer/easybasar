// Prüft die Session-Cookie-Logik gegen einen lokalen Mock-Server (kein Zugriff auf easybasar.de).
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

const seen = [];
const srv = http.createServer((req, res) => {
  const p = new URL(req.url, "http://x").pathname.replace("/app/v0.8/a/includes/", "");
  const ck = req.headers.cookie ?? "";
  seen.push({ p, ck });
  const json = (body, headers = {}) => {
    res.writeHead(200, { "Content-Type": "application/json", ...headers });
    res.end(JSON.stringify(body));
  };
  if (p === "app_login.php")
    return res.writeHead(302, { "Set-Cookie": "PHPSESSID=abc; Path=/", Location: "/app/v0.8/a/includes/login_ok.php" }).end();
  if (p === "login_ok.php") return json({ ok: true }, { "Set-Cookie": "extra=1" });
  if (p === "mine.php") {
    if (!ck.includes("PHPSESSID=abc")) return json({ error: { response: "login", number: 1, msg: "nicht eingeloggt" } });
    return json({ basare: [1] }, { "Set-Cookie": "extra=deleted; Max-Age=0" });
  }
  res.writeHead(404).end();
});
await new Promise((r) => srv.listen(0, r));
process.env.EASYBASAR_API_URL = `http://127.0.0.1:${srv.address().port}`;
const { ApiGeneralRequest, EasybasarError } = await import("../dist/client.js");

test("Login setzt Session-Cookie (auch über Redirect) und sendet ihn weiter", async () => {
  const api = new ApiGeneralRequest();
  await api.login("a@b.de", "pw");
  assert.deepEqual(api.cookieNames, ["PHPSESSID", "extra"]);
  assert.deepEqual(await api.request("mine"), { basare: [1] });
  assert.equal(seen.at(-1).ck, "PHPSESSID=abc; extra=1");
  assert.deepEqual(api.cookieNames, ["PHPSESSID"], "gelöschtes Cookie entfernt");
  api.logout();
  await assert.rejects(api.request("mine"), EasybasarError);
  assert.equal(seen.at(-1).ck, "");
});

test.after(() => srv.close());
