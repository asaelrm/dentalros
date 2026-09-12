/** Utilidades pequeñas para renderizar datos ingresados por usuarios sin ejecutar HTML. */
(function exposeSecurityHelpers() {
  const entities = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  };

  window.escapeHTML = (value) => String(value ?? '').replace(/[&<>"']/g, character => entities[character]);
})();
