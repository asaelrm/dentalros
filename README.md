# Sistema de Gestión Odontológica (Historias Clínicas y Récord de Pacientes)

Un sistema completo, moderno e independiente desarrollado en **HTML5, CSS3 y JavaScript puro**, diseñado para consultorios y clínicas dentales. Funciona de manera 100% autónoma en cualquier navegador web (Chrome, Edge, Firefox, Brave) sin necesidad de instalar servidores ni bases de datos complejas.

---

## 🌟 Características Principales

1. **Gestión y Directorio de Pacientes**:
   - Registro de datos personales: Cédula / DNI, Nombres, Apellidos, Teléfono, Correo, Dirección, Fecha de Nacimiento, Edad (cálculo automático), Contacto de emergencia.
   - Búsqueda en tiempo real por nombre, identificación o teléfono.
   - Edición y eliminación de expedientes con confirmación segura.

2. **Historia Clínica y Anamnesis**:
   - Motivo principal de consulta.
   - **Alertas médicas automáticas**: Detección de alergias (penicilina, anestesia, látex, etc.) con banner rojo de advertencia.
   - Antecedentes de enfermedades sistémicas (Hipertensión, Diabetes, Cardiopatías, etc.).
   - Medicación actual y hábitos (bruxismo, tabaquismo).
   - Intervenciones y cirugías odontológicas previas.
   - Diagnóstico clínico general y plan de tratamiento por fases.

3. **Odontograma Interactivo (Sistema FDI)**:
   - Esquema anatómico visual de los 32 dientes (arcadas superior e inferior).
   - Herramientas rápidas para marcar: **Caries**, **Restaurado (Resina/Amalgama)**, **Ausente / Extraído**, **Corona / Prótesis**, **Endodoncia** y **Sano**.
   - Posibilidad de marcar caras dentales individuales (Oclusal, Vestibular, Lingual, Mesial, Distal) o el diente completo con doble clic.
   - Resumen estadístico dental en tiempo real.
   - Guardado automático directo en el récord del paciente.

4. **Récord Cronológico de Citas y Evoluciones**:
   - Registro de cada visita con fecha, motivo, diagnóstico específico y tratamiento realizado.
   - Prescripción médica / receta de medicamentos.
   - Registro de honorarios/costos y fecha de próxima cita.

5. **Generador de Informes en PDF Profesional**:
   - Encabezado con membrete del consultorio o doctor/a (configurable).
   - Datos completos del paciente, alertas médicas destacadas y resumen de anamnesis.
   - Resumen de hallazgos del odontograma.
   - Tabla cronológica de tratamientos y evoluciones.
   - Espacios formales para firma y sello del odontólogo y firma del paciente (consentimiento).
   - **Doble opción de exportación**:
     - *Descargar PDF directo*: genera y descarga el archivo `.pdf` automáticamente.
     - *Imprimir / PDF del Navegador*: utiliza los estilos de alta resolución `@media print` para imprimir en papel o guardar en PDF con fuentes vectoriales nítidas.

6. **Seguridad y Copias de Respaldo**:
   - Botón **"Copia de Seguridad"**: Descarga un archivo `.json` con todos los pacientes, historias y consultas.
   - Botón **"Restaurar"**: Permite recuperar o transferir la base de datos a cualquier otra computadora en segundos.

---

## 🚀 Cómo Iniciar el Sistema

1. Dirígete a la carpeta del proyecto:
   `C:\Users\lrosario\.gemini\antigravity\scratch\sistema-odontologico`
2. Haz doble clic sobre el archivo **`Iniciar_Sistema.bat`** (o abre directamente **`index.html`** con tu navegador favorito como Google Chrome o Microsoft Edge).
3. ¡Listo! El sistema se cargará de inmediato con un paciente de demostración para que puedas explorar todas las funciones.

---

## 📁 Estructura del Proyecto

```
sistema-odontologico/
│
├── index.html               # Interfaz gráfica principal
├── Iniciar_Sistema.bat      # Acceso directo para Windows
├── README.md                # Documentación del sistema
│
├── css/
│   └── styles.css           # Estilos clínicos personalizados y reglas de impresión @media print
│
└── js/
    ├── db.js                # Motor de base de datos local (IndexedDB)
    ├── odontograma.js       # Componente SVG interactivo del odontograma FDI
    ├── pdf-export.js        # Generador de informes clínicos y exportador a PDF
    └── app.js               # Controlador de la aplicación, vistas y eventos
```
