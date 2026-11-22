#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { ApiGeneralRequest, EasybasarError } from "./client.js";
import { BASES, BaseName } from "./config.js";

const api = new ApiGeneralRequest(
  process.env.EASYBASAR_USER,
  process.env.EASYBASAR_PASSWORD,
);
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

/** Führt fn aus; bei einem Session-Fehler (response = "login") einmal neu einloggen. */
async function withSession<T>(fn: () => Promise<T>, autoLogin: boolean): Promise<T> {
  if (autoLogin) await api.ensureLogin();
  try {
    return await fn();
  } catch (e) {
    if (autoLogin && e instanceof EasybasarError && e.body.response === "login") {
      await api.login();
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
      "Meldet den Verkäufer per app_login an (Zugangsdaten aus EASYBASAR_USER/EASYBASAR_PASSWORD). " +
      "force_logout=true beendet eine bestehende Sitzung auf einem anderen Gerät.",
    inputSchema: { force_logout: z.boolean().default(false) },
  },
  async ({ force_logout }) => {
    try {
      return ok(await api.login(force_logout));
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
      userConfigured: Boolean(process.env.EASYBASAR_USER),
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
