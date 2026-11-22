import { test } from "node:test";
import assert from "node:assert/strict";
import { BasarState, NeedsBasarChoice } from "../dist/basar.js";

const b1 = { ID: "000000AAAAA", Basar: "easybasar Test Bazaar", VKNr: "201", SALB: "2026-11-22 00:00:01", SALE: "2026-11-23 00:00:00" };
const b2 = { ID: "000000BBBBB", Basar: "Zweiter Basar", VKNr: "17" };
const fakeApi = (data, calls = []) => ({
  request: async (ep, m, d) => { calls.push([ep, m, d]); return { data }; },
});

test("ruft basar_list mit action=app auf und wählt einzigen Basar automatisch", async () => {
  const calls = [];
  const s = new BasarState(fakeApi([b1], calls));
  assert.equal((await s.require()).ID, b1.ID);
  assert.deepEqual(calls, [["basar_list", "POST", { action: "app" }]]);
});

test("bei mehreren Basaren muss gewählt werden", async () => {
  const s = new BasarState(fakeApi([b1, b2]));
  await assert.rejects(s.require(), (e) => e instanceof NeedsBasarChoice && /000000BBBBB/.test(e.message));
  await s.select("000000BBBBB");
  assert.equal((await s.require()).Basar, "Zweiter Basar");
  await assert.rejects(s.select("gibtsnicht"), NeedsBasarChoice);
});

test("kein Basar: Hinweis auf Nummernvergabe", async () => {
  const s = new BasarState(fakeApi([]));
  await assert.rejects(s.require(), /basar-anmeldung/);
});

test("leere Liste (Session abgelaufen): einmal neu einloggen und erneut laden", async () => {
  let n = 0, relogins = 0;
  const api = { request: async () => ({ data: n++ === 0 ? [] : [b1] }) };
  const s = new BasarState(api, async () => relogins++);
  assert.equal((await s.require()).ID, b1.ID);
  assert.equal(relogins, 1);
});
