# DentalRos - Sistema de Gestión Odontológica

Aplicación para administrar pacientes, historias clínicas, odontogramas, consultas e informes PDF. Incluye autenticación real, usuarios con permisos, contraseñas cifradas y almacenamiento central en SQLite.

## Requisitos

- Windows 10/11.
- Node.js 24 o superior.
- Un navegador actualizado, como Chrome, Edge o Firefox.

Para ejecutar la aplicación no se necesitan dependencias adicionales ni un servidor de base de datos externo. Para ejecutar las pruebas, instala las dependencias de desarrollo con `npm ci`.

## Iniciar el sistema

1. Haz doble clic en `Iniciar_Sistema.bat`.
2. El sistema abrirá `http://127.0.0.1:3000` en el navegador.
3. En el primer inicio, registra el usuario administrador principal.

También puede iniciarse desde una terminal con:

```powershell
npm start
```

No abras `index.html` directamente para trabajar. La autenticación y la base de datos necesitan el servidor local.

## Primer administrador

No existe una contraseña predeterminada guardada en el código. Cuando la base está vacía, la pantalla inicial solicita:

- Nombre completo.
- Nombre de usuario.
- Contraseña de al menos 6 caracteres.

Después de crear esa cuenta, la configuración inicial se bloquea y solamente un administrador autenticado puede crear otros usuarios.

## Permisos

| Perfil | Consultar expedientes | Modificar datos clínicos | Usuarios, configuración y respaldos |
|---|---:|---:|---:|
| Administrador | Sí | Sí | Sí |
| Doctor/a | Sí | Historia clínica, diagnósticos, consultas y facturas | No |
| Secretaría | Sí | Pacientes, citas y facturas con precios definidos | No |
| Auxiliar de odontología | Sí | No | No |
| Soporte técnico | No | No | Usuarios no administrativos, sin acceso clínico |
| Editor | Sí | Sí | No |
| Solo lectura | Sí | No | No |

El administrador asigna el perfil desde `Menú de usuario > Administrar usuarios`. `Editor` y `Solo lectura` se conservan para las cuentas creadas en versiones anteriores. Los permisos se validan en la interfaz y nuevamente en el servidor, por lo que ocultar o alterar un botón no permite saltarse las restricciones.

## Invitaciones privadas por correo

El administrador indica nombre, usuario, perfil y correo. DentalRos envía un enlace aleatorio de un solo uso que vence en 24 horas. La persona crea su propia contraseña en `activar.html`; la contraseña nunca se envía por correo ni se muestra al administrador. Reenviar una invitación invalida el enlace anterior y, para cuentas existentes, cierra sus sesiones activas al aceptar la nueva contraseña.

El envío utiliza SMTP con TLS mediante Nodemailer. Completa estas variables privadas en `.env`:

```dotenv
PUBLIC_URL=https://direccion-publica-del-sistema.example
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=usuario-smtp
SMTP_PASSWORD=contraseña-o-clave-de-aplicación
SMTP_FROM=DentalRos <cuenta@example.com>
```

`PUBLIC_URL` debe ser la URL real que abrirá el destinatario. Con un Quick Tunnel de Cloudflare cambia en cada ejecución: copia la nueva dirección `https://...trycloudflare.com` a `.env` y ejecuta otra vez `docker compose up -d` antes de crear o reenviar invitaciones. El puerto 465 suele usar `SMTP_SECURE=true`; el puerto 587 usa `false` y el servidor exige la actualización STARTTLS. Consulta los valores exactos con tu proveedor de correo y usa una clave de aplicación cuando corresponda. Nunca publiques `.env`.

Si SMTP rechaza un correo, la cuenta queda pendiente y la interfaz lo informa; corrige la configuración y pulsa **Enviar enlace**. El servidor no expone el token en la respuesta ni lo guarda en texto legible.

## Diagnósticos, procedimientos e importes

La historia clínica y la factura están separadas. La consulta conserva motivo, diagnóstico clínico, tratamiento, receta y evolución. Su factura contiene un diagnóstico facturable, procedimientos, cantidades, precios unitarios, subtotales y total.

El administrador crea procedimientos y define sus precios desde el catálogo. Administradores y doctores pueden registrar diagnósticos. El personal con permiso de facturación puede preparar un borrador usando los precios definidos y cerrar la factura. Una factura cerrada queda bloqueada; solo el administrador puede reabrirla y solo el administrador puede modificar precios.

El precio y el nombre usados quedan guardados como una copia histórica dentro de la factura. Cambiar el catálogo afecta las facturas nuevas, pero no modifica cobros anteriores. El servidor recalcula los importes, bloquea facturas cerradas y registra cierres y reaperturas en auditoría. Los respaldos JSON incluyen el catálogo y el desglose de cada factura.

## Contraseñas

- El administrador crea cada cuenta con una contraseña temporal.
- El usuario debe cambiar esa contraseña antes de acceder a los expedientes.
- Cada usuario puede cambiar su propia contraseña desde su menú.
- Si alguien olvida su clave, el administrador puede asignarle otra contraseña temporal.
- Al restablecer una contraseña se cierran las sesiones anteriores de esa cuenta.
- Las contraseñas se procesan con `scrypt` y nunca se guardan como texto legible.

## Datos y respaldos

La base de datos se crea automáticamente en:

```text
data/odontologia.sqlite
```

No borres ese archivo. Los administradores pueden descargar y restaurar copias JSON desde la barra superior. La restauración reemplaza los datos clínicos, pero no modifica las cuentas de usuario.

### Migrar datos de la versión anterior

Si la versión anterior se usaba abriendo `index.html` directamente:

1. Abre una vez `index.html` directamente, sin el archivo `.bat`.
2. En el aviso de servidor no disponible, pulsa `Descargar datos guardados anteriormente`.
3. Inicia la nueva versión con `Iniciar_Sistema.bat`.
4. Ingresa como administrador y usa `Restaurar` para seleccionar el JSON descargado.

Si los datos anteriores estaban en el mismo origen `http://127.0.0.1:3000`, el sistema ofrecerá migrarlos automáticamente cuando la nueva base esté vacía.

## Seguridad implementada

- Sesiones opacas en cookies `HttpOnly` y `SameSite=Strict`.
- Solo el hash SHA-256 del token de sesión se almacena en SQLite.
- Contraseñas con salt aleatorio y `scrypt`.
- Roles `admin`, `editor` y `lector` validados por endpoint.
- Bloqueo de cuentas inactivas y revocación de sus sesiones.
- Protección para no eliminar el último administrador activo.
- Registro interno de accesos y cambios importantes en `audit_logs`.
- Límite de tamaño para solicitudes y restauraciones.
- Cabeceras de seguridad y bloqueo de acceso web a la base de datos y al backend.

Para publicar con HTTPS, configura `COOKIE_SECURE=true`.

## Pruebas

Ejecuta:

```powershell
npm test
```

Las pruebas cubren configuración inicial, sesiones, permisos de cada perfil, usuarios, contraseñas, expedientes, respaldos, auditoría y cierre de sesión.

## Estructura principal

```text
sistema-odontologico/
|-- server.js                 # Servidor HTTP y API protegida
|-- server/database.js        # Esquema y acceso a SQLite
|-- package.json              # Comandos start y test
|-- index.html                # Interfaz principal y acceso
|-- css/styles.css            # Diseño responsive
|-- js/auth.js                # Sesión y administración de usuarios
|-- js/db.js                  # Cliente de la API
|-- js/app.js                 # Gestión de la interfaz clínica
|-- js/odontograma.js         # Odontograma interactivo
|-- js/pdf-export.js          # Informes PDF
|-- test/server.test.js       # Pruebas de integración
`-- data/odontologia.sqlite   # Base local creada al iniciar
```

## GitHub Pages (modo local)

La publicación en GitHub Pages funciona sin Node.js usando IndexedDB. Permite gestionar pacientes, historias, consultas, odontogramas, configuración y respaldos JSON desde el navegador. No proporciona cuentas, contraseñas ni permisos de servidor. Los datos no se envían a GitHub ni se comparten entre equipos: cualquier persona que use ese perfil de navegador puede acceder a ellos. El modo local se anuncia permanentemente en pantalla.

Exporta respaldos periódicamente y antes de borrar datos del navegador, cambiar de equipo o usar navegación privada. Puedes importar los respaldos anteriores con **Restaurar**. Los datos de SQLite no se publican ni se migran automáticamente.

En GitHub, selecciona **Settings > Pages > Source > GitHub Actions**. El workflow `pages.yml` ejecuta las pruebas y publica únicamente HTML, CSS, JavaScript e imágenes. Cada push a `main` actualiza el sitio. Con un dominio personalizado, el archivo publicado también activa explícitamente el modo local.

Al ejecutar `npm start`, la aplicación sigue usando el servidor y su autenticación. Un error del servidor no cambia automáticamente al almacenamiento local.

## Docker Desktop en Windows y acceso temporal por Internet

### Arquitectura

Node.js 24 sirve la API con `node:http` (sin Express) y el frontend HTML/CSS/JavaScript desde el mismo proceso. SQLite está integrado en Node.js: no se necesita un contenedor MySQL o PostgreSQL. En Docker y Cloudflare se utiliza la autenticación del servidor y la base compartida, no el modo local de GitHub Pages.

### Arranque

1. Abre Docker Desktop con el motor de **contenedores Linux**.
2. Abre PowerShell en la carpeta del repositorio.
3. Opcionalmente, copia la plantilla con `Copy-Item .env.example .env` si aún no tienes `.env`. Compose funciona también sin ese archivo gracias a sus valores predeterminados.
4. Ejecuta:

```powershell
docker compose up -d
```

Abre **http://localhost:3000**. No es necesario instalar Node.js en Windows. En el primer arranque, crea el administrador **antes de abrir el túnel** y crea una cuenta de solo lectura si la otra persona solo necesita consultar.

Para verificar el estado y los logs:

```powershell
docker compose ps
docker compose logs --tail=100 app
```

El estado debe pasar a `healthy`. Para reconstruir después de actualizar el código:

```powershell
docker compose build
docker compose up -d
```

### Variables y datos

Compose lee `.env` para configurar `PORT` (predeterminado `3000`), `COOKIE_SECURE` (predeterminado `true`), `PUBLIC_URL` y SMTP. Si cambias el puerto o la URL del túnel, vuelve a ejecutar `docker compose up -d`. Las cookies seguras funcionan con HTTPS y con `localhost` en navegadores actuales; utiliza la URL local indicada. Mantén `COOKIE_SECURE=true` para compartir por Cloudflare.

`HOST=0.0.0.0` permite recibir conexiones dentro del contenedor; el puerto de Windows se publica solo en `127.0.0.1`. `DB_PATH=/app/data/odontologia.sqlite` apunta al volumen Docker `dentalros_data` (Compose añade el prefijo del proyecto). No hay contraseñas predeterminadas. Las únicas credenciales de `.env` son las de la cuenta SMTP usada para enviar invitaciones.

El volumen comienza con una base nueva y conserva usuarios y expedientes al reiniciar o reconstruir el contenedor. La carpeta `data/` del repositorio queda intacta y no se copia a la imagen. Para pasar expedientes existentes, exporta un respaldo JSON desde la instalación anterior e impórtalo con **Restaurar** en Docker; las cuentas se crean por separado. Exporta respaldos desde la aplicación antes de moverla a otro equipo.

Para detener el sistema conservando el volumen:

```powershell
docker compose down
```

No agregues `-v`: esa opción elimina el volumen y su base de datos.

### Cloudflare Tunnel temporal

Con `cloudflared` instalado en Windows y la aplicación funcionando, abre otra terminal PowerShell y ejecuta:

```powershell
cloudflared tunnel --url http://localhost:3000
```

La terminal mostrará una URL aleatoria `https://…trycloudflare.com`. Compártela con la otra persona, que deberá iniciar sesión con la cuenta que hayas creado. Mantén Docker Desktop y esa terminal abiertos. `Ctrl+C` detiene el túnel; un nuevo arranque puede generar otra URL. No necesitas abrir puertos del router ni configurar un dominio.

Los Quick Tunnels son temporales para pruebas, sin garantía de disponibilidad. Si `cloudflared` detecta una configuración existente en `.cloudflared`, consulta las limitaciones de Quick Tunnels antes de modificarla.

Documentación: [Quick Tunnels de Cloudflare](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/trycloudflare/).
