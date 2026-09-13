/**
 * Controlador Principal de la Aplicación Odontológica
 * Sistema de Gestión de Pacientes e Historia Clínica
 */

class OdontoApp {
  constructor() {
    this.currentPacienteId = null;
    this.currentPaciente = null;
    this.currentHistoria = null;
    this.currentAttachments = [];
    this.currentConsultas = [];
    this.currentOdontograma = null;
    this.insurers = [];
    this.config = null;
    this.odontogramaComponent = null;
    this.activeTab = 'historia'; // 'historia' | 'odontograma' | 'consultas'
  }

  canEdit() {
    return Boolean(window.authManager?.canEdit());
  }

  isAdmin() {
    return Boolean(window.authManager?.isAdmin());
  }

  async init() {
    // 1. Inicializar componente de Odontograma y eventos de UI
    try {
      this.odontogramaComponent = new Odontograma('odontograma-canvas');
    } catch (e) {
      console.warn('Aviso inicializando Odontograma:', e);
    }
    this.bindEvents();
    this.applyPermissions();

    try {
      // 2. Inicializar el cliente de datos protegido
      await window.odontoDB.init();
      await this.loadInsurers();

      // 3. Cargar configuración
      this.config = await window.odontoDB.getConfig();
      this.applyConfigUI();

      // 4. Cargar lista de pacientes
      const pacientes = await window.odontoDB.getPacientes();
      await this.loadPacientes();

      // 5. Seleccionar el primer paciente si existe, o mostrar bienvenida
      if (pacientes && pacientes.length > 0) {
        await this.selectPaciente(pacientes[0].id);
      } else {
        document.getElementById('vista-bienvenida')?.classList.remove('hidden');
        document.getElementById('vista-detalle-paciente')?.classList.add('hidden');
      }

    } catch (error) {
      console.error('Error al inicializar el almacenamiento:', error);
      try {
        await this.loadPacientes();
      } catch (e) {}
      document.getElementById('vista-bienvenida')?.classList.remove('hidden');
      document.getElementById('vista-detalle-paciente')?.classList.add('hidden');
    }
  }

  applyPermissions() {
    const canEdit = this.canEdit();
    const isAdmin = this.isAdmin();

    ['btn-eliminar-paciente']
      .forEach(id => {
        const element = document.getElementById(id);
        if (element) element.hidden = !canEdit;
      });

    ['btn-exportar-backup', 'btn-backup-sqlite', 'label-importar-backup', 'btn-abrir-config']
      .forEach(id => {
        const element = document.getElementById(id);
        if (element) element.hidden = !isAdmin;
      });
    const cashButton = document.getElementById('btn-cash');
    if (cashButton) cashButton.hidden = !window.authManager.hasPermission('cash.read');

    for (const id of ['btn-nuevo-paciente', 'btn-editar-paciente', 'btn-registrar-primer-paciente']) {
      const button = document.getElementById(id);
      if (button) button.hidden = !window.authManager.hasPermission('patients.write');
    }
    document.getElementById('btn-nueva-consulta').hidden = !window.authManager.hasPermission('consultations.write');
    const invoiceTab = document.querySelector('.tab-btn[data-tab="facturas"]');
    const invoicePane = document.getElementById('tab-pane-facturas');
    const canAccessInvoices = window.authManager.hasPermission('invoice.write');
    if (invoiceTab) invoiceTab.hidden = !canAccessInvoices;
    if (invoicePane && !canAccessInvoices) invoicePane.classList.add('hidden');
    const historiaForm = document.getElementById('form-historia-clinica');
    if (historiaForm) {
      historiaForm.querySelectorAll('input, textarea, select, button[type="submit"]').forEach(control => {
        control.disabled = !canEdit;
      });
      historiaForm.classList.toggle('read-only-form', !canEdit);
    }
    const attachmentLabel = document.getElementById('label-upload-attachment');
    if (attachmentLabel) attachmentLabel.hidden = !canEdit;

    const saveStatus = document.getElementById('odontograma-save-status');
    if (saveStatus) saveStatus.textContent = canEdit ? 'Guardado automático' : 'Modo solo lectura';
  }

  // --- CONFIGURACIÓN DE UI ---
  applyConfigUI() {
    const clinicaNameEls = document.querySelectorAll('.clinic-name-display');
    clinicaNameEls.forEach(el => el.textContent = this.config.nombreClinica || 'Centro Odontológico');

    const doctorNameEls = document.querySelectorAll('.doctor-name-display');
    doctorNameEls.forEach(el => el.textContent = this.config.nombreDoctor || 'Dr. Tratante');

    // Llenar formulario de configuración
    const f = document.getElementById('form-config');
    if (f) {
      f.nombreClinica.value = this.config.nombreClinica || '';
      f.nombreDoctor.value = this.config.nombreDoctor || '';
      f.especialidad.value = this.config.especialidad || '';
      f.colegiatura.value = this.config.colegiatura || '';
      f.telefono.value = this.config.telefono || '';
      f.email.value = this.config.email || '';
      f.direccion.value = this.config.direccion || '';
      f.piePagina.value = this.config.piePagina || '';
      f.fiscalEnabled.checked = false; f.remindersEnabled.checked = false; f.permanentPublishingEnabled.checked = false;
      f.rnc.value = this.config.rnc || ''; f.ncfSequence.value = this.config.ncfSequence || ''; f.reminderChannel.value = this.config.reminderChannel || ''; f.publicDomain.value = this.config.publicDomain || '';
    }
  }

  // --- CONTROL DE VISTA MÓVIL (< 768px) ---
  setMobileView(view) {
    const aside = document.getElementById('panel-directorio');
    const section = document.getElementById('panel-expediente');
    const btnDir = document.getElementById('btn-mobile-nav-directorio');
    const btnExp = document.getElementById('btn-mobile-nav-expediente');

    if (view === 'directorio') {
      aside?.classList.remove('hidden');
      section?.classList.add('hidden');
      btnDir?.classList.add('bg-rose-600', 'text-white', 'shadow-sm');
      btnDir?.classList.remove('text-rose-950', 'bg-white/60');
      btnExp?.classList.remove('bg-rose-600', 'text-white', 'shadow-sm');
      btnExp?.classList.add('text-rose-950', 'bg-white/60');
    } else {
      aside?.classList.add('hidden');
      section?.classList.remove('hidden');
      btnExp?.classList.add('bg-rose-600', 'text-white', 'shadow-sm');
      btnExp?.classList.remove('text-rose-950', 'bg-white/60');
      btnDir?.classList.remove('bg-rose-600', 'text-white', 'shadow-sm');
      btnDir?.classList.add('text-rose-950', 'bg-white/60');
    }
  }

  // --- CARGA Y SELECCIÓN DE PACIENTES ---
  async loadPacientes(filtro = '') {
    const pacientes = await window.odontoDB.getPacientes();
    const listEl = document.getElementById('lista-pacientes');
    const countEl = document.getElementById('total-pacientes-count');
    const mobileCountEl = document.getElementById('mobile-pacientes-count');
    if (!listEl) return;

    let filtrados = pacientes;
    if (filtro.trim() !== '') {
      const q = filtro.toLowerCase().trim();
      filtrados = pacientes.filter(p => 
        (p.nombre && p.nombre.toLowerCase().includes(q)) ||
        (p.apellido && p.apellido.toLowerCase().includes(q)) ||
        (p.cedula && p.cedula.toLowerCase().includes(q)) ||
        (p.telefono && p.telefono.includes(q))
      );
    }

    if (countEl) countEl.textContent = `${filtrados.length}`;
    if (mobileCountEl) mobileCountEl.textContent = `${filtrados.length}`;

    if (filtrados.length === 0) {
      listEl.innerHTML = `
        <div class="p-6 text-center text-slate-400 text-xs">
          <svg class="w-9 h-9 mx-auto mb-2 text-rose-300/80" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"></path>
          </svg>
          No se encontraron pacientes.
        </div>
      `;
      return;
    }

    const escape = window.escapeHTML;
    listEl.innerHTML = filtrados.map(p => {
      const isSelected = this.currentPacienteId === p.id;
      return `
        <div class="paciente-item p-3.5 rounded-2xl cursor-pointer transition border ${isSelected ? 'bg-rose-100/90 border-rose-300/90 text-rose-950 shadow-sm' : 'glass-card hover:bg-rose-50/60 border-rose-100/70 text-slate-800'}" data-id="${p.id}">
          <div class="flex items-center justify-between gap-1.5">
            <div class="font-extrabold text-sm truncate ${isSelected ? 'text-rose-950' : 'text-slate-800'}">
              ${escape(p.nombre)} ${escape(p.apellido)}
            </div>
            <span class="text-[10px] font-mono font-black px-2 py-0.5 rounded-full ${isSelected ? 'bg-rose-200/90 text-rose-950' : 'bg-rose-50 text-rose-800 border border-rose-200/60'}">
              #${String(p.id).padStart(3, '0')}
            </span>
          </div>
          <div class="text-xs text-slate-500 mt-1 flex items-center gap-1.5 flex-wrap">
            <span>DNI: ${escape(p.cedula || 'N/A')}</span>
            <span>&bull;</span>
            <span>${p.edad ? p.edad + ' años' : 'Edad N/A'}</span>
          </div>
          ${p.telefono ? `
            <div class="text-[11px] text-rose-700/80 font-medium mt-1 flex items-center gap-1">
              Tel: ${escape(p.telefono)}
            </div>
          ` : ''}
        </div>
      `;
    }).join('');

    // Adjuntar evento de selección
    listEl.querySelectorAll('.paciente-item').forEach(item => {
      item.addEventListener('click', () => {
        const id = Number(item.dataset.id);
        this.selectPaciente(id);
      });
    });
  }

  async selectPaciente(id) {
    this.currentPacienteId = id;
    this.currentPaciente = await window.odontoDB.getPaciente(id);
    if (!this.currentPaciente) return;

    this.currentHistoria = await window.odontoDB.getHistoria(id) || {
      pacienteId: id,
      motivoPrincipal: '',
      alergias: '',
      enfermedadesSistemicas: '',
      medicamentosActuales: '',
      intervencionesPrevias: '',
      habitos: '',
      diagnosticoGeneral: '',
      planTratamiento: ''
    };

    this.currentConsultas = await window.odontoDB.getConsultas(id);
    this.currentAttachments = await window.odontoDB.getAdjuntos(id);
    this.currentOdontograma = await window.odontoDB.getOdontograma(id) || {
      pacienteId: id,
      piezas: {},
      notasGenerales: ''
    };

    // Actualizar elementos visuales
    this.renderPacienteHeader();
    this.renderHistoriaClinicaForm();
    this.renderClinicalAttachments();
    this.renderConsultasTimeline();
    this.renderFacturas();
    
    // Inicializar odontograma del paciente
    if (this.odontogramaComponent) {
      this.odontogramaComponent.init(
        id,
        this.currentOdontograma.piezas,
        this.canEdit() ? async (piezasActualizadas) => {
          await window.odontoDB.saveOdontograma(this.currentPacienteId, piezasActualizadas);
          this.currentOdontograma.piezas = piezasActualizadas;
        } : null,
        !this.canEdit()
      );
    }

    // Resaltar en la lista lateral
    this.loadPacientes(document.getElementById('input-buscar-paciente')?.value || '');

    // Mostrar sección de detalle de paciente si estaba oculta
    const vistaDetalle = document.getElementById('vista-detalle-paciente');
    const vistaBienvenida = document.getElementById('vista-bienvenida');
    if (vistaBienvenida) vistaBienvenida.classList.add('hidden');
    if (vistaDetalle) {
      vistaDetalle.classList.remove('hidden');
      vistaDetalle.classList.add('flex');
    }

    // En pantallas móviles (< 768px), cambiar automáticamente a la vista de expediente
    if (window.innerWidth < 768) {
      this.setMobileView('expediente');
    }

  }

  renderPacienteHeader() {
    const p = this.currentPaciente;
    if (!p) return;

    document.getElementById('paciente-nombre-header').textContent = `${p.nombre} ${p.apellido}`;
    document.getElementById('paciente-id-badge').textContent = `HISTORIA #PAC-${String(p.id).padStart(4, '0')}`;
    
    const infoMeta = document.getElementById('paciente-meta-header');
    const escape = window.escapeHTML;
    infoMeta.innerHTML = `
      <span><strong>DNI/Cédula:</strong> ${escape(p.cedula || 'No especificada')}</span>
      <span>&bull;</span>
      <span><strong>Edad:</strong> ${p.edad ? p.edad + ' años' : '-'}</span>
      <span>&bull;</span>
      <span><strong>Sexo:</strong> ${escape(p.sexo || '-')}</span>
      <span>&bull;</span>
      <span><strong>Teléfono:</strong> ${escape(p.telefono || '-')}</span>
      ${p.email ? `<span>&bull;</span><span><strong>Email:</strong> ${escape(p.email)}</span>` : ''}
      <span>&bull;</span>
      <span><strong>Seguro/ARS:</strong> ${escape(p.insuranceName || 'Sin especificar')}</span>
      ${p.affiliateNumber ? `<span>&bull;</span><span><strong>Afiliado/carnet:</strong> ${escape(p.affiliateNumber)}</span>` : ''}
      ${p.authorizationNumber ? `<span>&bull;</span><span><strong>Autorización:</strong> ${escape(p.authorizationNumber)}</span>` : ''}
    `;

    // Alerta de Alergia
    const alertaBox = document.getElementById('paciente-alerta-alergias');
    const h = this.currentHistoria;
    const alergias = (h && h.alergias) ? h.alergias.trim() : '';
    const tieneAlergias = alergias && alergias.toLowerCase() !== 'ninguna' && alergias.toLowerCase() !== 'ninguna declarada';

    if (tieneAlergias) {
      alertaBox.classList.remove('hidden');
      document.getElementById('alerta-alergias-texto').textContent = `ALERTA: Paciente alérgico a "${alergias}".`;
    } else {
      alertaBox.classList.add('hidden');
    }
  }

  renderHistoriaClinicaForm() {
    const h = this.currentHistoria;
    const f = document.getElementById('form-historia-clinica');
    if (!f) return;

    const p = this.currentPaciente;
    const insuranceSummary = document.getElementById('history-insurance-summary');
    if (insuranceSummary) insuranceSummary.innerHTML = `<p class="section-eyebrow">Cobertura del paciente</p><div class="flex flex-wrap gap-x-6 gap-y-1 mt-1 text-sm"><span><strong>Seguro/ARS:</strong> ${window.escapeHTML(p.insuranceName || 'Sin especificar')}</span><span><strong>Afiliado/carnet:</strong> ${window.escapeHTML(p.affiliateNumber || 'No aplica')}</span>${p.policyNumber ? `<span><strong>Póliza:</strong> ${window.escapeHTML(p.policyNumber)}</span>` : ''}${p.authorizationNumber ? `<span><strong>Autorización:</strong> ${window.escapeHTML(p.authorizationNumber)}</span>` : ''}</div>`;

    f.motivoPrincipal.value = h.motivoPrincipal || '';
    f.alergias.value = h.alergias || '';
    f.enfermedadesSistemicas.value = h.enfermedadesSistemicas || '';
    f.medicamentosActuales.value = h.medicamentosActuales || '';
    f.intervencionesPrevias.value = h.intervencionesPrevias || '';
    f.habitos.value = h.habitos || '';
    f.diagnosticoGeneral.value = h.diagnosticoGeneral || '';
    f.planTratamiento.value = h.planTratamiento || '';
  }

  renderClinicalAttachments() {
    const list = document.getElementById('clinical-attachments-list');
    if (!list) return;
    const escape = window.escapeHTML;
    if (!this.currentAttachments.length) {
      list.innerHTML = '<div class="sm:col-span-2 lg:col-span-3 p-5 rounded-2xl border border-dashed border-rose-200 text-center text-xs text-slate-500">No hay documentos ni imágenes adjuntas.</div>';
      return;
    }
    list.innerHTML = this.currentAttachments.map(item => {
      const isImage = item.mimeType.startsWith('image/');
      const url = window.odontoDB.getAdjuntoUrl(item.id);
      const size = item.sizeBytes < 1048576 ? `${Math.ceil(item.sizeBytes / 1024)} KB` : `${(item.sizeBytes / 1048576).toFixed(1)} MB`;
      return `<article class="overflow-hidden rounded-2xl border border-rose-200 bg-white shadow-sm">
        ${isImage ? `<a href="${url}" target="_blank" rel="noopener"><img src="${url}" alt="${escape(item.filename)}" class="w-full h-36 object-cover bg-slate-100"></a>` : `<a href="${url}" target="_blank" rel="noopener" class="h-36 flex items-center justify-center bg-rose-50 text-5xl">📄</a>`}
        <div class="p-3"><p class="font-black text-sm text-rose-950 truncate" title="${escape(item.filename)}">${escape(item.filename)}</p>
        <p class="text-[11px] text-slate-500 mt-1">${size} · ${escape(item.uploadedByName)}</p>
        <div class="flex gap-2 mt-3"><a href="${url}" target="_blank" rel="noopener" class="secondary-button flex-1 text-center">Abrir</a>${this.canEdit() ? `<button type="button" class="btn-delete-attachment secondary-button text-rose-700" data-id="${Number(item.id)}">Eliminar</button>` : ''}</div></div>
      </article>`;
    }).join('');
    list.querySelectorAll('.btn-delete-attachment').forEach(button => button.addEventListener('click', async () => {
      if (!confirm('¿Deseas eliminar este archivo del expediente clínico?')) return;
      try {
        await window.odontoDB.deleteAdjunto(button.dataset.id);
        this.currentAttachments = await window.odontoDB.getAdjuntos(this.currentPacienteId);
        this.renderClinicalAttachments();
        this.showToast('Archivo eliminado del expediente.');
      } catch (error) { this.showToast(error.message, 'error'); }
    }));
  }

  renderConsultasTimeline() {
    const listEl = document.getElementById('consultas-timeline');
    const countBadge = document.getElementById('consultas-count-badge');
    if (!listEl) return;

    const consultas = this.currentConsultas;
    if (countBadge) countBadge.textContent = consultas.length;

    if (consultas.length === 0) {
      listEl.innerHTML = `
        <div class="text-center py-10 glass-card rounded-2xl border border-dashed border-rose-200 text-slate-400">
          <p class="font-bold text-xs text-rose-900/80">No hay consultas registradas para este paciente.</p>
          <p class="text-[11px] text-slate-400 mt-1">${this.canEdit() ? 'Usa "+ Registrar Consulta" para añadir la primera visita o tratamiento.' : 'No existen visitas o tratamientos para mostrar.'}</p>
        </div>
      `;
      return;
    }

    const escape = window.escapeHTML;
    listEl.innerHTML = consultas.map(c => `
      <div class="consulta-card glass-card p-4 sm:p-5 rounded-2xl border border-rose-200/70 shadow-sm relative transition">
        <div class="flex flex-wrap items-center justify-between gap-2 border-b border-rose-100/80 pb-3 mb-3">
          <div class="flex items-center gap-2.5">
            <span class="w-2.5 h-2.5 rounded-full bg-rose-500 shadow-sm"></span>
            <span class="font-black text-slate-900 text-xs sm:text-sm">${escape(c.fecha)}</span>
            <span class="text-[10px] sm:text-xs font-black px-2.5 py-0.5 rounded-full bg-rose-100 text-rose-900 border border-rose-200/80 shadow-xs">
              ${escape(c.diagnostico || 'Atención Clínica')}
            </span>
          </div>
          <div class="flex items-center gap-2">
            ${c.factura ? `<span class="text-xs font-black px-2.5 py-0.5 rounded-xl border ${c.factura.estado === 'cerrada' ? 'bg-slate-100 text-slate-700' : 'bg-amber-50 text-amber-800'}">Factura ${escape(c.factura.estado)}</span><span class="text-xs sm:text-sm font-black text-emerald-800 bg-emerald-50 px-2.5 py-0.5 rounded-xl border border-emerald-200">$${Number(c.factura.total).toFixed(2)}</span>` : (c.costo ? `<span class="text-xs font-black text-emerald-800">$${Number(c.costo).toFixed(2)} · anterior</span>` : '')}
            <button type="button" class="btn-open-factura secondary-button" data-id="${Number(c.id)}">${c.factura ? 'Ver factura' : 'Crear factura'}</button>
            ${this.canEdit() ? `<button type="button" class="btn-eliminar-consulta text-slate-400 hover:text-rose-600 text-xs p-1.5 rounded-lg hover:bg-rose-50 transition" data-id="${Number(c.id)}" title="Eliminar consulta">Eliminar</button>` : ''}
          </div>
        </div>

        ${Array.isArray(c.procedimientos) && c.procedimientos.length ? `<table class="procedure-detail"><thead><tr><th>Procedimiento / diagnóstico</th><th>Cant.</th><th>Precio</th><th>Subtotal</th></tr></thead><tbody>${c.procedimientos.map(item => `<tr><td>${escape(item.nombre)}${item.diagnostico ? `<br><small>${escape(item.diagnostico)}</small>` : ''}</td><td>${Number(item.cantidad)}</td><td>$${(Number(item.precioCentavos) / 100).toFixed(2)}</td><td>$${(Number(item.subtotalCentavos) / 100).toFixed(2)}</td></tr>`).join('')}</tbody></table>` : ''}
        <div class="grid grid-cols-1 md:grid-cols-2 gap-3 sm:gap-4 text-xs">
          <div>
            <strong class="text-rose-900/80 uppercase tracking-wider text-[10px] font-black block mb-1">Motivo / Síntomas:</strong>
            <p class="text-slate-800 font-semibold leading-relaxed">${escape(c.motivo || 'Revisión general')}</p>
          </div>
          <div>
            <strong class="text-rose-900/80 uppercase tracking-wider text-[10px] font-black block mb-1">Tratamiento Realizado:</strong>
            <p class="text-slate-800 leading-relaxed">${escape(c.tratamiento || 'Ninguno especificado')}</p>
          </div>
        </div>

        ${c.receta ? `
          <div class="mt-3 p-3 bg-rose-50/70 border border-rose-200/70 rounded-xl text-xs">
            <strong class="text-rose-950 font-black flex items-center gap-1.5 mb-1">
              💊 Prescripción / Receta:
            </strong>
            <p class="text-slate-800 font-medium whitespace-pre-line">${escape(c.receta)}</p>
          </div>
        ` : ''}

        ${(c.observaciones || c.proximaCita) ? `
          <div class="mt-2 text-xs text-slate-500 flex flex-wrap justify-between gap-2 pt-2 border-t border-rose-100/60 font-medium">
            <span>${c.observaciones ? 'Obs: ' + escape(c.observaciones) : ''}</span>
            ${c.proximaCita ? `<span class="font-bold text-rose-900">Próxima cita: ${escape(c.proximaCita)}</span>` : ''}
          </div>
        ` : ''}
      </div>
    `).join('');

    // Eventos de eliminación de consulta
    listEl.querySelectorAll('.btn-eliminar-consulta').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (confirm('¿Estás seguro de que deseas eliminar este registro de consulta?')) {
          await window.odontoDB.deleteConsulta(btn.dataset.id);
          this.currentConsultas = await window.odontoDB.getConsultas(this.currentPacienteId);
          this.renderConsultasTimeline();
          this.renderFacturas();
          this.showToast('Consulta eliminada del récord.');
        }
      });
    });
    listEl.querySelectorAll('.btn-open-factura').forEach(btn => {
      btn.addEventListener('click', () => this.openFacturaModal(Number(btn.dataset.id)));
    });
  }

  renderFacturas() {
    const list = document.getElementById('facturas-list');
    const badge = document.getElementById('facturas-count-badge');
    if (!list) return;
    const consultations = this.currentConsultas || [];
    const invoices = consultations.filter(item => item.factura);
    if (badge) badge.textContent = String(invoices.length);
    if (!consultations.length) {
      list.innerHTML = '<div class="glass-panel p-6 rounded-3xl text-center text-slate-500">Primero registra una consulta clínica para poder crear su factura.</div>';
      return;
    }
    const escape = window.escapeHTML;
    list.innerHTML = consultations.map(consultation => {
      const invoice = consultation.factura;
      const status = invoice?.estado || 'pendiente';
      const canCreate = window.authManager.hasPermission('invoice.write');
      return `<article class="glass-card p-4 sm:p-5 rounded-2xl border border-rose-200/70 flex flex-wrap items-center justify-between gap-4">
        <div>
          <p class="text-xs text-slate-500">Consulta del ${escape(consultation.fecha || 'sin fecha')}</p>
          <h4 class="font-black text-rose-950 mt-1">${invoice ? escape(invoice.diagnostico) : 'Factura pendiente de preparar'}</h4>
          <span class="invoice-status invoice-status-${status}">${status === 'cerrada' ? 'Cerrada' : status === 'abierta' ? 'Borrador abierto' : 'Pendiente'}</span>
        </div>
        <div class="text-right">
          <strong class="block text-xl text-emerald-800">${invoice ? `$${Number(invoice.total).toFixed(2)}` : '—'}</strong>
          ${invoice || canCreate ? `<button type="button" class="btn-tab-factura btn-primary px-4 py-2 rounded-xl mt-2" data-id="${Number(consultation.id)}">${invoice ? 'Abrir factura' : 'Crear factura'}</button>` : ''}
        </div>
      </article>`;
    }).join('');
    list.querySelectorAll('.btn-tab-factura').forEach(button => {
      button.addEventListener('click', () => this.openFacturaModal(Number(button.dataset.id)));
    });
  }

  // --- NAVEGACIÓN ENTRE PESTAÑAS (HISTORIA, ODONTOGRAMA, CONSULTAS) ---
  switchTab(tabName) {
    this.activeTab = tabName;
    document.querySelectorAll('.tab-btn').forEach(btn => {
      if (btn.dataset.tab === tabName) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    });

    document.querySelectorAll('.tab-content').forEach(content => {
      if (content.id === `tab-pane-${tabName}`) {
        content.classList.remove('hidden');
      } else {
        content.classList.add('hidden');
      }
    });
  }

  // --- VINCULACIÓN DE EVENTOS DEL DOM ---
  bindEvents() {
    // 0. Navegación móvil (Selector Directorio vs Expediente)
    const btnMobileDir = document.getElementById('btn-mobile-nav-directorio');
    const btnMobileExp = document.getElementById('btn-mobile-nav-expediente');
    if (btnMobileDir) {
      btnMobileDir.addEventListener('click', () => this.setMobileView('directorio'));
    }
    if (btnMobileExp) {
      btnMobileExp.addEventListener('click', () => this.setMobileView('expediente'));
    }

    // 1. Buscador en tiempo real de pacientes
    const searchInput = document.getElementById('input-buscar-paciente');
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        this.loadPacientes(e.target.value);
      });
    }

    // 2. Botón Nuevo Paciente (Abre Modal)
    const btnNuevoPaciente = document.getElementById('btn-nuevo-paciente');
    if (btnNuevoPaciente) {
      btnNuevoPaciente.addEventListener('click', () => {
        this.openPacienteModal();
      });
    }

    // 3. Botón Editar Paciente
    const btnEditarPaciente = document.getElementById('btn-editar-paciente');
    if (btnEditarPaciente) {
      btnEditarPaciente.addEventListener('click', () => {
        if (this.currentPaciente) {
          this.openPacienteModal(this.currentPaciente);
        }
      });
    }

    // 4. Botón Eliminar Paciente
    const btnEliminarPaciente = document.getElementById('btn-eliminar-paciente');
    if (btnEliminarPaciente) {
      btnEliminarPaciente.addEventListener('click', async () => {
        if (!this.currentPaciente) return;
        const confirmacion = confirm(`¿Estás seguro de eliminar el expediente del paciente ${this.currentPaciente.nombre} ${this.currentPaciente.apellido}? Esta acción borrará su historia y récord clínico.`);
        if (confirmacion) {
          await window.odontoDB.deletePaciente(this.currentPaciente.id);
          this.showToast('Paciente y registros eliminados con éxito.');
          this.currentPaciente = null;
          this.currentPacienteId = null;
          await this.loadPacientes();
          const restantes = await window.odontoDB.getPacientes();
          if (restantes.length > 0) {
            await this.selectPaciente(restantes[0].id);
          } else {
            const vistaDetalle = document.getElementById('vista-detalle-paciente');
            const vistaBienvenida = document.getElementById('vista-bienvenida');
            if (vistaDetalle) { vistaDetalle.classList.add('hidden'); vistaDetalle.classList.remove('flex'); }
            if (vistaBienvenida) vistaBienvenida.classList.remove('hidden');
          }
        }
      });
    }

    // 5. Guardar Formulario Paciente (Nuevo o Editar)
    const formPaciente = document.getElementById('form-paciente');
    if (formPaciente) {
      formPaciente.insuranceId.addEventListener('change', () => this.updateInsuranceFields());
      formPaciente.addEventListener('submit', async (e) => {
        e.preventDefault();
        const submitBtn = formPaciente.querySelector('button[type="submit"]');
        const btnOrigText = submitBtn ? submitBtn.innerHTML : '';

        try {
          if (submitBtn) {
            submitBtn.disabled = true;
            submitBtn.innerHTML = '<span class="animate-spin inline-block">⏳</span> Guardando...';
          }

          const f = formPaciente;
          const nombre = f.nombre.value.trim();
          const apellido = f.apellido.value.trim();
          const telefono = f.telefono.value.trim();

          if (!nombre || !apellido) {
            this.showToast('El nombre y apellido son obligatorios.', 'error');
            return;
          }

          let insuranceId = f.insuranceId.value;
          if (insuranceId === 'other') {
            const insurer = await window.odontoDB.createInsurer(f.otherInsuranceName.value.trim());
            insuranceId = insurer.id;
            await this.loadInsurers();
          }
          const pacienteData = {
            nombre,
            apellido,
            cedula: f.cedula.value.trim(),
            fechaNacimiento: f.fechaNacimiento.value || '',
            edad: f.edad.value ? Number(f.edad.value) : null,
            sexo: f.sexo.value,
            telefono,
            email: f.email.value.trim(),
            direccion: f.direccion.value.trim(),
            ocupacion: f.ocupacion.value.trim(),
            contactoEmergencia: f.contactoEmergencia.value.trim(),
            telefonoEmergencia: f.telefonoEmergencia.value.trim(),
            insuranceId: insuranceId ? Number(insuranceId) : null,
            affiliateNumber: f.affiliateNumber.value.trim(),
            policyNumber: f.policyNumber.value.trim(),
            authorizationNumber: f.authorizationNumber.value.trim()
          };

          // Solo asignar id si es una edición
          if (f.pacienteId.value && f.pacienteId.value.trim() !== '') {
            pacienteData.id = Number(f.pacienteId.value);
          }

          const idGuardado = await window.odontoDB.savePaciente(pacienteData);
          this.closeModal('modal-paciente');
          await this.loadPacientes();
          if (idGuardado) {
            await this.selectPaciente(idGuardado);
          }
          this.showToast('✅ Paciente guardado exitosamente.');
        } catch (err) {
          console.error('Error al guardar paciente:', err);
          this.showToast(err.message || 'Error al guardar paciente. Intenta nuevamente.', 'error');
        } finally {
          if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.innerHTML = btnOrigText;
          }
        }
      });
    }

    // 6. Guardar Historia Clínica
    const formHistoria = document.getElementById('form-historia-clinica');
    if (formHistoria) {
      formHistoria.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (!this.currentPacienteId) return;

        try {
          const f = formHistoria;
          const historiaData = {
            pacienteId: this.currentPacienteId,
            motivoPrincipal: f.motivoPrincipal.value.trim(),
            alergias: f.alergias.value.trim(),
            enfermedadesSistemicas: f.enfermedadesSistemicas.value.trim(),
            medicamentosActuales: f.medicamentosActuales.value.trim(),
            intervencionesPrevias: f.intervencionesPrevias.value.trim(),
            habitos: f.habitos.value.trim(),
            diagnosticoGeneral: f.diagnosticoGeneral.value.trim(),
            planTratamiento: f.planTratamiento.value.trim()
          };

          await window.odontoDB.saveHistoria(historiaData);
          this.currentHistoria = historiaData;
          this.renderPacienteHeader();
          this.showToast('Historia clínica y antecedentes guardados.');
        } catch (err) {
          console.error('Error al guardar historia:', err);
          this.showToast('Error al guardar historia: ' + err.message, 'error');
        }
      });
    }

    const attachmentInput = document.getElementById('input-clinical-attachment');
    if (attachmentInput) attachmentInput.addEventListener('change', async () => {
      const file = attachmentInput.files?.[0];
      if (!file || !this.currentPacienteId) return;
      const status = document.getElementById('attachment-status');
      try {
        if (status) status.textContent = `Subiendo ${file.name}...`;
        await window.odontoDB.uploadAdjunto(this.currentPacienteId, file);
        this.currentAttachments = await window.odontoDB.getAdjuntos(this.currentPacienteId);
        this.renderClinicalAttachments();
        if (status) status.textContent = '';
        this.showToast('Archivo adjuntado a la historia clínica.');
      } catch (error) {
        if (status) status.textContent = error.message;
        this.showToast(error.message, 'error');
      } finally { attachmentInput.value = ''; }
    });

    // 7. Botón Nueva Consulta (Abre Modal)
    const btnNuevaConsulta = document.getElementById('btn-nueva-consulta');
    if (btnNuevaConsulta) {
      btnNuevaConsulta.addEventListener('click', () => {
        this.openConsultaModal();
      });
    }

    // 8. Guardar Formulario de Consulta
    const formConsulta = document.getElementById('form-consulta');
    if (formConsulta) {
      formConsulta.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (!this.currentPacienteId) {
          this.showToast('Selecciona un paciente primero.', 'error');
          return;
        }

        const submitBtn = formConsulta.querySelector('button[type="submit"]');
        const btnOrigText = submitBtn ? submitBtn.innerHTML : '';

        try {
          if (submitBtn) {
            submitBtn.disabled = true;
            submitBtn.innerHTML = '<span>⏳</span> Guardando...';
          }

          const f = formConsulta;
          const consultaData = {
            pacienteId: this.currentPacienteId,
            fecha: f.fecha.value || new Date().toISOString().split('T')[0],
            motivo: f.motivo.value.trim(),
            diagnostico: f.diagnostico.value.trim(),
            tratamiento: f.tratamiento.value.trim(),
            receta: f.receta.value.trim(),
            observaciones: f.observaciones.value.trim(),
            proximaCita: f.proximaCita.value
          };

          if (!this.canEdit()) {
            for (const field of ['motivo', 'diagnostico', 'tratamiento', 'receta', 'observaciones', 'proximaCita']) delete consultaData[field];
          }
          await window.odontoDB.saveConsulta(consultaData);
          this.closeModal('modal-consulta');
          this.currentConsultas = await window.odontoDB.getConsultas(this.currentPacienteId);
          this.renderConsultasTimeline();
          this.renderFacturas();
          this.showToast('✅ Consulta y evolución registradas con éxito.');
        } catch (err) {
          console.error('Error al guardar consulta:', err);
          this.showToast(err.message || 'Error al guardar consulta. Intenta nuevamente.', 'error');
        } finally {
          if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.innerHTML = btnOrigText;
          }
        }
      });
    }

    const formFactura = document.getElementById('form-factura');
    formFactura?.addEventListener('submit', event => this.saveFactura(event));
    document.getElementById('btn-finalize-factura')?.addEventListener('click', () => this.finalizeFactura());
    document.getElementById('btn-reopen-factura')?.addEventListener('click', () => this.reopenFactura());
    document.getElementById('btn-download-factura')?.addEventListener('click', () => this.downloadFacturaPDF());
    document.getElementById('btn-close-factura-modal')?.addEventListener('click', () => this.closeModal('modal-factura'));
    document.getElementById('btn-close-factura-preview')?.addEventListener('click', () => this.closeModal('modal-factura-preview'));
    document.getElementById('btn-download-factura-preview')?.addEventListener('click', () => this.exportPreviewedFactura());
    document.getElementById('btn-print-factura-preview')?.addEventListener('click', () => this.printPreviewedFactura());

    // 9. Pestañas del paciente
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        this.switchTab(btn.dataset.tab);
      });
    });

    // 10. Botón Generar PDF / Informe
    const btnGenerarPDF = document.getElementById('btn-generar-pdf');
    if (btnGenerarPDF) {
      btnGenerarPDF.addEventListener('click', () => {
        this.openPDFPreviewModal();
      });
    }

    // 11. Modal PDF: Botón Descargar PDF
    const btnDescargarPDF = document.getElementById('btn-modal-descargar-pdf');
    if (btnDescargarPDF) {
      btnDescargarPDF.addEventListener('click', async () => {
        if (!this.currentPaciente) return;
        this.showToast('Generando archivo PDF...', 'info');
        await window.pdfExporter.downloadDirectPDF(
          this.currentPaciente,
          this.currentHistoria,
          this.currentConsultas,
          this.currentOdontograma,
          this.config
        );
      });
    }

    // 12. Modal PDF: Botón Imprimir
    const btnImprimirPDF = document.getElementById('btn-modal-imprimir-pdf');
    if (btnImprimirPDF) {
      btnImprimirPDF.addEventListener('click', () => {
        if (!this.currentPaciente) return;
        window.pdfExporter.printOrExport(
          this.currentPaciente,
          this.currentHistoria,
          this.currentConsultas,
          this.currentOdontograma,
          this.config
        );
      });
    }

    // 13. Configuración del Consultorio
    const btnConfig = document.getElementById('btn-abrir-config');
    if (btnConfig) {
      btnConfig.addEventListener('click', () => {
        this.openModal('modal-config');
      });
    }
    document.getElementById('btn-cash')?.addEventListener('click', () => this.openCash());
    document.getElementById('btn-close-cash')?.addEventListener('click', () => this.closeModal('modal-cash'));
    document.getElementById('btn-cash-filter')?.addEventListener('click', () => this.loadCash());
    document.getElementById('btn-cash-today')?.addEventListener('click', () => this.setCashPeriod('today'));
    document.getElementById('btn-cash-month')?.addEventListener('click', () => this.setCashPeriod('month'));
    document.getElementById('btn-cash-print')?.addEventListener('click', () => this.printCashReport());
    document.getElementById('cash-session')?.addEventListener('click', event => { if (event.target.id === 'btn-open-session') this.openCashSession(); if (event.target.id === 'btn-close-session') this.closeCashSession(); });

    const formConfig = document.getElementById('form-config');
    if (formConfig) {
      formConfig.addEventListener('submit', async (e) => {
        e.preventDefault();
        const f = formConfig;
        const configData = {
          nombreClinica: f.nombreClinica.value.trim(),
          nombreDoctor: f.nombreDoctor.value.trim(),
          especialidad: f.especialidad.value.trim(),
          colegiatura: f.colegiatura.value.trim(),
          telefono: f.telefono.value.trim(),
          email: f.email.value.trim(),
          direccion: f.direccion.value.trim(),
          piePagina: f.piePagina.value.trim(), fiscalEnabled: false, remindersEnabled: false, permanentPublishingEnabled: false,
          rnc: f.rnc.value.trim(), ncfSequence: f.ncfSequence.value.trim(), reminderChannel: f.reminderChannel.value.trim(), publicDomain: f.publicDomain.value.trim()
        };

        await window.odontoDB.saveConfig(configData);
        this.config = configData;
        this.applyConfigUI();
        this.closeModal('modal-config');
        this.showToast('Configuración del consultorio actualizada.');
      });
    }

    // 14. Respaldos (Exportar / Importar)
    const btnExportar = document.getElementById('btn-exportar-backup');
    if (btnExportar) {
      btnExportar.addEventListener('click', async () => {
        const data = await window.odontoDB.exportAllData();
        const jsonStr = JSON.stringify(data, null, 2);
        const blob = new Blob([jsonStr], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        const fecha = new Date().toISOString().split('T')[0];
        a.href = url;
        a.download = `Respaldo_SistemaOdontologico_${fecha}.json`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
        this.showToast('Copia de seguridad descargada exitosamente.');
      });
    }
    document.getElementById('btn-backup-sqlite')?.addEventListener('click', async () => { const button = document.getElementById('btn-backup-sqlite'); button.disabled = true; try { const result = await window.odontoDB.createSqliteBackup(); this.showToast(`Respaldo completo creado: ${result.filename}`); } catch (error) { this.showToast(error.message, 'error'); } finally { button.disabled = false; } });

    const inputImportar = document.getElementById('input-importar-backup');
    if (inputImportar) {
      inputImportar.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = async (event) => {
          try {
            const data = JSON.parse(event.target.result);
            const confirmar = confirm(`¿Deseas restaurar este respaldo con ${data.pacientes ? data.pacientes.length : 0} pacientes? Se reemplazarán los datos clínicos actuales del sistema.`);
            if (confirmar) {
              await window.odontoDB.importAllData(data);
              this.showToast('Datos restaurados correctamente.');
              this.config = await window.odontoDB.getConfig();
              this.applyConfigUI();
              await this.loadPacientes();
              const pacs = await window.odontoDB.getPacientes();
              if (pacs.length > 0) {
                await this.selectPaciente(pacs[0].id);
              }
            }
          } catch (err) {
            alert('Error al leer el archivo de respaldo: ' + err.message);
          }
        };
        reader.readAsText(file);
      });
    }

    // Cálculo automático de edad según fecha de nacimiento
    const inputFechaNac = document.querySelector('#form-paciente input[name="fechaNacimiento"]');
    const inputEdad = document.querySelector('#form-paciente input[name="edad"]');
    if (inputFechaNac && inputEdad) {
      inputFechaNac.addEventListener('change', () => {
        if (inputFechaNac.value) {
          const birth = new Date(inputFechaNac.value);
          const today = new Date();
          let age = today.getFullYear() - birth.getFullYear();
          const m = today.getMonth() - birth.getMonth();
          if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) {
            age--;
          }
          if (age >= 0) inputEdad.value = age;
        }
      });
    }
  }

  // --- CONTROL DE MODALES ---
  openModal(modalId) {
    const m = document.getElementById(modalId);
    if (m) {
      m.hidden = false;
      m.classList.remove('hidden');
      m.classList.add('flex');
    }
  }

  closeModal(modalId) {
    const m = document.getElementById(modalId);
    if (m) {
      m.hidden = true;
      m.classList.add('hidden');
      m.classList.remove('flex');
    }
  }

  openPacienteModal(paciente = null) {
    const f = document.getElementById('form-paciente');
    const title = document.getElementById('modal-paciente-title');
    f.reset();

    if (paciente) {
      title.textContent = 'Editar Datos del Paciente';
      f.pacienteId.value = paciente.id;
      f.nombre.value = paciente.nombre || '';
      f.apellido.value = paciente.apellido || '';
      f.cedula.value = paciente.cedula || '';
      f.fechaNacimiento.value = paciente.fechaNacimiento || '';
      f.edad.value = paciente.edad || '';
      f.sexo.value = paciente.sexo || 'Masculino';
      f.telefono.value = paciente.telefono || '';
      f.email.value = paciente.email || '';
      f.direccion.value = paciente.direccion || '';
      f.ocupacion.value = paciente.ocupacion || '';
      f.contactoEmergencia.value = paciente.contactoEmergencia || '';
      f.telefonoEmergencia.value = paciente.telefonoEmergencia || '';
      f.insuranceId.value = paciente.insuranceId || '';
      f.affiliateNumber.value = paciente.affiliateNumber || '';
      f.policyNumber.value = paciente.policyNumber || '';
      f.authorizationNumber.value = paciente.authorizationNumber || '';
    } else {
      title.textContent = 'Registrar Nuevo Paciente';
      f.pacienteId.value = '';
    }

    this.updateInsuranceFields();

    this.openModal('modal-paciente');
  }

  async loadInsurers() {
    this.insurers = await window.odontoDB.getInsurers();
    const select = document.querySelector('#form-paciente select[name="insuranceId"]');
    if (!select) return;
    const current = select.value;
    const regular = this.insurers.filter(item => item.codigo !== 'PRIVADO');
    const privateOption = this.insurers.find(item => item.codigo === 'PRIVADO');
    select.innerHTML = '<option value="">Seleccione...</option>' + regular.map(item => `<option value="${Number(item.id)}">${window.escapeHTML(item.nombre)}</option>`).join('') + '<option value="other">Otro</option>' + (privateOption ? `<option value="${Number(privateOption.id)}">${window.escapeHTML(privateOption.nombre)}</option>` : '');
    if ([...select.options].some(option => option.value === current)) select.value = current;
  }

  updateInsuranceFields() {
    const form = document.getElementById('form-paciente');
    if (!form) return;
    const selected = form.insuranceId.value;
    const insurer = this.insurers.find(item => item.id === Number(selected));
    const isPrivate = insurer?.codigo === 'PRIVADO';
    const isOther = selected === 'other';
    document.getElementById('other-insurer-field').hidden = !isOther;
    form.otherInsuranceName.required = isOther;
    form.affiliateNumber.required = Boolean(selected) && !isPrivate;
    form.affiliateNumber.disabled = isPrivate;
    if (isPrivate) form.affiliateNumber.value = '';
  }

  openConsultaModal() {
    const f = document.getElementById('form-consulta');
    f.reset();
    f.fecha.value = new Date().toISOString().split('T')[0];
    for (const field of ['motivo', 'diagnostico', 'tratamiento', 'receta', 'observaciones', 'proximaCita']) {
      f[field].disabled = !this.canEdit();
      f[field].closest('div').hidden = !this.canEdit();
    }
    this.openModal('modal-consulta');
  }

  async openFacturaModal(consultaId) {
    const consulta = this.currentConsultas.find(item => item.id === Number(consultaId));
    if (!consulta) return this.showToast('Consulta no encontrada.', 'error');
    const form = document.getElementById('form-factura');
    const factura = consulta.factura || null;
    form.reset();
    form.consultaId.value = String(consulta.id);
    form.diagnostico.value = factura?.diagnostico || consulta.diagnostico || '';
    await window.catalogManager.prepareInvoice(factura);
    const closed = factura?.estado === 'cerrada';
    const canWrite = window.authManager.hasPermission('invoice.write') && !closed;
    form.diagnostico.readOnly = !canWrite;
    document.getElementById('btn-add-procedimiento').hidden = !canWrite;
    document.getElementById('btn-save-factura').hidden = !canWrite;
    document.getElementById('btn-finalize-factura').hidden = !canWrite;
    document.getElementById('btn-reopen-factura').hidden = !closed || !window.authManager.hasPermission('invoice.reopen');
    document.getElementById('btn-download-factura').hidden = !factura;
    document.getElementById('factura-title').textContent = closed ? 'Factura cerrada' : (factura ? 'Factura abierta' : 'Nueva factura');
    document.getElementById('factura-message').textContent = closed ? 'Esta factura está bloqueada. Solo el administrador puede reabrirla.' : '';
    document.querySelectorAll('#factura-procedimientos input, #factura-procedimientos select, #factura-procedimientos button').forEach(control => {
      if (!canWrite) control.disabled = true;
    });
    this.openModal('modal-factura');
  }

  async saveFactura(event, quiet = false) {
    event?.preventDefault();
    const form = document.getElementById('form-factura');
    const consultaId = Number(form.consultaId.value);
    try {
      const saved = await window.odontoDB.saveFactura(consultaId, {
        diagnostico: form.diagnostico.value.trim(),
        tariffInsuranceId: Number(form.tariffInsuranceId.value),
        procedimientos: window.catalogManager.getLines()
      });
      this.currentConsultas = this.currentConsultas.map(item => item.id === consultaId ? saved : item);
      this.renderConsultasTimeline();
      this.renderFacturas();
      if (!quiet) {
        await this.openFacturaModal(consultaId);
        document.getElementById('factura-message').textContent = 'Borrador guardado correctamente.';
      }
      return saved;
    } catch (error) {
      this.showToast(error.message, 'error');
      if (quiet) throw error;
      return null;
    }
  }

  async finalizeFactura() {
    const consultaId = Number(document.getElementById('form-factura').consultaId.value);
    try {
      await this.saveFactura(null, true);
      if (!confirm('¿Cerrar esta factura? Quedará bloqueada y solo un administrador podrá reabrirla.')) return;
      const saved = await window.odontoDB.closeFactura(consultaId);
      this.currentConsultas = this.currentConsultas.map(item => item.id === consultaId ? saved : item);
      this.renderConsultasTimeline();
      this.renderFacturas();
      await this.openFacturaModal(consultaId);
      this.showToast('Factura cerrada correctamente.');
    } catch {}
  }

  async reopenFactura() {
    const consultaId = Number(document.getElementById('form-factura').consultaId.value);
    if (!confirm('¿Reabrir esta factura para editarla? Esta acción quedará registrada.')) return;
    try {
      const saved = await window.odontoDB.reopenFactura(consultaId);
      this.currentConsultas = this.currentConsultas.map(item => item.id === consultaId ? saved : item);
      this.renderConsultasTimeline();
      this.renderFacturas();
      await this.openFacturaModal(consultaId);
      this.showToast('Factura reabierta por el administrador.');
    } catch (error) { this.showToast(error.message, 'error'); }
  }

  async downloadFacturaPDF() {
    const consultaId = Number(document.getElementById('form-factura').consultaId.value);
    const consulta = this.currentConsultas.find(item => item.id === consultaId);
    if (!consulta?.factura) {
      this.showToast('Guarda la factura antes de generar su PDF.', 'error');
      return;
    }
    try {
      this.previewFacturaId = consultaId;
      document.getElementById('factura-preview-render-area').innerHTML = window.pdfExporter.buildInvoiceHTML(
        this.currentPaciente, consulta, this.config, window.authManager.user
      );
      this.openModal('modal-factura-preview');
    } catch (error) {
      console.error('Error al mostrar la factura:', error);
      this.showToast('No se pudo mostrar la factura.', 'error');
    }
  }

  getPreviewedFactura() {
    return this.currentConsultas.find(item => item.id === Number(this.previewFacturaId));
  }

  async exportPreviewedFactura() {
    const consulta = this.getPreviewedFactura();
    if (!consulta?.factura) return;
    const button = document.getElementById('btn-download-factura-preview');
    button.disabled = true;
    try {
      await window.pdfExporter.downloadInvoicePDF(this.currentPaciente, consulta, this.config, window.authManager.user);
      this.showToast('PDF de la factura descargado correctamente.');
    } catch (error) {
      console.error('Error al generar la factura PDF:', error);
      this.showToast('No se pudo descargar el PDF de la factura.', 'error');
    } finally { button.disabled = false; }
  }

  printPreviewedFactura() {
    const consulta = this.getPreviewedFactura();
    if (!consulta?.factura) return;
    try {
      window.pdfExporter.printInvoice(this.currentPaciente, consulta, this.config, window.authManager.user);
    } catch (error) {
      this.showToast(error.message || 'No se pudo imprimir la factura.', 'error');
    }
  }

  async openCash() {
    this.setCashPeriod('today', false);
    this.openModal('modal-cash');
    await this.loadCash();
  }

  setCashPeriod(period, reload = true) {
    const today = new Date();
    const localDate = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    document.getElementById('cash-to').value = localDate(today);
    document.getElementById('cash-from').value = period === 'month' ? `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-01` : localDate(today);
    if (reload) this.loadCash();
  }

  async loadCash() {
    const from = document.getElementById('cash-from').value;
    const to = document.getElementById('cash-to').value;
    const message = document.getElementById('cash-message');
    message.textContent = 'Cargando caja…';
    try {
      this.cashReport = await window.odontoDB.getCashReport(from, to, { method: document.getElementById('cash-filter-method')?.value, cardBrand: document.getElementById('cash-filter-card')?.value.trim(), register: document.getElementById('cash-filter-register')?.value.trim(), invoice: document.getElementById('cash-filter-invoice')?.value.trim(), patient: document.getElementById('cash-filter-patient')?.value.trim() });
      this.renderCash(); message.textContent = '';
    } catch (error) { message.textContent = error.message; }
  }

  renderCash() {
    const report = this.cashReport;
    const money = value => `$${Number(value || 0).toFixed(2)}`;
    const escape = window.escapeHTML;
    const methodLabels = { efectivo: 'Efectivo', tarjeta: 'Tarjeta', transferencia: 'Transferencia', cheque: 'Cheque', credito: 'Crédito', otro: 'Otro' };
    const sessionBox = document.getElementById('cash-session'); const session = report.currentSession;
    sessionBox.innerHTML = session ? `<div class="flex flex-wrap justify-between items-center gap-3"><div><b class="text-emerald-800">Caja abierta · ${escape(session.registerNumber)}</b><small class="block">${escape(session.cashierName)} · Apertura ${new Date(session.openedAt).toLocaleString('es-DO')} · Fondo ${money(session.openingCash)}</small></div><button id="btn-close-session" class="btn-primary px-4 py-2 rounded-xl font-black">Cerrar y cuadrar caja</button></div>` : `<div class="flex flex-wrap justify-between items-center gap-3"><div><b class="text-rose-900">Caja cerrada</b><small class="block">Abre un turno antes de cobrar.</small></div><button id="btn-open-session" class="btn-primary px-4 py-2 rounded-xl font-black">Abrir caja</button></div>`;
    const paymentRow = (amount = '') => `<div class="cash-payment-line grid grid-cols-1 sm:grid-cols-3 gap-2"><select class="cash-method px-3 py-2 border rounded-xl"><option value="efectivo">Efectivo</option><option value="tarjeta">Tarjeta</option><option value="transferencia">Transferencia bancaria</option><option value="cheque">Cheque</option><option value="credito">Crédito</option><option value="otro">Otro</option></select><input class="cash-line-amount px-3 py-2 border rounded-xl" type="number" min="0" step="0.01" placeholder="Monto" value="${amount}"><div class="cash-card-data hidden sm:col-span-3 grid grid-cols-2 sm:grid-cols-3 gap-2"><select class="cash-card-brand px-3 py-2 border rounded-xl"><option>Visa</option><option>Mastercard</option><option>American Express</option><option>Discover</option><option>Otra</option></select><select class="cash-card-type px-3 py-2 border rounded-xl"><option>Crédito</option><option>Débito</option></select><input class="cash-last-four px-3 py-2 border rounded-xl" maxlength="4" placeholder="Últimos 4 dígitos"><input class="cash-authorization px-3 py-2 border rounded-xl" placeholder="Autorización"><input class="cash-line-reference px-3 py-2 border rounded-xl" placeholder="Referencia"><input class="cash-processor px-3 py-2 border rounded-xl" placeholder="Banco o procesador"></div></div>`;
    document.getElementById('cash-summary').innerHTML = `
      <div class="glass-card p-4 rounded-2xl"><small>Total cobrado</small><strong class="block text-2xl text-emerald-700">${money(report.total)}</strong></div>
      <div class="glass-card p-4 rounded-2xl"><small>Transacciones</small><strong class="block text-2xl text-rose-950">${report.payments.length}</strong></div>
      <div class="glass-card p-4 rounded-2xl"><small>Cubierto por seguros</small><strong class="block text-2xl text-blue-700">${money(report.insuranceTotal)}</strong></div>`;
    document.getElementById('cash-summary').insertAdjacentHTML('beforeend', `<div class="glass-card p-4 rounded-2xl sm:col-span-3"><small class="font-black">Desglose por forma de pago</small><div class="grid grid-cols-2 sm:grid-cols-3 gap-2 mt-2">${Object.entries(report.byMethod).map(([method, amount]) => `<span class="p-2 bg-white rounded-lg border">${escape(method)}: <b>${money(amount)}</b></span>`).join('') || '<span>Sin movimientos</span>'}</div></div>`);
    const pending = document.getElementById('cash-pending');
    pending.innerHTML = report.pendingInvoices.length ? report.pendingInvoices.map(item => `<article class="glass-card p-4 rounded-2xl border border-rose-100" data-consultation-id="${item.consultationId}">
      <div class="flex justify-between gap-3"><div><strong>${escape(item.patientName)}</strong><small class="block text-slate-500">${escape(item.date)} · ${escape(item.diagnosis)}</small></div><b class="text-emerald-700">${money(item.total)}</b></div>
      <div class="mt-3 p-3 rounded-xl bg-blue-50 border border-blue-200"><div class="flex flex-wrap gap-3"><label class="font-bold">Cobertura del seguro (%) <input class="cash-coverage w-24 ml-2 px-3 py-2 border rounded-xl" type="number" min="0" max="100" step="0.01" value="0"></label><label class="font-bold">El paciente entregó <input class="cash-received w-28 ml-2 px-3 py-2 border rounded-xl" type="number" min="0" step="0.01" value="${Number(item.total).toFixed(2)}"></label></div><div class="cash-split mt-2 text-sm font-black text-blue-950">Seguro: ${money(0)} · Debe pagar: ${money(item.total)} · Devolver: ${money(0)}</div></div>
      <div class="cash-payment-lines space-y-2 mt-3">${paymentRow(Number(item.total).toFixed(2))}</div><button type="button" class="cash-add-method secondary-button mt-2">+ Agregar forma de pago</button>
      <div class="flex flex-wrap gap-2 mt-3"><input class="cash-reference flex-1 min-w-32 px-3 py-2 border rounded-xl" maxlength="150" placeholder="Nota general (opcional)"><button class="cash-charge btn-primary px-4 py-2 rounded-xl font-black">Registrar cobro</button></div>
    </article>`).join('') : '<p class="text-sm text-slate-500 p-4">No hay facturas cerradas pendientes.</p>';
    pending.querySelectorAll('.cash-charge').forEach(button => button.addEventListener('click', () => this.chargeCash(button.closest('[data-consultation-id]'))));
    const bindPaymentRow = row => row.querySelector('.cash-method').addEventListener('change', event => row.querySelector('.cash-card-data').classList.toggle('hidden', event.target.value !== 'tarjeta'));
    pending.querySelectorAll('.cash-payment-line').forEach(bindPaymentRow);
    pending.querySelectorAll('.cash-add-method').forEach(button => button.addEventListener('click', () => { const holder = button.closest('[data-consultation-id]').querySelector('.cash-payment-lines'); holder.insertAdjacentHTML('beforeend', paymentRow('')); bindPaymentRow(holder.lastElementChild); }));
    pending.querySelectorAll('[data-consultation-id]').forEach(card => { const calculate = () => { const invoice = report.pendingInvoices.find(i => i.consultationId === Number(card.dataset.consultationId)); const covered = invoice.total * Math.min(100, Math.max(0, Number(card.querySelector('.cash-coverage').value || 0))) / 100; const due = invoice.total - covered; const received = Number(card.querySelector('.cash-received').value || 0); card.querySelector('.cash-split').textContent = `Seguro: ${money(covered)} · Debe pagar: ${money(due)} · Devolver: ${money(Math.max(0, received - due))}`; }; card.querySelector('.cash-coverage').addEventListener('input', calculate); card.querySelector('.cash-received').addEventListener('input', calculate); });
    document.getElementById('cash-payments').innerHTML = report.payments.length ? report.payments.map(item => `<article class="glass-card p-4 rounded-2xl flex justify-between gap-3 ${item.status === 'anulado' ? 'opacity-60' : ''}"><div><strong>${escape(item.patientName)}</strong>${item.status === 'anulado' ? '<b class="ml-2 text-red-700">ANULADO</b>' : ''}<small class="block text-slate-500">${item.voucherNumber} · ${item.invoiceNumber} · ${new Date(item.paidAt).toLocaleString('es-ES')}</small><small class="block">${item.lines.map(line => `${methodLabels[line.method] || escape(line.method)}${line.cardBrand ? ' ' + escape(line.cardBrand) + ' ' + escape(line.cardType) : ''}: ${money(line.amount)}`).join(' · ')}</small><small class="block">Seguro ${item.coveragePercent}%: ${money(item.insuranceCovered)} · Debía pagar: ${money(item.patientPaid)}</small><small class="block font-bold">Entregó: ${money(item.amountReceived)} · Devuelta: ${money(item.change)}</small><small class="block">Cobró: ${escape(item.receivedByName)}${item.reference ? ` · Ref: ${escape(item.reference)}` : ''}</small><div class="flex flex-wrap gap-2 mt-2"><button type="button" class="cash-reprint secondary-button" data-id="${item.id}">Reimprimir voucher</button><button type="button" class="cash-print-invoice secondary-button" data-id="${item.id}">Imprimir factura</button>${item.status === 'pagado' && window.authManager.hasPermission('invoice.reopen') ? `<button type="button" class="cash-void secondary-button" data-id="${item.id}">Anular cobro</button>` : ''}</div></div><b class="${item.status === 'anulado' ? 'text-red-700 line-through' : 'text-emerald-700'}">${money(item.patientPaid)}</b></article>`).join('') : '<p class="text-sm text-slate-500 p-4">No hay cobros en este período.</p>';
    document.querySelectorAll('.cash-reprint').forEach(button => button.addEventListener('click', async () => { const payment = report.payments.find(item => item.id === Number(button.dataset.id)); try { await window.odontoDB.auditVoucherReprint(payment.id); this.printCashVoucher(payment, null, payment.patientName); } catch (error) { this.showToast(error.message,'error'); } }));
    document.querySelectorAll('.cash-print-invoice').forEach(button => button.addEventListener('click', () => { const payment = report.payments.find(item => item.id === Number(button.dataset.id)); try { window.pdfExporter.printInvoice(payment.patient, payment.consultation, this.config, window.authManager.user); } catch (error) { this.showToast(error.message || 'No se pudo imprimir la factura.','error'); } }));
    document.querySelectorAll('.cash-void').forEach(button => button.addEventListener('click', async () => { if (!confirm('¿Anular este cobro? El movimiento quedará en auditoría.')) return; try { await window.odontoDB.voidCashPayment(button.dataset.id); this.showToast('Cobro anulado.'); await this.loadCash(); } catch(error) { this.showToast(error.message,'error'); } }));
  }

  async openCashSession() { const registerNumber = prompt('Nombre o número de caja:', 'Caja 1'); if (registerNumber === null) return; const openingCash = prompt('Fondo inicial en efectivo:', '0'); if (openingCash === null) return; try { await window.odontoDB.openCashSession({registerNumber,openingCash:Number(openingCash)}); this.showToast('Caja abierta correctamente.'); await this.loadCash(); } catch(error) { this.showToast(error.message,'error'); } }
  async closeCashSession() { const countedCash = prompt('Efectivo contado al cerrar:'); if (countedCash === null) return; try { const result = await window.odontoDB.closeCashSession(Number(countedCash)); this.showToast(`Caja cerrada. Diferencia: $${Number(result.difference).toFixed(2)}`); await this.loadCash(); } catch(error) { this.showToast(error.message,'error'); } }

  async chargeCash(card) {
    const button = card.querySelector('.cash-charge'); button.disabled = true;
    const voucherWindow = window.open('', '_blank', 'width=420,height=700');
    if (voucherWindow) voucherWindow.document.write('<p style="font-family:sans-serif;padding:24px">Generando comprobante de pago…</p>');
    try {
      const payments = [...card.querySelectorAll('.cash-payment-line')].filter(row => row.querySelector('.cash-line-amount').value !== '').map(row => ({ method: row.querySelector('.cash-method').value, amount: Number(row.querySelector('.cash-line-amount').value), cardBrand: row.querySelector('.cash-card-brand').value, cardType: row.querySelector('.cash-card-type').value, lastFour: row.querySelector('.cash-last-four').value.trim(), authorizationNumber: row.querySelector('.cash-authorization').value.trim(), referenceNumber: row.querySelector('.cash-line-reference').value.trim(), processor: row.querySelector('.cash-processor').value.trim() }));
      const result = await window.odontoDB.chargeInvoice(Number(card.dataset.consultationId), { coveragePercent: Number(card.querySelector('.cash-coverage').value || 0), amountReceived: Number(card.querySelector('.cash-received').value || 0), payments, reference: card.querySelector('.cash-reference').value.trim() });
      this.printCashVoucher(result, card, '', voucherWindow);
      this.showToast('Cobro registrado correctamente.'); await this.loadCash();
    } catch (error) { voucherWindow?.close(); this.showToast(error.message, 'error'); button.disabled = false; }
  }

  printCashVoucher(payment, card, patientName = '', existingWindow = null) {
    const receipt = existingWindow || window.open('', '_blank', 'width=420,height=700'); if (!receipt) return this.showToast('El navegador bloqueó el voucher. Permite ventanas emergentes.', 'error');
    const escape = window.escapeHTML; const patient = patientName || card.querySelector('strong').textContent; const money = value => `RD$ ${Number(value).toFixed(2)}`;
    const methodNames = { efectivo: 'Efectivo', tarjeta: 'Tarjeta', transferencia: 'Transferencia', cheque: 'Cheque', credito: 'Crédito', otro: 'Otro' };
    const lines = (payment.payments || payment.lines || []).map(line => `<div class="payment-row"><div><strong>${escape(methodNames[line.method] || line.method)}</strong>${line.cardBrand ? `<small>${escape(line.cardBrand)} · ${escape(line.cardType || '')}${line.lastFour ? ` · •••• ${escape(line.lastFour)}` : ''}</small>` : ''}${line.authorizationNumber ? `<small>Autorización: ${escape(line.authorizationNumber)}</small>` : ''}${line.referenceNumber ? `<small>Referencia: ${escape(line.referenceNumber)}</small>` : ''}</div><b>${money(line.amount)}</b></div>`).join('');
    const services = (payment.services || []).map(line => `<div class="payment-row"><span>${escape(line.nombre || line.procedimiento || 'Servicio')}${Number(line.cantidad || 1) > 1 ? ` × ${Number(line.cantidad)}` : ''}</span><b>${money(line.subtotalCentavos != null ? Number(line.subtotalCentavos) / 100 : (line.subtotal ?? Number(line.precio || 0) * Number(line.cantidad || 1)))}</b></div>`).join('');
    const logo = window.LOGO_DATA_URL || 'img/logo.jpg';
    receipt.document.open();
    receipt.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${escape(payment.voucherNumber)}</title><style>
      @page{size:80mm auto;margin:3mm}*{box-sizing:border-box}body{width:74mm;margin:0 auto;padding:4mm 3mm;font-family:'Segoe UI',Arial,sans-serif;font-size:11px;color:#334155;background:#fff}.brand{text-align:center;border-bottom:3px solid #be123c;padding-bottom:10px}.brand img{width:58px;height:58px;object-fit:contain}.brand h1{font-family:Georgia,serif;font-size:18px;color:#881337;margin:4px 0 1px}.brand p{margin:0;color:#64748b;font-size:9px}.title{text-align:center;background:linear-gradient(135deg,#881337,#e11d48);color:#fff;padding:9px;margin:12px 0;border-radius:8px;letter-spacing:1.5px;font-weight:900}.info{border:1px solid #fecdd3;background:#fff1f2;border-radius:8px;padding:9px;line-height:1.6}.info b{color:#881337}.section-title{font-size:9px;color:#9f1239;font-weight:900;letter-spacing:1px;text-transform:uppercase;margin:12px 0 5px;border-bottom:1px solid #fecdd3;padding-bottom:4px}.payment-row,.total-row{display:flex;justify-content:space-between;gap:8px;padding:7px 2px;border-bottom:1px dashed #cbd5e1}.payment-row div{display:block}.payment-row small{display:block;color:#64748b;font-size:8px;margin-top:2px}.total-box{margin-top:11px;border:2px solid #be123c;border-radius:9px;overflow:hidden}.total-row{padding:7px 9px;border:0}.total-row.main{background:#fff1f2;color:#881337;font-size:14px;font-weight:900}.total-row.change{background:#ecfdf5;color:#047857;font-size:13px}.thanks{text-align:center;color:#881337;font-family:Georgia,serif;font-weight:700;margin:15px 0 4px}.footer{text-align:center;color:#64748b;font-size:8px;border-top:1px solid #fecdd3;padding-top:7px}@media print{body{padding:1mm 2mm}.no-print{display:none}}
      </style></head><body><header class="brand"><img src="${logo}" alt="DentalRos"><h1>${escape(this.config.nombreClinica || 'DentalRos')}</h1><p>${escape(this.config.telefono || '')}</p></header><div class="title">COMPROBANTE DE PAGO</div><section class="info"><b>Comprobante:</b> ${escape(payment.voucherNumber)}<br><b>Factura:</b> FAC-${String(payment.consultationId).padStart(8,'0')}<br><b>Fecha:</b> ${new Date(payment.paidAt).toLocaleString('es-DO')}<br><b>Paciente:</b> ${escape(patient)}<br><b>Cajero:</b> ${escape(payment.receivedByName)}<br><b>Usuario:</b> @${escape(payment.cashierUsername || '')}</section>${services ? `<p class="section-title">Servicios realizados</p>${services}` : ''}<p class="section-title">Formas de pago</p>${lines}<div class="total-box"><div class="total-row main"><span>TOTAL PAGADO</span><b>${money(payment.patientPaid)}</b></div><div class="total-row"><span>Paciente entregó</span><b>${money(payment.amountReceived)}</b></div><div class="total-row change"><span>DEVOLVER</span><b>${money(payment.change)}</b></div></div><p class="thanks">¡Gracias por su pago!</p><p class="footer">${escape(this.config.piePagina || 'DentalRos · Cuidamos tu sonrisa')}</p><script>onload=()=>setTimeout(()=>print(),350)<\/script></body></html>`); receipt.document.close();
  }

  printCashReport() {
    if (!this.cashReport) return;
    const report = this.cashReport; const escape = window.escapeHTML; const money = value => `RD$ ${Number(value || 0).toFixed(2)}`; const formatDate = value => value ? new Date(value).toLocaleString('es-DO', { dateStyle: 'short', timeStyle: 'short' }) : 'Pendiente';
    const methodNames = { efectivo: 'Efectivo', tarjeta: 'Tarjeta', transferencia: 'Transferencia', cheque: 'Cheque', credito: 'Crédito', otro: 'Otro' };
    const sessions = report.sessions?.length ? report.sessions : (report.currentSession ? [report.currentSession] : []);
    const sessionRows = sessions.map(session => `<tr><td><b>${escape(session.cashierName)}</b><small>@${escape(session.cashierUsername || '')}</small></td><td>${escape(session.registerNumber)}</td><td>${formatDate(session.openedAt)}</td><td>${formatDate(session.closedAt)}</td><td>${money(session.openingCash)}</td><td>${session.expectedCash == null ? '—' : money(session.expectedCash)}</td><td>${session.countedCash == null ? '—' : money(session.countedCash)}</td><td class="${Number(session.difference) ? 'negative' : 'positive'}">${session.difference == null ? '—' : money(session.difference)}</td></tr>`).join('');
    const methodRows = Object.entries(report.byMethod || {}).map(([method, amount]) => `<div class="method-row"><span>${escape(methodNames[method] || method)}</span><b>${money(amount)}</b></div>`).join('') || '<p class="empty">Sin pagos confirmados en este período.</p>';
    const movementRows = report.payments.map(payment => `<tr class="${payment.status === 'anulado' ? 'void' : ''}"><td><b>${escape(payment.voucherNumber)}</b><small>${escape(payment.invoiceNumber)}</small></td><td>${formatDate(payment.paidAt)}</td><td>${escape(payment.patientName)}</td><td>${escape(payment.receivedByName)}<small>@${escape(payment.cashierUsername || '')}</small></td><td>${payment.lines.map(line => `${escape(methodNames[line.method] || line.method)}${line.cardBrand ? ` ${escape(line.cardBrand)}` : ''}: ${money(line.amount)}`).join('<br>')}</td><td>${payment.status === 'anulado' ? '<b class="negative">ANULADO</b>' : money(payment.patientPaid)}</td></tr>`).join('') || '<tr><td colspan="6" class="empty">No hay movimientos en este período.</td></tr>';
    const generatedAt = new Date().toLocaleString('es-DO', { dateStyle: 'long', timeStyle: 'medium' }); const logo = window.LOGO_DATA_URL || 'img/logo.jpg';
    const printWindow = window.open('', '_blank', 'width=900,height=800');
    if (!printWindow) return this.showToast('Permite ventanas emergentes para imprimir.', 'error');
    printWindow.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Cuadre de caja ${escape(report.from)} - ${escape(report.to)}</title><style>
      @page{size:A4;margin:12mm}*{box-sizing:border-box}body{max-width:1000px;margin:auto;padding:24px;font-family:'Segoe UI',Arial,sans-serif;color:#334155;background:#fff}.brand{display:flex;align-items:center;gap:15px;border-bottom:4px solid #be123c;padding-bottom:14px}.brand img{width:68px;height:68px;object-fit:contain}.brand h1{font-family:Georgia,serif;color:#881337;margin:0;font-size:27px}.brand p{margin:4px 0 0;color:#64748b}.title{display:flex;justify-content:space-between;gap:20px;align-items:center;background:linear-gradient(135deg,#881337,#e11d48);color:#fff;padding:17px 20px;margin:18px 0;border-radius:12px}.title h2{margin:0;font-size:19px;letter-spacing:1px}.title p{margin:3px 0 0;font-size:12px}.generated{text-align:right;font-size:11px}.cards{display:grid;grid-template-columns:repeat(4,1fr);gap:10px}.card{border:1px solid #fecdd3;background:#fff1f2;border-radius:11px;padding:13px}.card small{display:block;color:#9f1239;font-weight:700;text-transform:uppercase;font-size:9px}.card b{display:block;color:#881337;font-size:20px;margin-top:5px}.section-title{font-family:Georgia,serif;color:#881337;font-size:17px;margin:22px 0 8px;border-bottom:2px solid #fecdd3;padding-bottom:6px}.methods{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}.method-row{display:flex;justify-content:space-between;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:9px}table{width:100%;border-collapse:collapse;font-size:10px}th{background:#881337;color:#fff;text-align:left;padding:8px}td{padding:8px;border-bottom:1px solid #e2e8f0;vertical-align:top}td small{display:block;color:#64748b;margin-top:2px}.void{background:#fff1f2;color:#64748b}.negative{color:#b91c1c;font-weight:800}.positive{color:#047857;font-weight:800}.empty{text-align:center;color:#64748b;padding:16px}.footer{text-align:center;color:#64748b;font-size:9px;border-top:1px solid #fecdd3;margin-top:22px;padding-top:9px}@media(max-width:700px){.cards{grid-template-columns:repeat(2,1fr)}.methods{grid-template-columns:1fr}.table-wrap{overflow-x:auto}}@media print{body{padding:0}.no-print{display:none}}
      </style></head><body><header class="brand"><img src="${logo}" alt="DentalRos"><div><h1>${escape(this.config.nombreClinica || 'DentalRos')}</h1><p>${escape(this.config.telefono || '')}</p></div></header><section class="title"><div><h2>REPORTE Y CUADRE DE CAJA</h2><p>Período: ${escape(report.from)} al ${escape(report.to)}</p></div><div class="generated"><b>Generado</b><br>${escape(generatedAt)}</div></section><div class="cards"><div class="card"><small>Total cobrado</small><b>${money(report.total)}</b></div><div class="card"><small>Transacciones</small><b>${report.payments.filter(item => item.status === 'pagado').length}</b></div><div class="card"><small>Cubierto por seguro</small><b>${money(report.insuranceTotal)}</b></div><div class="card"><small>Cobros anulados</small><b>${money(report.voidTotal)}</b></div></div><h3 class="section-title">Cajeros y turnos</h3><div class="table-wrap"><table><thead><tr><th>Cajero</th><th>Caja</th><th>Apertura</th><th>Cierre</th><th>Fondo inicial</th><th>Esperado</th><th>Contado</th><th>Diferencia</th></tr></thead><tbody>${sessionRows || '<tr><td colspan="8" class="empty">No hay turnos registrados en el período.</td></tr>'}</tbody></table></div><h3 class="section-title">Totales por forma de pago</h3><div class="methods">${methodRows}</div><h3 class="section-title">Movimientos</h3><div class="table-wrap"><table><thead><tr><th>Comprobante</th><th>Fecha y hora</th><th>Paciente</th><th>Cajero</th><th>Forma de pago</th><th>Total</th></tr></thead><tbody>${movementRows}</tbody></table></div><p class="footer">${escape(this.config.piePagina || 'DentalRos · Cuidamos tu sonrisa')}</p><script>onload=()=>setTimeout(()=>print(),350)<\/script></body></html>`); printWindow.document.close();
  }

  openPDFPreviewModal() {
    if (!this.currentPaciente) {
      this.showToast('Selecciona un paciente primero.', 'error');
      return;
    }

    const previewContainer = document.getElementById('pdf-preview-render-area');
    if (!previewContainer) return;

    // Construir HTML del reporte
    const reportHtml = window.pdfExporter.buildReportHTML(
      this.currentPaciente,
      this.currentHistoria,
      this.currentConsultas,
      this.currentOdontograma,
      this.config
    );

    previewContainer.innerHTML = reportHtml;
    this.openModal('modal-pdf-preview');
  }

  // --- MENSAJES TOAST ---
  showToast(message, type = 'success') {
    let container = document.getElementById('toast-container');
    if (!container) {
      container = document.createElement('div');
      container.id = 'toast-container';
      document.body.appendChild(container);
    }

    const toast = document.createElement('div');
    toast.className = `toast ${type === 'error' ? 'toast-error' : type === 'info' ? 'toast-info' : 'toast-success'}`;
    const icon = document.createElement('span');
    icon.textContent = type === 'error' ? 'Error' : type === 'info' ? 'Info' : 'Correcto';
    const text = document.createElement('span');
    text.textContent = String(message);
    toast.append(icon, text);

    container.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(10px)';
      toast.style.transition = 'all 0.3s ease';
      setTimeout(() => toast.remove(), 300);
    }, 3500);
  }
}


// La autenticación invoca este inicializador después de validar la sesión.
(function startApp() {
  function launchApp() {
    if (window.app && window.app._initialized) return;
    window.app = new OdontoApp();
    window.app._initialized = true;
    window.app.init();
  }
  window.launchOdontoApp = launchApp;
})();
