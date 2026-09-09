/* ---------------------------------------------------------------
   Reglas del modulo: generar, enviar, abrir, responder y cerrar.
   --------------------------------------------------------------- */
const db = require("./db");
const catalogo = require("./catalogo");
const whatsapp = require("./whatsapp");
const config = require("./config");

function ahora() {
  return new Date().toLocaleString("es-GT", { hour12: false });
}

function armarMensaje(encuesta, instancia) {
  const casos = instancia ? instancia.workIds.length : encuesta.works.selectedIds.length;
  const texto = String(encuesta.whatsappMessage || "")
    .replace(/{{doctor}}/g, (instancia && instancia.doctor) || encuesta.respondent)
    .replace(/{{periodo}}/g, encuesta.periodLabel)
    .replace(/{{casos}}/g, casos)
    .replace(/{{cierre}}/g, encuesta.schedule.closeDay);
  const enlace = instancia
    ? `${config.BASE_URL}/doctor/index.html?i=${instancia.id}`
    : `${config.BASE_URL}/doctor/index.html?s=${encuesta.id}`;
  return `${texto}\n${enlace}`;
}

/* RF-ENC-001: una encuesta por doctor con todos sus trabajos elegibles */
function generar(encuesta) {
  catalogo.aplicarPeriodoAuto(encuesta);
  const periodo = encuesta.period;
  const manual = encuesta.audienceMode === "Selección manual";

  if (!encuesta.works.enabled) {
    const instancia = {
      id: catalogo.uid("inst"),
      surveyId: encuesta.id,
      period: periodo,
      periodLabel: encuesta.periodLabel,
      doctor: encuesta.respondent,
      clinic: "",
      workIds: [],
      state: "Generada",
      generatedAt: ahora(),
      sentAt: "",
      openedAt: "",
      finishedAt: "",
      answers: null,
    };
    return db.instancias.reemplazarPeriodo(encuesta.id, periodo, [instancia]);
  }

  const grupos = catalogo.agruparPorDoctor(encuesta.works.statuses, { desde: encuesta.periodFrom, hasta: encuesta.periodTo }, {
    doctores: manual ? encuesta.audienceDoctors : null,
    ordenes: manual ? encuesta.works.selectedIds : null,
  });
  const nuevas = grupos.map((grupo) => ({
    id: catalogo.uid("inst"),
    surveyId: encuesta.id,
    period: periodo,
    periodLabel: encuesta.periodLabel,
    doctor: grupo.doctor,
    clinic: grupo.clinic,
    workIds: grupo.works.map((w) => w.id),
    state: "Generada",
    generatedAt: ahora(),
    sentAt: "",
    openedAt: "",
    finishedAt: "",
    answers: null,
  }));

  return db.instancias.reemplazarPeriodo(encuesta.id, periodo, nuevas);
}

/* RF-ENC-003: envio por API de WhatsApp con enlace individual */
async function enviar(encuesta) {
  const pendientes = db.instancias
    .listar(encuesta.id)
    .filter((i) => i.state === "Generada" || i.state === "Enviada");

  const resultados = [];
  for (const instancia of pendientes) {
    const salida = await whatsapp.enviar(armarMensaje(encuesta, instancia), {
      tipo: "encuesta",
      surveyId: encuesta.id,
      instanceId: instancia.id,
      doctor: instancia.doctor,
    });
    instancia.state = "Enviada";
    instancia.sentAt = ahora();
    db.instancias.guardar(instancia);
    resultados.push({ doctor: instancia.doctor, ...salida });
  }
  return resultados;
}

/* RN-ENC-006 / RN-ENC-007: cierre al terminar la ventana */
function cerrar(encuesta) {
  const lista = db.instancias.listar(encuesta.id);
  let cerradas = 0;
  lista.forEach((instancia) => {
    if (instancia.state === "Completada" || String(instancia.state).startsWith("Cerrada")) return;
    instancia.state = instancia.state === "Abierta" || instancia.state === "Parcial"
      ? "Cerrada parcial"
      : "Cerrada sin respuesta";
    db.instancias.guardar(instancia);
    cerradas += 1;
  });
  return cerradas;
}

function abrir(instancia) {
  if (instancia.state === "Generada" || instancia.state === "Enviada") {
    instancia.state = "Abierta";
    instancia.openedAt = ahora();
    db.instancias.guardar(instancia);
  }
  return instancia;
}

/* RN-ENC-011: finalizar y bloquear modificaciones */
async function responder(instancia, respuestas) {
  instancia.answers = respuestas;
  instancia.state = "Completada";
  instancia.finishedAt = ahora();
  db.instancias.guardar(instancia);

  const encuesta = db.encuestas.obtener(instancia.surveyId);
  if (encuesta && encuesta.classification === "Externa") {
    const promedio = promedioDe(respuestas);
    await whatsapp.enviar(
      `Encuesta completada por ${instancia.doctor} (${instancia.periodLabel}).\n` +
        `Respuestas: ${respuestas.length} · Promedio: ${promedio}\n` +
        resumenCorto(respuestas),
      { tipo: "resultado", surveyId: encuesta.id, instanceId: instancia.id, doctor: instancia.doctor }
    );
  }
  return instancia;
}

function promedioDe(respuestas) {
  const notas = respuestas.filter((r) => r.calificacion).map((r) => r.calificacion);
  if (!notas.length) return "—";
  return (notas.reduce((a, b) => a + b, 0) / notas.length).toFixed(2);
}

function resumenCorto(respuestas) {
  return respuestas
    .filter((r) => r.calificacion)
    .map((r) => `• ${r.area}: ${r.calificacion}★${r.comentario ? ` — "${r.comentario}"` : ""}`)
    .join("\n");
}

/* Todas las respuestas planas, para la vista de resultados */
function respuestas(surveyId) {
  return db.instancias
    .listar(surveyId)
    .filter((i) => i.answers && i.answers.length)
    .flatMap((i) =>
      i.answers.map((r) =>
        Object.assign({}, r, {
          doctor: i.doctor,
          period: i.periodLabel,
          instanceId: i.id,
          surveyId: i.surveyId,
          finishedAt: i.finishedAt,
        })
      )
    );
}

module.exports = { generar, enviar, cerrar, abrir, responder, respuestas, armarMensaje, ahora };
