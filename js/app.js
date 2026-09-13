/**
 * Controlador Principal de la Aplicación Odontológica
 * Sistema de Gestión de Pacientes e Historia Clínica
 */

class OdontoApp {
  constructor() {
    this.currentPacienteId = null;
    this.currentPaciente = null;
    this.currentHistoria = null;
    this.currentConsultas = [];
    this.currentOdontograma = null;
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

    ['btn-exportar-backup', 'label-importar-backup', 'btn-abrir-config']
      .forEach(id => {
        const element = document.getElementById(id);
        if (element) element.hidden = !isAdmin;
      });

    for (const id of ['btn-nuevo-paciente', 'btn-editar-paciente', 'btn-registrar-primer-paciente']) {
      const button = document.getElementById(id);
      if (button) button.hidden = !window.authManager.hasPermission('patients.write');
    }
    document.getElementById('btn-nueva-consulta').hidden = !window.authManager.hasPermission('consultations.write');
    const historiaForm = document.getElementById('form-historia-clinica');
    if (historiaForm) {
      historiaForm.querySelectorAll('input, textarea, select, button[type="submit"]').forEach(control => {
        control.disabled = !canEdit;
      });
      historiaForm.classList.toggle('read-only-form', !canEdit);
    }

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
    this.currentOdontograma = await window.odontoDB.getOdontograma(id) || {
      pacienteId: id,
      piezas: {},
      notasGenerales: ''
    };

    // Actualizar elementos visuales
    this.renderPacienteHeader();
    this.renderHistoriaClinicaForm();
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

    f.motivoPrincipal.value = h.motivoPrincipal || '';
    f.alergias.value = h.alergias || '';
    f.enfermedadesSistemicas.value = h.enfermedadesSistemicas || '';
    f.medicamentosActuales.value = h.medicamentosActuales || '';
    f.intervencionesPrevias.value = h.intervencionesPrevias || '';
    f.habitos.value = h.habitos || '';
    f.diagnosticoGeneral.value = h.diagnosticoGeneral || '';
    f.planTratamiento.value = h.planTratamiento || '';
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
            telefonoEmergencia: f.telefonoEmergencia.value.trim()
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
          piePagina: f.piePagina.value.trim()
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
    } else {
      title.textContent = 'Registrar Nuevo Paciente';
      f.pacienteId.value = '';
    }

    this.openModal('modal-paciente');
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
