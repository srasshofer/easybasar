import { test } from "node:test";
import assert from "node:assert/strict";
import { render } from "../dist/format.js";
import { EasybasarError } from "../dist/client.js";

test("info: nur msg (und solution), keine Nummer", () => {
  const r = render({ info: { response: "itemremove", number: 707, msg: "Artikel wurde gelöscht 1", solution: "", additional: 1, message: {} } });
  assert.equal(r, "Artikel wurde gelöscht 1");
});

test("error: msg + solution, keine Nummer", () => {
  const e = new EasybasarError({ response: "login", number: 2208, msg: "Ihr Benutzerkonto ist noch nicht aktiviert. ", solution: "Bitte klicken Sie auf den Aktivierungslink in Ihrer Registrierungs-E-Mail." });
  assert.equal(e.message, "Ihr Benutzerkonto ist noch nicht aktiviert.\nBitte klicken Sie auf den Aktivierungslink in Ihrer Registrierungs-E-Mail.");
  assert.doesNotMatch(e.message, /2208/);
});

test("weitere Nutzdaten bleiben erhalten", () => {
  assert.equal(render({ info: { msg: "OK da", solution: "" }, items: [1] }), 'OK da\n\n{\n  "items": [\n    1\n  ]\n}');
});
