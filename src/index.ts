#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { ApiGeneralRequest, EasybasarError, SessionExpired, jwtPayload } from "./client.js";
import { render } from "./format.js";
import { BasarState, summarize } from "./basar.js";
import { LISTEN, ListName, findItems, loadItems } from "./liste.js";
import {
  LIMIT_TEXT,
  checkItem,
  describeForm,
  isSessionError,
  itemEditData,
  itemNumber,
  itemToolData,
  limitReached,
  loadForm,
} from "./artikel.js";
import { BASES, BaseName } from "./config.js";
import {
  Credentials,
  credentialsFile,
  deleteCredentials,
  loadCredentials,
  normalizeEmail,
  saveCredentials,
} from "./credentials.js";

const installDir = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const loginHint = `Im Terminal einloggen: bash "${path.join(installDir, "login.sh")}"`;

const api = new ApiGeneralRequest();
const basare = new BasarState(api, () => renewSession());
const downloadDir = path.resolve(process.env.EASYBASAR_DOWNLOAD_DIR ?? "downloads");

const server = new McpServer({ name: "easybasar", version: "0.9.1" });

const text = (t: string) => ({ content: [{ type: "text" as const, text: t }] });

const ok = (data: unknown) => text(render(data));
const fail = (e: unknown) => ({
  isError: true,
  ...text(e instanceof Error ? e.message : String(e)),
});

const baseSchema = z
  .enum(Object.keys(BASES) as [BaseName, ...BaseName[]])
  .default("includes")
  .describe(
    "Basis-URL: includes = /includes (Login usw.), php = /includes/api/php, " +
      "pdf = /includes/Pdf, userfiles = /userfiles, pdfs = /pdfs",
  );
const dataSchema = z
  .record(z.union([z.string(), z.number(), z.boolean()]))
  .default({})
  .describe("Formular-Parameter (POST-Body bzw. Query bei GET)");

class NeedsLogin extends Error {
  constructor(reason = "Nicht eingeloggt und keine gespeicherte Anmeldung.") {
    super(`${reason} Am besten: ${loginHint} (Passwort geht dann nicht durch den Chat).`);
  }
}

/** Fragt E-Mail/Passwort über einen Dialog des MCP-Clients ab (Elicitation), falls unterstützt. */
async function askUser(): Promise<(Credentials & { remember: boolean }) | null> {
  if (!server.server.getClientCapabilities()?.elicitation) return null;
  const r = await server.server.elicitInput({
    message:
      "easybasar-Login: Die Eingaben gehen direkt an den easybasar-Server, nicht an das Sprachmodell.",
    requestedSchema: {
      type: "object",
      properties: {
        user: {
          type: "string",
          title: "E-Mail-Adresse",
          description: "Falls @ nicht eingegeben werden kann: (at) oder # statt @ schreiben",
        },
        password: { type: "string", title: "Passwort" },
        remember: {
          type: "boolean",
          title: "Angemeldet bleiben (speichert nur ein Login-Token, nicht das Passwort)",
          default: false,
        },
      },
      required: ["user", "password"],
    },
  });
  if (r.action !== "accept" || !r.content) return null;
  const { user, password, remember } = r.content as Record<string, unknown>;
  if (typeof user !== "string" || typeof password !== "string") return null;
  return { user: normalizeEmail(user), password, remember: remember === true };
}

/** Ob der JWT dauerhaft gespeichert werden soll (Nutzer hat „angemeldet bleiben“ gewählt). */
let persistJwt = false;
api.onJwt = async (user, jwt) => {
  if (persistJwt) await saveCredentials(user, jwt);
};

const statusOf = (source: string) => ({ user: api.currentUser ?? "", source, saved: persistJwt });

/**
 * Reihenfolge: übergebene Daten → gespeicherter JWT (neue Session ohne Passwort) →
 * Umgebungsvariablen → Dialog. Gespeichert wird nur der JWT, nie das Passwort.
 */
async function doLogin(opts: {
  user?: string;
  password?: string;
  remember?: boolean;
  force_logout?: boolean;
  interactive?: boolean;
}) {
  let creds: Credentials | null = null;
  let remember = opts.remember ?? false;
  let source = "";
  let expired = false;

  if (opts.user && opts.password) {
    creds = { user: normalizeEmail(opts.user), password: opts.password };
    source = "eingegeben";
  } else {
    const saved = await loadCredentials();
    if (saved?.jwt) {
      persistJwt = true;
      if (await api.renew(saved.jwt, saved.user)) {
        basare.reset();
        return { response: null, status: statusOf("gespeichertes Login-Token") };
      }
      persistJwt = false;
      expired = true;
    }
    if (saved?.password) {
      // Altdatei mit Passwort: einmal damit einloggen, danach nur noch den JWT speichern.
      creds = { user: saved.user, password: saved.password };
      source = "gespeichert (alt)";
      remember = true;
    } else if (expired) {
      await deleteCredentials();
    }
  }
  if (!creds && process.env.EASYBASAR_USER && process.env.EASYBASAR_PASSWORD) {
    creds = { user: process.env.EASYBASAR_USER, password: process.env.EASYBASAR_PASSWORD };
    source = "Umgebungsvariablen";
  }
  if (!creds && opts.interactive !== false) {
    const asked = await askUser();
    if (asked) {
      creds = asked;
      remember = asked.remember || remember;
      source = "Dialog";
    }
  }
  if (!creds) throw expired ? new NeedsLogin("Die gespeicherte Anmeldung ist abgelaufen.") : new NeedsLogin();
  if (source === "Dialog" && !creds.user.includes("@")) {
    throw new Error(
      "Die E-Mail-Adresse enthält kein @. Bitte (at) statt @ schreiben. " + loginHint,
    );
  }
  persistJwt = remember;
  const response = await api.login(creds.user, creds.password, opts.force_logout ?? false);
  basare.reset();
  if (remember && !api.jwt) {
    // Ohne JWT nichts speichern – vor allem nicht das Passwort.
    persistJwt = false;
    if (source === "gespeichert (alt)") await deleteCredentials();
  }
  return { response, status: statusOf(source) };
}

/** Neue Session per JWT; geht das nicht, ist ein neuer Login mit E-Mail/Passwort nötig. */
async function renewSession() {
  try {
    await api.relogin();
  } catch (r) {
    if (r instanceof SessionExpired) {
      if (persistJwt) await deleteCredentials();
      persistJwt = false;
      throw new NeedsLogin("Die Anmeldung ist abgelaufen.");
    }
    throw r;
  }
}

/** Führt fn aus; loggt vorher ggf. ein und bei Session-Fehler (z. B. Nr. 110) einmal neu. */
async function withSession<T>(fn: () => Promise<T>, autoLogin: boolean): Promise<T> {
  if (autoLogin && !api.isLoggedIn) await doLogin({});
  try {
    return await fn();
  } catch (e) {
    if (autoLogin && isSessionError(e)) {
      // Session abgelaufen → mit dem JWT eine neue holen (kein Passwort nötig).
      await renewSession();
      return fn();
    }
    throw e;
  }
}

server.registerTool(
  "easybasar_login",
  {
    title: "Bei easybasar einloggen",
    description:
      "Meldet den Verkäufer per app_login an. Ohne user/password werden zuerst gespeicherte " +
      "Zugangsdaten genutzt, sonst wird der Nutzer per Dialog gefragt (Passwort geht dann nicht " +
      "durch den Chat). Nur wenn das scheitert, E-Mail-Adresse/Passwort im Chat erfragen und übergeben. " +
      "remember=true speichert die Zugangsdaten lokal (nur mit Zustimmung des Nutzers). " +
      "force_logout=true beendet eine bestehende Sitzung auf einem anderen Gerät.",
    inputSchema: {
      user: z.string().optional().describe("E-Mail-Adresse des Kontos (= API-Feld user)"),
      password: z.string().optional(),
      remember: z
        .boolean()
        .default(false)
        .describe("Zugangsdaten nach erfolgreichem Login lokal speichern"),
      force_logout: z.boolean().default(false),
    },
  },
  async (args) => {
    try {
      const { response, status } = await doLogin(args);
      return text(
        [
          response ? render(response) : "",
          `Eingeloggt als ${status.user}` + (status.saved ? " (angemeldet bleiben)" : ""),
        ]
          .filter((t) => t && t !== "OK")
          .join("\n\n"),
      );
    } catch (e) {
      if (e instanceof EasybasarError && String(e.body.number) === "2211") {
        // Bereits auf einem anderen Gerät angemeldet.
        return fail(
          new Error(
            e.message +
              "\n\n[Für Claude: Nutzer fragen, ob alle anderen Sitzungen abgemeldet werden sollen. " +
              "Nur bei Ja easybasar_login erneut mit force_logout=true aufrufen.]",
          ),
        );
      }
      return fail(e);
    }
  },
);

server.registerTool(
  "easybasar_logout",
  {
    title: "Abmelden / gespeicherte Zugangsdaten löschen",
    description:
      "Beendet die lokale Session. forget=true löscht zusätzlich die gespeicherten Zugangsdaten.",
    inputSchema: { forget: z.boolean().default(false) },
  },
  async ({ forget }) => {
    api.logout();
    basare.reset();
    return ok({ loggedIn: false, credentialsDeleted: forget ? await deleteCredentials() : false });
  },
);

server.registerTool(
  "easybasar_signup",
  {
    title: "Neues easybasar-Konto erstellen",
    description:
      "Registriert einen neuen Verkäufer über app_signup. Nur aufrufen, nachdem der Nutzer die " +
      "Bedingungen (https://www.easybasar.de/asb) und den Datenschutz " +
      "(https://www.easybasar.de/datenschutzbestimmungen) gesehen und AUSDRÜCKLICH akzeptiert hat – " +
      "conditions und data_protection müssen true sein. Danach muss das Konto über den " +
      "Aktivierungslink in der E-Mail aktiviert werden, bevor ein Login möglich ist.",
    inputSchema: {
      first_name: z.string().min(1),
      last_name: z.string().min(1),
      street: z.string().min(1),
      zip: z.string().min(1),
      city: z.string().min(1),
      email: z.string().email(),
      password: z.string().min(1),
      phone: z.string().min(1),
      conditions: z
        .literal(true)
        .describe("Bedingungen akzeptiert – nur true, wenn der Nutzer zugestimmt hat"),
      data_protection: z
        .literal(true)
        .describe("Datenschutz akzeptiert – nur true, wenn der Nutzer zugestimmt hat"),
    },
  },
  async (args) => {
    try {
      const data = {
        ...args,
        conditions: String(args.conditions),
        data_protection: String(args.data_protection),
      };
      return ok(await api.request("app_signup", "POST", data, { Accept: "application/json" }));
    } catch (e) {
      return fail(e);
    }
  },
);

server.registerTool(
  "easybasar_status",
  {
    title: "Session-Status",
    description: "Zeigt, ob eine Session besteht, und die letzte Login-Antwort.",
    inputSchema: {},
  },
  async () =>
    ok({
      loggedIn: api.isLoggedIn,
      user: api.currentUser,
      basar: basare.selected ? summarize(basare.selected) : null,
      sessionCookies: api.cookieNames,
      angemeldetBleiben: persistJwt,
      loginTokenGueltigBis: (() => {
        const exp = api.jwt ? jwtPayload(api.jwt)?.exp : undefined;
        return typeof exp === "number" ? new Date(exp * 1000).toISOString() : null;
      })(),
      gespeichert: (await loadCredentials())?.user ?? null,
      credentialsFile,
      bases: BASES,
    }),
);

server.registerTool(
  "easybasar_basare",
  {
    title: "Meine Basare",
    description:
      "Listet die Basare des Verkäufers (basar_list.php, action=app). Gibt es genau einen, wird er " +
      "automatisch ausgewählt. Bei mehreren muss der Nutzer wählen (easybasar_basar_waehlen). " +
      "Ein gewählter Basar ist Voraussetzung für Artikel erfassen/bearbeiten/löschen und die Artikelliste.",
    inputSchema: {},
  },
  async () => {
    try {
      const list = await withSession(async () => {
        const l = await basare.load();
        if (basare.selected) await basare.activate(basare.selected);
        return l;
      }, true);
      const sel = basare.selected;
      return ok({
        ausgewaehlt: sel ? summarize(sel) : null,
        hinweis: sel
          ? list.length === 1
            ? "Einziger Basar – automatisch ausgewählt."
            : "Bereits ausgewählt."
          : list.length
            ? "Mehrere Basare – bitte den Nutzer wählen lassen."
            : "Kein Basar vorhanden.",
        basare: list.map(summarize),
      });
    } catch (e) {
      return fail(e);
    }
  },
);

server.registerTool(
  "easybasar_basar_waehlen",
  {
    title: "Basar auswählen",
    description:
      "Wählt den Basar (id = data.ID aus easybasar_basare), für den Artikel-Aktionen gelten. " +
      "Die Auswahl gilt, bis ein anderer Basar gewählt oder abgemeldet wird.",
    inputSchema: { id: z.string().min(1).describe("data.ID des Basars") },
  },
  async ({ id }) => {
    try {
      const { b, res } = await withSession(async () => {
        const b = await basare.select(id);
        return { b, res: await basare.activate(b) };
      }, true);
      return text([render(res), JSON.stringify({ ausgewaehlt: summarize(b) }, null, 2)].filter((t) => t !== "OK").join("\n\n"));
    } catch (e) {
      return fail(e);
    }
  },
);

const itemSchema = {
  felder: z
    .record(z.string())
    .describe("Feldname → Wert, Namen wie in formular.felder (z. B. Größe, Farbe, Beschreibung)"),
  preis: z.union([z.number(), z.string()]).describe('Preis, z. B. 2.5 oder "2,50"'),
  rabatt: z.number().optional().describe("Nur angeben, wenn der Nutzer eine Rabattstufe gewählt hat"),
};

/** Formular des gewählten Basars laden und prüfen, dass es zu diesem Basar gehört. */
async function formForSelectedBasar() {
  return withSession(async () => {
    const basar = await basare.require();
    // Bei jedem Aufruf neu setzen: nach einem Re-Login kennt der Server die Auswahl nicht mehr.
    await basare.activate(basar);
    const f = await loadForm(api);
    if (f.form.basar_id && f.form.basar_id !== basar.ID) {
      throw new Error(
        `Der Server liefert das Formular für Basar ${f.form.basar_id}, gewählt ist aber ${basar.ID} (${basar.Basar}).`,
      );
    }
    return { basar, f };
  }, true);
}

server.registerTool(
  "easybasar_artikel_formular",
  {
    title: "Artikel-Formular des Basars",
    description:
      "Lädt für den gewählten Basar, welche Felder ein Artikel hat (pro Basar unterschiedlich), " +
      "Preis-Range und -Schritt, Rabatt-Optionen und wie viele Artikel noch frei sind " +
      "(basar_visible.php, update=reset_form, privileg=seller). Vor jedem Erfassen aufrufen.",
    inputSchema: {},
  },
  async () => {
    try {
      const { basar, f } = await formForSelectedBasar();
      return ok({
        basar: summarize(basar),
        ...(limitReached(f.item) ? { achtung: LIMIT_TEXT } : {}),
        formular: describeForm(f),
      });
    } catch (e) {
      return fail(e);
    }
  },
);

server.registerTool(
  "easybasar_artikel_pruefen",
  {
    title: "Artikel prüfen",
    description:
      "Prüft einen Artikel gegen das aktuelle Formular des gewählten Basars: Pflichtfelder, " +
      "Feldlängen, Preis zwischen item_price_min und item_price_max und teilbar durch item_price_div, " +
      "Rabatt (nur vom Nutzer gewählt) und Artikel-Limit. Liefert Fehler, Warnungen und die normalisierten Werte.",
    inputSchema: {
      ...itemSchema,
      neu: z.boolean().default(true).describe("true = neuer Artikel (Limit wird geprüft)"),
    },
  },
  async ({ felder, preis, rabatt, neu }) => {
    try {
      const { basar, f } = await formForSelectedBasar();
      const r = checkItem(f, { felder, preis, rabatt }, neu);
      return { ...ok({ basar: basar.Basar, ...r }), ...(r.ok ? {} : { isError: true }) };
    } catch (e) {
      return fail(e);
    }
  },
);


server.registerTool(
  "easybasar_artikel_erfassen",
  {
    title: "Artikel erfassen",
    description:
      "Erfasst einen neuen Artikel im gewählten Basar (item_tool.php). Lädt vorher das Formular, " +
      "prüft alles wie easybasar_artikel_pruefen und sendet nur, wenn die Prüfung fehlerfrei ist. " +
      "Nur aufrufen, nachdem der Nutzer die Werte bestätigt hat (bestaetigt=true). " +
      "Die Beschreibung kann danach nicht mehr geändert werden.",
    inputSchema: {
      ...itemSchema,
      bestaetigt: z.literal(true).describe("Nutzer hat die angezeigten Werte bestätigt"),
    },
  },
  async ({ felder, preis, rabatt }) => {
    try {
      const { basar, f } = await formForSelectedBasar();
      const r = checkItem(f, { felder, preis, rabatt }, true);
      if (!r.ok) return { isError: true, ...ok({ basar: basar.Basar, ...r }) };
      if (r.normalisiert!.rabatt) {
        throw new Error(
          "Rabatt kann noch nicht übertragen werden (Parameter für item_tool.php unbekannt). " +
            "Artikel wurde nicht erfasst.",
        );
      }
      // Basar direkt vor dem Senden erneut setzen (auch beim Retry nach Re-Login).
      const res = await withSession(async () => {
        await basare.activate(basar);
        return api.request("item_tool", "POST", itemToolData(r.normalisiert!));
      }, true);
      const frei = Math.max(0, f.item.item_max_count - f.item.item_actual_count - 1);
      return text(
        [
          render(res),
          JSON.stringify(
            { artikelnummer: itemNumber(res), basar: basar.Basar, freiePlaetze: frei, warnungen: r.warnungen },
            null,
            2,
          ),
        ].join("\n\n"),
      );
    } catch (e) {
      return fail(e);
    }
  },
);

server.registerTool(
  "easybasar_artikel_bearbeiten",
  {
    title: "Artikel bearbeiten",
    description:
      "Ändert einen bestehenden Artikel im gewählten Basar (item_tool.php, action=edit, NumberEdit). " +
      "Preis ist Pflicht und wird wie beim Erfassen geprüft; von den Feldern werden nur angegebene, " +
      "nicht-leere gesendet. Rabatt nur, wenn der Basar ihn anbietet und der Nutzer ihn gewählt hat. " +
      "Nur nach Bestätigung des Nutzers (bestaetigt=true).",
    inputSchema: {
      artikelnummer: z.string().min(1).describe("Artikelnummer (Barcode), z. B. 4110000167149"),
      ...itemSchema,
      felder: itemSchema.felder.default({}),
      bestaetigt: z.literal(true).describe("Nutzer hat die Änderung bestätigt"),
    },
  },
  async ({ artikelnummer, felder, preis, rabatt }) => {
    try {
      const { basar, f } = await formForSelectedBasar();
      const r = checkItem(f, { felder, preis, rabatt }, false, true);
      if (!r.ok) return { isError: true, ...ok({ basar: basar.Basar, ...r }) };
      const res = await withSession(async () => {
        await basare.activate(basar);
        const { found } = findItems(await loadItems(api, ["erfasst"]), [artikelnummer]);
        const item = found[0];
        if (!item) throw new Error(`Artikel ${artikelnummer} ist nicht unter den erfassten Artikeln dieses Basars.`);
        if (!item.bearbeitbar) throw new Error(`Artikel ${item.artikelnummer} kann nicht mehr bearbeitet werden.`);
        return api.request("item_tool", "POST", itemEditData(r.normalisiert!, item.artikelnummer));
      }, true);
      return text(
        [render(res), JSON.stringify({ artikelnummer, basar: basar.Basar }, null, 2)].join("\n\n"),
      );
    } catch (e) {
      return fail(e);
    }
  },
);

server.registerTool(
  "easybasar_artikel_liste",
  {
    title: "Meine Artikel",
    description:
      "Liest die Artikel des Verkäufers im gewählten Basar (item_all_get.php). Listen: erfasst, " +
      "abgegeben (Check-in), verkauft, zurueck (Check-out). Liefert je Artikel id, artikelnummer, " +
      "beschreibung, preis, rabatt, verkaufspreis, gedruckt, bearbeitbar. Wird nicht zwischengespeichert.",
    inputSchema: {
      listen: z
        .array(z.enum(Object.keys(LISTEN) as [ListName, ...ListName[]]))
        .min(1)
        .default(["erfasst"]),
    },
  },
  async ({ listen }) => {
    try {
      const { basar, items } = await withSession(async () => {
        const basar = await basare.require();
        await basare.activate(basar);
        return { basar, items: await loadItems(api, listen) };
      }, true);
      const summe = items.reduce((s, i) => s + (i.verkaufspreis ?? i.preis), 0);
      return ok({
        basar: basar.Basar,
        listen: listen.map((l) => LISTEN[l].titel),
        anzahl: items.length,
        summe: Math.round(summe * 100) / 100,
        artikel: items,
      });
    } catch (e) {
      return fail(e);
    }
  },
);

server.registerTool(
  "easybasar_artikel_loeschen",
  {
    title: "Artikel löschen",
    description:
      "Löscht erfasste Artikel endgültig (api/php/api_sel_actions.php, action=itemDeleteFinal, iid[]). " +
      "Angabe per Artikelnummer (Barcode); die interne ID wird frisch aus der Liste „erfasst“ ermittelt. " +
      "Gelöschte Artikel können nicht mehr abgegeben werden – ihr Etikett muss vernichtet werden. " +
      "Ein gelöschter Artikel gibt einen Platz im Artikel-Limit frei. " +
      "Nur nach ausdrücklicher Bestätigung des Nutzers (bestaetigt=true).",
    inputSchema: {
      artikelnummern: z
        .array(z.string().min(1))
        .min(1)
        .describe("Artikelnummer(n) aus easybasar_artikel_liste"),
      bestaetigt: z.literal(true).describe("Nutzer hat das endgültige Löschen bestätigt"),
    },
  },
  async ({ artikelnummern }) => {
    try {
      const { basar, res, found } = await withSession(async () => {
        const basar = await basare.require();
        await basare.activate(basar);
        const { found, missing } = findItems(await loadItems(api, ["erfasst"]), artikelnummern);
        if (missing.length) {
          throw new Error(
            `Nicht in den erfassten Artikeln dieses Basars gefunden: ${missing.join(", ")}. Nichts gelöscht.`,
          );
        }
        const res = await api.request(
          "api_sel_actions",
          "POST",
          { action: "itemDeleteFinal", "iid[]": found.map((i) => i.id) },
          { Accept: "application/json" },
          "php",
        );
        return { basar, res, found };
      }, true);
      return text(
        [
          render(res),
          JSON.stringify(
            {
              basar: basar.Basar,
              geloescht: found.map((i) => ({ artikelnummer: i.artikelnummer, beschreibung: i.beschreibung })),
              hinweis: "Etikett(en) vernichten.",
            },
            null,
            2,
          ),
        ].join("\n\n"),
      );
    } catch (e) {
      return fail(e);
    }
  },
);

server.registerTool(
  "easybasar_request",
  {
    title: "easybasar-API aufrufen",
    description:
      "Entspricht ApiGeneralRequest().request(endpoint, method, data). " +
      "Ruft <base>/<endpoint>.php auf (z. B. endpoint 'app_login'). " +
      "Loggt bei Bedarf automatisch ein und hält die Session-Cookies.",
    inputSchema: {
      endpoint: z.string().min(1).describe("Endpunkt ohne .php, z. B. 'app_login'"),
      method: z.enum(["GET", "POST"]).default("POST"),
      data: dataSchema,
      base: baseSchema,
      auto_login: z.boolean().default(true),
    },
  },
  async ({ endpoint, method, data, base, auto_login }) => {
    try {
      return ok(
        await withSession(
          () => api.request(endpoint, method, data, { Accept: "application/json" }, base),
          auto_login,
        ),
      );
    } catch (e) {
      return fail(e);
    }
  },
);

server.registerTool(
  "easybasar_download",
  {
    title: "Datei/PDF herunterladen",
    description:
      "Lädt eine Datei (z. B. Etiketten- oder Listen-PDF) mit der aktuellen Session herunter " +
      "und speichert sie lokal. Gibt den Dateipfad zurück.",
    inputSchema: {
      endpoint: z
        .string()
        .min(1)
        .describe("Pfad relativ zur Basis; ohne Endung wird .php angehängt"),
      method: z.enum(["GET", "POST"]).default("GET"),
      data: dataSchema,
      base: baseSchema.default("pdf"),
      filename: z.string().optional().describe("Zieldateiname (Standard: aus der Antwort/URL)"),
    },
  },
  async ({ endpoint, method, data, base, filename }) => {
    try {
      const res = await withSession(
        () => api.raw(endpoint, method, data, { Accept: "*/*" }, base),
        true,
      );
      if (!res.ok) throw new Error(`HTTP ${res.status} bei ${endpoint}`);
      const type = res.headers.get("content-type") ?? "";
      const buf = Buffer.from(await res.arrayBuffer());
      if (type.includes("json")) {
        const json = JSON.parse(buf.toString("utf8"));
        if (json?.error) throw new EasybasarError(json.error);
        return ok(json);
      }
      const fromHeader = /filename="?([^";]+)"?/i.exec(
        res.headers.get("content-disposition") ?? "",
      )?.[1];
      const name = path.basename(
        filename ?? fromHeader ?? endpoint.split("?")[0].split("/").pop() ?? "download",
      );
      await mkdir(downloadDir, { recursive: true });
      const file = path.join(downloadDir, name);
      await writeFile(file, buf);
      return ok({ file, contentType: type, bytes: buf.length });
    } catch (e) {
      return fail(e);
    }
  },
);

await server.connect(new StdioServerTransport());
