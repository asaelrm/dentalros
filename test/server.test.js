'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createServer } = require('../server');

function cookieFrom(response) {
  const setCookies = typeof response.headers.getSetCookie === 'function'
    ? response.headers.getSetCookie()
    : [response.headers.get('set-cookie')].filter(Boolean);
  return setCookies[0] ? setCookies[0].split(';', 1)[0] : null;
}

test('API odontologica: integracion completa', async (t) => {
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'odontologia-test-'));
  const databasePath = path.join(temporaryDirectory, 'test.sqlite');
  const sentMail = [];
  const server = createServer({
    mailer: { baseUrl: 'https://dentalros.test/', send: async message => { sentMail.push(message); } },
    dbPath: databasePath,
    cookieSecure: false,
    staticRoot: path.resolve(__dirname, '..'),
    logger: { error() {} }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  async function rawRequest(urlPath, options = {}) {
    const headers = new Headers(options.headers || {});
    if (options.cookie) headers.set('Cookie', options.cookie);
    let body;
    if (Object.hasOwn(options, 'body')) {
      headers.set('Content-Type', 'application/json');
      body = JSON.stringify(options.body);
    }
    const response = await fetch(`${baseUrl}${urlPath}`, {
      method: options.method || 'GET',
      headers,
      body,
      redirect: 'manual'
    });
    const text = await response.text();
    let data = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
    }
    return {
      status: response.status,
      data,
      cookie: cookieFrom(response),
      headers: response.headers
    };
  }

  // En estas regresiones el destinatario acepta su invitación con la clave de prueba.
  async function request(urlPath, options = {}) {
    const invitation = options.method === 'POST' && (urlPath === '/api/users' || urlPath.endsWith('/reset-password')) && options.body?.password;
    if (!invitation) return rawRequest(urlPath, options);
    const { password, ...body } = options.body;
    if (urlPath === '/api/users') body.email = `${body.username.toLowerCase()}@example.test`;
    const result = await rawRequest(urlPath, { ...options, body });
    if (result.status < 300) {
      assert.equal(result.data.invitationSent, true);
      const token = new URLSearchParams(new URL(sentMail.at(-1).url).hash.slice(1)).get('invite');
      assert.equal((await rawRequest('/api/auth/accept-invitation', { method: 'POST', body: { token, password } })).status, 200);
    }
    return result;
  }

  let adminCookie;
  let setupCookie;
  let readerId;
  let editorId;
  let editorCookie;
  let patientId;
  let consultationId;

  try {
    await t.test('sirve estaticos sin exponer backend ni permitir traversal', async () => {
      const indexResponse = await request('/');
      assert.equal(indexResponse.status, 200);
      assert.match(indexResponse.headers.get('content-type'), /^text\/html/);
      assert.match(indexResponse.data, /<!DOCTYPE html>/i);
      assert.equal(indexResponse.headers.get('x-content-type-options'), 'nosniff');
      assert.equal(indexResponse.headers.get('access-control-allow-origin'), null);

      assert.equal((await request('/server.js')).status, 404);
      assert.equal((await request('/data/odontologia.sqlite')).status, 404);
      assert.equal((await request('/js/%2e%2e/server.js')).status, 404);

      const unknownApi = await request('/api/desconocida');
      assert.equal(unknownApi.status, 404);
      assert.deepEqual(unknownApi.data, { error: 'Endpoint no encontrado.' });
    });

    await t.test('setup solo funciona una vez e inicia sesion segura para localhost', async () => {
      assert.deepEqual((await request('/api/setup-status')).data, { needsSetup: true });

      const setup = await request('/api/setup', {
        method: 'POST',
        body: {
          username: 'Admin.Principal',
          displayName: 'Administradora Principal',
          password: 'AdminInicial123!'
        }
      });
      assert.equal(setup.status, 201);
      assert.equal(setup.data.user.username, 'admin.principal');
      assert.equal(setup.data.user.role, 'admin');
      assert.equal(setup.data.user.active, true);
      assert.equal(setup.data.user.mustChangePassword, false);
      assert.ok(!Object.hasOwn(setup.data.user, 'password_hash'));
      setupCookie = setup.cookie;
      const setupHeader = setup.headers.get('set-cookie');
      assert.match(setupHeader, /HttpOnly/i);
      assert.match(setupHeader, /SameSite=Strict/i);
      assert.match(setupHeader, /Path=\//i);
      assert.match(setupHeader, /Max-Age=\d+/i);
      assert.doesNotMatch(setupHeader, /; Secure/i);

      assert.deepEqual((await request('/api/setup-status')).data, { needsSetup: false });
      const repeated = await request('/api/setup', {
        method: 'POST',
        body: {
          username: 'otro.admin',
          displayName: 'Otro Admin',
          password: 'OtroPassword123!'
        }
      });
      assert.equal(repeated.status, 409);
    });

    await t.test('login usa error generico y la cookie autentica /me', async () => {
      const wrongLogin = await request('/api/auth/login', {
        method: 'POST',
        body: { username: 'admin.principal', password: 'Incorrecta123!' }
      });
      assert.equal(wrongLogin.status, 401);
      assert.deepEqual(wrongLogin.data, { error: 'Credenciales invalidas.' });

      const login = await request('/api/auth/login', {
        method: 'POST',
        body: { username: 'ADMIN.PRINCIPAL', password: 'AdminInicial123!' }
      });
      assert.equal(login.status, 200);
      adminCookie = login.cookie;
      assert.ok(adminCookie);

      const me = await request('/api/auth/me', { cookie: adminCookie });
      assert.equal(me.status, 200);
      assert.equal(me.data.user.username, 'admin.principal');
      assert.equal((await request('/api/auth/me')).status, 401);
    });

    await t.test('admin crea y lista usuarios sin exponer secretos', async () => {
      const reader = await request('/api/users', {
        method: 'POST',
        cookie: adminCookie,
        body: {
          username: 'Lectora.Uno',
          displayName: 'Lectora Uno',
          role: 'lector',
          password: 'TemporalLector123!'
        }
      });
      assert.equal(reader.status, 201);
      assert.equal(reader.data.username, 'lectora.uno');
      assert.equal(reader.data.mustChangePassword, false);
      readerId = reader.data.id;

      const editor = await request('/api/users', {
        method: 'POST',
        cookie: adminCookie,
        body: {
          username: 'editor.uno',
          displayName: 'Editor Uno',
          role: 'editor',
          password: 'TemporalEditor123!'
        }
      });
      assert.equal(editor.status, 201);
      editorId = editor.data.id;

      const duplicate = await request('/api/users', {
        method: 'POST',
        cookie: adminCookie,
        body: {
          username: 'LECTORA.UNO',
          displayName: 'Duplicada',
          role: 'lector',
          password: 'TemporalDuplicado123!'
        }
      });
      assert.equal(duplicate.status, 409);

      const updated = await request(`/api/users/${readerId}`, {
        method: 'PUT',
        cookie: adminCookie,
        body: { displayName: 'Lectora Clinica' }
      });
      assert.equal(updated.status, 200);
      assert.equal(updated.data.displayName, 'Lectora Clinica');

      const users = await request('/api/users', { cookie: adminCookie });
      assert.equal(users.status, 200);
      assert.equal(users.data.length, 3);
      for (const user of users.data) {
        assert.deepEqual(
          Object.keys(user).sort(),
          ['active', 'createdAt', 'displayName', 'email', 'id', 'invitationPending', 'mustChangePassword', 'role', 'updatedAt', 'username'].sort()
        );
      }
    });

    await t.test('lector puede leer datos clinicos pero no mutarlos', async () => {
      const login = await request('/api/auth/login', {
        method: 'POST',
        body: { username: 'lectora.uno', password: 'TemporalLector123!' }
      });
      assert.equal(login.status, 200);
      assert.equal(login.data.user.mustChangePassword, false);
      const readerCookie = login.cookie;

      assert.equal((await request('/api/pacientes', { cookie: readerCookie })).status, 200);
      const changed = await request('/api/auth/change-password', {
        method: 'POST',
        cookie: readerCookie,
        body: {
          currentPassword: 'TemporalLector123!',
          newPassword: 'LectorInicial123!'
        }
      });
      assert.equal(changed.status, 200);
      assert.equal((await request('/api/pacientes', { cookie: readerCookie })).status, 200);
      const forbidden = await request('/api/pacientes', {
        method: 'POST',
        cookie: readerCookie,
        body: { nombre: 'No', apellido: 'Permitido' }
      });
      assert.equal(forbidden.status, 403);
    });

    await t.test('editor muta clinica pero no usuarios, configuracion ni backups', async () => {
      const login = await request('/api/auth/login', {
        method: 'POST',
        body: { username: 'editor.uno', password: 'TemporalEditor123!' }
      });
      assert.equal(login.status, 200);
      editorCookie = login.cookie;
      assert.equal((await request('/api/pacientes', { cookie: editorCookie })).status, 200);
      const changed = await request('/api/auth/change-password', {
        method: 'POST',
        cookie: editorCookie,
        body: {
          currentPassword: 'TemporalEditor123!',
          newPassword: 'EditorInicial123!'
        }
      });
      assert.equal(changed.status, 200);

      const created = await request('/api/pacientes', {
        method: 'POST',
        cookie: editorCookie,
        body: {
          nombre: 'Ana',
          apellido: 'Perez',
          cedula: '001-0000000-1',
          edad: 31
        }
      });
      assert.equal(created.status, 201);
      assert.equal(typeof created.data.id, 'number');
      assert.ok(created.data.fechaRegistro);
      patientId = created.data.id;

      assert.equal((await request('/api/users', { cookie: editorCookie })).status, 403);
      assert.equal((await request('/api/backup', { cookie: editorCookie })).status, 403);
      const configForbidden = await request('/api/config', {
        method: 'PUT',
        cookie: editorCookie,
        body: { nombreClinica: 'No permitida' }
      });
      assert.equal(configForbidden.status, 403);
    });

    await t.test('CRUD clinico conserva campos numericos y elimina en cascada', async () => {
      const updatedPatient = await request(`/api/pacientes/${patientId}`, {
        method: 'PUT',
        cookie: editorCookie,
        body: { nombre: 'Ana Maria', apellido: 'Perez', telefono: '809-555-0101' }
      });
      assert.equal(updatedPatient.status, 200);
      assert.equal(updatedPatient.data.cedula, '001-0000000-1');
      assert.equal(updatedPatient.data.id, patientId);

      const history = await request(`/api/pacientes/${patientId}/historia`, {
        method: 'PUT',
        cookie: editorCookie,
        body: { motivoPrincipal: 'Revision', alergias: 'Ninguna' }
      });
      assert.equal(history.status, 200);
      assert.equal(history.data.pacienteId, patientId);

      const consultation = await request(`/api/pacientes/${patientId}/consultas`, {
        method: 'POST',
        cookie: editorCookie,
        body: { fecha: '2026-09-12', motivo: 'Control', costo: 75 }
      });
      assert.equal(consultation.status, 201);
      assert.equal(consultation.data.pacienteId, patientId);
      consultationId = consultation.data.id;

      const consultationUpdate = await request(`/api/consultas/${consultationId}`, {
        method: 'PUT',
        cookie: editorCookie,
        body: { diagnostico: 'Paciente estable' }
      });
      assert.equal(consultationUpdate.status, 200);
      assert.equal(consultationUpdate.data.motivo, 'Control');

      const odontogram = await request(`/api/pacientes/${patientId}/odontograma`, {
        method: 'PUT',
        cookie: editorCookie,
        body: {
          piezas: { 16: { estado: 'caries', superficies: { center: 'caries' } } },
          notasGenerales: 'Controlar pieza 16'
        }
      });
      assert.equal(odontogram.status, 200);
      assert.equal(odontogram.data.pacienteId, patientId);

      assert.equal((await request(`/api/pacientes/${patientId}/historia`, { cookie: setupCookie })).status, 200);
      assert.equal((await request(`/api/pacientes/${patientId}/consultas`, { cookie: setupCookie })).data.length, 1);

      const deleted = await request(`/api/pacientes/${patientId}`, {
        method: 'DELETE',
        cookie: editorCookie
      });
      assert.equal(deleted.status, 200);
      assert.equal((await request(`/api/pacientes/${patientId}`, { cookie: editorCookie })).status, 404);
      assert.equal(
        server.database.prepare('SELECT COUNT(*) AS count FROM historias WHERE paciente_id = ?').get(patientId).count,
        0
      );
      assert.equal(
        server.database.prepare('SELECT COUNT(*) AS count FROM consultas WHERE paciente_id = ?').get(patientId).count,
        0
      );
      assert.equal(
        server.database.prepare('SELECT COUNT(*) AS count FROM odontogramas WHERE paciente_id = ?').get(patientId).count,
        0
      );
    });

    await t.test('solo admin configura, exporta e importa backup legado en transaccion', async () => {
      const defaultConfig = await request('/api/config', { cookie: adminCookie });
      assert.equal(defaultConfig.status, 200);
      assert.equal(defaultConfig.data.nombreClinica, 'DentalRos');
      assert.equal(defaultConfig.data.nombreDoctor, 'Dr. Odontólogo Tratante');

      const config = await request('/api/config', {
        method: 'PUT',
        cookie: adminCookie,
        body: { nombreDoctor: 'Dra. Rosa Gomez' }
      });
      assert.equal(config.status, 200);
      assert.equal(config.data.nombreDoctor, 'Dra. Rosa Gomez');

      const exported = await request('/api/backup', { cookie: adminCookie });
      assert.equal(exported.status, 200);
      assert.equal(exported.data.version, '2.0');
      assert.ok(Array.isArray(exported.data.pacientes));
      assert.ok(Array.isArray(exported.data.historias));
      assert.ok(Array.isArray(exported.data.consultas));
      assert.ok(Array.isArray(exported.data.odontogramas));

      const legacyBackup = {
        version: '1.0',
        pacientes: [{ id: 77, nombre: 'Paciente', apellido: 'Importado', campoLegado: 'conservado' }],
        historias: {
          77: { motivoPrincipal: 'Importada', alergias: 'Latex' }
        },
        consultas: [{ id: 90, pacienteId: 77, fecha: '2025-01-02', motivo: 'Legado' }],
        odontogramas: {
          77: { piezas: {}, notasGenerales: 'Legado' }
        },
        configuracion: { nombreClinica: 'Clinica Importada' }
      };
      const imported = await request('/api/backup/import', {
        method: 'POST',
        cookie: adminCookie,
        body: legacyBackup
      });
      assert.equal(imported.status, 200);
      assert.equal(imported.data.imported.pacientes, 1);

      const patient = await request('/api/pacientes/77', { cookie: adminCookie });
      assert.equal(patient.status, 200);
      assert.equal(patient.data.id, 77);
      assert.equal(patient.data.campoLegado, 'conservado');
      assert.equal((await request('/api/pacientes/77/historia', { cookie: adminCookie })).data.pacienteId, 77);
      assert.equal((await request('/api/pacientes/77/consultas', { cookie: adminCookie })).data[0].id, 90);
      assert.equal((await request('/api/pacientes/77/odontograma', { cookie: adminCookie })).data.pacienteId, 77);
      assert.equal((await request('/api/config', { cookie: adminCookie })).data.nombreClinica, 'Clinica Importada');

      const invalidImport = await request('/api/backup/import', {
        method: 'POST',
        cookie: adminCookie,
        body: {
          pacientes: [{ id: 1, nombre: 'Valido', apellido: 'Temporal' }],
          consultas: [{ id: 2, pacienteId: 999, motivo: 'FK invalida' }]
        }
      });
      assert.equal(invalidImport.status, 400);
      assert.equal((await request('/api/pacientes/77', { cookie: adminCookie })).status, 200);

      const nextPatient = await request('/api/pacientes', {
        method: 'POST',
        cookie: editorCookie,
        body: { nombre: 'Siguiente', apellido: 'Paciente' }
      });
      assert.equal(nextPatient.status, 201);
      assert.equal(nextPatient.data.id, 78);
    });

    await t.test('cambio y enlace de contraseña revocan las sesiones anteriores', async () => {
      const firstLogin = await request('/api/auth/login', {
        method: 'POST',
        body: { username: 'lectora.uno', password: 'LectorInicial123!' }
      });
      const secondLogin = await request('/api/auth/login', {
        method: 'POST',
        body: { username: 'lectora.uno', password: 'LectorInicial123!' }
      });
      assert.equal(firstLogin.status, 200);
      assert.equal(secondLogin.status, 200);

      const changed = await request('/api/auth/change-password', {
        method: 'POST',
        cookie: firstLogin.cookie,
        body: {
          currentPassword: 'LectorInicial123!',
          newPassword: 'NuevaLectora123!'
        }
      });
      assert.equal(changed.status, 200);
      assert.equal(changed.data.user.mustChangePassword, false);
      assert.equal((await request('/api/auth/me', { cookie: firstLogin.cookie })).status, 200);
      assert.equal((await request('/api/auth/me', { cookie: secondLogin.cookie })).status, 401);
      assert.equal((await request('/api/auth/login', {
        method: 'POST',
        body: { username: 'lectora.uno', password: 'LectorInicial123!' }
      })).status, 401);

      const newLogin = await request('/api/auth/login', {
        method: 'POST',
        body: { username: 'lectora.uno', password: 'NuevaLectora123!' }
      });
      assert.equal(newLogin.status, 200);

      const reset = await request(`/api/users/${readerId}/reset-password`, {
        method: 'POST',
        cookie: adminCookie,
        body: { password: 'Restablecida123!' }
      });
      assert.equal(reset.status, 200);
      assert.equal(reset.data.mustChangePassword, false);
      assert.equal((await request('/api/auth/me', { cookie: newLogin.cookie })).status, 401);

      const resetLogin = await request('/api/auth/login', {
        method: 'POST',
        body: { username: 'lectora.uno', password: 'Restablecida123!' }
      });
      assert.equal(resetLogin.status, 200);
      assert.equal(resetLogin.data.user.mustChangePassword, false);

      const deleted = await request(`/api/users/${readerId}`, {
        method: 'DELETE',
        cookie: adminCookie
      });
      assert.equal(deleted.status, 200);
      assert.equal((await request('/api/auth/me', { cookie: resetLogin.cookie })).status, 401);
    });

    await t.test('protege al propio usuario, al ultimo admin y revoca al desactivar', async () => {
      const me = await request('/api/auth/me', { cookie: adminCookie });
      const adminId = me.data.user.id;

      assert.equal((await request(`/api/users/${adminId}`, {
        method: 'DELETE',
        cookie: adminCookie
      })).status, 409);
      assert.equal((await request(`/api/users/${adminId}`, {
        method: 'PUT',
        cookie: adminCookie,
        body: { active: false }
      })).status, 409);
      assert.equal((await request(`/api/users/${adminId}`, {
        method: 'PUT',
        cookie: adminCookie,
        body: { role: 'editor' }
      })).status, 409);
      assert.equal(
        server.database.prepare("SELECT COUNT(*) AS count FROM users WHERE role = 'admin' AND active = 1").get().count,
        1
      );

      const inactiveCandidate = await request('/api/users', {
        method: 'POST',
        cookie: adminCookie,
        body: {
          username: 'usuario.inactivo',
          displayName: 'Usuario Inactivo',
          role: 'lector',
          password: 'UsuarioActivo123!'
        }
      });
      const candidateLogin = await request('/api/auth/login', {
        method: 'POST',
        body: { username: 'usuario.inactivo', password: 'UsuarioActivo123!' }
      });
      assert.equal(candidateLogin.status, 200);

      const deactivated = await request(`/api/users/${inactiveCandidate.data.id}`, {
        method: 'PUT',
        cookie: adminCookie,
        body: { active: false }
      });
      assert.equal(deactivated.status, 200);
      assert.equal((await request('/api/auth/me', { cookie: candidateLogin.cookie })).status, 401);
      assert.equal((await request('/api/auth/login', {
        method: 'POST',
        body: { username: 'usuario.inactivo', password: 'UsuarioActivo123!' }
      })).status, 401);
    });

    await t.test('admin elimina editor y logout revoca la sesion actual', async () => {
      const deleteEditor = await request(`/api/users/${editorId}`, {
        method: 'DELETE',
        cookie: adminCookie
      });
      assert.equal(deleteEditor.status, 200);
      assert.equal((await request('/api/auth/me', { cookie: editorCookie })).status, 401);

      const logout = await request('/api/auth/logout', {
        method: 'POST',
        cookie: adminCookie
      });
      assert.equal(logout.status, 200);
      assert.match(logout.headers.get('set-cookie'), /Max-Age=0/);
      assert.equal((await request('/api/auth/me', { cookie: adminCookie })).status, 401);
    });

    await t.test('auditoria contiene eventos requeridos sin contrasenas', () => {
      const rows = server.database.prepare('SELECT action, details FROM audit_logs ORDER BY id').all();
      const actions = new Set(rows.map((row) => row.action));
      for (const action of [
        'setup', 'login_success', 'login_failed', 'user_create', 'user_update',
        'user_delete', 'password_change', 'invitation_accepted', 'patient_create',
        'patient_update', 'patient_delete', 'history_update', 'consultation_create',
        'consultation_update', 'odontogram_update', 'config_update', 'backup_export',
        'backup_import'
      ]) {
        assert.ok(actions.has(action), `Falta evento de auditoria: ${action}`);
      }
      const serialized = JSON.stringify(rows);
      assert.doesNotMatch(serialized, /AdminInicial123|TemporalLector123|NuevaLectora123|Restablecida123/);
    });
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

test('El despliegue HTTPS entrega cookies Secure', async () => {
  const server = createServer({ dbPath: ':memory:', cookieSecure: true });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/setup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin.prueba', displayName: 'Prueba HTTPS', password: 'SoloParaPruebas123!' })
    });
    assert.equal(response.status, 201);
    assert.match(response.headers.get('set-cookie'), /; Secure/i);
    assert.match(response.headers.get('set-cookie'), /; HttpOnly/i);
    await response.json();
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});
