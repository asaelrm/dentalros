'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const {
  createHash,
  randomBytes,
  scrypt,
  scryptSync,
  timingSafeEqual
} = require('node:crypto');
const { promisify } = require('node:util');
const {
  DEFAULT_CONFIG,
  openDatabase,
  runTransaction,
  writeAudit
} = require('./server/database');

const scryptAsync = promisify(scrypt);
const ROOT_DIR = __dirname;
const COOKIE_NAME = 'odontologia_session';
const DEFAULT_BODY_LIMIT = 5 * 1024 * 1024;
const DEFAULT_SESSION_MAX_AGE = 8 * 60 * 60;
const USERNAME_PATTERN = /^[a-z0-9][a-z0-9._-]{2,31}$/;
const ROLES = new Set(['admin', 'editor', 'lector']);
const CLINICAL_WRITERS = new Set(['admin', 'editor']);
const DUMMY_SALT = randomBytes(16);
const DUMMY_HASH = scryptSync('credencial-inexistente', DUMMY_SALT, 64);

const MIME_TYPES = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.png', 'image/png'],
  ['.gif', 'image/gif'],
  ['.svg', 'image/svg+xml'],
  ['.ico', 'image/x-icon'],
  ['.webp', 'image/webp'],
  ['.woff', 'font/woff'],
  ['.woff2', 'font/woff2']
]);

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function nowIso() {
  return new Date().toISOString();
}

function applySecurityHeaders(res, isApi = false) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.tailwindcss.com https://cdnjs.cloudflare.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'"
  );
  res.setHeader('Cache-Control', isApi ? 'no-store' : 'no-cache');
}

function sendJson(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload));
}

function sendError(res, status, message) {
  sendJson(res, status, { error: message });
}

function requireObject(value, label = 'El cuerpo') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new HttpError(400, `${label} debe ser un objeto JSON.`);
  }
  return value;
}

function validateJsonObject(value, label, options = {}) {
  requireObject(value, label);
  const maxBytes = options.maxBytes ?? 512 * 1024;
  const maxObjectKeys = options.maxObjectKeys ?? 100;
  const state = { nodes: 0 };

  function visit(item, depth) {
    state.nodes += 1;
    if (state.nodes > 10000 || depth > 12) {
      throw new HttpError(400, `${label} es demasiado complejo.`);
    }

    if (typeof item === 'string') {
      if (item.length > 200000) {
        throw new HttpError(400, `${label} contiene un texto demasiado largo.`);
      }
      return;
    }
    if (typeof item === 'number') {
      if (!Number.isFinite(item)) {
        throw new HttpError(400, `${label} contiene un numero invalido.`);
      }
      return;
    }
    if (item === null || typeof item === 'boolean') return;
    if (Array.isArray(item)) {
      if (item.length > 2000) {
        throw new HttpError(400, `${label} contiene demasiados elementos.`);
      }
      for (const child of item) visit(child, depth + 1);
      return;
    }
    if (typeof item !== 'object') {
      throw new HttpError(400, `${label} contiene un valor no permitido.`);
    }

    const keys = Object.keys(item);
    if (keys.length > maxObjectKeys) {
      throw new HttpError(400, `${label} contiene demasiados campos.`);
    }
    for (const key of keys) {
      if (key.length > 100 || key === '__proto__' || key === 'prototype' || key === 'constructor') {
        throw new HttpError(400, `${label} contiene un campo no permitido.`);
      }
      visit(item[key], depth + 1);
    }
  }

  visit(value, 0);
  if (Buffer.byteLength(JSON.stringify(value)) > maxBytes) {
    throw new HttpError(400, `${label} excede el tamano permitido.`);
  }
  return value;
}

function normalizeUsername(value) {
  if (typeof value !== 'string') {
    throw new HttpError(400, 'El username es obligatorio.');
  }
  const username = value.trim().toLowerCase();
  if (!USERNAME_PATTERN.test(username)) {
    throw new HttpError(400, 'El username debe tener entre 3 y 32 caracteres y usar letras, numeros, punto, guion o guion bajo.');
  }
  return username;
}

function validateDisplayName(value) {
  if (typeof value !== 'string' || value.trim().length < 1 || value.trim().length > 100) {
    throw new HttpError(400, 'El nombre visible es obligatorio y debe tener como maximo 100 caracteres.');
  }
  return value.trim();
}

function validatePassword(value) {
  if (typeof value !== 'string' || value.length < 10 || value.length > 1024) {
    throw new HttpError(400, 'La contrasena debe tener entre 10 y 1024 caracteres.');
  }
  return value;
}

function validateRole(value) {
  if (typeof value !== 'string' || !ROLES.has(value)) {
    throw new HttpError(400, 'El rol debe ser admin, editor o lector.');
  }
  return value;
}

function positiveId(value, label = 'ID') {
  const number = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value;
  if (!Number.isSafeInteger(number) || number <= 0) {
    throw new HttpError(400, `${label} invalido.`);
  }
  return number;
}

function cleanData(object, keys) {
  const result = { ...object };
  for (const key of keys) delete result[key];
  return result;
}

function requireTextField(object, field, label) {
  if (typeof object[field] !== 'string' || !object[field].trim()) {
    throw new HttpError(400, `${label} es obligatorio.`);
  }
  if (object[field].length > 500) {
    throw new HttpError(400, `${label} es demasiado largo.`);
  }
  object[field] = object[field].trim();
}

function validateKnownStrings(object, fields, label) {
  for (const field of fields) {
    if (object[field] !== undefined && typeof object[field] !== 'string') {
      throw new HttpError(400, `${label}.${field} debe ser texto.`);
    }
  }
}

async function readJsonBody(req, limit) {
  const contentType = String(req.headers['content-type'] || '').split(';', 1)[0].trim().toLowerCase();
  if (contentType !== 'application/json') {
    throw new HttpError(400, 'El cuerpo debe usar Content-Type application/json.');
  }

  const declaredLength = Number(req.headers['content-length']);
  if (Number.isFinite(declaredLength) && declaredLength > limit) {
    req.resume();
    throw new HttpError(413, 'El cuerpo de la solicitud excede el limite permitido.');
  }

  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) {
      throw new HttpError(413, 'El cuerpo de la solicitud excede el limite permitido.');
    }
    chunks.push(chunk);
  }

  if (size === 0) {
    throw new HttpError(400, 'El cuerpo JSON es obligatorio.');
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HttpError(400, 'El cuerpo contiene JSON invalido.');
  }
}

async function createPasswordRecord(password) {
  const salt = randomBytes(16);
  const hash = await scryptAsync(password, salt, 64);
  return { salt, hash: Buffer.from(hash) };
}

async function passwordMatches(password, salt, expectedHash) {
  const actual = Buffer.from(await scryptAsync(password, Buffer.from(salt), 64));
  const expected = Buffer.from(expectedHash);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function hashToken(token) {
  return createHash('sha256').update(token).digest('hex');
}

function readSessionToken(req) {
  const cookieHeader = req.headers.cookie;
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(';')) {
    const separator = part.indexOf('=');
    if (separator === -1) continue;
    const name = part.slice(0, separator).trim();
    if (name === COOKIE_NAME) return part.slice(separator + 1).trim() || null;
  }
  return null;
}

function publicUser(row) {
  return {
    id: Number(row.id),
    username: row.username,
    displayName: row.display_name,
    role: row.role,
    active: Boolean(row.active),
    mustChangePassword: Boolean(row.must_change_password),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function getUserRow(db, id) {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id) || null;
}

function createSessionRecord(db, userId, maxAgeSeconds) {
  const token = randomBytes(32).toString('base64url');
  const tokenHash = hashToken(token);
  const now = Date.now();
  db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(now);
  db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)')
    .run(tokenHash, userId, now + maxAgeSeconds * 1000, nowIso());
  return { token, tokenHash };
}

function setSessionCookie(res, token, maxAgeSeconds, secure) {
  const secureAttribute = secure ? '; Secure' : '';
  res.setHeader(
    'Set-Cookie',
    `${COOKIE_NAME}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAgeSeconds}${secureAttribute}`
  );
}

function clearSessionCookie(res, secure) {
  const secureAttribute = secure ? '; Secure' : '';
  res.setHeader(
    'Set-Cookie',
    `${COOKIE_NAME}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secureAttribute}`
  );
}

function authenticate(req, db) {
  const token = readSessionToken(req);
  if (!token || token.length > 200) return null;
  const tokenHash = hashToken(token);
  const row = db.prepare(`
    SELECT u.*
    FROM sessions s
    JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ?
      AND s.revoked_at IS NULL
      AND s.expires_at > ?
      AND u.active = 1
  `).get(tokenHash, Date.now());
  if (!row) return null;
  return { row, user: publicUser(row), tokenHash };
}

function requireRole(auth, allowed) {
  if (!allowed.has(auth.user.role)) {
    throw new HttpError(403, 'No tienes permisos para realizar esta accion.');
  }
}

function requireAdmin(auth) {
  if (auth.user.role !== 'admin') {
    throw new HttpError(403, 'Esta accion requiere rol admin.');
  }
}

function parseData(text) {
  return JSON.parse(text);
}

function patientFromRow(row) {
  return { ...parseData(row.data), id: Number(row.id) };
}

function historyFromRow(row) {
  return { ...parseData(row.data), pacienteId: Number(row.paciente_id) };
}

function consultationFromRow(row) {
  return { ...parseData(row.data), id: Number(row.id), pacienteId: Number(row.paciente_id) };
}

function odontogramFromRow(row) {
  return { ...parseData(row.data), pacienteId: Number(row.paciente_id) };
}

function patientExists(db, patientId) {
  return Boolean(db.prepare('SELECT 1 FROM pacientes WHERE id = ?').get(patientId));
}

function ensurePatient(db, patientId) {
  if (!patientExists(db, patientId)) {
    throw new HttpError(404, 'Paciente no encontrado.');
  }
}

function validatePatientInput(body) {
  validateJsonObject(body, 'El paciente');
  const data = cleanData(body, ['id', 'pacienteId']);
  requireTextField(data, 'nombre', 'El nombre');
  requireTextField(data, 'apellido', 'El apellido');
  validateKnownStrings(data, [
    'cedula', 'fechaNacimiento', 'sexo', 'telefono', 'email', 'direccion',
    'ocupacion', 'contactoEmergencia', 'telefonoEmergencia', 'fechaRegistro',
    'fechaActualizacion'
  ], 'paciente');
  if (data.edad !== undefined && data.edad !== null &&
      (!Number.isInteger(data.edad) || data.edad < 0 || data.edad > 150)) {
    throw new HttpError(400, 'La edad debe ser un numero entero entre 0 y 150.');
  }
  return data;
}

function validateHistoryInput(body) {
  validateJsonObject(body, 'La historia clinica');
  const data = cleanData(body, ['id', 'pacienteId']);
  validateKnownStrings(data, [
    'motivoPrincipal', 'alergias', 'enfermedadesSistemicas', 'medicamentosActuales',
    'intervencionesPrevias', 'habitos', 'diagnosticoGeneral', 'planTratamiento',
    'fechaActualizacion'
  ], 'historia');
  return data;
}

function validateConsultationInput(body) {
  validateJsonObject(body, 'La consulta');
  const data = cleanData(body, ['id', 'pacienteId']);
  validateKnownStrings(data, [
    'fecha', 'motivo', 'diagnostico', 'tratamiento', 'receta', 'observaciones',
    'proximaCita'
  ], 'consulta');
  if (data.costo !== undefined && data.costo !== null &&
      (typeof data.costo !== 'number' || !Number.isFinite(data.costo) || data.costo < 0)) {
    throw new HttpError(400, 'El costo debe ser un numero positivo o null.');
  }
  return data;
}

function validateOdontogramInput(body) {
  validateJsonObject(body, 'El odontograma');
  const data = cleanData(body, ['id', 'pacienteId']);
  if (data.piezas !== undefined && (!data.piezas || typeof data.piezas !== 'object' || Array.isArray(data.piezas))) {
    throw new HttpError(400, 'odontograma.piezas debe ser un objeto.');
  }
  validateKnownStrings(data, ['notasGenerales', 'fechaActualizacion'], 'odontograma');
  return data;
}

function validateConfigInput(body) {
  validateJsonObject(body, 'La configuracion');
  const data = cleanData(body, ['id']);
  validateKnownStrings(data, [
    'nombreClinica', 'nombreDoctor', 'especialidad', 'colegiatura', 'telefono',
    'email', 'direccion', 'piePagina'
  ], 'configuracion');
  return data;
}

function getConfig(db) {
  const row = db.prepare('SELECT data FROM configuracion WHERE id = ?').get(DEFAULT_CONFIG.id);
  const stored = row ? parseData(row.data) : {};
  return { ...DEFAULT_CONFIG, ...stored, id: DEFAULT_CONFIG.id };
}

function getBackup(db) {
  return {
    version: '2.0',
    fechaExportacion: nowIso(),
    sistema: 'DentalRos - Sistema Odontológico Inteligente',
    pacientes: db.prepare('SELECT id, data FROM pacientes ORDER BY id').all().map(patientFromRow),
    historias: db.prepare('SELECT paciente_id, data FROM historias ORDER BY paciente_id').all().map(historyFromRow),
    consultas: db.prepare('SELECT id, paciente_id, data FROM consultas ORDER BY id').all().map(consultationFromRow),
    odontogramas: db.prepare('SELECT paciente_id, data FROM odontogramas ORDER BY paciente_id').all().map(odontogramFromRow),
    config: getConfig(db)
  };
}

function normalizeLegacyCollection(value, label, maxItems, patientIdFromKey = false) {
  if (value === undefined || value === null) return [];
  let items;
  if (Array.isArray(value)) {
    items = value;
  } else if (value && typeof value === 'object') {
    items = Object.entries(value).map(([key, item]) => {
      if (patientIdFromKey && item && typeof item === 'object' && !Array.isArray(item) && item.pacienteId == null) {
        return { ...item, pacienteId: key };
      }
      return item;
    });
  } else {
    throw new HttpError(400, `${label} debe ser un array o mapa legado.`);
  }
  if (items.length > maxItems) {
    throw new HttpError(400, `${label} contiene demasiados elementos.`);
  }
  return items;
}

function normalizeBackup(body) {
  requireObject(body, 'El respaldo');
  if (!Array.isArray(body.pacientes)) {
    throw new HttpError(400, 'El respaldo debe contener pacientes como array.');
  }
  if (body.pacientes.length > 10000) {
    throw new HttpError(400, 'El respaldo contiene demasiados pacientes.');
  }

  const pacientes = body.pacientes.map((record) => {
    validateJsonObject(record, 'Un paciente del respaldo');
    return { id: positiveId(record.id, 'ID de paciente'), data: cleanData(record, ['id', 'pacienteId']) };
  });
  const historiasRaw = normalizeLegacyCollection(
    body.historias ?? body.historiasClinicas,
    'historias',
    10000,
    true
  );
  const consultasRaw = normalizeLegacyCollection(body.consultas, 'consultas', 50000, false);
  const odontogramasRaw = normalizeLegacyCollection(body.odontogramas, 'odontogramas', 10000, true);

  const historias = historiasRaw.map((record) => {
    validateJsonObject(record, 'Una historia del respaldo');
    return {
      pacienteId: positiveId(record.pacienteId, 'pacienteId de historia'),
      data: cleanData(record, ['id', 'pacienteId'])
    };
  });
  const consultas = consultasRaw.map((record) => {
    validateJsonObject(record, 'Una consulta del respaldo');
    return {
      id: positiveId(record.id, 'ID de consulta'),
      pacienteId: positiveId(record.pacienteId, 'pacienteId de consulta'),
      data: cleanData(record, ['id', 'pacienteId'])
    };
  });
  const odontogramas = odontogramasRaw.map((record) => {
    validateJsonObject(record, 'Un odontograma del respaldo');
    return {
      pacienteId: positiveId(record.pacienteId, 'pacienteId de odontograma'),
      data: cleanData(record, ['id', 'pacienteId'])
    };
  });

  const ensureUnique = (items, getKey, label) => {
    const keys = new Set();
    for (const item of items) {
      const key = getKey(item);
      if (keys.has(key)) throw new HttpError(400, `${label} contiene IDs duplicados.`);
      keys.add(key);
    }
    return keys;
  };
  const patientIds = ensureUnique(pacientes, (item) => item.id, 'pacientes');
  ensureUnique(historias, (item) => item.pacienteId, 'historias');
  ensureUnique(consultas, (item) => item.id, 'consultas');
  ensureUnique(odontogramas, (item) => item.pacienteId, 'odontogramas');

  for (const item of [...historias, ...consultas, ...odontogramas]) {
    if (!patientIds.has(item.pacienteId)) {
      throw new HttpError(400, 'El respaldo contiene una referencia a un paciente inexistente.');
    }
  }

  let config = null;
  const rawConfig = body.config ?? body.configuracion;
  if (rawConfig !== undefined && rawConfig !== null) {
    validateJsonObject(rawConfig, 'La configuracion del respaldo');
    config = { ...cleanData(rawConfig, ['id']), id: DEFAULT_CONFIG.id };
  }

  return { pacientes, historias, consultas, odontogramas, config };
}

function importBackup(db, backup, actorId) {
  return runTransaction(db, () => {
    db.exec(`
      DELETE FROM odontogramas;
      DELETE FROM consultas;
      DELETE FROM historias;
      DELETE FROM pacientes;
      DELETE FROM sqlite_sequence WHERE name IN ('pacientes', 'consultas');
    `);

    const insertPatient = db.prepare('INSERT INTO pacientes (id, data) VALUES (?, ?)');
    const insertHistory = db.prepare('INSERT INTO historias (paciente_id, data) VALUES (?, ?)');
    const insertConsultation = db.prepare('INSERT INTO consultas (id, paciente_id, data) VALUES (?, ?, ?)');
    const insertOdontogram = db.prepare('INSERT INTO odontogramas (paciente_id, data) VALUES (?, ?)');

    for (const item of backup.pacientes) insertPatient.run(item.id, JSON.stringify(item.data));
    for (const item of backup.historias) insertHistory.run(item.pacienteId, JSON.stringify(item.data));
    for (const item of backup.consultas) {
      insertConsultation.run(item.id, item.pacienteId, JSON.stringify(item.data));
    }
    for (const item of backup.odontogramas) insertOdontogram.run(item.pacienteId, JSON.stringify(item.data));
    if (backup.config) {
      db.prepare('INSERT OR REPLACE INTO configuracion (id, data) VALUES (?, ?)')
        .run(DEFAULT_CONFIG.id, JSON.stringify(backup.config));
    }
    writeAudit(db, actorId, 'backup_import', 'backup', null, {
      pacientes: backup.pacientes.length,
      historias: backup.historias.length,
      consultas: backup.consultas.length,
      odontogramas: backup.odontogramas.length
    });
  });
}

function isKnownProtectedPath(pathname) {
  return pathname === '/api/auth/me' ||
    pathname === '/api/auth/logout' ||
    pathname === '/api/auth/change-password' ||
    pathname === '/api/users' ||
    /^\/api\/users\/\d+(?:\/reset-password)?$/.test(pathname) ||
    pathname === '/api/pacientes' ||
    /^\/api\/pacientes\/\d+(?:\/(?:historia|consultas|odontograma))?$/.test(pathname) ||
    /^\/api\/consultas\/\d+$/.test(pathname) ||
    pathname === '/api/config' ||
    pathname === '/api/backup' ||
    pathname === '/api/backup/import';
}

async function handleApi(req, res, pathname, context) {
  const { db, bodyLimit, sessionMaxAge, cookieSecure } = context;
  const method = req.method;

  if (pathname === '/api/setup-status' && method === 'GET') {
    const row = db.prepare('SELECT COUNT(*) AS count FROM users').get();
    return sendJson(res, 200, { needsSetup: Number(row.count) === 0 });
  }

  if (pathname === '/api/setup' && method === 'POST') {
    const count = Number(db.prepare('SELECT COUNT(*) AS count FROM users').get().count);
    if (count !== 0) throw new HttpError(409, 'La configuracion inicial ya fue completada.');

    const body = requireObject(await readJsonBody(req, bodyLimit));
    const username = normalizeUsername(body.username);
    const displayName = validateDisplayName(body.displayName);
    const password = validatePassword(body.password);
    const passwordRecord = await createPasswordRecord(password);
    const sessionToken = randomBytes(32).toString('base64url');
    const sessionTokenHash = hashToken(sessionToken);
    const createdAt = nowIso();

    const userId = runTransaction(db, () => {
      const currentCount = Number(db.prepare('SELECT COUNT(*) AS count FROM users').get().count);
      if (currentCount !== 0) throw new HttpError(409, 'La configuracion inicial ya fue completada.');
      const result = db.prepare(`
        INSERT INTO users (
          username, display_name, role, password_hash, password_salt,
          active, must_change_password, created_at, updated_at
        ) VALUES (?, ?, 'admin', ?, ?, 1, 0, ?, ?)
      `).run(username, displayName, passwordRecord.hash, passwordRecord.salt, createdAt, createdAt);
      const id = Number(result.lastInsertRowid);
      db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)')
        .run(sessionTokenHash, id, Date.now() + sessionMaxAge * 1000, createdAt);
      writeAudit(db, id, 'setup', 'user', id, { username });
      return id;
    });

    setSessionCookie(res, sessionToken, sessionMaxAge, cookieSecure);
    return sendJson(res, 201, { user: publicUser(getUserRow(db, userId)) });
  }

  if (pathname === '/api/auth/login' && method === 'POST') {
    const body = requireObject(await readJsonBody(req, bodyLimit));
    const rawUsername = typeof body.username === 'string' ? body.username.trim().toLowerCase() : '';
    const usernameValid = USERNAME_PATTERN.test(rawUsername);
    const passwordValid = typeof body.password === 'string' && body.password.length > 0 && body.password.length <= 1024;
    const row = usernameValid ? db.prepare('SELECT * FROM users WHERE username = ?').get(rawUsername) : null;
    const salt = row ? row.password_salt : DUMMY_SALT;
    const expectedHash = row ? row.password_hash : DUMMY_HASH;
    const candidate = passwordValid ? body.password : 'credencial-inexistente';
    const matches = await passwordMatches(candidate, salt, expectedHash);

    if (!row || !row.active || !passwordValid || !matches) {
      writeAudit(db, row ? Number(row.id) : null, 'login_failed', 'auth', null, {
        username: rawUsername.slice(0, 32)
      });
      throw new HttpError(401, 'Credenciales invalidas.');
    }

    const session = runTransaction(db, () => {
      const created = createSessionRecord(db, Number(row.id), sessionMaxAge);
      writeAudit(db, Number(row.id), 'login_success', 'auth');
      return created;
    });
    setSessionCookie(res, session.token, sessionMaxAge, cookieSecure);
    return sendJson(res, 200, { user: publicUser(row) });
  }

  if (pathname === '/api/setup' || pathname === '/api/setup-status' || pathname === '/api/auth/login') {
    throw new HttpError(404, 'Endpoint no encontrado.');
  }
  if (!isKnownProtectedPath(pathname)) {
    throw new HttpError(404, 'Endpoint no encontrado.');
  }

  const auth = authenticate(req, db);
  if (!auth) throw new HttpError(401, 'Debes iniciar sesion.');

  if (pathname === '/api/auth/me' && method === 'GET') {
    return sendJson(res, 200, { user: auth.user });
  }

  if (pathname === '/api/auth/logout' && method === 'POST') {
    runTransaction(db, () => {
      db.prepare('UPDATE sessions SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL')
        .run(nowIso(), auth.tokenHash);
      writeAudit(db, auth.user.id, 'logout', 'auth');
    });
    clearSessionCookie(res, cookieSecure);
    return sendJson(res, 200, { success: true });
  }

  if (pathname === '/api/auth/change-password' && method === 'POST') {
    const body = requireObject(await readJsonBody(req, bodyLimit));
    if (typeof body.currentPassword !== 'string') {
      throw new HttpError(400, 'La contrasena actual es obligatoria.');
    }
    const newPassword = validatePassword(body.newPassword);
    const currentMatches = await passwordMatches(
      body.currentPassword,
      auth.row.password_salt,
      auth.row.password_hash
    );
    if (!currentMatches) throw new HttpError(401, 'La contrasena actual es incorrecta.');

    const passwordRecord = await createPasswordRecord(newPassword);
    runTransaction(db, () => {
      db.prepare(`
        UPDATE users
        SET password_hash = ?, password_salt = ?, must_change_password = 0, updated_at = ?
        WHERE id = ?
      `).run(passwordRecord.hash, passwordRecord.salt, nowIso(), auth.user.id);
      db.prepare('UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND token_hash <> ? AND revoked_at IS NULL')
        .run(nowIso(), auth.user.id, auth.tokenHash);
      writeAudit(db, auth.user.id, 'password_change', 'user', auth.user.id);
    });
    return sendJson(res, 200, { user: publicUser(getUserRow(db, auth.user.id)) });
  }

  if (auth.user.mustChangePassword) {
    throw new HttpError(403, 'Debes cambiar la contrasena temporal antes de usar el sistema.');
  }

  if (pathname === '/api/users' && method === 'GET') {
    requireAdmin(auth);
    const users = db.prepare('SELECT * FROM users ORDER BY id').all().map(publicUser);
    return sendJson(res, 200, users);
  }

  if (pathname === '/api/users' && method === 'POST') {
    requireAdmin(auth);
    const body = requireObject(await readJsonBody(req, bodyLimit));
    const username = normalizeUsername(body.username);
    const displayName = validateDisplayName(body.displayName);
    const role = validateRole(body.role);
    const password = validatePassword(body.password);
    if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(username)) {
      throw new HttpError(409, 'El username ya esta en uso.');
    }
    const passwordRecord = await createPasswordRecord(password);
    const createdAt = nowIso();
    let userId;
    try {
      userId = runTransaction(db, () => {
        const result = db.prepare(`
          INSERT INTO users (
            username, display_name, role, password_hash, password_salt,
            active, must_change_password, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, 1, 1, ?, ?)
        `).run(username, displayName, role, passwordRecord.hash, passwordRecord.salt, createdAt, createdAt);
        const id = Number(result.lastInsertRowid);
        writeAudit(db, auth.user.id, 'user_create', 'user', id, { username, role });
        return id;
      });
    } catch (error) {
      if (String(error.message).includes('UNIQUE constraint failed')) {
        throw new HttpError(409, 'El username ya esta en uso.');
      }
      throw error;
    }
    return sendJson(res, 201, publicUser(getUserRow(db, userId)));
  }

  const userResetMatch = pathname.match(/^\/api\/users\/(\d+)\/reset-password$/);
  if (userResetMatch && method === 'POST') {
    requireAdmin(auth);
    const userId = positiveId(userResetMatch[1], 'ID de usuario');
    if (!getUserRow(db, userId)) throw new HttpError(404, 'Usuario no encontrado.');
    const body = requireObject(await readJsonBody(req, bodyLimit));
    const password = validatePassword(body.password);
    const passwordRecord = await createPasswordRecord(password);
    runTransaction(db, () => {
      if (!getUserRow(db, userId)) throw new HttpError(404, 'Usuario no encontrado.');
      db.prepare(`
        UPDATE users
        SET password_hash = ?, password_salt = ?, must_change_password = 1, updated_at = ?
        WHERE id = ?
      `).run(passwordRecord.hash, passwordRecord.salt, nowIso(), userId);
      db.prepare('UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL')
        .run(nowIso(), userId);
      writeAudit(db, auth.user.id, 'password_reset', 'user', userId);
    });
    if (userId === auth.user.id) clearSessionCookie(res, cookieSecure);
    return sendJson(res, 200, publicUser(getUserRow(db, userId)));
  }

  const userMatch = pathname.match(/^\/api\/users\/(\d+)$/);
  if (userMatch && method === 'PUT') {
    requireAdmin(auth);
    const userId = positiveId(userMatch[1], 'ID de usuario');
    const current = getUserRow(db, userId);
    if (!current) throw new HttpError(404, 'Usuario no encontrado.');
    const body = requireObject(await readJsonBody(req, bodyLimit));
    const allowedFields = ['username', 'displayName', 'role', 'active'];
    if (!allowedFields.some((field) => Object.hasOwn(body, field))) {
      throw new HttpError(400, 'Debes indicar al menos un campo para actualizar.');
    }
    for (const field of Object.keys(body)) {
      if (!allowedFields.includes(field)) throw new HttpError(400, `El campo ${field} no se puede modificar.`);
    }

    const username = Object.hasOwn(body, 'username') ? normalizeUsername(body.username) : current.username;
    const displayName = Object.hasOwn(body, 'displayName')
      ? validateDisplayName(body.displayName)
      : current.display_name;
    const role = Object.hasOwn(body, 'role') ? validateRole(body.role) : current.role;
    if (Object.hasOwn(body, 'active') && typeof body.active !== 'boolean') {
      throw new HttpError(400, 'active debe ser true o false.');
    }
    const active = Object.hasOwn(body, 'active') ? body.active : Boolean(current.active);

    if (userId === auth.user.id && !active) {
      throw new HttpError(409, 'No puedes desactivar tu propio usuario.');
    }
    if (userId === auth.user.id && role !== 'admin') {
      throw new HttpError(409, 'No puedes quitarte el rol admin.');
    }
    const removesActiveAdmin = Boolean(current.active) && current.role === 'admin' && (!active || role !== 'admin');
    if (removesActiveAdmin) {
      const remaining = Number(db.prepare(`
        SELECT COUNT(*) AS count FROM users WHERE role = 'admin' AND active = 1 AND id <> ?
      `).get(userId).count);
      if (remaining === 0) throw new HttpError(409, 'Debe existir al menos un administrador activo.');
    }

    try {
      runTransaction(db, () => {
        db.prepare(`
          UPDATE users SET username = ?, display_name = ?, role = ?, active = ?, updated_at = ?
          WHERE id = ?
        `).run(username, displayName, role, active ? 1 : 0, nowIso(), userId);
        if (!active) {
          db.prepare('UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL')
            .run(nowIso(), userId);
        }
        writeAudit(db, auth.user.id, 'user_update', 'user', userId, { username, role, active });
      });
    } catch (error) {
      if (String(error.message).includes('UNIQUE constraint failed')) {
        throw new HttpError(409, 'El username ya esta en uso.');
      }
      throw error;
    }
    return sendJson(res, 200, publicUser(getUserRow(db, userId)));
  }

  if (userMatch && method === 'DELETE') {
    requireAdmin(auth);
    const userId = positiveId(userMatch[1], 'ID de usuario');
    const target = getUserRow(db, userId);
    if (!target) throw new HttpError(404, 'Usuario no encontrado.');
    if (userId === auth.user.id) throw new HttpError(409, 'No puedes eliminar tu propio usuario.');
    if (target.active && target.role === 'admin') {
      const remaining = Number(db.prepare(`
        SELECT COUNT(*) AS count FROM users WHERE role = 'admin' AND active = 1 AND id <> ?
      `).get(userId).count);
      if (remaining === 0) throw new HttpError(409, 'Debe existir al menos un administrador activo.');
    }
    runTransaction(db, () => {
      db.prepare('UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL')
        .run(nowIso(), userId);
      writeAudit(db, auth.user.id, 'user_delete', 'user', userId, {
        username: target.username,
        role: target.role
      });
      db.prepare('DELETE FROM users WHERE id = ?').run(userId);
    });
    return sendJson(res, 200, { success: true });
  }

  if (pathname === '/api/pacientes' && method === 'GET') {
    const patients = db.prepare('SELECT id, data FROM pacientes ORDER BY id').all().map(patientFromRow);
    return sendJson(res, 200, patients);
  }

  if (pathname === '/api/pacientes' && method === 'POST') {
    requireRole(auth, CLINICAL_WRITERS);
    const data = validatePatientInput(requireObject(await readJsonBody(req, bodyLimit)));
    const timestamp = nowIso();
    data.fechaRegistro = data.fechaRegistro || timestamp;
    data.fechaActualizacion = timestamp;
    const patientId = runTransaction(db, () => {
      const result = db.prepare('INSERT INTO pacientes (data) VALUES (?)').run(JSON.stringify(data));
      const id = Number(result.lastInsertRowid);
      writeAudit(db, auth.user.id, 'patient_create', 'paciente', id);
      return id;
    });
    return sendJson(res, 201, { ...data, id: patientId });
  }

  const patientResourceMatch = pathname.match(/^\/api\/pacientes\/(\d+)$/);
  if (patientResourceMatch && method === 'GET') {
    const patientId = positiveId(patientResourceMatch[1], 'ID de paciente');
    const row = db.prepare('SELECT id, data FROM pacientes WHERE id = ?').get(patientId);
    if (!row) throw new HttpError(404, 'Paciente no encontrado.');
    return sendJson(res, 200, patientFromRow(row));
  }

  if (patientResourceMatch && method === 'PUT') {
    requireRole(auth, CLINICAL_WRITERS);
    const patientId = positiveId(patientResourceMatch[1], 'ID de paciente');
    const row = db.prepare('SELECT id, data FROM pacientes WHERE id = ?').get(patientId);
    if (!row) throw new HttpError(404, 'Paciente no encontrado.');
    const incoming = validatePatientInput(requireObject(await readJsonBody(req, bodyLimit)));
    const data = { ...parseData(row.data), ...incoming, fechaActualizacion: nowIso() };
    runTransaction(db, () => {
      db.prepare('UPDATE pacientes SET data = ? WHERE id = ?').run(JSON.stringify(data), patientId);
      writeAudit(db, auth.user.id, 'patient_update', 'paciente', patientId);
    });
    return sendJson(res, 200, { ...data, id: patientId });
  }

  if (patientResourceMatch && method === 'DELETE') {
    requireRole(auth, CLINICAL_WRITERS);
    const patientId = positiveId(patientResourceMatch[1], 'ID de paciente');
    if (!patientExists(db, patientId)) throw new HttpError(404, 'Paciente no encontrado.');
    runTransaction(db, () => {
      db.prepare('DELETE FROM pacientes WHERE id = ?').run(patientId);
      writeAudit(db, auth.user.id, 'patient_delete', 'paciente', patientId);
    });
    return sendJson(res, 200, { success: true });
  }

  const historyMatch = pathname.match(/^\/api\/pacientes\/(\d+)\/historia$/);
  if (historyMatch && method === 'GET') {
    const patientId = positiveId(historyMatch[1], 'ID de paciente');
    ensurePatient(db, patientId);
    const row = db.prepare('SELECT paciente_id, data FROM historias WHERE paciente_id = ?').get(patientId);
    return sendJson(res, 200, row ? historyFromRow(row) : null);
  }

  if (historyMatch && method === 'PUT') {
    requireRole(auth, CLINICAL_WRITERS);
    const patientId = positiveId(historyMatch[1], 'ID de paciente');
    ensurePatient(db, patientId);
    const incoming = validateHistoryInput(requireObject(await readJsonBody(req, bodyLimit)));
    const current = db.prepare('SELECT data FROM historias WHERE paciente_id = ?').get(patientId);
    const data = { ...(current ? parseData(current.data) : {}), ...incoming, fechaActualizacion: nowIso() };
    runTransaction(db, () => {
      db.prepare(`
        INSERT INTO historias (paciente_id, data) VALUES (?, ?)
        ON CONFLICT(paciente_id) DO UPDATE SET data = excluded.data
      `).run(patientId, JSON.stringify(data));
      writeAudit(db, auth.user.id, 'history_update', 'historia', patientId);
    });
    return sendJson(res, 200, { ...data, pacienteId: patientId });
  }

  const patientConsultationsMatch = pathname.match(/^\/api\/pacientes\/(\d+)\/consultas$/);
  if (patientConsultationsMatch && method === 'GET') {
    const patientId = positiveId(patientConsultationsMatch[1], 'ID de paciente');
    ensurePatient(db, patientId);
    const consultations = db.prepare(`
      SELECT id, paciente_id, data FROM consultas WHERE paciente_id = ?
      ORDER BY COALESCE(json_extract(data, '$.fecha'), '') DESC, id DESC
    `).all(patientId).map(consultationFromRow);
    return sendJson(res, 200, consultations);
  }

  if (patientConsultationsMatch && method === 'POST') {
    requireRole(auth, CLINICAL_WRITERS);
    const patientId = positiveId(patientConsultationsMatch[1], 'ID de paciente');
    ensurePatient(db, patientId);
    const data = validateConsultationInput(requireObject(await readJsonBody(req, bodyLimit)));
    data.fecha = data.fecha || nowIso().slice(0, 10);
    const consultationId = runTransaction(db, () => {
      const result = db.prepare('INSERT INTO consultas (paciente_id, data) VALUES (?, ?)')
        .run(patientId, JSON.stringify(data));
      const id = Number(result.lastInsertRowid);
      writeAudit(db, auth.user.id, 'consultation_create', 'consulta', id, { pacienteId: patientId });
      return id;
    });
    return sendJson(res, 201, { ...data, id: consultationId, pacienteId: patientId });
  }

  const consultationMatch = pathname.match(/^\/api\/consultas\/(\d+)$/);
  if (consultationMatch && method === 'PUT') {
    requireRole(auth, CLINICAL_WRITERS);
    const consultationId = positiveId(consultationMatch[1], 'ID de consulta');
    const row = db.prepare('SELECT id, paciente_id, data FROM consultas WHERE id = ?').get(consultationId);
    if (!row) throw new HttpError(404, 'Consulta no encontrada.');
    const incoming = validateConsultationInput(requireObject(await readJsonBody(req, bodyLimit)));
    const data = { ...parseData(row.data), ...incoming };
    data.fecha = data.fecha || nowIso().slice(0, 10);
    runTransaction(db, () => {
      db.prepare('UPDATE consultas SET data = ? WHERE id = ?').run(JSON.stringify(data), consultationId);
      writeAudit(db, auth.user.id, 'consultation_update', 'consulta', consultationId);
    });
    return sendJson(res, 200, {
      ...data,
      id: consultationId,
      pacienteId: Number(row.paciente_id)
    });
  }

  if (consultationMatch && method === 'DELETE') {
    requireRole(auth, CLINICAL_WRITERS);
    const consultationId = positiveId(consultationMatch[1], 'ID de consulta');
    const row = db.prepare('SELECT paciente_id FROM consultas WHERE id = ?').get(consultationId);
    if (!row) throw new HttpError(404, 'Consulta no encontrada.');
    runTransaction(db, () => {
      db.prepare('DELETE FROM consultas WHERE id = ?').run(consultationId);
      writeAudit(db, auth.user.id, 'consultation_delete', 'consulta', consultationId, {
        pacienteId: Number(row.paciente_id)
      });
    });
    return sendJson(res, 200, { success: true });
  }

  const odontogramMatch = pathname.match(/^\/api\/pacientes\/(\d+)\/odontograma$/);
  if (odontogramMatch && method === 'GET') {
    const patientId = positiveId(odontogramMatch[1], 'ID de paciente');
    ensurePatient(db, patientId);
    const row = db.prepare('SELECT paciente_id, data FROM odontogramas WHERE paciente_id = ?').get(patientId);
    return sendJson(res, 200, row ? odontogramFromRow(row) : null);
  }

  if (odontogramMatch && method === 'PUT') {
    requireRole(auth, CLINICAL_WRITERS);
    const patientId = positiveId(odontogramMatch[1], 'ID de paciente');
    ensurePatient(db, patientId);
    const incoming = validateOdontogramInput(requireObject(await readJsonBody(req, bodyLimit)));
    const current = db.prepare('SELECT data FROM odontogramas WHERE paciente_id = ?').get(patientId);
    const data = {
      ...(current ? parseData(current.data) : { piezas: {}, notasGenerales: '' }),
      ...incoming,
      fechaActualizacion: nowIso()
    };
    runTransaction(db, () => {
      db.prepare(`
        INSERT INTO odontogramas (paciente_id, data) VALUES (?, ?)
        ON CONFLICT(paciente_id) DO UPDATE SET data = excluded.data
      `).run(patientId, JSON.stringify(data));
      writeAudit(db, auth.user.id, 'odontogram_update', 'odontograma', patientId);
    });
    return sendJson(res, 200, { ...data, pacienteId: patientId });
  }

  if (pathname === '/api/config' && method === 'GET') {
    return sendJson(res, 200, getConfig(db));
  }

  if (pathname === '/api/config' && method === 'PUT') {
    requireAdmin(auth);
    const incoming = validateConfigInput(requireObject(await readJsonBody(req, bodyLimit)));
    const data = { ...getConfig(db), ...incoming, id: DEFAULT_CONFIG.id };
    runTransaction(db, () => {
      db.prepare('INSERT OR REPLACE INTO configuracion (id, data) VALUES (?, ?)')
        .run(DEFAULT_CONFIG.id, JSON.stringify(data));
      writeAudit(db, auth.user.id, 'config_update', 'configuracion', DEFAULT_CONFIG.id);
    });
    return sendJson(res, 200, data);
  }

  if (pathname === '/api/backup' && method === 'GET') {
    requireAdmin(auth);
    const backup = getBackup(db);
    writeAudit(db, auth.user.id, 'backup_export', 'backup');
    return sendJson(res, 200, backup);
  }

  if (pathname === '/api/backup/import' && method === 'POST') {
    requireAdmin(auth);
    const body = await readJsonBody(req, bodyLimit);
    const backup = normalizeBackup(body);
    importBackup(db, backup, auth.user.id);
    return sendJson(res, 200, {
      success: true,
      imported: {
        pacientes: backup.pacientes.length,
        historias: backup.historias.length,
        consultas: backup.consultas.length,
        odontogramas: backup.odontogramas.length
      }
    });
  }

  throw new HttpError(404, 'Endpoint no encontrado.');
}

function allowedStaticPath(pathname) {
  if (pathname === '/' || pathname === '/index.html' || pathname === '/logo.jpg') return true;
  return pathname.startsWith('/css/') || pathname.startsWith('/js/') || pathname.startsWith('/img/');
}

async function serveStatic(req, res, pathname, staticRoot) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    throw new HttpError(404, 'Recurso no encontrado.');
  }

  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    throw new HttpError(400, 'Ruta invalida.');
  }
  if (decoded.includes('\0') || decoded.includes('\\')) {
    throw new HttpError(400, 'Ruta invalida.');
  }
  const segments = decoded.split('/');
  if (segments.some((segment) => segment === '..' || segment === '.')) {
    throw new HttpError(404, 'Recurso no encontrado.');
  }
  if (!allowedStaticPath(decoded)) {
    throw new HttpError(404, 'Recurso no encontrado.');
  }

  const requestedPath = decoded === '/' ? '/index.html' : decoded;
  const filename = path.resolve(staticRoot, `.${requestedPath}`);
  const rootPrefix = staticRoot.endsWith(path.sep) ? staticRoot : `${staticRoot}${path.sep}`;
  if (!filename.startsWith(rootPrefix)) throw new HttpError(404, 'Recurso no encontrado.');

  let stat;
  let realFilename;
  try {
    stat = await fs.promises.stat(filename);
    realFilename = await fs.promises.realpath(filename);
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') {
      throw new HttpError(404, 'Recurso no encontrado.');
    }
    throw error;
  }
  if (!stat.isFile() || !realFilename.startsWith(rootPrefix)) {
    throw new HttpError(404, 'Recurso no encontrado.');
  }

  const contentType = MIME_TYPES.get(path.extname(realFilename).toLowerCase());
  if (!contentType) throw new HttpError(404, 'Recurso no encontrado.');
  res.statusCode = 200;
  res.setHeader('Content-Type', contentType);
  res.setHeader('Content-Length', stat.size);
  if (req.method === 'HEAD') return res.end();

  await new Promise((resolve, reject) => {
    const stream = fs.createReadStream(realFilename);
    stream.on('error', reject);
    res.on('finish', resolve);
    res.on('close', resolve);
    stream.pipe(res);
  });
}

function createServer(options = {}) {
  const dbPath = options.dbPath || process.env.DB_PATH || path.join(ROOT_DIR, 'data', 'odontologia.sqlite');
  const staticRoot = fs.realpathSync(options.staticRoot || ROOT_DIR);
  const bodyLimit = options.bodyLimit ?? DEFAULT_BODY_LIMIT;
  const sessionMaxAge = options.sessionMaxAge ?? DEFAULT_SESSION_MAX_AGE;
  const cookieSecure = options.cookieSecure ?? process.env.COOKIE_SECURE === 'true';
  const logger = options.logger || console;

  if (dbPath !== ':memory:') fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = openDatabase(dbPath);
  const context = { db, bodyLimit, sessionMaxAge, cookieSecure };

  const server = http.createServer((req, res) => {
    let pathname;
    try {
      pathname = new URL(req.url, 'http://localhost').pathname;
    } catch {
      applySecurityHeaders(res, false);
      return sendError(res, 400, 'Ruta invalida.');
    }

    const isApi = pathname === '/api' || pathname.startsWith('/api/');
    applySecurityHeaders(res, isApi);
    const operation = isApi
      ? handleApi(req, res, pathname, context)
      : serveStatic(req, res, pathname, staticRoot);
    Promise.resolve(operation).catch((error) => {
      if (res.writableEnded) return;
      if (error instanceof HttpError) {
        return sendError(res, error.status, error.message);
      }
      logger.error('Error interno del servidor:', error);
      sendError(res, 500, 'Error interno del servidor.');
    });
  });

  let databaseClosed = false;
  server.once('close', () => {
    if (!databaseClosed) {
      databaseClosed = true;
      db.close();
    }
  });
  server.database = db;
  return server;
}

function start(options = {}) {
  const server = createServer(options);
  const port = options.port ?? Number(process.env.PORT || 3000);
  const host = options.host || process.env.HOST || '127.0.0.1';
  server.listen(port, host, () => {
    const address = server.address();
    console.log(`Sistema odontologico disponible en http://${host}:${address.port}`);
  });
  return server;
}

if (require.main === module) start();

module.exports = { createServer, start };
