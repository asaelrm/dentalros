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

  async init() {
    // 1. Inicializar componente de Odontograma y eventos de UI
    this.odontogramaComponent = new Odontograma('odontograma-canvas');
    this.bindEvents();

    try {
      // 2. Inicializar base de datos local
      await window.odontoDB.init();

      // 3. Cargar configuración
      this.config = await window.odontoDB.getConfig();
      this.applyConfigUI();

      // 4. Cargar lista de pacientes
      let pacientes = await window.odontoDB.getPacientes();
      if (!pacientes || pacientes.length === 0) {
        try {
          await this.crearPacienteEjemplo();
        } catch (demoErr) {
          console.warn('No se pudo crear paciente ejemplo:', demoErr);
        }
        pacientes = await window.odontoDB.getPacientes();
      }

      await this.loadPacientes();

      // 5. Seleccionar el primer paciente si existe
      if (pacientes && pacientes.length > 0) {
        await this.selectPaciente(pacientes[0].id);
      }

    } catch (error) {
      console.error('Error al inicializar el almacenamiento:', error);
      await this.loadPacientes();
    }
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

  // --- PACIENTE DE EJEMPLO PARA PRIMER INICIO ---
  async crearPacienteEjemplo() {
    const pacienteId = await window.odontoDB.savePaciente({
      cedula: '402-1234567-8',
      nombre: 'Carlos',
      apellido: 'Mendoza Pérez',
      fechaNacimiento: '1992-05-14',
      edad: 32,
      sexo: 'Masculino',
      telefono: '809-555-0192',
      email: 'carlos.mendoza@ejemplo.com',
      direccion: 'Calle Sol #45, Ensanche Naco',
      ocupacion: 'Ingeniero de Software',
      contactoEmergencia: 'Laura Pérez (Madre)',
      telefonoEmergencia: '809-555-8844'
    });

    await window.odontoDB.saveHistoria({
      pacienteId: pacienteId,
      motivoPrincipal: 'Dolor y sensibilidad en molar superior derecho al masticar alimentos fríos o dulces.',
      alergias: 'Penicilina (Reacción urticaria)',
      enfermedadesSistemicas: 'Ninguna relevante. Presión arterial controlada.',
      medicamentosActuales: 'Ninguno regular.',
      intervencionesPrevias: 'Extracción de terceros molares inferiores en 2021.',
      habitos: 'Bruxismo nocturno leve.',
      diagnosticoGeneral: 'Caries de esmalte y dentina en pieza 16 cara oclusal. Gingivitis marginal leve generalizada.',
      planTratamiento: '1. Profilaxis y destartraje ultrasónico.\n2. Apertura y restauración con resina compuesta fotocurable en pieza 16.\n3. Férula de descarga nocturna para bruxismo.'
    });

    // Odontograma inicial
    const piezasEjemplo = {
      16: {
        estado: 'caries',
        superficies: { top: 'sano', bottom: 'sano', left: 'sano', right: 'sano', center: 'caries' },
        notas: 'Caries oclusal activa'
      },
      26: {
        estado: 'obturado',
        superficies: { top: 'sano', bottom: 'sano', left: 'sano', right: 'sano', center: 'obturado' },
        notas: 'Resina en buen estado'
      },
      38: {
        estado: 'ausente',
        superficies: { top: 'ausente', bottom: 'ausente', left: 'ausente', right: 'ausente', center: 'ausente' },
        notas: 'Extraído previamente'
      },
      48: {
        estado: 'ausente',
        superficies: { top: 'ausente', bottom: 'ausente', left: 'ausente', right: 'ausente', center: 'ausente' },
        notas: 'Extraído previamente'
      }
    };
    await window.odontoDB.saveOdontograma(pacienteId, piezasEjemplo, 'Pieza 16 sensible a percusión.');

    // Consulta de ejemplo
    await window.odontoDB.saveConsulta({
      pacienteId: pacienteId,
      fecha: new Date().toISOString().split('T')[0],
      motivo: 'Evaluación de dolor en molar superior derecho',
      diagnostico: 'Caries dentinaria profunda en pieza 16',
      tratamiento: 'Remoción de tejido cariado, protección pulpar indirecta y obturación con resina estética Filtek Z350.',
      receta: 'Ibuprofeno 400mg cada 8 horas por 2 días si hay molestias leves.',
      costo: 85,
      observaciones: 'Paciente toleró bien el procedimiento bajo anestesia local sin epinefrina (control de sensibilidad).',
      proximaCita: 'Cita en 15 días para profilaxis y pulido.'
    });
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

    listEl.innerHTML = filtrados.map(p => {
      const isSelected = this.currentPacienteId === p.id;
      return `
        <div class="paciente-item p-3.5 rounded-2xl cursor-pointer transition border ${isSelected ? 'bg-rose-100/90 border-rose-300/90 text-rose-950 shadow-sm' : 'glass-card hover:bg-rose-50/60 border-rose-100/70 text-slate-800'}" data-id="${p.id}">
          <div class="flex items-center justify-between gap-1.5">
            <div class="font-extrabold text-sm truncate ${isSelected ? 'text-rose-950' : 'text-slate-800'}">
              ${p.nombre} ${p.apellido}
            </div>
            <span class="text-[10px] font-mono font-black px-2 py-0.5 rounded-full ${isSelected ? 'bg-rose-200/90 text-rose-950' : 'bg-rose-50 text-rose-800 border border-rose-200/60'}">
              #${String(p.id).padStart(3, '0')}
            </span>
          </div>
          <div class="text-xs text-slate-500 mt-1 flex items-center gap-1.5 flex-wrap">
            <span>DNI: ${p.cedula || 'N/A'}</span>
            <span>&bull;</span>
            <span>${p.edad ? p.edad + ' años' : 'Edad N/A'}</span>
          </div>
          ${p.telefono ? `
            <div class="text-[11px] text-rose-700/80 font-medium mt-1 flex items-center gap-1">
              📞 ${p.telefono}
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
    
    // Inicializar odontograma del paciente
    this.odontogramaComponent.init(id, this.currentOdontograma.piezas, async (piezasActualizadas) => {
      await window.odontoDB.saveOdontograma(this.currentPacienteId, piezasActualizadas);
      this.currentOdontograma.piezas = piezasActualizadas;
    });

    // Resaltar en la lista lateral
    this.loadPacientes(document.getElementById('input-buscar-paciente')?.value || '');

    // Mostrar sección de detalle de paciente si estaba oculta
    document.getElementById('vista-bienvenida')?.classList.add('hidden');
    document.getElementById('vista-detalle-paciente')?.classList.remove('hidden');

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
    infoMeta.innerHTML = `
      <span><strong>DNI/Cédula:</strong> ${p.cedula || 'No especificada'}</span>
      <span>&bull;</span>
      <span><strong>Edad:</strong> ${p.edad ? p.edad + ' años' : '-'}</span>
      <span>&bull;</span>
      <span><strong>Sexo:</strong> ${p.sexo || '-'}</span>
      <span>&bull;</span>
      <span><strong>Teléfono:</strong> ${p.telefono || '-'}</span>
      ${p.email ? `<span>&bull;</span><span><strong>Email:</strong> ${p.email}</span>` : ''}
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
          <p class="text-[11px] text-slate-400 mt-1">Haz clic en el botón "+ Registrar Consulta" para añadir la primera visita o tratamiento.</p>
        </div>
      `;
      return;
    }

    listEl.innerHTML = consultas.map(c => `
      <div class="consulta-card glass-card p-4 sm:p-5 rounded-2xl border border-rose-200/70 shadow-sm relative transition">
        <div class="flex flex-wrap items-center justify-between gap-2 border-b border-rose-100/80 pb-3 mb-3">
          <div class="flex items-center gap-2.5">
            <span class="w-2.5 h-2.5 rounded-full bg-rose-500 shadow-sm"></span>
            <span class="font-black text-slate-900 text-xs sm:text-sm">${c.fecha}</span>
            <span class="text-[10px] sm:text-xs font-black px-2.5 py-0.5 rounded-full bg-rose-100 text-rose-900 border border-rose-200/80 shadow-xs">
              ${c.diagnostico || 'Atención Clínica'}
            </span>
          </div>
          <div class="flex items-center gap-2">
            ${c.costo ? `<span class="text-xs sm:text-sm font-black text-emerald-800 bg-emerald-50 px-2.5 py-0.5 rounded-xl border border-emerald-200 shadow-xs">$${Number(c.costo).toFixed(2)}</span>` : ''}
            <button type="button" class="btn-eliminar-consulta text-slate-400 hover:text-rose-600 text-xs p-1.5 rounded-lg hover:bg-rose-50 transition" data-id="${c.id}" title="Eliminar consulta">
              🗑️
            </button>
          </div>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-3 sm:gap-4 text-xs">
          <div>
            <strong class="text-rose-900/80 uppercase tracking-wider text-[10px] font-black block mb-1">Motivo / Síntomas:</strong>
            <p class="text-slate-800 font-semibold leading-relaxed">${c.motivo || 'Revisión general'}</p>
          </div>
          <div>
            <strong class="text-rose-900/80 uppercase tracking-wider text-[10px] font-black block mb-1">Tratamiento Realizado:</strong>
            <p class="text-slate-800 leading-relaxed">${c.tratamiento || 'Ninguno especificado'}</p>
          </div>
        </div>

        ${c.receta ? `
          <div class="mt-3 p-3 bg-rose-50/70 border border-rose-200/70 rounded-xl text-xs">
            <strong class="text-rose-950 font-black flex items-center gap-1.5 mb-1">
              💊 Prescripción / Receta:
            </strong>
            <p class="text-slate-800 font-medium whitespace-pre-line">${c.receta}</p>
          </div>
        ` : ''}

        ${(c.observaciones || c.proximaCita) ? `
          <div class="mt-2 text-xs text-slate-500 flex flex-wrap justify-between gap-2 pt-2 border-t border-rose-100/60 font-medium">
            <span>${c.observaciones ? 'Obs: ' + c.observaciones : ''}</span>
            ${c.proximaCita ? `<span class="font-bold text-rose-900">📅 Próxima Cita: ${c.proximaCita}</span>` : ''}
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
          this.showToast('Consulta eliminada del récord.');
        }
      });
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
            document.getElementById('vista-detalle-paciente')?.classList.add('hidden');
            document.getElementById('vista-bienvenida')?.classList.remove('hidden');
          }
        }
      });
    }

    // 5. Guardar Formulario Paciente (Nuevo o Editar)
    const formPaciente = document.getElementById('form-paciente');
    if (formPaciente) {
      formPaciente.addEventListener('submit', async (e) => {
        e.preventDefault();
        try {
          const f = formPaciente;
          const pacienteData = {
            nombre: f.nombre.value.trim(),
            apellido: f.apellido.value.trim(),
            cedula: f.cedula.value.trim(),
            fechaNacimiento: f.fechaNacimiento.value || '',
            edad: f.edad.value ? Number(f.edad.value) : null,
            sexo: f.sexo.value,
            telefono: f.telefono.value.trim(),
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
          this.showToast('Paciente guardado exitosamente.');
        } catch (err) {
          console.error('Error al guardar paciente:', err);
          this.showToast('Error al guardar paciente: ' + err.message, 'error');
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
        if (!this.currentPacienteId) return;

        try {
          const f = formConsulta;
          const consultaData = {
            pacienteId: this.currentPacienteId,
            fecha: f.fecha.value || new Date().toISOString().split('T')[0],
            motivo: f.motivo.value.trim(),
            diagnostico: f.diagnostico.value.trim(),
            tratamiento: f.tratamiento.value.trim(),
            receta: f.receta.value.trim(),
            costo: f.costo.value ? Number(f.costo.value) : null,
            observaciones: f.observaciones.value.trim(),
            proximaCita: f.proximaCita.value
          };

          await window.odontoDB.saveConsulta(consultaData);
          this.closeModal('modal-consulta');
          this.currentConsultas = await window.odontoDB.getConsultas(this.currentPacienteId);
          this.renderConsultasTimeline();
          this.showToast('Consulta y evolución registradas con éxito.');
        } catch (err) {
          console.error('Error al guardar consulta:', err);
          this.showToast('Error al guardar consulta: ' + err.message, 'error');
        }
      });
    }

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
            const confirmar = confirm(`¿Deseas restaurar este respaldo con ${data.pacientes ? data.pacientes.length : 0} pacientes? Se reemplazarán los datos locales.`);
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
      m.classList.remove('hidden');
      m.classList.add('flex');
    }
  }

  closeModal(modalId) {
    const m = document.getElementById(modalId);
    if (m) {
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
    this.openModal('modal-consulta');
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
    toast.innerHTML = `
      <span>${type === 'error' ? '❌' : type === 'info' ? 'ℹ️' : '✅'}</span>
      <span>${message}</span>
    `;

    container.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(10px)';
      toast.style.transition = 'all 0.3s ease';
      setTimeout(() => toast.remove(), 300);
    }, 3500);
  }
}

// Inicializar la aplicación cuando el DOM esté listo
document.addEventListener('DOMContentLoaded', () => {
  window.app = new OdontoApp();
  window.app.init();
});
