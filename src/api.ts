// Capa de acceso a la API oficial de carburantes del Gobierno de España.
// Este archivo NO sabe nada de MCP: solo pide datos, los limpia y los consulta.
// Así se puede probar por separado (ver src/smoke.ts).

import type {
  RawProvincia,
  RawProducto,
  RawEstacion,
  RawRespuestaEstaciones,
  Estacion,
} from "./types.js";

const BASE =
  "https://sedeaplicaciones.minetur.gob.es/ServiciosRESTCarburantes/PreciosCarburantes";

// ---------------------------------------------------------------------------
// Utilidades de limpieza de datos
// ---------------------------------------------------------------------------

/** Convierte "1,449" -> 1.449. Devuelve null si viene vacío o no es número. */
export function parseNum(valor: string | undefined): number | null {
  if (!valor || valor.trim() === "") return null;
  const n = Number(valor.replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

/** Quita acentos y pasa a minúsculas, para comparar nombres sin sufrir con tildes. */
function normalizar(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

/** Distancia en km entre dos coordenadas (fórmula de Haversine). */
export function distanciaKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const R = 6371; // radio de la Tierra en km
  const rad = (g: number) => (g * Math.PI) / 180;
  const dLat = rad(lat2 - lat1);
  const dLon = rad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ---------------------------------------------------------------------------
// Tipos de combustible: traducimos lo que diga el usuario al campo real de la API
// ---------------------------------------------------------------------------

interface Combustible {
  clave: string;
  etiqueta: string;
  campo: string; // nombre exacto del campo "Precio ..." en la estación
  alias: string[];
}

const COMBUSTIBLES: Combustible[] = [
  {
    clave: "gasolina95",
    etiqueta: "Gasolina 95 E5",
    campo: "Precio Gasolina 95 E5",
    alias: ["gasolina95", "gasolina 95", "95", "g95", "sin plomo 95", "sp95"],
  },
  {
    clave: "gasolina98",
    etiqueta: "Gasolina 98 E5",
    campo: "Precio Gasolina 98 E5",
    alias: ["gasolina98", "gasolina 98", "98", "g98", "sp98"],
  },
  {
    clave: "diesel",
    etiqueta: "Gasóleo A (diésel)",
    campo: "Precio Gasoleo A",
    alias: ["diesel", "diésel", "gasoleo", "gasóleo", "gasoleo a", "gasoil", "gasolina diesel"],
  },
  {
    clave: "diesel_premium",
    etiqueta: "Gasóleo Premium",
    campo: "Precio Gasoleo Premium",
    alias: ["diesel premium", "diésel premium", "gasoleo premium", "gasóleo premium"],
  },
  {
    clave: "glp",
    etiqueta: "GLP (gases licuados del petróleo)",
    campo: "Precio Gases licuados del petróleo",
    alias: ["glp", "gas licuado", "autogas", "gases licuados del petroleo"],
  },
];

/** Encuentra el combustible a partir del texto del usuario, o lanza un error claro. */
export function resolverCombustible(entrada: string): Combustible {
  const e = normalizar(entrada);
  const encontrado = COMBUSTIBLES.find(
    (c) => c.clave === e || c.alias.some((a) => normalizar(a) === e),
  );
  if (!encontrado) {
    const opciones = COMBUSTIBLES.map((c) => c.clave).join(", ");
    throw new Error(
      `Combustible no reconocido: "${entrada}". Opciones válidas: ${opciones}.`,
    );
  }
  return encontrado;
}

export function listarCombustibles(): { clave: string; etiqueta: string }[] {
  return COMBUSTIBLES.map((c) => ({ clave: c.clave, etiqueta: c.etiqueta }));
}

// ---------------------------------------------------------------------------
// Peticiones HTTP a la API (con timeout y caché sencilla)
// ---------------------------------------------------------------------------

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Pide JSON a la API con timeout y reintentos. Las APIs públicas fallan de forma
 * transitoria (conexión caída, TLS lento), así que reintentamos con una espera
 * creciente (backoff) antes de darnos por vencidos.
 */
async function pedirJson<T>(url: string, timeoutMs = 30_000, reintentos = 2): Promise<T> {
  let ultimoError: unknown;
  for (let intento = 0; intento <= reintentos; intento++) {
    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        headers: { Accept: "application/json" },
        signal: ctrl.signal,
      });
      if (!res.ok) {
        throw new Error(`La API respondió ${res.status} ${res.statusText}`);
      }
      return (await res.json()) as T;
    } catch (e) {
      ultimoError = e;
      if (intento < reintentos) await esperar(400 * (intento + 1)); // 400ms, 800ms
    } finally {
      clearTimeout(timeout);
    }
  }
  const motivo = ultimoError instanceof Error ? ultimoError.message : String(ultimoError);
  throw new Error(`No se pudo contactar con la API tras ${reintentos + 1} intentos: ${motivo}`);
}

// Caché en memoria: la lista de estaciones cambia poco (precios diarios), así
// que guardamos la respuesta unos minutos para no martillear la API en cada tool.
const CACHE_MS = 10 * 60 * 1000;
const cacheEstaciones = new Map<string, { ts: number; datos: RawEstacion[] }>();

export async function getProvincias(): Promise<
  { id: string; nombre: string; ccaa: string }[]
> {
  const raw = await pedirJson<RawProvincia[]>(`${BASE}/Listados/Provincias/`);
  return raw
    .map((p) => ({ id: p.IDPovincia, nombre: p.Provincia, ccaa: p.CCAA }))
    .sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
}

export async function getProductos(): Promise<RawProducto[]> {
  return pedirJson<RawProducto[]>(`${BASE}/Listados/ProductosPetroliferos/`);
}

/** Resuelve "Madrid" o "28" a un ID de provincia de 2 dígitos. */
export async function resolverProvinciaId(entrada: string): Promise<string> {
  const e = entrada.trim();
  if (/^\d{1,2}$/.test(e)) return e.padStart(2, "0");
  const provincias = await getProvincias();
  const match = provincias.find((p) => normalizar(p.nombre) === normalizar(e));
  if (!match) {
    throw new Error(
      `Provincia no reconocida: "${entrada}". Usa el nombre (p.ej. "Madrid") o su ID de 2 dígitos.`,
    );
  }
  return match.id;
}

/** Trae las estaciones en crudo. Con provinciaId filtra por provincia; sin él, toda España. */
async function getEstacionesRaw(provinciaId?: string): Promise<RawEstacion[]> {
  const clave = provinciaId ?? "ALL";
  const enCache = cacheEstaciones.get(clave);
  if (enCache && Date.now() - enCache.ts < CACHE_MS) return enCache.datos;

  const url = provinciaId
    ? `${BASE}/EstacionesTerrestres/FiltroProvincia/${provinciaId}`
    : `${BASE}/EstacionesTerrestres/`;
  // Toda España son 11.000+ estaciones (varios MB): le damos más margen de tiempo.
  const resp = await pedirJson<RawRespuestaEstaciones>(url, provinciaId ? 30_000 : 60_000);
  const datos = resp.ListaEESSPrecio ?? [];
  cacheEstaciones.set(clave, { ts: Date.now(), datos });
  return datos;
}

/** Pasa una estación cruda a nuestra forma limpia, calculando el precio del combustible pedido. */
function normalizarEstacion(raw: RawEstacion, campoPrecio: string): Estacion {
  return {
    id: raw.IDEESS,
    rotulo: raw["Rótulo"],
    direccion: raw["Dirección"],
    municipio: raw.Municipio,
    localidad: raw.Localidad,
    provincia: raw.Provincia,
    cp: raw["C.P."],
    horario: raw.Horario,
    lat: parseNum(raw.Latitud),
    lon: parseNum(raw["Longitud (WGS84)"]),
    precio: parseNum(raw[campoPrecio]),
  };
}

// ---------------------------------------------------------------------------
// Consultas de alto nivel (lo que usarán las herramientas MCP)
// ---------------------------------------------------------------------------

/** Las N estaciones más baratas de una provincia (y opcionalmente un municipio) para un combustible. */
export async function buscarMasBaratas(opts: {
  provincia: string;
  combustible: string;
  municipio?: string;
  limite?: number;
}): Promise<{ combustible: string; estaciones: Estacion[] }> {
  const comb = resolverCombustible(opts.combustible);
  const provinciaId = await resolverProvinciaId(opts.provincia);
  const raw = await getEstacionesRaw(provinciaId);

  let estaciones = raw
    .map((r) => normalizarEstacion(r, comb.campo))
    .filter((e) => e.precio !== null);

  if (opts.municipio) {
    const m = normalizar(opts.municipio);
    estaciones = estaciones.filter((e) => normalizar(e.municipio).includes(m));
  }

  estaciones.sort((a, b) => (a.precio! - b.precio!));
  return {
    combustible: comb.etiqueta,
    estaciones: estaciones.slice(0, opts.limite ?? 10),
  };
}

/** Estaciones más baratas dentro de un radio alrededor de unas coordenadas. */
export async function buscarCercanas(opts: {
  lat: number;
  lon: number;
  combustible: string;
  radioKm?: number;
  limite?: number;
  provincia?: string;
}): Promise<{ combustible: string; estaciones: Estacion[] }> {
  const comb = resolverCombustible(opts.combustible);
  const provinciaId = opts.provincia
    ? await resolverProvinciaId(opts.provincia)
    : undefined;
  const raw = await getEstacionesRaw(provinciaId);
  const radio = opts.radioKm ?? 10;

  const estaciones = raw
    .map((r) => normalizarEstacion(r, comb.campo))
    .filter((e) => e.precio !== null && e.lat !== null && e.lon !== null)
    .map((e) => ({
      ...e,
      distanciaKm: distanciaKm(opts.lat, opts.lon, e.lat!, e.lon!),
    }))
    .filter((e) => e.distanciaKm! <= radio)
    .sort((a, b) => a.precio! - b.precio!);

  return {
    combustible: comb.etiqueta,
    estaciones: estaciones.slice(0, opts.limite ?? 10),
  };
}

/**
 * Detalle completo de una estación por su ID (IDEESS), con todos los precios.
 * Para ir rápido: 1) mira en lo que ya esté en caché; 2) si pasan provincia,
 * acota a ella; 3) como último recurso, toda España (más lento).
 */
export async function getEstacion(
  id: string,
  provincia?: string,
): Promise<{
  estacion: RawEstacion;
  precios: { combustible: string; precio: number }[];
} | null> {
  let est: RawEstacion | undefined;

  // 1) ¿la tenemos ya de una búsqueda anterior?
  for (const { datos } of cacheEstaciones.values()) {
    est = datos.find((e) => e.IDEESS === id);
    if (est) break;
  }

  // 2) y si no, pedimos (acotando a provincia si nos la dan)
  if (!est) {
    const provinciaId = provincia ? await resolverProvinciaId(provincia) : undefined;
    const raw = await getEstacionesRaw(provinciaId);
    est = raw.find((e) => e.IDEESS === id);
  }

  if (!est) return null;
  const precios = COMBUSTIBLES.map((c) => ({
    combustible: c.etiqueta,
    precio: parseNum(est[c.campo]),
  })).filter((p): p is { combustible: string; precio: number } => p.precio !== null);
  return { estacion: est, precios };
}
