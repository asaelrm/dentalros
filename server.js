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

const permissions = require('./js/permissions');
const billing = require('./js/billing');
const { createInvitationMailer } = require('./server/mail');

const scryptAsync = promisify(scrypt);
const ROOT_DIR = __dirname;
const COOKIE_NAME = 'odontologia_session';
const DEFAULT_BODY_LIMIT = 5 * 1024 * 1024;
const ATTACHMENT_LIMIT = 10 * 1024 * 1024;
const DEFAULT_SESSION_MAX_AGE = 8 * 60 * 60;
const USERNAME_PATTERN = /^[a-z0-9][a-z0-9._-]{2,31}$/;
const ROLES = new Set(Object.keys(permissions.labels));
const CLINICAL_WRITERS = new Set(['admin', 'editor', 'doctor']);
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
  if (typeof value !== 'string' || value.length < 6 || value.length > 1024) {
    throw new HttpError(400, 'La contrasena debe tener entre 6 y 1024 caracteres.');
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

async function readBinaryBody(req, limit) {
  const declaredLength = Number(req.headers['content-length']);
  if (Number.isFinite(declaredLength) && declaredLength > limit) {
    req.resume();
    throw new HttpError(413, 'El archivo excede el límite de 10 MB.');
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new HttpError(413, 'El archivo excede el límite de 10 MB.');
    chunks.push(chunk);
  }
  if (!size) throw new HttpError(400, 'Selecciona un archivo para adjuntar.');
  return Buffer.concat(chunks);
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
    role: row.professional_role || row.role,
    email: row.email || '',
    invoiceAccess: Boolean(row.invoice_access),
    invitationPending: Boolean(row.invitation_pending),
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
      AND u.active = 1 AND u.invitation_pending = 0
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
  return {
    ...parseData(row.data), id: Number(row.id),
    insuranceId: row.insurance_id == null ? null : Number(row.insurance_id),
    insuranceName: row.insurance_name || '',
    affiliateNumber: row.numero_afiliado || '',
    policyNumber: row.numero_poliza || '',
    authorizationNumber: row.numero_autorizacion || ''
  };
}

const PATIENT_SELECT = `SELECT p.id, p.data, p.insurance_id, p.numero_afiliado, p.numero_poliza,
  p.numero_autorizacion, i.nombre AS insurance_name FROM pacientes p LEFT JOIN insurers i ON i.id = p.insurance_id`;

function historyFromRow(row) {
  return { ...parseData(row.data), pacienteId: Number(row.paciente_id) };
}

function consultationFromRow(row) {
  return { ...parseData(row.data), id: Number(row.id), pacienteId: Number(row.paciente_id) };
}

function consultationForUser(consultation, user) {
  if (permissions.has(user.role, 'invoice.write', user.invoiceAccess)) return consultation;
  const { factura, costo, procedimientos, ...clinicalData } = consultation;
  return clinicalData;
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
  const data = cleanData(body, ['id', 'pacienteId', 'insuranceId', 'affiliateNumber', 'policyNumber', 'authorizationNumber']);
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

function patientInsuranceInput(db, body) {
  const insuranceId = body.insuranceId == null || body.insuranceId === '' ? null : positiveId(body.insuranceId, 'Seguro/ARS');
  const insurer = insuranceId ? db.prepare('SELECT * FROM insurers WHERE id = ? AND activo = 1').get(insuranceId) : null;
  if (insuranceId && !insurer) throw new HttpError(400, 'El seguro/ARS seleccionado no existe o está inactivo.');
  const affiliateNumber = String(body.affiliateNumber || '').trim();
  const policyNumber = String(body.policyNumber || '').trim();
  const authorizationNumber = String(body.authorizationNumber || '').trim();
  if (affiliateNumber.length > 100 || policyNumber.length > 100 || authorizationNumber.length > 100) throw new HttpError(400, 'Los números de seguro admiten hasta 100 caracteres.');
  if (insurer && insurer.codigo !== 'PRIVADO' && !affiliateNumber) throw new HttpError(400, 'El número de afiliado/carnet es obligatorio para este seguro.');
  return { insuranceId, affiliateNumber, policyNumber, authorizationNumber };
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
    version: '3.0',
    fechaExportacion: nowIso(),
    sistema: 'DentalRos - Sistema Odontológico Inteligente',
    pacientes: db.prepare(`${PATIENT_SELECT} ORDER BY p.id`).all().map(patientFromRow),
    historias: db.prepare('SELECT paciente_id, data FROM historias ORDER BY paciente_id').all().map(historyFromRow),
    consultas: db.prepare('SELECT id, paciente_id, data FROM consultas ORDER BY id').all().map(consultationFromRow),
    odontogramas: db.prepare('SELECT paciente_id, data FROM odontogramas ORDER BY paciente_id').all().map(odontogramFromRow),
    config: getConfig(db),
    catalogo: getCatalog(db),
    insurers: db.prepare('SELECT id, nombre, codigo, activo FROM insurers ORDER BY id').all().map(item => ({ ...item, id: Number(item.id), activo: Boolean(item.activo) })),
    cashPayments: db.prepare('SELECT * FROM cash_payments ORDER BY id').all().map(row => ({ id: Number(row.id), consultationId: Number(row.consultation_id), patientId: Number(row.patient_id), amountCentavos: Number(row.amount_centavos), coveragePercent: Number(row.coverage_percent || 0), insuranceCoveredCentavos: Number(row.insurance_covered_centavos || 0), patientPaidCentavos: Number(row.patient_paid_centavos ?? row.amount_centavos), amountReceivedCentavos: Number(row.amount_received_centavos ?? row.patient_paid_centavos), changeCentavos: Number(row.change_centavos || 0), paymentMethod: row.payment_method, reference: row.reference || '', receivedByName: row.received_by_name, paidAt: row.paid_at }))
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
    return { id: positiveId(record.id, 'ID de paciente'), insuranceId: record.insuranceId == null ? null : positiveId(record.insuranceId, 'Seguro de paciente'), affiliateNumber: String(record.affiliateNumber || ''), policyNumber: String(record.policyNumber || ''), authorizationNumber: String(record.authorizationNumber || ''), data: cleanData(record, ['id', 'pacienteId', 'insuranceId', 'insuranceName', 'affiliateNumber', 'policyNumber', 'authorizationNumber']) };
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

  let catalogo = null;
  if (body.catalogo !== undefined) {
    if (!Array.isArray(body.catalogo) || body.catalogo.length > 10000) throw new HttpError(400, 'Catálogo inválido en el respaldo.');
    catalogo = body.catalogo.map(item => ({ id: positiveId(item.id, 'ID de catálogo'), ...billing.catalogItem({ ...item, precio: item.precioCentavos / 100 }) }));
    ensureUnique(catalogo, item => item.id, 'catalogo');
  }
  let insurers = null;
  if (body.insurers !== undefined) {
    if (!Array.isArray(body.insurers) || body.insurers.length > 10000) throw new HttpError(400, 'Catálogo de seguros inválido.');
    insurers = body.insurers.map(item => ({ id: positiveId(item.id, 'ID de seguro'), nombre: String(item.nombre || '').trim(), codigo: String(item.codigo || '').trim(), activo: item.activo !== false }));
    ensureUnique(insurers, item => item.id, 'seguros');
    if (insurers.some(item => !item.nombre || !item.codigo)) throw new HttpError(400, 'El respaldo contiene un seguro inválido.');
    const insurerIds = new Set(insurers.map(item => item.id));
    if (pacientes.some(item => item.insuranceId && !insurerIds.has(item.insuranceId))) throw new HttpError(400, 'Un paciente referencia un seguro inexistente.');
  }
  let cashPayments = [];
  if (body.cashPayments !== undefined) {
    if (!Array.isArray(body.cashPayments) || body.cashPayments.length > 100000) throw new HttpError(400, 'Movimientos de caja inválidos.');
    const consultationIds = new Set(consultas.map(item => item.id));
    cashPayments = body.cashPayments.map(item => ({ id: positiveId(item.id, 'ID de cobro'), consultationId: positiveId(item.consultationId, 'Consulta del cobro'), patientId: positiveId(item.patientId, 'Paciente del cobro'), amountCentavos: Number(item.amountCentavos), coveragePercent: Number(item.coveragePercent || 0), insuranceCoveredCentavos: Number(item.insuranceCoveredCentavos || 0), patientPaidCentavos: Number(item.patientPaidCentavos ?? item.amountCentavos), amountReceivedCentavos: Number(item.amountReceivedCentavos ?? item.patientPaidCentavos ?? item.amountCentavos), changeCentavos: Number(item.changeCentavos || 0), paymentMethod: String(item.paymentMethod), reference: String(item.reference || ''), receivedByName: String(item.receivedByName || ''), paidAt: String(item.paidAt || '') }));
    ensureUnique(cashPayments, item => item.id, 'cobros');
    ensureUnique(cashPayments, item => item.consultationId, 'cobros por factura');
    if (cashPayments.some(item => !consultationIds.has(item.consultationId) || !patientIds.has(item.patientId) || !Number.isSafeInteger(item.amountCentavos) || item.amountCentavos < 0 || !['efectivo','tarjeta','transferencia','seguro','otro'].includes(item.paymentMethod) || !item.receivedByName || !item.paidAt)) throw new HttpError(400, 'El respaldo contiene un cobro inválido.');
  }
  for (const item of consultas) {
    if (item.data.procedimientos !== undefined) {
      billing.validateSnapshot(item.data.procedimientos);
      item.data.costo = billing.total(item.data.procedimientos);
    }
    if (item.data.factura !== undefined) {
      const invoice = requireObject(item.data.factura, 'Una factura del respaldo');
      if (typeof invoice.diagnostico !== 'string' || !invoice.diagnostico.trim() || invoice.diagnostico.length > 1000) throw new HttpError(400, 'Una factura contiene un diagnóstico inválido.');
      if (!['abierta', 'cerrada'].includes(invoice.estado)) throw new HttpError(400, 'Una factura contiene un estado inválido.');
      billing.validateSnapshot(invoice.procedimientos);
      invoice.total = billing.total(invoice.procedimientos);
      if (invoice.estado === 'cerrada' && typeof invoice.cerradaEn !== 'string') throw new HttpError(400, 'Una factura cerrada no tiene fecha de cierre válida.');
    }
  }
  return { pacientes, historias, consultas, odontogramas, config, catalogo, insurers, cashPayments };
}

function importBackup(db, backup, actorId) {
  return runTransaction(db, () => {
    db.exec(`
      DELETE FROM cash_payment_lines;
      DELETE FROM cash_payments;
      DELETE FROM odontogramas;
      DELETE FROM consultas;
      DELETE FROM historias;
      DELETE FROM pacientes;
      DELETE FROM sqlite_sequence WHERE name IN ('pacientes', 'consultas');
    `);

    if (backup.insurers) {
      db.exec('DELETE FROM insurers;');
      const insertInsurer = db.prepare('INSERT INTO insurers (id, nombre, codigo, activo) VALUES (?, ?, ?, ?)');
      for (const item of backup.insurers) insertInsurer.run(item.id, item.nombre, item.codigo, Number(item.activo));
    }
    const insertPatient = db.prepare('INSERT INTO pacientes (id, data, insurance_id, numero_afiliado, numero_poliza, numero_autorizacion) VALUES (?, ?, ?, ?, ?, ?)');
    const insertHistory = db.prepare('INSERT INTO historias (paciente_id, data) VALUES (?, ?)');
    const insertConsultation = db.prepare('INSERT INTO consultas (id, paciente_id, data) VALUES (?, ?, ?)');
    const insertOdontogram = db.prepare('INSERT INTO odontogramas (paciente_id, data) VALUES (?, ?)');

    for (const item of backup.pacientes) insertPatient.run(item.id, JSON.stringify(item.data), item.insuranceId, item.affiliateNumber || null, item.policyNumber || null, item.authorizationNumber || null);
    for (const item of backup.historias) insertHistory.run(item.pacienteId, JSON.stringify(item.data));
    for (const item of backup.consultas) {
      insertConsultation.run(item.id, item.pacienteId, JSON.stringify(item.data));
    }
    for (const item of backup.odontogramas) insertOdontogram.run(item.pacienteId, JSON.stringify(item.data));
    if (backup.config) {
      db.prepare('INSERT OR REPLACE INTO configuracion (id, data) VALUES (?, ?)')
        .run(DEFAULT_CONFIG.id, JSON.stringify(backup.config));
    }
    if (backup.catalogo) {
      db.exec('DELETE FROM catalogo;');
      const insert = db.prepare('INSERT INTO catalogo (id, tipo, nombre, precio_centavos, activo) VALUES (?, ?, ?, ?, ?)');
      for (const item of backup.catalogo) insert.run(item.id, item.tipo, item.nombre, item.precioCentavos, Number(item.activo));
    }
    const insertPayment = db.prepare('INSERT INTO cash_payments (id, consultation_id, patient_id, amount_centavos, coverage_percent, insurance_covered_centavos, patient_paid_centavos, amount_received_centavos, change_centavos, payment_method, reference, received_by_name, paid_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
    const restoreLine = db.prepare('INSERT INTO cash_payment_lines (cash_payment_id, method, amount_centavos, reference_number) VALUES (?, ?, ?, ?)');
    for (const item of backup.cashPayments || []) { insertPayment.run(item.id, item.consultationId, item.patientId, item.amountCentavos, item.coveragePercent, item.insuranceCoveredCentavos, item.patientPaidCentavos, item.amountReceivedCentavos, item.changeCentavos, item.paymentMethod, item.reference || null, item.receivedByName, item.paidAt); restoreLine.run(item.id, ['efectivo','tarjeta','transferencia','otro'].includes(item.paymentMethod) ? item.paymentMethod : 'otro', item.patientPaidCentavos, item.reference || ''); }
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
    pathname === '/api/insurers' ||
    pathname === '/api/cash' || /^\/api\/cash\/(?:session|session\/close|payments\/\d+\/(?:void|reprint))$/.test(pathname) ||
    /^\/api\/consultas\/\d+\/charge$/.test(pathname) ||
    pathname === '/api/catalogo' || /^\/api\/catalogo\/\d+$/.test(pathname) || pathname === '/api/tarifarios' ||
    /^\/api\/users\/\d+(?:\/reset-password)?$/.test(pathname) ||
    pathname === '/api/pacientes' ||
    /^\/api\/pacientes\/\d+(?:\/(?:historia|consultas|odontograma|adjuntos))?$/.test(pathname) ||
    /^\/api\/adjuntos\/\d+$/.test(pathname) ||
    /^\/api\/consultas\/\d+$/.test(pathname) ||
    /^\/api\/consultas\/\d+\/factura(?:\/(?:cerrar|reabrir))?$/.test(pathname) ||
    pathname === '/api/config' ||
    pathname === '/api/backup' ||
    pathname === '/api/backup/import';
}

function requirePermission(auth, permission) {
  if (!permissions.has(auth.user.role, permission, auth.user.invoiceAccess)) throw new HttpError(403, 'No tienes permiso para esta acción.');
}
function requireUserManager(auth) { requirePermission(auth, 'users.manage'); }
function canManageTarget(auth, target) {
  if (auth.user.role === 'soporte' && ['admin', 'soporte'].includes(target.role)) throw new HttpError(403, 'Soporte no puede administrar cuentas de administrador ni de soporte.');
}
function validateEmail(value) {
  if (typeof value !== 'string' || value.length > 254 || !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(value)) throw new HttpError(400, 'Indica un correo electrónico válido.');
  return value.trim().toLowerCase();
}
function invitationMailer(context) {
  try { return context.mailer || createInvitationMailer(); }
  catch (error) { throw new HttpError(503, error.message); }
}
async function deliverInvitation(db, userId, actorId, mailer) {
  const user = getUserRow(db, userId);
  const token = randomBytes(32).toString('base64url');
  const tokenHash = hashToken(token);
  const url = new URL(mailer.baseUrl);
  url.pathname = url.pathname.replace(/\/$/, '') + '/activar.html';
  url.hash = `invite=${token}`;
  db.prepare('INSERT OR REPLACE INTO invitations (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)')
    .run(tokenHash, userId, Date.now() + 24 * 60 * 60 * 1000, nowIso());
  try {
    await mailer.send({ email: user.email, username: user.username, displayName: user.display_name, url: url.href });
    writeAudit(db, actorId, 'invitation_sent', 'user', userId);
    return { invitationSent: true };
  } catch {
    db.prepare('DELETE FROM invitations WHERE token_hash = ?').run(tokenHash);
    writeAudit(db, actorId, 'invitation_failed', 'user', userId);
    return { invitationSent: false, deliveryError: 'La cuenta existe, pero no se pudo enviar el correo. Revisa SMTP y utiliza Enviar enlace otra vez.' };
  }
}
function getCatalog(db, insuranceId = null) {
  if (!insuranceId) insuranceId = db.prepare("SELECT id FROM insurers WHERE codigo = 'PRIVADO'").get()?.id || null;
  return db.prepare(`SELECT c.*, cp.price_centavos AS tariff_price FROM catalogo c
    LEFT JOIN catalog_prices cp ON cp.catalog_id = c.id AND cp.insurance_id = ? ORDER BY c.tipo, c.nombre, c.id`).all(insuranceId).map(row => ({ id: Number(row.id), tipo: row.tipo, nombre: row.nombre, codigo: row.codigo || '', descripcion: row.descripcion || '', especialidad: row.especialidad || '', serviceType: row.service_type || 'procedimiento', precioCentavos: row.tariff_price == null ? null : Number(row.tariff_price), activo: Boolean(row.activo) }));
}
async function handleCatalog(req, res, pathname, context, auth) {
  const { db, bodyLimit } = context;
  const match = pathname.match(/^\/api\/catalogo(?:\/(\d+))?$/);
  if (!match) return false;
  if (req.method === 'GET' && !match[1]) {
    const requestedInsurance = new URL(req.url, 'http://localhost').searchParams.get('insuranceId');
    const catalog = getCatalog(db, requestedInsurance ? positiveId(requestedInsurance, 'Tarifario') : null);
    sendJson(res, 200, permissions.has(auth.user.role, 'invoice.write', auth.user.invoiceAccess) ? catalog : catalog.filter(item => item.tipo === 'diagnostico'));
    return true;
  }
  requirePermission(auth, 'catalog.write');
  if (!['POST', 'PUT'].includes(req.method) || (req.method === 'POST' && match[1]) || (req.method === 'PUT' && !match[1])) throw new HttpError(404, 'Endpoint no encontrado.');
  const item = billing.catalogItem(requireObject(await readJsonBody(req, bodyLimit)));
  if (item.tipo === 'procedimiento') requirePermission(auth, 'invoice.price');
  let id = match[1] ? positiveId(match[1], 'ID de catálogo') : null;
  if (id) {
    const previous = db.prepare('SELECT tipo FROM catalogo WHERE id = ?').get(id);
    if (!previous) throw new HttpError(404, 'Elemento no encontrado.');
    if (previous.tipo !== item.tipo) throw new HttpError(400, 'No se puede cambiar el tipo de un elemento existente.');
  }
  runTransaction(db, () => {
    if (id) db.prepare('UPDATE catalogo SET nombre = ?, codigo = ?, descripcion = ?, especialidad = ?, service_type = ?, precio_centavos = ?, activo = ? WHERE id = ?').run(item.nombre, item.codigo, item.descripcion, item.especialidad, item.serviceType, item.precioCentavos, Number(item.activo), id);
    else id = Number(db.prepare('INSERT INTO catalogo (tipo, nombre, codigo, descripcion, especialidad, service_type, precio_centavos, activo) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(item.tipo, item.nombre, item.codigo, item.descripcion, item.especialidad, item.serviceType, item.precioCentavos, Number(item.activo)).lastInsertRowid);
    if (item.tipo === 'procedimiento') {
      const privateInsurer = db.prepare("SELECT id FROM insurers WHERE codigo = 'PRIVADO'").get();
      db.prepare(`INSERT INTO catalog_prices (catalog_id, insurance_id, price_centavos, created_at, updated_at) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(catalog_id, insurance_id) DO UPDATE SET price_centavos=excluded.price_centavos, updated_at=excluded.updated_at`).run(id, privateInsurer.id, item.precioCentavos, nowIso(), nowIso());
    }
    writeAudit(db, auth.user.id, 'catalog_save', 'catalogo', id);
  });
  sendJson(res, req.method === 'POST' ? 201 : 200, { ...item, id });
  return true;
}
function pricedConsultation(db, auth, incoming, previous = {}) {
  if (Object.hasOwn(incoming, 'factura')) throw new HttpError(400, 'La factura se administra desde su sección independiente.');
  if (!permissions.has(auth.user.role, 'clinical.write', auth.user.invoiceAccess)) {
    for (const field of ['motivo', 'diagnostico', 'tratamiento', 'receta', 'observaciones', 'proximaCita']) {
      if (Object.hasOwn(incoming, field) && incoming[field] !== previous[field] && incoming[field] !== '') throw new HttpError(403, 'Solo el personal clínico autorizado puede registrar diagnósticos y notas clínicas.');
      delete incoming[field];
    }
  }
  if (Object.hasOwn(incoming, 'procedimientos') || Object.hasOwn(incoming, 'costo')) {
    throw new HttpError(400, 'Los procedimientos y precios se administran en la factura independiente.');
  }
  return incoming;
}

function invoiceFromInput(db, auth, body, previous = null, patientId = null) {
  requireObject(body, 'La factura');
  for (const field of Object.keys(body)) {
    if (!['diagnostico', 'procedimientos', 'tariffInsuranceId'].includes(field)) throw new HttpError(400, `El campo ${field} no pertenece a la factura.`);
  }
  const diagnostico = Object.hasOwn(body, 'diagnostico') ? String(body.diagnostico || '').trim() : (previous?.diagnostico || '');
  if (!diagnostico || diagnostico.length > 1000) throw new HttpError(400, 'El diagnóstico de la factura es obligatorio y admite hasta 1000 caracteres.');
  const sourceLines = Object.hasOwn(body, 'procedimientos') ? body.procedimientos : (previous?.procedimientos || []);
  const patient = patientId ? db.prepare('SELECT insurance_id FROM pacientes WHERE id = ?').get(patientId) : null;
  const privateInsurer = db.prepare("SELECT id FROM insurers WHERE codigo = 'PRIVADO'").get();
  const tariffInsuranceId = body.tariffInsuranceId ? positiveId(body.tariffInsuranceId, 'Tarifario') : (patient?.insurance_id || privateInsurer.id);
  const insurer = db.prepare('SELECT id, nombre FROM insurers WHERE id = ? AND activo = 1').get(tariffInsuranceId);
  if (!insurer) throw new HttpError(400, 'El tarifario seleccionado no existe.');
  const catalog = getCatalog(db, tariffInsuranceId);
  for (const line of sourceLines) {
    const item = catalog.find(entry => entry.id === Number(line.procedimientoId));
    if (!previous && (!item || item.precioCentavos == null)) throw new HttpError(409, `El procedimiento no tiene tarifa configurada para ${insurer.nombre}.`);
    if (!previous && item) {
      const tariffPrice = item.precioCentavos / 100;
      if (line.precio !== undefined && Number(line.precio) !== tariffPrice) throw new HttpError(400, 'El precio debe coincidir con el tarifario seleccionado.');
      line.precio = tariffPrice;
    }
  }
  const procedimientos = billing.lines(sourceLines, catalog, true, previous?.procedimientos || []);
  return {
    diagnostico,
    procedimientos,
    total: billing.total(procedimientos),
    estado: 'abierta',
    creadaEn: previous?.creadaEn || nowIso(),
    actualizadaEn: nowIso(),
    cerradaEn: null,
    tariffInsuranceId: Number(tariffInsuranceId),
    tariffName: insurer.nombre
  };
}

async function handleApi(req, res, pathname, context) {
  const { db, bodyLimit, sessionMaxAge, cookieSecure } = context;
  const method = req.method;

  if (pathname === '/api/auth/accept-invitation' && method === 'POST') {
    const body = requireObject(await readJsonBody(req, bodyLimit));
    if (typeof body.token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(body.token)) throw new HttpError(400, 'El enlace no es válido o ha vencido. Solicita otro enlace.');
    const tokenHash = hashToken(body.token);
    const find = () => db.prepare('SELECT i.*, u.active FROM invitations i JOIN users u ON u.id = i.user_id WHERE token_hash = ? AND expires_at > ?').get(tokenHash, Date.now());
    const invitation = find();
    if (!invitation || !invitation.active) throw new HttpError(400, 'El enlace no es válido o ha vencido. Solicita otro enlace.');
    const record = await createPasswordRecord(validatePassword(body.password));
    runTransaction(db, () => {
      const current = find();
      if (!current || !current.active) throw new HttpError(400, 'El enlace no es válido o ha vencido. Solicita otro enlace.');
      db.prepare('UPDATE users SET password_hash = ?, password_salt = ?, must_change_password = 0, invitation_pending = 0, updated_at = ? WHERE id = ?').run(record.hash, record.salt, nowIso(), current.user_id);
      db.prepare('DELETE FROM invitations WHERE user_id = ?').run(current.user_id);
      db.prepare('DELETE FROM sessions WHERE user_id = ?').run(current.user_id);
      writeAudit(db, current.user_id, 'invitation_accepted', 'user', current.user_id);
    });
    return sendJson(res, 200, { success: true });
  }

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

    if (!row || !row.active || row.invitation_pending || !passwordValid || !matches) {
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

  if (pathname === '/api/tarifarios' && method === 'GET') {
    requirePermission(auth, 'invoice.price');
    const prices = db.prepare('SELECT catalog_id, insurance_id, price_centavos FROM catalog_prices').all();
    return sendJson(res, 200, prices.map(item => ({ catalogId: Number(item.catalog_id), insuranceId: Number(item.insurance_id), priceCentavos: Number(item.price_centavos) })));
  }
  if (pathname === '/api/tarifarios' && method === 'PUT') {
    requirePermission(auth, 'invoice.price');
    const body = requireObject(await readJsonBody(req, bodyLimit));
    const insuranceId = positiveId(body.insuranceId, 'Tarifario');
    if (!db.prepare('SELECT 1 FROM insurers WHERE id = ?').get(insuranceId) || !Array.isArray(body.prices) || body.prices.length > 10000) throw new HttpError(400, 'Tarifario inválido.');
    runTransaction(db, () => {
      const save = db.prepare(`INSERT INTO catalog_prices (catalog_id, insurance_id, price_centavos, created_at, updated_at) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(catalog_id, insurance_id) DO UPDATE SET price_centavos=excluded.price_centavos, updated_at=excluded.updated_at`);
      const remove = db.prepare('DELETE FROM catalog_prices WHERE catalog_id = ? AND insurance_id = ?');
      for (const entry of body.prices) {
        const catalogId = positiveId(entry.catalogId, 'Servicio');
        if (!db.prepare("SELECT 1 FROM catalogo WHERE id = ? AND tipo = 'procedimiento'").get(catalogId)) throw new HttpError(400, 'El tarifario contiene un servicio inválido.');
        if (entry.price === '' || entry.price == null) remove.run(catalogId, insuranceId);
        else save.run(catalogId, insuranceId, billing.cents(Number(entry.price)), nowIso(), nowIso());
      }
      writeAudit(db, auth.user.id, 'tariff_update', 'insurance', insuranceId, { prices: body.prices.length });
    });
    return sendJson(res, 200, { success: true });
  }

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

  if (pathname === '/api/insurers' && method === 'GET') {
    requirePermission(auth, 'clinical.read');
    return sendJson(res, 200, db.prepare('SELECT id, nombre, codigo FROM insurers WHERE activo = 1 ORDER BY id').all());
  }

  if (pathname === '/api/insurers' && method === 'POST') {
    requirePermission(auth, 'patients.write');
    const body = requireObject(await readJsonBody(req, bodyLimit));
    const nombre = String(body.nombre || '').trim();
    if (!nombre || nombre.length > 150) throw new HttpError(400, 'El nombre del seguro es obligatorio y admite hasta 150 caracteres.');
    const existing = db.prepare('SELECT id, nombre, codigo FROM insurers WHERE nombre = ? COLLATE NOCASE').get(nombre);
    if (existing) return sendJson(res, 200, existing);
    const baseCode = nombre.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40) || 'ARS';
    let codigo = baseCode;
    let suffix = 2;
    while (db.prepare('SELECT 1 FROM insurers WHERE codigo = ? COLLATE NOCASE').get(codigo)) codigo = `${baseCode}_${suffix++}`;
    const id = Number(db.prepare('INSERT INTO insurers (nombre, codigo) VALUES (?, ?)').run(nombre, codigo).lastInsertRowid);
    writeAudit(db, auth.user.id, 'insurer_create', 'insurer', id, { nombre });
    return sendJson(res, 201, { id, nombre, codigo });
  }

  if (pathname === '/api/cash' && method === 'GET') {
    requirePermission(auth, 'cash.read');
    const requestUrl = new URL(req.url, 'http://localhost');
    const today = nowIso().slice(0, 10);
    const from = requestUrl.searchParams.get('from') || today;
    const to = requestUrl.searchParams.get('to') || from;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) throw new HttpError(400, 'El rango de fechas no es válido.');
    const payments = db.prepare(`SELECT cp.*, json_extract(p.data, '$.nombre') AS patient_name,
      json_extract(p.data, '$.apellido') AS patient_lastname FROM cash_payments cp
      JOIN pacientes p ON p.id = cp.patient_id WHERE substr(cp.paid_at, 1, 10) BETWEEN ? AND ?
      ORDER BY cp.paid_at DESC, cp.id DESC`).all(from, to).map(row => ({
        id: Number(row.id), consultationId: Number(row.consultation_id), patientId: Number(row.patient_id),
        patientName: `${row.patient_name || ''} ${row.patient_lastname || ''}`.trim(), amount: Number(row.amount_centavos) / 100,
        paymentMethod: row.payment_method, reference: row.reference || '', receivedBy: row.received_by == null ? null : Number(row.received_by), receivedByName: row.received_by_name, paidAt: row.paid_at,
        coveragePercent: Number(row.coverage_percent || 0), insuranceCovered: Number(row.insurance_covered_centavos || 0) / 100, patientPaid: Number(row.patient_paid_centavos ?? row.amount_centavos) / 100,
        amountReceived: Number(row.amount_received_centavos ?? row.patient_paid_centavos) / 100, change: Number(row.change_centavos || 0) / 100
      })).map(payment => ({ ...payment, cashierUsername: payment.receivedBy ? (db.prepare('SELECT username FROM users WHERE id = ?').get(payment.receivedBy)?.username || '') : '', voucherNumber: `REC-${String(payment.id).padStart(8, '0')}`, invoiceNumber: `FAC-${String(payment.consultationId).padStart(8, '0')}`, lines: db.prepare('SELECT method, amount_centavos, card_brand, card_type, last_four, authorization_number, reference_number, processor FROM cash_payment_lines WHERE cash_payment_id = ? ORDER BY id').all(payment.id).map(line => ({ method: line.method, amount: Number(line.amount_centavos) / 100, cardBrand: line.card_brand, cardType: line.card_type, lastFour: line.last_four, authorizationNumber: line.authorization_number, referenceNumber: line.reference_number, processor: line.processor })) }));
    const pendingInvoices = db.prepare(`SELECT c.id, c.paciente_id, c.data, p.data AS patient_data FROM consultas c
      JOIN pacientes p ON p.id = c.paciente_id LEFT JOIN cash_payments cp ON cp.consultation_id = c.id
      WHERE json_extract(c.data, '$.factura.estado') = 'cerrada' AND cp.id IS NULL
      AND EXISTS (SELECT 1 FROM historias h WHERE h.paciente_id = c.paciente_id)
      AND json_array_length(json_extract(c.data, '$.factura.procedimientos')) > 0 ORDER BY c.id DESC`).all().map(row => {
        const consultation = parseData(row.data); const patient = parseData(row.patient_data);
        return { consultationId: Number(row.id), patientId: Number(row.paciente_id), patientName: `${patient.nombre || ''} ${patient.apellido || ''}`.trim(), date: consultation.fecha || '', diagnosis: consultation.factura.diagnostico, total: consultation.factura.total };
      });
    const byMethod = {};
    for (const payment of payments) for (const line of payment.lines) { const key = line.method === 'tarjeta' ? `Tarjeta ${line.cardBrand || 'Otra'} ${line.cardType || ''}`.trim() : line.method; byMethod[key] = Number(((byMethod[key] || 0) + line.amount).toFixed(2)); }
    return sendJson(res, 200, { from, to, payments, pendingInvoices, total: Number(payments.reduce((sum, item) => sum + item.patientPaid, 0).toFixed(2)), insuranceTotal: Number(payments.reduce((sum, item) => sum + item.insuranceCovered, 0).toFixed(2)), byMethod });
  }

  const chargeMatch = pathname.match(/^\/api\/consultas\/(\d+)\/charge$/);
  if (chargeMatch && method === 'POST') {
    requirePermission(auth, 'cash.write');
    const consultationId = positiveId(chargeMatch[1], 'ID de consulta');
    const row = db.prepare('SELECT id, paciente_id, data FROM consultas WHERE id = ?').get(consultationId);
    if (!row) throw new HttpError(404, 'Consulta no encontrada.');
    const consultation = parseData(row.data);
    if (consultation.factura?.estado !== 'cerrada') throw new HttpError(409, 'La factura debe estar cerrada antes de cobrarla.');
    if (!db.prepare('SELECT 1 FROM historias WHERE paciente_id = ?').get(Number(row.paciente_id))) throw new HttpError(409, 'El paciente debe tener su Historia Clínica generada antes del cobro.');
    const body = requireObject(await readJsonBody(req, bodyLimit));
    const legacyAmount = body.amountReceived ?? Number(consultation.factura.total) * (1 - Number(body.coveragePercent || 0) / 100);
    const rawPaymentLines = Array.isArray(body.payments) ? body.payments : [{ method: body.paymentMethod || 'efectivo', amount: legacyAmount }];
    if (!rawPaymentLines.length || rawPaymentLines.length > 10) throw new HttpError(400, 'Agrega entre una y diez formas de pago.');
    const reference = String(body.reference || '').trim();
    if (reference.length > 150) throw new HttpError(400, 'La referencia admite hasta 150 caracteres.');
    const amountCentavos = Math.round(Number(consultation.factura.total) * 100);
    const coveragePercent = Number(body.coveragePercent ?? 0);
    if (!Number.isFinite(coveragePercent) || coveragePercent < 0 || coveragePercent > 100) throw new HttpError(400, 'La cobertura del seguro debe estar entre 0% y 100%.');
    const insuranceCoveredCentavos = Math.round(amountCentavos * coveragePercent / 100);
    const patientPaidCentavos = amountCentavos - insuranceCoveredCentavos;
    const amountReceivedCentavos = body.amountReceived == null || body.amountReceived === '' ? patientPaidCentavos : billing.cents(Number(body.amountReceived));
    if (amountReceivedCentavos < patientPaidCentavos) throw new HttpError(400, 'El monto entregado por el paciente no cubre la parte que le corresponde pagar.');
    const changeCentavos = amountReceivedCentavos - patientPaidCentavos;
    const paymentLines = rawPaymentLines.map(line => {
      const method = String(line.method || '');
      if (!['efectivo','tarjeta','transferencia','cheque','credito','otro'].includes(method)) throw new HttpError(400, 'Método de pago no válido.');
      const clean = field => String(line[field] || '').trim().slice(0, 100);
      const lastFour = clean('lastFour');
      if (lastFour && !/^\d{4}$/.test(lastFour)) throw new HttpError(400, 'Los últimos 4 dígitos deben contener cuatro números.');
      return { method, amountCentavos: billing.cents(Number(line.amount)), cardBrand: method === 'tarjeta' ? clean('cardBrand') : '', cardType: method === 'tarjeta' ? clean('cardType') : '', lastFour, authorizationNumber: clean('authorizationNumber'), referenceNumber: clean('referenceNumber'), processor: clean('processor') };
    });
    if (paymentLines.reduce((sum, line) => sum + line.amountCentavos, 0) !== amountReceivedCentavos) throw new HttpError(400, 'La suma de las formas de pago debe coincidir con el monto entregado.');
    const paymentMethod = paymentLines.length === 1 && ['efectivo','tarjeta','transferencia','otro'].includes(paymentLines[0].method) ? paymentLines[0].method : 'otro';
    const paidAt = nowIso();
    let id;
    try {
      id = runTransaction(db, () => {
        const result = db.prepare(`INSERT INTO cash_payments (consultation_id, patient_id, amount_centavos, coverage_percent, insurance_covered_centavos, patient_paid_centavos, amount_received_centavos, change_centavos, payment_method, reference, received_by, received_by_name, paid_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(consultationId, Number(row.paciente_id), amountCentavos, coveragePercent, insuranceCoveredCentavos, patientPaidCentavos, amountReceivedCentavos, changeCentavos, paymentMethod, reference || null, auth.user.id, auth.user.displayName, paidAt);
        const receiptId = Number(result.lastInsertRowid);
        const insertLine = db.prepare('INSERT INTO cash_payment_lines (cash_payment_id, method, amount_centavos, card_brand, card_type, last_four, authorization_number, reference_number, processor) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
        for (const line of paymentLines) insertLine.run(receiptId, line.method, line.amountCentavos, line.cardBrand, line.cardType, line.lastFour, line.authorizationNumber, line.referenceNumber, line.processor);
        writeAudit(db, auth.user.id, 'cash_payment', 'consulta', consultationId, { amountCentavos, coveragePercent, patientPaidCentavos, paymentMethods: paymentLines.map(line => line.method) });
        return receiptId;
      });
    } catch (error) {
      if (String(error.message).includes('UNIQUE')) throw new HttpError(409, 'Esta factura ya fue cobrada.');
      throw error;
    }
    return sendJson(res, 201, { id, voucherNumber: `REC-${String(id).padStart(8, '0')}`, consultationId, amount: amountCentavos / 100, coveragePercent, insuranceCovered: insuranceCoveredCentavos / 100, patientPaid: patientPaidCentavos / 100, amountReceived: amountReceivedCentavos / 100, change: changeCentavos / 100, paymentMethod, payments: paymentLines.map(line => ({ method: line.method, amount: line.amountCentavos / 100, cardBrand: line.cardBrand, cardType: line.cardType, lastFour: line.lastFour, authorizationNumber: line.authorizationNumber, referenceNumber: line.referenceNumber, processor: line.processor })), reference, receivedByName: auth.user.displayName, cashierUsername: auth.user.username, paidAt });
  }

  if (pathname === '/api/users' && method === 'GET') {
    requireUserManager(auth);
    const users = db.prepare('SELECT * FROM users ORDER BY id').all().map(publicUser);
    return sendJson(res, 200, users);
  }

  if (pathname === '/api/users' && method === 'POST') {
    requireUserManager(auth);
    const body = requireObject(await readJsonBody(req, bodyLimit));
    const username = normalizeUsername(body.username);
    const displayName = validateDisplayName(body.displayName);
    const role = validateRole(body.role);
    canManageTarget(auth, { role });
    if (Object.hasOwn(body, 'invoiceAccess') && typeof body.invoiceAccess !== 'boolean') throw new HttpError(400, 'invoiceAccess debe ser true o false.');
    if (body.invoiceAccess && (auth.user.role !== 'admin' || role !== 'doctor')) throw new HttpError(403, 'Solo el administrador puede conceder facturación a un doctor.');
    const invoiceAccess = role === 'doctor' && auth.user.role === 'admin' && body.invoiceAccess === true;
    const email = body.email ? validateEmail(body.email) : null;
    const hasTemporaryPassword = Object.hasOwn(body, 'password');
    const record = await createPasswordRecord(hasTemporaryPassword ? validatePassword(body.password) : randomBytes(48).toString('base64url'));
    if (db.prepare('SELECT 1 FROM users WHERE username = ? OR (? IS NOT NULL AND email = ?)').get(username, email, email)) throw new HttpError(409, 'El usuario o correo ya está en uso.');
    let id;
    try {
      id = runTransaction(db, () => {
        const result = db.prepare(`INSERT INTO users
          (username, display_name, role, professional_role, email, password_hash, password_salt, active, must_change_password, invitation_pending, invoice_access, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?)`)
          .run(username, displayName, permissions.baseRole(role), role, email, record.hash, record.salt, hasTemporaryPassword ? 1 : 0, hasTemporaryPassword ? 0 : 1, invoiceAccess ? 1 : 0, nowIso(), nowIso());
        writeAudit(db, auth.user.id, 'user_create', 'user', Number(result.lastInsertRowid), { username, role });
        return Number(result.lastInsertRowid);
      });
    } catch (error) {
      if (String(error.message).includes('UNIQUE')) throw new HttpError(409, 'El usuario o correo ya está en uso.');
      throw error;
    }
    if (hasTemporaryPassword) return sendJson(res, 201, publicUser(getUserRow(db, id)));
    const delivery = await deliverInvitation(db, id, auth.user.id, invitationMailer(context));
    return sendJson(res, 201, { ...publicUser(getUserRow(db, id)), ...delivery });
  }

  const userResetMatch = pathname.match(/^\/api\/users\/(\d+)\/reset-password$/);
  if (userResetMatch && method === 'POST') {
    requireUserManager(auth);
    const userId = positiveId(userResetMatch[1], 'ID de usuario');
    const target = getUserRow(db, userId);
    if (!target) throw new HttpError(404, 'Usuario no encontrado.');
    canManageTarget(auth, publicUser(target));
    if (!target.active) throw new HttpError(409, 'Activa la cuenta antes de restablecer su contraseña.');
    const body = requireObject(await readJsonBody(req, bodyLimit));
    if (Object.hasOwn(body, 'password')) {
      const record = await createPasswordRecord(validatePassword(body.password));
      runTransaction(db, () => {
        db.prepare('UPDATE users SET password_hash = ?, password_salt = ?, must_change_password = 1, invitation_pending = 0, updated_at = ? WHERE id = ?')
          .run(record.hash, record.salt, nowIso(), userId);
        db.prepare('DELETE FROM invitations WHERE user_id = ?').run(userId);
        db.prepare('UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL').run(nowIso(), userId);
        writeAudit(db, auth.user.id, 'password_reset', 'user', userId);
      });
      return sendJson(res, 200, publicUser(getUserRow(db, userId)));
    }
    validateEmail(target.email);
    const delivery = await deliverInvitation(db, userId, auth.user.id, invitationMailer(context));
    return sendJson(res, 200, { ...publicUser(getUserRow(db, userId)), ...delivery });
  }

  const userMatch = pathname.match(/^\/api\/users\/(\d+)$/);
  if (userMatch && method === 'PUT') {
    requireUserManager(auth);
    const userId = positiveId(userMatch[1], 'ID de usuario');
    const current = getUserRow(db, userId);
    if (!current) throw new HttpError(404, 'Usuario no encontrado.');
    const body = requireObject(await readJsonBody(req, bodyLimit));
    canManageTarget(auth, publicUser(current));
    const allowedFields = ['username', 'displayName', 'role', 'active', 'email', 'invoiceAccess'];
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
    const role = Object.hasOwn(body, 'role') ? validateRole(body.role) : (current.professional_role || current.role);
    canManageTarget(auth, { role });
    if (Object.hasOwn(body, 'invoiceAccess') && typeof body.invoiceAccess !== 'boolean') throw new HttpError(400, 'invoiceAccess debe ser true o false.');
    if (Object.hasOwn(body, 'invoiceAccess') && auth.user.role !== 'admin') throw new HttpError(403, 'Solo el administrador puede cambiar el permiso de facturación.');
    const invoiceAccess = role === 'doctor' && (Object.hasOwn(body, 'invoiceAccess') ? body.invoiceAccess : Boolean(current.invoice_access));
    const email = Object.hasOwn(body, 'email') ? validateEmail(body.email) : current.email;
    if (current.email && email !== current.email && auth.user.role !== 'admin') throw new HttpError(403, 'Solo el administrador puede cambiar el correo de una cuenta.');
    if (Object.hasOwn(body, 'active') && typeof body.active !== 'boolean') {
      throw new HttpError(400, 'active debe ser true o false.');
    }
    const active = Object.hasOwn(body, 'active') ? body.active : Boolean(current.active);

    if (userId === auth.user.id && !active) {
      throw new HttpError(409, 'No puedes desactivar tu propio usuario.');
    }
    if (userId === auth.user.id && role !== auth.user.role) {
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
          UPDATE users SET username = ?, display_name = ?, role = ?, professional_role = ?, email = ?, active = ?, invoice_access = ?, updated_at = ?
          WHERE id = ?
        `).run(username, displayName, permissions.baseRole(role), role, email, active ? 1 : 0, invoiceAccess ? 1 : 0, nowIso(), userId);
        if (!active || email !== current.email) db.prepare('DELETE FROM invitations WHERE user_id = ?').run(userId);
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
    requireUserManager(auth);
    const userId = positiveId(userMatch[1], 'ID de usuario');
    const target = getUserRow(db, userId);
    if (!target) throw new HttpError(404, 'Usuario no encontrado.');
    canManageTarget(auth, publicUser(target));
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

  if (!permissions.has(auth.user.role, 'clinical.read', auth.user.invoiceAccess)) throw new HttpError(403, 'Este perfil no tiene acceso a expedientes clínicos.');

  if (await handleCatalog(req, res, pathname, context, auth)) return;

  if (pathname === '/api/pacientes' && method === 'GET') {
    const patients = db.prepare(`${PATIENT_SELECT} ORDER BY p.id`).all().map(patientFromRow);
    return sendJson(res, 200, patients);
  }

  if (pathname === '/api/pacientes' && method === 'POST') {
    requirePermission(auth, 'patients.write');
    const body = requireObject(await readJsonBody(req, bodyLimit));
    const data = validatePatientInput(body);
    const insurance = patientInsuranceInput(db, body);
    const timestamp = nowIso();
    data.fechaRegistro = data.fechaRegistro || timestamp;
    data.fechaActualizacion = timestamp;
    const patientId = runTransaction(db, () => {
      const result = db.prepare('INSERT INTO pacientes (data, insurance_id, numero_afiliado, numero_poliza, numero_autorizacion) VALUES (?, ?, ?, ?, ?)')
        .run(JSON.stringify(data), insurance.insuranceId, insurance.affiliateNumber || null, insurance.policyNumber || null, insurance.authorizationNumber || null);
      const id = Number(result.lastInsertRowid);
      writeAudit(db, auth.user.id, 'patient_create', 'paciente', id);
      return id;
    });
    return sendJson(res, 201, patientFromRow(db.prepare(`${PATIENT_SELECT} WHERE p.id = ?`).get(patientId)));
  }

  const patientResourceMatch = pathname.match(/^\/api\/pacientes\/(\d+)$/);
  if (patientResourceMatch && method === 'GET') {
    const patientId = positiveId(patientResourceMatch[1], 'ID de paciente');
    const row = db.prepare(`${PATIENT_SELECT} WHERE p.id = ?`).get(patientId);
    if (!row) throw new HttpError(404, 'Paciente no encontrado.');
    return sendJson(res, 200, patientFromRow(row));
  }

  if (patientResourceMatch && method === 'PUT') {
    requirePermission(auth, 'patients.write');
    const patientId = positiveId(patientResourceMatch[1], 'ID de paciente');
    const row = db.prepare(`${PATIENT_SELECT} WHERE p.id = ?`).get(patientId);
    if (!row) throw new HttpError(404, 'Paciente no encontrado.');
    const body = requireObject(await readJsonBody(req, bodyLimit));
    const incoming = validatePatientInput(body);
    const insurance = patientInsuranceInput(db, body);
    const data = { ...parseData(row.data), ...incoming, fechaActualizacion: nowIso() };
    runTransaction(db, () => {
      db.prepare('UPDATE pacientes SET data = ?, insurance_id = ?, numero_afiliado = ?, numero_poliza = ?, numero_autorizacion = ? WHERE id = ?')
        .run(JSON.stringify(data), insurance.insuranceId, insurance.affiliateNumber || null, insurance.policyNumber || null, insurance.authorizationNumber || null, patientId);
      writeAudit(db, auth.user.id, 'patient_update', 'paciente', patientId);
    });
    return sendJson(res, 200, patientFromRow(db.prepare(`${PATIENT_SELECT} WHERE p.id = ?`).get(patientId)));
  }

  if (patientResourceMatch && method === 'DELETE') {
    requireRole(auth, CLINICAL_WRITERS);
    const patientId = positiveId(patientResourceMatch[1], 'ID de paciente');
    if (!patientExists(db, patientId)) throw new HttpError(404, 'Paciente no encontrado.');
    if (db.prepare('SELECT 1 FROM cash_payments WHERE patient_id = ?').get(patientId)) throw new HttpError(409, 'No puedes eliminar un paciente con movimientos de caja registrados.');
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

  const patientAttachmentsMatch = pathname.match(/^\/api\/pacientes\/(\d+)\/adjuntos$/);
  if (patientAttachmentsMatch && method === 'GET') {
    const patientId = positiveId(patientAttachmentsMatch[1], 'ID de paciente');
    ensurePatient(db, patientId);
    const items = db.prepare(`SELECT id, patient_id, filename, mime_type, size_bytes, uploaded_by_name, created_at
      FROM clinical_attachments WHERE patient_id = ? ORDER BY created_at DESC, id DESC`).all(patientId);
    return sendJson(res, 200, items.map(item => ({ id: Number(item.id), patientId: Number(item.patient_id), filename: item.filename, mimeType: item.mime_type, sizeBytes: Number(item.size_bytes), uploadedByName: item.uploaded_by_name, createdAt: item.created_at })));
  }
  if (patientAttachmentsMatch && method === 'POST') {
    requireRole(auth, CLINICAL_WRITERS);
    const patientId = positiveId(patientAttachmentsMatch[1], 'ID de paciente');
    ensurePatient(db, patientId);
    let filename;
    try { filename = decodeURIComponent(String(req.headers['x-file-name'] || '')).trim(); } catch { throw new HttpError(400, 'El nombre del archivo no es válido.'); }
    filename = path.basename(filename).replace(/[\x00-\x1f\x7f]/g, '').slice(0, 180);
    if (!filename) throw new HttpError(400, 'El nombre del archivo es obligatorio.');
    const mimeType = String(req.headers['content-type'] || '').split(';', 1)[0].toLowerCase();
    const allowedTypes = new Set(['image/jpeg', 'image/png', 'image/webp', 'application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document']);
    if (!allowedTypes.has(mimeType)) throw new HttpError(415, 'Formato no permitido. Usa JPG, PNG, WEBP, PDF, DOC o DOCX.');
    const content = await readBinaryBody(req, ATTACHMENT_LIMIT);
    const createdAt = nowIso();
    const id = Number(db.prepare(`INSERT INTO clinical_attachments
      (patient_id, filename, mime_type, size_bytes, content, uploaded_by, uploaded_by_name, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(patientId, filename, mimeType, content.length, content, auth.user.id, auth.user.displayName, createdAt).lastInsertRowid);
    writeAudit(db, auth.user.id, 'attachment_create', 'clinical_attachment', id, { patientId, filename, sizeBytes: content.length });
    return sendJson(res, 201, { id, patientId, filename, mimeType, sizeBytes: content.length, uploadedByName: auth.user.displayName, createdAt });
  }

  const attachmentMatch = pathname.match(/^\/api\/adjuntos\/(\d+)$/);
  if (attachmentMatch && method === 'GET') {
    const attachmentId = positiveId(attachmentMatch[1], 'ID de adjunto');
    const item = db.prepare('SELECT filename, mime_type, size_bytes, content FROM clinical_attachments WHERE id = ?').get(attachmentId);
    if (!item) throw new HttpError(404, 'Archivo adjunto no encontrado.');
    res.statusCode = 200;
    res.setHeader('Content-Type', item.mime_type);
    res.setHeader('Content-Length', String(item.size_bytes));
    res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(item.filename)}`);
    return res.end(item.content);
  }
  if (attachmentMatch && method === 'DELETE') {
    requireRole(auth, CLINICAL_WRITERS);
    const attachmentId = positiveId(attachmentMatch[1], 'ID de adjunto');
    const item = db.prepare('SELECT patient_id, filename FROM clinical_attachments WHERE id = ?').get(attachmentId);
    if (!item) throw new HttpError(404, 'Archivo adjunto no encontrado.');
    db.prepare('DELETE FROM clinical_attachments WHERE id = ?').run(attachmentId);
    writeAudit(db, auth.user.id, 'attachment_delete', 'clinical_attachment', attachmentId, { patientId: Number(item.patient_id), filename: item.filename });
    return sendJson(res, 200, { success: true });
  }

  const patientConsultationsMatch = pathname.match(/^\/api\/pacientes\/(\d+)\/consultas$/);
  if (patientConsultationsMatch && method === 'GET') {
    const patientId = positiveId(patientConsultationsMatch[1], 'ID de paciente');
    ensurePatient(db, patientId);
    const consultations = db.prepare(`
      SELECT id, paciente_id, data FROM consultas WHERE paciente_id = ?
      ORDER BY COALESCE(json_extract(data, '$.fecha'), '') DESC, id DESC
    `).all(patientId).map(consultationFromRow).map(item => consultationForUser(item, auth.user));
    return sendJson(res, 200, consultations);
  }

  if (patientConsultationsMatch && method === 'POST') {
    requirePermission(auth, 'consultations.write');
    const patientId = positiveId(patientConsultationsMatch[1], 'ID de paciente');
    ensurePatient(db, patientId);
    const data = pricedConsultation(db, auth, validateConsultationInput(requireObject(await readJsonBody(req, bodyLimit))));
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
    requirePermission(auth, 'consultations.write');
    const consultationId = positiveId(consultationMatch[1], 'ID de consulta');
    const row = db.prepare('SELECT id, paciente_id, data FROM consultas WHERE id = ?').get(consultationId);
    if (!row) throw new HttpError(404, 'Consulta no encontrada.');
    const incoming = validateConsultationInput(requireObject(await readJsonBody(req, bodyLimit)));
    const data = { ...parseData(row.data), ...pricedConsultation(db, auth, incoming, parseData(row.data)) };
    data.fecha = data.fecha || nowIso().slice(0, 10);
    runTransaction(db, () => {
      db.prepare('UPDATE consultas SET data = ? WHERE id = ?').run(JSON.stringify(data), consultationId);
      writeAudit(db, auth.user.id, 'consultation_update', 'consulta', consultationId);
    });
    return sendJson(res, 200, consultationForUser({
      ...data,
      id: consultationId,
      pacienteId: Number(row.paciente_id)
    }, auth.user));
  }

  const invoiceMatch = pathname.match(/^\/api\/consultas\/(\d+)\/factura(?:\/(cerrar|reabrir))?$/);
  if (invoiceMatch) {
    const consultationId = positiveId(invoiceMatch[1], 'ID de consulta');
    const row = db.prepare('SELECT id, paciente_id, data FROM consultas WHERE id = ?').get(consultationId);
    if (!row) throw new HttpError(404, 'Consulta no encontrada.');
    const consultation = parseData(row.data);
    const action = invoiceMatch[2];

    if (!action && method === 'PUT') {
      requirePermission(auth, 'invoice.write');
      if (consultation.factura?.estado === 'cerrada') throw new HttpError(409, 'La factura está cerrada. Solo un administrador puede reabrirla.');
      const factura = invoiceFromInput(db, auth, await readJsonBody(req, bodyLimit), consultation.factura, Number(row.paciente_id));
      consultation.factura = factura;
      runTransaction(db, () => {
        db.prepare('UPDATE consultas SET data = ? WHERE id = ?').run(JSON.stringify(consultation), consultationId);
        writeAudit(db, auth.user.id, 'invoice_update', 'consulta', consultationId, { total: factura.total });
      });
      return sendJson(res, 200, { ...consultation, id: consultationId, pacienteId: Number(row.paciente_id) });
    }

    if (action === 'cerrar' && method === 'POST') {
      requirePermission(auth, 'invoice.write');
      if (!consultation.factura) throw new HttpError(409, 'Guarda la factura antes de cerrarla.');
      if (consultation.factura.estado === 'cerrada') throw new HttpError(409, 'La factura ya está cerrada.');
      if (!consultation.factura.procedimientos?.length) throw new HttpError(400, 'Agrega al menos un procedimiento antes de cerrar la factura.');
      consultation.factura.estado = 'cerrada';
      consultation.factura.cerradaEn = nowIso();
      consultation.factura.actualizadaEn = consultation.factura.cerradaEn;
      runTransaction(db, () => {
        db.prepare('UPDATE consultas SET data = ? WHERE id = ?').run(JSON.stringify(consultation), consultationId);
        writeAudit(db, auth.user.id, 'invoice_close', 'consulta', consultationId, { total: consultation.factura.total });
      });
      return sendJson(res, 200, { ...consultation, id: consultationId, pacienteId: Number(row.paciente_id) });
    }

    if (action === 'reabrir' && method === 'POST') {
      requirePermission(auth, 'invoice.reopen');
      if (!consultation.factura || consultation.factura.estado !== 'cerrada') throw new HttpError(409, 'La factura no está cerrada.');
      if (db.prepare('SELECT 1 FROM cash_payments WHERE consultation_id = ?').get(consultationId)) throw new HttpError(409, 'No puedes reabrir una factura que ya fue cobrada.');
      consultation.factura.estado = 'abierta';
      consultation.factura.cerradaEn = null;
      consultation.factura.actualizadaEn = nowIso();
      runTransaction(db, () => {
        db.prepare('UPDATE consultas SET data = ? WHERE id = ?').run(JSON.stringify(consultation), consultationId);
        writeAudit(db, auth.user.id, 'invoice_reopen', 'consulta', consultationId);
      });
      return sendJson(res, 200, { ...consultation, id: consultationId, pacienteId: Number(row.paciente_id) });
    }
  }

  if (consultationMatch && method === 'DELETE') {
    requireRole(auth, CLINICAL_WRITERS);
    const consultationId = positiveId(consultationMatch[1], 'ID de consulta');
    const row = db.prepare('SELECT paciente_id, data FROM consultas WHERE id = ?').get(consultationId);
    if (!row) throw new HttpError(404, 'Consulta no encontrada.');
    if (db.prepare('SELECT 1 FROM cash_payments WHERE consultation_id = ?').get(consultationId)) throw new HttpError(409, 'No puedes eliminar una consulta con un cobro registrado.');
    if (parseData(row.data).factura?.estado === 'cerrada') requirePermission(auth, 'invoice.reopen');
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
  if (pathname === '/' || pathname === '/index.html' || pathname === '/activar.html' || pathname === '/logo.jpg') return true;
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
  const context = { db, bodyLimit, sessionMaxAge, cookieSecure, mailer: options.mailer }; 

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
      if (error instanceof HttpError || error.status === 400) {
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
