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
