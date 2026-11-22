import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

/** Login-Daten für einen Aufruf (das Passwort wird nie gespeichert). */
export interface Credentials {
  user: string;
  password: string;
}

/** Gespeichert wird nur der JWT. password nur noch in Altdateien (wird beim nächsten Login entfernt). */
export interface Saved {
  user: string;
  jwt?: string;
  password?: string;
}

/** Speicherort: $EASYBASAR_CONFIG_DIR oder ~/.config/easybasar-mcp/credentials.json (Rechte 0600). */
export const credentialsFile = path.join(
  process.env.EASYBASAR_CONFIG_DIR ??
    path.join(process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), ".config"), "easybasar-mcp"),
  "credentials.json",
);

export async function loadCredentials(): Promise<Saved | null> {
  try {
    const c = JSON.parse(await readFile(credentialsFile, "utf8"));
    if (typeof c?.user !== "string") return null;
    const s: Saved = { user: c.user };
    if (typeof c.jwt === "string" && c.jwt) s.jwt = c.jwt;
    if (typeof c.password === "string" && c.password) s.password = c.password;
    return s.jwt || s.password ? s : null;
  } catch {
    return null;
  }
}

/** Speichert E-Mail und JWT (nie das Passwort). */
export async function saveCredentials(user: string, jwt: string): Promise<void> {
  await mkdir(path.dirname(credentialsFile), { recursive: true, mode: 0o700 });
  await writeFile(credentialsFile, JSON.stringify({ user, jwt }), { mode: 0o600 });
  await chmod(credentialsFile, 0o600);
}

export async function deleteCredentials(): Promise<boolean> {
  try {
    await rm(credentialsFile);
    return true;
  } catch {
    return false;
  }
}

/** Ersatzschreibweisen für @ zulassen: "name(at)web.de", "name [at] web.de", "name#web.de". */
export function normalizeEmail(s: string): string {
  const t = s.trim();
  if (t.includes("@")) return t;
  return t.replace(/\s*[([{]\s*at\s*[)\]}]\s*|\s+at\s+|#/i, "@");
}
