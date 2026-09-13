'use strict';

const { DatabaseSync } = require('node:sqlite');

const DEFAULT_CONFIG = Object.freeze({
  id: 'clinica_config',
  nombreClinica: 'DentalRos',
  nombreDoctor: 'Dr. Odontólogo Tratante',
  especialidad: 'Odontología General e Integral',
  colegiatura: 'COL-12345',
  telefono: '+1 (809) 000-0000',
  email: 'contacto@dentalros.com',
  direccion: 'Av. Principal #123, Consultorio 4B',
  piePagina: 'DentalRos - Hacemos tu sonrisa florecer.'
});

function openDatabase(filename) {
  const db = new DatabaseSync(filename);
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec('PRAGMA busy_timeout = 5000;');

  if (filename !== ':memory:') {
    db.exec('PRAGMA journal_mode = WAL;');
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('admin', 'editor', 'lector')),
      password_hash BLOB NOT NULL,
      password_salt BLOB NOT NULL,
      active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
      must_change_password INTEGER NOT NULL DEFAULT 0 CHECK (must_change_password IN (0, 1)),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    ) STRICT;

    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      revoked_at TEXT
    ) STRICT;
    CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);

    CREATE TABLE IF NOT EXISTS pacientes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      data TEXT NOT NULL
    ) STRICT;

    CREATE TABLE IF NOT EXISTS historias (
      paciente_id INTEGER PRIMARY KEY REFERENCES pacientes(id) ON DELETE CASCADE,
      data TEXT NOT NULL
    ) STRICT;

    CREATE TABLE IF NOT EXISTS consultas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      paciente_id INTEGER NOT NULL REFERENCES pacientes(id) ON DELETE CASCADE,
      data TEXT NOT NULL
    ) STRICT;
    CREATE INDEX IF NOT EXISTS idx_consultas_paciente_id ON consultas(paciente_id);

    CREATE TABLE IF NOT EXISTS odontogramas (
      paciente_id INTEGER PRIMARY KEY REFERENCES pacientes(id) ON DELETE CASCADE,
      data TEXT NOT NULL
    ) STRICT;

    CREATE TABLE IF NOT EXISTS configuracion (
      id TEXT PRIMARY KEY,
      data TEXT NOT NULL
    ) STRICT;

    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      action TEXT NOT NULL,
      entity TEXT NOT NULL,
      entity_id TEXT,
      details TEXT,
      created_at TEXT NOT NULL
    ) STRICT;
    CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at);
  `);

  // Migración aditiva: conserva IDs, contraseñas, sesiones y registros previos.
  runTransaction(db, () => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS insurers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nombre TEXT NOT NULL COLLATE NOCASE UNIQUE,
        codigo TEXT NOT NULL COLLATE NOCASE UNIQUE,
        activo INTEGER NOT NULL DEFAULT 1 CHECK (activo IN (0, 1))
      ) STRICT;
    `);
    const patientColumns = new Set(db.prepare('PRAGMA table_info(pacientes)').all().map(column => column.name));
    if (!patientColumns.has('insurance_id')) db.exec('ALTER TABLE pacientes ADD COLUMN insurance_id INTEGER REFERENCES insurers(id)');
    if (!patientColumns.has('numero_afiliado')) db.exec('ALTER TABLE pacientes ADD COLUMN numero_afiliado TEXT');
    if (!patientColumns.has('numero_poliza')) db.exec('ALTER TABLE pacientes ADD COLUMN numero_poliza TEXT');
    if (!patientColumns.has('numero_autorizacion')) db.exec('ALTER TABLE pacientes ADD COLUMN numero_autorizacion TEXT');
    const columns = new Set(db.prepare('PRAGMA table_info(users)').all().map(column => column.name));
    if (!columns.has('professional_role')) db.exec("ALTER TABLE users ADD COLUMN professional_role TEXT");
    if (!columns.has('email')) db.exec("ALTER TABLE users ADD COLUMN email TEXT");
    if (!columns.has('invitation_pending')) db.exec("ALTER TABLE users ADD COLUMN invitation_pending INTEGER NOT NULL DEFAULT 0");
    if (!columns.has('invoice_access')) db.exec("ALTER TABLE users ADD COLUMN invoice_access INTEGER NOT NULL DEFAULT 0");
    db.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email) WHERE email IS NOT NULL;
      CREATE TABLE IF NOT EXISTS invitations (
        token_hash TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
        expires_at INTEGER NOT NULL,
        created_at TEXT NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS catalogo (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tipo TEXT NOT NULL CHECK (tipo IN ('diagnostico', 'procedimiento')),
        nombre TEXT NOT NULL,
        precio_centavos INTEGER NOT NULL DEFAULT 0 CHECK (precio_centavos >= 0),
        activo INTEGER NOT NULL DEFAULT 1 CHECK (activo IN (0, 1))
      ) STRICT;
      CREATE TABLE IF NOT EXISTS cash_payments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        consultation_id INTEGER NOT NULL UNIQUE REFERENCES consultas(id) ON DELETE RESTRICT,
        patient_id INTEGER NOT NULL REFERENCES pacientes(id) ON DELETE RESTRICT,
        amount_centavos INTEGER NOT NULL CHECK (amount_centavos >= 0),
        payment_method TEXT NOT NULL CHECK (payment_method IN ('efectivo', 'tarjeta', 'transferencia', 'seguro', 'otro')),
        reference TEXT,
        received_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        received_by_name TEXT NOT NULL,
        paid_at TEXT NOT NULL
      ) STRICT;
      CREATE INDEX IF NOT EXISTS idx_cash_payments_paid_at ON cash_payments(paid_at);
      CREATE INDEX IF NOT EXISTS idx_cash_payments_patient ON cash_payments(patient_id);
      CREATE TABLE IF NOT EXISTS clinical_attachments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        patient_id INTEGER NOT NULL REFERENCES pacientes(id) ON DELETE CASCADE,
        filename TEXT NOT NULL,
        mime_type TEXT NOT NULL,
        size_bytes INTEGER NOT NULL CHECK (size_bytes > 0),
        content BLOB NOT NULL,
        uploaded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        uploaded_by_name TEXT NOT NULL,
        created_at TEXT NOT NULL
      ) STRICT;
      CREATE INDEX IF NOT EXISTS idx_clinical_attachments_patient ON clinical_attachments(patient_id, created_at);
      CREATE TABLE IF NOT EXISTS catalog_prices (
        catalog_id INTEGER NOT NULL REFERENCES catalogo(id) ON DELETE CASCADE,
        insurance_id INTEGER NOT NULL REFERENCES insurers(id) ON DELETE CASCADE,
        price_centavos INTEGER NOT NULL CHECK (price_centavos >= 0),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (catalog_id, insurance_id)
      ) STRICT;
    `);
    const catalogColumns = new Set(db.prepare('PRAGMA table_info(catalogo)').all().map(column => column.name));
    if (!catalogColumns.has('codigo')) db.exec("ALTER TABLE catalogo ADD COLUMN codigo TEXT NOT NULL DEFAULT ''");
    if (!catalogColumns.has('descripcion')) db.exec("ALTER TABLE catalogo ADD COLUMN descripcion TEXT NOT NULL DEFAULT ''");
    if (!catalogColumns.has('especialidad')) db.exec("ALTER TABLE catalogo ADD COLUMN especialidad TEXT NOT NULL DEFAULT ''");
    if (!catalogColumns.has('service_type')) db.exec("ALTER TABLE catalogo ADD COLUMN service_type TEXT NOT NULL DEFAULT 'procedimiento'");
    const cashColumns = new Set(db.prepare('PRAGMA table_info(cash_payments)').all().map(column => column.name));
    if (!cashColumns.has('coverage_percent')) db.exec('ALTER TABLE cash_payments ADD COLUMN coverage_percent REAL NOT NULL DEFAULT 0');
    if (!cashColumns.has('insurance_covered_centavos')) db.exec('ALTER TABLE cash_payments ADD COLUMN insurance_covered_centavos INTEGER NOT NULL DEFAULT 0');
    if (!cashColumns.has('patient_paid_centavos')) db.exec('ALTER TABLE cash_payments ADD COLUMN patient_paid_centavos INTEGER NOT NULL DEFAULT 0');
    if (!cashColumns.has('amount_received_centavos')) db.exec('ALTER TABLE cash_payments ADD COLUMN amount_received_centavos INTEGER NOT NULL DEFAULT 0');
    if (!cashColumns.has('change_centavos')) db.exec('ALTER TABLE cash_payments ADD COLUMN change_centavos INTEGER NOT NULL DEFAULT 0');
    db.exec('UPDATE cash_payments SET patient_paid_centavos = amount_centavos WHERE patient_paid_centavos = 0 AND insurance_covered_centavos = 0');
    db.exec('UPDATE cash_payments SET amount_received_centavos = patient_paid_centavos WHERE amount_received_centavos = 0');
    const insurers = [
      ['SeNaSa','SENASA'],['Primera ARS','PRIMERA'],['MAPFRE Salud ARS','MAPFRE'],['ARS Universal','UNIVERSAL'],
      ['ARS Futuro','FUTURO'],['ARS SEMMA','SEMMA'],['ARS Renacer','RENACER'],['ARS Monumental','MONUMENTAL'],
      ['ARS APS','APS'],['ARS SIMAG','SIMAG'],['ARS Dr. Yunen','YUNEN'],['ARS Colegio Médico Dominicano (CMD)','CMD'],
      ['ARS Reservas','RESERVAS'],['ARS MetaSalud','METASALUD'],['ARS Amor y Paz','AMOR_PAZ'],
      ['ARS Grupo Médico Asociado (GMA)','GMA'],['Plan de Salud Banco Central','BANCO_CENTRAL'],
      ['Sin seguro / Privado','PRIVADO']
    ];
    const insertInsurer = db.prepare('INSERT OR IGNORE INTO insurers (nombre, codigo) VALUES (?, ?)');
    for (const insurer of insurers) insertInsurer.run(...insurer);
    db.exec(`INSERT OR IGNORE INTO catalog_prices (catalog_id, insurance_id, price_centavos, created_at, updated_at)
      SELECT c.id, i.id, c.precio_centavos, datetime('now'), datetime('now') FROM catalogo c CROSS JOIN insurers i
      WHERE c.tipo = 'procedimiento' AND i.codigo = 'PRIVADO'`);
  });

  db.prepare('INSERT OR IGNORE INTO configuracion (id, data) VALUES (?, ?)')
    .run(DEFAULT_CONFIG.id, JSON.stringify(DEFAULT_CONFIG));

  return db;
}

function runTransaction(db, operation) {
  db.exec('BEGIN IMMEDIATE;');
  try {
    const result = operation();
    db.exec('COMMIT;');
    return result;
  } catch (error) {
    try {
      db.exec('ROLLBACK;');
    } catch {
      // Se conserva el error original de la operacion.
    }
    throw error;
  }
}

function writeAudit(db, userId, action, entity, entityId = null, details = null) {
  db.prepare(`
    INSERT INTO audit_logs (user_id, action, entity, entity_id, details, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    userId ?? null,
    action,
    entity,
    entityId === null ? null : String(entityId),
    details === null ? null : JSON.stringify(details),
    new Date().toISOString()
  );
}

module.exports = {
  DEFAULT_CONFIG,
  openDatabase,
  runTransaction,
  writeAudit
};
