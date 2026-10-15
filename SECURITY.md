# Seguridad

## Alcance

Este repositorio publica el CMS, el contrato MCP v3, las plantillas y la skill
portable para clientes MCP. Los datos de producción, tokens, credenciales de
proveedores y archivos persistentes deben vivir fuera del repositorio.

## Reglas de despliegue

- Usa HTTPS para `/app`, `/api` y `/mcp/v3`.
- Define un `ADMIN_TOKEN` largo y aleatorio. Nunca lo uses en un cliente MCP.
- Usa OAuth o PAT personales (`user_...`) para Hermes, Cursor, Claude y otros
  clientes. El acceso efectivo se limita a las membresías del usuario.
- Define `CMS_SECRET_KEY` y `DATABASE_URL` en el gestor de secretos del entorno.
- Mantén Postgres en una red privada. El Compose local solo publica su puerto en
  loopback.
- No actives `CMS_AI_ENABLED` ni proveedores externos sin revisar sus secretos y
  permisos. La configuración segura por defecto deja la generación fuera del CMS.
- Revisa la aprobación humana antes de `publication.schedule` o
  `publication.publish`.

## Qué no debe entrar en un commit

No subas `.env`, `data/db.json`, `data/media/`, tokens PAT, API keys, secretos de
Coolify, credenciales de WordPress, exportaciones de Postgres ni logs con
cabeceras `Authorization`. El `.gitignore` protege los directorios de datos y el
marcador local de persistencia.

## Dependencias

La auditoría actual no muestra vulnerabilidades altas o críticas. `npm audit`
todavía informa una vulnerabilidad moderada transitoria en `file-type`, usada por
Jimp 0.22. El CMS valida la firma y la integridad de cada imagen y rechaza los
formatos no admitidos antes de invocar Jimp, incluido el parser ASF afectado. La
actualización a Jimp 1.x queda pendiente de una migración de API separada.

## Reportar una vulnerabilidad

No abras un issue público con credenciales, payloads de explotación o datos de
usuarios. Usa la pestaña **Security** de GitHub para enviar un aviso privado. Si
esa opción no está habilitada en el mirror que estés usando, contacta en privado
con los mantenedores antes de publicar los detalles.

Incluye versión o commit, pasos mínimos para reproducir, impacto observado y
una propuesta de mitigación si la tienes. No incluyas secretos reales.
