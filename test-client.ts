// Cliente MCP de prueba: hace lo mismo que haría Claude — levanta el servidor,
// lista sus herramientas y llama a una. Ejecutar con: bun run test-client.ts
// (requiere haber hecho antes `npm run build`).

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const transport = new StdioClientTransport({
  command: "node",
  args: ["dist/index.js"],
});

const client = new Client({ name: "test-client", version: "1.0.0" });

await client.connect(transport);

console.log("=== Herramientas que expone el servidor ===");
const { tools } = await client.listTools();
for (const t of tools) console.log(`- ${t.name}: ${t.description?.slice(0, 70)}...`);

console.log("\n=== Llamada: find_cheapest_stations (diésel, Madrid, 3) ===");
const r1 = await client.callTool({
  name: "find_cheapest_stations",
  arguments: { province: "Madrid", fuel: "diesel", limit: 3 },
});
console.log((r1.content as { text: string }[])[0].text);

console.log("\n=== Llamada: find_nearest_stations (gasolina95 cerca de Sol) ===");
const r2 = await client.callTool({
  name: "find_nearest_stations",
  arguments: { latitude: 40.4168, longitude: -3.7038, fuel: "gasolina95", radius_km: 3, limit: 3, province: "Madrid" },
});
console.log((r2.content as { text: string }[])[0].text);

await client.close();
console.log("\n✅ El servidor MCP responde correctamente.");
