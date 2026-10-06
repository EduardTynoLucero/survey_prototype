/* ---------------------------------------------------------------
   Resultados de las encuestas a doctores (externas).
   Igual que en el sistema: un renglón por encuesta enviada (encuesta +
   período) y, al abrirlo, el detalle al estilo de las respuestas de un
   formulario (Resumen · Pregunta · Individual · Doctores).
   --------------------------------------------------------------- */
const db = require("./db");
const catalogo = require("./catalogo");
const agenda = require("./agenda");

const pad = (n) => String(n).padStart(2, "0");
const isoDe = (d) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;

/* Las fechas del motor vienen de toLocaleString("es-GT"): "30/9/2026, 11:58:03".
   Se pasan a "2026-09-30 11:58:03" para mostrarlas como en el sistema. */
function aISO(valor) {
  if (!valor) return "";
  const texto = String(valor).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(texto)) return texto.replace("T", " ").slice(0, 19);
  const m = texto.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4}),?\s*(\d{1,2})?:?(\d{2})?:?(\d{2})?/);
  if (!m) return "";
  return `${m[3]}-${pad(m[2])}-${pad(m[1])} ${pad(m[4] || 0)}:${pad(m[5] || 0)}:${pad(m[6] || 0)}`;
}

const ESTADOS = {
  Generada: "GENERATED",
  Enviada: "SENT",
  "Envío fallido": "SEND_FAILED",
  Abierta: "OPENED",
  Parcial: "PARTIAL",
  Completada: "COMPLETED",
  "Cerrada parcial": "CLOSED_PARTIAL",
  "Cerrada sin respuesta": "CLOSED_NO_RESPONSE",
};
const estadoDe = (instancia) => ESTADOS[instancia.state] || "GENERATED";
const respondida = (instancia) => Array.isArray(instancia.answers) && instancia.answers.length > 0;

const TIPOS = { stars: "STARS", single: "SINGLE", multiple: "MULTIPLE", short: "SHORT", paragraph: "PARAGRAPH" };
const NIVELES = { general: "GENERAL", group: "GROUP", work: "WORK" };

/* Doctor con su prefijo, como en el sistema: "DR. ALAN ANTILLON" */
function partirDoctor(nombre) {
  const texto = String(nombre || "").trim();
  const m = texto.match(/^(dra?\.?)\s+(.*)$/i);
  /* Sin prefijo en el catálogo: "DR.", como lo muestra el sistema */
  if (!m) return { doctorPrefix: "DR.", doctorName: texto.toUpperCase() };
  return { doctorPrefix: m[1].toUpperCase().replace(/\.?$/, "."), doctorName: m[2].toUpperCase() };
}

/* Fecha de cierre del período: el día de cierre de la programación,
   contado desde que se generó (si el día ya pasó, cae en el mes siguiente). */
function cierreDe(encuesta, lista) {
  const prog = encuesta.schedule || {};
  const d = agenda.derivar(encuesta);
  const generada = aISO((lista[0] || {}).generatedAt || (lista[0] || {}).sentAt);
  const base = generada ? new Date(generada.replace(" ", "T")) : null;
  const [hh, mm] = String(d.hasta || "23:59").split(":").map(Number);

  if (!d.repite && d.fin) return isoDe(new Date(d.fin.getFullYear(), d.fin.getMonth(), d.fin.getDate(), hh, mm));
  if (!base || Number.isNaN(base.getTime())) return "";
  const dia = Number(prog.closeDay) || base.getDate();
  let cierre = new Date(base.getFullYear(), base.getMonth(), dia, hh, mm);
  if (cierre < base) cierre = new Date(base.getFullYear(), base.getMonth() + 1, dia, hh, mm);
  return isoDe(cierre);
}

const promedio = (notas) => (notas.length ? notas.reduce((a, b) => a + b, 0) / notas.length : null);
const redondo = (v) => (v === null || v === undefined ? null : Number(Number(v).toFixed(2)));

/* Un renglón por encuesta enviada: encuesta externa + período */
function grupos() {
  const salida = [];
  db.encuestas
    .listar()
    .filter((encuesta) => encuesta.classification === "Externa")
    .forEach((encuesta) => {
      const porPeriodo = new Map();
      db.instancias.listar(encuesta.id).forEach((instancia) => {
        const clave = instancia.period || encuesta.period || "-";
        if (!porPeriodo.has(clave)) porPeriodo.set(clave, []);
        porPeriodo.get(clave).push(instancia);
      });
      porPeriodo.forEach((lista, period) => salida.push({ encuesta, period, lista }));
    });
  return salida;
}

const idDe = (encuesta, period) => `${encuesta.id}~${period}`;

function resumen({ encuesta, period, lista }) {
  const completas = lista.filter(respondida);
  const notas = completas.flatMap((i) => i.answers.filter((r) => Number(r.calificacion) > 0).map((r) => Number(r.calificacion)));
  const porDoctor = completas
    .map((i) => promedio(i.answers.filter((r) => Number(r.calificacion) > 0).map((r) => Number(r.calificacion))))
    .filter((v) => v !== null);
  const enviadas = lista.filter((i) => i.sentAt || i.state !== "Generada").length;
  const cierre = cierreDe(encuesta, lista);
  const abiertas = lista.some((i) => ["Generada", "Enviada", "Abierta", "Parcial"].includes(i.state));
  const vencida = cierre && new Date(cierre.replace(" ", "T")) < new Date();
  const fechas = lista.map((i) => aISO(i.sentAt || i.generatedAt)).filter(Boolean).sort();

  return {
    doctorSurveyPeriodId: idDe(encuesta, period),
    doctorSurveyId: encuesta.id,
    surveyName: encuesta.name,
    period,
    periodLabel: (lista[0] && lista[0].periodLabel) || encuesta.periodLabel || period,
    generatedAt: fechas[0] || "",
    availableTo: cierre,
    instancesCount: lista.length,
    sentCount: enviadas || lista.length,
    completedCount: completas.length,
    averageScore: porDoctor.length ? redondo(promedio(porDoctor)) : notas.length ? redondo(promedio(notas)) : null,
    status: !abiertas || vencida ? "CLOSED" : "OPEN",
  };
}

function periodos() {
  return grupos()
    .map(resumen)
    .sort((a, b) => String(b.generatedAt).localeCompare(String(a.generatedAt)) || String(b.period).localeCompare(String(a.period)));
}

/* Busca la pregunta de una respuesta: por id, o por el texto si es una respuesta vieja */
function preguntaDe(encuesta, respuesta) {
  for (const seccion of encuesta.sections || []) {
    for (const pregunta of seccion.questions || []) {
      if (respuesta.questionId ? pregunta.id === respuesta.questionId : pregunta.text === respuesta.pregunta) {
        return { seccion, pregunta };
      }
    }
  }
  return { seccion: null, pregunta: null };
}

/* Respuestas "planas", una fila por pregunta contestada (y por orden o grupo) */
function filas(encuesta, lista, libre = false) {
  const trabajos = new Map(require("./datosPrueba").todosLosTrabajos().map((t) => [t.id, t]));
  const salida = [];

  lista.filter(respondida).forEach((instancia) => {
    const doctor = libre ? { doctorName: instancia.doctor } : partirDoctor(instancia.doctor);
    instancia.answers.forEach((r, indice) => {
      const { seccion, pregunta } = preguntaDe(encuesta, r);
      const tipo = TIPOS[(pregunta && pregunta.type) || r.tipo] || (Number(r.calificacion) > 0 ? "STARS" : "SHORT");
      const umbral = Number((pregunta && pregunta.lowThreshold) || 4);
      const nota = Number(r.calificacion) || null;
      const baja = Boolean(nota && nota < umbral);
      const nivel = NIVELES[r.nivelDetalle] || (r.nivel === "GENERAL" ? "GENERAL" : (r.trabajos || []).length > 1 ? "GROUP" : "WORK");
      const ordenes = (r.ordenes && r.ordenes.length ? r.ordenes : r.trabajos) || [];
      const motivos = r.motivos || [];
      const valores = Array.isArray(r.valores) ? r.valores : String(r.valor || "").split(", ").filter(Boolean);
      const eleccion = tipo === "SINGLE" || tipo === "MULTIPLE";

      salida.push({
        doctorSurveyAnswerId: `${instancia.id}-${indice}`,
        doctorSurveyInstanceId: instancia.id,
        doctorSurveyId: encuesta.id,
        surveyName: encuesta.name,
        periodLabel: instancia.periodLabel,
        doctorName: doctor.doctorName,
        questionId: pregunta ? pregunta.id : null,
        questionText: r.pregunta || (pregunta && pregunta.text) || "",
        questionType: tipo,
        sectionId: seccion ? seccion.id : null,
        sectionTitle: seccion ? seccion.title : r.categoria || "",
        areaName: String(r.area || (pregunta && pregunta.area) || "").toUpperCase(),
        score: nota,
        isLowScore: baja,
        answerLevel: nivel,
        workCodes: ordenes.map((id) => (trabajos.get(id) || {}).code || id),
        advisors: (r.asesoras || []).filter(Boolean).map((a) => String(a).toUpperCase()),
        choiceOptions: eleccion ? valores : [],
        textValue: eleccion || tipo === "STARS" ? "" : String(r.valor || ""),
        improvementOptions: baja ? motivos : [],
        valueOptions: baja ? [] : motivos,
        comment: r.comentario || "",
        evidenceCount: Number(r.evidencias || 0),
        answeredAt: aISO(r.fecha) || aISO(instancia.finishedAt),
      });
    });
  });
  return salida;
}

/* La encuesta como se configuró en el editor */
function definicion(encuesta) {
  return (encuesta.sections || [])
    .filter((s) => s.active !== false)
    .map((seccion) => ({
      doctorSurveySectionId: seccion.id,
      title: seccion.title,
      description: seccion.description || "",
      useWorks: Boolean(seccion.useWorks && encuesta.works && encuesta.works.enabled),
      questions: (seccion.questions || []).map((q) => ({
        doctorSurveyQuestionId: q.id,
        questionText: q.text,
        helpText: q.help || "",
        questionType: TIPOS[q.type] || "STARS",
        responsibleAreaName: String(q.area || "").toUpperCase(),
        isRequired: Boolean(q.required),
        isActive: q.active !== false,
        lowPrompt: q.lowPrompt || "",
        highPrompt: q.highPrompt || "",
        allowEvidence: false,
        choiceOptions: ["single", "multiple"].includes(q.type) ? q.options || [] : [],
        improvementOptions: q.type === "stars" ? q.improvementOptions || [] : [],
        valueOptions: q.type === "stars" ? q.valueOptions || [] : [],
      })),
    }));
}

/* Promedio y motivos por área responsable */
function porArea(rows) {
  const mapa = new Map();
  rows.filter((r) => r.score).forEach((r) => {
    const clave = r.areaName || "SIN ÁREA";
    if (!mapa.has(clave)) mapa.set(clave, { areaName: clave, notas: [], bajas: 0, motivos: new Map() });
    const a = mapa.get(clave);
    a.notas.push(r.score);
    if (r.isLowScore) a.bajas += 1;
    r.improvementOptions.forEach((m) => a.motivos.set(m, (a.motivos.get(m) || 0) + 1));
  });
  return [...mapa.values()]
    .map((a) => ({
      areaId: a.areaName,
      areaName: a.areaName,
      averageScore: redondo(promedio(a.notas)),
      ratings: a.notas.length,
      lowCount: a.bajas,
      topImprovements: [...a.motivos.entries()]
        .map(([label, total]) => ({ label, total }))
        .sort((x, y) => y.total - x.total)
        .slice(0, 3),
    }))
    .sort((x, y) => x.areaName.localeCompare(y.areaName, "es"));
}

/* Asesoras: solo respuestas ligadas a órdenes */
function porAsesora(rows) {
  const mapa = new Map();
  rows.filter((r) => r.score && r.answerLevel !== "GENERAL" && r.advisors.length).forEach((r) => {
    r.advisors.forEach((nombre) => {
      if (!mapa.has(nombre)) mapa.set(nombre, { employeeId: nombre, name: nombre, notas: [], ordenes: new Set() });
      const a = mapa.get(nombre);
      a.notas.push(r.score);
      r.workCodes.forEach((c) => a.ordenes.add(`${r.doctorSurveyInstanceId}:${c}`));
    });
  });
  return [...mapa.values()]
    .map((a) => ({ employeeId: a.employeeId, name: a.name, averageScore: redondo(promedio(a.notas)), ratings: a.notas.length, works: a.ordenes.size }))
    .sort((x, y) => x.name.localeCompare(y.name, "es"));
}

function detalle(id) {
  const grupo = grupos().find((g) => idDe(g.encuesta, g.period) === id);
  if (!grupo) return null;
  return armar(grupo);
}

/* Formulario libre: todas sus respuestas juntas, sin períodos ni doctores */
function detalleLibre(encuesta) {
  const lista = db.instancias.listar(encuesta.id);
  const salida = armar({ encuesta, period: "libre", lista }, true);
  const abierto = disponible(encuesta);
  const prog = encuesta.schedule || {};
  salida.period.periodLabel = "Formulario libre";
  salida.period.availableTo = prog.endDate ? `${prog.endDate} ${String(prog.endTime || "23:59").slice(0, 5)}:00` : "";
  salida.period.status = abierto.ok ? "OPEN" : "CLOSED";
  salida.period.sentCount = salida.period.completedCount;
  salida.totals.sent = salida.totals.completed;
  return salida;
}

/* ¿Se puede llenar ahora? Activa y dentro de la ventana de disponibilidad */
function disponible(encuesta) {
  if (!encuesta || encuesta.status !== "Activa") return { ok: false, motivo: "El formulario no está activo." };
  const prog = encuesta.schedule || {};
  const ahora = new Date();
  const momento = (fecha, horaTxt) => (fecha ? new Date(`${fecha}T${String(horaTxt || "00:00").slice(0, 5)}:00`) : null);
  const inicio = momento(prog.startDate, prog.startTime || "00:00");
  const fin = momento(prog.endDate, prog.endTime || "23:59");
  if (inicio && ahora < inicio) return { ok: false, motivo: "El formulario todavía no está disponible." };
  if (fin && ahora > fin) return { ok: false, motivo: "El formulario ya no recibe respuestas." };
  return { ok: true, motivo: "" };
}

function armar(grupo, libre = false) {
  const { encuesta, lista } = grupo;
  const periodo = resumen(grupo);
  const rows = filas(encuesta, lista, libre);

  const instances = lista.map((instancia) => {
    const doctor = libre ? { doctorPrefix: "", doctorName: instancia.doctor } : partirDoctor(instancia.doctor);
    const notas = respondida(instancia) ? instancia.answers.filter((r) => Number(r.calificacion) > 0).map((r) => Number(r.calificacion)) : [];
    return {
      doctorSurveyInstanceId: instancia.id,
      doctorPrefix: doctor.doctorPrefix,
      doctorName: doctor.doctorName,
      clinicNames: instancia.clinic || "",
      worksCount: (instancia.workIds || []).length,
      sentAt: aISO(instancia.sentAt),
      finishedAt: aISO(instancia.finishedAt),
      averageScore: notas.length ? redondo(promedio(notas)) : null,
      status: estadoDe(instancia),
    };
  });

  return {
    period: periodo,
    survey: { doctorSurveyId: encuesta.id, name: encuesta.name, description: encuesta.description || "" },
    sections: definicion(encuesta),
    totals: {
      instances: periodo.instancesCount,
      sent: periodo.sentCount,
      completed: periodo.completedCount,
      averageScore: periodo.averageScore,
    },
    areas: porArea(rows),
    advisors: porAsesora(rows),
    instances,
    rows,
    truncated: false,
  };
}

module.exports = { periodos, detalle, detalleLibre, disponible, aISO, cierreDe, partirDoctor, preguntaDe };
