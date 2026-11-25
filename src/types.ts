// Formas de los datos. En TypeScript describimos la "pinta" que tienen los
// objetos; así el compilador nos avisa si leemos un campo que no existe.

/** Una provincia tal y como la devuelve el listado oficial (ojo: "IDPovincia" es un typo de la propia API). */
export interface RawProvincia {
  IDPovincia: string;
  Provincia: string;
  CCAA: string;
}

/** Un producto petrolífero (tipo de combustible) del listado oficial. */
export interface RawProducto {
  IDProducto: string;
  NombreProducto: string;
  NombreProductoAbreviatura: string;
}

/**
 * Una estación tal y como llega de la API: todos los precios son strings con
 * coma decimal (o "" si no se vende ese combustible). Dejamos el índice abierto
 * porque hay decenas de campos "Precio ..." que no vamos a tipar uno a uno.
 */
export interface RawEstacion {
  IDEESS: string;
  "Rótulo": string;
  "Dirección": string;
  Municipio: string;
  Localidad: string;
  Provincia: string;
  "C.P.": string;
  Horario: string;
  Latitud: string;
  "Longitud (WGS84)": string;
  [campo: string]: string;
}

/** Respuesta del endpoint de estaciones: fecha + lista. */
export interface RawRespuestaEstaciones {
  Fecha: string;
  ListaEESSPrecio: RawEstacion[];
}

/** Estación ya normalizada y lista para usar (números de verdad, nombres cortos). */
export interface Estacion {
  id: string;
  rotulo: string;
  direccion: string;
  municipio: string;
  localidad: string;
  provincia: string;
  cp: string;
  horario: string;
  lat: number | null;
  lon: number | null;
  /** Precio del combustible consultado, en €/litro. null si no lo vende. */
  precio: number | null;
  /** Distancia en km al punto consultado (solo lo rellena la búsqueda por cercanía). */
  distanciaKm?: number;
}
