/** Almacenamiento independiente por sitio, sin servidor ni cuentas de usuario. */
class LocalOdontoDB extends OdontoDB {
  constructor() {
    super(null);
    this.isLocal = true;
  }

  async init() {
    if (this.connection) return true;
    await new Promise((resolve, reject) => {
      const request = indexedDB.open(`dentalros:${window.location.pathname.replace(/index\.html$/, '')}`, 1);
      request.onupgradeneeded = () => request.result.createObjectStore('datos');
      request.onerror = () => reject(new Error('No se pudo abrir el almacenamiento del navegador. Revisa sus permisos.'));
      request.onblocked = () => reject(new Error('Cierra las otras pestañas de DentalRos y vuelve a intentar.'));
      request.onsuccess = () => {
        this.connection = request.result;
        this.connection.onversionchange = () => { this.connection.close(); this.connection = null; };
        resolve();
      };
    });
    this.isReady = true;
    return true;
  }

  emptyData() {
    return { pacientes: [], historias: [], consultas: [], odontogramas: [], config: {
      id: 'clinica_config', nombreClinica: 'DentalRos', nombreDoctor: '', especialidad: '',
      colegiatura: '', telefono: '', email: '', direccion: '', piePagina: 'DentalRos'
    }, nextPaciente: 1, nextConsulta: 1 };
  }

  async access(write, operation) {
    await this.init();
    return new Promise((resolve, reject) => {
      const transaction = this.connection.transaction('datos', write ? 'readwrite' : 'readonly');
      const store = transaction.objectStore('datos');
      let result;
      let failure;
      transaction.oncomplete = () => resolve(result);
      transaction.onabort = transaction.onerror = () => reject(failure || new Error('No se pudieron guardar o leer los datos. Comprueba el espacio y los permisos del navegador.'));
      const request = store.get('clinica');
      request.onsuccess = () => {
        try {
          const data = request.result || this.emptyData();
          result = operation(data);
          if (write) store.put(data, 'clinica');
        } catch (error) {
          failure = error;
          transaction.abort();
        }
      };
    });
  }

  requirePatient(data, id) {
    const patient = data.pacientes.find(item => item.id === Number(id));
    if (!patient) throw new Error('Paciente no encontrado.');
    return patient;
  }

  getCatalogo() { return this.access(false, data => data.catalogo || []); }
  saveCatalogo(item) {
    return this.access(true, data => {
      data.catalogo ||= [];
      const value = window.DentalBilling.catalogItem(item);
      const previous = data.catalogo.find(value => value.id === Number(item.id));
      if (item.id && !previous) throw new Error('Elemento no encontrado.');
      if (previous && previous.tipo !== value.tipo) throw new Error('No se puede cambiar el tipo.');
      const id = previous?.id || data.catalogo.reduce((max, item) => Math.max(max, item.id + 1), 1);
      const saved = { ...value, id };
      if (previous) data.catalogo[data.catalogo.indexOf(previous)] = saved;
      else data.catalogo.push(saved);
      return saved;
    });
  }
  getPacientes() { return this.access(false, data => data.pacientes); }
  getPaciente(id) { return this.access(false, data => this.requirePatient(data, id)); }
  savePaciente(patient) {
    return this.access(true, data => {
      if (!patient.nombre?.trim() || !patient.apellido?.trim()) throw new Error('Indica nombre y apellido.');
      const previous = patient.id ? this.requirePatient(data, patient.id) : null;
      const id = previous ? previous.id : data.nextPaciente++;
      const saved = { ...previous, ...patient, id, fechaRegistro: previous?.fechaRegistro || patient.fechaRegistro || new Date().toISOString(), fechaActualizacion: new Date().toISOString() };
      if (previous) data.pacientes[data.pacientes.indexOf(previous)] = saved;
      else data.pacientes.push(saved);
      return id;
    });
  }
  deletePaciente(id) {
    return this.access(true, data => {
      this.requirePatient(data, id);
      data.pacientes = data.pacientes.filter(item => item.id !== Number(id));
      for (const key of ['historias', 'consultas', 'odontogramas']) data[key] = data[key].filter(item => item.pacienteId !== Number(id));
      return true;
    });
  }
  getHistoria(id) { return this.access(false, data => data.historias.find(item => item.pacienteId === Number(id)) || null); }
  getOdontograma(id) { return this.access(false, data => data.odontogramas.find(item => item.pacienteId === Number(id)) || null); }
  saveRelated(key, id, value) {
    return this.access(true, data => {
      this.requirePatient(data, id);
      const index = data[key].findIndex(item => item.pacienteId === Number(id));
      const saved = { ...value, pacienteId: Number(id), fechaActualizacion: new Date().toISOString() };
      if (index < 0) data[key].push(saved);
      else data[key][index] = saved;
      return true;
    });
  }
  saveHistoria(value) { return this.saveRelated('historias', value.pacienteId, value); }
  saveOdontograma(id, piezas, notasGenerales = '') { return this.saveRelated('odontogramas', id, { piezas: piezas || {}, notasGenerales }); }
  getConsultas(id) { return this.access(false, data => data.consultas.filter(item => item.pacienteId === Number(id)).sort((a, b) => String(b.fecha || '').localeCompare(String(a.fecha || '')) || b.id - a.id)); }
  saveConsulta(value) {
    return this.access(true, data => {
      const previous = value.id ? data.consultas.find(item => item.id === Number(value.id)) : null;
      if (value.id && !previous) throw new Error('Consulta no encontrada.');
      const pacienteId = previous?.pacienteId ?? Number(value.pacienteId);
      this.requirePatient(data, pacienteId);
      const id = previous ? previous.id : data.nextConsulta++;
      const saved = { ...previous, ...value, id, pacienteId };
      if (value.procedimientos !== undefined) {
        saved.procedimientos = window.DentalBilling.lines(value.procedimientos, data.catalogo || [], true, previous?.procedimientos || []);
        saved.costo = window.DentalBilling.total(saved.procedimientos);
      } else if (previous?.procedimientos) saved.costo = window.DentalBilling.total(previous.procedimientos);
      if (previous) data.consultas[data.consultas.indexOf(previous)] = saved;
      else data.consultas.push(saved);
      return id;
    });
  }
  deleteConsulta(id) { return this.access(true, data => { data.consultas = data.consultas.filter(item => item.id !== Number(id)); return true; }); }
  getConfig() { return this.access(false, data => data.config); }
  saveConfig(config) { return this.access(true, data => { data.config = { ...data.config, ...config }; return true; }); }
  exportAllData() {
    return this.access(false, ({ pacientes, historias, consultas, odontogramas, config, catalogo }) => ({
      version: '2.0', sistema: 'DentalRos', fechaExportacion: new Date().toISOString(), pacientes, historias, consultas, odontogramas, config, catalogo: catalogo || []
    }));
  }
  importAllData(backup) {
    return this.access(true, data => {
      if (!backup || !Array.isArray(backup.pacientes)) throw new Error('Respaldo inválido: falta la lista de pacientes.');
      const incoming = this.emptyData();
      for (const key of ['pacientes', 'historias', 'consultas', 'odontogramas']) {
        if (backup[key] !== undefined && !Array.isArray(backup[key])) throw new Error(`Respaldo inválido: ${key}.`);
        incoming[key] = structuredClone(backup[key] || []);
        const ids = new Set();
        for (const item of incoming[key]) {
          if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error('Registro inválido en el respaldo.');
          const field = key === 'pacientes' || key === 'consultas' ? 'id' : 'pacienteId';
          item[field] = Number(item[field]);
          if (!Number.isSafeInteger(item[field]) || item[field] <= 0 || ids.has(item[field])) throw new Error('Identificador inválido o duplicado en el respaldo.');
          ids.add(item[field]);
          if (key !== 'pacientes') {
            item.pacienteId = Number(item.pacienteId);
            this.requirePatient(incoming, item.pacienteId);
          } else if (typeof item.nombre !== 'string' || !item.nombre.trim() || typeof item.apellido !== 'string' || !item.apellido.trim()) throw new Error('Paciente sin nombre o apellido.');
        }
      }
      if (backup.config != null) {
        if (typeof backup.config !== 'object' || Array.isArray(backup.config)) throw new Error('Configuración inválida.');
        incoming.config = { ...incoming.config, ...backup.config };
      }
      incoming.nextPaciente = incoming.pacientes.reduce((max, item) => Math.max(max, item.id + 1), 1);
      incoming.nextConsulta = incoming.consultas.reduce((max, item) => Math.max(max, item.id + 1), 1);
      if (backup.catalogo !== undefined) {
        if (!Array.isArray(backup.catalogo)) throw new Error('Catálogo inválido.');
        const ids = new Set();
        incoming.catalogo = backup.catalogo.map(item => {
          if (!Number.isSafeInteger(item.id) || item.id <= 0 || ids.has(item.id)) throw new Error('ID de catálogo inválido o duplicado.');
          ids.add(item.id);
          return { id: item.id, ...window.DentalBilling.catalogItem({ ...item, precio: item.precioCentavos / 100 }) };
        });
      } else incoming.catalogo = data.catalogo || [];
      for (const item of incoming.consultas) {
        if (item.procedimientos !== undefined) item.costo = window.DentalBilling.total(window.DentalBilling.validateSnapshot(item.procedimientos));
      }
      Object.assign(data, incoming);
      return true;
    });
  }
}

window.LocalOdontoDB = LocalOdontoDB;
// El modo local es explícito en la publicación; un fallo de API nunca lo activa.
if (window.DENTALROS_STATIC || window.location.hostname.endsWith('.github.io')) {
  window.odontoDB = new LocalOdontoDB();
}
