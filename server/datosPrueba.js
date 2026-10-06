/* ---------------------------------------------------------------
   Datos de prueba para dimensionar el seguimiento de encuestas
   a doctores: una encuesta externa con seis meses de envíos y
   respuestas (General / Individual / Mixta), estados variados,
   errores de WhatsApp, recordatorios, notas bajas y comentarios.

   - Todo sale de un dado con semilla fija: cada carga da los mismos
     doctores, órdenes y respuestas.
   - Las órdenes de prueba no entran a la lista de trabajos; solo se
     usan para armar el detalle de cada respuesta.
   - La encuesta queda Inactiva para que la agenda no le mande
     WhatsApp ni recordatorios reales a nadie.
   --------------------------------------------------------------- */
const db = require("./db");
const catalogo = require("./catalogo");

const ENCUESTA_ID = "ext-prueba-doctores";
const MESES = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
const CANTIDAD_MESES = 6;
const DOCTORES = 44;
const DIA_ENVIO = 1;
const DIA_CIERRE = 15;

/* Dado con semilla fija (xorshift) */
function dado(semilla) {
  let x = semilla | 0 || 1;
  const azar = () => {
    x ^= x << 13; x |= 0;
    x ^= x >>> 17;
    x ^= x << 5; x |= 0;
    return (x >>> 0) / 4294967296;
  };
  azar.entero = (tope) => Math.floor(azar() * tope);
  azar.uno = (lista) => lista[Math.floor(azar() * lista.length)];
  azar.varios = (lista, n) => {
    const copia = lista.slice();
    const salida = [];
    while (copia.length && salida.length < n) salida.push(copia.splice(Math.floor(azar() * copia.length), 1)[0]);
    return salida;
  };
  return azar;
}

const dos = (n) => String(n).padStart(2, "0");
/* Mismo formato que operaciones.ahora(): "6/10/2026, 17:07:39" */
const fechaTexto = (d) => `${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()}, ${dos(d.getHours())}:${dos(d.getMinutes())}:${dos(d.getSeconds())}`;
const fechaCorta = (d) => `${dos(d.getDate())}/${dos(d.getMonth() + 1)}/${d.getFullYear()}`;
const isoDia = (d) => `${d.getFullYear()}-${dos(d.getMonth() + 1)}-${dos(d.getDate())}`;
const masHoras = (d, horas) => new Date(d.getTime() + horas * 3600000);

function enHorario(d, azar) {
  if (d.getHours() >= 7 && d.getHours() < 20) return d;
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 8 + Math.floor(azar() * 11), Math.floor(azar() * 60), Math.floor(azar() * 60));
}

/* Los últimos seis meses evaluados, del más viejo al actual */
function periodos() {
  const lista = [];
  for (let atras = CANTIDAD_MESES - 1; atras >= 0; atras -= 1) {
    const inicio = new Date(catalogo.PERIODO.anio, catalogo.PERIODO.mes - 1 - atras, 1);
    const fin = new Date(inicio.getFullYear(), inicio.getMonth() + 1, 0);
    lista.push({
      clave: `${inicio.getFullYear()}-${dos(inicio.getMonth() + 1)}`,
      etiqueta: `${MESES[inicio.getMonth()]} ${inicio.getFullYear()}`,
      inicio,
      fin,
      envio: new Date(inicio.getFullYear(), inicio.getMonth() + 1, DIA_ENVIO, 7, 0, 0),
      cierre: new Date(inicio.getFullYear(), inicio.getMonth() + 1, DIA_CIERRE, 23, 59, 0),
    });
  }
  return lista;
}

/* Doctores reales del catálogo, cada uno con su clínica */
function cartera() {
  const vistos = new Map();
  catalogo.TRABAJOS.forEach((t) => {
    if (t.doctor && !vistos.has(t.doctor)) vistos.set(t.doctor, t);
  });
  const azar = dado(4401);
  return azar.varios([...vistos.values()], DOCTORES).map((t, i) => ({
    doctor: t.doctor,
    clinic: t.clinic,
    /* Cómo suele calificar: la mayoría contentos, algunos exigentes y
       unos pocos con problemas recurrentes */
    base: i % 7 === 0 ? 3.1 : i % 3 === 0 ? 4.1 : 4.75,
    /* Qué tan seguido manda trabajos */
    frecuencia: i % 5 === 0 ? 0.55 : 0.9,
  }));
}

const PACIENTES = ["María López", "José García", "Ana Morales", "Carlos Hernández", "Luisa Pérez", "Jorge Ramírez", "Silvia Castillo", "Mario Vásquez", "Gabriela Marroquín", "Eduardo De León", "Claudia Guerra", "Fernando Oliva", "Patricia Molina", "Rodrigo Navas", "Sandra Sosa", "Óscar Mendoza", "Verónica Paz", "Alejandro Rosales", "Karla Escobar", "Hugo Urrutia", "Rosa Quevedo", "Diego Archila", "Lorena Madrid", "Pablo Centeno"];
const ASESORAS = ["Andrea López", "María Fernanda Soto", "Karla Ruiz", "Mónica Alvarado", "Silvia Recinos"];

/* Órdenes de prueba: copia de una orden real con datos propios */
let cacheTrabajos = null;
function trabajosDePrueba() {
  if (cacheTrabajos) return cacheTrabajos;
  const azar = dado(9026);
  const plantillas = catalogo.TRABAJOS.filter((t) => t.status === "enviado" && t.products && t.phases);
  const lista = [];
  const porDoctor = new Map();
  const doctores = cartera();

  periodos().forEach((p) => {
    let correlativo = 7000;
    doctores.forEach((d) => {
      if (azar() > d.frecuencia) return;
      /* De 1 a 9 trabajos, casi siempre entre 2 y 6 */
      const cantidad = 1 + Math.min(8, azar.entero(4) + azar.entero(4));
      const ids = [];
      for (let k = 0; k < cantidad; k += 1) {
        const plantilla = azar.uno(plantillas);
        const dia = 1 + azar.entero(p.fin.getDate());
        const enviado = new Date(p.inicio.getFullYear(), p.inicio.getMonth(), dia);
        const code = `${p.clave.replace("-", "")}${correlativo++}`;
        lista.push(Object.assign({}, plantilla, {
          id: code,
          code,
          box: String(1 + azar.entero(540)),
          clinic: d.clinic,
          doctor: d.doctor,
          patient: azar.uno(PACIENTES),
          status: "enviado",
          advisor: azar.uno(ASESORAS),
          sent: fechaCorta(enviado),
          albaranAt: fechaCorta(enviado),
          period: p.clave,
          doctorPhone: catalogo.telefonoDoctor(d.doctor),
          datosPrueba: true,
        }));
        ids.push(code);
      }
      porDoctor.set(`${p.clave}|${d.doctor}`, ids);
    });
  });
  cacheTrabajos = { lista, porDoctor, doctores };
  return cacheTrabajos;
}

/* Catálogo + órdenes de prueba, para buscar una orden por id */
function todosLosTrabajos() {
  return catalogo.TRABAJOS.concat(trabajosDePrueba().lista);
}

/* ---------- Encuesta ---------- */
function encuesta() {
  const ps = periodos();
  const actual = ps[ps.length - 1];
  const pregunta = (extra) => catalogo.pregunta(Object.assign({ required: false }, extra));
  return catalogo.nuevaEncuesta("Externa", {
    id: ENCUESTA_ID,
    name: "Satisfacción de doctores (datos de prueba)",
    description: "Seis meses de envíos y respuestas inventadas para revisar el seguimiento con volumen real. Se puede borrar con \"Quitar datos de prueba\".",
    status: "Inactiva",
    datosPrueba: true,
    period: actual.clave,
    periodLabel: actual.etiqueta,
    periodFrom: isoDia(actual.inicio),
    periodTo: isoDia(actual.fin),
    reminders: {
      active: false,
      everyDays: 3,
      time: "09:00",
      max: 2,
      message: "Hola {{doctor}}, le recordamos que su encuesta de {{periodo}} sigue abierta. Solo le toma un minuto:",
      lastMark: "",
    },
    schedule: {
      active: true,
      repeat: "Mensual",
      generationDay: DIA_ENVIO,
      closeDay: DIA_CIERRE,
      startDate: isoDia(ps[0].envio),
      startTime: "07:00",
      endDate: isoDia(new Date(actual.envio.getFullYear() + 1, actual.envio.getMonth(), 0)),
      endTime: "23:59",
      time: "07:00",
      lastRun: fechaTexto(actual.envio),
      nextRun: "",
      firstRun: "",
    },
    works: { enabled: true, source: "Mes calendario anterior por doctor", statuses: ["enviado"], selectedIds: [] },
    sections: [
      catalogo.seccion({
        id: "sec-prueba-servicio",
        title: "ATENCIÓN Y SERVICIO",
        description: "Opinión general del doctor sobre el servicio del mes.",
        next: "continue",
        questions: [
          pregunta({ id: "q-prueba-asesora", text: "¿Cómo califica la atención de su asesora?", area: "Servicio al Cliente" }),
          pregunta({ id: "q-prueba-logistica", text: "¿Qué tan fácil fue coordinar recolecciones y entregas?", area: "Mensajería" }),
          pregunta({ id: "q-prueba-canal", text: "¿Por qué medio prefiere que le contactemos?", type: "single", options: ["WhatsApp", "Llamada", "Correo"] }),
        ],
      }),
      catalogo.seccion({
        id: "sec-prueba-trabajos",
        title: "CALIDAD DE LOS TRABAJOS",
        description: "Evalúe los trabajos del período: todos juntos, uno por uno o una combinación.",
        useWorks: true,
        allowedModes: ["general", "mixed", "individual"],
        next: "submit",
        questions: [
          pregunta({ id: "q-prueba-ajuste", text: "¿Cómo evalúa el ajuste y la calidad del trabajo?", area: "Control de Calidad", required: true, workMode: "inherit" }),
          pregunta({ id: "q-prueba-entrega", text: "¿Cómo evalúa el tiempo de entrega?", area: "Control de Producción", required: true, workMode: "inherit" }),
          pregunta({ id: "q-prueba-comentarios", text: "Comentarios adicionales", type: "paragraph", area: "Servicio al Cliente" }),
        ],
      }),
    ],
    seedVersion: 0,
  });
}

/* ---------- Respuestas ---------- */
const BAJOS = {
  "q-prueba-asesora": ["No me devolvieron la llamada cuando pregunté por el caso.", "La asesora no me avisó del retraso.", "Tuve que escribir varias veces para tener respuesta."],
  "q-prueba-logistica": ["El mensajero llegó fuera del horario acordado.", "No pasaron a recoger el modelo el día programado.", "La entrega llegó a la sucursal equivocada."],
  "q-prueba-ajuste": ["El color no coincidió con la guía enviada.", "Hubo que ajustar el contacto proximal en boca.", "La corona llegó con el margen abierto.", "Tuvimos que repetir la prueba de metal."],
  "q-prueba-entrega": ["Llegó dos días después de lo prometido.", "El paciente tuvo que reagendar por el atraso.", "No nos avisaron que la fecha cambió."],
};
/* Lo que más se marca en cada pregunta cuando la nota es baja */
const MOTIVO_PRINCIPAL = { "q-prueba-asesora": "Comunicación", "q-prueba-logistica": "Tiempo", "q-prueba-ajuste": "Resultado", "q-prueba-entrega": "Tiempo" };
const ALTOS = ["Excelente trabajo, el paciente quedó muy contento.", "Muy buen ajuste, no hubo que retocar nada.", "Siempre puntuales, gracias.", "La asesora estuvo pendiente de todo el proceso."];
const GENERALES_BUENOS = ["Todo bien, gracias.", "Muy contento con el servicio de este mes.", "Sigan así, el laboratorio ha mejorado mucho."];
const GENERALES_MALOS = ["Este mes hubo varios retrasos, espero que mejore.", "Necesito que me confirmen las fechas de entrega por WhatsApp.", "Me gustaría que revisaran el color antes de enviar."];

function armarRespuestas(azar, enc, doctor, workIds, terminada) {
  const [servicio, trabajos] = enc.sections;
  const porId = new Map(trabajosDePrueba().lista.map((t) => [t.id, t]));
  const asesorasDe = (ids) => [...new Set(ids.map((id) => (porId.get(id) || {}).advisor).filter(Boolean))];
  const fecha = terminada.toISOString();
  const nota = (q, ajuste = 0) => Math.max(1, Math.min(5, Math.round(doctor.base + ajuste + (azar() + azar() - 1) * 1.05)));
  const salida = [];

  const estrellas = (seccion, q, ajuste, nivelDetalle, ids) => {
    const calificacion = nota(q, ajuste);
    const baja = calificacion < q.lowThreshold;
    const motivos = baja
      ? [...new Set([azar() < 0.7 ? MOTIVO_PRINCIPAL[q.id] || "Proceso" : azar.uno(q.improvementOptions.slice(0, 4)), ...(azar() < 0.35 ? [azar.uno(q.improvementOptions.slice(0, 4))] : [])])]
      : calificacion >= 4 && azar() < 0.35 ? azar.varios(q.valueOptions.slice(0, 4), 1) : [];
    const comentario = baja
      ? (azar() < 0.8 ? azar.uno(BAJOS[q.id] || BAJOS["q-prueba-ajuste"]) : "")
      : calificacion === 5 && azar() < 0.06 ? azar.uno(ALTOS) : "";
    const general = nivelDetalle === "general";
    salida.push({
      questionId: q.id,
      sectionId: seccion.id,
      categoria: seccion.title,
      tipo: "stars",
      pregunta: q.text,
      area: q.area,
      calificacion,
      valor: "",
      nivel: general ? "GENERAL" : "ESPECÍFICA",
      nivelDetalle,
      ordenes: seccion.useWorks ? ids : [],
      valores: [],
      trabajos: general ? [] : ids,
      asesoras: general ? [] : asesorasDe(ids),
      motivos,
      comentario,
      fecha,
    });
  };

  const texto = (seccion, q, valor, tipo) => {
    salida.push({
      questionId: q.id, sectionId: seccion.id, categoria: seccion.title, tipo, pregunta: q.text, area: q.area,
      calificacion: null, valor, nivel: "GENERAL", nivelDetalle: "general", ordenes: [],
      valores: tipo === "single" ? [valor] : [], trabajos: [], asesoras: [], motivos: [], comentario: "", fecha,
    });
  };

  /* General: opinión del mes y todos los trabajos con una sola nota.
     Individual: se salta la parte general y evalúa órdenes.
     Mixta: opinión general + órdenes específicas. */
  const r = azar();
  const tipo = workIds.length === 1 ? (r < 0.5 ? "general" : r < 0.75 ? "individual" : "mixta") : r < 0.34 ? "general" : r < 0.62 ? "individual" : "mixta";
  const [asesora, logistica, canal] = servicio.questions;
  const [ajuste, entrega, comentarios] = trabajos.questions;

  if (tipo !== "individual") {
    estrellas(servicio, asesora, 0.2, "general", []);
    estrellas(servicio, logistica, -0.2, "general", []);
    texto(servicio, canal, azar() < 0.7 ? "WhatsApp" : azar.uno(["Llamada", "Correo"]), "single");
  }

  if (tipo === "general") {
    estrellas(trabajos, ajuste, 0, "general", workIds);
    estrellas(trabajos, entrega, -0.3, "general", workIds);
  } else {
    /* Algunos doctores dejan órdenes sin evaluar */
    let ids = workIds.slice();
    if (ids.length > 2 && azar() < 0.25) ids = ids.slice(0, ids.length - 1 - azar.entero(2));
    /* Con varias órdenes, parte va en conjunto y el resto una por una */
    const enConjunto = ids.length >= 3 && azar() < 0.6 ? ids.slice(0, 2 + azar.entero(ids.length - 2)) : [];
    const sueltas = ids.filter((id) => !enConjunto.includes(id));
    if (enConjunto.length) {
      estrellas(trabajos, ajuste, 0, "group", enConjunto);
      estrellas(trabajos, entrega, -0.3, "group", enConjunto);
    }
    sueltas.forEach((id) => {
      estrellas(trabajos, ajuste, 0, "work", [id]);
      estrellas(trabajos, entrega, -0.3, "work", [id]);
    });
  }

  if (tipo !== "individual" && azar() < 0.25) {
    texto(trabajos, comentarios, azar.uno(doctor.base < 3.5 ? GENERALES_MALOS : GENERALES_BUENOS), "paragraph");
  }
  return salida;
}

/* ---------- Envíos ---------- */
const ERRORES_WA = ["Número no registrado en WhatsApp", "Número inválido", "El mensaje no se pudo entregar"];

function instancias(enc) {
  const azar = dado(31337);
  const { porDoctor, doctores } = trabajosDePrueba();
  const ps = periodos();
  const ahora = new Date();
  const antesDeAhora = (d) => (d > ahora ? masHoras(ahora, -1 - azar() * 3) : d);
  const lista = [];

  ps.forEach((p, indice) => {
    const actual = indice === ps.length - 1;
    const envio = antesDeAhora(new Date(p.envio.getTime() + azar.entero(40) * 1000));
    let n = 0;

    doctores.forEach((doctor) => {
      const workIds = porDoctor.get(`${p.clave}|${doctor.doctor}`);
      if (!workIds) return;
      n += 1;
      const r = azar();
      const inst = {
        id: `inst-prueba-${p.clave}-${n}`,
        surveyId: enc.id,
        period: p.clave,
        periodLabel: p.etiqueta,
        doctor: doctor.doctor,
        clinic: doctor.clinic,
        doctorPhone: catalogo.telefonoDoctor(doctor.doctor),
        workIds,
        state: "Enviada",
        generatedAt: fechaTexto(envio),
        sentAt: fechaTexto(envio),
        openedAt: "",
        finishedAt: "",
        answers: null,
        reminders: 0,
        lastReminderAt: "",
        waStatus: "ok",
        waStatusError: "",
        datosPrueba: true,
      };

      /* Recordatorios cada tres días a las 9:00, máximo dos, mientras no conteste */
      const recordatorios = (hasta) => {
        let cuenta = 0;
        let ultimo = null;
        for (let k = 1; k <= 2; k += 1) {
          const d = new Date(envio.getFullYear(), envio.getMonth(), envio.getDate() + 3 * k, 9, 0, 0);
          if (d < hasta && d < ahora) { cuenta = k; ultimo = d; }
        }
        inst.reminders = cuenta;
        inst.lastReminderAt = ultimo ? fechaTexto(ultimo) : "";
        if (cuenta) inst.reminderStatus = "ok";
      };

      /* El mes en curso todavía tiene envíos sin contestar; los anteriores ya cerraron */
      const reparto = actual
        ? [["Completada", 0.42], ["Enviada", 0.62], ["Abierta", 0.73], ["Parcial", 0.84], ["error", 0.94], ["Generada", 1]]
        : [["Completada", 0.72], ["Cerrada sin respuesta", 0.87], ["Cerrada parcial", 0.95], ["error", 1]];
      const estado = reparto.find(([, tope]) => r < tope)[0];
      const limite = actual ? ahora : p.cierre;
      /* Los doctores abren la encuesta en horario de clínica */
      const abrio = antesDeAhora(enHorario(masHoras(envio, 1 + azar() * Math.min(240, (limite - envio) / 3600000)), azar));

      if (estado === "Completada") {
        const termino = antesDeAhora(masHoras(abrio, 0.05 + azar() * 0.3));
        inst.state = "Completada";
        inst.openedAt = fechaTexto(abrio);
        inst.finishedAt = fechaTexto(termino);
        inst.answers = armarRespuestas(azar, enc, doctor, workIds, termino);
        recordatorios(abrio);
      } else if (estado === "Generada") {
        Object.assign(inst, { state: "Generada", sentAt: "", waStatus: "" });
      } else if (estado === "error") {
        /* WhatsApp no lo entregó: la encuesta no llega a abrirse */
        inst.waStatus = "error";
        inst.waStatusError = azar.uno(ERRORES_WA);
        inst.state = actual ? "Enviada" : "Cerrada sin respuesta";
      } else {
        inst.state = estado;
        if (["Abierta", "Parcial", "Cerrada parcial"].includes(estado) || (estado === "Cerrada sin respuesta" && azar() < 0.3)) {
          inst.openedAt = fechaTexto(abrio);
        }
        recordatorios(limite);
      }
      lista.push(inst);
    });
  });
  return lista;
}

/* ---------- Cargar / quitar ---------- */
function quitar() {
  const datos = db.cargar();
  const antes = datos.instancias.length;
  datos.encuestas = datos.encuestas.filter((e) => e.id !== ENCUESTA_ID);
  datos.instancias = datos.instancias.filter((i) => i.surveyId !== ENCUESTA_ID);
  db.guardar();
  return { ok: true, quitadas: antes - datos.instancias.length };
}

function cargar() {
  quitar();
  const enc = encuesta();
  const nuevas = instancias(enc);
  const datos = db.cargar();
  datos.encuestas.unshift(enc);
  datos.instancias.push(...nuevas);
  db.guardar();
  return {
    ok: true,
    encuesta: enc.id,
    envios: nuevas.length,
    respondidas: nuevas.filter((i) => i.answers).length,
    doctores: new Set(nuevas.map((i) => i.doctor)).size,
    periodos: periodos().map((p) => p.etiqueta),
  };
}

module.exports = { ENCUESTA_ID, cargar, quitar, todosLosTrabajos };
