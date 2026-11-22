import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeEmail } from "../dist/credentials.js";

test("Ersatz für @", () => {
  for (const s of ["max(at)web.de", "max (at) web.de", "max[at]web.de", "max at web.de", "max#web.de", " max@web.de "]) {
    assert.equal(normalizeEmail(s), "max@web.de", s);
  }
  assert.equal(normalizeEmail("katja.at.home(at)web.de"), "katja.at.home@web.de");
});
