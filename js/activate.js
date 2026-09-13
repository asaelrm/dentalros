'use strict';
let invitationToken = new URLSearchParams(window.location.hash.slice(1)).get('invite');
history.replaceState(null, '', window.location.pathname);
const form = document.getElementById('activate-form');
const message = document.getElementById('activate-message');
if (!invitationToken) { form.hidden = true; message.textContent = 'Abre el enlace completo de tu correo. Si venció, pide otro al administrador.'; }
form.addEventListener('submit', async event => {
  event.preventDefault();
  if (form.password.value !== form.confirmation.value) { message.textContent = 'Las contraseñas no coinciden.'; return; }
  const button = form.querySelector('button');
  button.disabled = true;
  message.textContent = 'Guardando…';
  try {
    const response = await fetch('/api/auth/accept-invitation', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: invitationToken, password: form.password.value }) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'No se pudo establecer la contraseña.');
    invitationToken = null;
    form.reset(); form.hidden = true;
    message.textContent = 'Contraseña guardada. Ya puedes iniciar sesión con tu usuario y tu nueva contraseña.';
  } catch (error) { message.textContent = error.message || 'No se pudo conectar con el servidor.'; }
  finally { button.disabled = false; }
});
