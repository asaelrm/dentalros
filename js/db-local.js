/** Almacenamiento independiente por sitio, sin servidor ni cuentas de usuario. */
const LOCAL_INSURERS = ['SeNaSa','Primera ARS','MAPFRE Salud ARS','ARS Universal','ARS Futuro','ARS SEMMA','ARS Renacer','ARS Monumental','ARS APS','ARS SIMAG','ARS Dr. Yunen','ARS Colegio Médico Dominicano (CMD)','ARS Reservas','ARS MetaSalud','ARS Amor y Paz','ARS Grupo Médico Asociado (GMA)','Plan de Salud Banco Central','Sin seguro / Privado']
  .map((nombre, index) => ({ id: index + 1, nombre, codigo: nombre === 'Sin seguro / Privado' ? 'PRIVADO' : `ARS_${index + 1}` }));
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
    }, insurers: structuredClone(LOCAL_INSURERS), cashPayments: [], nextInsurer: LOCAL_INSURERS.length + 1, nextPayment: 1, nextPaciente: 1, nextConsulta: 1 };
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
  getInsurers() { return this.access(false, data => structuredClone(data.insurers || LOCAL_INSURERS)); }
  createInsurer(nombre) {
    return this.access(true, data => {
      data.insurers ||= structuredClone(LOCAL_INSURERS); data.nextInsurer ||= data.insurers.reduce((max, item) => Math.max(max, item.id + 1), 1);
      const clean = String(nombre || '').trim(); if (!clean) throw new Error('Indica el nombre del seguro.');
      const existing = data.insurers.find(item => item.nombre.toLowerCase() === clean.toLowerCase()); if (existing) return existing;
      const saved = { id: data.nextInsurer++, nombre: clean, codigo: `CUSTOM_${Date.now()}` }; data.insurers.push(saved); return saved;
    });
  }
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
      data.insurers ||= structuredClone(LOCAL_INSURERS);
      const insurer = patient.insuranceId ? data.insurers.find(item => item.id === Number(patient.insuranceId)) : null;
      if (patient.insuranceId && !insurer) throw new Error('Seguro/ARS no válido.');
      if (insurer?.codigo !== 'PRIVADO' && insurer && !String(patient.affiliateNumber || '').trim()) throw new Error('El número de afiliado/carnet es obligatorio.');
      const saved = { ...previous, ...patient, insuranceId: insurer?.id || null, insuranceName: insurer?.nombre || '', id, fechaRegistro: previous?.fechaRegistro || patient.fechaRegistro || new Date().toISOString(), fechaActualizacion: new Date().toISOString() };
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
  saveFactura(consultaId, value) {
    return this.access(true, data => {
      const consultation = data.consultas.find(item => item.id === Number(consultaId));
      if (!consultation) throw new Error('Consulta no encontrada.');
      if (consultation.factura?.estado === 'cerrada') throw new Error('La factura está cerrada. Debes reabrirla antes de modificarla.');
      const diagnostico = String(value.diagnostico || '').trim();
      if (!diagnostico) throw new Error('El diagnóstico de la factura es obligatorio.');
      const procedimientos = window.DentalBilling.lines(value.procedimientos || [], data.catalogo || [], true, consultation.factura?.procedimientos || []);
      consultation.factura = { diagnostico, procedimientos, total: window.DentalBilling.total(procedimientos), estado: 'abierta', creadaEn: consultation.factura?.creadaEn || new Date().toISOString(), actualizadaEn: new Date().toISOString(), cerradaEn: null };
      return structuredClone(consultation);
    });
  }
  closeFactura(consultaId) {
    return this.access(true, data => {
      const consultation = data.consultas.find(item => item.id === Number(consultaId));
      if (!consultation?.factura) throw new Error('Guarda la factura antes de cerrarla.');
      if (!consultation.factura.procedimientos.length) throw new Error('Agrega al menos un procedimiento antes de cerrar la factura.');
      consultation.factura.estado = 'cerrada'; consultation.factura.cerradaEn = new Date().toISOString();
      return structuredClone(consultation);
    });
  }
  reopenFactura(consultaId) {
    return this.access(true, data => {
      const consultation = data.consultas.find(item => item.id === Number(consultaId));
      if (consultation?.factura?.estado !== 'cerrada') throw new Error('La factura no está cerrada.');
      consultation.factura.estado = 'abierta'; consultation.factura.cerradaEn = null;
      return structuredClone(consultation);
    });
  }
  getCashReport(from, to) {
    return this.access(false, data => {
      const payments = (data.cashPayments || []).filter(item => item.paidAt.slice(0, 10) >= from && item.paidAt.slice(0, 10) <= to);
      const paidIds = new Set((data.cashPayments || []).map(item => item.consultationId));
      const pendingInvoices = data.consultas.filter(item => item.factura?.estado === 'cerrada' && !paidIds.has(item.id)).map(item => {
        const patient = this.requirePatient(data, item.pacienteId); return { consultationId: item.id, patientId: item.pacienteId, patientName: `${patient.nombre} ${patient.apellido}`, date: item.fecha, diagnosis: item.factura.diagnostico, total: item.factura.total };
      });
      const byMethod = {}; for (const item of payments) byMethod[item.paymentMethod] = Number(((byMethod[item.paymentMethod] || 0) + item.amount).toFixed(2));
      return { from, to, payments: structuredClone(payments), pendingInvoices, total: Number(payments.reduce((sum, item) => sum + item.amount, 0).toFixed(2)), byMethod };
    });
  }
  chargeInvoice(consultationId, payment) {
    return this.access(true, data => {
      data.cashPayments ||= []; data.nextPayment ||= data.cashPayments.reduce((max, item) => Math.max(max, item.id + 1), 1);
      const consultation = data.consultas.find(item => item.id === Number(consultationId));
      if (consultation?.factura?.estado !== 'cerrada') throw new Error('La factura debe estar cerrada antes de cobrarla.');
      if (data.cashPayments.some(item => item.consultationId === consultation.id)) throw new Error('Esta factura ya fue cobrada.');
      const saved = { id: data.nextPayment++, consultationId: consultation.id, patientId: consultation.pacienteId, amount: consultation.factura.total, paymentMethod: payment.paymentMethod || 'efectivo', reference: String(payment.reference || ''), receivedByName: 'Este navegador', paidAt: new Date().toISOString() };
      data.cashPayments.push(saved); return structuredClone(saved);
    });
  }
  getConfig() { return this.access(false, data => data.config); }
  saveConfig(config) { return this.access(true, data => { data.config = { ...data.config, ...config }; return true; }); }
  exportAllData() {
    return this.access(false, ({ pacientes, historias, consultas, odontogramas, config, catalogo, insurers, cashPayments }) => ({
      version: '3.0', sistema: 'DentalRos', fechaExportacion: new Date().toISOString(), pacientes, historias, consultas, odontogramas, config, catalogo: catalogo || [], insurers: insurers || LOCAL_INSURERS, cashPayments: cashPayments || []
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
      incoming.insurers = Array.isArray(backup.insurers) ? structuredClone(backup.insurers) : (data.insurers || structuredClone(LOCAL_INSURERS));
      incoming.cashPayments = Array.isArray(backup.cashPayments) ? structuredClone(backup.cashPayments) : [];
      incoming.nextInsurer = incoming.insurers.reduce((max, item) => Math.max(max, Number(item.id) + 1), 1);
      incoming.nextPayment = incoming.cashPayments.reduce((max, item) => Math.max(max, Number(item.id) + 1), 1);
      for (const item of incoming.consultas) {
        if (item.procedimientos !== undefined) item.costo = window.DentalBilling.total(window.DentalBilling.validateSnapshot(item.procedimientos));
        if (item.factura !== undefined) {
          if (!item.factura || typeof item.factura.diagnostico !== 'string' || !['abierta', 'cerrada'].includes(item.factura.estado)) throw new Error('Factura inválida en el respaldo.');
          item.factura.total = window.DentalBilling.total(window.DentalBilling.validateSnapshot(item.factura.procedimientos));
        }
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
