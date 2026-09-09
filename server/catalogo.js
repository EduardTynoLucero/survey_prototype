/* ---------------------------------------------------------------
   Catalogo de ordenes de trabajo de muestra y plantillas de encuesta.
   En produccion esto lo entrega el ERP.
   --------------------------------------------------------------- */

const AREAS = [
  "Control de Calidad",
  "Servicio al Cliente",
  "Control de Producción",
  "Mensajería",
  "Recursos Humanos",
  "Administración",
  "Gerencia",
];

const MESES = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];

/* Periodo evaluado por defecto: el mes calendario anterior (RN-ENC-001) */
function mesAnterior(referencia = new Date()) {
  const d = new Date(referencia.getFullYear(), referencia.getMonth() - 1, 1);
  const anio = d.getFullYear();
  const mes = d.getMonth() + 1;
  const ultimoDia = new Date(anio, mes, 0).getDate();
  const mm = String(mes).padStart(2, "0");
  return {
    anio,
    mes,
    clave: `${anio}-${mm}`,
    etiqueta: `${MESES[d.getMonth()]} ${anio}`,
    desde: `${anio}-${mm}-01`,
    hasta: `${anio}-${mm}-${String(ultimoDia).padStart(2, "0")}`,
  };
}

/* "DD/MM/YYYY" -> "YYYY-MM-DD" (así se pueden comparar como texto) */
function aISO(fecha) {
  if (!fecha || !String(fecha).includes("/")) return "";
  const [dia, mes, anio] = String(fecha).split("/");
  return `${anio}-${mes}-${dia}`;
}

function bonita(iso) {
  if (!iso || !iso.includes("-")) return iso || "";
  const [anio, mes, dia] = iso.split("-");
  return `${dia}/${mes}/${anio}`;
}

function enRango(trabajo, desde, hasta) {
  if (!desde && !hasta) return true;
  const fecha = aISO(trabajo.sent);
  if (!fecha) return false;
  if (desde && fecha < desde) return false;
  if (hasta && fecha > hasta) return false;
  return true;
}

/* Con período automático se usa el mes anterior completo.
   En manual manda el rango de fechas que eligió el usuario. */
function aplicarPeriodoAuto(encuesta) {
  if (!encuesta) return encuesta;
  if (encuesta.periodAuto !== false) {
    const p = mesAnterior();
    encuesta.period = p.clave;
    encuesta.periodLabel = p.etiqueta;
    encuesta.periodFrom = p.desde;
    encuesta.periodTo = p.hasta;
  } else {
    encuesta.periodLabel =
      encuesta.periodFrom && encuesta.periodTo
        ? `${bonita(encuesta.periodFrom)} al ${bonita(encuesta.periodTo)}`
        : "Período sin definir";
  }
  return encuesta;
}

const PERIODO = mesAnterior();

/* Las ordenes de muestra se fechan siempre dentro del mes evaluado,
   para que la demo siga teniendo datos sin importar en que mes se abra. */
function fechaDelPeriodo(dia) {
  return `${String(dia).padStart(2, "0")}/${String(PERIODO.mes).padStart(2, "0")}/${PERIODO.anio}`;
}

function trabajo(code, box, clinic, doctor, patient, status, product, advisor, dia) {
  const sent = dia ? fechaDelPeriodo(dia) : "—";
  return {
    id: code,
    code,
    box,
    clinic,
    doctor,
    patient,
    status,
    product,
    advisor,
    sent,
    period: dia ? PERIODO.clave : "",
  };
}

const TRABAJOS = [
  trabajo("15281", "244", "1053 - CLINICAS DENTALES GRUPO DENT", "Dra. IRENE DE LEON", "Gabriela Marroquín", "enviado", "Corona zirconia", "Andrea López", 5),
  trabajo("15292", "244", "1053 - CLINICAS DENTALES GRUPO DENT", "Dra. IRENE DE LEON", "Mario Díaz", "enviado", "Puente zirconia", "Andrea López", 13),
  trabajo("15304", "244", "1053 - CLINICAS DENTALES GRUPO DENT", "Dra. IRENE DE LEON", "Ana Morales", "enviado", "Corona e.max", "María Fernanda Soto", 22),
  trabajo("15318", "244", "1053 - CLINICAS DENTALES GRUPO DENT", "Dra. IRENE DE LEON", "Carlos López", "enviado", "Prótesis fija", "Andrea López", 24),
  trabajo("15330", "244", "1053 - CLINICAS DENTALES GRUPO DENT", "Dra. IRENE DE LEON", "Lucía Paz", "enviado", "Carilla feldespática", "María Fernanda Soto", 26),
  trabajo("202609661", "334", "ZONA DENTAL, S.A.", "ALAN ANTILLON", "INES BEJOT", "enviado", "Corona zirconia", "María Fernanda Soto", 11),
  trabajo("202609494", "149", "CLINICA INTEGRA DENTAL DRA. CARLA CENTENO", "CARLA CENTENO", "RUDY FERNANDO NAVAS", "enviado", "Puente zirconia", "Andrea López", 18),
  trabajo("202609512", "149", "CLINICA INTEGRA DENTAL DRA. CARLA CENTENO", "CARLA CENTENO", "SOFIA GARCIA", "enviado", "Incrustación", "Andrea López", 27),
  trabajo("202609857", "84", "ESPECIALISTAS DENTALES INTERNACIONALES", "ALEJANDRO FLORES", "SILVIA SECAIRAS", "en proceso", "Corona zirconia", "Karla Ruiz", 0),
  trabajo("202609960", "29", "CLINICA DE ODONTOLOGIA COSMETICA Y ORTODONCIA", "ILEM MARIA CARAVIA PORTAL", "ESTUARDO MOLINA", "en laboratorio", "Puente zirconia", "Karla Ruiz", 0),
  trabajo("202609958", "117", "AM RAMOS DENTAL", "MARCELINO RAMOS", "KAREN STEFAN PEÑATE CASTILLO", "en laboratorio", "Corona e.max", "Karla Ruiz", 0),
  trabajo("202609103", "510", "CENTRO CLINICO DENTAL", "ISABELA VILLAGRAN", "ANDERSON PEREZ", "facturado", "Carilla feldespática", "Andrea López", 28),
  trabajo("202609462", "277", "DENTES", "ANAITHE RUIZ", "ARNOLDO PELICO", "en proceso", "Prótesis total", "Karla Ruiz", 0),
];

/* ------------------------------------------------------------------ */

let contador = 0;
function uid(prefijo) {
  contador += 1;
  return `${prefijo}-${Date.now().toString(36)}${contador.toString(36)}`;
}

function pregunta(extra = {}) {
  return Object.assign(
    {
      id: uid("q"),
      text: "Pregunta sin título",
      help: "",
      type: "stars",
      area: "Servicio al Cliente",
      required: true,
      active: true,
      workMode: "none",
      options: ["Opción 1", "Opción 2"],
      lowThreshold: 4,
      lowOptionsRequired: true,
      lowCommentRequired: true,
      linkLowRatingToWorks: false,
      lowPrompt: "¿Qué considera que podemos mejorar?",
      improvementOptions: ["Comunicación", "Tiempo", "Proceso", "Resultado", "Otro"],
      highOptionsOptional: true,
      highCommentOptional: true,
      highPrompt: "¿Qué es lo que más valora de nuestro servicio?",
      valueOptions: ["Rapidez", "Claridad", "Atención", "Resultado", "Otro"],
    },
    extra
  );
}

function seccion(extra = {}) {
  return Object.assign(
    {
      id: uid("sec"),
      title: "Nueva categoría",
      description: "",
      active: true,
      useWorks: false,
      allowedModes: [],
      allowCaseDimensions: false,
      next: "continue",
      questions: [pregunta()],
    },
    extra
  );
}

/* Estructura inicial: todo en blanco para que se arme desde cero */
function seccionesEnBlanco() {
  return [seccion({ next: "submit" })];
}

/* ------------------------------------------------------------------
   Juego de categorías del DERCAS (Calidad, Servicio al Cliente,
   Cumplimiento de tiempos, Entrega y recolección). Hoy NO se precarga:
   las encuestas nacen en blanco. Queda aquí como referencia por si más
   adelante se quiere ofrecer como plantilla.
   ------------------------------------------------------------------ */
function seccionesExternas() {
  return [
    seccion({
      id: "sec-quality",
      title: "Calidad",
      description: "Adaptación, estética, acabado y consistencia de los trabajos.",
      useWorks: true,
      allowedModes: ["general", "mixed", "individual"],
      allowCaseDimensions: false,
      questions: [
        pregunta({
          id: "q-quality",
          area: "Control de Calidad",
          text: "¿Cómo califica la calidad de los trabajos realizados?",
          workMode: "inherit",
          improvementOptions: ["Adaptación", "Contactos", "Oclusión", "Estética", "Color", "Anatomía", "Acabado", "Resistencia", "Otro"],
          valueOptions: ["Adaptación", "Estética", "Color", "Anatomía", "Acabado", "Consistencia", "Otro"],
        }),
      ],
    }),
    seccion({
      id: "sec-service",
      title: "Servicio al Cliente",
      description: "Atención, seguimiento y claridad en la comunicación.",
      useWorks: true,
      allowedModes: ["general", "individual"],
      allowCaseDimensions: false,
      questions: [
        pregunta({
          id: "q-service",
          area: "Servicio al Cliente",
          text: "¿Cómo califica la atención y seguimiento brindado por nuestro equipo de Servicio al Cliente?",
          workMode: "inherit",
          improvementOptions: ["Tiempo de respuesta", "Seguimiento", "Claridad de comunicación", "Resolución", "Atención", "Otro"],
          valueOptions: ["Rapidez", "Seguimiento", "Amabilidad", "Resolución", "Comunicación", "Otro"],
        }),
      ],
    }),
    seccion({
      id: "sec-times",
      title: "Cumplimiento de tiempos",
      description: "Fechas acordadas, avisos y manejo de urgencias.",
      questions: [
        pregunta({
          id: "q-times",
          area: "Control de Producción",
          text: "¿Cómo califica el cumplimiento de los tiempos de entrega acordados?",
          improvementOptions: ["Incumplimiento de fecha", "Tiempo de elaboración", "Manejo de urgencias", "Falta de aviso", "Otro"],
          valueOptions: ["Puntualidad", "Rapidez", "Cumplimiento", "Manejo de urgencias", "Otro"],
        }),
      ],
    }),
    seccion({
      id: "sec-delivery",
      title: "Entrega y recolección",
      description: "Puntualidad, coordinación y atención del mensajero.",
      next: "submit",
      questions: [
        pregunta({
          id: "q-delivery",
          area: "Mensajería",
          text: "¿Cómo califica nuestro servicio de entrega y recolección?",
          improvementOptions: ["Puntualidad", "Coordinación", "Tiempo de recolección", "Tiempo de entrega", "Atención del mensajero", "Otro"],
          valueOptions: ["Puntualidad", "Disponibilidad", "Coordinación", "Atención", "Rapidez", "Otro"],
        }),
      ],
    }),
  ];
}

function seccionesInternas() {
  return [
    seccion({
      id: "sec-leader",
      title: "Liderazgo",
      description: "Apoyo, comunicación y acompañamiento de su jefatura.",
      next: "submit",
      questions: [
        pregunta({
          id: "q-leader-1",
          area: "Recursos Humanos",
          text: "¿Su supervisor brinda apoyo y orientación cuando surgen dudas?",
          improvementOptions: ["Comunicación", "Seguimiento", "Claridad", "Disponibilidad", "Otro"],
          valueOptions: ["Apoyo", "Respeto", "Comunicación", "Confianza", "Otro"],
        }),
        pregunta({
          id: "q-leader-2",
          area: "Recursos Humanos",
          text: "¿Cómo califica la comunicación dentro de su área?",
          improvementOptions: ["Información tardía", "Poca claridad", "Falta de reuniones", "Otro"],
          valueOptions: ["Claridad", "Frecuencia", "Apertura", "Otro"],
        }),
      ],
    }),
  ];
}

function nuevaEncuesta(clasificacion = "Externa", extra = {}) {
  const externa = clasificacion === "Externa";
  return Object.assign(
    {
      id: uid(externa ? "ext" : "int"),
      name: externa ? "Nueva encuesta externa" : "Nueva encuesta interna",
      description: externa
        ? "Encuesta mensual para conocer la experiencia de los doctores con los trabajos enviados durante el período anterior."
        : "Encuesta dirigida a los colaboradores de Digital Labs.",
      classification: clasificacion,
      subtype: externa ? "Servicio y Calidad" : "Liderazgo",
      status: "Borrador",
      respondent: externa ? "Dra. IRENE DE LEON" : "Colaboradores",
      audienceMode: externa ? "Todos los doctores" : "Por área y supervisor",
      audienceAreas: externa ? [] : ["Área de Administración"],
      audienceDoctors: [],
      anonymous: !externa,
      channel: externa ? "API WhatsApp" : "Enlace directo",
      whatsappMessage: externa
        ? "Hola {{doctor}}, durante {{periodo}} trabajamos {{casos}} casos para usted. Queremos conocer su experiencia:"
        : "",
      periodAuto: true,
      periodLabel: PERIODO.etiqueta,
      period: PERIODO.clave,
      periodFrom: PERIODO.desde,
      periodTo: PERIODO.hasta,
      schedule: {
        active: externa,
        repeat: externa ? "Mensual" : "No repetir",
        generationDay: 8,
        time: "07:00",
        closeDay: 11,
        lastRun: "",
        nextRun: "",
      },
      works: {
        enabled: externa,
        source: "Mes calendario anterior por doctor",
        statuses: ["enviado"],
        selectedIds: externa ? ["15281", "15292", "15304", "15318", "15330"] : [],
      },
      sections: seccionesEnBlanco(),
      createdAt: new Date().toISOString(),
    },
    extra
  );
}

function semilla() {
  const externa = nuevaEncuesta("Externa", {
    id: "ext-servicio-calidad",
    name: "Encuesta Externa: Servicio y Calidad - Doctores",
    status: "Activa",
  });

  const areas = [
    "Área de Administración",
    "Área de Control de Producción/PPR",
    "Área de Estructuras 1",
    "Área de Estructuras 2",
    "Área de Mensajería",
    "Área de Servicio al Cliente",
    "RRHH",
  ];

  const internas = areas.map((area, index) =>
    nuevaEncuesta("Interna", {
      id: `int-liderazgo-${index}`,
      name: `Evaluación de Liderazgo: Tu Opinión Cuenta - ${area}`,
      subtype: index === 6 ? "Clima laboral" : "Liderazgo",
      status: "Activa",
      audienceAreas: [area],
    })
  );

  return [externa, ...internas];
}

/* Trabajos elegibles agrupados por doctor (RF-ENC-001).
   Con seleccion manual se limita a los doctores y ordenes elegidos. */
function agruparPorDoctor(estados, rango = {}, filtro = {}) {
  const doctores = filtro.doctores && filtro.doctores.length ? filtro.doctores : null;
  const ordenes = filtro.ordenes && filtro.ordenes.length ? filtro.ordenes : null;
  const mapa = new Map();

  TRABAJOS.filter((t) => estados.includes(t.status))
    .filter((t) => enRango(t, rango.desde, rango.hasta))
    .filter((t) => !doctores || doctores.includes(t.doctor))
    .filter((t) => !ordenes || ordenes.includes(t.id))
    .forEach((t) => {
      if (!mapa.has(t.doctor)) mapa.set(t.doctor, { doctor: t.doctor, clinic: t.clinic, works: [] });
      mapa.get(t.doctor).works.push(t);
    });

  return [...mapa.values()];
}

module.exports = { AREAS, TRABAJOS, PERIODO, uid, pregunta, seccion, nuevaEncuesta, semilla, agruparPorDoctor, mesAnterior, aplicarPeriodoAuto, aISO, bonita, enRango };
