# Operación básica

## Probes de despliegue

Coolify puede usar estos endpoints sin autenticación:

- `GET /api/health/live`: confirma que el proceso HTTP está activo. Devuelve `200` mientras el proceso responde.
- `GET /api/health/ready`: confirma que la persistencia es escribible y que las migraciones de Postgres están listas. Devuelve `503` mientras el servicio no está preparado.
- `GET /api/health`: mantiene el endpoint histórico y devuelve el detalle de persistencia y migraciones.

Configura el probe de vida con `/api/health/live` y el probe de disponibilidad con `/api/health/ready`. El contenedor no debe recibir tráfico hasta que el segundo responda `200`.

## CI

El workflow `.github/workflows/ci.yml` ejecuta en cada push a `v2` y en cada pull request:

1. `npm ci`
2. `npm test`
3. `npm run ui:check`
4. `npm run build`
5. `docker build --tag escarlet-cms:ci .`

## Superficie pública

`GET /api/sites` solo devuelve datos de descubrimiento de marcas. Las configuraciones operativas, webhooks y credenciales no forman parte de esa respuesta.
