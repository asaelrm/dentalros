/**
 * Módulo de Generación de Informes y Exportación a PDF
 * Sistema de Gestión Odontológica
 * Genera informes clínicos oficiales listos para imprimir o guardar como PDF.
 */

class PDFExporter {
  constructor() {
    this.previewModal = null;
  }

  buildInvoiceHTML(paciente, consulta, config, deliveredBy = {}) {
    const escape = window.escapeHTML || (value => String(value ?? ''));
    const invoice = consulta?.factura;
    if (!invoice) throw new Error('La consulta no tiene una factura guardada.');
    const money = centavos => (Number(centavos || 0) / 100).toFixed(2);
    const invoiceNumber = `FAC-${String(consulta.id).padStart(6, '0')}`;
    const generatedAt = new Date();
    const dateTime = value => new Date(value).toLocaleString('es-ES', { dateStyle: 'medium', timeStyle: 'short' });
    const generatedDateTime = dateTime(generatedAt);
    const recordedDateTime = dateTime(invoice.cerradaEn || invoice.actualizadaEn || invoice.creadaEn || generatedAt);
    const deliveredName = deliveredBy.displayName || deliveredBy.username || 'Usuario del sistema';
    const rows = (invoice.procedimientos || []).map((item, index) => `
      <tr style="border-bottom:1px solid #e2e8f0;">
        <td style="padding:10px 8px;text-align:center;">${index + 1}</td>
        <td style="padding:10px 8px;"><strong>${escape(item.nombre)}</strong>${item.diagnostico ? `<br><small style="color:#64748b;">${escape(item.diagnostico)}</small>` : ''}</td>
        <td style="padding:10px 8px;text-align:center;">${Number(item.cantidad)}</td>
        <td style="padding:10px 8px;text-align:right;">$${money(item.precioCentavos)}</td>
        <td style="padding:10px 8px;text-align:right;font-weight:700;">$${money(item.subtotalCentavos)}</td>
      </tr>`).join('');

    return `<div style="font-family:'Segoe UI',Arial,sans-serif;color:#1e293b;background:#fff;max-width:800px;margin:0 auto;padding:30px 36px;line-height:1.4;">
      <header style="display:flex;justify-content:space-between;align-items:center;border-bottom:3px solid #e11d48;padding-bottom:18px;gap:24px;">
        <div style="display:flex;align-items:center;gap:14px;">
          <img src="${window.LOGO_DATA_URL || 'img/logo.jpg'}" alt="DentalRos" style="width:72px;height:72px;object-fit:contain;">
          <div>
            <h1 style="margin:0;color:#881337;font-size:22px;">${escape(config?.nombreClinica || 'DentalRos')}</h1>
            <p style="margin:3px 0;font-size:12px;font-weight:700;">${escape(config?.nombreDoctor || 'Profesional tratante')}</p>
            <p style="margin:0;color:#64748b;font-size:10px;">${escape(config?.direccion || '')}</p>
            <p style="margin:0;color:#64748b;font-size:10px;">${escape(config?.telefono || '')}${config?.email ? ` · ${escape(config.email)}` : ''}</p>
          </div>
        </div>
        <div style="text-align:right;">
          <h2 style="margin:0;color:#e11d48;font-size:25px;letter-spacing:1px;">FACTURA</h2>
          <strong style="font-size:14px;">${invoiceNumber}</strong>
          <p style="margin:4px 0 0;font-size:11px;color:#64748b;">Estado: ${invoice.estado === 'cerrada' ? 'CERRADA' : 'BORRADOR'}</p>
        </div>
      </header>
      <section style="display:grid;grid-template-columns:1fr 1fr;gap:18px;margin:22px 0;padding:14px;background:#fff1f2;border-radius:8px;font-size:11px;">
        <div><strong style="color:#9f1239;">PACIENTE</strong><br><span style="font-size:14px;font-weight:700;">${escape(paciente.nombre)} ${escape(paciente.apellido)}</span><br>Cédula/DNI: ${escape(paciente.cedula || 'No especificada')}<br>Teléfono: ${escape(paciente.telefono || '-')}</div>
        <div><strong style="color:#9f1239;">DATOS DE LA FACTURA</strong><br>Fecha de consulta: ${escape(consulta.fecha || '-')}<br>Registro de factura: ${escape(recordedDateTime)}<br>Fecha y hora de emisión: ${escape(generatedDateTime)}</div>
      </section>
      <section style="margin-bottom:20px;font-size:12px;"><strong style="color:#9f1239;">DIAGNÓSTICO</strong><p style="white-space:pre-wrap;margin:6px 0;">${escape(invoice.diagnostico)}</p></section>
      <table style="width:100%;border-collapse:collapse;border:1px solid #e2e8f0;font-size:11px;">
        <thead><tr style="background:#881337;color:#fff;"><th style="padding:9px;width:7%;">#</th><th style="padding:9px;text-align:left;">Procedimiento</th><th style="padding:9px;width:12%;">Cantidad</th><th style="padding:9px;text-align:right;width:17%;">Precio</th><th style="padding:9px;text-align:right;width:17%;">Subtotal</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="5" style="padding:18px;text-align:center;color:#64748b;">Sin procedimientos registrados</td></tr>'}</tbody>
      </table>
      <div style="display:flex;justify-content:flex-end;margin-top:18px;"><div style="min-width:260px;background:#fff1f2;border:1px solid #fecdd3;padding:14px 18px;border-radius:8px;display:flex;justify-content:space-between;align-items:center;"><strong style="font-size:14px;color:#881337;">TOTAL</strong><strong style="font-size:24px;color:#047857;">$${Number(invoice.total || 0).toFixed(2)}</strong></div></div>
      <section style="display:flex;justify-content:space-between;gap:40px;margin-top:72px;text-align:center;font-size:11px;page-break-inside:avoid;">
        <div style="width:48%;border-top:1px solid #475569;padding-top:8px;"><strong>${escape(paciente.nombre)} ${escape(paciente.apellido)}</strong><br><span>Firma del paciente o responsable</span><br><small>Cédula/DNI: ${escape(paciente.cedula || '________________')}</small></div>
        <div style="width:48%;border-top:1px solid #475569;padding-top:8px;"><strong>${escape(deliveredName)}</strong><br><span>Firma del personal que entrega</span>${deliveredBy.username ? `<br><small>Usuario: @${escape(deliveredBy.username)}</small>` : ''}</div>
      </section>
      <footer style="margin-top:30px;text-align:center;border-top:1px solid #cbd5e1;padding-top:10px;font-size:10px;color:#64748b;">${escape(config?.piePagina || 'Gracias por confiar su salud dental en nosotros.')}</footer>
    </div>`;
  }

  async downloadInvoicePDF(paciente, consulta, config, deliveredBy) {
    const invoiceHtml = this.buildInvoiceHTML(paciente, consulta, config || {}, deliveredBy);
    const container = document.createElement('div');
    container.innerHTML = invoiceHtml;
    container.style.cssText = 'position:absolute;left:-9999px;top:0;width:800px;';
    document.body.appendChild(container);
    const safeId = String(paciente.cedula || paciente.id).replace(/[^a-zA-Z0-9_-]/g, '_');
    const filename = `Factura_FAC-${String(consulta.id).padStart(6, '0')}_${safeId}.pdf`;
    if (!window.html2pdf) {
      container.remove();
      throw new Error('El generador de PDF no está disponible.');
    }
    try {
      await window.html2pdf().set({
        margin: [8, 8, 8, 8], filename,
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: { scale: 2, useCORS: true },
        jsPDF: { unit: 'mm', format: 'letter', orientation: 'portrait' }
      }).from(container.firstElementChild).save();
    } finally {
      container.remove();
    }
  }

  printInvoice(paciente, consulta, config, deliveredBy) {
    const invoiceHtml = this.buildInvoiceHTML(paciente, consulta, config || {}, deliveredBy);
    const printWindow = window.open('', '_blank', 'width=900,height=800');
    if (!printWindow) throw new Error('Permite las ventanas emergentes para imprimir la factura.');
    printWindow.document.open();
    printWindow.document.write(`<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><title>Factura_FAC-${String(consulta.id).padStart(6, '0')}</title><style>@page{size:letter portrait;margin:8mm}body{margin:0;background:#fff;-webkit-print-color-adjust:exact;print-color-adjust:exact}</style></head><body>${invoiceHtml}<script>window.onload=()=>setTimeout(()=>{window.focus();window.print()},300)<\/script></body></html>`);
    printWindow.document.close();
  }

  // Genera el documento HTML completo del informe médico
  buildReportHTML(paciente, historia, consultas, odontogramaData, config) {
    const escape = window.escapeHTML || (value => String(value ?? ''));
    const sanitizeRecord = record => Object.fromEntries(
      Object.entries(record || {}).map(([key, value]) => [key, typeof value === 'string' ? escape(value) : value])
    );
    paciente = sanitizeRecord(paciente);
    historia = sanitizeRecord(historia);
    consultas = (consultas || []).map(sanitizeRecord);
    config = sanitizeRecord(config);

    const fechaHoy = new Date().toLocaleDateString('es-ES', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });

    // Procesar alertas y alergias
    const alergias = (historia && historia.alergias) ? historia.alergias.trim() : 'Ninguna declarada';
    const tieneAlergias = alergias.toLowerCase() !== 'ninguna' && alergias.toLowerCase() !== 'ninguna declarada' && alergias !== '';
    
    const enfermedades = (historia && historia.enfermedadesSistemicas) ? historia.enfermedadesSistemicas.trim() : 'Sin antecedentes sistémicos reportados';
    const medicamentos = (historia && historia.medicamentosActuales) ? historia.medicamentosActuales.trim() : 'Ninguno';
    const habitos = (historia && historia.habitos) ? historia.habitos.trim() : 'Sin hábitos reportados';
    const motivo = (historia && historia.motivoPrincipal) ? historia.motivoPrincipal.trim() : 'Revisión odontológica general';
    const diagnosticoGeneral = (historia && historia.diagnosticoGeneral) ? historia.diagnosticoGeneral.trim() : 'Evaluación clínica inicial';
    const planTratamiento = (historia && historia.planTratamiento) ? historia.planTratamiento.trim() : 'Mantenimiento preventivo e higiene';

    // Hallazgos del odontograma
    const hallazgos = [];
    if (odontogramaData && odontogramaData.piezas) {
      const p = odontogramaData.piezas;
      for (const [diente, data] of Object.entries(p)) {
        if (data.estado && data.estado !== 'sano') {
          let desc = `Pieza ${diente}: ${data.estado.toUpperCase()}`;
          const surfs = data.superficies;
          if (surfs) {
            const afectadas = Object.entries(surfs).filter(([_, val]) => val !== 'sano').map(([s, val]) => `${s} (${val})`);
            if (afectadas.length > 0) {
              desc += ` [${afectadas.join(', ')}]`;
            }
          }
          if (data.notas) desc += ` - ${data.notas}`;
          hallazgos.push(desc);
        }
      }
    }

    // Tabla de evoluciones / citas
    const consultasRows = (consultas && consultas.length > 0) ? consultas.map(c => `
      <tr style="border-bottom: 1px solid #e2e8f0;">
        <td style="padding: 8px 6px; font-size: 11px; white-space: nowrap; font-weight: bold; color: #334155;">
          ${c.fecha || '-'}
        </td>
        <td style="padding: 8px 6px; font-size: 11px; color: #1e293b;">
          <strong>${c.motivo || '-'}</strong>
        </td>
        <td style="padding: 8px 6px; font-size: 11px; color: #0f172a;">
          <span style="display:inline-block; padding: 2px 6px; background:#eff6ff; color:#1d4ed8; border-radius:4px; font-weight:600;">
            ${c.diagnostico || 'Evaluación'}
            ${c.factura?.diagnostico ? `<br><small>Factura: ${escape(c.factura.diagnostico)}</small>` : ''}
          </span>
        </td>
        <td style="padding: 8px 6px; font-size: 11px; color: #334155;">
          ${c.tratamiento || '-'}
          ${Array.isArray(c.factura?.procedimientos) ? c.factura.procedimientos.map(item => `<div>${escape(item.nombre)}${item.diagnostico ? ' · ' + escape(item.diagnostico) : ''}: ${Number(item.cantidad)} × $${(Number(item.precioCentavos) / 100).toFixed(2)} = $${(Number(item.subtotalCentavos) / 100).toFixed(2)}</div>`).join('') : ''}
        </td>
        <td style="padding: 8px 6px; font-size: 11px; color: #475569;">
          ${c.receta || '-'}
        </td>
        <td style="padding: 8px 6px; font-size: 11px; text-align: right; font-weight: bold; color: #047857;">
          ${c.factura ? `$${Number(c.factura.total).toFixed(2)} (${escape(c.factura.estado)})` : (c.costo ? `$${Number(c.costo).toFixed(2)}` : '-')}
        </td>
      </tr>
    `).join('') : `
      <tr>
        <td colspan="6" style="padding: 16px; text-align: center; color: #94a3b8; font-size: 12px; font-style: italic;">
          No se registran consultas ni tratamientos en el récord de este paciente.
        </td>
      </tr>
    `;

    return `
      <div id="pdf-document-content" style="
        font-family: 'Segoe UI', Helvetica, Arial, sans-serif;
        color: #1e293b;
        background: #ffffff;
        max-width: 800px;
        margin: 0 auto;
        padding: 24px 32px;
        line-height: 1.4;
      ">
        <!-- Membrete de la Clínica con Logo DentalRos -->
        <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #e11d48; padding-bottom: 14px; margin-bottom: 16px;">
          <div style="display: flex; align-items: center; gap: 14px;">
            <img src="${(typeof window !== 'undefined' && window.LOGO_DATA_URL) ? window.LOGO_DATA_URL : 'img/logo.jpg'}" style="height: 64px; width: auto; object-fit: contain;" alt="DentalRos" />
            <div>
              <h1 style="margin: 0; font-size: 20px; font-weight: 800; color: #0f172a; text-transform: uppercase; letter-spacing: 0.5px;">
                ${config.nombreClinica || 'DentalRos'}
              </h1>
              <div style="font-size: 11px; font-style: italic; color: #e11d48; font-weight: 700; margin-bottom: 2px;">
                Hacemos tu sonrisa florecer
              </div>
              <div style="font-size: 12px; font-weight: 600; color: #334155;">
                ${config.nombreDoctor || 'Dr. Odontólogo Tratante'} &bull; ${config.especialidad || 'Odontología General e Integral'}
              </div>
              <div style="font-size: 10.5px; color: #64748b; margin-top: 1px;">
                ${config.colegiatura ? 'Reg. Prof. / Col: ' + config.colegiatura + ' &bull; ' : ''}
                ${config.direccion || 'Dirección del consultorio'}
              </div>
            </div>
          </div>
          <div style="text-align: right; min-width: 130px;">
            <div style="background: #fff1f2; border: 1px solid #fecdd3; border-radius: 6px; padding: 6px 12px; text-align: center;">
              <div style="font-size: 10px; font-weight: bold; color: #be123c; text-transform: uppercase;">HISTORIA CLÍNICA</div>
              <div style="font-size: 16px; font-weight: 800; color: #0f172a;">#PAC-${String(paciente.id).padStart(4, '0')}</div>
            </div>
            <div style="font-size: 10px; color: #64748b; margin-top: 4px;">Fecha: ${fechaHoy}</div>
          </div>
        </div>

        <!-- Título del Documento -->
        <div style="text-align: center; margin-bottom: 16px;">
          <h2 style="margin: 0; font-size: 15px; font-weight: 800; text-transform: uppercase; color: #0f172a; letter-spacing: 1px;">
            HISTORIA CLÍNICA ODONTOLÓGICA Y EXPEDIENTE DEL PACIENTE
          </h2>
        </div>

        <!-- Alerta Médica Destacada (Si aplica) -->
        ${tieneAlergias ? `
          <div style="background: #fef2f2; border-left: 4px solid #ef4444; padding: 8px 12px; margin-bottom: 14px; border-radius: 4px;">
            <strong style="color: #b91c1c; font-size: 12px;">⚠️ ALERTA MÉDICA / ALERGIAS:</strong>
            <span style="color: #991b1b; font-size: 12px; font-weight: bold; margin-left: 6px;">${alergias}</span>
          </div>
        ` : ''}

        <!-- 1. Datos Generales del Paciente -->
        <div style="margin-bottom: 16px;">
          <div style="background: #f1f5f9; padding: 4px 8px; font-size: 11px; font-weight: 800; color: #334155; text-transform: uppercase; letter-spacing: 0.5px; border-radius: 4px; margin-bottom: 8px;">
            1. Datos de Filiación del Paciente
          </div>
          <table style="width: 100%; border-collapse: collapse; font-size: 11px;">
            <tr>
              <td style="width: 15%; padding: 4px 0; color: #64748b; font-weight: 600;">Nombre Completo:</td>
              <td style="width: 35%; padding: 4px 0; color: #0f172a; font-weight: bold;">${paciente.nombre} ${paciente.apellido}</td>
              <td style="width: 15%; padding: 4px 0; color: #64748b; font-weight: 600;">Identificación / DNI:</td>
              <td style="width: 35%; padding: 4px 0; color: #0f172a; font-weight: bold;">${paciente.cedula || 'No especificado'}</td>
            </tr>
            <tr>
              <td style="padding: 4px 0; color: #64748b; font-weight: 600;">Edad / Nacimiento:</td>
              <td style="padding: 4px 0; color: #0f172a;">${paciente.edad ? paciente.edad + ' años' : '-'} ${paciente.fechaNacimiento ? '(' + paciente.fechaNacimiento + ')' : ''}</td>
              <td style="padding: 4px 0; color: #64748b; font-weight: 600;">Sexo:</td>
              <td style="padding: 4px 0; color: #0f172a;">${paciente.sexo || '-'}</td>
            </tr>
            <tr>
              <td style="padding: 4px 0; color: #64748b; font-weight: 600;">Teléfono:</td>
              <td style="padding: 4px 0; color: #0f172a; font-weight: 600;">${paciente.telefono || '-'}</td>
              <td style="padding: 4px 0; color: #64748b; font-weight: 600;">Correo Electrónico:</td>
              <td style="padding: 4px 0; color: #0f172a;">${paciente.email || '-'}</td>
            </tr>
            <tr>
              <td style="padding: 4px 0; color: #64748b; font-weight: 600;">Dirección:</td>
              <td style="padding: 4px 0; color: #0f172a;">${paciente.direccion || '-'}</td>
              <td style="padding: 4px 0; color: #64748b; font-weight: 600;">Ocupación:</td>
              <td style="padding: 4px 0; color: #0f172a;">${paciente.ocupacion || '-'}</td>
            </tr>
            <tr>
              <td style="padding: 4px 0; color: #64748b; font-weight: 600;">Contacto Emergencia:</td>
              <td colspan="3" style="padding: 4px 0; color: #0f172a;">
                ${paciente.contactoEmergencia || '-'} ${paciente.telefonoEmergencia ? ' (Tel: ' + paciente.telefonoEmergencia + ')' : ''}
              </td>
            </tr>
          </table>
        </div>

        <!-- 2. Anamnesis y Antecedentes Médicos -->
        <div style="margin-bottom: 16px;">
          <div style="background: #f1f5f9; padding: 4px 8px; font-size: 11px; font-weight: 800; color: #334155; text-transform: uppercase; letter-spacing: 0.5px; border-radius: 4px; margin-bottom: 8px;">
            2. Anamnesis y Estado de Salud General
          </div>
          <table style="width: 100%; border-collapse: collapse; font-size: 11px;">
            <tr>
              <td style="width: 25%; padding: 4px 0; color: #64748b; font-weight: 600;">Motivo de Consulta:</td>
              <td colspan="3" style="padding: 4px 0; color: #0f172a; font-weight: 600;">${motivo}</td>
            </tr>
            <tr>
              <td style="padding: 4px 0; color: #64748b; font-weight: 600;">Alergias a Fármacos:</td>
              <td style="width: 25%; padding: 4px 0; color: ${tieneAlergias ? '#dc2626' : '#0f172a'}; font-weight: ${tieneAlergias ? 'bold' : 'normal'};">${alergias}</td>
              <td style="width: 25%; padding: 4px 0; color: #64748b; font-weight: 600;">Enfermedades Sistémicas:</td>
              <td style="width: 25%; padding: 4px 0; color: #0f172a;">${enfermedades}</td>
            </tr>
            <tr>
              <td style="padding: 4px 0; color: #64748b; font-weight: 600;">Medicamentos en Uso:</td>
              <td style="padding: 4px 0; color: #0f172a;">${medicamentos}</td>
              <td style="padding: 4px 0; color: #64748b; font-weight: 600;">Hábitos (Fumar/Bruxismo):</td>
              <td style="padding: 4px 0; color: #0f172a;">${habitos}</td>
            </tr>
          </table>
        </div>

        <!-- 3. Diagnóstico Odontológico y Plan de Tratamiento -->
        <div style="margin-bottom: 16px;">
          <div style="background: #f1f5f9; padding: 4px 8px; font-size: 11px; font-weight: 800; color: #334155; text-transform: uppercase; letter-spacing: 0.5px; border-radius: 4px; margin-bottom: 8px;">
            3. Diagnóstico Clínico y Plan Terapéutico
          </div>
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; font-size: 11px;">
            <div style="background: #f8fafc; border: 1px solid #e2e8f0; padding: 8px 10px; border-radius: 4px;">
              <strong style="color: #0369a1; display: block; margin-bottom: 4px;">DIAGNÓSTICO ODONTOLÓGICO:</strong>
              <div style="color: #0f172a; white-space: pre-line;">${diagnosticoGeneral}</div>
            </div>
            <div style="background: #f8fafc; border: 1px solid #e2e8f0; padding: 8px 10px; border-radius: 4px;">
              <strong style="color: #047857; display: block; margin-bottom: 4px;">PLAN DE TRATAMIENTO PROPUESTO:</strong>
              <div style="color: #0f172a; white-space: pre-line;">${planTratamiento}</div>
            </div>
          </div>
        </div>

        <!-- 4. Resumen del Odontograma -->
        <div style="margin-bottom: 16px;">
          <div style="background: #f1f5f9; padding: 4px 8px; font-size: 11px; font-weight: 800; color: #334155; text-transform: uppercase; letter-spacing: 0.5px; border-radius: 4px; margin-bottom: 8px;">
            4. Hallazgos del Odontograma
          </div>
          <div style="font-size: 11px; color: #334155;">
            ${hallazgos.length > 0 ? `
              <div style="display: flex; flex-wrap: wrap; gap: 6px;">
                ${hallazgos.map(h => `<span style="background: #f1f5f9; border: 1px solid #cbd5e1; padding: 3px 8px; border-radius: 4px; font-size: 10px;">${escape(h)}</span>`).join('')}
              </div>
            ` : '<div style="color: #64748b; font-style: italic;">Sin anomalías registradas o piezas completamente sanas.</div>'}
          </div>
        </div>

        <!-- 5. Récord Cronológico de Consultas y Evolución -->
        <div style="margin-bottom: 24px;">
          <div style="background: #f1f5f9; padding: 4px 8px; font-size: 11px; font-weight: 800; color: #334155; text-transform: uppercase; letter-spacing: 0.5px; border-radius: 4px; margin-bottom: 8px;">
            5. Récord Cronológico de Evolución y Procedimientos Realizados
          </div>
          <table style="width: 100%; border-collapse: collapse; border: 1px solid #e2e8f0;">
            <thead>
              <tr style="background: #f8fafc; border-bottom: 2px solid #cbd5e1; text-align: left; font-size: 10px; text-transform: uppercase; color: #475569;">
                <th style="padding: 6px;">Fecha</th>
                <th style="padding: 6px;">Motivo</th>
                <th style="padding: 6px;">Diagnóstico</th>
                <th style="padding: 6px;">Tratamiento Realizado</th>
                <th style="padding: 6px;">Prescripción / Indicación</th>
                <th style="padding: 6px; text-align: right;">Honorarios</th>
              </tr>
            </thead>
            <tbody>
              ${consultasRows}
            </tbody>
          </table>
        </div>

        <!-- 6. Firmas Legales y de Conformidad -->
        <div style="margin-top: 36px; display: flex; justify-content: space-around; text-align: center; font-size: 11px; color: #475569;">
          <div style="width: 40%;">
            <div style="border-top: 1px solid #94a3b8; padding-top: 6px; margin-top: 40px;">
              <strong>${config.nombreDoctor || 'Dr. Odontólogo Tratante'}</strong><br/>
              <span>${config.especialidad || 'Odontología Especializada'}</span><br/>
              <span>${config.colegiatura ? 'Reg. Prof: ' + config.colegiatura : 'Firma y Sello Profesional'}</span>
            </div>
          </div>
          <div style="width: 40%;">
            <div style="border-top: 1px solid #94a3b8; padding-top: 6px; margin-top: 40px;">
              <strong>${paciente.nombre} ${paciente.apellido}</strong><br/>
              <span>DNI/Cédula: ${paciente.cedula || '................................'}</span><br/>
              <span>Firma del Paciente / Consentimiento</span>
            </div>
          </div>
        </div>

        <!-- Pie de página informativo -->
        <div style="margin-top: 24px; border-top: 1px solid #e2e8f0; padding-top: 8px; text-align: center; font-size: 10px; color: #94a3b8;">
          ${config.piePagina || 'Documento clínico generado para fines asistenciales y de registro legal médico-odontológico.'} &bull; Teléfono: ${config.telefono || '-'}
        </div>
      </div>
    `;
  }

  // Previsualiza e imprime o guarda directamente en PDF
  async printOrExport(paciente, historia, consultas, odontogramaData, config) {
    const reportHtml = this.buildReportHTML(paciente, historia, consultas, odontogramaData, config);

    // Abrir una ventana limpia dedicada para impresión de máxima calidad y compatibilidad
    const printWin = window.open('', '_blank', 'width=900,height=800');
    if (!printWin) {
      alert('Por favor permite las ventanas emergentes (popups) para poder imprimir o guardar el PDF.');
      return;
    }

    printWin.document.open();
    printWin.document.write(`
      <!DOCTYPE html>
      <html lang="es">
      <head>
        <meta charset="UTF-8" />
        <title>Historia_Clinica_${paciente.cedula || paciente.id}_${paciente.nombre}_${paciente.apellido}</title>
        <style>
          @page {
            size: letter portrait;
            margin: 10mm 12mm 10mm 12mm;
          }
          body {
            margin: 0;
            padding: 0;
            background: #ffffff;
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }
        </style>
      </head>
      <body>
        ${reportHtml}
        <script>
          window.onload = function() {
            setTimeout(function() {
              window.focus();
              window.print();
            }, 350);
          };
        </script>
      </body>
      </html>
    `);
    printWin.document.close();
  }

  // Descarga directa con html2pdf si está disponible en la ventana
  async downloadDirectPDF(paciente, historia, consultas, odontogramaData, config) {
    const reportHtml = this.buildReportHTML(paciente, historia, consultas, odontogramaData, config);
    const container = document.createElement('div');
    container.innerHTML = reportHtml;
    container.style.position = 'absolute';
    container.style.left = '-9999px';
    container.style.top = '0';
    document.body.appendChild(container);

    const filename = `Historia_Clinica_${paciente.cedula || paciente.id}_${paciente.nombre}_${paciente.apellido}.pdf`.replace(/\s+/g, '_');

    if (window.html2pdf) {
      const opt = {
        margin: [10, 10, 10, 10],
        filename: filename,
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: { scale: 2, useCORS: true },
        jsPDF: { unit: 'mm', format: 'letter', orientation: 'portrait' }
      };

      try {
        await window.html2pdf().set(opt).from(container.firstElementChild).save();
      } catch (err) {
        console.warn('Fallo html2pdf, recurriendo a impresión nativa:', err);
        this.printOrExport(paciente, historia, consultas, odontogramaData, config);
      } finally {
        container.remove();
      }
    } else {
      // Si no se ha cargado html2pdf, usar impresión del navegador (Guardar como PDF)
      container.remove();
      this.printOrExport(paciente, historia, consultas, odontogramaData, config);
    }
  }
}

window.pdfExporter = new PDFExporter();
