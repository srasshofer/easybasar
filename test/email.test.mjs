import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeLogin } from "../dist/credentials.js";

test("E-Mail: (at)-Ersatz für @", () => {
  for (const s of ["max(at)web.de", "max (at) web.de", "max[at]web.de", "max{at}web.de", " max@web.de "]) {
    assert.equal(normalizeLogin(s), "max@web.de", s);
  }
  assert.equal(normalizeLogin("katja.at.home(at)web.de"), "katja.at.home@web.de");
});

test("Benutzernamen bleiben unverändert", () => {
  for (const s of ["max", "max#1", "kat at home", "Mustermann_2026"]) assert.equal(normalizeLogin(s), s);
  assert.equal(normalizeLogin("  max  "), "max");
});
