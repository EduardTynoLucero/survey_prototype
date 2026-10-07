/* ---------------------------------------------------------------
   Seguimiento y consulta de las encuestas a doctores (externas).

   - Envíos: a quién se le mandó, si WhatsApp lo entregó, si se le
     recordó y en qué quedó la encuesta. El estado de la comunicación
     (WhatsApp) y el de la encuesta van separados: "Enviada" no es
     "Respondida".
   - Respuestas: una fila por doctor que contestó, con su tipo de
     evaluación (General / Individual / Mixta), promedio y alertas
     de atención (1-3 estrellas o comentario).
   - Detalle: la respuesta separada en bloques: evaluación general,
     evaluación en conjunto y trabajos específicos (por ID de orden).
   - Histórico: todas las encuestas de un mismo doctor por período.

   Solo lectura: nada de aquí modifica lo que respondió el doctor.
   Cada respuesta lleva un id estable (instancia:índice) para poder
   ligarla después con una incidencia sin rehacer el módulo.
   --------------------------------------------------------------- */
const db = require("./db");
const catalogo = require("./catalogo");
const datosPrueba = require("./datosPrueba");
const { aISO, cierreDe, preguntaDe } = require("./resultadosDoctores");

const promedio = (notas) => (notas.length ? notas.reduce((a, b) => a + b, 0) / notas.length : null);
const redondo = (v) => (v === null || v === undefined ? null : Number(Number(v).toFixed(2)));
const respondida = (i) => Array.isArray(i.answers) && i.answers.length > 0;
const trabajosPorId = () => new Map(datosPrueba.todosLosTrabajos().map((t) => [t.id, t]));

/* ---------- Doctor: nombre limpio e ID estable ---------- */
function limpiarDoctor(nombre) {
  return String(nombre || "")
    .trim()
    .replace(/^dra?\.?\s+/i, "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase();
}

/* El catálogo de la demo no trae código de doctor: se arma uno fijo
   a partir del nombre, siempre el mismo para el mismo doctor. */
function idDoctor(nombre) {
  const clave = limpiarDoctor(nombre);
  let h = 7;
  for (const c of clave) h = (h * 31 + c.charCodeAt(0)) % 100000;
  return `DR-${String(h).padStart(5, "0")}`;
}

/* ---------- Estados ---------- */
const PENDIENTES = ["Abierta", "Parcial"];

/* Estado de la encuesta, separado del de WhatsApp */
function estadoEncuesta(instancia, cierre) {
  if (respondida(instancia) || instancia.state === "Completada") return { clave: "RESPONDIDA", texto: "Respondida", nota: "" };
  if (String(instancia.state).startsWith("Cerrada")) {
    return { clave: "VENCIDA", texto: "Vencida", nota: instancia.state === "Cerrada parcial" ? "Quedó a medias" : "Sin respuesta" };
  }
  const vencio = cierre && new Date(cierre.replace(" ", "T")) < new Date();
  if (vencio && instancia.sentAt) return { clave: "VENCIDA", texto: "Vencida", nota: "Pasó la fecha de cierre" };
  if (PENDIENTES.includes(instancia.state)) {
    return { clave: "PENDIENTE", texto: "Pendiente", nota: instancia.state === "Parcial" ? "Respuesta a medias" : "Abrió el enlace" };
  }
  if (instancia.state === "Enviada" || instancia.sentAt) return { clave: "ENVIADA", texto: "Enviada", nota: "Aún no abre el enlace" };
  return { clave: "GENERADA", texto: "Generada", nota: "Todavía no se envía" };
}

/* Último registro de WhatsApp de una instancia y tipo, sacado de la bitácora */
function bitacora() {
  const mapa = new Map();
  (db.cargar().mensajes || []).forEach((m) => {
    if (!m.instanceId) return;
    mapa.set(`${m.instanceId}|${m.tipo}`, m);
  });
  return mapa;
}

function estadoWhatsapp(registro, instancia, campo) {
  /* Lo guardado en la instancia manda; si no hay, lo que diga la bitácora */
  const guardado = instancia[campo];
  const r = guardado ? { ok: guardado === "ok", simulado: guardado === "simulado", error: instancia[`${campo}Error`] || "" } : registro;
  if (!r) return instancia.sentAt && campo === "waStatus" ? { clave: "ENVIADO", texto: "Enviado", detalle: "" } : { clave: "NINGUNO", texto: "—", detalle: "" };
  if (r.ok) return { clave: "ENVIADO", texto: "Enviado", detalle: "" };
  if (r.simulado) return { clave: "SIMULADO", texto: "Simulado", detalle: r.error || "Sin canal: quedó en la bitácora" };
  return { clave: "ERROR", texto: "Error", detalle: r.error || "No se pudo enviar" };
}

/* ---------- Envíos con seguimiento ---------- */
function envios(surveyId) {
  const encuesta = db.encuestas.obtener(surveyId);
  if (!encuesta) return null;
  const lista = db.instancias.listar(surveyId);
  const log = bitacora();
  const tope = Math.max(1, Number((encuesta.reminders || {}).max) || 2);

  /* El cierre se calcula por período, como en Resultados */
  const cierres = new Map();
  lista.forEach((i) => {
    if (!cierres.has(i.period)) cierres.set(i.period, cierreDe(encuesta, lista.filter((x) => x.period === i.period)));
  });

  return lista.map((instancia) => {
    const cierre = cierres.get(instancia.period) || "";
    const estado = estadoEncuesta(instancia, cierre);
    const wa = estadoWhatsapp(log.get(`${instancia.id}|encuesta`), instancia, "waStatus");
    const waRec = Number(instancia.reminders || 0) ? estadoWhatsapp(log.get(`${instancia.id}|recordatorio`), instancia, "reminderStatus") : null;
    return {
      instanceId: instancia.id,
      doctor: instancia.doctor,
      doctorKey: limpiarDoctor(instancia.doctor),
      doctorId: idDoctor(instancia.doctor),
      clinic: instancia.clinic || "",
      period: instancia.period,
      periodLabel: instancia.periodLabel || instancia.period,
      worksCount: (instancia.workIds || []).length,
      phone: instancia.doctorPhone || "",
      generatedAt: aISO(instancia.generatedAt),
      sentAt: aISO(instancia.sentAt),
      openedAt: aISO(instancia.openedAt),
      answeredAt: aISO(instancia.finishedAt),
      closesAt: cierre,
      whatsapp: wa,
      reminders: Number(instancia.reminders || 0),
      remindersMax: tope,
      lastReminderAt: aISO(instancia.lastReminderAt),
      reminderWhatsapp: waRec,
      status: estado,
      rawState: instancia.state,
      answered: respondida(instancia),
    };
  });
}

/* ---------- Respuestas ---------- */

/* Respuesta plana con lo necesario para filtrar y mostrar */
function plana(encuesta, instancia, r, indice, trabajos) {
  const { seccion, pregunta } = encuesta ? preguntaDe(encuesta, r) : { seccion: null, pregunta: null };
  const tipo = (pregunta && pregunta.type) || r.tipo || (Number(r.calificacion) > 0 ? "stars" : "short");
  const nota = Number(r.calificacion) || null;
  const umbral = Number((pregunta && pregunta.lowThreshold) || 4);
  /* Un comentario es lo que el doctor escribió con su calificación o
     en una pregunta abierta */
  const texto = ["short", "paragraph"].includes(tipo) ? String(r.valor || "").trim() : "";
  const comentario = String(r.comentario || "").trim();
  const nivel = r.nivelDetalle || (r.nivel === "GENERAL" ? "general" : (r.trabajos || []).length > 1 ? "group" : "work");
  /* Una evaluación general no se liga a órdenes, aunque el motor
     guarde a qué trabajos aplicaba */
  const ordenes = nivel === "general" ? [] : (r.trabajos && r.trabajos.length ? r.trabajos : r.ordenes) || [];
  return {
    answerId: `${instancia.id}:${indice}`,
    questionId: (pregunta && pregunta.id) || r.questionId || "",
    question: r.pregunta || (pregunta && pregunta.text) || "",
    type: tipo,
    sectionId: (seccion && seccion.id) || r.sectionId || "",
    category: (seccion && seccion.title) || r.categoria || "",
    area: r.area || (pregunta && pregunta.area) || "",
    score: nota,
    low: Boolean(nota && nota <= 3),
    belowThreshold: Boolean(nota && nota < umbral),
    value: tipo === "stars" ? "" : String(r.valor || ""),
    reasons: r.motivos || [],
    comment: comentario,
    textAnswer: texto,
    hasComment: Boolean(comentario || texto),
    level: nivel,
    orders: ordenes.map((id) => {
      const t = trabajos.get(id);
      return { workId: id, code: t ? t.code : id };
    }),
    advisors: r.asesoras || [],
    evidence: Array.isArray(r.evidencias) ? r.evidencias : [],
    /* Fase futura: aquí se ligará la incidencia, sin tocar la respuesta */
    incidentId: null,
  };
}

/* Tipo de evaluación, según lo que contestó el doctor:
   General: solo opinión del período, sin órdenes.
   Individual: solo trabajos concretos (uno por uno o en conjunto).
   Mixta: opinión general + trabajos específicos. */
function tipoEvaluacion(respuestas) {
  const general = respuestas.some((r) => r.level === "general");
  const especifica = respuestas.some((r) => r.level === "work" || r.level === "group");
  if (general && especifica) return "MIXTA";
  if (especifica) return "INDIVIDUAL";
  return "GENERAL";
}

function resumenRespuesta(instancia, encuesta, trabajos) {
  const respuestas = instancia.answers.map((r, i) => plana(encuesta, instancia, r, i, trabajos));
  const notas = respuestas.filter((r) => r.score).map((r) => r.score);
  const especificos = new Set(respuestas.filter((r) => r.level === "work").flatMap((r) => r.orders.map((o) => o.workId)));
  const enConjunto = new Set(respuestas.filter((r) => r.level === "group").flatMap((r) => r.orders.map((o) => o.workId)));
  const bajas = respuestas.filter((r) => r.low).length;
  const comentarios = respuestas.filter((r) => r.hasComment).length;
  const atencion = respuestas.filter((r) => r.low || r.hasComment).length;
  return {
    instanceId: instancia.id,
    surveyId: instancia.surveyId,
    surveyName: encuesta ? encuesta.name : "Encuesta eliminada",
    doctor: instancia.doctor,
    doctorKey: limpiarDoctor(instancia.doctor),
    doctorId: idDoctor(instancia.doctor),
    clinic: instancia.clinic || "",
    period: instancia.period,
    periodLabel: instancia.periodLabel || instancia.period,
    answeredAt: aISO(instancia.finishedAt),
    type: tipoEvaluacion(respuestas),
    worksInPeriod: (instancia.workIds || []).length,
    workIds: instancia.workIds || [],
    worksEvaluated: especificos.size,
    worksGrouped: enConjunto.size,
    average: redondo(promedio(notas)),
    lowCount: bajas,
    commentCount: comentarios,
    attention: atencion,
    answers: respuestas,
  };
}

function respuestas(surveyId) {
  const trabajos = trabajosPorId();
  const encuestas = new Map(db.encuestas.listar().map((e) => [e.id, e]));
  return db.instancias
    .listar(surveyId)
    .filter((i) => respondida(i))
    .filter((i) => {
      const e = encuestas.get(i.surveyId);
      return !e || e.classification === "Externa";
    })
    .map((i) => resumenRespuesta(i, encuestas.get(i.surveyId), trabajos))
    .sort((a, b) => String(b.answeredAt).localeCompare(String(a.answeredAt)));
}

/* ---------- Detalle de una respuesta ---------- */
function respuesta(instanceId) {
  const instancia = db.instancias.obtener(instanceId);
  if (!instancia || !respondida(instancia)) return null;
  const encuesta = db.encuestas.obtener(instancia.surveyId);
  const trabajos = trabajosPorId();
  const base = resumenRespuesta(instancia, encuesta, trabajos);

  const ficha = (id) => {
    const t = trabajos.get(id) || {};
    return {
      workId: id,
      code: t.code || id,
      patient: t.patient || "",
      product: t.product || "",
      date: t.sent || "",
      advisor: t.advisor || "",
      clinic: t.clinic || "",
      box: t.box || "",
    };
  };

  const general = base.answers.filter((r) => r.level === "general");
  const conjunto = base.answers.filter((r) => r.level === "group");
  const porOrden = new Map();
  base.answers
    .filter((r) => r.level === "work")
    .forEach((r) =>
      r.orders.forEach((o) => {
        if (!porOrden.has(o.workId)) porOrden.set(o.workId, []);
        porOrden.get(o.workId).push(r);
      })
    );

  return Object.assign(base, {
    surveyDescription: encuesta ? encuesta.description || "" : "",
    general,
    group: conjunto.length
      ? { works: [...new Set(conjunto.flatMap((r) => r.orders.map((o) => o.workId)))].map(ficha), answers: conjunto }
      : null,
    works: [...porOrden.entries()].map(([id, lista]) => Object.assign(ficha(id), { answers: lista, average: redondo(promedio(lista.filter((r) => r.score).map((r) => r.score))) })),
    /* Trabajos del período que no se evaluaron por separado */
    notEvaluated: base.workIds.filter((id) => !porOrden.has(id) && !(conjunto.length && conjunto.some((r) => r.orders.some((o) => o.workId === id)))).map(ficha),
  });
}

/* ---------- Histórico del doctor ---------- */
function historico(doctorKey) {
  const clave = limpiarDoctor(doctorKey);
  const trabajos = trabajosPorId();
  const encuestas = new Map(db.encuestas.listar().map((e) => [e.id, e]));
  const todas = db.instancias.listar().filter((i) => {
    const e = encuestas.get(i.surveyId);
    return e && e.classification === "Externa" && limpiarDoctor(i.doctor) === clave;
  });
  if (!todas.length) return null;

  const filas = todas.map((instancia) => {
    const encuesta = encuestas.get(instancia.surveyId);
    const mismas = db.instancias.listar(instancia.surveyId).filter((x) => x.period === instancia.period);
    const estado = estadoEncuesta(instancia, cierreDe(encuesta, mismas));
    const fila = {
      instanceId: instancia.id,
      surveyId: instancia.surveyId,
      surveyName: encuesta.name,
      period: instancia.period,
      periodLabel: instancia.periodLabel || instancia.period,
      sentAt: aISO(instancia.sentAt),
      answeredAt: aISO(instancia.finishedAt),
      worksInPeriod: (instancia.workIds || []).length,
      status: estado,
      answered: respondida(instancia),
      type: "",
      average: null,
      worksEvaluated: 0,
      attention: 0,
      lowCount: 0,
      commentCount: 0,
    };
    if (respondida(instancia)) {
      const r = resumenRespuesta(instancia, encuesta, trabajos);
      Object.assign(fila, { type: r.type, average: r.average, worksEvaluated: r.worksEvaluated, worksGrouped: r.worksGrouped, attention: r.attention, lowCount: r.lowCount, commentCount: r.commentCount });
    }
    return fila;
  });
  filas.sort((a, b) => String(b.period).localeCompare(String(a.period)) || String(b.answeredAt).localeCompare(String(a.answeredAt)));

  const contestadas = filas.filter((f) => f.answered && f.average !== null);
  const primera = todas[0];
  return {
    doctor: primera.doctor.replace(/^dra?\.?\s+/i, ""),
    doctorKey: clave,
    doctorId: idDoctor(primera.doctor),
    clinic: (todas.find((i) => i.clinic) || {}).clinic || "",
    received: filas.length,
    answered: filas.filter((f) => f.answered).length,
    average: redondo(promedio(contestadas.map((f) => f.average))),
    last: contestadas[0] ? contestadas[0].average : null,
    previous: contestadas[1] ? contestadas[1].average : null,
    attention: filas.filter((f) => f.attention > 0).length,
    rows: filas,
  };
}

/* ---------- Tablero (Resultados): tendencias y KPI ---------- */
/* ---------- Tablero (Dashboard → Encuestas → Doctores) ----------
   Filtros: periodo (YYYY-MM), encuesta (id) y área. La tendencia por
   período ignora el filtro de período para poder comparar meses. */
function contexto(filtros = {}) {
  const trabajos = trabajosPorId();
  const externas = db.encuestas.listar().filter((e) => e.classification === "Externa");
  const encuestas = new Map(externas.map((e) => [e.id, e]));
  const area = filtros.area && filtros.area !== "all" ? filtros.area : "";
  const periodo = filtros.periodo && filtros.periodo !== "all" ? filtros.periodo : "";
  const todas = db.instancias
    .listar()
    .filter((i) => encuestas.has(i.surveyId))
    .filter((i) => !filtros.encuesta || filtros.encuesta === "all" || i.surveyId === filtros.encuesta);

  /* Resumen de cada respuesta, recortado al área si se filtró */
  const resumenes = new Map();
  const resumenDe = (instancia) => {
    if (!resumenes.has(instancia.id)) {
      const r = resumenRespuesta(instancia, encuestas.get(instancia.surveyId), trabajos);
      const answers = area ? r.answers.filter((a) => a.area === area) : r.answers;
      const notas = answers.filter((a) => a.score).map((a) => a.score);
      resumenes.set(instancia.id, Object.assign({}, r, {
        answers,
        average: redondo(promedio(notas)),
        attention: answers.filter((a) => a.low || a.hasComment).length,
      }));
    }
    return resumenes.get(instancia.id);
  };
  const enviada = (i) => Boolean(i.sentAt) || i.state !== "Generada";

  /* Lo demás: solo el período elegido */
  const lista = periodo ? todas.filter((i) => i.period === periodo) : todas;
  const contestadas = lista.filter(respondida);
  const resumenesLista = contestadas.map(resumenDe);
  const respuestas = resumenesLista.flatMap((r) => r.answers);
  const calificadas = respuestas.filter((a) => a.score);
  return { trabajos, externas, encuestas, area, periodo, todas, resumenDe, enviada, lista, contestadas, resumenesLista, respuestas, calificadas };
}

function tablero(filtros = {}) {
  const { trabajos, externas, encuestas, area, periodo, todas, resumenDe, enviada, lista, contestadas, resumenesLista, respuestas, calificadas } = contexto(filtros);

  /* Tendencia: todos los períodos */
  const porPeriodo = new Map();
  todas.forEach((instancia) => {
    const p = instancia.period || "-";
    if (!porPeriodo.has(p)) porPeriodo.set(p, { period: p, periodLabel: instancia.periodLabel || p, sent: 0, answered: 0, notas: [], atencion: 0 });
    const fila = porPeriodo.get(p);
    if (enviada(instancia)) fila.sent += 1;
    if (!respondida(instancia)) return;
    fila.answered += 1;
    const r = resumenDe(instancia);
    if (r.average !== null) fila.notas.push(r.average);
    if (r.attention) fila.atencion += 1;
  });
  const periodos = [...porPeriodo.values()]
    .sort((a, b) => String(a.period).localeCompare(String(b.period)))
    .map((f) => ({
      period: f.period,
      periodLabel: f.periodLabel,
      sent: f.sent,
      answered: f.answered,
      rate: f.sent ? Math.round((f.answered / f.sent) * 100) : 0,
      average: redondo(promedio(f.notas)),
      attention: f.atencion,
      attentionRate: f.answered ? Math.round((f.atencion / f.answered) * 100) : 0,
    }));



  /* Embudo: de lo generado a lo respondido */
  const embudo = {
    generated: lista.length,
    sent: lista.filter(enviada).length,
    delivered: lista.filter((i) => enviada(i) && i.waStatus !== "error").length,
    opened: lista.filter((i) => i.openedAt || respondida(i) || PENDIENTES.includes(i.state)).length,
    answered: contestadas.length,
  };
  const waErrores = lista.filter((i) => i.waStatus === "error").length;
  const vencidas = lista.filter((i) => !respondida(i) && String(i.state).startsWith("Cerrada")).length;

  /* Distribución de estrellas */
  const estrellas = [1, 2, 3, 4, 5].map((n) => ({ stars: n, count: calificadas.filter((a) => a.score === n).length }));

  /* Distribución de respuestas por escala (como el dashboard de internas) */
  const escala = { excellent: 0, good: 0, regular: 0, critical: 0 };
  resumenesLista.forEach((r) => {
    if (r.average === null) return;
    if (r.average >= 4.5) escala.excellent += 1;
    else if (r.average >= 3.5) escala.good += 1;
    else if (r.average >= 2.5) escala.regular += 1;
    else escala.critical += 1;
  });

  const agrupar = (claveDe, items) => {
    const mapa = new Map();
    items.forEach((a) => {
      [].concat(claveDe(a)).filter(Boolean).forEach((clave) => {
        if (!mapa.has(clave)) mapa.set(clave, { notas: [], bajas: 0 });
        mapa.get(clave).notas.push(a.score);
        if (a.low) mapa.get(clave).bajas += 1;
      });
    });
    return [...mapa.entries()].map(([clave, v]) => ({ key: clave, average: redondo(promedio(v.notas)), ratings: v.notas.length, low: v.bajas, lowRate: Math.round((v.bajas / v.notas.length) * 100) }));
  };

  const areas = agrupar((a) => a.area || "Sin área", calificadas).sort((a, b) => a.average - b.average);
  const preguntas = agrupar((a) => a.question, calificadas)
    .map((q) => Object.assign(q, { area: (calificadas.find((a) => a.question === q.key) || {}).area || "" }))
    .sort((a, b) => a.average - b.average);
  /* Asesoras: solo cuenta lo que se calificó por orden (general no se atribuye) */
  const asesoras = agrupar((a) => a.advisors, calificadas.filter((a) => a.level !== "general")).sort((a, b) => b.average - a.average);

  /* Motivos de mejora que marcan cuando califican bajo */
  const motivos = new Map();
  respuestas.filter((a) => a.belowThreshold).forEach((a) => a.reasons.forEach((m) => motivos.set(m, (motivos.get(m) || 0) + 1)));
  const totalMotivos = [...motivos.values()].reduce((t, n) => t + n, 0);

  /* Tipo de evaluación */
  const tipos = ["GENERAL", "INDIVIDUAL", "MIXTA"].map((t) => ({ type: t, count: resumenesLista.filter((r) => r.type === t).length }));

  /* Doctores a vigilar: promedio más bajo, con su último vs. anterior */
  const porDoctor = new Map();
  todas.filter(respondida).forEach((instancia) => {
    const r = resumenDe(instancia);
    if (r.average === null) return;
    if (!porDoctor.has(r.doctorKey)) porDoctor.set(r.doctorKey, { doctor: r.doctor, doctorKey: r.doctorKey, doctorId: r.doctorId, clinic: r.clinic, filas: [] });
    porDoctor.get(r.doctorKey).filas.push(r);
  });
  const doctores = [...porDoctor.values()]
    .map((d) => {
      const filas = d.filas.sort((a, b) => String(a.period).localeCompare(String(b.period)));
      const enPeriodo = periodo ? filas.filter((f) => f.period === periodo) : filas;
      if (!enPeriodo.length) return null;
      const ultimo = enPeriodo[enPeriodo.length - 1];
      const anterior = filas[filas.indexOf(ultimo) - 1];
      return {
        doctor: d.doctor,
        doctorKey: d.doctorKey,
        doctorId: d.doctorId,
        clinic: d.clinic,
        responses: enPeriodo.length,
        average: redondo(promedio(enPeriodo.map((f) => f.average))),
        last: ultimo.average,
        trend: anterior ? redondo(ultimo.average - anterior.average) : null,
        attention: enPeriodo.reduce((t, f) => t + (f.attention ? 1 : 0), 0),
        lowCount: enPeriodo.reduce((t, f) => t + f.answers.filter((a) => a.low).length, 0),
        instanceId: ultimo.instanceId,
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.average - b.average || b.lowCount - a.lowCount);

  const conAtencion = resumenesLista.filter((r) => r.attention > 0).length;
  const notasLista = resumenesLista.filter((r) => r.average !== null).map((r) => r.average);

  return {
    filters: { periodo, encuesta: filtros.encuesta || "all", area },
    options: {
      surveys: externas.map((e) => ({ id: e.id, name: e.name })),
      periods: periodos.map((p) => ({ period: p.period, periodLabel: p.periodLabel })),
      areas: [...new Set(todas.filter(respondida).flatMap((i) => resumenRespuesta(i, encuestas.get(i.surveyId), trabajos).answers.filter((a) => a.score).map((a) => a.area)).filter(Boolean))].sort(),
    },
    sent: embudo.sent,
    answered: contestadas.length,
    rate: embudo.sent ? Math.round((contestadas.length / embudo.sent) * 100) : 0,
    average: redondo(promedio(notasLista)),
    attention: conAtencion,
    attentionRate: contestadas.length ? Math.round((conAtencion / contestadas.length) * 100) : 0,
    waErrors: waErrores,
    expired: vencidas,
    doctors: new Set(lista.map((i) => limpiarDoctor(i.doctor))).size,
    funnel: embudo,
    periods: periodos,
    stars: estrellas,
    scale: [
      { key: "excellent", label: "Excelente", value: escala.excellent },
      { key: "good", label: "Bueno", value: escala.good },
      { key: "regular", label: "Regular", value: escala.regular },
      { key: "critical", label: "Crítico", value: escala.critical },
    ],
    types: tipos,
    areas: areas.map((a) => Object.assign({ area: a.key }, a)),
    questions: preguntas.slice(0, 6).map((q) => Object.assign({ question: q.key }, q)),
    advisors: asesoras.map((a) => Object.assign({ advisor: a.key }, a)),
    reasons: [...motivos.entries()].map(([reason, count]) => ({ reason, count, share: totalMotivos ? Math.round((count / totalMotivos) * 100) : 0 })).sort((a, b) => b.count - a.count).slice(0, 6),
    riskDoctors: doctores.slice(0, 8),
  };
}

/* ---------- Detalle de un gráfico del tablero ----------
   Devuelve los registros exactos detrás de una barra, columna, fila o
   KPI del tablero de doctores, con los mismos filtros, para poder
   comprobar el número del gráfico. "grafico" dice qué se pidió y
   "clave" qué elemento (un área, un mes, una pregunta, etc.). */
function detalleTablero(filtros = {}, grafico = "", clave = "") {
  const ctx = contexto(filtros);
  const { encuestas, todas, resumenDe, enviada, lista, contestadas, resumenesLista, respuestas, calificadas } = ctx;

  /* Cierre por encuesta y período, para el estado de cada envío */
  const cierres = new Map();
  const cierre = (i) => {
    const k = `${i.surveyId}|${i.period}`;
    if (!cierres.has(k)) cierres.set(k, cierreDe(encuestas.get(i.surveyId), db.instancias.listar(i.surveyId).filter((x) => x.period === i.period)));
    return cierres.get(k);
  };

  const fichaEnvio = (i) => {
    const r = respondida(i) ? resumenDe(i) : null;
    return {
      instanceId: i.id,
      surveyName: (encuestas.get(i.surveyId) || {}).name || "",
      doctor: i.doctor,
      doctorId: idDoctor(i.doctor),
      clinic: i.clinic || "",
      periodLabel: i.periodLabel || i.period,
      sentAt: aISO(i.sentAt),
      openedAt: aISO(i.openedAt),
      answeredAt: aISO(i.finishedAt),
      whatsapp: i.waStatus === "error" ? "Error" : enviada(i) ? "Enviado" : "—",
      status: estadoEncuesta(i, cierre(i)).texto,
      answered: Boolean(r),
      type: r ? r.type : "",
      average: r ? r.average : null,
      attention: r ? r.attention : 0,
    };
  };
  const fichaResumen = (r) => fichaEnvio(db.instancias.obtener(r.instanceId));

  /* Cada calificación sabe de qué respuesta salió */
  const origen = new Map();
  resumenesLista.forEach((r) => r.answers.forEach((a) => origen.set(a.answerId, r)));
  const fichaNota = (a) => {
    const r = origen.get(a.answerId) || {};
    return {
      instanceId: r.instanceId,
      doctor: r.doctor,
      doctorId: r.doctorId,
      periodLabel: r.periodLabel,
      surveyName: r.surveyName,
      question: a.question,
      area: a.area || "Sin área",
      level: a.level,
      orders: a.orders.map((o) => o.code),
      advisors: a.advisors,
      score: a.score,
      reasons: a.reasons,
      comment: a.comment || a.textAnswer,
    };
  };

  let tipo = "envios";
  let filas = [];
  const ok = (x) => x;
  switch (grafico) {
    case "enviadas": filas = lista.filter(enviada).map(fichaEnvio); break;
    case "respondidas": filas = contestadas.map(fichaEnvio); break;
    case "promedio": filas = resumenesLista.filter((r) => r.average !== null).map(fichaResumen); break;
    case "atencion": filas = resumenesLista.filter((r) => r.attention > 0).map(fichaResumen); break;
    case "wa-error": filas = lista.filter((i) => i.waStatus === "error").map(fichaEnvio); break;
    case "vencidas": filas = lista.filter((i) => !respondida(i) && String(i.state).startsWith("Cerrada")).map(fichaEnvio); break;
    case "periodo": filas = todas.filter((i) => (i.period || "-") === clave && enviada(i)).map(fichaEnvio); break;
    case "embudo": {
      const pasos = {
        generated: () => true,
        sent: enviada,
        delivered: (i) => enviada(i) && i.waStatus !== "error",
        opened: (i) => i.openedAt || respondida(i) || PENDIENTES.includes(i.state),
        answered: respondida,
      };
      filas = lista.filter(pasos[clave] || ok).map(fichaEnvio);
      break;
    }
    case "tipo": filas = resumenesLista.filter((r) => r.type === clave).map(fichaResumen); break;
    case "doctor": filas = resumenesLista.filter((r) => r.doctorKey === clave && r.average !== null).map(fichaResumen); break;
    default: {
      tipo = "notas";
      const elegir = {
        estrellas: () => calificadas.filter((a) => a.score === Number(clave)),
        bajas: () => calificadas.filter((a) => a.score <= 3),
        area: () => calificadas.filter((a) => (a.area || "Sin área") === clave),
        pregunta: () => calificadas.filter((a) => a.question === clave),
        asesora: () => calificadas.filter((a) => a.level !== "general" && (a.advisors || []).includes(clave)),
        motivo: () => respuestas.filter((a) => a.belowThreshold && (a.reasons || []).includes(clave)),
      }[grafico];
      filas = elegir ? elegir().map(fichaNota) : [];
    }
  }

  const notas = tipo === "notas" ? filas.map((f) => f.score).filter(Boolean) : filas.map((f) => f.average).filter((v) => v !== null && v !== undefined);
  return {
    kind: tipo,
    total: filas.length,
    answered: tipo === "envios" ? filas.filter((f) => f.answered).length : filas.length,
    average: redondo(promedio(notas)),
    low: tipo === "notas" ? filas.filter((f) => f.score && f.score <= 3).length : filas.reduce((t, f) => t + (f.attention ? 1 : 0), 0),
    doctors: new Set(filas.map((f) => limpiarDoctor(f.doctor || ""))).size,
    rows: filas,
  };
}

module.exports = { envios, respuestas, respuesta, historico, tablero, detalleTablero, idDoctor, limpiarDoctor };
