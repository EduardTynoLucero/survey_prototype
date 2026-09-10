/* ---------------------------------------------------------------
   Personal del laboratorio y resultados históricos de encuestas
   internas. En producción esto lo entrega el ERP; aquí es la misma
   estructura para poder ver el módulo completo funcionando.
   --------------------------------------------------------------- */

const AREAS_LAB = [
  "ADMINISTRACION",
  "ATENCION AL CLIENTE",
  "BODEGA Y PROVEEDURIA",
  "CONTABILIDAD",
  "CONTROL DE PRODUCCION",
  "ESTRUCTURAS 1",
  "ESTRUCTURAS 2",
  "ESTRUCTURAS 3",
  "GESTION HUMANA",
  "MANTENIMIENTO",
  "MENSAJERIA",
  "SERVICIO AL CLIENTE",
];

/* Jefe directo de cada área */
const SUPERVISORES = {
  ADMINISTRACION: "JULIO FRANCIS SILVA TUESTA",
  "ATENCION AL CLIENTE": "OSCAR ROSALES",
  "BODEGA Y PROVEEDURIA": "KEYLA HURTADO",
  CONTABILIDAD: "JULIO FRANCIS SILVA TUESTA",
  "CONTROL DE PRODUCCION": "BETZY CAL",
  "ESTRUCTURAS 1": "ANTHONY ALFREDO CASTILLO ASTO",
  "ESTRUCTURAS 2": "JOSE OTONIEL BATZIBAL MERCAR",
  "ESTRUCTURAS 3": "ANTHONY ALFREDO CASTILLO ASTO",
  "GESTION HUMANA": "KEYLA HURTADO",
  MANTENIMIENTO: "JULIO FRANCIS SILVA TUESTA",
  MENSAJERIA: "KEVIN ALMAZAN",
  "SERVICIO AL CLIENTE": "OSCAR ROSALES",
};

/* Jerarquía organizacional: el selector de área del sistema muestra
   "Sub Area - " repetido según la profundidad. */
const ARBOL_AREAS = {
  "GERENCIA GENERAL": ["ADMINISTRACION", "CONTROL DE PRODUCCION", "ESTRUCTURAS 1", "ESTRUCTURAS 2", "GERENCIA COMERCIAL", "GESTION HUMANA"],
  ADMINISTRACION: ["BODEGA Y PROVEEDURIA", "CONTABILIDAD", "MANTENIMIENTO"],
  "CONTROL DE PRODUCCION": ["ESTRUCTURAS 3"],
  "GERENCIA COMERCIAL": ["SERVICIO AL CLIENTE"],
  "SERVICIO AL CLIENTE": ["ATENCION AL CLIENTE", "MENSAJERIA"],
};

/* Encargados de los niveles que no tienen colaboradores propios */
const SUPERVISORES_EXTRA = {
  "GERENCIA GENERAL": "JULIO FRANCIS SILVA TUESTA",
  "GERENCIA COMERCIAL": "OSCAR ROSALES",
};

/* Profundidad de un área dentro del árbol */
function nivelDe(area, raiz = "GERENCIA GENERAL", nivel = 0) {
  if (area === raiz) return nivel;
  for (const hija of ARBOL_AREAS[raiz] || []) {
    const encontrado = nivelDe(area, hija, nivel + 1);
    if (encontrado >= 0) return encontrado;
  }
  return -1;
}

/* Todas las áreas con el orden y las etiquetas del selector */
function areasJerarquia(raiz = "GERENCIA GENERAL", nivel = 0, salida = []) {
  salida.push({
    area: raiz,
    nivel,
    etiqueta: nivel === 0 ? raiz : `${"Sub Area - ".repeat(nivel)}${raiz}`,
  });
  (ARBOL_AREAS[raiz] || []).forEach((hija) => areasJerarquia(hija, nivel + 1, salida));
  return salida;
}

/* El área junto con todas sus subáreas */
function conSubareas(area) {
  const salida = [area];
  (ARBOL_AREAS[area] || []).forEach((hija) => salida.push(...conSubareas(hija)));
  return salida;
}

const subareasDe = (area) => conSubareas(area).slice(1);

/* El área que evalúa cada encuesta interna del catálogo */
const AREA_DE_ENCUESTA = {
  "Área de Administración": ["ADMINISTRACION", "CONTABILIDAD"],
  "Área de Control de Producción/PPR": ["CONTROL DE PRODUCCION"],
  "Área de Estructuras 1": ["ESTRUCTURAS 1", "ESTRUCTURAS 3"],
  "Área de Estructuras 2": ["ESTRUCTURAS 2"],
  "Área de Mensajería": ["MENSAJERIA"],
  "Área de Servicio al Cliente": ["SERVICIO AL CLIENTE", "ATENCION AL CLIENTE"],
  RRHH: AREAS_LAB,
  "Toda la empresa": AREAS_LAB,
};

const MUNICIPIOS_POR_DEPTO = {
  GUATEMALA: ["VILLA CANALES", "MIXCO", "SAN MIGUEL PETAPA", "VILLA NUEVA", "GUATEMALA", "SANTA CATARINA PINULA"],
  SACATEPEQUEZ: ["ANTIGUA GUATEMALA", "JOCOTENANGO", "CIUDAD VIEJA", "SUMPANGO"],
  ESCUINTLA: ["ESCUINTLA", "SANTA LUCIA COTZUMALGUAPA", "PALIN", "SAN JOSE"],
  CHIMALTENANGO: ["CHIMALTENANGO", "SAN JUAN COMALAPA", "PATZICIA", "TECPAN GUATEMALA"],
};
const DEPARTAMENTOS = Object.keys(MUNICIPIOS_POR_DEPTO);
const BANCOS = ["BANRURAL", "BANCO INDUSTRIAL", "BAC CREDOMATIC", "BANCO G&T CONTINENTAL"];
const HORARIOS = [
  "LUNES A VIERNES 7:00 A 16:00 / BREAK 12:30 A 13:30 / SABADO 7:00 A 11:00",
  "LUNES A VIERNES 8:00 A 17:00 / BREAK 13:00 A 14:00",
  "LUNES A SABADO 7:00 A 15:00 / BREAK 12:00 A 12:30",
];
const FASES_LAB = [
  "ENCERADO MANUAL", "ENCERADO/COLADO ADIT", "DESBASTE/INYECCION DE CERA",
  "DESBASTE/COLADO DE CERA", "JIG DE VERIFICACION", "FRESADO", "ESCANEO",
  "DISEÑO CAD", "ACABADO", "PULIDO", "CIERRE Y EMPAQUE",
];

/* Los datos de la ficha se derivan del correo para que siempre
   sean los mismos y no cambien entre recargas. */
function huella(texto) {
  let n = 0;
  for (let i = 0; i < texto.length; i += 1) n = (n * 31 + texto.charCodeAt(i)) % 100000;
  return n;
}

function empleado(nombre, puesto, area, correo, extra = {}) {
  const h = huella(correo);
  const usuario = correo.split("@")[0].toLowerCase();
  const partes = nombre.split(" ");
  const anioNac = 1978 + (h % 24);
  const mesNac = String(1 + (h % 12)).padStart(2, "0");
  const diaNac = String(1 + (h % 27)).padStart(2, "0");

  return Object.assign(
    {
      id: `emp-${usuario}`,
      name: nombre,
      firstName: partes.slice(0, partes.length > 2 ? 2 : 1).join(" "),
      lastName: partes.slice(partes.length > 2 ? 2 : 1).join(" ") || partes[0],
      position: puesto,
      area,
      email: correo,
      manager: SUPERVISORES[area] || "",
      active: true,
      supervisor: false,
      role: "colaborador",

      /* Datos personales */
      phone: `5${String(9000000 + (h % 999999)).slice(0, 7)}`,
      dpi: `${1000 + (h % 8999)}${String(10000 + (h % 89999))}${String(100 + (h % 899))}`,
      nit: `${String(1000000 + (h % 8999999))}-${h % 10}`,
      birthDate: `${diaNac}/${mesNac}/${anioNac}`,
      bankAccount: `${String(300000000 + (h % 99999999))}`,
      accountType: h % 2 ? "Monetaria" : "Ahorro",
      bankName: BANCOS[h % BANCOS.length],
      roles: ["OPERADOR"],

      /* Dirección */
      street: `CASERIO LA VIRGEN ${1 + (h % 9)}-${10 + (h % 80)} ZONA ${1 + (h % 21)}`,
      street2: "",
      department: DEPARTAMENTOS[h % DEPARTAMENTOS.length],
      city: (() => {
        const depto = DEPARTAMENTOS[h % DEPARTAMENTOS.length];
        const lista = MUNICIPIOS_POR_DEPTO[depto];
        return lista[h % lista.length];
      })(),
      postalCode: "01000",
      country: "GUATEMALA",

      /* Ocupación */
      hireDate: `${String(1 + (h % 27)).padStart(2, "0")}/${String(1 + (h % 12)).padStart(2, "0")}/20${20 + (h % 6)}`,
      dailyHours: "8,00",
      payType: "Planilla",
      color: `#${((h * 7919) % 0xffffff).toString(16).padStart(6, "0")}`,
      phases: [FASES_LAB[h % FASES_LAB.length], FASES_LAB[(h + 3) % FASES_LAB.length], FASES_LAB[(h + 6) % FASES_LAB.length]],

      /* Marcajes */
      timeControl: true,
      schedule: HORARIOS[h % HORARIOS.length],
      zktecoId: String(100 + (h % 200)),

      /* Documentación */
      documents: [
        { name: "DPI (ambos lados)", state: h % 3 ? "Cargado" : "Pendiente" },
        { name: "Contrato laboral firmado", state: "Cargado" },
        { name: "Antecedentes penales", state: h % 2 ? "Cargado" : "Pendiente" },
        { name: "Constancia de estudios", state: h % 4 ? "Cargado" : "Pendiente" },
      ],
    },
    extra
  );
}

const EMPLEADOS = [
  /* ---- Acceso al sistema (administradores del módulo) ---- */
  empleado("BRYAN LUCERO", "DESARROLLADOR", "ADMINISTRACION", "bryan@digitallabsgt.com", { role: "admin", roles: ["ADMINISTRADOR"], supervisor: false }),

  /* ---- Administración y contabilidad ---- */
  empleado("JULIO FRANCIS SILVA TUESTA", "JEFE ADMINISTRATIVO", "ADMINISTRACION", "jsilva@digitallabsgt.com", { supervisor: true }),
  empleado("GLADYS MANSILLA", "AUXILIAR CONTABLE Y DE FACTURACION", "ADMINISTRACION", "gmansilla@digitallabsgt.com"),
  empleado("CESIA MARTINEZ", "AUXILIAR CONTABLE Y DE FACTURACION", "ADMINISTRACION", "cmartinez@digitallabsgt.com"),
  empleado("PATRICIA POS", "AUXILIAR DE LIMPIEZA", "ADMINISTRACION", "ppos@digitallabsgt.com"),
  empleado("PABLO GARCIA CASTILLO", "CONTADOR", "CONTABILIDAD", "pgarcia@digitallabsgt.com"),
  empleado("RUDY ELVIN CONTRERAS VASQUEZ", "ENCARGADO DE BODEGA", "BODEGA Y PROVEEDURIA", "rcontreras@digitallabsgt.com"),
  empleado("LUIS ALFONSO VELIZ DE LEON", "TECNICO MANTENIMIENTO", "MANTENIMIENTO", "lveliz@digitallabsgt.com"),

  /* ---- Control de producción ---- */
  empleado("BETZY CAL", "JEFE DE CONTROL DE PRODUCCION", "CONTROL DE PRODUCCION", "bcal@digitallabsgt.com", { supervisor: true }),
  empleado("JESUS GUITE", "ENCARGADO DE CIERRE Y EMPAQUE", "CONTROL DE PRODUCCION", "jguite@digitallabsgt.com"),
  empleado("JONATAN CERMEÑO", "PLANIFICADOR", "CONTROL DE PRODUCCION", "jcermeno@digitallabsgt.com"),
  empleado("ANDREA BORRAYO", "PLANIFICADOR", "CONTROL DE PRODUCCION", "aborrayo@digitallabsgt.com"),

  /* ---- Estructuras 1 y 3 ---- */
  empleado("ANTHONY ALFREDO CASTILLO ASTO", "SUPERVISOR E1", "ESTRUCTURAS 1", "acastillo@digitallabsgt.com", { supervisor: true }),
  empleado("JORDI YOL", "TECNICO FRESADO", "ESTRUCTURAS 1", "jyol@digitallabsgt.com"),
  empleado("ANGEL FRANCO", "TECNICO FRESADO", "ESTRUCTURAS 1", "afranco@digitallabsgt.com"),
  empleado("MICHAEL JUAREZ", "TECNICO ESCANEO", "ESTRUCTURAS 1", "mjuarez@digitallabsgt.com"),
  empleado("CESAR TZALAM", "TECNICO CAD", "ESTRUCTURAS 1", "ctzalam@digitallabsgt.com"),
  empleado("MARIA RODRIGUEZ", "TECNICO ACABADO", "ESTRUCTURAS 1", "mrodriguez@digitallabsgt.com"),
  empleado("JENNIFER ALEJANDRA GUERRA QUEVEDO", "TECNICO CIERRE", "ESTRUCTURAS 1", "jguerra@digitallabsgt.com"),
  empleado("JOSUE DANIEL MUÑOS MORALES", "TECNICO MODELOS", "ESTRUCTURAS 1", "jmunos@digitallabsgt.com"),
  empleado("JONATHAN JOSUE YOC VICENTE", "TECNICO MODELOS", "ESTRUCTURAS 1", "jyoc@digitallabsgt.com"),
  empleado("FERNANDO JOSE CAMPOS TURCIOS", "TECNICO INGRESO", "ESTRUCTURAS 1", "fcampos@digitallabsgt.com"),
  empleado("MARVIN LOPEZ", "TECNICO PPR", "ESTRUCTURAS 3", "mlopez@digitallabsgt.com"),
  empleado("BRENDA SICAN", "TECNICO PPR", "ESTRUCTURAS 3", "bsican@digitallabsgt.com"),

  /* ---- Estructuras 2 ---- */
  empleado("JOSE OTONIEL BATZIBAL MERCAR", "SUPERVISOR E2", "ESTRUCTURAS 2", "jbatzibal@digitallabsgt.com", { supervisor: true }),
  empleado("EDUARDO ROMÁN", "TECNICO INYECCION Y COLADO", "ESTRUCTURAS 2", "eroman@digitallabsgt.com"),
  empleado("EVELYN FRANCISCO", "TECNICO INYECCION Y COLADO", "ESTRUCTURAS 2", "efrancisco@digitallabsgt.com"),
  empleado("WALTER SAQUIC", "TECNICO ENCERADO", "ESTRUCTURAS 2", "wsaquic@digitallabsgt.com"),
  empleado("DIANA CHAVEZ", "TECNICO ENCERADO", "ESTRUCTURAS 2", "dchavez@digitallabsgt.com"),
  empleado("BYRON MEJIA", "TECNICO PULIDO", "ESTRUCTURAS 2", "bmejia@digitallabsgt.com"),
  empleado("SANDRA LEIVA", "TECNICO PULIDO", "ESTRUCTURAS 2", "sleiva@digitallabsgt.com"),
  empleado("OTTO PEREZ RAMIREZ", "TECNICO ACABADO", "ESTRUCTURAS 2", "operez@digitallabsgt.com"),

  /* ---- Mensajería ---- */
  empleado("KEVIN ALMAZAN", "ENCARGADO DE MENSAJERIA", "MENSAJERIA", "kalmazan@digitallabsgt.com", { supervisor: true }),
  empleado("JIMMY CUQUE", "MENSAJERO", "MENSAJERIA", "jcuque@digitallabsgt.com"),
  empleado("RENSO CONDE", "MENSAJERO", "MENSAJERIA", "rconde@digitallabsgt.com"),
  empleado("EDGAR GOMEZ", "MENSAJERO", "MENSAJERIA", "egomez@digitallabsgt.com"),
  empleado("HECTOR BOCHE", "MENSAJERO", "MENSAJERIA", "hboche@digitallabsgt.com"),
  empleado("LESTER PIRIR", "MENSAJERO", "MENSAJERIA", "lpirir@digitallabsgt.com"),

  /* ---- Servicio y atención al cliente ---- */
  empleado("OSCAR ROSALES", "SUPERVISOR SAC", "SERVICIO AL CLIENTE", "orosales@digitallabsgt.com", { supervisor: true }),
  empleado("ANDREA LÓPEZ", "ASESOR DE SERVICIO AL CLIENTE", "SERVICIO AL CLIENTE", "alopez@digitallabsgt.com"),
  empleado("MARÍA FERNANDA SOTO", "ASESOR DE SERVICIO AL CLIENTE", "SERVICIO AL CLIENTE", "msoto@digitallabsgt.com"),
  empleado("KARLA RUIZ", "ASESOR DE SERVICIO AL CLIENTE", "SERVICIO AL CLIENTE", "kruiz@digitallabsgt.com"),
  empleado("SUANI GARCIA", "ASESOR DE SERVICIO AL CLIENTE", "ATENCION AL CLIENTE", "sgarcia@digitallabsgt.com"),
  empleado("MELODY HERNANDEZ", "ASESOR DE SERVICIO AL CLIENTE", "ATENCION AL CLIENTE", "mhernandez@digitallabsgt.com"),

  /* ---- Gestión humana ---- */
  empleado("KEYLA HURTADO", "COORDINADOR DE GESTION HUMANA", "GESTION HUMANA", "khurtado@digitallabsgt.com", { supervisor: true, role: "admin", roles: ["RECURSOS HUMANOS", "JEFE DE DEPARTAMENTO"] }),
  empleado("SILVIA MARROQUIN", "AUXILIAR DE GESTION HUMANA", "GESTION HUMANA", "smarroquin@digitallabsgt.com"),
];

/* ------------------------------------------------------------------
   Consultas
   ------------------------------------------------------------------ */
/* El rol se deduce del puesto: los jefes de área ven los resultados
   de su equipo; los administradores entran al sistema completo. */
EMPLEADOS.forEach((persona) => {
  if (persona.supervisor && persona.role === "colaborador") {
    persona.role = "supervisor";
    persona.roles = ["SUPERVISOR DE AREA"];
  }
});

/* Nadie queda fuera: quien administra el módulo también responde
   la encuesta de su área (solo los jefes no se evalúan a sí mismos). */
const SIN_ENCUESTA = [];

const listar = () => EMPLEADOS;
const obtener = (id) => EMPLEADOS.find((e) => e.id === id) || null;
const porCorreo = (correo) =>
  EMPLEADOS.find((e) => e.email.toLowerCase() === String(correo || "").trim().toLowerCase()) || null;
const porIds = (ids) => (ids || []).map((id) => obtener(id)).filter(Boolean);

/* Colaboradores a los que les toca una encuesta interna.
   El supervisor del área no se evalúa a sí mismo. */
function destinatarios(areasEncuesta) {
  const areas = (areasEncuesta || []).flatMap((etiqueta) => AREA_DE_ENCUESTA[etiqueta] || [etiqueta]);
  const unicas = [...new Set(areas)];
  return EMPLEADOS.filter((e) => e.active && unicas.includes(e.area) && !e.supervisor && !SIN_ENCUESTA.includes(e.email));
}

/* Quiénes responden según el modo de asignación del sistema:
     "Por supervisor"                -> el área y todas sus subáreas
     "Por supervisor sin encargados" -> lo mismo, sin los encargados de subárea
     "Manual"                        -> los que se elijan a mano
   Devuelve además los avisos que muestra el formulario. */
function respondedores(area, modo = "Por supervisor") {
  const arbol = conSubareas(area);
  const hijas = subareasDe(area);
  const supervisor = SUPERVISORES[area] || SUPERVISORES_EXTRA[area] || "";

  let gente = EMPLEADOS.filter(
    (e) => e.active && arbol.includes(e.area) && !SIN_ENCUESTA.includes(e.email) && e.name !== supervisor
  );

  if (modo === "Por supervisor sin encargados") {
    gente = gente.filter((e) => !e.supervisor);
  }

  const deSubareas = gente.filter((e) => e.area !== area);

  const avisos = [];
  if (hijas.length) {
    avisos.push(
      "El área seleccionada tiene subáreas. La lista puede incluir personas relacionadas por jerarquía organizacional; revisa los respondedores y quita manualmente a quienes no deban responder."
    );
  }
  if (deSubareas.length) {
    avisos.push(
      `Hay respondedores que pertenecen a subáreas: ${deSubareas.map((e) => `${e.name} (${e.area})`).join(", ")}.`
    );
  }

  return {
    area,
    supervisor,
    modo,
    subareas: hijas,
    avisos,
    gente: gente.sort((a, b) => a.name.localeCompare(b.name, "es")),
  };
}

function supervisorDe(areasEncuesta) {
  const areas = (areasEncuesta || []).flatMap((etiqueta) => AREA_DE_ENCUESTA[etiqueta] || [etiqueta]);
  for (const area of areas) if (SUPERVISORES[area]) return SUPERVISORES[area];
  return "";
}

/* ------------------------------------------------------------------
   Histórico: lo que el sistema anterior ya tenía registrado.
   Se conserva tal cual para no perder los períodos ya evaluados.
   ------------------------------------------------------------------ */
const PREGUNTAS_LIDERAZGO = [
  "¿Tu supervisor supervisa tu área de trabajo, da seguimiento a las tareas asignadas y se asegura de que se cumplan los objetivos?",
  "¿Brinda apoyo y orientación cuando surgen dudas o problemas en el trabajo?",
  "¿Se comunica de forma clara, respetuosa y oportuna con el equipo?",
  "¿Promueve un ambiente de trabajo ordenado, responsable y enfocado en la mejora continua?",
  "¿Consideras que tu supervisor cumple adecuadamente con su rol de liderazgo?",
];

const PREGUNTAS_RRHH = [
  "¿Recibes a tiempo la información que Gestión Humana comunica al personal?",
  "¿Sientes que tus solicitudes de permisos, vacaciones o constancias se atienden con claridad?",
  "¿El proceso de ingreso y capacitación te dejó claro lo que se espera de tu puesto?",
  "¿Consideras que el ambiente de trabajo en el laboratorio es respetuoso?",
  "¿Recomendarías Digital Labs como un buen lugar para trabajar?",
];

const COMENTARIOS = [
  "No tengo ninguna observación",
  "...",
  "Perfecto con el ámbito laboral. Solo me gustaría que dejemos en claro cuáles serán las asignaciones específicas a cumplir, para estar totalmente alineados.",
  "Todo bien en el área, solo hace falta más comunicación cuando cambian las prioridades del día.",
  "Me gustaría que se reconozca el trabajo cuando salimos con la producción a tiempo.",
];

/* Cada fila es un período ya evaluado, con los mismos números que
   venía mostrando el sistema anterior. */
const FILAS_HISTORICO = [
  /* etiqueta de encuesta, área evaluada, período, asignadas, respuestas, promedio */
  ["Área de Administración", "ADMINISTRACION", "2026-08", 6, 6, 4.7],
  ["Área de Control de Producción/PPR", "CONTROL DE PRODUCCION", "2026-08", 4, 4, 4.4],
  ["Área de Estructuras 1", "ESTRUCTURAS 1", "2026-08", 12, 12, 4.97],
  ["Área de Estructuras 2", "ESTRUCTURAS 2", "2026-08", 8, 8, 4.23],
  ["Área de Mensajería", "MENSAJERIA", "2026-08", 5, 5, 5.0],
  ["Área de Servicio al Cliente", "SERVICIO AL CLIENTE", "2026-08", 6, 6, 2.9],
  ["RRHH", "", "2026-08", 44, 44, 4.71],

  ["Área de Administración", "ADMINISTRACION", "2026-07", 6, 6, 4.83],
  ["Área de Control de Producción/PPR", "CONTROL DE PRODUCCION", "2026-07", 4, 4, 4.75],
  ["Área de Estructuras 1", "ESTRUCTURAS 1", "2026-07", 13, 12, 4.54],
  ["Área de Estructuras 2", "ESTRUCTURAS 2", "2026-07", 8, 8, 4.1],
  ["Área de Mensajería", "MENSAJERIA", "2026-07", 5, 5, 4.96],
  ["Área de Servicio al Cliente", "SERVICIO AL CLIENTE", "2026-07", 6, 6, 3.97],
  ["RRHH", "", "2026-07", 45, 44, 4.56],

  ["Área de Administración", "ADMINISTRACION", "2026-06", 5, 5, 4.76],
  ["Área de Control de Producción/PPR", "CONTROL DE PRODUCCION", "2026-06", 4, 4, 4.2],
  ["Área de Estructuras 1", "ESTRUCTURAS 1", "2026-06", 12, 12, 4.73],
  ["Área de Estructuras 2", "ESTRUCTURAS 2", "2026-06", 9, 7, 3.09],
  ["Área de Mensajería", "MENSAJERIA", "2026-06", 5, 5, 5.0],
  ["Área de Servicio al Cliente", "SERVICIO AL CLIENTE", "2026-06", 6, 6, 4.1],
  ["RRHH", "", "2026-06", 46, 44, 4.46],

  ["Área de Administración", "ADMINISTRACION", "2026-05", 5, 5, 4.52],
  ["Área de Control de Producción/PPR", "CONTROL DE PRODUCCION", "2026-05", 4, 4, 4.35],
  ["Área de Estructuras 1", "ESTRUCTURAS 1", "2026-05", 12, 12, 4.88],
  ["Área de Estructuras 2", "ESTRUCTURAS 2", "2026-05", 9, 9, 4.07],
  ["Área de Mensajería", "MENSAJERIA", "2026-05", 5, 5, 4.96],
  ["Área de Servicio al Cliente", "SERVICIO AL CLIENTE", "2026-05", 6, 6, 4.2],
  ["RRHH", "", "2026-05", 46, 46, 4.67],
];

const MESES_ES = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];

const etiquetaPeriodo = (clave) => {
  const [anio, mes] = String(clave).split("-");
  return `${MESES_ES[Number(mes) - 1]} ${anio}`;
};

/* Escala del sistema anterior */
function escala(promedio) {
  const n = Number(promedio);
  if (n >= 4.5) return "Excelente";
  if (n >= 4) return "Bueno";
  return "Regular";
}

/* Reparte el promedio del período entre las preguntas y los
   colaboradores, de forma estable (siempre da el mismo resultado). */
function repartir(promedio, cantidad, semilla) {
  if (cantidad <= 0) return [];
  const notas = [];
  for (let i = 0; i < cantidad; i += 1) {
    const onda = Math.sin((semilla + i * 7.13) * 1.7);
    let nota = Number(promedio) + onda * 0.32;
    nota = Math.max(1, Math.min(5, nota));
    notas.push(nota);
  }
  /* Se corrige el desvío para que el promedio coincida con el registrado */
  const media = notas.reduce((a, b) => a + b, 0) / cantidad;
  const ajuste = Number(promedio) - media;
  return notas.map((n) => Number(Math.max(1, Math.min(5, n + ajuste)).toFixed(2)));
}

const codigo = (texto) =>
  String(texto)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

const HISTORICO = FILAS_HISTORICO.map((fila, indice) => {
  const [etiqueta, area, periodo, asignadas, respuestas, promedio] = fila;
  const esRRHH = etiqueta === "RRHH";
  const preguntas = esRRHH ? PREGUNTAS_RRHH : PREGUNTAS_LIDERAZGO;
  const supervisor = esRRHH ? "KEYLA HURTADO" : SUPERVISORES[area] || "";

  const notasPreguntas = repartir(promedio, preguntas.length, indice + 1);
  /* Los participantes salen del área evaluada; si el período tuvo más
     asignados que la plantilla actual, se completa con el resto del
     personal en lugar de repetir a la misma persona. */
  const delArea = esRRHH ? EMPLEADOS.filter((e) => e.active) : destinatarios([etiqueta]);
  const resto = EMPLEADOS.filter((e) => e.active && !e.supervisor && !delArea.includes(e));
  const gente = [...delArea, ...resto].slice(0, asignadas);
  const notasGente = repartir(promedio, respuestas, indice + 11);

  return {
    id: `hist-${codigo(etiqueta)}-${periodo}`,
    origen: "Sistema anterior",
    surveyName: `"Evaluación ${esRRHH ? "RRHH" : "de Liderazgo"}: Tu Opinión Cuenta"${esRRHH ? "" : ` - ${etiqueta}`}`,
    supervisor,
    period: periodo,
    periodLabel: etiquetaPeriodo(periodo),
    area: area || "—",
    asignadas,
    respuestas,
    promedio: Number(promedio).toFixed(2),
    escala: escala(promedio),
    preguntas: preguntas.map((texto, i) => ({
      texto,
      promedio: notasPreguntas[i].toFixed(2),
      respuestas,
    })),
    colaboradores: gente.map((persona, i) => {
      const respondio = i < respuestas;
      return {
        name: persona ? persona.name : `COLABORADOR ${i + 1}`,
        position: persona ? persona.position : "",
        email: persona ? persona.email : "",
        estado: respondio ? "Respondida" : "Sin responder",
        promedio: respondio ? notasGente[i].toFixed(2) : "—",
        respuestas: respondio ? preguntas.length : 0,
      };
    }),
    comentarios: COMENTARIOS.slice(0, 3 + (indice % 3)),
  };
});

const historico = () => HISTORICO;
const historicoDe = (id) => HISTORICO.find((h) => h.id === id) || null;

module.exports = {
  AREAS_LAB,
  DEPARTAMENTOS,
  MUNICIPIOS_POR_DEPTO,
  FASES_LAB,
  SUPERVISORES,
  AREA_DE_ENCUESTA,
  PREGUNTAS_LIDERAZGO,
  PREGUNTAS_RRHH,
  listar,
  obtener,
  porCorreo,
  destinatarios,
  supervisorDe,
  ARBOL_AREAS,
  SUPERVISORES_EXTRA,
  areasJerarquia,
  conSubareas,
  subareasDe,
  nivelDe,
  respondedores,
  porIds,
  historico,
  historicoDe,
  escala,
  etiquetaPeriodo,
};
