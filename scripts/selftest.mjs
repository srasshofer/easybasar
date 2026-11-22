// Startet den MCP-Server und prüft, dass er seine Tools meldet (ohne easybasar.de aufzurufen).
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
const client = new Client({ name: "selftest", version: "0" });
await client.connect(new StdioClientTransport({ command: process.execPath, args: [process.argv[2]] }));
const { tools } = await client.listTools();
await client.close();
console.log(`  ${tools.length} Tools: ${tools.map((t) => t.name).join(", ")}`);
if (!tools.some((t) => t.name === "easybasar_login")) process.exit(1);
