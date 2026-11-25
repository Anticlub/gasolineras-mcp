// Servidor MCP: expone la API de carburantes como "herramientas" que un agente
// (Claude, por ejemplo) puede invocar. Este archivo solo conecta: la lógica
// de datos vive en api.ts.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import type { Estacion } from "./types.js";
import {
  listarCombustibles,
  getProvincias,
  buscarMasBaratas,
  buscarCercanas,
  getEstacion,
} from "./api.js";

const server = new McpServer({
  name: "gasolineras-mcp",
  version: "1.0.0",
});

// Un formato de texto legible para que el modelo (y un humano) lo entiendan bien.
function formatearEstaciones(estaciones: Estacion[]): string {
  if (estaciones.length === 0) {
    return "No se han encontrado estaciones con esos criterios.";
  }
  return estaciones
    .map((e, i) => {
      const dist =
        e.distanciaKm !== undefined ? ` · a ${e.distanciaKm.toFixed(1)} km` : "";
      return (
        `${i + 1}. ${e.rotulo} — ${e.precio?.toFixed(3)} €/L${dist}\n` +
        `   ${e.direccion}, ${e.municipio} (${e.provincia})\n` +
        `   Horario: ${e.horario} · ID: ${e.id}`
      );
    })
    .join("\n");
}

// Pequeño envoltorio: ejecuta la lógica y, si algo falla, devuelve un error
// legible en vez de reventar la conexión del agente.
function texto(contenido: string) {
  return { content: [{ type: "text" as const, text: contenido }] };
}
function error(mensaje: string) {
  return { content: [{ type: "text" as const, text: `Error: ${mensaje}` }], isError: true };
}

// ---------------------------------------------------------------------------
// Herramienta 1: listar tipos de combustible admitidos
// ---------------------------------------------------------------------------
server.registerTool(
  "list_fuel_types",
  {
    title: "Listar tipos de combustible",
    description:
      "Devuelve los tipos de combustible admitidos por el servidor (gasolina95, gasolina98, diesel, diesel_premium, glp). Útil antes de llamar a otras herramientas que piden un combustible.",
    inputSchema: {},
  },
  async () => {
    const lista = listarCombustibles();
    const texto_ = lista.map((c) => `- ${c.clave}: ${c.etiqueta}`).join("\n");
    return texto(`Tipos de combustible disponibles:\n${texto_}`);
  },
);

// ---------------------------------------------------------------------------
// Herramienta 2: listar provincias (con sus IDs)
// ---------------------------------------------------------------------------
server.registerTool(
  "list_provinces",
  {
    title: "Listar provincias",
    description:
      "Devuelve las 52 provincias españolas con su ID. Útil para saber qué nombre/ID pasar a las búsquedas.",
    inputSchema: {},
  },
  async () => {
    try {
      const provincias = await getProvincias();
      const texto_ = provincias.map((p) => `${p.id} — ${p.nombre} (${p.ccaa})`).join("\n");
      return texto(texto_);
    } catch (e) {
      return error(e instanceof Error ? e.message : String(e));
    }
  },
);

// ---------------------------------------------------------------------------
// Herramienta 3: estaciones más baratas de una provincia / municipio
// ---------------------------------------------------------------------------
server.registerTool(
  "find_cheapest_stations",
  {
    title: "Gasolineras más baratas por zona",
    description:
      "Devuelve las gasolineras más baratas de una provincia (y opcionalmente un municipio) para un combustible dado, ordenadas de más barata a más cara.",
    inputSchema: {
      province: z
        .string()
        .describe('Provincia por nombre ("Madrid") o ID de 2 dígitos ("28").'),
      fuel: z
        .string()
        .describe("Tipo de combustible: gasolina95, gasolina98, diesel, diesel_premium o glp."),
      municipality: z
        .string()
        .optional()
        .describe('Opcional. Filtra por municipio (p.ej. "Alcalá de Henares").'),
      limit: z
        .number()
        .int()
        .min(1)
        .max(50)
        .optional()
        .describe("Cuántas estaciones devolver (por defecto 10)."),
    },
  },
  async ({ province, fuel, municipality, limit }) => {
    try {
      const { combustible, estaciones } = await buscarMasBaratas({
        provincia: province,
        combustible: fuel,
        municipio: municipality,
        limite: limit,
      });
      return texto(
        `Más baratas para ${combustible} en ${province}` +
          (municipality ? ` (${municipality})` : "") +
          `:\n\n${formatearEstaciones(estaciones)}`,
      );
    } catch (e) {
      return error(e instanceof Error ? e.message : String(e));
    }
  },
);

// ---------------------------------------------------------------------------
// Herramienta 4: estaciones baratas cerca de unas coordenadas
// ---------------------------------------------------------------------------
server.registerTool(
  "find_nearest_stations",
  {
    title: "Gasolineras baratas cerca de un punto",
    description:
      "Dadas unas coordenadas (latitud/longitud), devuelve las gasolineras dentro de un radio, ordenadas por precio del combustible indicado. Incluye la distancia en km.",
    inputSchema: {
      latitude: z.number().describe("Latitud en grados decimales (p.ej. 40.4168)."),
      longitude: z.number().describe("Longitud en grados decimales (p.ej. -3.7038)."),
      fuel: z
        .string()
        .describe("Tipo de combustible: gasolina95, gasolina98, diesel, diesel_premium o glp."),
      radius_km: z
        .number()
        .positive()
        .max(100)
        .optional()
        .describe("Radio de búsqueda en km (por defecto 10)."),
      limit: z.number().int().min(1).max(50).optional().describe("Cuántas devolver (por defecto 10)."),
      province: z
        .string()
        .optional()
        .describe("Opcional pero recomendado: acota la búsqueda a una provincia y la hace más rápida."),
    },
  },
  async ({ latitude, longitude, fuel, radius_km, limit, province }) => {
    try {
      const { combustible, estaciones } = await buscarCercanas({
        lat: latitude,
        lon: longitude,
        combustible: fuel,
        radioKm: radius_km,
        limite: limit,
        provincia: province,
      });
      return texto(
        `Gasolineras con ${combustible} a menos de ${radius_km ?? 10} km de ` +
          `(${latitude}, ${longitude}):\n\n${formatearEstaciones(estaciones)}`,
      );
    } catch (e) {
      return error(e instanceof Error ? e.message : String(e));
    }
  },
);

// ---------------------------------------------------------------------------
// Herramienta 5: detalle de una estación por ID
// ---------------------------------------------------------------------------
server.registerTool(
  "get_station",
  {
    title: "Detalle de una gasolinera",
    description:
      "Devuelve el detalle de una gasolinera por su ID (IDEESS), con todos los combustibles que vende y sus precios.",
    inputSchema: {
      id: z.string().describe("ID de la estación (IDEESS), tal y como aparece en otras búsquedas."),
      province: z
        .string()
        .optional()
        .describe("Opcional: provincia de la estación, para acotar y responder más rápido."),
    },
  },
  async ({ id, province }) => {
    try {
      const res = await getEstacion(id, province);
      if (!res) return error(`No existe ninguna estación con ID ${id}.`);
      const { estacion, precios } = res;
      const listaPrecios = precios
        .map((p) => `   - ${p.combustible}: ${p.precio.toFixed(3)} €/L`)
        .join("\n");
      return texto(
        `${estacion["Rótulo"]} (ID ${estacion.IDEESS})\n` +
          `${estacion["Dirección"]}, ${estacion.Municipio} (${estacion.Provincia})\n` +
          `Horario: ${estacion.Horario}\n\nPrecios:\n${listaPrecios}`,
      );
    } catch (e) {
      return error(e instanceof Error ? e.message : String(e));
    }
  },
);

// Arrancamos el servidor sobre stdio (así lo lanzan Claude Desktop / Claude Code).
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Importante: los logs van a stderr; stdout está reservado para el protocolo MCP.
  console.error("gasolineras-mcp en marcha (stdio).");
}

main().catch((e) => {
  console.error("Fallo al arrancar gasolineras-mcp:", e);
  process.exit(1);
});
