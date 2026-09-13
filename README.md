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
- Contraseña de al menos 10 caracteres.

Después de crear esa cuenta, la configuración inicial se bloquea y solamente un administrador autenticado puede crear otros usuarios.

## Permisos

| Perfil | Consultar expedientes | Modificar datos clínicos | Usuarios, configuración y respaldos |
|---|---:|---:|---:|
| Administrador | Sí | Sí | Sí |
| Editor | Sí | Sí | No |
| Solo lectura | Sí | No | No |

El administrador asigna el perfil desde `Menú de usuario > Administrar usuarios`. Los permisos se validan en la interfaz y nuevamente en el servidor, por lo que ocultar o alterar un botón no permite saltarse las restricciones.

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
