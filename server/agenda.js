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

const MESES = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];

const MESES_POR_REPETICION = { Mensual: 1, Trimestral: 3, Anual: 12 };

function aFecha(iso) {
  if (!iso || !String(iso).includes("-")) return null;
  const [anio, mes, dia] = String(iso).split("-").map(Number);
  return new Date(anio, mes - 1, dia);
}

const hora = (texto, porDefecto) => String(texto || porDefecto || "07:00").slice(0, 5);

/* Todo sale de la ventana de disponibilidad:
     día de generación = día de la fecha de inicio
     hora de generación = hora de inicio
     cierre            = fecha y hora de fin */
function derivar(encuesta) {
  const prog = encuesta.schedule || {};
  const inicio = aFecha(prog.startDate);
  const fin = aFecha(prog.endDate);
  return {
    activa: encuesta.status === "Activa",
    repite: prog.repeat !== "No repetir",
    salto: MESES_POR_REPETICION[prog.repeat] || 1,
    dia: inicio ? inicio.getDate() : new Date().getDate(),
    desde: hora(prog.startTime, "07:00"),
    hasta: hora(prog.endTime, "23:59"),
    inicio,
    fin,
  };
}

/* "10 Septiembre 2026 de 07:00 A 23:59" */
function ventana(fecha, desde, hasta) {
  if (!fecha) return "";
  return `${fecha.getDate()} ${MESES[fecha.getMonth()]} ${fecha.getFullYear()} de ${desde} A ${hasta}`;
}

/* Cuándo corre la encuesta por primera vez.
   Sin repetición manda la fecha de inicio; con repetición, el día
   configurado dentro del mes de esa fecha (o el siguiente si ya pasó). */
function primeraEjecucion(encuesta) {
  const d = derivar(encuesta);
  return ventana(d.inicio || new Date(), d.desde, d.hasta);
}

/** Próxima corrida, como texto */
function proximaEjecucion(encuesta) {
  const prog = encuesta.schedule || {};
  const d = derivar(encuesta);
  const [hh, mm] = d.desde.split(":").map(Number);
  const ahora = new Date();

  /* Sin repetición: corre una sola vez en la fecha y hora de inicio */
  if (!d.repite) {
    if (!d.inicio) return "";
    if (prog.lastRun) return "No se repite";
    const cuando = new Date(d.inicio.getFullYear(), d.inicio.getMonth(), d.inicio.getDate(), hh || 0, mm || 0);
    return cuando < ahora ? "Pendiente de ejecutar" : ventana(d.inicio, d.desde, d.hasta);
  }

  let candidata = new Date(ahora.getFullYear(), ahora.getMonth(), d.dia, hh || 0, mm || 0);
  while (candidata <= ahora) candidata = new Date(candidata.getFullYear(), candidata.getMonth() + d.salto, d.dia, hh || 0, mm || 0);
  if (d.inicio && candidata < d.inicio) candidata = new Date(d.inicio.getFullYear(), d.inicio.getMonth(), d.dia, hh || 0, mm || 0);

  if (d.fin && candidata > new Date(d.fin.getFullYear(), d.fin.getMonth(), d.fin.getDate(), 23, 59)) {
    return "Terminó la disponibilidad";
  }

  return ventana(candidata, d.desde, d.hasta);
}

async function ejecutarGeneracion(encuesta, motivo, { soloNoEnviados = false } = {}) {
  console.log(`[agenda] ${soloNoEnviados ? "Completando" : "Generando"} "${encuesta.name}" (${motivo})`);
  /* Completar conserva lo ya generado y respondido; generar parte de cero */
  const resumen = soloNoEnviados ? operaciones.completar(encuesta) : null;
  const instancias = soloNoEnviados ? [] : operaciones.generar(encuesta);
  let envios = [];
  if (encuesta.channel === "API WhatsApp") {
    envios = await operaciones.enviar(encuesta, { soloNoEnviados });
  }
  encuesta.schedule.lastRun = operaciones.ahora();
  encuesta.schedule.nextRun = proximaEjecucion(encuesta);
  encuesta.schedule.firstRun = primeraEjecucion(encuesta);
  db.encuestas.guardar(encuesta);
  console.log(`[agenda] ${soloNoEnviados ? `${resumen.agregadas} agregada(s)` : `${instancias.length} encuesta(s) generada(s)`}, ${envios.length} envío(s)`);
  return { instancias, envios, agregadas: resumen ? resumen.agregadas : instancias.length };
}

const hora2 = (texto, porDefecto) => String(texto || porDefecto || "07:00").slice(0, 5);

/* Hoy está dentro de la ventana de disponibilidad */
function enVentana(prog) {
  const hoy = new Date();
  const soloHoy = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate());
  const inicio = aFecha(prog.startDate);
  const fin = aFecha(prog.endDate);
  if (inicio && soloHoy < inicio) return false;
  if (fin && soloHoy > fin) return false;
  return true;
}

function esHoy(iso) {
  const fecha = aFecha(iso);
  if (!fecha) return false;
  const hoy = new Date();
  return fecha.getFullYear() === hoy.getFullYear() && fecha.getMonth() === hoy.getMonth() && fecha.getDate() === hoy.getDate();
}

async function revisar() {
  const { dia, hora, clave } = marcaActual();
  for (const encuesta of db.encuestas.listar()) {
    const prog = encuesta.schedule || {};
    const d = derivar(encuesta);
    if (!d.activa) continue;

    const dentroDeVentana = enVentana(prog);

    /* Sin repetición: corre una sola vez, el día de inicio a partir de su hora */
    if (!d.repite) {
      if (!prog.lastRun && dentroDeVentana && hora >= d.desde && esHoy(prog.startDate)) {
        try {
          await ejecutarGeneracion(encuesta, "agenda (única)");
        } catch (error) {
          console.error("[agenda] error al generar:", error.message);
        }
      }
      continue;
    }

    /* Generación (RN-ENC-001): el día y la hora salen del inicio de disponibilidad */
    if (dentroDeVentana && d.dia === dia && d.desde === hora) {
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

    /* Cierre (RN-ENC-006): al terminar la ventana de disponibilidad */
    if (esHoy(prog.endDate) && hora === d.hasta && prog.closeMark !== clave) {
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

module.exports = { iniciar, revisar, ejecutarGeneracion, programarPrueba, cancelarPrueba, pruebaDe, proximaEjecucion, primeraEjecucion, derivar };
