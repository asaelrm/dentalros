/**
 * Módulo de Base de Datos Local (IndexedDB con respaldo automático en LocalStorage)
 * Sistema de Gestión Odontológica
 * Almacenamiento persistente, seguro, compatible con file:// y sin dependencias.
 */

const DB_NAME = 'SistemaOdontologicoDB_v2';
const DB_VERSION = 2;

class OdontoDB {
  constructor() {
    this.db = null;
    this.useLocalStorage = false;
  }

  async init() {
    try {
      if (!window.indexedDB) {
        console.warn('IndexedDB no está disponible en este navegador. Activando modo LocalStorage.');
        this.useLocalStorage = true;
        this.initLocalStorage();
        return;
      }

      await new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onupgradeneeded = (event) => {
          const db = event.target.result;

          // Almacén de Pacientes
          if (!db.objectStoreNames.contains('pacientes')) {
            const pacientesStore = db.createObjectStore('pacientes', { keyPath: 'id', autoIncrement: true });
            pacientesStore.createIndex('cedula', 'cedula', { unique: false });
            pacientesStore.createIndex('nombre', 'nombre', { unique: false });
            pacientesStore.createIndex('fechaRegistro', 'fechaRegistro', { unique: false });
          }

          // Almacén de Historias Clínicas (Anamnesis)
          if (!db.objectStoreNames.contains('historias')) {
            db.createObjectStore('historias', { keyPath: 'pacienteId' });
          }

          // Almacén de Consultas / Récord de Citas y Evoluciones
          if (!db.objectStoreNames.contains('consultas')) {
            const consultasStore = db.createObjectStore('consultas', { keyPath: 'id', autoIncrement: true });
            consultasStore.createIndex('pacienteId', 'pacienteId', { unique: false });
            consultasStore.createIndex('fecha', 'fecha', { unique: false });
          }

          // Almacén de Odontogramas
          if (!db.objectStoreNames.contains('odontogramas')) {
            db.createObjectStore('odontogramas', { keyPath: 'pacienteId' });
          }

          // Almacén de Configuración del Consultorio
          if (!db.objectStoreNames.contains('configuracion')) {
            db.createObjectStore('configuracion', { keyPath: 'id' });
          }
        };

        request.onsuccess = (event) => {
          this.db = event.target.result;
          resolve(this.db);
        };

        request.onerror = (event) => {
          console.warn('No se pudo inicializar IndexedDB (posible restricción de seguridad o modo incógnito). Activando respaldo LocalStorage:', event.target.error);
          this.useLocalStorage = true;
          this.initLocalStorage();
          resolve(); // Continuar con LocalStorage sin romper la app
        };

        request.onblocked = () => {
          console.warn('Apertura de IndexedDB bloqueada por otra pestaña abierta.');
        };
      });

    } catch (err) {
      console.warn('Error al iniciar IndexedDB. Usando LocalStorage:', err);
      this.useLocalStorage = true;
      this.initLocalStorage();
    }
  }

  // --- MÉTODOS LOCALSTORAGE FALLBACK ---
  initLocalStorage() {
    if (!localStorage.getItem('odonto_pacientes')) {
      localStorage.setItem('odonto_pacientes', JSON.stringify([]));
    }
    if (!localStorage.getItem('odonto_historias')) {
      localStorage.setItem('odonto_historias', JSON.stringify({}));
    }
    if (!localStorage.getItem('odonto_consultas')) {
      localStorage.setItem('odonto_consultas', JSON.stringify([]));
    }
    if (!localStorage.getItem('odonto_odontogramas')) {
      localStorage.setItem('odonto_odontogramas', JSON.stringify({}));
    }
  }

  // --- MÉTODOS DE PACIENTES ---
  async getPacientes() {
    if (this.useLocalStorage || !this.db) {
      const list = JSON.parse(localStorage.getItem('odonto_pacientes') || '[]');
      return list;
    }

    return new Promise((resolve, reject) => {
      try {
        const tx = this.db.transaction('pacientes', 'readonly');
        const store = tx.objectStore('pacientes');
        const request = store.getAll();

        request.onsuccess = () => resolve(request.result || []);
        request.onerror = () => {
          console.warn('Fallo lectura IndexedDB, leyendo de LocalStorage');
          resolve(JSON.parse(localStorage.getItem('odonto_pacientes') || '[]'));
        };
      } catch (e) {
        resolve(JSON.parse(localStorage.getItem('odonto_pacientes') || '[]'));
      }
    });
  }

  async getPaciente(id) {
    const numId = Number(id);
    if (this.useLocalStorage || !this.db) {
      const list = JSON.parse(localStorage.getItem('odonto_pacientes') || '[]');
      return list.find(p => p.id === numId) || null;
    }

    return new Promise((resolve, reject) => {
      try {
        const tx = this.db.transaction('pacientes', 'readonly');
        const store = tx.objectStore('pacientes');
        const request = store.get(numId);

        request.onsuccess = () => resolve(request.result || null);
        request.onerror = () => {
          const list = JSON.parse(localStorage.getItem('odonto_pacientes') || '[]');
          resolve(list.find(p => p.id === numId) || null);
        };
      } catch (e) {
        const list = JSON.parse(localStorage.getItem('odonto_pacientes') || '[]');
        resolve(list.find(p => p.id === numId) || null);
      }
    });
  }

  async savePaciente(paciente) {
    const data = { ...paciente };
    
    // CRÍTICO: Si no hay un id numérico válido, eliminar la propiedad por completo.
    // En IndexedDB, tener { id: undefined } o { id: '' } provoca DataError fatal al hacer add().
    const isUpdate = (data.id !== undefined && data.id !== null && data.id !== '' && !isNaN(Number(data.id)));

    if (isUpdate) {
      data.id = Number(data.id);
    } else {
      delete data.id; // La clave NO debe existir para que autoIncrement asigne la nueva
      data.fechaRegistro = data.fechaRegistro || new Date().toISOString();
    }
    data.fechaActualizacion = new Date().toISOString();

    // 1. Guardar en LocalStorage (como réplica o almacenamiento primario)
    let localList = JSON.parse(localStorage.getItem('odonto_pacientes') || '[]');
    let nuevoId = data.id;

    if (isUpdate) {
      const idx = localList.findIndex(p => p.id === data.id);
      if (idx !== -1) {
        localList[idx] = { ...localList[idx], ...data };
      } else {
        localList.push(data);
      }
    } else {
      // Calcular siguiente ID para LocalStorage
      const maxId = localList.reduce((max, p) => (p.id > max ? p.id : max), 0);
      nuevoId = maxId + 1;
      data.id = nuevoId;
      localList.push(data);
    }
    localStorage.setItem('odonto_pacientes', JSON.stringify(localList));

    // 2. Si no hay IndexedDB disponible, devolver ID de inmediato
    if (this.useLocalStorage || !this.db) {
      return nuevoId;
    }

    // 3. Guardar en IndexedDB
    return new Promise((resolve, reject) => {
      try {
        const tx = this.db.transaction('pacientes', 'readwrite');
        const store = tx.objectStore('pacientes');

        // Para IndexedDB: si era inserción nueva, usar put con el ID o add
        const request = store.put(data);

        request.onsuccess = () => {
          resolve(data.id || request.result);
        };

        request.onerror = (e) => {
          console.warn('Error en transacción de IndexedDB paciente, pero fue respaldado en LocalStorage:', e.target.error);
          resolve(nuevoId);
        };
      } catch (err) {
        console.warn('Excepción en IndexedDB paciente, respaldado en LocalStorage:', err);
        resolve(nuevoId);
      }
    });
  }

  async deletePaciente(id) {
    const numId = Number(id);

    // 1. Eliminar de LocalStorage
    let localList = JSON.parse(localStorage.getItem('odonto_pacientes') || '[]');
    localList = localList.filter(p => p.id !== numId);
    localStorage.setItem('odonto_pacientes', JSON.stringify(localList));

    const historias = JSON.parse(localStorage.getItem('odonto_historias') || '{}');
    delete historias[numId];
    localStorage.setItem('odonto_historias', JSON.stringify(historias));

    let consultas = JSON.parse(localStorage.getItem('odonto_consultas') || '[]');
    consultas = consultas.filter(c => c.pacienteId !== numId);
    localStorage.setItem('odonto_consultas', JSON.stringify(consultas));

    const odontogramas = JSON.parse(localStorage.getItem('odonto_odontogramas') || '{}');
    delete odontogramas[numId];
    localStorage.setItem('odonto_odontogramas', JSON.stringify(odontogramas));

    if (this.useLocalStorage || !this.db) return true;

    // 2. Eliminar de IndexedDB
    return new Promise((resolve) => {
      try {
        const tx = this.db.transaction(['pacientes', 'historias', 'consultas', 'odontogramas'], 'readwrite');
        tx.objectStore('pacientes').delete(numId);
        tx.objectStore('historias').delete(numId);
        tx.objectStore('odontogramas').delete(numId);

        const consultasStore = tx.objectStore('consultas');
        const index = consultasStore.index('pacienteId');
        const req = index.openCursor(IDBKeyRange.only(numId));
        
        req.onsuccess = (e) => {
          const cursor = e.target.result;
          if (cursor) {
            consultasStore.delete(cursor.primaryKey);
            cursor.continue();
          }
        };

        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(true);
      } catch (e) {
        resolve(true);
      }
    });
  }

  // --- MÉTODOS DE HISTORIA CLÍNICA ---
  async getHistoria(pacienteId) {
    const numId = Number(pacienteId);

    if (this.useLocalStorage || !this.db) {
      const historias = JSON.parse(localStorage.getItem('odonto_historias') || '{}');
      return historias[numId] || null;
    }

    return new Promise((resolve) => {
      try {
        const tx = this.db.transaction('historias', 'readonly');
        const store = tx.objectStore('historias');
        const request = store.get(numId);

        request.onsuccess = () => {
          if (request.result) resolve(request.result);
          else {
            const historias = JSON.parse(localStorage.getItem('odonto_historias') || '{}');
            resolve(historias[numId] || null);
          }
        };
        request.onerror = () => {
          const historias = JSON.parse(localStorage.getItem('odonto_historias') || '{}');
          resolve(historias[numId] || null);
        };
      } catch (e) {
        const historias = JSON.parse(localStorage.getItem('odonto_historias') || '{}');
        resolve(historias[numId] || null);
      }
    });
  }

  async saveHistoria(historia) {
    const data = {
      ...historia,
      pacienteId: Number(historia.pacienteId),
      fechaActualizacion: new Date().toISOString()
    };

    // Guardar en LocalStorage
    const historias = JSON.parse(localStorage.getItem('odonto_historias') || '{}');
    historias[data.pacienteId] = data;
    localStorage.setItem('odonto_historias', JSON.stringify(historias));

    if (this.useLocalStorage || !this.db) return true;

    return new Promise((resolve) => {
      try {
        const tx = this.db.transaction('historias', 'readwrite');
        const store = tx.objectStore('historias');
        const request = store.put(data);

        request.onsuccess = () => resolve(request.result);
        request.onerror = () => resolve(data.pacienteId);
      } catch (e) {
        resolve(data.pacienteId);
      }
    });
  }

  // --- MÉTODOS DE CONSULTAS / EVOLUCIONES ---
  async getConsultas(pacienteId) {
    const numId = Number(pacienteId);

    if (this.useLocalStorage || !this.db) {
      const all = JSON.parse(localStorage.getItem('odonto_consultas') || '[]');
      const filtered = all.filter(c => Number(c.pacienteId) === numId);
      filtered.sort((a, b) => new Date(b.fecha) - new Date(a.fecha));
      return filtered;
    }

    return new Promise((resolve) => {
      try {
        const tx = this.db.transaction('consultas', 'readonly');
        const store = tx.objectStore('consultas');
        const index = store.index('pacienteId');
        const request = index.getAll(numId);

        request.onsuccess = () => {
          const list = request.result || [];
          list.sort((a, b) => new Date(b.fecha) - new Date(a.fecha));
          resolve(list);
        };
        request.onerror = () => {
          const all = JSON.parse(localStorage.getItem('odonto_consultas') || '[]');
          const filtered = all.filter(c => Number(c.pacienteId) === numId);
          filtered.sort((a, b) => new Date(b.fecha) - new Date(a.fecha));
          resolve(filtered);
        };
      } catch (e) {
        const all = JSON.parse(localStorage.getItem('odonto_consultas') || '[]');
        const filtered = all.filter(c => Number(c.pacienteId) === numId);
        filtered.sort((a, b) => new Date(b.fecha) - new Date(a.fecha));
        resolve(filtered);
      }
    });
  }

  async saveConsulta(consulta) {
    const data = { ...consulta };
    const isUpdate = (data.id !== undefined && data.id !== null && data.id !== '' && !isNaN(Number(data.id)));

    if (isUpdate) {
      data.id = Number(data.id);
    } else {
      delete data.id; // CRÍTICO: Eliminar para autoIncrement
    }
    data.pacienteId = Number(data.pacienteId);
    data.fecha = data.fecha || new Date().toISOString().split('T')[0];

    // LocalStorage
    let localConsultas = JSON.parse(localStorage.getItem('odonto_consultas') || '[]');
    let nuevoId = data.id;

    if (isUpdate) {
      const idx = localConsultas.findIndex(c => c.id === data.id);
      if (idx !== -1) localConsultas[idx] = { ...localConsultas[idx], ...data };
      else localConsultas.push(data);
    } else {
      const maxId = localConsultas.reduce((max, c) => (c.id > max ? c.id : max), 0);
      nuevoId = maxId + 1;
      data.id = nuevoId;
      localConsultas.push(data);
    }
    localStorage.setItem('odonto_consultas', JSON.stringify(localConsultas));

    if (this.useLocalStorage || !this.db) return nuevoId;

    return new Promise((resolve) => {
      try {
        const tx = this.db.transaction('consultas', 'readwrite');
        const store = tx.objectStore('consultas');
        const request = store.put(data);

        request.onsuccess = () => resolve(data.id || request.result);
        request.onerror = () => resolve(nuevoId);
      } catch (e) {
        resolve(nuevoId);
      }
    });
  }

  async deleteConsulta(id) {
    const numId = Number(id);

    let localConsultas = JSON.parse(localStorage.getItem('odonto_consultas') || '[]');
    localConsultas = localConsultas.filter(c => c.id !== numId);
    localStorage.setItem('odonto_consultas', JSON.stringify(localConsultas));

    if (this.useLocalStorage || !this.db) return true;

    return new Promise((resolve) => {
      try {
        const tx = this.db.transaction('consultas', 'readwrite');
        const store = tx.objectStore('consultas');
        store.delete(numId);
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(true);
      } catch (e) {
        resolve(true);
      }
    });
  }

  // --- MÉTODOS DE ODONTOGRAMA ---
  async getOdontograma(pacienteId) {
    const numId = Number(pacienteId);

    if (this.useLocalStorage || !this.db) {
      const odontoMap = JSON.parse(localStorage.getItem('odonto_odontogramas') || '{}');
      return odontoMap[numId] || null;
    }

    return new Promise((resolve) => {
      try {
        const tx = this.db.transaction('odontogramas', 'readonly');
        const store = tx.objectStore('odontogramas');
        const request = store.get(numId);

        request.onsuccess = () => {
          if (request.result) resolve(request.result);
          else {
            const odontoMap = JSON.parse(localStorage.getItem('odonto_odontogramas') || '{}');
            resolve(odontoMap[numId] || null);
          }
        };
        request.onerror = () => {
          const odontoMap = JSON.parse(localStorage.getItem('odonto_odontogramas') || '{}');
          resolve(odontoMap[numId] || null);
        };
      } catch (e) {
        const odontoMap = JSON.parse(localStorage.getItem('odonto_odontogramas') || '{}');
        resolve(odontoMap[numId] || null);
      }
    });
  }

  async saveOdontograma(pacienteId, piezas, notasGenerales = '') {
    const numId = Number(pacienteId);
    const data = {
      pacienteId: numId,
      piezas: piezas || {},
      notasGenerales: notasGenerales || '',
      fechaActualizacion: new Date().toISOString()
    };

    const odontoMap = JSON.parse(localStorage.getItem('odonto_odontogramas') || '{}');
    odontoMap[numId] = data;
    localStorage.setItem('odonto_odontogramas', JSON.stringify(odontoMap));

    if (this.useLocalStorage || !this.db) return true;

    return new Promise((resolve) => {
      try {
        const tx = this.db.transaction('odontogramas', 'readwrite');
        const store = tx.objectStore('odontogramas');
        store.put(data);
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(true);
      } catch (e) {
        resolve(true);
      }
    });
  }

  // --- MÉTODOS DE CONFIGURACIÓN ---
  async getConfig() {
    const defaultConfig = {
      id: 'clinica_config',
      nombreClinica: 'DentalRos',
      nombreDoctor: 'Dr. Odontólogo Tratante',
      especialidad: 'Odontología General e Integral',
      colegiatura: 'COL-12345',
      telefono: '+1 (809) 000-0000',
      email: 'contacto@dentalros.com',
      direccion: 'Av. Principal #123, Consultorio 4B',
      piePagina: 'DentalRos - Hacemos tu sonrisa florecer.'
    };

    const localConf = localStorage.getItem('odonto_config');
    if (localConf) {
      try {
        const parsed = JSON.parse(localConf);
        // Si aún tenía el nombre genérico inicial, actualizarlo a DentalRos
        if (!parsed.nombreClinica || parsed.nombreClinica === 'Centro Odontológico Especializado' || parsed.nombreClinica === 'Centro Odontológico') {
          parsed.nombreClinica = 'DentalRos';
          parsed.piePagina = 'DentalRos - Hacemos tu sonrisa florecer.';
          localStorage.setItem('odonto_config', JSON.stringify(parsed));
        }
        return parsed;
      } catch (e) {}
    }

    if (this.useLocalStorage || !this.db) return defaultConfig;

    return new Promise((resolve) => {
      try {
        const tx = this.db.transaction('configuracion', 'readonly');
        const store = tx.objectStore('configuracion');
        const request = store.get('clinica_config');

        request.onsuccess = () => resolve(request.result || defaultConfig);
        request.onerror = () => resolve(defaultConfig);
      } catch (e) {
        resolve(defaultConfig);
      }
    });
  }

  async saveConfig(config) {
    const data = { ...config, id: 'clinica_config' };
    localStorage.setItem('odonto_config', JSON.stringify(data));

    if (this.useLocalStorage || !this.db) return true;

    return new Promise((resolve) => {
      try {
        const tx = this.db.transaction('configuracion', 'readwrite');
        const store = tx.objectStore('configuracion');
        store.put(data);
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(true);
      } catch (e) {
        resolve(true);
      }
    });
  }

  // --- COPIA DE SEGURIDAD (EXPORTAR E IMPORTAR) ---
  async exportAllData() {
    const pacientes = await this.getPacientes();
    
    // Historias
    let historias = [];
    if (this.useLocalStorage || !this.db) {
      const map = JSON.parse(localStorage.getItem('odonto_historias') || '{}');
      historias = Object.values(map);
    } else {
      historias = await new Promise(res => {
        try {
          const tx = this.db.transaction('historias', 'readonly');
          tx.objectStore('historias').getAll().onsuccess = (e) => res(e.target.result || []);
        } catch (e) {
          const map = JSON.parse(localStorage.getItem('odonto_historias') || '{}');
          res(Object.values(map));
        }
      });
    }

    // Consultas
    let consultas = [];
    if (this.useLocalStorage || !this.db) {
      consultas = JSON.parse(localStorage.getItem('odonto_consultas') || '[]');
    } else {
      consultas = await new Promise(res => {
        try {
          const tx = this.db.transaction('consultas', 'readonly');
          tx.objectStore('consultas').getAll().onsuccess = (e) => res(e.target.result || []);
        } catch (e) {
          res(JSON.parse(localStorage.getItem('odonto_consultas') || '[]'));
        }
      });
    }

    // Odontogramas
    let odontogramas = [];
    if (this.useLocalStorage || !this.db) {
      const map = JSON.parse(localStorage.getItem('odonto_odontogramas') || '{}');
      odontogramas = Object.values(map);
    } else {
      odontogramas = await new Promise(res => {
        try {
          const tx = this.db.transaction('odontogramas', 'readonly');
          tx.objectStore('odontogramas').getAll().onsuccess = (e) => res(e.target.result || []);
        } catch (e) {
          const map = JSON.parse(localStorage.getItem('odonto_odontogramas') || '{}');
          res(Object.values(map));
        }
      });
    }

    const config = await this.getConfig();

    return {
      version: '2.0',
      fechaExportacion: new Date().toISOString(),
      sistema: 'Sistema Odontológico',
      pacientes,
      historias,
      consultas,
      odontogramas,
      config
    };
  }

  async importAllData(data) {
    if (!data || !data.pacientes || !Array.isArray(data.pacientes)) {
      throw new Error('El archivo de respaldo no tiene el formato válido.');
    }

    // Actualizar LocalStorage
    localStorage.setItem('odonto_pacientes', JSON.stringify(data.pacientes));

    const historiasMap = {};
    if (data.historias && Array.isArray(data.historias)) {
      data.historias.forEach(h => { historiasMap[h.pacienteId] = h; });
    }
    localStorage.setItem('odonto_historias', JSON.stringify(historiasMap));

    if (data.consultas && Array.isArray(data.consultas)) {
      localStorage.setItem('odonto_consultas', JSON.stringify(data.consultas));
    }

    const odontMap = {};
    if (data.odontogramas && Array.isArray(data.odontogramas)) {
      data.odontogramas.forEach(o => { odontMap[o.pacienteId] = o; });
    }
    localStorage.setItem('odonto_odontogramas', JSON.stringify(odontMap));

    if (data.config) {
      localStorage.setItem('odonto_config', JSON.stringify(data.config));
    }

    // Actualizar IndexedDB si está activo
    if (!this.useLocalStorage && this.db) {
      try {
        const tx = this.db.transaction(['pacientes', 'historias', 'consultas', 'odontogramas', 'configuracion'], 'readwrite');
        tx.objectStore('pacientes').clear();
        tx.objectStore('historias').clear();
        tx.objectStore('consultas').clear();
        tx.objectStore('odontogramas').clear();

        const pacStore = tx.objectStore('pacientes');
        data.pacientes.forEach(p => pacStore.put(p));

        if (data.historias) {
          const histStore = tx.objectStore('historias');
          data.historias.forEach(h => histStore.put(h));
        }

        if (data.consultas) {
          const consStore = tx.objectStore('consultas');
          data.consultas.forEach(c => consStore.put(c));
        }

        if (data.odontogramas) {
          const odontStore = tx.objectStore('odontogramas');
          data.odontogramas.forEach(o => odontStore.put(o));
        }

        if (data.config) {
          tx.objectStore('configuracion').put({ ...data.config, id: 'clinica_config' });
        }
      } catch (e) {
        console.warn('Importación guardada en LocalStorage');
      }
    }

    return true;
  }
}

window.odontoDB = new OdontoDB();
