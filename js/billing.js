/** Cálculos monetarios en centavos enteros, compartidos entre API y modo local. */
(function (root) {
  function fail(message) { const error = new Error(message); error.status = 400; throw error; }
  function cents(value) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 10000000 || Math.abs(value * 100 - Math.round(value * 100)) > 0.00001) fail('El precio debe ser positivo, con un máximo de dos decimales.');
    return Math.round(value * 100);
  }
  function catalogItem(value) {
    if (!value || !['diagnostico', 'procedimiento'].includes(value.tipo) || typeof value.nombre !== 'string' || !value.nombre.trim() || value.nombre.length > 200) fail('Indica el tipo y un nombre válido para el catálogo.');
    if (value.activo !== undefined && typeof value.activo !== 'boolean') fail('El estado del catálogo no es válido.');
    return { tipo: value.tipo, nombre: value.nombre.trim(), codigo: String(value.codigo || '').trim().slice(0, 50), descripcion: String(value.descripcion || '').trim().slice(0, 500), especialidad: String(value.especialidad || '').trim().slice(0, 100), serviceType: value.tipo === 'procedimiento' && value.serviceType === 'consulta' ? 'consulta' : 'procedimiento', precioCentavos: value.tipo === 'procedimiento' ? cents(value.precio ?? 0) : 0, activo: value.activo ?? true };
  }
  function lines(input, catalog, canPrice, previous = []) {
    if (!Array.isArray(input) || input.length > 100) fail('Selecciona como máximo 100 procedimientos.');
    return input.map(line => {
      if (!line || typeof line !== 'object') fail('Procedimiento inválido.');
      const item = catalog.find(item => item.id === Number(line.procedimientoId) && item.tipo === 'procedimiento');
      const old = previous.find(item => item.procedimientoId === Number(line.procedimientoId));
      if (!item || (!item.activo && !old)) fail('El procedimiento seleccionado ya no está disponible.');
      const quantity = Number(line.cantidad);
      if (!Number.isInteger(quantity) || quantity < 1 || quantity > 100) fail('La cantidad debe ser un entero entre 1 y 100.');
      const diagnosis = line.diagnosticoId ? catalog.find(item => item.id === Number(line.diagnosticoId) && item.tipo === 'diagnostico') : null;
      if (line.diagnosticoId && (!diagnosis || (!diagnosis.activo && !old))) fail('El diagnóstico seleccionado no está disponible.');
      let price = old?.precioCentavos ?? item.precioCentavos;
      if (line.precio !== undefined) {
        const requested = cents(line.precio);
        if (!canPrice && requested !== price) fail('No tienes permiso para cambiar precios.');
        price = requested;
      }
      const coveragePercent = Number(line.coveragePercent ?? old?.coveragePercent ?? 0);
      if (!Number.isFinite(coveragePercent) || coveragePercent < 0 || coveragePercent > 100) fail('La cobertura del procedimiento debe estar entre 0% y 100%.');
      const authorizationNumber = String(line.authorizationNumber ?? old?.authorizationNumber ?? '').trim();
      if (authorizationNumber.length > 100) fail('La autorización del procedimiento admite hasta 100 caracteres.');
      const subtotalCentavos = price * quantity;
      return { procedimientoId: item.id, nombre: old?.nombre ?? item.nombre, diagnosticoId: diagnosis?.id ?? null, diagnostico: diagnosis?.nombre ?? '', cantidad: quantity, precioCentavos: price, subtotalCentavos, coveragePercent, authorizationNumber, insuranceCoveredCentavos: Math.round(subtotalCentavos * coveragePercent / 100) };
    });
  }
  function total(items) { return items.reduce((sum, item) => sum + item.subtotalCentavos, 0) / 100; }
  function validateSnapshot(items) {
    if (!Array.isArray(items) || items.length > 100) fail('Detalle de procedimientos inválido.');
    for (const item of items) {
      if (!item || typeof item.nombre !== 'string' || typeof item.diagnostico !== 'string' || !Number.isSafeInteger(item.procedimientoId) || item.procedimientoId < 1 || !Number.isInteger(item.cantidad) || item.cantidad < 1 || item.cantidad > 100 || !Number.isSafeInteger(item.precioCentavos) || item.precioCentavos < 0 || item.precioCentavos > 1000000000 || item.subtotalCentavos !== item.precioCentavos * item.cantidad || (item.coveragePercent != null && (!Number.isFinite(Number(item.coveragePercent)) || Number(item.coveragePercent)<0 || Number(item.coveragePercent)>100))) fail('Importes inválidos en el respaldo.');
    }
    return items;
  }
  const api = { cents, catalogItem, lines, total, validateSnapshot };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.DentalBilling = api;
})(globalThis);
