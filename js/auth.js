/**
 * Autenticación, sesión y administración de usuarios de DentalRos.
 */

class AuthManager {
  constructor() {
    this.user = null;
    this.passwordChangeForced = false;
    this.users = [];
    this.started = false;
    this.bindEvents();
  }

  isAdmin() {
    return this.user?.role === 'admin';
  }

  hasPermission(permission) { return window.DentalPermissions.has(this.user?.role, permission, this.user?.invoiceAccess); }

  canEdit() { return this.hasPermission('clinical.write'); }

  roleLabel(role) {
    return window.DentalPermissions.labels[role] || role;
  }

  async init() {
    this.showAuthState('loading');
    try {
      if (window.odontoDB.isLocal) {
        await window.odontoDB.init();
        this.user = { displayName: 'Este navegador', username: 'local', role: 'admin', mustChangePassword: false };
        this.updateUserUI();
        document.getElementById('current-user-role').textContent = 'Modo local';
        document.getElementById('btn-user-menu').hidden = true;
        document.getElementById('local-mode-notice').hidden = false;
        await this.enterApplication();
        return;
      }
      const setup = await window.apiClient.request('/api/setup-status', { suppressAuthEvent: true });
      if (setup.needsSetup) {
        this.showAuthState('setup');
        return;
      }

      try {
        const response = await window.apiClient.request('/api/auth/me', { suppressAuthEvent: true });
        await this.completeAuthentication(response.user);
      } catch (error) {
        if (error.status === 401) {
          this.showAuthState('login');
          return;
        }
        throw error;
      }
    } catch (error) {
      this.showServerError(error.message);
    }
  }

  bindEvents() {
    document.getElementById('form-login')?.addEventListener('submit', event => this.login(event));
    document.getElementById('form-setup')?.addEventListener('submit', event => this.setup(event));
    document.getElementById('btn-auth-reintentar')?.addEventListener('click', () => this.init());
    document.getElementById('btn-descargar-datos-locales')?.addEventListener('click', () => this.downloadLegacyData());
    document.getElementById('btn-user-menu')?.addEventListener('click', event => {
      event.stopPropagation();
      this.toggleUserMenu();
    });
    document.getElementById('btn-support-users')?.addEventListener('click', () => this.openUsersModal());
    document.getElementById('btn-cerrar-sesion')?.addEventListener('click', () => this.logout());
    document.getElementById('btn-cambiar-password')?.addEventListener('click', () => this.openPasswordModal(false));
    document.getElementById('btn-gestionar-usuarios')?.addEventListener('click', () => this.openUsersModal());
    document.getElementById('btn-cerrar-modal-usuarios')?.addEventListener('click', () => this.closeModal('modal-usuarios'));
    document.getElementById('form-crear-usuario')?.addEventListener('submit', event => this.createUser(event));
    document.querySelector('#form-crear-usuario select[name="role"]')?.addEventListener('change', event => this.updateNewUserInvoiceAccess(event.target.value));
    document.getElementById('form-reset-password')?.addEventListener('submit', event => this.resetPassword(event));
    document.getElementById('btn-cancelar-reset-password')?.addEventListener('click', () => this.closeModal('modal-reset-password'));
    document.getElementById('form-cambiar-password')?.addEventListener('submit', event => this.changePassword(event));
    document.getElementById('btn-cancelar-cambiar-password')?.addEventListener('click', () => {
      if (!this.passwordChangeForced) this.closeModal('modal-cambiar-password');
    });
    document.addEventListener('click', event => {
      if (!event.target.closest('.user-menu-wrap')) this.closeUserMenu();
    });
    window.addEventListener('auth:unauthorized', () => {
      if (!this.user) return;
      this.user = null;
      alert('Tu sesión venció o fue cerrada. Debes iniciar sesión nuevamente.');
      window.location.reload();
    });
  }

  showAuthState(state) {
    const authScreen = document.getElementById('auth-screen');
    const appShell = document.getElementById('app-shell');
    if (authScreen) authScreen.hidden = false;
    if (appShell) {
      appShell.hidden = true;
      appShell.classList.remove('flex');
    }

    const states = {
      loading: 'auth-loading',
      login: 'auth-login-panel',
      setup: 'auth-setup-panel',
      error: 'auth-error-panel'
    };
    Object.values(states).forEach(id => {
      const panel = document.getElementById(id);
      if (panel) panel.hidden = id !== states[state];
    });
    this.setAuthMessage('');

    if (state === 'login') document.querySelector('#form-login input[name="username"]')?.focus();
    if (state === 'setup') document.querySelector('#form-setup input[name="displayName"]')?.focus();
  }

  showServerError(message) {
    this.showAuthState('error');
    const error = document.getElementById('auth-server-error');
    if (error) error.textContent = message;
  }

  setAuthMessage(message, type = 'error') {
    const element = document.getElementById('auth-message');
    if (!element) return;
    element.hidden = !message;
    element.textContent = message;
    element.dataset.type = type;
  }

  setFormBusy(form, busy, busyText) {
    const button = form.querySelector('button[type="submit"]');
    if (!button) return;
    if (busy) {
      button.dataset.originalText = button.textContent;
      button.textContent = busyText;
    } else if (button.dataset.originalText) {
      button.textContent = button.dataset.originalText;
    }
    button.disabled = busy;
  }

  async setup(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    const password = String(values.get('password') || '');
    if (password !== String(values.get('confirmPassword') || '')) {
      this.setAuthMessage('Las contraseñas no coinciden.');
      return;
    }

    this.setAuthMessage('');
    this.setFormBusy(form, true, 'Creando administrador...');
    try {
      const response = await window.apiClient.request('/api/setup', {
        method: 'POST',
        body: {
          displayName: String(values.get('displayName') || ''),
          username: String(values.get('username') || ''),
          password
        },
        suppressAuthEvent: true
      });
      await this.completeAuthentication(response.user);
    } catch (error) {
      this.setAuthMessage(error.message);
    } finally {
      this.setFormBusy(form, false);
    }
  }

  async login(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    this.setAuthMessage('');
    this.setFormBusy(form, true, 'Verificando...');
    try {
      const response = await window.apiClient.request('/api/auth/login', {
        method: 'POST',
        body: {
          username: String(values.get('username') || ''),
          password: String(values.get('password') || '')
        },
        suppressAuthEvent: true
      });
      form.reset();
      await this.completeAuthentication(response.user);
    } catch (error) {
      this.setAuthMessage(error.message);
    } finally {
      this.setFormBusy(form, false);
    }
  }

  async completeAuthentication(user) {
    this.user = user;
    this.updateUserUI();
    if (user.mustChangePassword) {
      document.getElementById('auth-screen').hidden = true;
      this.openPasswordModal(true);
      return;
    }
    await this.enterApplication();
  }

  async enterApplication() {
    await this.offerLegacyMigration();
    const authScreen = document.getElementById('auth-screen');
    const appShell = document.getElementById('app-shell');
    if (authScreen) authScreen.hidden = true;
    if (appShell) {
      appShell.hidden = false;
      appShell.classList.add('flex');
    }
    if (this.user.role === 'soporte') {
      [...appShell.children].forEach(element => { if (element.tagName !== 'HEADER' && element.id !== 'support-panel') element.hidden = true; });
      document.getElementById('support-panel').hidden = false;
      appShell.querySelectorAll('header button').forEach(button => { if (!['btn-user-menu', 'btn-gestionar-usuarios', 'btn-cambiar-password', 'btn-cerrar-sesion'].includes(button.id)) button.hidden = true; });
      await this.openUsersModal();
      return;
    }
    if (!this.started) {
      this.started = true;
      window.launchOdontoApp();
    } else {
      window.app?.applyPermissions();
    }
  }

  async offerLegacyMigration() {
    if (window.odontoDB.isLocal) return;
    if (!this.isAdmin() || localStorage.getItem('odonto_api_migration_complete') === '1') return;
    const legacy = window.odontoDB.getLegacyBackup();
    if (!legacy) return;

    try {
      const serverPatients = await window.odontoDB.getPacientes();
      if (serverPatients.length > 0) return;
      const accepted = confirm(`Se encontraron ${legacy.pacientes.length} pacientes guardados en este navegador. ¿Deseas migrarlos ahora a la base de datos protegida?`);
      if (!accepted) return;
      await window.odontoDB.importAllData(legacy);
      localStorage.setItem('odonto_api_migration_complete', '1');
    } catch (error) {
      alert('No fue posible migrar los datos anteriores: ' + error.message);
    }
  }

  downloadLegacyData() {
    const legacy = window.odontoDB.getLegacyBackup();
    if (!legacy) {
      this.setAuthMessage('No se encontraron pacientes guardados anteriormente en este navegador.');
      return;
    }
    const blob = new Blob([JSON.stringify(legacy, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `Migracion_DentalRos_${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    this.setAuthMessage('Datos anteriores descargados. Inicia el servidor y restáuralos desde una cuenta administradora.', 'success');
  }

  updateUserUI() {
    if (!this.user) return;
    const initials = this.user.displayName
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map(part => part[0].toUpperCase())
      .join('');
    const values = {
      'current-user-initials': initials || 'U',
      'current-user-name': this.user.displayName,
      'current-user-role': this.roleLabel(this.user.role),
      'menu-user-name': this.user.displayName,
      'menu-user-username': `@${this.user.username}`
    };
    Object.entries(values).forEach(([id, value]) => {
      const element = document.getElementById(id);
      if (element) element.textContent = value;
    });
    const usersButton = document.getElementById('btn-gestionar-usuarios');
    if (usersButton) usersButton.hidden = !this.hasPermission('users.manage') || window.odontoDB.isLocal;
  }

  toggleUserMenu() {
    const menu = document.getElementById('user-menu-panel');
    const button = document.getElementById('btn-user-menu');
    if (!menu || !button) return;
    menu.hidden = !menu.hidden;
    button.setAttribute('aria-expanded', String(!menu.hidden));
  }

  closeUserMenu() {
    const menu = document.getElementById('user-menu-panel');
    const button = document.getElementById('btn-user-menu');
    if (menu) menu.hidden = true;
    if (button) button.setAttribute('aria-expanded', 'false');
  }

  openModal(id) {
    const modal = document.getElementById(id);
    if (!modal) return;
    modal.hidden = false;
    modal.classList.remove('hidden');
    modal.classList.add('flex');
  }

  closeModal(id) {
    const modal = document.getElementById(id);
    if (!modal) return;
    modal.hidden = true;
    modal.classList.add('hidden');
    modal.classList.remove('flex');
  }

  async logout() {
    this.closeUserMenu();
    try {
      await window.apiClient.request('/api/auth/logout', { method: 'POST', suppressAuthEvent: true });
    } finally {
      window.location.reload();
    }
  }

  openPasswordModal(forced) {
    this.closeUserMenu();
    this.passwordChangeForced = forced;
    const form = document.getElementById('form-cambiar-password');
    form?.reset();
    document.getElementById('password-modal-kicker').textContent = forced ? 'Cambio obligatorio' : 'Seguridad de la cuenta';
    document.getElementById('password-modal-title').textContent = forced ? 'Crea una contraseña personal' : 'Cambiar mi contraseña';
    document.getElementById('password-modal-description').textContent = forced
      ? 'Ingresaste con una contraseña temporal. Debes reemplazarla antes de usar el sistema.'
      : 'Confirma tu contraseña actual antes de crear una nueva.';
    document.getElementById('btn-cancelar-cambiar-password').hidden = forced;
    this.setPasswordMessage('');
    this.openModal('modal-cambiar-password');
    form?.currentPassword.focus();
  }

  setPasswordMessage(message, type = 'error') {
    const element = document.getElementById('password-form-message');
    if (!element) return;
    element.hidden = !message;
    element.textContent = message;
    element.dataset.type = type;
  }

  async changePassword(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    const newPassword = String(values.get('newPassword') || '');
    if (newPassword !== String(values.get('confirmPassword') || '')) {
      this.setPasswordMessage('Las contraseñas nuevas no coinciden.');
      return;
    }

    this.setPasswordMessage('');
    this.setFormBusy(form, true, 'Guardando...');
    try {
      const response = await window.apiClient.request('/api/auth/change-password', {
        method: 'POST',
        body: {
          currentPassword: String(values.get('currentPassword') || ''),
          newPassword
        }
      });
      this.user = response.user;
      this.updateUserUI();
      const wasForced = this.passwordChangeForced;
      this.passwordChangeForced = false;
      this.closeModal('modal-cambiar-password');
      form.reset();
      if (wasForced) await this.enterApplication();
      else this.notify('Contraseña actualizada correctamente.');
    } catch (error) {
      this.setPasswordMessage(error.message);
    } finally {
      this.setFormBusy(form, false);
    }
  }

  async openUsersModal() {
    if (!this.hasPermission('users.manage') || window.odontoDB.isLocal) return;
    document.querySelectorAll('#form-crear-usuario option').forEach(option => { option.disabled = this.user.role === 'soporte' && ['admin', 'soporte'].includes(option.value); });
    this.closeUserMenu();
    this.openModal('modal-usuarios');
    this.updateNewUserInvoiceAccess(document.querySelector('#form-crear-usuario select[name="role"]')?.value);
    await this.loadUsers();
  }

  updateNewUserInvoiceAccess(role) {
    const field = document.getElementById('new-user-invoice-access');
    if (!field) return;
    field.hidden = role !== 'doctor' || !this.isAdmin();
    if (field.hidden) field.querySelector('input').checked = false;
  }

  async loadUsers() {
    const list = document.getElementById('lista-usuarios');
    if (list) list.innerHTML = '<p class="user-list-empty">Cargando usuarios...</p>';
    try {
      this.users = await window.apiClient.request('/api/users');
      this.renderUsers();
    } catch (error) {
      if (list) list.textContent = error.message;
    }
  }

  renderUsers() {
    const list = document.getElementById('lista-usuarios');
    const count = document.getElementById('usuarios-count');
    if (!list) return;
    if (count) count.textContent = String(this.users.length);
    const escape = window.escapeHTML;

    list.innerHTML = this.users.map(user => {
      const isSelf = user.id === this.user.id;
      const restricted = this.user.role === 'soporte' && ['admin', 'soporte'].includes(user.role);
      return `
        <article class="user-card ${user.active ? '' : 'user-card-inactive'}" data-user-id="${user.id}">
          <div class="user-card-status">
            <span class="role-dot role-${user.role}"></span>
            <strong>${escape(user.displayName)}</strong>
            ${user.mustChangePassword ? '<span class="self-badge">Cambio de contraseña pendiente</span>' : ''}
            ${isSelf ? '<span class="self-badge">Tu cuenta</span>' : ''}
          </div>
          <div class="user-edit-grid">
            <label>Nombre<input data-field="displayName" type="text" maxlength="100" value="${escape(user.displayName)}" /></label>
            <label>Usuario<input data-field="username" type="text" maxlength="32" value="${escape(user.username)}" /></label>
            <label>Correo<input data-field="email" type="email" maxlength="254" value="${escape(user.email)}" ${!this.isAdmin() && user.email ? 'disabled' : ''} /></label>
            <label>Permiso
              <select data-field="role" ${isSelf ? 'disabled' : ''}>
                ${Object.entries(window.DentalPermissions.labels).map(([role, label]) => `<option value="${role}" ${user.role === role ? 'selected' : ''} ${this.user.role === 'soporte' && ['admin', 'soporte'].includes(role) ? 'disabled' : ''}>${escape(label)}</option>`).join('')}
              </select>
            </label>
            <label class="active-toggle"><input data-field="active" type="checkbox" ${user.active ? 'checked' : ''} ${isSelf ? 'disabled' : ''} /> Cuenta activa</label>
            ${user.role === 'doctor' ? `<label class="active-toggle"><input data-field="invoiceAccess" type="checkbox" ${user.invoiceAccess ? 'checked' : ''} ${!this.isAdmin() ? 'disabled' : ''} /> Acceso a facturas</label>` : ''}
          </div>
          <div class="user-card-actions">
            <button type="button" class="btn-user-save" ${restricted ? 'disabled' : ''}>Guardar cambios</button>
            <button type="button" class="btn-user-reset" ${isSelf || restricted ? 'disabled' : ''}>Restablecer contraseña</button>
            <button type="button" class="btn-user-delete" ${isSelf || restricted ? 'disabled' : ''}>Eliminar</button>
          </div>
        </article>
      `;
    }).join('');

    list.querySelectorAll('.user-card').forEach(card => {
      const userId = Number(card.dataset.userId);
      card.querySelector('.btn-user-save')?.addEventListener('click', () => this.saveUser(card, userId));
      card.querySelector('.btn-user-reset')?.addEventListener('click', () => this.openResetPassword(userId));
      card.querySelector('.btn-user-delete')?.addEventListener('click', () => this.deleteUser(userId));
    });
  }

  async createUser(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    const password = String(values.get('password') || '');
    if (password !== String(values.get('confirmPassword') || '')) {
      this.notify('Las contraseñas no coinciden.', 'error');
      return;
    }
    this.setFormBusy(form, true, 'Creando...');
    try {
      const created = await window.apiClient.request('/api/users', {
        method: 'POST',
        body: {
          displayName: String(values.get('displayName') || ''),
          username: String(values.get('username') || ''),
          role: String(values.get('role') || 'lector'),
          email: String(values.get('email') || ''),
          password,
          invoiceAccess: values.get('invoiceAccess') === 'on'
        }
      });
      form.reset();
      await this.loadUsers();
      this.notify('Cuenta creada. Entrega la contraseña temporal al usuario de forma privada.');
    } catch (error) {
      this.notify(error.message, 'error');
    } finally {
      this.setFormBusy(form, false);
    }
  }

  async saveUser(card, userId) {
    const body = {
      displayName: card.querySelector('[data-field="displayName"]').value,
      username: card.querySelector('[data-field="username"]').value,
      ...(card.querySelector('[data-field="email"]').value ? { email: card.querySelector('[data-field="email"]').value } : {}),
      role: card.querySelector('[data-field="role"]').value,
      active: card.querySelector('[data-field="active"]').checked
    };
    const invoiceAccess = card.querySelector('[data-field="invoiceAccess"]');
    if (invoiceAccess && this.isAdmin()) body.invoiceAccess = invoiceAccess.checked;
    try {
      const updatedUser = await window.apiClient.request(`/api/users/${userId}`, { method: 'PUT', body });
      if (updatedUser.id === this.user.id) {
        this.user = updatedUser;
        this.updateUserUI();
      }
      await this.loadUsers();
      this.notify('Permisos y datos del usuario actualizados.');
    } catch (error) {
      this.notify(error.message, 'error');
    }
  }

  openResetPassword(userId) {
    const user = this.users.find(item => item.id === userId);
    if (!user || user.id === this.user.id) return;
    const form = document.getElementById('form-reset-password');
    form.reset();
    form.userId.value = String(userId);
    document.getElementById('reset-password-user-name').textContent = user.displayName;
    this.openModal('modal-reset-password');
    form.querySelector('button[type="submit"]').focus();
  }

  async resetPassword(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    const password = String(values.get('password') || '');
    if (password !== String(values.get('confirmPassword') || '')) {
      this.notify('Las contraseñas no coinciden.', 'error');
      return;
    }
    this.setFormBusy(form, true, 'Restableciendo...');
    try {
      const result = await window.apiClient.request(`/api/users/${Number(values.get('userId'))}/reset-password`, {
        method: 'POST',
        body: { password }
      });
      this.closeModal('modal-reset-password');
      await this.loadUsers();
      this.notify('Contraseña temporal actualizada. El usuario deberá cambiarla al iniciar sesión.');
    } catch (error) {
      this.notify(error.message, 'error');
    } finally {
      this.setFormBusy(form, false);
    }
  }

  async deleteUser(userId) {
    const user = this.users.find(item => item.id === userId);
    if (!user || user.id === this.user.id) return;
    if (!confirm(`¿Eliminar definitivamente el usuario ${user.displayName}?`)) return;
    try {
      await window.apiClient.request(`/api/users/${userId}`, { method: 'DELETE' });
      await this.loadUsers();
      this.notify('Usuario eliminado.');
    } catch (error) {
      this.notify(error.message, 'error');
    }
  }

  notify(message, type = 'success') {
    if (!document.getElementById('modal-usuarios').classList.contains('hidden')) {
      const status = document.getElementById('users-message');
      status.hidden = false; status.textContent = message; status.dataset.type = type;
      return;
    }
    if (window.app?.showToast) {
      window.app.showToast(message, type);
      return;
    }
    const element = document.getElementById('password-form-message');
    if (element) {
      element.hidden = false;
      element.textContent = message;
      element.dataset.type = type;
    }
  }
}

(function startAuthentication() {
  function launch() {
    if (window.authManager) return;
    window.authManager = new AuthManager();
    window.authManager.init();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', launch);
  else launch();
})();
