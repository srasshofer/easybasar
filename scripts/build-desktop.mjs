// Baut für die Claude-Desktop-App:
//   release/easybasar-<version>.mcpb        (Erweiterung: MCP-Server inkl. node_modules)
//   release/easybasar-skill-<version>.zip   (Skill „easybasar“ zum Hochladen unter Anpassen → Skills)
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
const release = path.join(root, "release");
mkdirSync(release, { recursive: true });
const tmp = mkdtempSync(path.join(os.tmpdir(), "eb-desktop-"));
const run = (cmd, args, cwd) => execFileSync(cmd, args, { cwd, stdio: ["ignore", "pipe", "inherit"] }).toString();

// Tool-Liste direkt vom Server holen, damit das Manifest nie veraltet.
const client = new Client({ name: "build", version: "0" });
await client.connect(new StdioClientTransport({ command: process.execPath, args: [path.join(root, "dist/index.js")] }));
const { tools } = await client.listTools();
await client.close();

// ---- Erweiterung (.mcpb) ----
const ext = path.join(tmp, "ext");
mkdirSync(ext);
cpSync(path.join(root, "dist"), path.join(ext, "dist"), { recursive: true });
for (const f of ["package.json", "package-lock.json", "README.md"]) cpSync(path.join(root, f), path.join(ext, f));
run("npm", ["ci", "--omit=dev", "--no-audit", "--no-fund", "--loglevel=error", "--update-notifier=false"], ext);

const manifest = {
  manifest_version: "0.3",
  name: "easybasar",
  display_name: "easybasar (Verkäufer)",
  version: pkg.version,
  description: "Als Verkäufer bei easybasar.de: Basar wählen, Artikel erfassen, bearbeiten, löschen und Artikellisten ansehen.",
  long_description:
    "Verbindet Claude mit deinem easybasar-Verkäuferkonto. Trage in den Einstellungen dieser Erweiterung " +
    "deine E-Mail-Adresse oder deinen Benutzernamen und dein Passwort ein. Das Passwort wird von Claude " +
    "sicher gespeichert und nur an easybasar.de gesendet.",
  author: { name: "easybasar" },
  homepage: "https://www.easybasar.de",
  support: "https://www.easybasar.de/support/faq",
  server: {
    type: "node",
    entry_point: "dist/index.js",
    mcp_config: {
      command: "node",
      args: ["${__dirname}/dist/index.js"],
      env: {
        EASYBASAR_HOST: "desktop",
        EASYBASAR_USER: "${user_config.user}",
        EASYBASAR_PASSWORD: "${user_config.password}",
        EASYBASAR_DOWNLOAD_DIR: "${DOWNLOADS}/easybasar",
      },
    },
  },
  user_config: {
    user: {
      type: "string",
      title: "E-Mail-Adresse oder Benutzername",
      description: "Dein Login bei easybasar.de",
      required: true,
    },
    password: {
      type: "string",
      title: "Passwort",
      description: "Wird sicher gespeichert und nur an easybasar.de gesendet",
      sensitive: true,
      required: true,
    },
  },
  tools: tools.map((t) => ({ name: t.name, description: (t.description ?? "").slice(0, 200) })),
  keywords: ["easybasar", "basar", "flohmarkt", "verkäufer"],
  compatibility: { platforms: ["darwin", "win32"], runtimes: { node: ">=20.0.0" } },
};
writeFileSync(path.join(ext, "manifest.json"), JSON.stringify(manifest, null, 2));
const mcpb = path.join(release, `easybasar-${pkg.version}.mcpb`);
rmSync(mcpb, { force: true });
run("npx", ["--no-install", "mcpb", "validate", path.join(ext, "manifest.json")], root);
run("npx", ["--no-install", "mcpb", "pack", ext, mcpb], root);

// ---- Skill (.zip mit Ordner easybasar/ und SKILL.md) ----
// Quelle ist der Claude-Code-Befehl: Frontmatter und $ARGUMENTS-Zeile werden ersetzt.
const cmd = readFileSync(path.join(root, ".claude/commands/easybasar.md"), "utf8")
  .replace(/^---[\s\S]*?---\s*/, "")
  .replace(/\n*Aufgabe des Nutzers: \$ARGUMENTS\s*$/, "\n");
const description =
  "Verkäufer bei easybasar.de: Basar wählen, Artikel erfassen, bearbeiten, löschen, Artikellisten. Nutzt die Erweiterung easybasar.";
if (description.length > 200) throw new Error("Skill-Beschreibung > 200 Zeichen");
const skillDir = path.join(tmp, "skill", "easybasar");
mkdirSync(skillDir, { recursive: true });
writeFileSync(
  path.join(skillDir, "SKILL.md"),
  `---\nname: easybasar\ndescription: ${description}\n---\n\n# easybasar\n\n` +
    "Voraussetzung: Die Erweiterung **easybasar** ist installiert und eingeschaltet (stellt die Tools `easybasar_*` bereit). " +
    "Fehlen die Tools, bitte den Nutzer, die Datei `easybasar-<version>.mcpb` per Doppelklick zu installieren.\n\n" +
    cmd,
);
const skillZip = path.join(release, `easybasar-skill-${pkg.version}.zip`);
rmSync(skillZip, { force: true });
run("zip", ["-qr", "-X", skillZip, "easybasar"], path.join(tmp, "skill"));

rmSync(tmp, { recursive: true, force: true });
console.log(path.relative(root, mcpb));
console.log(path.relative(root, skillZip));
