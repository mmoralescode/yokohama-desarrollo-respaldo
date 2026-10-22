# Sistema para Yokohama — control de unidades

Panel administrativo y API independientes para flotillas multimarca, con catálogo Mazda3 mexicano preservado. Repositorio: [mmoralescode/yokohama-desarrollo-](https://github.com/mmoralescode/yokohama-desarrollo-), rama `main`.

Todo vive en este directorio: no modifica rutas, usuarios, folios, base de datos ni despliegue de EXCOBA. El despliegue actual está en [Yokohama](https://yokohama-propuesta.vercel.app), con frontend y API separados en Vercel, autenticación real y almacenamiento compartido en Neon. `NEXT_PUBLIC_YOKOHAMA_PROPOSAL_MODE=false`; las unidades, capturas, cuentas, sesiones y fotos documentales se conservan en PostgreSQL. SQLite y el modo de propuesta por navegador siguen disponibles para desarrollo y demostraciones aisladas, pero no son la base de la web publicada. Las instrucciones históricas siguientes describen también esas modalidades.

## Agenda administrativa y propuesta web

El calendario permite cambiar la fecha de una visita y registrar uno o varios servicios realizados en días anteriores. La fecha del trabajo y el momento de captura se guardan por separado. El kilometraje puede quedar pendiente; no se inventa una lectura y no se reinicia un pronóstico por km sin evidencia. Los cambios de agenda sobreviven a los recálculos, conservan su historial y no modifican los límites técnicos.

La migración v4 preserva unidades, historiales, evaluaciones y alertas; genera respaldo verificado antes de actualizar una base existente. Sólo las placas originales del generador (`DEMO-001` a `DEMO-020`, verificadas junto con su VIN sintético) se sustituyen por placas ficticias `YKH-101-A` a `YKH-120-A`.

Para una demostración **aislada**, se puede compilar `frontend` con `NEXT_PUBLIC_YOKOHAMA_PROPOSAL_MODE=true`; no es la configuración actual de `frontend/vercel.json`. `scripts/export-proposal.py` crea los ejemplos en una base temporal nueva y genera `frontend/public/proposal/fleet.json`; nunca abre la base operativa. En ese modo, los cambios persisten sólo en el navegador y `/api/*` queda inaccesible. La web publicada usa el backend privado y Neon. Las claves y conexiones se configuran únicamente en el servidor, nunca con prefijos `NEXT_PUBLIC_`; no subir archivos SQLite ni credenciales al código.

El código se trasladó a este repositorio independiente sin importar el historial de EXCOBA, bases de datos, credenciales ni archivos generados. Ver [estructura y traslado](docs/repositorio-independiente.md). Publicar el código en GitHub no despliega el panel ni habilita acceso público a los datos de una flotilla.

## Qué incluye

- Flotilla con búsqueda y semáforo, detalle por unidad, calendario y bandeja de alertas en español; diseño adaptable a móvil.
- Búsqueda por placa completa/parcial, último dígito numérico de la placa y apodo; la búsqueda por conductor sigue siendo independiente.
- Periodo de verificación capturado manualmente, estado de emplacamiento, vencimiento de tarjeta de circulación y avisos internos con anticipación configurable por unidad (30 días por defecto).
- Fotos privadas del kilometraje vinculadas a lecturas existentes, y registro de incidencias con hasta tres fotos, fecha real del incidente, fecha de captura y seguimiento administrativo.
- Cuenta administradora principal `admin.yoko@gmail.com`, excepción de desarrollador `martinmoralesbasurto1@gmail.com`, cuentas individuales de conductores y asignación explícita de unidades. Los nombres de conductores no crean cuentas ni otorgan permisos automáticamente.
- Dashboard administrativo debajo de Alertas: prioridades, próximas visitas, servicios por fecha real y unidades sin conductor o datos pendientes. [Indicadores y alcance](docs/dashboard.md).
- Visor minimalista del Mazda3 Hatchback **2020** de Ddiaz Design para la demo **no comercial**, con créditos y licencia CC BY-NC-SA 4.0 en un desplegable. Modelo y texturas locales: giro, inclinación, zoom y teclado **sin internet**, al pulsar «Ver en 3D». Sin visor externo ni giro automático; solo renderiza cuando cambia la vista. Requiere mantener el servidor local encendido y un navegador con gráficos 3D. No cambia las reglas de mantenimiento. [Fuente, licencia y límites](docs/modelo-3d.md).
- Registro de unidades, lecturas con fecha/hora y fuente, servicios con costo MXN, fallas/DTC y paros reales. Validación de cronología y cargas JSON atómicas de hasta 500 lecturas.
- Estimación ponderada y robusta de km/día, respaldo del promedio de flotilla (sin mezclar demo con datos reales), escenarios y confianza. Vence lo primero: km, días o meses naturales, ajustado por severidad de cada unidad.
- Agrupación de ventanas en la última fecha común posible. Servicios vencidos generan evaluación hoy, sin inventar una prórroga; críticos reciben atención inmediata.
- Alertas 30/14/7 días y etapa vencido, sin duplicar cada recálculo. Correo y WhatsApp **solo simulados**, sin envío ni destinatarios reales.
- Flotilla ordenada por urgencia, métricas separadas real/demo, error de pronóstico y días fuera de servicio.
- SQLite con migración v1→v2 y respaldo previo verificado; auditoría de insumos/catálogo/política y generador reproducible de 20 unidades sintéticas. [Operación, supuestos y carga de datos](docs/operacion-datos.md).

## Inicio rápido en Windows

Requisitos: Python 3.11+ con `py`, Node.js 20.9+ y npm en PATH. Se verificó con Python 3.13 y Node 20.20.2. Desde la raíz del repositorio:

```powershell
./scripts/dev.ps1 -Install -Seed
```

Abrir **http://127.0.0.1:3001**. La API escucha únicamente en `127.0.0.1:8000`; estado público en `/health`. El script crea una clave efímera compartida por los dos procesos; no la imprime ni la guarda. Si PowerShell bloquea scripts, revisar la política de ejecución con el administrador; no desactivar protecciones globales.

Siguientes inicios (sin reinstalar ni crear otra flotilla):

```powershell
./scripts/dev.ps1
# Detener únicamente los procesos registrados por este script:
./scripts/dev.ps1 -Stop
```

Los procesos se abren ocultos. Registros y PIDs: `.runtime/` (ignorado por Git). La base `backend/data/yokohama.db` se conserva al detener. `-Seed` es idempotente: no borra ni sobrescribe unidades existentes. Los VIN `DEM…` y placas `DEMO-001` a `DEMO-020` son ficticios.

Para presentar el panel sin recompilación de desarrollo: detener con `-Stop`, ejecutar `npm run build` en `frontend` y arrancar el script con `-Production`. Este nombre solo selecciona el servidor compilado de Next: sigue siendo un servicio local, no una publicación compartida en Internet. Las cuentas se activan mediante la configuración inicial descrita abajo.

En carpetas sincronizadas como OneDrive pueden bloquearse directorios generados. Sin borrar archivos ni cambiar permisos, establecer `$env:YOKOHAMA_BUILD_DIR='.next-demo-1'` (nombre nuevo) antes de compilar y conservar esa misma variable al iniciar con `-Production`. Solo se permiten nombres `.next` o `.next-NOMBRE` dentro del panel; sus artefactos quedan fuera de Git.

## Inicio manual / otros sistemas

En `backend`:

```sh
python3 -m venv .venv
. .venv/bin/activate
python -m pip install -r requirements.txt
# Generar una clave local; conservarla solo en el entorno de ambos procesos.
export YOKOHAMA_API_KEY="$(python -c 'import secrets; print(secrets.token_urlsafe(32))')"
python -m app.seed --seed 2026
python -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

En otra terminal, establecer **la misma clave** en `YOKOHAMA_API_KEY`, establecer `YOKOHAMA_API_URL=http://127.0.0.1:8000` y ejecutar desde `frontend`:

```sh
npm ci
npm run dev
```

No usar prefijos `NEXT_PUBLIC_` para la clave. Los `.env.example` documentan las variables: Next puede leer `.env.local`; la API recibe variables de proceso (no carga `.env` automáticamente). No guardar secretos en Git. La API rechaza accesos sin clave; el proxy web solo admite host local y origen permitido. Esto es protección de desarrollo, **no autenticación de producción**.

`backend/requirements.lock.txt` conserva las versiones transitivas verificadas en Windows/Python 3.13; en ese entorno puede instalarse con `python -m pip install -r requirements.lock.txt`. En otros sistemas, verificar compatibilidad y pruebas antes de actualizar ese registro.

Opcionales del backend:

- `YOKOHAMA_DATABASE_URL`: URL SQLAlchemy; por defecto SQLite bajo `backend/data/`. Usar otra base independiente para pruebas.
- `YOKOHAMA_POLICY_PATH`: archivo JSON de política; por defecto `config/policy.json`.

## Pruebas

Para los flujos nuevos de administración y cuentas, desde `frontend`:

```sh
npx playwright test --config playwright.administration.config.ts
```

Esta configuración inicia servidores exclusivos en 8006/3006 y una base temporal nueva, sin abrir ni modificar la base operativa. La prueba de cuentas prepara al propietario mediante la API aislada y verifica el inicio de sesión, permisos, cambio de contraseña y capturas con evidencia. No ejecutar `accounts.spec.ts` contra una base real. Los valores de acceso usados por las pruebas son exclusivamente sintéticos.

Los formularios simplificados y el expediente documental también se verifican con respuestas ficticias, sin ejecutar el backend ni consultar Neon:

```sh
npx playwright test --config playwright.onboarding.config.ts
```

Esta configuración usa exclusivamente el panel temporal `127.0.0.1:3013`; las pruebas interceptan las peticiones y comprueban confirmación de contraseña, registro/asignación de unidad, login sin menú Operación, carga/consulta de documentos y presentación móvil.

Resultados actuales: [verificación de fiabilidad y capacidad](docs/verificacion-fiabilidad.md). Historial: [verificación inicial del MVP](docs/verificacion-mvp.md).

Desde `backend` con el entorno activo:

```sh
python -m pytest -q
```

En Windows: `./.venv/Scripts/python.exe -m pytest -q`. Las pruebas API usan bases temporales, no la base de la demostración. Incluyen lecturas duplicadas/decrecientes/futuras, datos atípicos y escasos, límites km/meses, intersecciones y vencimientos, fallas críticas/menores, persistencia y notificaciones idempotentes.

Desde `frontend`:

```sh
npm run typecheck
npm run build
npx playwright install chromium
npm run test:e2e
```

Para E2E deben estar activos API y panel en 8000/3001, con los 20 vehículos demo. **Usar una base local de pruebas**: el test agrega una unidad `TST…` / `E2E-…` sintética y sus movimientos; nunca borra registros. Capturas y trazas se guardan en `test-results/`, fuera de Git. Cubre navegación, formularios, persistencia, alertas críticas, resolución, diferimiento evaluado, móvil y bloqueo de accesos indebidos.

Si OneDrive bloquea la limpieza de resultados de una corrida anterior, usar una carpeta temporal nueva: `npm run test:e2e -- --output RUTA_TEMPORAL_NUEVA`. No se necesita borrar la base ni cambiar permisos de la carpeta del proyecto.

La prueba visual `npm run test:e2e -- mazda-viewer.spec.ts` solo requiere el panel: bloquea conexiones externas antes de abrir cada sesión, carga el **GLB local real** e intercepta las consultas de flotilla sin escribir en la API. Comprueba cámara y zoom por gestos/teclado, créditos, cierre y reapertura, errores, pérdida de contexto WebGL y móvil. Usa Chromium completo con soporte WebGL; no simula un visor externo ni sustituye el automóvil por una figura de prueba. Para probar otro puerto local, establecer `YOKOHAMA_VISUAL_TEST_URL` (por defecto `http://127.0.0.1:3001`). El componente está en `frontend/components/mazda-viewer.tsx`, el renderizador bajo demanda en `frontend/lib/mazda-scene.ts` y el modelo en `frontend/public/models/`.

## Administración, cuentas y evidencia

### Flujos actualizados y esquema v10

En **Usuarios**, el administrador debe escribir y confirmar la contraseña inicial. Si introduce una contraseña nueva al editar una cuenta, también debe confirmarla; ambas pueden quedar vacías para conservarla. Si no coinciden, se muestra el error y no se envía ninguna solicitud de alta o actualización. La confirmación no se almacena ni se envía al backend.

Después de crear correctamente un usuario aparece **Cargar unidad** en ese mismo apartado, únicamente para ese flujo. El formulario compartido permite registrar una unidad de cualquier marca y asignarla directamente al conductor recién creado. `POST /api/vehicles` recibe `assigned_user_id`: la unidad, su lectura inicial y la asignación se guardan en una sola transacción, sin reemplazar otras unidades asignadas. Si falla el registro de la unidad, la cuenta ya creada se conserva. Al completarse se actualiza el listado y se cierra el formulario; no se repite el alta del usuario.

Al dar de alta una unidad hay un solo campo **Periodo de verificación (fecha límite)**, sin inventar una fecha inicial. No se muestran régimen de uso ni configuración avanzada; los valores internos predeterminados se conservan para no cambiar los pronósticos. El login muestra la marca YOKOHAMA sin menú Operación; la navegación aparece tras iniciar sesión.

**Documentación y vencimientos** permite cargar inmediatamente fotos de verificación, tarjeta de circulación, placas, refrendo/tenencia u otro documento, con notas opcionales y hasta tres imágenes por carga. **Documentos guardados** permite abrirlas posteriormente y ofrece Mostrar más cuando hay más de cuatro fotos. No se crean incidencias ni lecturas ficticias para adjuntar un documento.

El administrador puede consultar y cargar documentos de todas las unidades. Los conductores pueden hacerlo únicamente en sus unidades asignadas: los documentos integran el expediente compartido de esa unidad, incluso si los cargó otra persona. Esto no amplía el acceso a reportes o fotos de incidencias, kilometraje y fallas de otros usuarios, que siguen siendo privados por autor. Las imágenes se guardan en la base privada y requieren una sesión autorizada para abrirse; no se publican en `public/` ni mediante enlaces abiertos. En modo nube, la base y los bytes de las fotos están en Neon.

La migración **v9→v10** añade `vehicle_evidence.document_type`, inicialmente `null`, y amplía las restricciones para que cada imagen pertenezca exactamente a un documento o a un registro existente. La actualización reconoce y valida el esquema previo, conserva las fotos y sus vínculos originales y admite SQLite y PostgreSQL. Una categoría documental no transforma la evidencia antigua en un documento compartido.

La actualización v5→v6 es aditiva: conserva unidades, conductores, lecturas, historial y evaluaciones; crea un respaldo SQLite verificado antes de cambiar el esquema. No crea usuarios ni asigna contraseñas por defecto. Las fotos se guardan en la base privada, no en `public/`; deben incluirse en los respaldos y la política de retención de la empresa.

La terminación es el **último número** de la placa (por ejemplo, `YKH-109-A` → `9`). No se utiliza para deducir automáticamente requisitos legales. El administrador captura inicio/fin del periodo de verificación, estado y vencimiento de tarjeta de circulación según la documentación de cada unidad. Dejar un documento sin fecha significa **sin fecha registrada**, nunca “vigente”. Los avisos se recalculan al consultar Alertas o el dashboard y desaparecen de la bandeja cuando se actualiza el vencimiento fuera de la ventana de aviso. No se envían correos, mensajes ni notificaciones push reales.

Las altas nuevas permiten elegir entre las **32 entidades** sin asumir un estado. Los registros existentes, incluso textos históricos fuera del catálogo, se conservan. `/normativa` y la ficha de cada unidad incluyen un directorio contrastado de fuentes oficiales para las 32 entidades (`frontend/lib/official-state-sources.ts` y archivos regionales), con notas de alcance y consulta al 30 de septiembre de 2026. **Un directorio no constituye una compilación legislativa íntegra ni un dictamen de cumplimiento.** Los calendarios habilitados por entidad siguen en `frontend/lib/vehicle-jurisdictions.ts`; fuera de su alcance, se muestra revisión pendiente, nunca “exento” ni fechas de otra entidad.

Los calendarios habilitados son orientativos y se aplican solo tras confirmar las condiciones de la ficha y guardar el formulario. Jalisco usa su calendario particular anual; Querétaro y CDMX tienen ambos semestres de 2026. Estado de México solo tiene habilitado el primer semestre; el programa del segundo semestre está localizado pero pendiente de cotejo y se captura manualmente. Guanajuato usa el calendario semestral usual publicado por SAMA, con la limitación expresa de que no se cotejó la edición completa del programa normativo. No se calculan altas, prórrogas, exenciones, otros usos ni 2027. Cambiar el estado conserva las fechas y reinicia la confirmación; tampoco registra una verificación como realizada. La tarjeta de circulación siempre usa su propia fecha documentada, no la vigencia de placas.

La migración **v6→v7** añade fechas independientes de vencimiento/renovación de placas, límite del periodo de refrendo/tenencia y fecha real de pago, más notas documentales de hasta 1500 caracteres. Todo inicia en `null`; no modifica registros previos. Un pago retrospectivo es válido, uno futuro no; exige identificar el plazo del periodo. El pago capturado suprime únicamente su aviso, no certifica que el vehículo carezca de otros adeudos. Para cambiar el plazo de un periodo pagado hay que quitar explícitamente la fecha de pago anterior, guardar y luego registrar el pago nuevo. No se calculan importes, subsidios ni prórrogas. Las restricciones de circulación son enlaces de consulta con advertencia de ámbito, no un indicador en vivo de autorización para circular.

Los cambios administrativos efectivos se guardan junto con sus valores previos/nuevos, fecha UTC y cuenta responsable en la misma transacción. `GET /api/vehicles/{id}/administration-history` es exclusivo del administrador y muestra los últimos 50; los cambios anteriores no se borran. La interfaz ofrece historial de cambios, no un estado de cuenta fiscal. La propuesta mantiene su historial y nuevos datos en el mismo almacenamiento local v1, sin descartar registros previos.

Las fotografías aceptadas son JPEG, PNG y WebP, máximo 3 MiB por archivo. El navegador prepara una copia reducida y el servidor valida/decodifica la imagen, la vuelve a codificar y elimina EXIF/GPS. Se requiere autorización para consultar cada foto. La captura nueva de kilometraje guarda lectura y hasta tres fotos en una transacción: una imagen inválida no deja media captura. Se puede registrar primero el movimiento con evidencia pendiente y adjuntar fotos después al mismo registro, sin duplicar lecturas o fallas. Las incidencias conservan fecha del suceso y de captura; no se convierten automáticamente en fallas mecánicas ni reinician mantenimiento.

La administración exige una cuenta activa con rol `admin` y uno de los dos correos autorizados: **`admin.yoko@gmail.com`** o **`martinmoralesbasurto1@gmail.com`**. El segundo es la excepción de desarrollador aprobada; su cuenta no tiene fecha de vencimiento. El backend vuelve a comprobar la identidad y el rol en cada petición: los administradores antiguos de otros correos no conservan privilegios. No se puede trasladar ese rol a un correo ajeno a la lista, cambiar el correo del propietario, desactivarlo o convertirlo a conductor. Las sesiones siguen venciendo a las 12 horas; acceso indefinido no significa sesión indefinida. El login no ofrece registro público ni muestra contraseñas existentes.

Desde **Usuarios**, los administradores crean correos/contraseñas iniciales de conductores, asignan unidades y desactivan cuentas sin borrar sus registros. El formulario no ofrece promoción a administrador. Las dos cuentas administradoras aparecen como tales y cada una cambia su contraseña en Mi cuenta. Cada conductor puede consultar exclusivamente sus unidades asignadas, sus reportes y las fotografías de reportes que él cargó; compartir una unidad no permite ver la evidencia de otro conductor. Los documentos del expediente son la excepción explícita: se comparten únicamente entre los administradores y las personas asignadas a esa unidad. Estadísticas, alertas, calendario, auditoría, otras cuentas y la edición de fechas administrativas quedan reservados a los administradores autorizados. **Incidencias**, **Kilometraje** y **Fallas** tienen apartados propios con carga de fotos y la opción de adjuntar evidencia después, sin repetir el movimiento.

Cada persona cambia su contraseña en **Mi cuenta** introduciendo la actual y una nueva de al menos 12 caracteres; la anterior no se puede consultar. La sesión se valida en el backend en cada petición. El navegador recibe una cookie HttpOnly/SameSite Strict, no el token en JavaScript; contraseñas y tokens de sesión se guardan con hash. Cambiar contraseña, correo, estado de cuenta o asignaciones revoca sus sesiones. La aplicación es web adaptable al celular y esta instancia está diseñada para una empresa.

## Preparación del acceso y entrega privada a la empresa

La página actual de Vercel usa `NEXT_PUBLIC_YOKOHAMA_PROPOSAL_MODE=false`, modo `cloud`, cookies Secure/HttpOnly y la API privada conectada a Neon. El acceso inicial al propietario ya está preparado; no volver a provisionarlo ni importar una copia SQLite sobre la base operativa para actualizar la interfaz. Las instrucciones locales y de entrega corporativa siguientes se conservan como referencia para una instalación independiente.

Para preparar la cuenta propietaria, el responsable técnico debe tener la base ya migrada, un respaldo comprobado y los procesos detenidos temporalmente. Desde `backend`, usando un archivo con solo la contraseña guardado fuera del repositorio en una ubicación privada:

```powershell
.\.venv\Scripts\python.exe -m app.provision_owner --database-url "sqlite:///data/yokohama.db" --password-file "C:\RutaPrivada\yokohama-admin-password.txt"
```

El comando también admite `--password-env NOMBRE_DE_VARIABLE` o un prompt oculto cuando no se indica archivo ni variable. No acepta una contraseña como argumento, no la imprime y no migra ni reemplaza la base. Crea o prepara `admin.yoko@gmail.com`, convierte otros administradores a conductores y revoca las sesiones afectadas, conservando cuentas, asignaciones y datos de vehículos. Después, mantener `YOKOHAMA_REQUIRE_AUTH=true`, dejar `YOKOHAMA_SETUP_TOKEN` vacío y reiniciar. `/acceso` permite entrar con las credenciales entregadas por un canal privado; **Mi cuenta** permite cambiarlas.

La entrega operativa requiere alojar **frontend, backend y almacenamiento persistente en infraestructura administrada por la empresa**. La empresa debe controlar las credenciales, la base, las fotografías y los respaldos/restauraciones. Las fotos privadas forman parte de SQLite y de sus respaldos; no se guardan en `public/` ni se publican como enlaces abiertos. El proxy actual admite solo loopback, por lo que el acceso desde otros dispositivos requiere preparar HTTPS, origen permitido, cookies Secure y red privada/VPN en el servidor corporativo, y verificar permisos de extremo a extremo. No basta con cambiar el modo de propuesta o publicar el archivo de la base. Esta preparación de infraestructura compartida aún está pendiente.

La propuesta de Vercel mantiene sus datos ficticios locales y no solicita contraseñas reales. Habilitar operación compartida requiere acordar backend y almacenamiento privados persistentes, HTTPS, cookies Secure, respaldo/retención y límites de acceso adecuados al despliegue. La limitación de intentos actual es de un proceso local; no equivale a protección distribuida. No quitar los controles loopback ni publicar SQLite para habilitar móviles. Referencias de implementación: [sesiones OWASP](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html), [carga de archivos OWASP](https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html).

## Catálogos, configuración y límites

La investigación aprobada sigue intacta:

- [Investigación, fuentes y pendientes](docs/investigacion-fase-1.md).
- [40 reglas de servicios y campañas/fallas documentadas](catalogos/mazda3-mx.v0.1.0.json).
- [Variantes mexicanas por año, motor y transmisión](catalogos/variantes-mx.v0.1.0.json).
- [Política configurable](config/policy.json), [decisiones y límites](docs/decisiones-mvp.md).

El modo por defecto es `demo`: fechas **provisionales**. No se predice una avería por kilometraje cuando la evidencia solo permite inspección por condición o consulta por VIN. Las campañas no se convierten en probabilidad de falla. No se fabrica historial a km cero. Si falta historial, intervalo o equipo confirmado, la regla queda pendiente y puede no tener fecha.

El uso combina limpieza robusta de lecturas con tasas ponderadas por recencia. Los límites consideran el escenario de uso alto y un cuantil conservador de tasas observadas. Los rangos son escenarios, **no probabilidades calibradas**. La confianza incorpora datos de uso y evidencia de la regla; no garantiza seguridad mecánica.

| Grupo de configuración | Controla |
| --- | --- |
| `alert_days` | Anticipaciones 30/14/7 días; vencido es una etapa adicional |
| `usage` | Respaldo 80 km/día, ventana, ponderación, muestras mínimas, máximo plausible e incertidumbre |
| `planning` | Adelanto demostrativo de 7 días, horizonte y reserva previa al límite |
| `triage` | Síntomas de escalamiento preventivo y listas DTC sujetas a validación |
| `api.refresh_seconds` | Recálculo periódico (300 segundos; 0 lo desactiva) |
| `service_overrides` | Parámetros por servicio respaldados por validación explícita |

80 km/día y 7 días de adelanto son supuestos de demo, no datos Mazda/Yokohama. `null` en tolerancia conserva el desconocimiento: no se permite extensión, pero **esto no acredita un límite seguro**. Duraciones desconocidas no son cero. Sin duración/capacidad/piezas confirmadas no se garantizan días de inmovilización ni cita.

Para validar una regla, registrar en `service_overrides[ID]`: `validated: true`, `validated_by`, `validated_on` (ISO no futura), `evidence_url` HTTPS y los IDs de `resolved_conflicts`. Solo con evidencia real incorporar `interval_km`, `interval_months`, `tolerance_km`, `tolerance_days`, `advance_days`, `duration_hours` y `workshop_buffer_days`. No activar indicadores solo para conseguir fechas. Cambiar `policy_version` y reiniciar al modificar política. En `operational`, reglas no habilitadas/conflictos sin resolver permanecen bloqueados.

La fecha límite toma el criterio más temprano entre km y tiempo, usando uso conservador y restando el buffer de taller. Las visitas usan la intersección **común**, no una cadena de solapes. No diferir críticos, síntomas críticos detectados ni DTC no autorizados. Una falla menor exige evaluación, responsable documentado y fecha límite; seleccionar “menor” no basta. Se conserva el reporte original aunque el motor eleve severidad.

### Actualización del catálogo

1. Mantener IDs estables; revisar fuente, página/localizador, mercado, año, motor y equipamiento por VIN.
2. Intersectar restricciones con la matriz de variantes. No extrapolar programas de otros países.
3. Diferenciar km/meses, inspección/reemplazo y servicios programados; un cambio de aceite intermedio no acredita servicio completo.
4. Añadir URL, fecha, mercado, páginas y hash cuando proceda; preservar revisión anterior y aumentar versión.
5. Conservar `null` cuando falte evidencia. Resolver conflictos con Mazda documentando alcance por VIN/configuración. No publicar datos personales reales.
6. Actualizar explícitamente rutas/versiones consumidas en `app/main.py` y `app/seed.py`, ejecutar pruebas y verificar snapshots.

## Arquitectura y API

`backend/app/engine.py` contiene reglas puras sin red ni base de datos; `UsagePredictor` permite incorporar ML calibrado sin saltarse límites de seguridad. `planner.py` persiste evaluaciones, alertas, visitas y notificaciones. `notifications.py` define canales simulados. `frontend/` es una aplicación Next separada con proxy y clave únicamente en servidor.

Entidades: `Vehicle`, `OdometerReading`, `ServiceCatalog`, `ServiceHistory`, `FaultReport`, `Alert`, `VisitPlan`; además `PlanEvaluation`, `Notification` y `SchemaMigration` para auditoría/versionado. No requiere Prisma ni migraciones de EXCOBA. Ver [migración inicial](backend/migrations/001_initial.md): solo crea bases nuevas, rechaza esquemas desconocidos. Cambios futuros requieren migraciones explícitas; `create_all` no altera tablas. SQLAlchemy usa tipos portables: PostgreSQL necesita driver, pruebas y migración de datos, no solo cambiar URL.

Todos los endpoints bajo `/api` requieren `X-API-Key`; `/health` no. [Contrato detallado](docs/contrato-mvp.md).

Tras activar cuentas, las rutas de datos también requieren una sesión personal válida (el proxy recibe la cookie y añade `X-Session-Token` al backend). Solo `auth/status`, `auth/login` y `auth/setup` pueden utilizarse sin sesión; siguen requiriendo la clave de servidor.

| Método y ruta | Función |
| --- | --- |
| `GET/POST /api/vehicles` | Consultar/registrar flotilla |
| `GET /api/vehicles/{id}` | Historial y fallas efectivas |
| `POST /api/vehicles/{id}/readings` | Lectura fechada |
| `POST /api/vehicles/{id}/services` | Servicio realizado |
| `POST /api/vehicles/{id}/faults` | Reporte y alerta inmediata |
| `PATCH /api/faults/{id}/resolve` | Resolución documentada |
| `GET /api/vehicles/{id}/plan` | Fechas, confianza, ventanas y visitas |
| `GET /api/calendar?start=YYYY-MM-DD&end=YYYY-MM-DD` | Agenda (máximo 366 días) |
| `GET /api/alerts`, `GET /api/notifications` | Alertas y salida simulada |
| `GET /api/catalog`, `GET /api/variants` | Catálogos fuente |
| `POST /api/recalculate` | Actualizar flotilla |
| `GET /api/auth/status`, `POST /api/auth/setup`, `POST /api/auth/login` | Estado, primer administrador y acceso |
| `GET /api/auth/me`, `POST /api/auth/logout`, `POST /api/auth/password` | Cuenta propia y sesiones |
| `GET/POST /api/users`, `PATCH /api/users/{id}` | Cuentas y asignaciones (administradores) |
| `PATCH /api/vehicles/{id}/administration` | Apodo, fechas documentales y anticipación |
| `GET /api/document-alerts` | Verificación/tarjeta próximas a vencer o vencidas |
| `GET/POST /api/vehicles/{id}/odometer-evidence` | Fotos ligadas a una lectura de esa unidad |
| `GET/POST /api/vehicles/{id}/documents` | Fotos privadas del expediente de una unidad autorizada |
| `GET /api/evidence/{uuid}` | Consultar imagen privada autorizada |
| `GET /api/incidents`, `GET/POST /api/vehicles/{id}/incidents` | Consulta y captura de incidencias con fotos |
| `PATCH /api/incidents/{uuid}` | Seguimiento/resolución por administrador |

Se validan VIN/placas únicos, variante/año/transmisión, fechas, números finitos, descensos y velocidades imposibles. El MVP admite una lectura por día; registros del mismo día deben coincidir en km. Múltiples capturas diarias requieren timestamps en una migración futura. Registrar mantenimiento no cierra una falla real: la resolución es explícita.

## Antes de operar con vehículos reales

Validación con agencia; activación de las cuentas implementadas, revisión de asignaciones y auditoría integral; infraestructura privada separada de EXCOBA; TLS, secretos, respaldo/restauración y monitoreo; capacidad/piezas de taller; campañas por VIN; protección de datos; pruebas con historial real y calibración del estimador. El temporizador local no es un servicio 24/7 si se apaga la computadora. La propuesta pública no es el despliegue del sistema operativo compartido y no realiza envíos externos.
