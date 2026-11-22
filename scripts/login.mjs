// Login im Terminal: fragt E-Mail und Passwort ab, prüft sie bei easybasar und speichert sie
// für den MCP-Server (~/.config/easybasar-mcp/credentials.json). Das Passwort geht nicht durch Claude.
import readline from "node:readline";
import { ApiGeneralRequest } from "../dist/client.js";
import { credentialsFile, saveCredentials } from "../dist/credentials.js";

function ask(question, hidden = false) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (hidden) {
      rl._writeToOutput = (s) => {
        if (s.startsWith(question)) rl.output.write(question);
        else if (s.includes("\n") || s.includes("\r")) rl.output.write("\n");
        else rl.output.write("*".repeat(s.length));
      };
    }
    rl.question(question, (a) => { rl.close(); resolve(a.trim()); });
  });
}

const user = await ask("easybasar E-Mail-Adresse: ");
const password = await ask("Passwort: ", true);
if (!user || !password) { console.error("Abgebrochen."); process.exit(1); }
try {
  await new ApiGeneralRequest().login(user, password);
} catch (e) {
  console.error(`Login fehlgeschlagen:\n${e.message}`);
  process.exit(1);
}
await saveCredentials({ user, password });
console.log(`Login ok – gespeichert in ${credentialsFile}`);
console.log("In Claude Code meldet sich /easybasar jetzt automatisch an.");
