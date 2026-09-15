/**
 * Cliente de la API protegida de DentalRos.
 * Los datos clínicos se almacenan en SQLite a través del servidor local.
 */

class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

class ApiClient {
  async request(path, options = {}) {
    const headers = new Headers(options.headers || {});
    const requestOptions = {
      method: options.method || 'GET',
      headers,
      credentials: 'same-origin'
    };

    if (Object.hasOwn(options, 'body')) {
      headers.set('Content-Type', 'application/json');
      requestOptions.body = JSON.stringify(options.body);
    }

    let response;
    try {
      response = await fetch(path, requestOptions);
    } catch (error) {
      throw new ApiError(0, 'No se pudo conectar con el servidor. Inicia el sistema con Iniciar_Sistema.bat.');
    }

    const isJson = (response.headers.get('content-type') || '').includes('application/json');
    const payload = isJson ? await response.json() : null;

    if (!response.ok) {
      const apiError = new ApiError(response.status, payload?.error || 'No se pudo completar la solicitud.');
      if (response.status === 401 && !options.suppressAuthEvent) {
        window.dispatchEvent(new CustomEvent('auth:unauthorized'));
      }
      throw apiError;
    }

    return payload;
  }
}

class OdontoDB {
  constructor(apiClient) {
    this.api = apiClient;
    this.isReady = false;
  }

  async init() {
    this.isReady = true;
    return true;
  }

  async getCatalogo(insuranceId = null) { return this.api.request(`/api/catalogo${insuranceId ? `?insuranceId=${Number(insuranceId)}` : ''}`); }
  async getTarifarios() { return this.api.request('/api/tarifarios'); }
  async saveTarifario(insuranceId, prices) { return this.api.request('/api/tarifarios', { method: 'PUT', body: { insuranceId, prices } }); }

  async saveCatalogo(item) {
    return this.api.request(item.id ? `/api/catalogo/${Number(item.id)}` : '/api/catalogo', { method: item.id ? 'PUT' : 'POST', body: item });
  }

  async getInsurers() { return this.api.request('/api/insurers'); }
  async getAppointments(from,to) { return this.api.request(`/api/appointments?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`); }
  async getDashboard() { return this.api.request('/api/dashboard'); }
  async getFinancialReport(from, to) { return this.api.request(`/api/reports/financial?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`); }
  async getAudit() { return this.api.request('/api/audit'); }
  async approveCashSession(id) { return this.api.request(`/api/cash/sessions/${Number(id)}/approve`,{method:'POST',body:{}}); }
  async saveAppointment(item) { return this.api.request(item.id?`/api/appointments/${Number(item.id)}`:'/api/appointments',{method:item.id?'PUT':'POST',body:item}); }
  async createSqliteBackup() { return this.api.request('/api/backups', { method: 'POST', body: {} }); }
  async getSqliteBackups() { return this.api.request('/api/backups'); }
  async createInsurer(nombre) { return this.api.request('/api/insurers', { method: 'POST', body: { nombre } }); }
  async getCashReport(from, to, filters = {}) { const params = new URLSearchParams({ from, to }); Object.entries(filters).forEach(([key,value]) => { if (value) params.set(key,value); }); return this.api.request(`/api/cash?${params}`); }
  async openCashSession(data) { return this.api.request('/api/cash/session', { method: 'POST', body: data }); }
  async closeCashSession(data) { return this.api.request('/api/cash/session/close', { method: 'POST', body: data }); }
  async auditVoucherReprint(id) { return this.api.request(`/api/cash/payments/${Number(id)}/reprint`, { method: 'POST', body: {} }); }
  async voidCashPayment(id) { return this.api.request(`/api/cash/payments/${Number(id)}/void`, { method: 'POST', body: {} }); }
  async chargeInvoice(consultationId, payment) { return this.api.request(`/api/consultas/${Number(consultationId)}/charge`, { method: 'POST', body: payment }); }
  async getPresupuestos(patientId) { return this.api.request(`/api/pacientes/${Number(patientId)}/presupuestos`); }
  async savePresupuesto(patientId, data) { return this.api.request(`/api/pacientes/${Number(patientId)}/presupuestos`, { method: 'POST', body: data }); }
  async convertPresupuesto(id) { return this.api.request(`/api/presupuestos/${Number(id)}/convertir`, { method: 'POST', body: {} }); }
  async deletePresupuesto(id) { return this.api.request(`/api/presupuestos/${Number(id)}`, { method: 'DELETE' }); }

  async getPacientes() {
    return this.api.request('/api/pacientes');
  }

  async getPaciente(id) {
    return this.api.request(`/api/pacientes/${Number(id)}`);
  }

  async savePaciente(paciente) {
    const isUpdate = Number.isSafeInteger(Number(paciente.id)) && Number(paciente.id) > 0;
    const saved = await this.api.request(
      isUpdate ? `/api/pacientes/${Number(paciente.id)}` : '/api/pacientes',
      { method: isUpdate ? 'PUT' : 'POST', body: paciente }
    );
    return saved.id;
  }

  async deletePaciente(id) {
    await this.api.request(`/api/pacientes/${Number(id)}`, { method: 'DELETE' });
    return true;
  }

  async getHistoria(pacienteId) {
    return this.api.request(`/api/pacientes/${Number(pacienteId)}/historia`);
  }

  async saveHistoria(historia) {
    await this.api.request(`/api/pacientes/${Number(historia.pacienteId)}/historia`, {
      method: 'PUT',
      body: historia
    });
    return true;
  }

  async getAdjuntos(pacienteId) {
    return this.api.request(`/api/pacientes/${Number(pacienteId)}/adjuntos`);
  }

  async uploadAdjunto(pacienteId, file, metadata = {}) {
    const extensionTypes = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', pdf: 'application/pdf', doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' };
    const extension = file.name.split('.').pop().toLowerCase();
    const response = await fetch(`/api/pacientes/${Number(pacienteId)}/adjuntos`, {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': file.type || extensionTypes[extension] || 'application/octet-stream', 'X-File-Name': encodeURIComponent(file.name), 'X-Document-Category': metadata.category || 'otro', 'X-Document-Description': encodeURIComponent(metadata.description || ''), 'X-Document-Date': metadata.documentDate || '' },
      body: file
    });
    const payload = await response.json();
    if (!response.ok) throw new ApiError(response.status, payload?.error || 'No se pudo adjuntar el archivo.');
    return payload;
  }

  async deleteAdjunto(id) {
    return this.api.request(`/api/adjuntos/${Number(id)}`, { method: 'DELETE' });
  }

  getAdjuntoUrl(id) { return `/api/adjuntos/${Number(id)}`; }
  async getFirmas(pacienteId) { return this.api.request(`/api/pacientes/${Number(pacienteId)}/firmas`); }
  async saveFirma(pacienteId, data) { return this.api.request(`/api/pacientes/${Number(pacienteId)}/firmas`, { method: 'POST', body: data }); }
  async getConsentimientos(pacienteId) { return this.api.request(`/api/pacientes/${Number(pacienteId)}/consentimientos`); }
  async saveConsentimiento(pacienteId, data) { return this.api.request(`/api/pacientes/${Number(pacienteId)}/consentimientos`, { method: 'POST', body: data }); }

  async getConsultas(pacienteId) {
    return this.api.request(`/api/pacientes/${Number(pacienteId)}/consultas`);
  }

  async saveConsulta(consulta) {
    const isUpdate = Number.isSafeInteger(Number(consulta.id)) && Number(consulta.id) > 0;
    const saved = await this.api.request(
      isUpdate ? `/api/consultas/${Number(consulta.id)}` : `/api/pacientes/${Number(consulta.pacienteId)}/consultas`,
      { method: isUpdate ? 'PUT' : 'POST', body: consulta }
    );
    return saved.id;
  }

  async deleteConsulta(id) {
    await this.api.request(`/api/consultas/${Number(id)}`, { method: 'DELETE' });
    return true;
  }

  async saveFactura(consultaId, factura) {
    return this.api.request(`/api/consultas/${Number(consultaId)}/factura`, { method: 'PUT', body: factura });
  }

  async closeFactura(consultaId) {
    return this.api.request(`/api/consultas/${Number(consultaId)}/factura/cerrar`, { method: 'POST', body: {} });
  }

  async reopenFactura(consultaId) {
    return this.api.request(`/api/consultas/${Number(consultaId)}/factura/reabrir`, { method: 'POST', body: {} });
  }
  async voidFactura(consultaId, reason) { return this.api.request(`/api/consultas/${Number(consultaId)}/factura/anular`, { method: 'POST', body: { reason } }); }

  async getOdontograma(pacienteId) {
    return this.api.request(`/api/pacientes/${Number(pacienteId)}/odontograma`);
  }
  async getOdontogramaHistorial(pacienteId) { return this.api.request(`/api/pacientes/${Number(pacienteId)}/odontograma/historial`); }

  async saveOdontograma(pacienteId, piezas, notasGenerales = '') {
    await this.api.request(`/api/pacientes/${Number(pacienteId)}/odontograma`, {
      method: 'PUT',
      body: { piezas: piezas || {}, notasGenerales: notasGenerales || '' }
    });
    return true;
  }

  async getConfig() {
    return this.api.request('/api/config');
  }

  async saveConfig(config) {
    await this.api.request('/api/config', { method: 'PUT', body: config });
    return true;
  }

  async exportAllData() {
    return this.api.request('/api/backup');
  }

  async importAllData(data) {
    await this.api.request('/api/backup/import', { method: 'POST', body: data });
    return true;
  }

  getLegacyBackup() {
    try {
      const pacientes = JSON.parse(localStorage.getItem('odonto_pacientes') || '[]');
      if (!Array.isArray(pacientes) || pacientes.length === 0) return null;

      return {
        version: '2.0',
        fechaExportacion: new Date().toISOString(),
        sistema: 'DentalRos - Migración de almacenamiento local',
        pacientes,
        historias: Object.values(JSON.parse(localStorage.getItem('odonto_historias') || '{}')),
        consultas: JSON.parse(localStorage.getItem('odonto_consultas') || '[]'),
        odontogramas: Object.values(JSON.parse(localStorage.getItem('odonto_odontogramas') || '{}')),
        config: JSON.parse(localStorage.getItem('odonto_config') || 'null')
      };
    } catch (error) {
      console.warn('No se pudieron leer datos locales anteriores:', error);
      return null;
    }
  }
}

window.ApiError = ApiError;
window.apiClient = new ApiClient();
window.odontoDB = new OdontoDB(window.apiClient);
