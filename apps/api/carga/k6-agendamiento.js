import http from 'k6/http';
import { check, group, sleep } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';

/**
 * Prueba de carga · Guía FASE 6
 *
 * Objetivo del cliente: más de 400 citas/día y 50 conversaciones concurrentes.
 * Se modela el peor momento del día, no el promedio: la clínica abre a las 7:00 y
 * la mayor parte del agendamiento se concentra en la primera hora.
 *
 * Uso:
 *   BASE=http://localhost:3000 k6 run apps/api/carga/k6-agendamiento.js
 */

const BASE = __ENV.BASE || 'http://localhost:3000';
const EMAIL = __ENV.EMAIL || 'admin@provivir.local';
const PASSWORD = __ENV.PASSWORD || 'Provivir2026!';

const citasCreadas = new Counter('citas_creadas');
const cuposVacios = new Counter('respuestas_sin_cupos');
const conflictos = new Counter('cupos_ya_ocupados');
const errores = new Rate('errores');
const duracionCupos = new Trend('duracion_consulta_cupos');
const duracionCita = new Trend('duracion_creacion_cita');

export const options = {
  scenarios: {
    // Consulta de disponibilidad: es lo que más se llama, desde los tres canales.
    consulta_cupos: {
      executor: 'ramping-vus',
      exec: 'consultarCupos',
      startVUs: 0,
      stages: [
        { duration: '30s', target: 20 },
        { duration: '1m', target: 50 },
        { duration: '30s', target: 0 },
      ],
    },
    // Portal público: sin login, con su propio rate limit.
    portal_publico: {
      executor: 'constant-vus',
      exec: 'portalPublico',
      vus: 10,
      duration: '2m',
    },
    // Creación real de citas: el objetivo son 400+/día, concentradas en la mañana.
    creacion_citas: {
      executor: 'constant-arrival-rate',
      exec: 'agendar',
      rate: 3,
      timeUnit: '1s',
      duration: '1m30s',
      preAllocatedVUs: 20,
      maxVUs: 60,
      startTime: '30s',
    },
  },
  thresholds: {
    // La asistente tiene al paciente enfrente: por encima de 1 s se nota.
    'duracion_consulta_cupos': ['p(95)<1000'],
    // Crear una cita toma locks; se le da más margen que a una lectura.
    'duracion_creacion_cita': ['p(95)<3000'],
    'errores': ['rate<0.02'],

    // Los umbrales de fallo se miden POR ENDPOINT, no en conjunto: el portal
    // público devuelve 429 a propósito bajo carga y k6 los cuenta como fallo.
    // Un umbral global castigaría al rate limit por hacer su trabajo.
    'http_req_failed{name:GET /cupos}': ['rate<0.01'],
    'http_req_failed{name:POST /citas}': ['rate<0.01'],
    'http_req_duration{name:GET /cupos}': ['p(95)<1000'],
    'http_req_duration{name:POST /citas}': ['p(95)<3000'],
  },
};

/** Un lunes futuro, para no chocar con los datos del seed. */
const FECHAS = ['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09'];
const HORAS = ['08:00', '08:15', '08:30', '08:45', '09:00', '09:15', '09:30', '09:45',
               '10:00', '10:15', '10:30', '10:45', '11:00', '11:15', '11:30', '11:45'];

export function setup() {
  const r = http.post(`${BASE}/api/auth/login`,
    JSON.stringify({ email: EMAIL, password: PASSWORD }),
    { headers: { 'Content-Type': 'application/json' } });

  if (r.status !== 200) throw new Error(`No se pudo autenticar: ${r.status} ${r.body}`);

  const token = r.json('accessToken');

  // Pacientes de carga: se crean una vez y se reutilizan.
  const pacientes = [];
  for (let i = 0; i < 40; i++) {
    const doc = `88${String(i).padStart(8, '0')}`;
    const c = http.post(`${BASE}/api/pacientes`,
      JSON.stringify({ documento: doc, nombres: `Carga${i}`, apellidos: 'Prueba', telefono: `+5730088${String(i).padStart(5, '0')}` }),
      { headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` } });

    if (c.status === 201) {
      pacientes.push(c.json('id'));
    } else {
      // Ya existía de una corrida anterior: se recupera.
      const b = http.get(`${BASE}/api/pacientes?q=${doc}`, { headers: { Authorization: `Bearer ${token}` } });
      const encontrado = b.json('datos.0.id');
      if (encontrado) pacientes.push(encontrado);
    }
  }

  return { token, pacientes };
}

export function consultarCupos(datos) {
  const fecha = FECHAS[Math.floor(Math.random() * FECHAS.length)];
  const r = http.get(`${BASE}/api/cupos?servicioId=mg&fecha=${fecha}&limite=6`, {
    headers: { Authorization: `Bearer ${datos.token}` },
    tags: { name: 'GET /cupos' },
  });

  duracionCupos.add(r.timings.duration);
  const ok = check(r, { 'cupos responde 200': (x) => x.status === 200 });
  errores.add(!ok);
  if (ok && r.json().length === 0) cuposVacios.add(1);

  sleep(Math.random() * 2);
}

export function portalPublico(datos) {
  group('portal', () => {
    const servicios = http.get(`${BASE}/api/portal/servicios`, { tags: { name: 'GET /portal/servicios' } });
    // 429 es una respuesta correcta: el portal público va con rate limit propio.
    check(servicios, { 'catálogo responde 200 o 429': (x) => x.status === 200 || x.status === 429 });

    const fecha = FECHAS[Math.floor(Math.random() * FECHAS.length)];
    const cupos = http.post(`${BASE}/api/portal/cupos`,
      JSON.stringify({ servicioId: 'mg', fecha, limite: 6 }),
      { headers: { 'Content-Type': 'application/json' }, tags: { name: 'POST /portal/cupos' } });

    // 429 es correcto: el portal público va con rate limit agresivo a propósito.
    // POST devuelve 201 en Nest; 429 es el rate limit haciendo su trabajo.
    check(cupos, { 'cupos del portal 2xx o 429': (x) => (x.status >= 200 && x.status < 300) || x.status === 429 });
  });

  sleep(1 + Math.random() * 2);
}

export function agendar(datos) {
  const paciente = datos.pacientes[Math.floor(Math.random() * datos.pacientes.length)];
  if (!paciente) return;

  const fecha = FECHAS[Math.floor(Math.random() * FECHAS.length)];
  const hora = HORAS[Math.floor(Math.random() * HORAS.length)];

  const r = http.post(`${BASE}/api/citas`,
    JSON.stringify({ pacienteId: paciente, servicioId: 'mg', fecha, hora, origen: 'whatsapp' }),
    { headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${datos.token}` },
      tags: { name: 'POST /citas' } });

  duracionCita.add(r.timings.duration);

  // El motor devuelve 201 tanto si creó como si el cupo se ocupó y ofrece
  // alternativas: ambos son respuestas correctas bajo concurrencia.
  const ok = check(r, { 'crear cita responde 2xx': (x) => x.status >= 200 && x.status < 300 });
  errores.add(!ok);

  if (ok) {
    if (r.json('creada') === true) citasCreadas.add(1);
    else conflictos.add(1);
  }
}

export function teardown() {
  // Los datos de carga se limpian con: npm run carga:limpiar -w @provivir/api
}
