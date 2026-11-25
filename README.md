# Gasolineras MCP

Servidor **MCP (Model Context Protocol)** en **TypeScript** que conecta un agente de
IA (como Claude) con la **API oficial de precios de carburantes** del Gobierno de
España. Permite que el modelo responda, con datos reales y actualizados a diario, a
preguntas como *"¿dónde está el diésel más barato cerca de mí?"*.

> MCP es el "estándar de enchufe" que usan los asistentes como Claude para llamar a
> herramientas externas. Este servidor publica varias herramientas; el modelo decide
> cuándo usarlas y con qué parámetros, y recibe de vuelta datos reales sobre los que
> razonar. Es un ejemplo pequeño pero completo de *agente + herramientas + fuente de
> datos real*.

## Qué demuestra este proyecto

- Diseño de un **servidor MCP**: definición de herramientas, esquemas de entrada y orquestación.
- **TypeScript** con tipos estrictos y separación de responsabilidades (acceso a datos vs. protocolo).
- Integración con una **API REST** real y su parte "sucia": precios con coma decimal, campos vacíos, nombres largos.
- Decisiones de ingeniería: **caché** en memoria, **reintentos con backoff**, **timeouts** y manejo de errores legible.

## Herramientas que expone

| Herramienta | Qué hace |
|---|---|
| `list_fuel_types` | Lista los combustibles admitidos (gasolina95, gasolina98, diesel, diesel_premium, glp). |
| `list_provinces` | Devuelve las 52 provincias con su ID. |
| `find_cheapest_stations` | Gasolineras más baratas de una provincia/municipio para un combustible. |
| `find_nearest_stations` | Gasolineras baratas dentro de un radio alrededor de unas coordenadas (con distancia en km). |
| `get_station` | Detalle de una estación por su ID, con todos los precios. |

## Requisitos

- [Node.js](https://nodejs.org) 18 o superior.
- (Opcional, para desarrollo) [Bun](https://bun.sh) para ejecutar TypeScript sin compilar.

## Instalación y build

```bash
npm install
npm run build        # compila TypeScript a dist/
```

## Uso con Claude

### Claude Code (CLI)

```bash
claude mcp add gasolineras -- node /ruta/absoluta/gasolineras-mcp/dist/index.js
```

### Claude Desktop

Añade esto a tu `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "gasolineras": {
      "command": "node",
      "args": ["/ruta/absoluta/gasolineras-mcp/dist/index.js"]
    }
  }
}
```

Reinicia Claude y pídele, por ejemplo: *"Busca el gasóleo A más barato en Madrid"* o
*"¿Qué gasolineras con gasolina 95 hay a menos de 5 km de 40.4168, -3.7038?"*.

## Arquitectura

```
src/
  types.ts   # Formas de los datos (crudos de la API y normalizados)
  api.ts     # Acceso a la API: fetch, limpieza, caché, reintentos y consultas
  index.ts   # Servidor MCP: registra las herramientas y las conecta a api.ts
  smoke.ts   # Prueba la capa de datos contra la API real (sin MCP)
test-client.ts  # Cliente MCP de prueba: levanta el servidor y llama a sus herramientas
```

La clave es que `api.ts` **no sabe nada de MCP** (se puede probar solo) e `index.ts`
**no sabe nada de la API** (solo conecta). Esa separación hace cada pieza simple y testeable.

## Pruebas

```bash
npm run smoke         # ejercita api.ts contra la API oficial (con bun)
npm run build && bun run test-client.ts   # prueba el servidor MCP de extremo a extremo
```

## Fuente de datos

API pública del Ministerio para la Transición Ecológica:
`https://sedeaplicaciones.minetur.gob.es/ServiciosRESTCarburantes/PreciosCarburantes/`
Los precios se publican a diario. Este proyecto es de uso personal/educativo y no está
afiliado al Ministerio.

## Licencia

MIT © Cristofer Fernández Fernández — [GitHub](https://github.com/Anticlub) · [LinkedIn](https://linkedin.com/in/cristofer-fdz)
