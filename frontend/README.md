# Panel de Yokohama

Aplicación independiente de EXCOBA. Next.js 16, React 19, TypeScript y CSS sin librería de interfaz ni fuentes externas. En operación local consume el backend. La compilación de propuesta pública usa ejemplos sintéticos separados con persistencia en el navegador.

## Arranque

1. Instala Node.js >= 20.9 y ejecuta `npm ci` en esta carpeta.
2. Copia `.env.example` a `.env.local`. Define `YOKOHAMA_API_KEY` con la misma clave local del backend. No la subas a Git ni uses una variable `NEXT_PUBLIC_*`.
3. Inicia primero la API en `http://127.0.0.1:8000` siguiendo el [README del proyecto](../README.md).
4. Ejecuta `npm run dev` y abre `http://127.0.0.1:3001`.

Para verificar: `npm run typecheck`, `npm run build` y `npm run test:e2e`. Para arrancar la compilación: `npm start`.

## Pantallas

- `/`: flotilla, filtros de estado, búsqueda, registro de unidades y recálculo.
- `/vehiculos/[id]`: identidad de la unidad, documentación editable, datos administrativos y pronósticos de mantenimiento; enlaces a los apartados de captura.
- `/incidencias`, `/kilometraje` y `/fallas`: captura y seguimiento con fotografías, en un solo apartado por tipo de registro.
- `/calendario`: agenda mensual, cambios de fecha con historial y registro retrospectivo de servicios (kilometraje opcional).
- `/alertas`: mantenimiento, fallas y vencimientos documentales; sin bandeja de envíos simulados.
- `/dashboard`: kilometraje acumulado y fallas por unidad; indicadores administrativos, sin formularios de captura.
- `/acceso`, `/cuenta` y `/usuarios`: login, perfil/cambio seguro de contraseña y administración de usuarios y asignaciones (solo administrador).

Las proyecciones se etiquetan como provisionales. Una fecha o tolerancia desconocida no se presenta como una garantía de seguridad. Para diferir una falla se requiere evaluación y responsable documentados; el motor puede elevar la severidad o rechazar ese diferimiento. Las fallas críticas indican detener la operación y coordinar asistencia, no conducir al taller.

El visor 3D de Mazda está oculto temporalmente. Su componente, escena y activo local se conservan sin participar en datos ni pronósticos; para reactivarlo, cambia `SHOW_MAZDA_3D_VIEWER` a `true` en `lib/feature-flags.ts`.

## Entornos y seguridad

`YOKOHAMA_DEPLOYMENT_MODE=local` (también el valor por defecto) mantiene Host y API HTTP loopback. `cloud` habilita únicamente el Host exacto de `YOKOHAMA_PUBLIC_ORIGIN`, una raíz HTTPS pública configurada por el responsable del servidor. La API privada usa otra raíz HTTPS fija en `YOKOHAMA_API_URL`, sin rutas, credenciales, query, fragmentos ni redirecciones. No se toman orígenes ni destinos de `X-Forwarded-Host`, URL del navegador u otros encabezados. Una configuración incompleta o desconocida falla cerrada.

La web operativa requiere autenticación de personas y permisos de la API. Las cuentas activas con rol `admin` y correo `admin.yoko@gmail.com` o `martinmoralesbasurto1@gmail.com` pueden administrar cuentas y asignaciones; la segunda es la excepción de desarrollador autorizada. El alta en Usuarios sigue creando exclusivamente conductores y no permite promover otras cuentas. El navegador usa `/api/backend/...`; exclusivamente el servidor agrega `X-API-Key` y el token de su cookie HttpOnly. En cloud la cookie de sesión siempre lleva Secure y SameSite=Strict, incluso cuando Next recibe una URL HTTP interna. Logout, cambio de contraseña y expiración borran la cookie con los mismos atributos. La web pública no permite `auth/setup` ni registro público; los administradores se provisionan por un proceso privado fuera de la web.

Las mutaciones exigen Origin exacto y JSON; la API rechaza peticiones cross-site. Rutas y métodos están permitidos por lista cerrada. Los formularios comunes tienen un límite de 32 KiB, lotes de lecturas 256 KiB y evidencia cloud un máximo de 3.5 MiB. Las fotos nuevas se decodifican y convierten a JPEG sin EXIF, con reducción adaptativa de calidad/resolución hasta 700 KiB por foto; tres imágenes base64 caben debajo del límite. Las evidencias previas no se reescriben. El límite de request/response de Vercel es [4.5 MB](https://vercel.com/docs/functions/limitations#request-body-size).

Para limitar intentos de acceso sin almacenar la IP, solo en Vercel se lee una IP única válida de `x-vercel-forwarded-for` y se envía a la API un HMAC-SHA256 de 64 caracteres, usando la clave privada del servidor. Nunca se aceptan `X-Trusted-Client` ni `X-Forwarded-For` suministrados por el navegador. Si falta el dato de plataforma, la API usa su límite global. La [documentación de encabezados Vercel](https://vercel.com/docs/headers/request-headers#x-vercel-forwarded-for) explica la sobrescritura contra spoofing y el encabezado de plataforma. No habilitar `VERCEL=1` manualmente fuera de esa plataforma ni poner un proxy adicional que modifique estos encabezados.

`vercel.json` prepara cloud con `NEXT_PUBLIC_YOKOHAMA_PROPOSAL_MODE=false`. Antes de desplegar deben existir backend HTTPS, clave compartida, cuentas verificadas y base PostgreSQL persistente de la empresa; el frontend no contiene la cadena de conexión de Neon. Cambiar el flag público requiere reconstruir. La propuesta anterior se conserva exclusivamente cuando ese flag es `true`: ejemplos sintéticos en el navegador, sin cuentas ni API privada. `.vercelignore` excluye configuración privada, artefactos locales y modelos 3D.

Pruebas sin servicios ni datos reales: `npx playwright test --config playwright.cloud-security.config.ts`. Verifican límites cloud/local, cookie Secure, CSRF, bootstrap bloqueado, origen/upstream fijo, huella de IP y compresión de fotografías en Chromium con imágenes sintéticas.

Versiones de runtime verificadas en el registro oficial npm al implementar: [Next](https://registry.npmjs.org/next/latest), [React](https://registry.npmjs.org/react/latest), [Playwright](https://registry.npmjs.org/@playwright/test/latest). Las versiones exactas se conservan en `package-lock.json`.
