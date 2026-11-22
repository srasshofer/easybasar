import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export interface Credentials {
  user: string;
  password: string;
}

/** Speicherort: $EASYBASAR_CONFIG_DIR oder ~/.config/easybasar-mcp/credentials.json (Rechte 0600). */
export const credentialsFile = path.join(
  process.env.EASYBASAR_CONFIG_DIR ??
    path.join(process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), ".config"), "easybasar-mcp"),
  "credentials.json",
);

export async function loadCredentials(): Promise<Credentials | null> {
  try {
    const c = JSON.parse(await readFile(credentialsFile, "utf8"));
    return typeof c?.user === "string" && typeof c?.password === "string" ? c : null;
  } catch {
    return null;
  }
}

export async function saveCredentials(c: Credentials): Promise<void> {
  await mkdir(path.dirname(credentialsFile), { recursive: true, mode: 0o700 });
  await writeFile(credentialsFile, JSON.stringify(c), { mode: 0o600 });
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
