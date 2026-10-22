# API persistente en Vercel y Neon

Este directorio contiene la entrada y configuración de despliegue, no datos ni credenciales. `scripts/package-api.ps1 -Destination RUTA_ABSOLUTA` crea un paquete nuevo dentro de `.runtime`, con código Python, requisitos, catálogos y política. La base local y los respaldos nunca se empaquetan.

En el proyecto API de Vercel se configuran exclusivamente en el servidor:

- `YOKOHAMA_DATABASE_URL`: conexión PostgreSQL Neon con pooler.
- `YOKOHAMA_API_KEY`: clave privada compartida con el servidor Next.
- `YOKOHAMA_DEPLOYMENT_MODE=cloud`.
- `YOKOHAMA_REQUIRE_AUTH=true`.

No configurar `YOKOHAMA_SETUP_TOKEN`. La cuenta activa `admin.yoko@gmail.com` debe existir antes de publicar. El registro público inicial está deshabilitado. Conductores, asignaciones, hashes de contraseña, historial, pronósticos, evidencias y sesiones se guardan en PostgreSQL; ningún secreto de Neon llega al navegador.

## Migración conservadora

Crear un respaldo SQLite verificado y detener los procesos locales antes del corte. La herramienta acepta únicamente SQLite v8/v9 y un destino PostgreSQL vacío; se configura la URL de destino por `YOKOHAMA_MIGRATION_DATABASE_URL`, nunca como argumento visible:

```powershell
python -m app.migrate_to_postgres --source RUTA_DEL_RESPALDO --revoke-sessions
```

La transferencia valida el esquema, relaciones, secuencias, conteos y digests de cada tabla dentro de una transacción. Preserva IDs, fechas, números, JSON, binarios y hashes. La revocación de sesiones es explícita y ocurre después de comprobar la paridad; conserva sus filas. El archivo SQLite se abre en modo de solo lectura y permanece como respaldo.

`--verify-only` no escribe. Una comparación posterior a nuevas capturas, logins o revocaciones intencionales puede detectar diferencias esperadas: no ejecutar otra importación para corregirlas. Nunca reimportar sobre una base operativa.

Las capturas de la antigua propuesta guardadas solo en el navegador no forman parte de SQLite. No se borra su almacenamiento; deben revisarse/importarse de forma separada si existen. La web operativa deja de utilizar el adaptador de propuesta.

## Comprobación del corte

Publicar la API y comprobar `/health`; luego comprobar `/api/auth/status` usando la clave privada. `/api/vehicles` sin clave o sin sesión debe rechazar el acceso. Configurar el frontend con URL HTTPS de API, origen HTTPS público exacto, la clave compartida, modo `cloud` y `NEXT_PUBLIC_YOKOHAMA_PROPOSAL_MODE=false`; reconstruir y publicar. Verificar login, menú Usuarios, asignaciones y logout.

Las fotografías nuevas se optimizan antes de enviarse, conservando las evidencias anteriores. Los límites del plan contratado deben monitorizarse; el almacenamiento de imágenes en PostgreSQL cuenta dentro de su capacidad. La copia local no sustituye una política de respaldos periódicos del sistema operativo.
