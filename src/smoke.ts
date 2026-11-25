// Prueba de humo ("smoke test"): ejercita la capa de API contra la API oficial
// REAL y muestra los resultados. No arranca el servidor MCP; solo comprueba que
// la lógica de datos funciona. Ejecutar con: bun run src/smoke.ts

import {
  getProvincias,
  resolverProvinciaId,
  resolverCombustible,
  buscarMasBaratas,
  buscarCercanas,
  getEstacion,
} from "./api.js";

function titulo(t: string) {
  console.log(`\n=== ${t} ===`);
}

const main = async () => {
  titulo("Provincias (muestra)");
  const provincias = await getProvincias();
  console.log(`Total: ${provincias.length}. Primeras 3:`, provincias.slice(0, 3));

  titulo("Resolver 'Madrid' -> ID");
  console.log(await resolverProvinciaId("Madrid"));

  titulo("Resolver combustible 'diesel'");
  console.log(resolverCombustible("diesel"));

  titulo("5 más baratas de diésel en Madrid");
  const baratas = await buscarMasBaratas({
    provincia: "Madrid",
    combustible: "diesel",
    limite: 5,
  });
  console.log(`Combustible: ${baratas.combustible}`);
  for (const e of baratas.estaciones) {
    console.log(`  ${e.precio?.toFixed(3)} €/L — ${e.rotulo}, ${e.municipio} (ID ${e.id})`);
  }

  titulo("Gasolina 95 cerca de Puerta del Sol (radio 5 km), acotado a Madrid");
  const cerca = await buscarCercanas({
    lat: 40.4168,
    lon: -3.7038,
    combustible: "gasolina95",
    radioKm: 5,
    limite: 5,
    provincia: "Madrid",
  });
  for (const e of cerca.estaciones) {
    console.log(
      `  ${e.precio?.toFixed(3)} €/L — ${e.rotulo}, a ${e.distanciaKm?.toFixed(2)} km (ID ${e.id})`,
    );
  }

  titulo("Detalle de la primera estación encontrada");
  const idEjemplo = baratas.estaciones[0]?.id;
  if (idEjemplo) {
    const detalle = await getEstacion(idEjemplo, "Madrid");
    console.log(detalle?.estacion["Rótulo"], "->", detalle?.precios);
  }

  console.log("\n✅ Smoke test completado sin errores.");
};

main().catch((e) => {
  console.error("\n❌ Smoke test falló:", e);
  process.exit(1);
});
