/* ---------------------------------------------------------------
   Reglas del modulo: generar, enviar, abrir, responder y cerrar.
   --------------------------------------------------------------- */
const db = require("./db");
const catalogo = require("./catalogo");
const personal = require("./personal");
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

  /* Encuesta interna: una por colaborador del área evaluada.
     Así el supervisor recibe el promedio de su equipo, no una sola nota. */
  if (encuesta.classification === "Interna") {
    /* Manda la lista congelada en la encuesta; si no hay, se calcula
       con el área y el modo de asignación. */
    const calculado = encuesta.areaKey
      ? personal.respondedores(encuesta.areaKey, encuesta.assignMode)
      : { gente: personal.destinatarios(encuesta.audienceAreas), supervisor: personal.supervisorDe(encuesta.audienceAreas) };

    const gente = (encuesta.respondents || []).length ? personal.porIds(encuesta.respondents) : calculado.gente;
    const supervisor = encuesta.supervisorName || calculado.supervisor;
    const nuevas = (gente.length ? gente : [{ id: "", name: encuesta.respondent, area: "", position: "", email: "" }]).map((persona) => ({
      id: catalogo.uid("inst"),
      surveyId: encuesta.id,
      period: periodo,
      periodLabel: encuesta.periodLabel,
      doctor: persona.name,
      clinic: persona.area || "",
      employeeId: persona.id || "",
      position: persona.position || "",
      email: persona.email || "",
      supervisor,
      workIds: [],
      state: "Generada",
      generatedAt: ahora(),
      sentAt: "",
      openedAt: "",
      finishedAt: "",
      answers: null,
    }));
    return db.instancias.reemplazarPeriodo(encuesta.id, periodo, nuevas);
  }

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

/* Encuestas en las que entró una orden concreta.
   La puntuación solo se devuelve si el doctor ya respondió. */
function encuestasDeTrabajo(workId) {
  return db.instancias
    .listar()
    .filter((instancia) => (instancia.workIds || []).includes(workId))
    .map((instancia) => {
      const encuesta = db.encuestas.obtener(instancia.surveyId);
      const respondida = instancia.state === "Completada" && instancia.answers && instancia.answers.length > 0;
      const todas = respondida ? instancia.answers : [];

      /* Las que evaluaron esta orden, más la evaluación general del doctor */
      const deLaOrden = todas.filter((r) => (r.trabajos || []).includes(workId));
      const generales = todas.filter((r) => r.nivel === "GENERAL");

      return {
        instanceId: instancia.id,
        surveyId: instancia.surveyId,
        surveyName: encuesta ? encuesta.name : "Encuesta eliminada",
        classification: encuesta ? encuesta.classification : "",
        subtype: encuesta ? encuesta.subtype : "",
        period: instancia.periodLabel || instancia.period,
        doctor: instancia.doctor,
        state: instancia.state,
        respondida,
        sentAt: instancia.sentAt,
        openedAt: instancia.openedAt,
        finishedAt: instancia.finishedAt,
        totalOrdenes: (instancia.workIds || []).length,
        promedioOrden: promedioDe(deLaOrden),
        promedioEncuesta: promedioDe(todas),
        respuestasOrden: deLaOrden,
        respuestasGenerales: generales,
      };
    })
    .sort((a, b) => String(b.finishedAt || b.sentAt || "").localeCompare(String(a.finishedAt || a.sentAt || "")));
}

/* Resultados del motor nuevo con la misma estructura del histórico,
   para poder verlos en una sola tabla junto a los períodos anteriores. */
function resultadosInternos() {
  const salida = [];

  db.encuestas
    .listar()
    .filter((encuesta) => encuesta.classification === "Interna")
    .forEach((encuesta) => {
      const grupos = {};
      db.instancias.listar(encuesta.id).forEach((instancia) => {
        const clave = instancia.period || encuesta.period;
        grupos[clave] = grupos[clave] || [];
        grupos[clave].push(instancia);
      });

      Object.entries(grupos).forEach(([clave, lista]) => {
        const contestadas = lista.filter((i) => i.answers && i.answers.length);
        const todas = contestadas.flatMap((i) => i.answers);
        const notas = todas.filter((r) => r.calificacion).map((r) => r.calificacion);
        const promedio = notas.length ? notas.reduce((a, b) => a + b, 0) / notas.length : 0;

        const preguntas = (encuesta.sections || [])
          .flatMap((s) => s.questions || [])
          .map((q) => {
            const suyas = todas.filter((r) => r.pregunta === q.text && r.calificacion);
            const media = suyas.length ? suyas.reduce((a, b) => a + b.calificacion, 0) / suyas.length : 0;
            return { texto: q.text, promedio: media ? media.toFixed(2) : "—", respuestas: suyas.length };
          });

        salida.push({
          id: `mot-${encuesta.id}-${clave}`,
          origen: "Motor de encuestas",
          surveyId: encuesta.id,
          surveyName: encuesta.name,
          supervisor: lista[0] ? lista[0].supervisor || personal.supervisorDe(encuesta.audienceAreas) : "",
          period: clave,
          periodLabel: lista[0] ? lista[0].periodLabel : encuesta.periodLabel,
          area: (encuesta.audienceAreas || []).join(", ") || "—",
          asignadas: lista.length,
          respuestas: contestadas.length,
          promedio: notas.length ? promedio.toFixed(2) : "—",
          escala: notas.length ? personal.escala(promedio) : "Sin respuestas",
          preguntas,
          colaboradores: lista.map((instancia) => {
            const suyas = (instancia.answers || []).filter((r) => r.calificacion);
            const media = suyas.length ? suyas.reduce((a, b) => a + b.calificacion, 0) / suyas.length : 0;
            return {
              name: instancia.doctor,
              position: instancia.position || "",
              email: instancia.email || "",
              estado: suyas.length ? "Respondida" : instancia.state === "Enviada" ? "Enviada" : instancia.state,
              promedio: suyas.length ? media.toFixed(2) : "—",
              respuestas: (instancia.answers || []).length,
              instanceId: instancia.id,
            };
          }),
          comentarios: todas.map((r) => r.comentario).filter(Boolean),
        });
      });
    });

  return salida;
}

/* Histórico + motor nuevo, lo más reciente primero */
function resultados() {
  return [...resultadosInternos(), ...personal.historico()].sort((a, b) =>
    String(b.period).localeCompare(String(a.period))
  );
}

function resultadoDe(id) {
  return resultados().find((r) => r.id === id) || null;
}

module.exports = {
  generar, enviar, cerrar, abrir, responder, respuestas, encuestasDeTrabajo,
  resultados, resultadoDe, armarMensaje, ahora,
};
