/** Permisos compartidos por servidor e interfaz. Los roles anteriores siguen siendo válidos. */
(function (root) {
  const labels = { admin: 'Administrador', doctor: 'Doctor/a', secretaria: 'Secretaría', auxiliar: 'Auxiliar de odontología', soporte: 'Soporte técnico', editor: 'Editor (anterior)', lector: 'Solo lectura' };
  const grants = {
    admin: ['clinical.read', 'clinical.write', 'patients.write', 'consultations.write', 'catalog.write', 'prices.write', 'users.manage'],
    doctor: ['clinical.read', 'clinical.write', 'patients.write', 'consultations.write', 'catalog.write', 'prices.write'],
    secretaria: ['clinical.read', 'patients.write', 'consultations.write'],
    auxiliar: ['clinical.read'], soporte: ['users.manage'],
    editor: ['clinical.read', 'clinical.write', 'patients.write', 'consultations.write'], lector: ['clinical.read']
  };
  const api = { labels, grants, has: (role, permission) => (grants[role] || []).includes(permission), baseRole: role => role === 'admin' ? 'admin' : ['doctor', 'editor'].includes(role) ? 'editor' : 'lector' };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.DentalPermissions = api;
})(globalThis);
