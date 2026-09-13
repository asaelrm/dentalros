'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { indexedDB } = require('fake-indexeddb');

function load(hostname = 'example.github.io') {
  const window = { location: { hostname, pathname: '/dentalros/' } };
  const context = vm.createContext({ window, indexedDB, structuredClone, console });
  for (const file of ['js/db.js', 'js/db-local.js']) vm.runInContext(fs.readFileSync(file, 'utf8'), context);
  return window.odontoDB;
}

test('Pages conserva datos, relaciones, respaldos y escrituras concurrentes', async () => {
  const db = load();
  assert.equal(db.isLocal, true);
  const ids = await Promise.all([
    db.savePaciente({ nombre: 'Ana', apellido: 'Prueba', edad: 30 }),
    db.savePaciente({ nombre: 'Luis', apellido: 'Prueba' })
  ]);
  assert.notEqual(ids[0], ids[1]);
  await db.saveHistoria({ pacienteId: ids[0], alergias: 'Ninguna' });
  await db.saveOdontograma(ids[0], { '11': { estado: 'sano' } }, 'Revisión');
  const consultation = await db.saveConsulta({ pacienteId: ids[0], costo: 25, fecha: '2026-09-13' });
  await db.saveConsulta({ id: consultation, costo: 40 });
  await db.savePaciente({ id: ids[0], nombre: 'Ana María', apellido: 'Prueba' });
  await db.saveConfig({ nombreClinica: 'Clínica de prueba' });
  const reloaded = load();
  assert.equal((await reloaded.getPaciente(ids[0])).nombre, 'Ana María');
  assert.equal((await reloaded.getHistoria(ids[0])).alergias, 'Ninguna');
  assert.equal((await reloaded.getOdontograma(ids[0])).notasGenerales, 'Revisión');
  assert.equal((await reloaded.getConsultas(ids[0]))[0].costo, 40);
  assert.equal((await reloaded.getConfig()).nombreClinica, 'Clínica de prueba');
  const backup = await db.exportAllData();
  await assert.rejects(db.importAllData({ pacientes: [] , consultas: [{ id: 1, pacienteId: 123 }] }), /Paciente no encontrado/);
  assert.equal((await db.getPacientes()).length, 2);
  await db.deletePaciente(ids[0]);
  assert.equal(await db.getHistoria(ids[0]), null);
  assert.equal(await db.getOdontograma(ids[0]), null);
  assert.equal((await db.getConsultas(ids[0])).length, 0);
  await db.importAllData(backup);
  assert.equal((await db.getPacientes()).length, 2);
  assert.equal((await db.getConsultas(ids[0])).length, 1);
  const next = await db.savePaciente({ nombre: 'Otra', apellido: 'Persona' });
  assert.ok(next > Math.max(...ids));
  await db.deleteConsulta(consultation);
  assert.equal((await db.getConsultas(ids[0])).length, 0);
  db.connection.close();
  reloaded.connection.close();
});

test('El servidor conserva su cliente API sin activar el modo local', () => {
  assert.equal(load('127.0.0.1').isLocal, undefined);
});
