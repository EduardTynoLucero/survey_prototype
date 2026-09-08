/* ---------------------------------------------------------------
   Agenda (JOB mensual) sin dependencias.
   Revisa cada pocos segundos si a alguna encuesta le toca generarse,
   enviarse o cerrarse. Tambien acepta ejecuciones de prueba.
   --------------------------------------------------------------- */
const db = require("./db");
const operaciones = require("./operaciones");
const config = require("./config");

const pruebas = new Map(); // surveyId -> { cuando, timer }

function dosDigitos(valor) {
  return String(valor).padStart(2, "0");
}

function marcaActual() {
  const d = new Date();
  return {
    dia: d.getDate(),
    hora: `${dosDigitos(d.getHours())}:${dosDigitos(d.getMinutes())}`,
    clave: `${d.getFullYear()}-${dosDigitos(d.getMonth() + 1)}-${dosDigitos(d.getDate())} ${dosDigitos(d.getHours())}:${dosDigitos(d.getMinutes())}`,
  };
}

/** Proxima fecha en que corre la generacion, como texto */
function proximaEjecucion(encuesta) {
  const prog = encuesta.schedule || {};
  if (!prog.active || prog.repeat === "No repetir") return "";
  const [hh, mm] = String(prog.time || "07:00").split(":").map(Number);
  const hoy = new Date();
  let candidata = new Date(hoy.getFullYear(), hoy.getMonth(), Number(prog.generationDay || 8), hh || 0, mm || 0, 0);
  if (candidata <= hoy) candidata = new Date(hoy.getFullYear(), hoy.getMonth() + 1, Number(prog.generationDay || 8), hh || 0, mm || 0, 0);
  return candidata.toLocaleString("es-GT", { hour12: false });
}

async function ejecutarGeneracion(encuesta, motivo) {
  console.log(`[agenda] Generando "${encuesta.name}" (${motivo})`);
  const instancias = operaciones.generar(encuesta);
  let envios = [];
  if (encuesta.channel === "API WhatsApp") {
    envios = await operaciones.enviar(encuesta);
  }
  encuesta.schedule.lastRun = operaciones.ahora();
  encuesta.schedule.nextRun = proximaEjecucion(encuesta);
  db.encuestas.guardar(encuesta);
  console.log(`[agenda] ${instancias.length} encuesta(s) generada(s), ${envios.length} envío(s)`);
  return { instancias, envios };
}

async function revisar() {
  const { dia, hora, clave } = marcaActual();
  for (const encuesta of db.encuestas.listar()) {
    const prog = encuesta.schedule || {};
    if (encuesta.status !== "Activa" || !prog.active) continue;

    /* Generacion (RN-ENC-001) */
    if (prog.repeat !== "No repetir" && Number(prog.generationDay) === dia && prog.time === hora) {
      if (prog.lastMark !== clave) {
        prog.lastMark = clave;
        db.encuestas.guardar(encuesta);
        try {
          await ejecutarGeneracion(encuesta, "agenda");
        } catch (error) {
          console.error("[agenda] error al generar:", error.message);
        }
      }
      continue;
    }

    /* Cierre al terminar el dia de cierre (RN-ENC-006) */
    if (Number(prog.closeDay) === dia && hora === "23:59" && prog.closeMark !== clave) {
      prog.closeMark = clave;
      const cerradas = operaciones.cerrar(encuesta);
      db.encuestas.guardar(encuesta);
      if (cerradas) console.log(`[agenda] "${encuesta.name}": ${cerradas} encuesta(s) cerrada(s)`);
    }
  }
}

/** Programa una corrida de prueba dentro de N minutos */
function programarPrueba(encuesta, minutos) {
  cancelarPrueba(encuesta.id);
  const espera = Math.max(1, Number(minutos) || 1) * 60 * 1000;
  const cuando = new Date(Date.now() + espera);
  const timer = setTimeout(async () => {
    pruebas.delete(encuesta.id);
    const fresca = db.encuestas.obtener(encuesta.id);
    if (fresca) await ejecutarGeneracion(fresca, "prueba programada");
  }, espera);
  if (timer.unref) timer.unref();
  pruebas.set(encuesta.id, { cuando: cuando.toISOString(), timer });
  console.log(`[agenda] Prueba programada para "${encuesta.name}" a las ${cuando.toLocaleTimeString("es-GT", { hour12: false })}`);
  return cuando;
}

function cancelarPrueba(surveyId) {
  const previa = pruebas.get(surveyId);
  if (previa) {
    clearTimeout(previa.timer);
    pruebas.delete(surveyId);
  }
}

function pruebaDe(surveyId) {
  const p = pruebas.get(surveyId);
  return p ? p.cuando : "";
}

function iniciar() {
  setInterval(() => {
    revisar().catch((error) => console.error("[agenda]", error.message));
  }, config.INTERVALO_AGENDA * 1000);
  console.log(`[agenda] Activa (revisa cada ${config.INTERVALO_AGENDA}s)`);
}

module.exports = { iniciar, revisar, ejecutarGeneracion, programarPrueba, cancelarPrueba, pruebaDe, proximaEjecucion };
