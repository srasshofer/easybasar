#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { ApiGeneralRequest, EasybasarError } from "./client.js";
import { render } from "./format.js";
import { BasarState, summarize } from "./basar.js";
import {
  LIMIT_TEXT,
  checkItem,
  describeForm,
  isSessionError,
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
  saveCredentials,
} from "./credentials.js";

const api = new ApiGeneralRequest();
const basare = new BasarState(api, () => api.relogin());
const downloadDir = path.resolve(process.env.EASYBASAR_DOWNLOAD_DIR ?? "downloads");

const server = new McpServer({ name: "easybasar", version: "0.1.0" });

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
  constructor() {
    super(
      "Nicht eingeloggt und keine gespeicherten Zugangsdaten. " +
        "Bitte zuerst easybasar_login aufrufen (E-Mail-Adresse und Passwort beim Nutzer erfragen).",
    );
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
        user: { type: "string", title: "E-Mail-Adresse", format: "email" },
        password: { type: "string", title: "Passwort" },
        remember: {
          type: "boolean",
          title: "Zugangsdaten auf diesem Rechner speichern",
          default: false,
        },
      },
      required: ["user", "password"],
    },
  });
  if (r.action !== "accept" || !r.content) return null;
  const { user, password, remember } = r.content as Record<string, unknown>;
  if (typeof user !== "string" || typeof password !== "string") return null;
  return { user, password, remember: remember === true };
}

/** Reihenfolge: übergebene Daten → gespeicherte Daten → Umgebungsvariablen → Dialog. */
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
  if (opts.user && opts.password) {
    creds = { user: opts.user, password: opts.password };
    source = "eingegeben";
  } else if ((creds = await loadCredentials())) {
    source = "gespeichert";
    remember = false;
  } else if (process.env.EASYBASAR_USER && process.env.EASYBASAR_PASSWORD) {
    creds = { user: process.env.EASYBASAR_USER, password: process.env.EASYBASAR_PASSWORD };
    source = "Umgebungsvariablen";
  } else if (opts.interactive !== false) {
    const asked = await askUser();
    if (asked) {
      creds = asked;
      remember = asked.remember || remember;
      source = "Dialog";
    }
  }
  if (!creds) throw new NeedsLogin();
  const response = await api.login(creds.user, creds.password, opts.force_logout ?? false);
  basare.reset();
  if (remember) await saveCredentials(creds);
  return { response, status: { user: creds.user, source, saved: remember } };
}

/** Führt fn aus; loggt vorher ggf. ein und bei Session-Fehler (z. B. Nr. 110) einmal neu. */
async function withSession<T>(fn: () => Promise<T>, autoLogin: boolean): Promise<T> {
  if (autoLogin && !api.isLoggedIn) await doLogin({});
  try {
    return await fn();
  } catch (e) {
    if (autoLogin && isSessionError(e)) {
      await api.relogin();
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
        [render(response), `Eingeloggt als ${status.user}` + (status.saved ? " (Zugangsdaten gespeichert)" : "")]
          .filter((t) => t !== "OK")
          .join("\n\n"),
      );
    } catch (e) {
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
      savedCredentials: (await loadCredentials())?.user ?? null,
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
      const list = await withSession(() => basare.load(), true);
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
      const b = await withSession(() => basare.select(id), true);
      return ok({ ausgewaehlt: summarize(b) });
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
      const res = await withSession(
        () => api.request("item_tool", "POST", itemToolData(r.normalisiert!)),
        true,
      );
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
