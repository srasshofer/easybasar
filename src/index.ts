#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { ApiGeneralRequest, EasybasarError } from "./client.js";
import { BASES, BaseName } from "./config.js";
import {
  Credentials,
  credentialsFile,
  deleteCredentials,
  loadCredentials,
  saveCredentials,
} from "./credentials.js";

const api = new ApiGeneralRequest();
const downloadDir = path.resolve(process.env.EASYBASAR_DOWNLOAD_DIR ?? "downloads");

const server = new McpServer({ name: "easybasar", version: "0.1.0" });

const ok = (data: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
});
const fail = (e: unknown) => ({
  isError: true,
  content: [
    {
      type: "text" as const,
      text:
        e instanceof EasybasarError
          ? JSON.stringify({ error: e.body }, null, 2)
          : String(e instanceof Error ? e.message : e),
    },
  ],
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
  if (remember) await saveCredentials(creds);
  return {
    loggedIn: true,
    user: creds.user,
    source,
    saved: remember,
    sessionCookies: api.cookieNames,
    response,
  };
}

/** Führt fn aus; loggt vorher ggf. ein und bei Session-Fehler (response = "login") einmal neu. */
async function withSession<T>(fn: () => Promise<T>, autoLogin: boolean): Promise<T> {
  if (autoLogin && !api.isLoggedIn) await doLogin({});
  try {
    return await fn();
  } catch (e) {
    if (autoLogin && e instanceof EasybasarError && e.body.response === "login") {
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
      return ok(await doLogin(args));
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
      sessionCookies: api.cookieNames,
      savedCredentials: (await loadCredentials())?.user ?? null,
      credentialsFile,
      lastLogin: api.lastLogin,
      bases: BASES,
    }),
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
