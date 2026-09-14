/** Catálogo y selector de procedimientos de una consulta. */
class CatalogManager {
  constructor() {
    this.items = [];
    this.lines = [];
    for (const id of ['btn-catalogo', 'btn-catalogo-local']) document.getElementById(id)?.addEventListener('click', () => this.open());
    document.getElementById('btn-close-catalogo').addEventListener('click', () => window.authManager.closeModal('modal-catalogo'));
    document.getElementById('btn-new-catalogo').addEventListener('click', () => this.resetForm());
    document.getElementById('form-catalogo').addEventListener('submit', event => this.save(event));
    document.getElementById('form-catalogo').tipo.addEventListener('change', () => this.priceState());
    document.getElementById('tariff-insurance').addEventListener('change', () => this.renderTariff());
    document.getElementById('tariff-search').addEventListener('input', () => this.renderTariff());
    document.getElementById('btn-save-tariff').addEventListener('click', () => this.saveTariff());
    document.getElementById('invoice-tariff-insurance').addEventListener('change', async event => {
      await this.load(Number(event.target.value));
      this.lines.forEach(line => { const item = this.items.find(i => i.id === line.procedimientoId); line.precio = item?.precioCentavos == null ? null : item.precioCentavos / 100; });
      this.renderLines();
    });
    document.getElementById('btn-add-procedimiento').addEventListener('click', () => {
      const first = this.items.find(item => item.tipo === 'procedimiento' && item.activo && item.precioCentavos != null);
      if (!first) return;
      this.lines.push({ procedimientoId: first.id, diagnosticoId: null, cantidad: 1, precio: first.precioCentavos / 100, coveragePercent: 0, authorizationNumber: '' });
      this.renderLines();
    });
  }
  allowed(permission) { return window.authManager.hasPermission(permission); }
  async load(insuranceId = null) { this.items = await window.odontoDB.getCatalogo(insuranceId); }
  priceState() {
    const form = document.getElementById('form-catalogo');
    form.precio.disabled = form.tipo.value !== 'procedimiento' || !this.allowed('invoice.price');
    form.codigo.readOnly = true;
    form.codigo.placeholder = 'Código automático';
    if (!form.elements.namedItem('id').value) form.codigo.value = '';
    document.getElementById('catalog-code-help').textContent = `El sistema asignará el siguiente código ${form.tipo.value === 'diagnostico' ? 'DGN' : 'PROC'} al guardar.`;
  }
  resetForm() { const form = document.getElementById('form-catalogo'); form.reset(); form.elements.namedItem('id').value = ''; form.tipo.disabled = false; this.priceState(); }
  async open() {
    window.authManager.closeUserMenu();
    window.authManager.openModal('modal-catalogo');
    document.getElementById('form-catalogo').hidden = !this.allowed('catalog.write');
    document.querySelector('#form-catalogo option[value="procedimiento"]').disabled = !this.allowed('invoice.price');
    this.resetForm();
    try { await this.load(); this.renderCatalog(); await this.prepareTariffAdmin(); }
    catch (error) { document.getElementById('catalog-message').textContent = error.message; }
  }
  renderCatalog() {
    const list = document.getElementById('catalog-list');
    const escape = window.escapeHTML;
    list.innerHTML = this.items.length ? this.items.map(item => `<article class="catalog-entry"><div><strong>${item.codigo ? `${escape(item.codigo)} · ` : ''}${escape(item.nombre)}</strong><small>${item.tipo === 'diagnostico' ? 'Diagnóstico' : `Procedimiento · $${(item.precioCentavos / 100).toFixed(2)}`} · ${item.activo ? 'Disponible' : 'Inactivo'}</small></div>${this.allowed('catalog.write') && (item.tipo === 'diagnostico' || this.allowed('invoice.price')) ? `<button type="button" data-id="${item.id}" class="secondary-button">Editar</button>` : ''}</article>`).join('') : '<p>No hay elementos. El administrador crea procedimientos y precios; administradores y doctores pueden registrar diagnósticos.</p>';
    list.querySelectorAll('button').forEach(button => button.addEventListener('click', () => {
      const item = this.items.find(item => item.id === Number(button.dataset.id));
      const form = document.getElementById('form-catalogo');
      form.elements.namedItem('id').value = item.id; form.tipo.value = item.tipo; form.tipo.disabled = true;
      form.nombre.value = item.nombre; form.codigo.value = item.codigo || ''; form.serviceType.value = item.serviceType || 'procedimiento'; form.especialidad.value = item.especialidad || ''; form.descripcion.value = item.descripcion || ''; form.precio.value = (item.precioCentavos / 100).toFixed(2); form.activo.checked = item.activo;
      this.priceState(); form.nombre.focus();
    }));
  }
  async prepareTariffAdmin() {
    const panel = document.getElementById('tariff-admin');
    panel.hidden = !this.allowed('invoice.price');
    if (panel.hidden) return;
    const insurers = await window.odontoDB.getInsurers();
    const select = document.getElementById('tariff-insurance');
    select.innerHTML = insurers.map(i => `<option value="${i.id}">${window.escapeHTML(i.nombre)}</option>`).join('');
    await this.renderTariff();
  }
  async renderTariff() {
    const insuranceId = Number(document.getElementById('tariff-insurance').value);
    if (!insuranceId) return;
    const items = await window.odontoDB.getCatalogo(insuranceId);
    const search = document.getElementById('tariff-search').value.trim().toLowerCase();
    document.getElementById('tariff-price-list').innerHTML = items.filter(i => i.tipo === 'procedimiento' && [i.nombre, i.codigo, i.especialidad, i.serviceType].join(' ').toLowerCase().includes(search)).map(i => `<label class="grid grid-cols-[1fr_140px] gap-3 items-center p-2 bg-white rounded-xl border"><span><strong>${window.escapeHTML(i.codigo || 'SIN-CÓDIGO')} · ${window.escapeHTML(i.nombre)}</strong><small class="block text-slate-500">${i.serviceType === 'consulta' ? 'Consulta' : 'Procedimiento'}${i.especialidad ? ' · ' + window.escapeHTML(i.especialidad) : ''}</small></span><input data-catalog-id="${i.id}" type="number" min="0" step="0.01" class="px-3 py-2 border rounded-lg" placeholder="Sin tarifa" value="${i.precioCentavos == null ? '' : (i.precioCentavos / 100).toFixed(2)}"></label>`).join('');
  }
  async saveTariff() {
    const insuranceId = Number(document.getElementById('tariff-insurance').value);
    const prices = [...document.querySelectorAll('#tariff-price-list [data-catalog-id]')].map(input => ({ catalogId: Number(input.dataset.catalogId), price: input.value }));
    try { await window.odontoDB.saveTarifario(insuranceId, prices); document.getElementById('catalog-message').textContent = 'Tarifario actualizado.'; await this.renderTariff(); }
    catch (error) { document.getElementById('catalog-message').textContent = error.message; }
  }
  async save(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    try {
      await window.odontoDB.saveCatalogo({ ...(form.elements.namedItem('id').value ? { id: Number(form.elements.namedItem('id').value) } : {}), tipo: form.tipo.value, nombre: form.nombre.value.trim(), codigo: '', serviceType: form.serviceType.value, especialidad: form.especialidad.value.trim(), descripcion: form.descripcion.value.trim(), precio: Number(form.precio.value), activo: form.activo.checked });
      await this.load(); this.renderCatalog(); this.resetForm();
      document.getElementById('catalog-message').textContent = 'Catálogo actualizado.';
    } catch (error) { document.getElementById('catalog-message').textContent = error.message; }
    finally { button.disabled = false; }
  }
  async prepareInvoice(invoice = null) {
    this.lines = (invoice?.procedimientos || []).map(item => ({
      procedimientoId: item.procedimientoId,
      diagnosticoId: item.diagnosticoId,
      cantidad: item.cantidad,
      precio: item.precioCentavos / 100,
      coveragePercent: Number(item.coveragePercent || 0), authorizationNumber: item.authorizationNumber || ''
    }));
    const status = document.getElementById('factura-catalog-status');
    status.textContent = 'Cargando catálogo…';
    document.getElementById('btn-add-procedimiento').disabled = true;
    try {
      const insurers = await window.odontoDB.getInsurers();
      const select = document.getElementById('invoice-tariff-insurance');
      select.innerHTML = insurers.map(i => `<option value="${i.id}">${window.escapeHTML(i.nombre)}</option>`).join('');
      select.value = String(invoice?.tariffInsuranceId || window.app.currentPaciente?.insuranceId || insurers.find(i => i.codigo === 'PRIVADO')?.id || '');
      await this.load(Number(select.value));
      this.renderLines();
      const available = this.items.some(item => item.tipo === 'procedimiento' && item.activo && item.precioCentavos != null);
      document.getElementById('btn-add-procedimiento').disabled = !available;
      status.textContent = available ? '' : 'No hay procedimientos con tarifa configurada para esta ARS.';
    } catch (error) { status.textContent = error.message; }
  }
  renderLines() {
    const escape = window.escapeHTML;
    const list = document.getElementById('factura-procedimientos');
    list.innerHTML = this.lines.map((line, index) => `<div class="procedure-line" data-index="${index}">
      <label>Procedimiento<select data-field="procedimientoId">${this.items.filter(item => item.tipo === 'procedimiento' && (item.activo || item.id === line.procedimientoId)).map(item => `<option value="${item.id}" ${item.id === line.procedimientoId ? 'selected' : ''}>${escape(item.nombre)}${item.precioCentavos == null ? ' · Sin tarifa' : ''}</option>`).join('')}</select></label>
      <label>Diagnóstico asociado<select data-field="diagnosticoId"><option value="">Sin asociar</option>${this.items.filter(item => item.tipo === 'diagnostico' && (item.activo || item.id === line.diagnosticoId)).map(item => `<option value="${item.id}" ${item.id === line.diagnosticoId ? 'selected' : ''}>${escape(item.nombre)}</option>`).join('')}</select></label>
      <label>Cantidad<input data-field="cantidad" type="number" min="1" max="100" step="1" required value="${line.cantidad}"></label>
      <label>Precio unitario ($)<input data-field="precio" type="number" min="0" max="10000000" step="0.01" required value="${line.precio}" ${this.allowed('invoice.price') ? '' : 'readonly'}></label>
      <label>Cobertura ARS (%)<input data-field="coveragePercent" type="number" min="0" max="100" step="0.01" value="${Number(line.coveragePercent || 0)}"></label>
      <label>Autorización ARS<input data-field="authorizationNumber" maxlength="100" value="${escape(line.authorizationNumber || '')}" placeholder="Número de autorización"></label>
      <strong class="line-subtotal"></strong><button type="button" class="secondary-button">Quitar</button>
    </div>`).join('');
    list.querySelectorAll('.procedure-line').forEach(row => {
      const index = Number(row.dataset.index);
      row.querySelectorAll('[data-field]').forEach(input => input.addEventListener('input', () => {
        this.lines[index][input.dataset.field] = input.dataset.field === 'authorizationNumber' ? input.value.trim() : (input.value === '' && input.dataset.field === 'diagnosticoId' ? null : Number(input.value));
        if (input.dataset.field === 'procedimientoId') {
          const configured = this.items.find(item => item.id === Number(input.value)).precioCentavos;
          this.lines[index].precio = configured == null ? null : configured / 100;
          row.querySelector('[data-field="precio"]').value = this.lines[index].precio;
        }
        this.updateTotal();
      }));
      row.querySelector('button').addEventListener('click', () => { this.lines.splice(index, 1); this.renderLines(); });
    });
    this.updateTotal();
  }
  updateTotal() {
    let total = 0; let insurance = 0;
    document.querySelectorAll('.procedure-line').forEach((row, index) => {
      const line = this.lines[index];
      const subtotal = Math.round(line.precio * 100) * line.cantidad;
      total += subtotal;
      insurance += Math.round(subtotal * Number(line.coveragePercent || 0) / 100);
      row.querySelector('.line-subtotal').textContent = `Subtotal: $${(subtotal / 100).toFixed(2)}`;
    });
    document.getElementById('form-factura').total.value = (total / 100).toFixed(2);
    document.getElementById('invoice-insurance-summary').textContent = `Seguro: $${(insurance / 100).toFixed(2)} · Paciente: $${((total-insurance)/100).toFixed(2)}`;
  }
  getLines() { return this.lines.map(line => ({ ...line })); }
}
window.addEventListener('DOMContentLoaded', () => { window.catalogManager = new CatalogManager(); });
