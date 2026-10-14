# Destinos de publicación

## Modelo

```text
Canal → Destino → Proveedor → Operación → PublicationRun
```

Un destino representa la cuenta, blog o instalación concreta del cliente. El proveedor es un detalle de implementación.

## Proveedores iniciales

- Buffer: Instagram, Instagram Story, LinkedIn y X.
- Coolify: webhook de despliegue de blog.
- WordPress: REST API de blog.

Cada destino debe validar credenciales, capacidades, canal, estado remoto y reintentos. La aplicación conserva estado interno y estado del proveedor por separado.
