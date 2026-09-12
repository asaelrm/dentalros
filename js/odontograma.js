/**
 * Módulo de Odontograma Interactivo (SVG)
 * Sistema de Gestión Odontológica
 * Sistema FDI (Federación Dental Internacional)
 */

class Odontograma {
  constructor(containerId) {
    this.container = document.getElementById(containerId);
    this.data = {}; // { [dienteId]: { estado: 'sano', notas: '', superficies: { oclusal: 'sano', vestibular: 'sano', lingual: 'sano', mesial: 'sano', distal: 'sano' } } }
    this.selectedTool = 'caries'; // Herramienta activa para marcar
    this.pacienteId = null;
    this.onUpdateCallback = null;
    this.readOnly = false;

    // Catálogo de dientes FDI
    this.cuadrantes = {
      superiorDerecho: [18, 17, 16, 15, 14, 13, 12, 11],
      superiorIzquierdo: [21, 22, 23, 24, 25, 26, 27, 28],
      inferiorDerecho: [48, 47, 46, 45, 44, 43, 42, 41],
      inferiorIzquierdo: [31, 32, 33, 34, 35, 36, 37, 38]
    };

    // Estados posibles y sus colores/estilos
    this.estados = {
      sano: { label: 'Sano', color: '#ffffff', stroke: '#94a3b8', icono: '⚪' },
      caries: { label: 'Caries', color: '#ef4444', stroke: '#b91c1c', icono: '🔴' },
      obturado: { label: 'Restaurado (Resina/Amalgama)', color: '#3b82f6', stroke: '#1d4ed8', icono: '🔵' },
      ausente: { label: 'Ausente / Perdido', color: '#64748b', stroke: '#334155', icono: '❌' },
      corona: { label: 'Corona / Prótesis', color: '#f59e0b', stroke: '#b45309', icono: '👑' },
      endodoncia: { label: 'Endodoncia', color: '#8b5cf6', stroke: '#6d28d9', icono: '🟣' },
      extraccion: { label: 'Indicado Extracción', color: '#dc2626', stroke: '#7f1d1d', icono: '⚠️' }
    };
  }

  init(pacienteId, initialData = {}, onUpdate = null, readOnly = false) {
    this.pacienteId = pacienteId;
    this.data = initialData || {};
    this.onUpdateCallback = onUpdate;
    this.readOnly = readOnly;
    this.render();
  }

  setTool(tool) {
    this.selectedTool = tool;
    // Actualizar botones de herramienta activos en la UI
    document.querySelectorAll('.btn-tool-odontograma').forEach(btn => {
      if (btn.dataset.tool === tool) {
        btn.classList.add('tool-active');
      } else {
        btn.classList.remove('tool-active');
      }
    });
  }

  getToothData(dienteId) {
    if (!this.data[dienteId]) {
      this.data[dienteId] = {
        estado: 'sano',
        notas: '',
        superficies: {
          top: 'sano',
          bottom: 'sano',
          left: 'sano',
          right: 'sano',
          center: 'sano'
        }
      };
    }
    return this.data[dienteId];
  }

  setToothState(dienteId, estado) {
    const tooth = this.getToothData(dienteId);
    tooth.estado = estado;
    if (estado === 'ausente' || estado === 'corona' || estado === 'extraccion') {
      // Aplicar al diente entero
      tooth.superficies = {
        top: estado,
        bottom: estado,
        left: estado,
        right: estado,
        center: estado
      };
    }
    this.renderTooth(dienteId);
    this.triggerUpdate();
  }

  setSurfaceState(dienteId, surface, estado) {
    const tooth = this.getToothData(dienteId);
    tooth.superficies[surface] = estado;

    // Si tiene alguna superficie con caries y no estaba ausente, reflejar en el estado general
    const hasCaries = Object.values(tooth.superficies).some(s => s === 'caries');
    const hasObturado = Object.values(tooth.superficies).some(s => s === 'obturado');

    if (tooth.estado !== 'ausente' && tooth.estado !== 'corona') {
      if (hasCaries) tooth.estado = 'caries';
      else if (hasObturado) tooth.estado = 'obturado';
      else tooth.estado = 'sano';
    }

    this.renderTooth(dienteId);
    this.triggerUpdate();
  }

  triggerUpdate() {
    if (this.onUpdateCallback) {
      this.onUpdateCallback(this.data);
    }
  }

  getStats() {
    let totalDientes = 32;
    let cariesCount = 0;
    let obturadosCount = 0;
    let ausentesCount = 0;
    let coronasCount = 0;
    let endodonciasCount = 0;

    for (let id = 11; id <= 48; id++) {
      const tooth = this.data[id];
      if (tooth) {
        if (tooth.estado === 'caries') cariesCount++;
        else if (tooth.estado === 'obturado') obturadosCount++;
        else if (tooth.estado === 'ausente') ausentesCount++;
        else if (tooth.estado === 'corona') coronasCount++;
        else if (tooth.estado === 'endodoncia') endodonciasCount++;
      }
    }

    return {
      total: totalDientes,
      sanos: totalDientes - (cariesCount + obturadosCount + ausentesCount + coronasCount + endodonciasCount),
      caries: cariesCount,
      obturados: obturadosCount,
      ausentes: ausentesCount,
      coronas: coronasCount,
      endodoncias: endodonciasCount
    };
  }

  render() {
    if (!this.container) return;

    this.container.innerHTML = `
      <div class="odontograma-toolbar mb-4 flex flex-wrap items-center justify-between gap-2.5 p-3.5 glass-card rounded-2xl border border-rose-200/70">
        ${this.readOnly ? '<span class="text-xs font-black text-rose-900">Odontograma en modo solo lectura</span>' : `
        <div class="flex items-center gap-2 flex-wrap">
          <span class="text-xs font-bold text-rose-950 uppercase tracking-wider mr-1">Herramienta:</span>
          <button type="button" class="btn-tool-odontograma px-3 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5 transition ${this.selectedTool === 'caries' ? 'tool-active' : 'bg-white/80 text-slate-700 border border-slate-200 shadow-sm'}" data-tool="caries">
            <span class="w-3 h-3 rounded-full bg-red-500 inline-block shadow-sm"></span> Caries
          </button>
          <button type="button" class="btn-tool-odontograma px-3 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5 transition ${this.selectedTool === 'obturado' ? 'tool-active' : 'bg-white/80 text-slate-700 border border-slate-200 shadow-sm'}" data-tool="obturado">
            <span class="w-3 h-3 rounded-full bg-blue-500 inline-block shadow-sm"></span> Restaurado
          </button>
          <button type="button" class="btn-tool-odontograma px-3 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5 transition ${this.selectedTool === 'ausente' ? 'tool-active' : 'bg-white/80 text-slate-700 border border-slate-200 shadow-sm'}" data-tool="ausente">
            <span class="text-rose-600 font-black">✕</span> Ausente
          </button>
          <button type="button" class="btn-tool-odontograma px-3 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5 transition ${this.selectedTool === 'corona' ? 'tool-active' : 'bg-white/80 text-slate-700 border border-slate-200 shadow-sm'}" data-tool="corona">
            <span class="w-3 h-3 rounded-full bg-amber-500 inline-block shadow-sm"></span> Corona
          </button>
          <button type="button" class="btn-tool-odontograma px-3 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5 transition ${this.selectedTool === 'endodoncia' ? 'tool-active' : 'bg-white/80 text-slate-700 border border-slate-200 shadow-sm'}" data-tool="endodoncia">
            <span class="w-3 h-3 rounded-full bg-purple-500 inline-block shadow-sm"></span> Endodoncia
          </button>
          <button type="button" class="btn-tool-odontograma px-3 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5 transition ${this.selectedTool === 'sano' ? 'tool-active' : 'bg-white/80 text-slate-700 border border-slate-200 shadow-sm'}" data-tool="sano">
            <span class="w-3 h-3 rounded-full bg-slate-200 border border-slate-400 inline-block"></span> Limpiar / Sano
          </button>
        </div>

        `}

        <div class="text-xs text-slate-500 flex items-center gap-2">
          <span>${this.readOnly ? 'Puedes consultar los hallazgos sin modificarlos.' : 'Toca una cara dental o haz doble clic para marcar el diente completo.'}</span>
        </div>
      </div>

      <!-- Arcada Superior -->
      <div class="arcada-section mb-5 glass-card p-4 sm:p-5 rounded-2xl border border-rose-100/80 shadow-sm">
        <div class="text-center font-extrabold text-xs uppercase tracking-wider text-rose-900/80 mb-2">Arcada Superior (Maxilar)</div>
        <div class="flex justify-center items-center gap-2 md:gap-4 overflow-x-auto pb-2">
          <!-- Cuadrante 1: 18 - 11 -->
          <div class="flex items-center gap-1.5 border-r-2 border-rose-200 pr-2 sm:pr-3">
            ${this.cuadrantes.superiorDerecho.map(id => this.renderToothHtml(id)).join('')}
          </div>
          <!-- Cuadrante 2: 21 - 28 -->
          <div class="flex items-center gap-1.5 pl-1 sm:pl-2">
            ${this.cuadrantes.superiorIzquierdo.map(id => this.renderToothHtml(id)).join('')}
          </div>
        </div>
        <div class="flex justify-between text-[11px] text-rose-900/60 font-semibold px-4 mt-1">
          <span>Derecha (18 - 11)</span>
          <span>Izquierda (21 - 28)</span>
        </div>
      </div>

      <!-- Arcada Inferior -->
      <div class="arcada-section glass-card p-4 sm:p-5 rounded-2xl border border-rose-100/80 shadow-sm">
        <div class="flex justify-between text-[11px] text-rose-900/60 font-semibold px-4 mb-1">
          <span>Derecha (48 - 41)</span>
          <span>Izquierda (31 - 38)</span>
        </div>
        <div class="flex justify-center items-center gap-2 md:gap-4 overflow-x-auto pb-2">
          <!-- Cuadrante 4: 48 - 41 -->
          <div class="flex items-center gap-1.5 border-r-2 border-rose-200 pr-2 sm:pr-3">
            ${this.cuadrantes.inferiorDerecho.map(id => this.renderToothHtml(id)).join('')}
          </div>
          <!-- Cuadrante 3: 31 - 38 -->
          <div class="flex items-center gap-1.5 pl-1 sm:pl-2">
            ${this.cuadrantes.inferiorIzquierdo.map(id => this.renderToothHtml(id)).join('')}
          </div>
        </div>
        <div class="text-center font-extrabold text-xs uppercase tracking-wider text-rose-900/80 mt-2">Arcada Inferior (Mandibular)</div>
      </div>

      <!-- Resumen estadístico del odontograma -->
      <div id="odontograma-stats-bar" class="mt-4 flex flex-wrap gap-3 items-center justify-center p-3.5 glass-card rounded-2xl border border-rose-200/70 text-xs">
        <!-- Renderizado dinámico de estadísticas -->
      </div>
    `;

    this.attachEvents();
    this.updateStatsBar();
  }

  renderToothHtml(dienteId) {
    const tooth = this.getToothData(dienteId);
    const surfs = tooth.superficies || { top: 'sano', bottom: 'sano', left: 'sano', right: 'sano', center: 'sano' };

    const getColor = (estado) => {
      if (estado === 'caries') return '#ef4444';
      if (estado === 'obturado') return '#3b82f6';
      if (estado === 'corona') return '#f59e0b';
      if (estado === 'endodoncia') return '#8b5cf6';
      return '#f8fafc';
    };

    const isAusente = tooth.estado === 'ausente';
    const isCorona = tooth.estado === 'corona';
    const isEndo = tooth.estado === 'endodoncia';

    return `
      <div class="diente-box flex flex-col items-center select-none" data-diente="${dienteId}">
        <span class="text-[11px] font-bold text-slate-700 mb-1">${dienteId}</span>
        <div class="diente-svg-wrap relative w-9 h-9 sm:w-11 sm:h-11 cursor-pointer" title="Diente ${dienteId} - Doble clic para cambiar estado general">
          <svg viewBox="0 0 100 100" class="w-full h-full drop-shadow-sm transition-transform hover:scale-105">
            <!-- Superficie Superior (Top / Vestibular o Lingual) -->
            <polygon points="10,10 90,10 70,30 30,30" 
              fill="${getColor(surfs.top)}" 
              stroke="#94a3b8" stroke-width="2.5" 
              class="diente-surface hover:brightness-95 cursor-pointer" 
              data-diente="${dienteId}" data-surface="top" />

            <!-- Superficie Derecha (Right / Distal o Mesial) -->
            <polygon points="90,10 90,90 70,70 70,30" 
              fill="${getColor(surfs.right)}" 
              stroke="#94a3b8" stroke-width="2.5" 
              class="diente-surface hover:brightness-95 cursor-pointer" 
              data-diente="${dienteId}" data-surface="right" />

            <!-- Superficie Inferior (Bottom / Lingual o Vestibular) -->
            <polygon points="90,90 10,90 30,70 70,70" 
              fill="${getColor(surfs.bottom)}" 
              stroke="#94a3b8" stroke-width="2.5" 
              class="diente-surface hover:brightness-95 cursor-pointer" 
              data-diente="${dienteId}" data-surface="bottom" />

            <!-- Superficie Izquierda (Left / Mesial o Distal) -->
            <polygon points="10,10 30,30 30,70 10,90" 
              fill="${getColor(surfs.left)}" 
              stroke="#94a3b8" stroke-width="2.5" 
              class="diente-surface hover:brightness-95 cursor-pointer" 
              data-diente="${dienteId}" data-surface="left" />

            <!-- Superficie Central (Center / Oclusal o Incisal) -->
            <polygon points="30,30 70,30 70,70 30,70" 
              fill="${getColor(surfs.center)}" 
              stroke="#94a3b8" stroke-width="2.5" 
              class="diente-surface hover:brightness-95 cursor-pointer" 
              data-diente="${dienteId}" data-surface="center" />

            <!-- Simbología de Ausente (Gran X roja) -->
            ${isAusente ? `
              <line x1="12" y1="12" x2="88" y2="88" stroke="#dc2626" stroke-width="8" stroke-linecap="round" />
              <line x1="88" y1="12" x2="12" y2="88" stroke="#dc2626" stroke-width="8" stroke-linecap="round" />
            ` : ''}

            <!-- Corona / Prótesis (Círculo amarillo alrededor) -->
            ${isCorona ? `
              <circle cx="50" cy="50" r="42" fill="none" stroke="#d97706" stroke-width="6" stroke-dasharray="6,4" />
            ` : ''}

            <!-- Endodoncia (Línea central morada de conducto) -->
            ${isEndo ? `
              <circle cx="50" cy="50" r="14" fill="#8b5cf6" stroke="#5b21b6" stroke-width="2" />
            ` : ''}
          </svg>
        </div>
      </div>
    `;
  }

  renderTooth(dienteId) {
    const box = this.container.querySelector(`.diente-box[data-diente="${dienteId}"]`);
    if (!box) return;

    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = this.renderToothHtml(dienteId);
    const newBox = tempDiv.firstElementChild;
    box.replaceWith(newBox);
    this.attachToothEvents(newBox);
    this.updateStatsBar();
  }

  attachEvents() {
    if (this.readOnly) return;
    // Manejo de clic en herramientas
    this.container.querySelectorAll('.btn-tool-odontograma').forEach(btn => {
      btn.addEventListener('click', () => {
        this.setTool(btn.dataset.tool);
      });
    });

    // Eventos en dientes
    this.container.querySelectorAll('.diente-box').forEach(box => {
      this.attachToothEvents(box);
    });
  }

  attachToothEvents(box) {
    const dienteId = box.dataset.diente;

    // Clic en superficies individuales
    box.querySelectorAll('.diente-surface').forEach(surfEl => {
      surfEl.addEventListener('click', (e) => {
        e.stopPropagation();
        const surface = surfEl.dataset.surface;
        if (this.selectedTool === 'ausente' || this.selectedTool === 'corona' || this.selectedTool === 'endodoncia') {
          // Estas herramientas aplican a todo el diente
          this.setToothState(dienteId, this.selectedTool);
        } else {
          this.setSurfaceState(dienteId, surface, this.selectedTool);
        }
      });
    });

    // Doble clic o clic derecho para alternar / limpiar diente completo
    box.addEventListener('dblclick', (e) => {
      e.preventDefault();
      this.setToothState(dienteId, this.selectedTool);
    });

    box.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      // Con clic derecho se limpia a sano
      this.setToothState(dienteId, 'sano');
    });
  }

  updateStatsBar() {
    const bar = document.getElementById('odontograma-stats-bar');
    if (!bar) return;

    const stats = this.getStats();
    bar.innerHTML = `
      <span class="font-bold text-slate-700">Resumen Dental:</span>
      <span class="text-slate-600">Sanos: <strong class="text-emerald-600">${stats.sanos}</strong></span>
      <span class="text-slate-600">Caries: <strong class="text-red-600">${stats.caries}</strong></span>
      <span class="text-slate-600">Restaurados: <strong class="text-blue-600">${stats.obturados}</strong></span>
      <span class="text-slate-600">Ausentes: <strong class="text-slate-700">${stats.ausentes}</strong></span>
      <span class="text-slate-600">Coronas: <strong class="text-amber-600">${stats.coronas}</strong></span>
      <span class="text-slate-600">Endodoncias: <strong class="text-purple-600">${stats.endodoncias}</strong></span>
    `;
  }
}

window.Odontograma = Odontograma;
