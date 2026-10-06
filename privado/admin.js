/* =====================================================================
   SISTEMA PRIVADO - Modulo de Encuestas
   Crea encuestas internas y externas con el mismo editor tipo Forms.
   Todo se guarda en el servidor; el envio sale por WhatsApp (Baileys).
   ===================================================================== */
(() => {
  "use strict";

  const esc = DL.esc;
  const attr = DL.attr;

  const modules = [
    ["dashboard", "Dashboard"],
    ["works", "Trabajos"],
    ["admin", "Administración"],
    ["findings", "Hallazgos"],
    ["lab", "Laboratorio"],
    ["reports", "Reportes"],
    ["surveys", "Encuestas"],
    ["time", "Control Horario"],
  ];

  const STEPS = [
    ["envio", "WhatsApp", "Canal y mensaje"],
    ["general", "Datos generales", "Nombre, clasificación y descripción"],
    ["questions", "Preguntas", "Editor tipo Google Forms"],
    ["audience", "Público", "A quién se dirige y si usa órdenes"],
    ["schedule", "Programación", "Cada cuánto corre"],
  ];

  const state = {
    module: "surveys",
    view: "survey-list",
    listFilter: "all",
    surveys: [],
    draft: null,
    instancias: [],
    respuestas: [],
    mensajes: [],
    estado: null,
    step: STEPS[0][0],
    activeSectionId: "",
    activeQuestionId: "",
    openQuestionId: "",
    selectedWorkId: "15281",
    openDoctor: "",
    openMenu: "",
    filtros: null,
    filtrosOpen: false,
    filtrosTrabajos: null,
    confirmar: null,
    traPagina: 1,
    traPorPagina: 50,
    workSurveys: null,
    answersSurveyId: "",
    empleados: [],
    filtrosEmp: null,
    filtrosEmpOpen: false,
    resultados: [],
    resultado: null,
    volverA: "results-list",
    empleado: null,
    empTab: "personales",
    alcanceInterno: null,
    bandeja: [],
    misResultados: [],
    respondiendo: null,
    empleadosLista: [],
    filtrosTrabajosOpen: false,
    original: null,
    esNueva: false,
    editorTab: "detalle",
    editando: false,
    previewDoctor: "",
    previewOpen: false,
    focusAfterRender: "",
    toastTimer: null,
    saveTimer: null,
    poll: null,
  };

  const els = {};

  /* Entra cualquiera con sesión; el rol decide qué ve */
  const sesion = window.DL_SESION ? DL_SESION.exigir(["admin", "supervisor", "colaborador"], "../") : null;
  const esAdmin = () => window.DL_SESION && DL_SESION.esAdmin(sesion);
  const esJefe = () => window.DL_SESION && DL_SESION.esJefe(sesion);

  document.addEventListener("DOMContentLoaded", async () => {
    if (!sesion) return;
    pintarUsuario(sesion);
    if (!esAdmin()) {
      state.module = "surveys";
      state.view = "inbox";
    }
    ["moduleNav", "sidebar", "appView", "previewDrawer", "previewBackdrop", "closePreview", "previewTitle", "previewContent", "toast"].forEach(
      (id) => (els[id] = document.getElementById(id))
    );
    document.addEventListener("click", onClick);
    document.addEventListener("input", onInput);
    document.addEventListener("change", onChange);
    document.addEventListener("keydown", onKeydown);
    els.previewBackdrop.addEventListener("click", closePreview);
    els.closePreview.addEventListener("click", closePreview);

    els.appView.innerHTML = '<p class="empty-note">Conectando con el servidor…</p>';
    try {
      await recargarBase();
      /* Bandeja y resultados se necesitan desde el arranque: son los
         contadores de dos de los tres tabs del módulo. */
      await cargarPersonal();
      renderApp();
      setInterval(refrescarEstado, 4000);
    } catch (error) {
      els.appView.innerHTML = `<div class="page-card"><h2 class="card-title">No se pudo conectar con el servidor</h2>
        <p class="empty-note">${esc(error.message)}</p>
        <p class="empty-note">Abra una terminal en la carpeta del prototipo y ejecute:<br><code>node server/server.js</code><br>
        Luego entre a <b>http://localhost:3000/privado/</b></p></div>`;
    }
  });

  async function recargarBase() {
    state.estado = await DL.api.estado();
    await DL.cargarTrabajos();
    state.surveys = await DL.api.encuestas();
  }

  async function refrescarEstado() {
    try {
      state.estado = await DL.api.estado();
      const chip = document.getElementById("waChip");
      if (chip) chip.outerHTML = waChip();
      if (state.view === "whatsapp") {
        state.mensajes = await DL.api.mensajes();
        renderView();
      }
    } catch (error) {
      /* servidor caído: se reintenta solo */
    }
  }

  /* ==================================================================
     Filtros de los listados (se recuerdan igual que en el sistema)
     ================================================================== */
  const FILTROS_ENC = { texto: "", clasificacion: "", estado: "", subcategoria: "", repeticion: "", responde: "", inactivas: true };
  const FILTROS_EMP = { texto: "", area: "", puesto: "", inactivos: false };
  const FILTROS_TRA = { texto: "", clinica: "", doctor: "", caja: "", estado: "", producto: "", asesora: "", desde: "", hasta: "" };
  const LS = { enc: "dl_filtros_encuestas", tra: "dl_filtros_trabajos", emp: "dl_filtros_empleados" };

  function leerFiltros(clave, base) {
    try {
      const guardado = JSON.parse(localStorage.getItem(clave) || "null");
      return Object.assign({}, base, guardado || {});
    } catch (error) {
      return Object.assign({}, base);
    }
  }

  function escribirFiltros(clave, valores) {
    try {
      localStorage.setItem(clave, JSON.stringify(valores));
    } catch (error) {
      /* si el navegador no deja guardar, los filtros siguen funcionando en pantalla */
    }
  }

  const filtrosEnc = () => (state.filtros = state.filtros || leerFiltros(LS.enc, FILTROS_ENC));
  const filtrosTra = () => (state.filtrosTrabajos = state.filtrosTrabajos || leerFiltros(LS.tra, FILTROS_TRA));
  const filtrosEmp = () => (state.filtrosEmp = state.filtrosEmp || leerFiltros(LS.emp, FILTROS_EMP));

  /* Colaboradores que pasan los filtros activos */
  function empleadosFiltrados() {
    const f = filtrosEmp();
    const texto = f.texto.trim().toLowerCase();
    return state.empleados.filter((persona) => {
      if (!f.inactivos && !persona.active) return false;
      if (f.area && persona.area !== f.area) return false;
      if (f.puesto && persona.position !== f.puesto) return false;
      if (texto && !contiene(persona.name, texto) && !contiene(persona.email, texto) && !contiene(persona.position, texto)) return false;
      return true;
    });
  }

  const cuentaFiltros = (valores, base) =>
    Object.keys(base).filter((campo) => String(valores[campo] ?? "") !== String(base[campo])).length;

  const contiene = (valor, texto) => String(valor || "").toLowerCase().includes(texto);

  /* Encuestas que pasan los filtros activos */
  function encuestasFiltradas() {
    const f = filtrosEnc();
    const texto = f.texto.trim().toLowerCase();
    return state.surveys.filter((survey) => {
      if (state.listFilter !== "all") {
        const quiere = state.listFilter === "ext" ? "Externa" : "Interna";
        if (survey.classification !== quiere) return false;
      }
      if (!f.inactivas && survey.status === "Inactiva") return false;
      if (f.clasificacion && survey.classification !== f.clasificacion) return false;
      if (f.estado && survey.status !== f.estado) return false;
      if (f.subcategoria && survey.subtype !== f.subcategoria) return false;
      if (f.repeticion && survey.schedule.repeat !== f.repeticion) return false;
      if (f.responde && survey.respondent !== f.responde) return false;
      if (texto && !contiene(survey.name, texto) && !contiene(survey.subtype, texto) && !contiene(survey.respondent, texto)) return false;
      return true;
    });
  }

  /* Trabajos que pasan los filtros activos */
  function trabajosFiltrados() {
    const f = filtrosTra();
    const texto = f.texto.trim().toLowerCase();
    return DL.WORKS.filter((work) => {
      if (f.clinica && work.clinic !== f.clinica) return false;
      if (f.doctor && work.doctor !== f.doctor) return false;
      if (f.caja && String(work.box) !== f.caja) return false;
      if (f.estado && work.status !== f.estado) return false;
      if (f.producto && work.product !== f.producto) return false;
      if (f.asesora && work.advisor !== f.asesora) return false;
      if ((f.desde || f.hasta) && !DL.enRango(work, f.desde, f.hasta)) return false;
      if (texto && !contiene(work.code, texto) && !contiene(work.patient, texto) && !contiene(work.doctor, texto) && !contiene(work.clinic, texto)) return false;
      return true;
    });
  }

  const unicos = (lista, campo) => [...new Set(lista.map((item) => item[campo]).filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b), "es"));

  /* Barra "Ver filtros / Borrar filtros" con el contador, igual que en el sistema */
  function barraFiltros(abierto, cuenta, extra = "") {
    return `
      <div class="dl-toolbar">
        <button class="dl-filter-toggle ${abierto ? "is-open" : ""}" type="button" data-act="toggle-filtros">
          ${abierto ? "Ocultar filtros" : "Ver filtros"}
          ${cuenta ? `<span class="dl-filter-count">${cuenta}</span>` : ""}
        </button>
        <button class="dl-filter-clear" type="button" data-act="limpiar-filtros" ${cuenta ? "" : "disabled"}>Borrar filtros</button>
        ${extra}
      </div>`;
  }

  function campoFiltro(etiqueta, campo, opciones, valor, ancho = "") {
    return `
      <label class="dl-field ${ancho}"><span>${etiqueta}</span>
        <select data-filtro="${campo}">
          <option value="">- Cualquiera -</option>
          ${opciones.map((opcion) => `<option ${opcion === valor ? "selected" : ""}>${esc(opcion)}</option>`).join("")}
        </select>
      </label>`;
  }

  /* ==================================================================
     Helpers
     ================================================================== */
  const draft = () => state.draft;
  const isExternal = () => state.draft && state.draft.classification === "Externa";
  const findSection = (id) => draft().sections.find((section) => section.id === id);
  const findQuestion = (id) => {
    for (const section of draft().sections) {
      const question = section.questions.find((item) => item.id === id);
      if (question) return { section, question };
    }
    return null;
  };
  const activeSection = () => findSection(state.activeSectionId) || draft().sections[0];
  const draftWorks = () => DL.findWorks(draft().works.selectedIds);

  /* Trabajos elegibles según el período configurado en la encuesta */
  const elegibles = () => {
    const survey = draft();
    return DL.eligibleWorks(survey.works.statuses, survey.periodFrom, survey.periodTo);
  };

  const bonita = (iso) => {
    if (!iso || !iso.includes("-")) return iso || "";
    const [anio, mes, dia] = iso.split("-");
    return `${dia}/${mes}/${anio}`;
  };

  /* Primera y próxima corrida, calculadas en pantalla para que se
     actualicen al cambiar la fecha o la hora (el servidor manda igual). */
  const MESES_LARGO = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
  const SALTO_MESES = { Mensual: 1, Trimestral: 3, Anual: 12 };

  const aFecha = (iso) => {
    if (!iso || !String(iso).includes("-")) return null;
    const [anio, mes, dia] = String(iso).split("-").map(Number);
    return new Date(anio, mes - 1, dia);
  };

  const ventanaTexto = (fecha, desde, hasta) =>
    fecha ? `${fecha.getDate()} ${MESES_LARGO[fecha.getMonth()]} ${fecha.getFullYear()} de ${desde} A ${hasta}` : "—";

  const diaDeInicio = (survey) => {
    const inicio = aFecha((survey.schedule || {}).startDate);
    return inicio ? inicio.getDate() : new Date().getDate();
  };

  const horaDeInicio = (survey) => String((survey.schedule || {}).startTime || "07:00").slice(0, 5);

  function corridas(survey) {
    const prog = survey.schedule || {};
    const desde = String(prog.startTime || "07:00").slice(0, 5);
    const hasta = String(prog.endTime || "23:59").slice(0, 5);
    const inicio = aFecha(prog.startDate);
    const fin = aFecha(prog.endDate);
    const ahora = new Date();

    /* Sin repetición corre una sola vez: en la fecha y hora de inicio */
    if (prog.repeat === "No repetir") {
      const unica = ventanaTexto(inicio, desde, hasta);
      return { primera: unica, proxima: prog.lastRun ? "No se repite" : unica };
    }

    const salto = SALTO_MESES[prog.repeat] || 1;
    const base = inicio || ahora;
    const dia = base.getDate();

    let primera = new Date(base.getFullYear(), base.getMonth(), dia);
    if (primera < base) primera = new Date(base.getFullYear(), base.getMonth() + 1, dia);

    const [hh, mm] = desde.split(":").map(Number);
    let proxima = new Date(ahora.getFullYear(), ahora.getMonth(), dia, hh || 0, mm || 0);
    while (proxima <= ahora) proxima = new Date(proxima.getFullYear(), proxima.getMonth() + salto, dia, hh || 0, mm || 0);
    if (proxima < primera) proxima = new Date(primera);

    const pasoElFin = fin && proxima > new Date(fin.getFullYear(), fin.getMonth(), fin.getDate(), 23, 59);

    return {
      primera: ventanaTexto(primera, desde, hasta),
      proxima: pasoElFin ? "Terminó la disponibilidad" : ventanaTexto(proxima, desde, hasta),
    };
  }

  /* Etiqueta del período, calculada al vuelo para que se vea al instante */
  const etiquetaPeriodo = () => {
    const survey = draft();
    if (survey.periodAuto !== false) return survey.periodLabel;
    return survey.periodFrom && survey.periodTo
      ? `${bonita(survey.periodFrom)} al ${bonita(survey.periodTo)}`
      : "Período sin definir";
  };

  /* Deja el período de la encuesta al día con lo que se ve en pantalla.
     Sin esto el mensaje de WhatsApp y la vista previa seguían diciendo el
     mes automático aunque se hubieran puesto fechas a mano. */
  function sincronizarPeriodo(survey) {
    if (!survey) return;
    if (survey.periodAuto !== false) {
      survey.periodFrom = DL.PERIODO_DESDE;
      survey.periodTo = DL.PERIODO_HASTA;
      survey.period = String(DL.PERIODO_DESDE || "").slice(0, 7);
      survey.periodLabel = `${MESES_LARGO[Number(String(DL.PERIODO_DESDE || "").slice(5, 7)) - 1] || ""} ${String(DL.PERIODO_DESDE || "").slice(0, 4)}`.trim();
      return;
    }
    survey.period = String(survey.periodFrom || "").slice(0, 7);
    survey.periodLabel =
      survey.periodFrom && survey.periodTo
        ? `${bonita(survey.periodFrom)} al ${bonita(survey.periodTo)}`
        : "Período sin definir";
  }
  const selectedWork = () => DL.WORKS.find((work) => work.id === state.selectedWorkId) || DL.WORKS[0];

  /* Recalcula quiénes responderían la encuesta interna y congela la
     lista dentro de la encuesta, igual que hace el sistema al guardar. */
  async function recalcularAlcance({ conservarQuitados = true } = {}) {
    const survey = state.draft;
    if (!survey || survey.classification !== "Interna") return;

    if (!DL.AREAS_ARBOL) {
      try {
        const catalogos = await DL.api.catalogos();
        DL.AREAS_ARBOL = catalogos.arbol;
        DL.AREAS_LAB = catalogos.areas;
        DL.DEPARTAMENTOS = catalogos.departamentos;
        DL.MUNICIPIOS = catalogos.municipios;
        DL.FASES_LAB = catalogos.fases;
      } catch (error) {
        DL.AREAS_ARBOL = [];
      }
    }

    if (survey.assignMode === "Manual") {
      if (!state.empleadosLista.length) {
        try {
          state.empleadosLista = (await DL.api.empleados()).filter((e) => e.active && !e.supervisor);
        } catch (error) {
          state.empleadosLista = [];
        }
      }
      state.alcanceInterno = { supervisor: survey.supervisorName || "", gente: [], avisos: [], subareas: [] };
      renderView();
      return;
    }

    try {
      const alcance = await DL.api.respondedores(survey.areaKey || "GERENCIA GENERAL", survey.assignMode);
      state.alcanceInterno = alcance;
      survey.supervisorName = alcance.supervisor;
      const quitados = conservarQuitados ? survey.excluded || [] : [];
      survey.excluded = quitados;
      survey.respondents = alcance.gente.map((g) => g.id).filter((id) => !quitados.includes(id));
      guardar();
    } catch (error) {
      state.alcanceInterno = { supervisor: "", gente: [], avisos: [error.message], subareas: [] };
    }
    renderView();
  }

  function abrirBorrador(survey, esNueva = false) {
    state.draft = DL.clone(survey);
    state.original = DL.clone(survey);
    state.esNueva = esNueva;
    /* Al abrir desde la fila se entra en consulta; una encuesta nueva
       entra directo en edición. */
    state.editando = esNueva;
    state.editorTab = "detalle";
    state.segFiltro = null;
    state.respFiltro = null;
    state.seg = null;
    state.resp = null;
    state.step = STEPS[0][0];
    state.activeSectionId = state.draft.sections[0].id;
    state.activeQuestionId = state.draft.sections[0].questions[0].id;
    state.openQuestionId = state.activeQuestionId;
    state.alcanceInterno = null;
    if (state.draft.classification === "Interna") recalcularAlcance();
  }

  function guardar(mensaje) {
    if (!state.draft) return;
    if (!state.editando) return; /* en consulta no se guarda nada */
    const badge = document.getElementById("saveState");
    /* Una encuesta que todavía no se ha creado vive solo en pantalla:
       nada se guarda hasta que se pulsa "Crear encuesta" o "Guardar como borrador". */
    if (state.esNueva) {
      if (badge) badge.textContent = "Sin guardar · use los botones de abajo";
      return;
    }
    if (badge) badge.textContent = "Guardando cambios…";
    clearTimeout(state.saveTimer);
    state.saveTimer = setTimeout(async () => {
      try {
        const guardada = await DL.api.guardarEncuesta(state.draft);
        state.draft.schedule.nextRun = guardada.schedule.nextRun;
        state.draft.periodLabel = guardada.periodLabel;
        state.draft.period = guardada.period;
        state.draft.periodFrom = guardada.periodFrom;
        state.draft.periodTo = guardada.periodTo;
        state.surveys = await DL.api.encuestas();
        if (badge) badge.textContent = "Se han guardado todos los cambios";
        if (mensaje) showToast(mensaje);
      } catch (error) {
        if (badge) badge.textContent = "Error al guardar";
        showToast("No se pudo guardar: " + error.message);
      }
    }, 350);
  }

  /* Guarda de verdad: crea la encuesta la primera vez, actualiza despues */
  async function persistir(survey) {
    const guardada = state.esNueva
      ? await DL.api.crearDesdeBorrador(survey)
      : await DL.api.guardarEncuesta(survey);
    state.draft = DL.clone(guardada);
    state.original = DL.clone(guardada);
    state.esNueva = false;
    return guardada;
  }

  function checklist() {
    const survey = draft();
    const questions = survey.sections.flatMap((section) => (section.active !== false ? section.questions.filter((q) => q.active !== false) : []));
    const items = [
      ["Nombre de la encuesta", Boolean(survey.name && survey.name.trim())],
      ["Al menos una categoría activa con preguntas", questions.length > 0],
      ["Todas las preguntas tienen área responsable", questions.every((question) => Boolean(question.area))],
    ];
    if (survey.classification === "Externa") {
      items.push(["Mensaje de WhatsApp configurado", survey.channel !== "API WhatsApp" || Boolean(survey.whatsappMessage.trim())]);
      if (survey.audienceMode === "Selección manual") {
        items.push(["Doctores seleccionados", (survey.audienceDoctors || []).length > 0]);
        items.push(["Órdenes seleccionadas", survey.works.selectedIds.length > 0]);
      }
    } else {
      items.push(["Público interno definido", (survey.audienceAreas || []).length > 0]);
    }
    return items;
  }

  /* ==================================================================
     Eventos
     ================================================================== */
  function onClick(event) {
    /* Menús desplegables: abrir, cerrar y cerrar al hacer clic fuera */
    const menuBtn = event.target.closest("[data-menu]");
    if (menuBtn) {
      state.openMenu = state.openMenu === menuBtn.dataset.menu ? "" : menuBtn.dataset.menu;
      renderView();
      return;
    }
    if (state.openMenu && !event.target.closest(".menu-pop")) {
      state.openMenu = "";
      if (!event.target.closest("[data-act],[data-view],[data-step],[data-module],[data-row-open]")) {
        renderView();
        return;
      }
    }

    /* Paginador de trabajos */
    const paginaDoc = event.target.closest("[data-doc-pagina]");
    if (paginaDoc && !paginaDoc.disabled) {
      state.resDocPagina = Number(paginaDoc.dataset.docPagina) || 1;
      renderView();
      const tabla = els.appView.querySelector(".dsv-rs-card.is-flush");
      if (tabla) tabla.scrollIntoView({ block: "start" });
      return;
    }
    const paginaBtn = event.target.closest("[data-tra-pagina]");
    if (paginaBtn && !paginaBtn.disabled) {
      state.traPagina = Number(paginaBtn.dataset.traPagina) || 1;
      renderView();
      const tabla = els.appView.querySelector(".dl-table-wrap");
      if (tabla) tabla.scrollIntoView({ block: "start" });
      return;
    }

    const moduleTab = event.target.closest("[data-module]");
    if (moduleTab) {
      state.module = moduleTab.dataset.module;
      const inicio = { works: "work-list", lab: "employees", reports: "results-list", dashboard: "dashboard" };
      irA(inicio[state.module] || "survey-list");
      return;
    }
    const viewLink = event.target.closest("[data-view]");
    if (viewLink) {
      irA(viewLink.dataset.view);
      return;
    }
    const stepBtn = event.target.closest("[data-step]");
    if (stepBtn) {
      state.step = stepBtn.dataset.step;
      renderView();
      return;
    }
    const action = event.target.closest("[data-act]");
    if (action) {
      runAction(action.dataset.act, action.dataset.arg, action);
      return;
    }

    /* Al hacer clic en cualquier parte de la fila se abre el registro,
       salvo si el clic fue en la columna de opciones. */
    const fila = event.target.closest("[data-row-open]");
    if (fila && !event.target.closest(".menu-wrap, .dl-col-opts, input, select, textarea, button, a")) {
      runAction(fila.dataset.rowOpen, fila.dataset.rowArg, fila);
      return;
    }
    const questionCard = event.target.closest("[data-question-id]");
    if (questionCard && !event.target.closest("input, textarea, select, button")) {
      state.activeSectionId = questionCard.dataset.sectionId;
      state.activeQuestionId = questionCard.dataset.questionId;
      state.openQuestionId = questionCard.dataset.questionId;
      renderView();
    }
  }

  async function irA(view) {
    if (view !== "answers") state.answersSurveyId = "";
    state.segPila = [];
    state.view = view;
    state.module = view === "dashboard"
      ? "dashboard"
      : view.startsWith("work")
      ? "works"
      : ["employees", "whatsapp"].includes(view)
        ? "lab"
        : "surveys";
    if (view !== "inbox") state.respondiendo = null;
    detenerPoll();
    try {
      if (view === "survey-list") {
        state.surveys = await DL.api.encuestas();
        cargarPersonal().then(renderView);
      }
      if (view === "sends" && state.draft) state.instancias = await DL.api.instancias(state.draft.id);
      if (view === "answers") state.respuestas = await DL.api.respuestas(state.answersSurveyId || undefined);
      if (view === "results") state.respuestas = await DL.api.respuestas();
      if (view === "whatsapp") state.mensajes = await DL.api.mensajes();
      if (view === "employees") {
        state.empleados = await DL.api.empleados();
        if (!DL.AREAS_LAB) {
          const catalogos = await DL.api.catalogos();
          DL.AREAS_ARBOL = catalogos.arbol;
          DL.AREAS_LAB = catalogos.areas;
          DL.DEPARTAMENTOS = catalogos.departamentos;
          DL.MUNICIPIOS = catalogos.municipios;
          DL.FASES_LAB = catalogos.fases;
        }
      }
      if (view === "results-list") {
        state.resColab = null;
        await cargarResultados();
      }
      if (view === "inbox") await cargarBandeja();
      if (view === "dashboard") await cargarDashboard();
      if (view === "my-results") await cargarMisResultados();
    } catch (error) {
      showToast(error.message);
    }
    renderApp();
    if (["sends", "answers", "whatsapp"].includes(view)) iniciarPoll(view);
  }

  function iniciarPoll(view) {
    detenerPoll();
    state.poll = setInterval(async () => {
      try {
        if (view === "sends" && state.draft) state.instancias = await DL.api.instancias(state.draft.id);
        if (view === "editor-envios" && state.draft) {
          state.instancias = await DL.api.instancias(state.draft.id);
          if (isExternal()) state.seg = await DL.api.seguimiento(state.draft.id);
        }
        if (view === "answers") state.respuestas = await DL.api.respuestas(state.answersSurveyId || undefined);
        if (view === "whatsapp") state.mensajes = await DL.api.mensajes();
        /* No repinta mientras alguien escribe en un filtro */
        const campo = document.activeElement;
        if (campo && els.appView.contains(campo) && /^(INPUT|SELECT|TEXTAREA)$/.test(campo.tagName)) return;
        renderView();
      } catch (error) {
        /* silencio */
      }
    }, 4000);
  }

  /* Repinta el listado y devuelve el cursor al buscador, para poder
     seguir escribiendo mientras la tabla se filtra sola. */
  function refrescarListado(idBuscador) {
    const activo = document.activeElement;
    const enBuscador = activo && activo.id === idBuscador;
    const cursor = enBuscador ? activo.selectionStart : 0;
    renderView();
    if (!enBuscador) return;
    const nuevo = document.getElementById(idBuscador);
    if (!nuevo) return;
    nuevo.focus();
    try {
      nuevo.setSelectionRange(cursor, cursor);
    } catch (error) {
      /* algunos tipos de input no permiten mover el cursor */
    }
  }

  function detenerPoll() {
    if (state.poll) clearInterval(state.poll);
    state.poll = null;
  }

  /* Acciones que necesitan la encuesta ya creada en el servidor */
  const REQUIERE_GUARDADA = [
    "sends", "ejecutar-ahora", "ejecutar-ahora-confirmado", "ejecutar-no-enviados",
    "ejecutar-no-enviados-confirmado", "recordar", "recordar-confirmado", "generar", "enviar", "cerrar",
    "public-link", "mensaje-instancia",
  ];

  async function runAction(act, arg, node) {
    const survey = state.draft;
    state.openMenu = "";

    if (state.esNueva && !arg && REQUIERE_GUARDADA.includes(act)) {
      showToast("Primero cree la encuesta o guárdela como borrador.");
      renderView();
      return;
    }

    try {
      if (await accionDashboard(act, arg)) return;
      if (await accionResultados(act, arg)) return;
      if (await accionSeguimiento(act, arg)) return;
      switch (act) {
        case "create": {
          const plantilla = await DL.api.plantilla(arg);
          abrirBorrador(plantilla, true);
          state.view = "survey-edit";
          state.step = STEPS[0][0];
          renderApp();
          showToast(`Encuesta ${arg.toLowerCase()} en blanco. Todavía no se guarda: use los botones de abajo.`);
          return;
        }

        /* ---------- Opciones de guardado del asistente ---------- */
        case "guardar-borrador": {
          if (!survey) return;
          clearTimeout(state.saveTimer);
          survey.status = "Borrador";
          survey.schedule.active = false;
          await persistir(survey);
          state.draft = null;
          await irA("survey-list");
          showToast("Guardada como borrador. Puede seguir editándola después.");
          return;
        }

        /* Paso 1: se revisa y se pide confirmación */
        case "crear-encuesta":
          if (!survey) return;
          pedirConfirmacion({
            titulo: state.esNueva ? "¿Crear y activar esta encuesta?" : "¿Guardar los cambios de esta encuesta?",
            accion: "crear-encuesta-confirmado",
            etiqueta: state.esNueva ? "Sí, crear encuesta" : "Sí, guardar cambios",
            survey,
          });
          return;

        case "confirmar-no":
          state.confirmar = null;
          renderView();
          return;

        case "confirmar-si": {
          const pendiente = state.confirmar;
          state.confirmar = null;
          if (!pendiente) return;
          renderView();
          return runAction(pendiente.accion, pendiente.arg);
        }

        /* Paso 2: lo que de verdad crea o guarda */
        case "crear-encuesta-confirmado":
        case "crear-y-enviar": {
          if (!survey) return;
          const faltan = checklist().filter((item) => !item[1]).map((item) => item[0]);
          if (faltan.length) {
            showToast("Falta completar: " + faltan.join(" · "));
            return;
          }
          clearTimeout(state.saveTimer);
          survey.status = "Activa";
          survey.schedule.active = survey.schedule.repeat !== "No repetir";
          const guardada = await persistir(survey);

          if (act === "crear-y-enviar") {
            const salida = await DL.api.ejecutar(guardada.id);
            state.instancias = await DL.api.instancias(guardada.id);
            state.surveys = await DL.api.encuestas();
            state.view = "sends";
            state.module = "surveys";
            renderApp();
            iniciarPoll("sends");
            showToast(`Encuesta creada y enviada: ${salida.instancias} encuesta(s), ${salida.envios.length} envío(s).`);
            return;
          }

          state.draft = null;
          await irA("survey-list");
          showToast("Encuesta creada y activada.");
          return;
        }

        case "cancelar": {
          if (!survey) return;
          const nueva = state.esNueva;
          const aviso = nueva
            ? "¿Descartar esta encuesta? No se guardó nada."
            : "¿Descartar los cambios y volver al listado?";
          if (!window.confirm(aviso)) return;
          clearTimeout(state.saveTimer);
          try {
            /* Si nunca se guardó no hay nada que borrar; si ya existía, se repone como estaba */
            if (!nueva && state.original) await DL.api.guardarEncuesta(state.original);
          } catch (error) {
            showToast("No se pudo deshacer: " + error.message);
          }
          state.draft = null;
          state.original = null;
          state.esNueva = false;
          await irA("survey-list");
          showToast(nueva ? "Encuesta descartada." : "Cambios descartados.");
          return;
        }

        case "edit": {
          const encuesta = await DL.api.encuesta(arg);
          const fila = state.surveys.find((item) => item.id === arg);
          if (fila) {
            encuesta._instancias = fila._instancias;
            encuesta._respondidas = fila._respondidas;
          }
          abrirBorrador(encuesta);
          state.view = "survey-edit";
          state.step = node && node.dataset.target ? node.dataset.target : STEPS[0][0];
          renderApp();
          return;
        }

        case "sends": {
          if (arg) abrirBorrador(await DL.api.encuesta(arg));
          state.instancias = await DL.api.instancias(state.draft.id);
          if (isExternal()) await cargarSeguimiento(state.draft.id);
          state.editorTab = "envios";
          state.view = "survey-edit";
          state.module = "surveys";
          renderApp();
          iniciarPoll("editor-envios");
          return;
        }

        case "duplicate":
          await DL.api.duplicarEncuesta(arg);
          state.surveys = await DL.api.encuestas();
          renderView();
          showToast("Encuesta duplicada como borrador.");
          return;

        case "toggle-status": {
          const encuesta = await DL.api.encuesta(arg);
          encuesta.status = encuesta.status === "Activa" ? "Inactiva" : "Activa";
          await DL.api.guardarEncuesta(encuesta);
          state.surveys = await DL.api.encuestas();
          renderView();
          showToast(`Encuesta ${encuesta.status.toLowerCase()}.`);
          return;
        }

        case "delete":
          if (!window.confirm("¿Eliminar esta encuesta y sus envíos?")) return;
          await DL.api.borrarEncuesta(arg);
          state.surveys = await DL.api.encuestas();
          if (state.draft && state.draft.id === arg) state.draft = null;
          renderView();
          showToast("Encuesta eliminada.");
          return;

        case "datos-prueba": {
          const cargados = (state.surveys || []).some((e) => e.id === "ext-prueba-doctores");
          let salida = null;
          if (cargados) {
            if (!window.confirm("¿Quitar la encuesta de prueba con todos sus envíos y respuestas?")) return;
            await DL.api.quitarDatosPrueba();
          } else {
            if (!window.confirm("Se agrega una encuesta externa con seis meses de envíos y respuestas inventadas. No se manda ningún WhatsApp. ¿Continuar?")) return;
            salida = await DL.api.cargarDatosPrueba();
          }
          state.draft = null;
          await recargarBase();
          state.view = "survey-list";
          renderApp();
          showToast(cargados ? "Datos de prueba quitados." : `Datos de prueba cargados: ${salida.envios} envíos a ${salida.doctores} doctores (${salida.periodos[0]} a ${salida.periodos[salida.periodos.length - 1]}).`);
          return;
        }

        case "reset-demo":
          if (!window.confirm("Esto borra las encuestas, los envíos y las respuestas. ¿Continuar?")) return;
          await DL.api.reiniciar();
          state.draft = null;
          await recargarBase();
          state.view = "survey-list";
          renderApp();
          showToast("Datos de demostración restaurados.");
          return;

        case "filter":
          state.listFilter = arg;
          renderView();
          return;

        /* ---------- Filtros de los listados ---------- */
        case "toggle-filtros":
          state.filtrosOpen = !state.filtrosOpen;
          renderView();
          return;

        case "limpiar-filtros":
          state.filtros = Object.assign({}, FILTROS_ENC);
          escribirFiltros(LS.enc, state.filtros);
          renderView();
          return;

        case "limpiar-texto":
          filtrosEnc().texto = "";
          escribirFiltros(LS.enc, state.filtros);
          renderView();
          return;

        case "toggle-filtros-trabajo":
          state.filtrosTrabajosOpen = !state.filtrosTrabajosOpen;
          renderView();
          return;

        case "limpiar-filtros-trabajo":
          state.traPagina = 1;
          state.filtrosTrabajos = Object.assign({}, FILTROS_TRA);
          escribirFiltros(LS.tra, state.filtrosTrabajos);
          renderView();
          return;

        case "limpiar-texto-trabajo":
          state.traPagina = 1;
          filtrosTra().texto = "";
          escribirFiltros(LS.tra, state.filtrosTrabajos);
          renderView();
          return;

        case "filtro-periodo": {
          state.traPagina = 1;
          const f = filtrosTra();
          const puesto = f.desde === DL.PERIODO_DESDE && f.hasta === DL.PERIODO_HASTA;
          f.desde = puesto ? "" : DL.PERIODO_DESDE;
          f.hasta = puesto ? "" : DL.PERIODO_HASTA;
          escribirFiltros(LS.tra, f);
          renderView();
          return;
        }

        case "answers-survey": {
          abrirBorrador(await DL.api.encuesta(arg));
          state.respuestas = await DL.api.respuestas(arg);
          if (isExternal()) await cargarRespuestasDoc(arg);
          state.editorTab = "respuestas";
          state.view = "survey-edit";
          state.module = "surveys";
          renderApp();
          return;
        }

        case "toggle-filtros-emp":
          state.filtrosEmpOpen = !state.filtrosEmpOpen;
          renderView();
          return;

        case "limpiar-filtros-emp":
          state.filtrosEmp = Object.assign({}, FILTROS_EMP);
          escribirFiltros(LS.emp, state.filtrosEmp);
          renderView();
          return;

        case "limpiar-texto-emp":
          filtrosEmp().texto = "";
          escribirFiltros(LS.emp, state.filtrosEmp);
          renderView();
          return;

        case "employee-detail": {
          state.empleado = null;
          state.empTab = "personales";
          state.view = "employee-detail";
          state.module = "lab";
          renderApp();
          state.empleado = await DL.api.empleado(arg);
          renderView();
          return;
        }

        case "emp-editar":
          showToast("La ficha se muestra en modo consulta: el mantenimiento del empleado vive en el módulo de Laboratorio del sistema.");
          return;

        case "editor-tab": {
          state.editorTab = arg;
          detenerPoll();
          /* Si la encuesta todavía no existe en el servidor no hay nada que
             consultar: el tab se pinta igual, con sus tablas vacías. */
          if (state.esNueva) {
            if (arg === "respuestas") state.respuestas = [];
            if (arg === "envios") state.instancias = [];
            state.seg = [];
            state.resp = [];
            renderView();
            return;
          }
          if (arg === "respuestas") state.respuestas = await DL.api.respuestas(survey.id);
          if (arg === "envios") state.instancias = await DL.api.instancias(survey.id);
          if (arg === "respuestas" && isExternal()) await cargarRespuestasDoc(survey.id);
          if (arg === "envios" && isExternal()) await cargarSeguimiento(survey.id);
          renderView();
          if (arg === "envios") iniciarPoll("editor-envios");
          return;
        }

        case "editar-encuesta":
          state.editando = true;
          state.editorTab = "detalle";
          renderView();
          showToast("Modo edición: ya puede cambiar la encuesta y guardar.");
          return;

        case "responder-bandeja": {
          const datos = await DL.api.instancia(arg);
          if (datos.instancia.state === "Completada") {
            showToast("Esta encuesta ya fue finalizada y no puede modificarse.");
            await cargarBandeja();
            renderView();
            return;
          }
          state.respondiendo = { instancia: datos.instancia, encuesta: datos.encuesta };
          state.view = "inbox";
          state.module = "surveys";
          renderApp();
          return;
        }

        case "cerrar-respuesta":
          state.respondiendo = null;
          await cargarBandeja();
          renderView();
          return;

        case "quitar-resp": {
          if (!survey) return;
          survey.excluded = [...new Set([...(survey.excluded || []), arg])];
          survey.respondents = (survey.respondents || []).filter((id) => id !== arg);
          guardar();
          renderView();
          return;
        }

        case "devolver-resp": {
          if (!survey) return;
          survey.excluded = (survey.excluded || []).filter((id) => id !== arg);
          survey.respondents = [...new Set([...(survey.respondents || []), arg])];
          guardar();
          renderView();
          return;
        }

        case "emp-tab":
          state.empTab = arg;
          renderView();
          return;

        case "result-detail": {
          state.resultado = null;
          state.resColab = null;
          state.volverA = state.view === "my-results" ? "my-results" : "results-list";
          state.view = "result-detail";
          state.module = "surveys";
          renderApp();
          state.resultado = await DL.api.resultado(arg);
          renderView();
          return;
        }

        case "work-findings":
          showToast("Los hallazgos se administran en el módulo de Hallazgos.");
          return;

        case "next-step": {
          const index = STEPS.findIndex(([id]) => id === state.step);
          state.step = STEPS[Math.min(index + 1, STEPS.length - 1)][0];
          renderView();
          return;
        }
        case "prev-step": {
          const index = STEPS.findIndex(([id]) => id === state.step);
          state.step = STEPS[Math.max(index - 1, 0)][0];
          renderView();
          return;
        }

        case "save":
          guardar("Cambios guardados.");
          return;

        case "publish": {
          const pending = checklist().filter(([, ok]) => !ok);
          if (pending.length) {
            showToast(`Faltan ${pending.length} punto(s) para publicar.`);
            return;
          }
          survey.status = "Activa";
          survey.schedule.active = survey.schedule.repeat !== "No repetir";
          guardar("Encuesta publicada y activa.");
          renderView();
          return;
        }

        case "preview":
          if (arg) abrirBorrador(await DL.api.encuesta(arg));
          openPreview();
          return;

        case "preview-reset":
          openPreview();
          return;

        case "public-link":
          window.open(`../doctor/index.html?s=${encodeURIComponent(survey ? survey.id : arg)}`, "_blank");
          return;

        case "open-instance":
          window.open(`../doctor/index.html?i=${encodeURIComponent(arg)}`, "_blank");
          return;

        /* ---------- ordenes ---------- */
        case "load-month": {
          const pick = document.getElementById("doctorPick");
          const doctor = arg || (pick && pick.value) || selectedWork().doctor;
          const list = DL.worksByDoctor(doctor, survey.works.statuses);
          survey.works.selectedIds = list.map((work) => work.id);
          survey.respondent = doctor;
          guardar(`${list.length} órdenes del período cargadas para ${doctor}.`);
          renderView();
          return;
        }
        case "toggle-doctor":
          state.openDoctor = state.openDoctor === arg ? "" : arg;
          renderView();
          return;

        case "preview-doctor":
          state.previewDoctor = arg;
          mountPreview();
          return;

        case "clear-works":
          survey.works.selectedIds = [];
          guardar();
          renderView();
          return;

        /* ---------- editor ---------- */
        case "add-section": {
          const section = DL.createSection({ title: `Nueva categoría ${survey.sections.length + 1}` });
          survey.sections.push(section);
          state.activeSectionId = section.id;
          state.activeQuestionId = section.questions[0].id;
          state.openQuestionId = state.activeQuestionId;
          guardar();
          renderView();
          return;
        }
        case "delete-section":
          if (survey.sections.length <= 1) return showToast("La encuesta debe conservar al menos una categoría.");
          survey.sections = survey.sections.filter((section) => section.id !== arg);
          state.activeSectionId = survey.sections[0].id;
          state.activeQuestionId = survey.sections[0].questions[0].id;
          guardar();
          renderView();
          return;
        case "move-section": {
          const [sectionId, direction] = arg.split(":");
          const index = survey.sections.findIndex((section) => section.id === sectionId);
          const target = index + (direction === "up" ? -1 : 1);
          if (target < 0 || target >= survey.sections.length) return;
          const [moved] = survey.sections.splice(index, 1);
          survey.sections.splice(target, 0, moved);
          guardar();
          renderView();
          return;
        }
        case "add-question": {
          const section = arg ? findSection(arg) : activeSection();
          const question = DL.createQuestion({
            area: section.questions.length ? section.questions[0].area : "Servicio al Cliente",
            workMode: section.useWorks ? "inherit" : "none",
          });
          section.questions.push(question);
          state.activeSectionId = section.id;
          state.activeQuestionId = question.id;
          state.openQuestionId = question.id;
          guardar();
          renderView();
          return;
        }
        case "duplicate-question": {
          const found = findQuestion(arg);
          const copy = DL.clone(found.question);
          copy.id = DL.uid("q");
          copy.text = `${copy.text} (copia)`;
          const index = found.section.questions.findIndex((item) => item.id === arg);
          found.section.questions.splice(index + 1, 0, copy);
          state.activeQuestionId = copy.id;
          state.openQuestionId = copy.id;
          guardar();
          renderView();
          return;
        }
        case "delete-question": {
          const found = findQuestion(arg);
          if (found.section.questions.length <= 1) return showToast("Cada categoría debe conservar al menos una pregunta.");
          found.section.questions = found.section.questions.filter((item) => item.id !== arg);
          state.activeQuestionId = found.section.questions[0].id;
          state.openQuestionId = state.activeQuestionId;
          guardar();
          renderView();
          return;
        }
        case "move-question": {
          const [questionId, direction] = arg.split(":");
          const found = findQuestion(questionId);
          const list = found.section.questions;
          const index = list.findIndex((item) => item.id === questionId);
          const target = index + (direction === "up" ? -1 : 1);
          if (target < 0 || target >= list.length) return;
          const [moved] = list.splice(index, 1);
          list.splice(target, 0, moved);
          guardar();
          renderView();
          return;
        }
        case "focus-question":
          state.openQuestionId = state.openQuestionId === arg ? "" : arg;
          state.activeQuestionId = arg;
          renderView();
          return;
        case "add-option": {
          const found = findQuestion(arg);
          found.question.options.push(`Opción ${found.question.options.length + 1}`);
          guardar();
          renderView();
          return;
        }
        case "remove-option": {
          const [questionId, index] = arg.split(":");
          const found = findQuestion(questionId);
          found.question.options.splice(Number(index), 1);
          if (!found.question.options.length) found.question.options.push("Opción 1");
          guardar();
          renderView();
          return;
        }
        case "add-catalog": {
          const [questionId, field] = arg.split(":");
          const input = document.getElementById(`cat-${questionId}-${field}`);
          const value = input ? input.value.trim() : "";
          if (!value) return;
          const found = findQuestion(questionId);
          if (!found.question[field].includes(value)) found.question[field].push(value);
          state.focusAfterRender = `cat-${questionId}-${field}`;
          guardar();
          renderView();
          return;
        }
        case "remove-catalog": {
          const [questionId, field, index] = arg.split(":");
          const found = findQuestion(questionId);
          found.question[field].splice(Number(index), 1);
          guardar();
          renderView();
          return;
        }

        /* ---------- agenda y envios ---------- */
        case "generar":
          state.instancias = await DL.api.generar(survey.id);
          if (isExternal()) await cargarSeguimiento(survey.id);
          renderView();
          showToast(`${state.instancias.length} encuesta(s) generada(s), una por doctor.`);
          return;

        case "enviar": {
          showToast("Enviando por WhatsApp…");
          const salida = await DL.api.enviar(survey.id);
          state.instancias = await DL.api.instancias(survey.id);
          if (isExternal()) await cargarSeguimiento(survey.id);
          renderView();
          const reales = salida.filter((item) => item.ok).length;
          const fallos = salida.length - reales;
          showToast(
            reales
              ? `${reales} mensaje(s) enviados a +${state.estado.destino}.`
              : `Sin conexión de WhatsApp: ${fallos} mensaje(s) quedaron en la bitácora (modo simulado).`
          );
          return;
        }

        case "ejecutar-ahora":
          if (!survey) return;
          pedirConfirmacion({
            titulo: (state.instancias || []).length
              ? "¿Volver a ejecutar? Se borra y se regenera todo el período"
              : "¿Ejecutar la encuesta por primera vez?",
            accion: "ejecutar-ahora-confirmado",
            etiqueta: (state.instancias || []).length ? "Sí, regenerar todo" : "Sí, ejecutar",
            survey,
          });
          return;

        case "recordar":
          if (!survey) return;
          pedirConfirmacion({
            titulo: "¿Enviar el recordatorio ahora?",
            accion: "recordar-confirmado",
            etiqueta: "Sí, recordar",
            survey,
          });
          return;

        case "recordar-confirmado": {
          showToast("Enviando recordatorios…");
          const salida = await DL.api.recordar(survey.id);
          state.instancias = await DL.api.instancias(survey.id);
          if (isExternal()) await cargarSeguimiento(survey.id);
          renderView();
          if (salida.motivo) {
            showToast("No se envió nada: " + salida.motivo + ".");
            return;
          }
          const reales = salida.enviados.filter((item) => item.ok).length;
          showToast(
            salida.enviados.length
              ? `${salida.enviados.length} recordatorio(s)${reales ? "" : " (quedaron en la bitácora: WhatsApp no está conectado)"}.`
              : "Nadie necesita recordatorio en este momento."
          );
          return;
        }

        case "ejecutar-no-enviados":
          if (!survey) return;
          pedirConfirmacion({
            titulo: "¿Ejecutar solo lo que falta?",
            accion: "ejecutar-no-enviados-confirmado",
            etiqueta: "Sí, ejecutar los no enviados",
            survey,
          });
          return;

        case "ejecutar-ahora-confirmado": {
          showToast("Ejecutando…");
          const salida = await DL.api.ejecutar(survey.id);
          state.instancias = await DL.api.instancias(survey.id);
          if (isExternal()) await cargarSeguimiento(survey.id);
          state.surveys = await DL.api.encuestas();
          renderView();
          showToast(`${salida.instancias} encuesta(s) generada(s), ${salida.envios.length} envío(s).`);
          return;
        }

        /* Conserva lo ya generado y respondido: solo agrega lo que falta
           y envía lo que nunca salió. */
        case "ejecutar-no-enviados-confirmado": {
          showToast("Ejecutando lo que falta…");
          const salida = await DL.api.completar(survey.id);
          state.instancias = await DL.api.instancias(survey.id);
          if (isExternal()) await cargarSeguimiento(survey.id);
          state.surveys = await DL.api.encuestas();
          renderView();
          showToast(
            salida.agregadas || salida.envios.length
              ? `${salida.agregadas} encuesta(s) agregada(s), ${salida.envios.length} envío(s).`
              : "No había nada pendiente: todo estaba generado y enviado."
          );
          return;
        }

        case "cerrar-ventana": {
          const salida = await DL.api.cerrar(survey.id);
          state.instancias = await DL.api.instancias(survey.id);
          if (isExternal()) await cargarSeguimiento(survey.id);
          renderView();
          showToast(`${salida.cerradas} encuesta(s) cerrada(s).`);
          return;
        }

        case "ver-mensaje": {
          const salida = await DL.api.mensajeInstancia(arg);
          window.alert(salida.texto);
          return;
        }

        /* ---------- whatsapp ---------- */
        case "wa-prueba": {
          const salida = await DL.api.pruebaWhatsapp();
          state.mensajes = await DL.api.mensajes();
          renderView();
          showToast(salida.ok ? `Mensaje enviado a +${state.estado.destino}.` : `No se envió: ${salida.error}`);
          return;
        }
        case "wa-conectar":
          await DL.api.conectarWhatsapp();
          showToast("Reintentando conexión con WhatsApp…");
          return;
        case "wa-salir":
          if (!window.confirm("¿Cerrar la sesión de WhatsApp? Tendrá que escanear el QR otra vez.")) return;
          await DL.api.salirWhatsapp();
          showToast("Sesión de WhatsApp cerrada.");
          return;

        /* ---------- trabajos ---------- */
        case "work-detail":
          state.selectedWorkId = arg;
          state.module = "works";
          state.view = "work-detail";
          state.workSurveys = null;
          renderApp();
          cargarEncuestasDelTrabajo(arg);
          return;

        case "survey-from-work": {
          state.selectedWorkId = arg;
          const work = selectedWork();
          const creada = await DL.api.crearEncuesta("Externa");
          creada.name = `Encuesta Externa: Servicio y Calidad - ${work.doctor}`;
          creada.respondent = work.doctor;
          creada.works.selectedIds = DL.worksByDoctor(work.doctor, creada.works.statuses).map((item) => item.id);
          await DL.api.guardarEncuesta(creada);
          state.surveys = await DL.api.encuestas();
          abrirBorrador(creada);
          state.module = "surveys";
          state.view = "survey-edit";
          state.step = "questions";
          renderApp();
          showToast(`Encuesta creada desde la orden ${work.code} con ${creada.works.selectedIds.length} trabajos.`);
          return;
        }

        default:
          return;
      }
    } catch (error) {
      showToast("Error: " + error.message);
    }
  }

  function onKeydown(event) {
    if (event.key !== "Enter") return;
    const catalogInput = event.target.closest("[data-catalog-input]");
    if (catalogInput) {
      event.preventDefault();
      runAction("add-catalog", catalogInput.dataset.catalogInput);
    }
  }

  function onInput(event) {
    const target = event.target;
    if (cambioDashboard(target, true)) return;
    if (cambioResultados(target, true)) return;
    if (cambioSeguimiento(target, true)) return;

    /* Los filtros de los listados viven fuera del editor */
    if (target.matches("[data-filtro]")) {
      filtrosEnc()[target.dataset.filtro] = target.value;
      escribirFiltros(LS.enc, state.filtros);
      refrescarListado("buscarEncuesta");
      return;
    }
    if (target.matches("[data-filtro-trabajo]")) {
      state.traPagina = 1;
      filtrosTra()[target.dataset.filtroTrabajo] = target.value;
      escribirFiltros(LS.tra, state.filtrosTrabajos);
      refrescarListado("buscarTrabajo");
      return;
    }
    if (target.matches("[data-tra-por-pagina]")) {
      state.traPorPagina = Number(target.value) || 50;
      state.traPagina = 1;
      renderView();
      return;
    }
    if (target.matches("[data-filtro-emp]")) {
      filtrosEmp()[target.dataset.filtroEmp] = target.value;
      escribirFiltros(LS.emp, state.filtrosEmp);
      refrescarListado("buscarEmpleado");
      return;
    }

    if (!state.draft) return;

    if (target.matches("[data-survey-field]")) {
      state.draft[target.dataset.surveyField] = target.value;
      guardar();
      const title = document.getElementById("editorTitle");
      if (title) title.textContent = state.draft.name;
      return;
    }
    if (target.matches("[data-sched-field]")) {
      state.draft.schedule[target.dataset.schedField] = target.value;
      guardar();
      return;
    }
    if (target.matches("[data-rec-field]")) {
      state.draft.reminders = state.draft.reminders || {};
      state.draft.reminders[target.dataset.recField] = target.value;
      guardar();
      return;
    }
    if (target.matches("[data-works-field]")) {
      state.draft.works[target.dataset.worksField] = target.value;
      guardar();
      return;
    }
    const sectionShell = target.closest("[data-section-id]");
    if (sectionShell && target.matches("[data-section-field]")) {
      findSection(sectionShell.dataset.sectionId)[target.dataset.sectionField] = target.value;
      guardar();
      return;
    }
    const questionCard = target.closest("[data-question-id]");
    if (!questionCard) return;
    const found = findQuestion(questionCard.dataset.questionId);
    if (!found) return;
    if (target.matches("[data-question-field]")) {
      found.question[target.dataset.questionField] = target.value;
      guardar();
    }
    if (target.matches("[data-option-index]")) {
      found.question.options[Number(target.dataset.optionIndex)] = target.value;
      guardar();
    }
  }

  function onChange(event) {
    const target = event.target;
    if (cambioDashboard(target, false)) return;
    if (cambioResultados(target, false)) return;
    if (cambioSeguimiento(target, false)) return;

    if (target.matches("[data-filtro]")) {
      filtrosEnc()[target.dataset.filtro] = target.value;
      escribirFiltros(LS.enc, state.filtros);
      renderView();
      return;
    }
    if (target.matches("[data-filtro-trabajo]")) {
      state.traPagina = 1;
      filtrosTra()[target.dataset.filtroTrabajo] = target.value;
      escribirFiltros(LS.tra, state.filtrosTrabajos);
      renderView();
      return;
    }
    if (target.matches("[data-filtro-check]")) {
      filtrosEnc()[target.dataset.filtroCheck] = target.checked;
      escribirFiltros(LS.enc, state.filtros);
      renderView();
      return;
    }
    if (target.matches("[data-filtro-emp]")) {
      filtrosEmp()[target.dataset.filtroEmp] = target.value;
      escribirFiltros(LS.emp, state.filtrosEmp);
      renderView();
      return;
    }
    if (target.matches("[data-filtro-emp-check]")) {
      filtrosEmp()[target.dataset.filtroEmpCheck] = target.checked;
      escribirFiltros(LS.emp, state.filtrosEmp);
      renderView();
      return;
    }

    if (!state.draft) return;
    const survey = state.draft;

    /* Área o modo de asignación: se vuelven a calcular los respondedores */
    if (target.matches('[data-survey-field="areaKey"], [data-survey-field="assignMode"]')) {
      survey[target.dataset.surveyField] = target.value;
      if (target.dataset.surveyField === "assignMode") {
        survey.excluded = [];
        if (target.value === "Manual") survey.respondents = [];
      }
      guardar();
      recalcularAlcance({ conservarQuitados: target.dataset.surveyField === "areaKey" ? false : true });
      return;
    }
    if (target.matches("[data-resp-pick]")) {
      const id = target.dataset.respPick;
      const lista = new Set(survey.respondents || []);
      if (target.checked) lista.add(id);
      else lista.delete(id);
      survey.respondents = [...lista];
      guardar();
      /* Solo se actualizan los contadores: así se pueden marcar varios seguidos */
      const contador = document.querySelector(".asig-item--pink:last-child b");
      if (contador) contador.textContent = `${survey.respondents.length} colaborador(es)`;
      const registros = document.querySelector(".wk-count");
      if (registros) registros.textContent = `${survey.respondents.length} registro(s)`;
      const fila = target.closest("tr");
      if (fila) fila.classList.toggle("fila-fuera", !target.checked);
      return;
    }

    if (target.matches("[data-survey-field]")) {
      survey[target.dataset.surveyField] = target.dataset.surveyField === "anonymous" ? target.value === "true" : target.value;
      if (["periodFrom", "periodTo"].includes(target.dataset.surveyField)) sincronizarPeriodo(survey);
      guardar();
      renderView();
      refreshPreview();
      return;
    }
    if (target.matches("[data-preview-doctor]")) {
      state.previewDoctor = target.value;
      mountPreview();
      return;
    }
    if (target.matches("[data-survey-check]")) {
      survey[target.dataset.surveyCheck] = target.checked;
      if (target.dataset.surveyCheck === "periodAuto") sincronizarPeriodo(survey);
      guardar();
      renderView();
      refreshPreview();
      return;
    }
    if (target.matches("[data-sched-check]")) {
      survey.schedule[target.dataset.schedCheck] = target.checked;
      guardar();
      renderView();
      return;
    }
    if (target.matches("[data-rec-field]")) {
      survey.reminders = survey.reminders || {};
      survey.reminders[target.dataset.recField] = target.value;
      guardar();
      renderView();
      return;
    }
    if (target.matches("[data-rec-check]")) {
      survey.reminders = survey.reminders || {};
      survey.reminders[target.dataset.recCheck] = target.checked;
      guardar();
      renderView();
      return;
    }
    if (target.matches("[data-sched-field]")) {
      survey.schedule[target.dataset.schedField] = target.value;
      /* La agenda corre sola siempre que la encuesta se repita */
      if (target.dataset.schedField === "repeat") {
        survey.schedule.active = target.value !== "No repetir";
      }
      guardar();
      renderView();
      return;
    }
    if (target.matches("[data-works-field]")) {
      survey.works[target.dataset.worksField] = target.value;
      guardar();
      renderView();
      return;
    }
    if (target.matches("[data-works-check]")) {
      survey.works[target.dataset.worksCheck] = target.checked;
      if (target.dataset.worksCheck === "enabled" && !target.checked) {
        survey.sections.forEach((section) => {
          section.useWorks = false;
          section.allowedModes = [];
          section.questions.forEach((question) => (question.workMode = "none"));
        });
      }
      guardar();
      renderView();
      refreshPreview();
      return;
    }
    if (target.matches("[data-status-filter]")) {
      survey.works.statuses = toggle(survey.works.statuses, target.dataset.statusFilter, target.checked);
      guardar();
      renderView();
      return;
    }
    if (target.matches("[data-selected-work]")) {
      survey.works.selectedIds = toggle(survey.works.selectedIds, target.dataset.selectedWork, target.checked);
      guardar();
      renderView();
      refreshPreview();
      return;
    }
    if (target.matches("[data-doctor-pick]")) {
      const doctor = target.dataset.doctorPick;
      survey.audienceDoctors = toggle(survey.audienceDoctors || [], doctor, target.checked);
      const suyas = DL.worksByDoctor(doctor, survey.works.statuses, survey.periodFrom, survey.periodTo).map((work) => work.id);
      survey.works.selectedIds = target.checked
        ? [...new Set([...survey.works.selectedIds, ...suyas])]
        : survey.works.selectedIds.filter((id) => !suyas.includes(id));
      guardar();
      renderView();
      refreshPreview();
      return;
    }
    if (target.matches("[data-area-pick]")) {
      survey.audienceAreas = toggle(survey.audienceAreas || [], target.dataset.areaPick, target.checked);
      guardar();
      renderView();
      return;
    }

    const sectionShell = target.closest("[data-section-id]");
    if (sectionShell) {
      const section = findSection(sectionShell.dataset.sectionId);
      if (target.matches("[data-section-field]")) {
        section[target.dataset.sectionField] = target.value;
        guardar();
        renderView();
        refreshPreview();
        return;
      }
      if (target.matches("[data-section-check]")) {
        section[target.dataset.sectionCheck] = target.checked;
        if (target.dataset.sectionCheck === "useWorks") {
          if (target.checked) {
            section.allowedModes = ["general"];
            section.questions.forEach((question) => {
              if (question.workMode === "none") question.workMode = "inherit";
            });
          } else {
            section.allowedModes = [];
            section.questions.forEach((question) => (question.workMode = "none"));
          }
        }
        guardar();
        renderView();
        refreshPreview();
        return;
      }
      if (target.matches("[data-section-mode]")) {
        section.allowedModes = toggle(section.allowedModes || [], target.dataset.sectionMode, target.checked);
        guardar();
        renderView();
        refreshPreview();
        return;
      }
    }

    const questionCard = target.closest("[data-question-id]");
    if (!questionCard) return;
    const found = findQuestion(questionCard.dataset.questionId);
    if (!found) return;
    if (target.matches("[data-question-field]")) {
      found.question[target.dataset.questionField] =
        target.dataset.questionField === "lowThreshold" ? Number(target.value) : target.value;
      guardar();
      renderView();
      refreshPreview();
      return;
    }
    if (target.matches("[data-question-check]")) {
      found.question[target.dataset.questionCheck] = target.checked;
      guardar();
      renderView();
      refreshPreview();
    }
  }

  function toggle(list, value, enabled) {
    const set = new Set(list || []);
    enabled ? set.add(value) : set.delete(value);
    return [...set];
  }

  /* ==================================================================
     Render
     ================================================================== */
  function renderApp() {
    renderModuleNav();
    renderSidebar();
    renderView();
  }

  /* Modo consulta: los campos y los botones que cambian la encuesta
     quedan deshabilitados hasta que se pulse el lápiz de Editar. */
  function bloquearEdicion() {
    const cuerpo = els.appView.querySelector(".edit-body");
    if (!cuerpo) return;
    cuerpo.querySelectorAll("input, select, textarea").forEach((campo) => {
      campo.disabled = true;
    });
    cuerpo.querySelectorAll("button").forEach((boton) => {
      /* Lo que solo mira, no edita, sigue activo en modo consulta:
         la vista previa, el enlace público y desplegar un doctor. */
      if (["preview", "public-link", "toggle-doctor"].includes(boton.dataset.act)) return;
      boton.disabled = true;
    });
  }

  /* Quién está dentro, en la barra de arriba */
  function pintarUsuario(empleado) {
    const avatar = document.getElementById("userAvatar");
    const nombre = document.getElementById("userName");
    const rol = document.getElementById("userRole");
    const salir = document.getElementById("logoutBtn");
    if (avatar) avatar.textContent = DL_SESION.iniciales(empleado.name);
    if (nombre) nombre.textContent = empleado.name;
    if (rol) rol.textContent = empleado.position || "";
    if (salir) salir.addEventListener("click", () => DL_SESION.salir("../"));
  }

  function renderModuleNav() {
    const visibles = esAdmin() ? modules : modules.filter(([id]) => id === "surveys");
    els.moduleNav.innerHTML =
      visibles
        .map(([id, label]) => `<button class="module-tab ${state.module === id ? "active" : ""}" type="button" data-module="${id}">${label}</button>`)
        .join("") + (esAdmin() ? waChip() : "");
  }

  function waChip() {
    const wa = state.estado ? state.estado.whatsapp : {};
    let clase = "sim";
    let texto = "WhatsApp simulado";
    if (wa.conectado) {
      clase = "on";
      texto = `WhatsApp +${wa.numero}`;
    } else if (wa.qrTexto) {
      clase = "qr";
      texto = "WhatsApp: escanear QR";
    } else if (wa.disponible) {
      clase = "qr";
      texto = "WhatsApp conectando…";
    }
    return `<button class="wa-chip ${clase}" id="waChip" type="button" data-view="whatsapp" title="Ver estado de WhatsApp">${esc(texto)}</button>`;
  }

  function renderSidebar() {
    if (state.module === "dashboard") {
      renderDashSidebar();
      return;
    }
    if (state.module === "works") {
      els.sidebar.innerHTML = `
        <div class="side-title">TRABAJOS</div>
        <div class="side-search"><input placeholder="Código (ej: 15281)"></div>
        <button class="side-link active" type="button" data-view="work-list">Trabajos</button>`;
      return;
    }

    /* En Laboratorio va el personal y el estado de WhatsApp */
    if (state.module === "lab") {
      els.sidebar.innerHTML = `
        <div class="side-title">LABORATORIO</div>
        <button class="side-link ${state.view === "employees" ? "active" : ""}" type="button" data-view="employees">Empleados</button>
        <button class="side-link ${state.view === "whatsapp" ? "active" : ""}" type="button" data-view="whatsapp">WhatsApp</button>`;
      return;
    }

    /* Quien no administra el módulo solo ve lo suyo. La navegación vive
       en los tabs, así que aquí va una sola entrada. */
    if (!esAdmin()) {
      els.sidebar.innerHTML = `
        <div class="side-title">ENCUESTAS</div>
        <button class="side-link active" type="button" data-view="inbox">Encuestas</button>`;
      return;
    }

    els.sidebar.innerHTML = `
      <div class="side-title">ENCUESTAS</div>
      ${/* Bandeja, Mis encuestas y Mis resultados viven en sus tres pestañas */ ""}
      <button class="side-link ${["survey-list", "survey-edit", "inbox", "my-results", "resp-detail", "doctor-history"].includes(state.view) ? "active" : ""}" type="button" data-view="survey-list">Encuestas</button>
      <button class="side-link ${["results-list", "result-detail", "doctor-result"].includes(state.view) ? "active" : ""}" type="button" data-view="results-list">Resultados de encuestas</button>
      <div class="side-foot">
        <button class="mini-btn" type="button" data-act="datos-prueba">${(state.surveys || []).some((e) => e.id === "ext-prueba-doctores") ? "Quitar datos de prueba" : "Cargar datos de prueba"}</button>
        <button class="mini-btn" type="button" data-act="reset-demo">Restaurar demo</button>
      </div>`;
  }

  function renderView() {
    const vistas = {
      "survey-list": renderSurveyList,
      "survey-edit": renderEditor,
      sends: renderSends,
      answers: renderAnswers,
      results: renderResults,
      whatsapp: renderWhatsapp,
      "work-list": renderWorkList,
      "work-detail": renderWorkDetail,
      employees: renderEmpleados,
      "employee-detail": renderEmpleadoDetalle,
      inbox: renderBandejaInterna,
      "my-results": renderMisResultados,
      "results-list": renderResultadosLista,
      "result-detail": renderResultadoDetalle,
      "doctor-result": renderDoctorDetalle,
      "resp-detail": renderRespuestaDetalle,
      "doctor-history": renderHistoricoDoctor,
      dashboard: renderDashboard,
    };
    if (["survey-edit"].includes(state.view) && !state.draft) state.view = "survey-list";
    if (state.view === "sends" && !state.draft) {
      els.appView.innerHTML = renderSendsPicker();
      return;
    }
    /* Quien no administra el módulo solo entra a su bandeja y sus resultados */
    const permitidas = esJefe() ? ["inbox", "my-results", "result-detail"] : ["inbox"];
    if (!esAdmin() && !permitidas.includes(state.view)) state.view = "inbox";

    els.appView.innerHTML = (vistas[state.view] || (esAdmin() ? renderSurveyList : renderBandejaInterna))() + renderConfirmar();
    if (state.view === "inbox" && state.respondiendo) montarRespuesta();
    if (state.view === "survey-edit" && !state.editando) bloquearEdicion();
    if (state.focusAfterRender) {
      const node = document.getElementById(state.focusAfterRender);
      if (node) {
        node.focus();
        node.value = "";
      }
      state.focusAfterRender = "";
    }
  }

  /* ---------------- Lista ---------------- */
  /* ==================================================================
     Verificación antes de guardar o de ejecutar
     "errores" impiden continuar; "avisos" solo advierten y el usuario
     decide. Así nadie activa una encuesta a medio configurar sin saberlo.
     ================================================================== */
  function revisar(survey) {
    const secciones = (survey.sections || []).filter((sec) => sec.active !== false);
    const preguntas = secciones.flatMap((sec) => (sec.questions || []).filter((q) => q.active !== false));
    const externa = survey.classification === "Externa";
    const errores = [];
    const avisos = [];

    if (!String(survey.name || "").trim()) errores.push("La encuesta no tiene nombre.");
    if (preguntas.length === 0) errores.push("No hay ninguna pregunta activa.");
    const sinArea = preguntas.filter((q) => !q.area).length;
    if (sinArea) errores.push(`${sinArea} pregunta(s) sin área responsable.`);

    if (externa && survey.channel === "API WhatsApp" && !String(survey.whatsappMessage || "").trim()) {
      errores.push("El canal es WhatsApp pero el mensaje está vacío.");
    }
    const rec = survey.reminders || {};
    if (externa && rec.active !== false && survey.channel === "API WhatsApp" && !String(rec.message || "").trim()) {
      errores.push("Los recordatorios están activos pero el mensaje del recordatorio está vacío.");
    }
    if (externa && survey.audienceMode === "Selección manual") {
      if (!(survey.audienceDoctors || []).length) errores.push("No se seleccionó ningún doctor.");
      if (!(survey.works.selectedIds || []).length) errores.push("No se seleccionó ninguna orden.");
    }
    if (!externa && !survey.areaKey) errores.push("La encuesta interna no tiene área asignada.");

    /* Avisos: se puede guardar igual, pero conviene saberlo */
    const sinTitulo = preguntas.filter((q) => /^pregunta sin t[íi]tulo$/i.test(String(q.text || "").trim())).length;
    if (sinTitulo) avisos.push(`${sinTitulo} pregunta(s) siguen con el texto por defecto "Pregunta sin título".`);
    const catSinNombre = secciones.filter((sec) => /^nueva categor[íi]a$/i.test(String(sec.title || "").trim())).length;
    if (catSinNombre) avisos.push(`${catSinNombre} categoría(s) siguen llamándose "Nueva categoría".`);
    if (!String(survey.description || "").trim()) avisos.push("La encuesta no tiene descripción: quien la abra no verá ninguna explicación.");
    if (!survey.schedule.startDate || !survey.schedule.endDate) {
      avisos.push("La ventana de disponibilidad está incompleta.");
    } else if (survey.schedule.endDate < new Date().toISOString().slice(0, 10)) {
      avisos.push("La ventana de disponibilidad ya terminó: no se ejecutará sola.");
    }
    if (externa) {
      const doctores = [...new Set(elegibles().map((w) => w.doctor))].length;
      if (!doctores) avisos.push(`El período ${etiquetaPeriodo()} no tiene órdenes enviadas: no se generaría ninguna encuesta.`);
    } else {
      const cuantos = (survey.respondents || []).length || ((state.alcanceInterno && state.alcanceInterno.gente) || []).length;
      if (!cuantos) avisos.push("No hay colaboradores que respondan esta encuesta.");
    }

    /* Lo que sí está listo, para que el usuario lo vea de un vistazo */
    const listo = [
      `${secciones.length} categoría(s) y ${preguntas.length} pregunta(s)`,
      externa
        ? `${survey.audienceMode === "Selección manual" ? `${(survey.audienceDoctors || []).length} doctor(es) elegidos` : "todos los doctores del período"} · ${esc(etiquetaPeriodo())}`
        : `área ${survey.areaKey || "—"} · ${(survey.respondents || []).length || "—"} colaborador(es)`,
      `canal ${survey.channel} · repetición ${survey.schedule.repeat}`,
      externa && survey.channel === "API WhatsApp"
        ? (rec.active !== false
            ? `recordatorios cada ${Math.max(1, Number(rec.everyDays) || 3)} día(s) a las ${String(rec.time || "09:00").slice(0, 5)}, hasta ${Math.max(1, Number(rec.max) || 2)} por doctor`
            : "sin recordatorios")
        : "",
    ].filter(Boolean);

    return { errores, avisos, listo };
  }

  /* Abre el diálogo; si no hay nada que advertir igual se muestra el
     resumen, porque la idea es que el usuario confirme a conciencia. */
  function pedirConfirmacion({ titulo, accion, etiqueta, survey }) {
    const { errores, avisos, listo } = revisar(survey);
    state.confirmar = { titulo, accion, etiqueta, errores, avisos, listo };
    renderView();
  }

  function renderConfirmar() {
    const c = state.confirmar;
    if (!c) return "";
    const bloqueado = c.errores.length > 0;

    return `
      <div class="dl-modal-fondo">
        <div class="dl-modal" role="dialog" aria-modal="true">
          <div class="dl-modal-head">
            <b>${esc(c.titulo)}</b>
          </div>
          <div class="dl-modal-body">
            ${bloqueado ? `
              <p class="dl-modal-intro">No se puede continuar hasta corregir esto:</p>
              <ul class="dl-check mal">${c.errores.map((t) => `<li>${esc(t)}</li>`).join("")}</ul>
            ` : ""}

            ${c.avisos.length ? `
              <p class="dl-modal-intro">${bloqueado ? "Además, revise:" : "Antes de continuar, revise:"}</p>
              <ul class="dl-check aviso">${c.avisos.map((t) => `<li>${esc(t)}</li>`).join("")}</ul>
            ` : ""}

            ${!bloqueado && !c.avisos.length ? `<p class="dl-modal-intro">Todo está configurado. Así va a quedar:</p>` : ""}
            ${!bloqueado ? `<ul class="dl-check bien">${c.listo.map((t) => `<li>${t}</li>`).join("")}</ul>` : ""}
          </div>
          <div class="dl-modal-pie">
            ${bloqueado
              ? `<button class="dercas-btn" type="button" data-act="confirmar-no">Volver a revisar</button>`
              : `<button class="dercas-btn ok" type="button" data-act="confirmar-si">${esc(c.etiqueta)}</button>
                 <button class="dercas-btn cancel" type="button" data-act="confirmar-no">Volver a revisar</button>`}
          </div>
        </div>
      </div>`;
  }

  /* ==================================================================
     ENCUESTAS · Mis resultados (jefes de área)
     ================================================================== */
  /* La API trae la bandeja y los resultados juntos: se guardan los dos
     para que los tres tabs muestren sus contadores al instante. */
  async function cargarPersonal() {
    if (!sesion) return;
    try {
      const datos = await DL.api.portalBandeja(sesion.id);
      state.bandeja = datos.bandeja || [];
      state.misResultados = datos.resultados || [];
    } catch (error) {
      state.bandeja = [];
      state.misResultados = [];
    }
  }

  const cargarMisResultados = cargarPersonal;

  function renderMisResultados() {
    const list = state.misResultados || [];

    return `
      <div class="dl-tabs">
        <div class="dl-tabs-list">${tabsEncuestas("my-results", state.surveys.length || null)}</div>
      </div>

      ${list.length === 0
        ? `<section class="dl-card">
             <div class="dl-table-wrap">
               <table class="dl-table"><tbody><tr><td colspan="7">${esJefe()
                 ? "Todavía no hay resultados. Aparecerán cuando su equipo complete una encuesta en la que usted es el evaluado."
                 : "Aquí verá el resultado de las encuestas en las que usted sea el evaluado. Se llena cuando tiene personal a cargo y ese equipo responde su encuesta."}</td></tr></tbody></table>
             </div>
           </section>`
        : `<section class="dl-card">
             <div class="dl-table-wrap">
               <table class="dl-table">
                 <thead><tr><th>Encuesta</th><th>Período</th><th>Área</th><th>Asignadas</th><th>Respuestas</th><th>Promedio</th><th class="dl-col-opts">Acción</th></tr></thead>
                 <tbody>
                   ${list.map((r) => `
                     <tr class="dl-row-link" data-row-open="result-detail" data-row-arg="${esc(r.id)}">
                       <td><b>${esc(r.surveyName)}</b></td>
                       <td>${esc(r.periodLabel)}</td>
                       <td>${esc(r.area)}</td>
                       <td><span class="dl-badge">${r.asignadas}</span></td>
                       <td><span class="dl-badge ${r.respuestas ? "ok" : "off"}">${r.respuestas}</span></td>
                       <td><b class="${r.escala === "Regular" ? "wk-bad" : "wk-good"}">${esc(r.promedio)}</b> <i>${esc(r.escala)}</i></td>
                       <td class="dl-col-opts"><button class="dl-mini" type="button" data-act="result-detail" data-arg="${esc(r.id)}">Ver detalle</button></td>
                     </tr>`).join("")}
                 </tbody>
               </table>
             </div>
             <div class="dl-table-foot"><span>${list.length} período(s) · respuestas anónimas</span></div>
           </section>`}`;
  }

  /* ==================================================================
     ENCUESTAS · Mis encuestas: las asignadas a quien está usando el sistema
     Aquí responde su propia encuesta interna, sin salir del módulo.
     ================================================================== */
  const cargarBandeja = cargarPersonal;

  function renderBandejaInterna() {
    /* Si está respondiendo, se muestra la encuesta y nada más */
    if (state.respondiendo) return pantallaRespuesta();

    const pendientes = state.bandeja.filter((i) => !i.respondida);
    const hechas = state.bandeja.filter((i) => i.respondida);

    return `
      <div class="dl-tabs">
        <div class="dl-tabs-list">${tabsEncuestas("inbox")}</div>
      </div>

      ${state.bandeja.length === 0
        ? `<section class="dl-card">
             <div class="dl-table-wrap">
               <table class="dl-table"><tbody><tr><td colspan="6">No tiene encuestas asignadas.</td></tr></tbody></table>
             </div>
           </section>`
        : ""}

      ${pendientes.length ? `
        <section class="dl-card">
          <div class="wk-block-head"><div><b>Pendientes</b></div><span class="wk-count">${pendientes.length}</span></div>
          <div class="dl-table-wrap">
            <table class="dl-table">
              <thead><tr><th>Encuesta</th><th>Subcategoría</th><th>Período</th><th>Evalúa a</th><th>Preguntas</th><th>Estado</th><th class="dl-col-opts">Acción</th></tr></thead>
              <tbody>
                ${pendientes.map((item) => `
                  <tr>
                    <td><b>${esc(item.surveyName)}</b></td>
                    <td>${esc(item.subtype)}</td>
                    <td>${esc(item.period)}</td>
                    <td>${esc(item.supervisor || "—")}</td>
                    <td>${item.preguntas}</td>
                    <td><span class="dl-badge warn">${esc(item.state)}</span></td>
                    <td class="dl-col-opts"><button class="dl-mini" type="button" data-act="responder-bandeja" data-arg="${attr(item.instanceId)}">Responder</button></td>
                  </tr>`).join("")}
              </tbody>
            </table>
          </div>
        </section>` : ""}

      ${hechas.length ? `
        <section class="dl-card">
          <div class="wk-block-head"><div><b>Respondidas</b></div><span class="wk-count">${hechas.length}</span></div>
          <div class="dl-table-wrap">
            <table class="dl-table">
              <thead><tr><th>Encuesta</th><th>Subcategoría</th><th>Período</th><th>Evalúa a</th><th>Estado</th><th>Respondida</th></tr></thead>
              <tbody>
                ${hechas.map((item) => `
                  <tr>
                    <td><b>${esc(item.surveyName)}</b></td>
                    <td>${esc(item.subtype)}</td>
                    <td>${esc(item.period)}</td>
                    <td>${esc(item.supervisor || "—")}</td>
                    <td><span class="dl-badge ok">Respondida</span></td>
                    <td>${esc(item.finishedAt || "—")}</td>
                  </tr>`).join("")}
              </tbody>
            </table>
          </div>
        </section>` : ""}`;
  }

  /* La encuesta se responde con el mismo motor que la vista previa */
  function pantallaRespuesta() {
    const { encuesta, instancia } = state.respondiendo;
    return `
      <div class="dl-tabs">
        <div class="dl-tabs-list">${tabsEncuestas("inbox")}</div>
        <div class="dl-tabs-actions">
          <button class="dl-tab-action" type="button" data-act="cerrar-respuesta">Volver a mis encuestas</button>
        </div>
      </div>

      <div class="bandeja-responder">
        <div class="preview-device">
          <div class="preview-device-top">
            <img src="../assets/LOGO_DLABS2.png" alt="Digital Labs">
            <div><b>${esc(encuesta.subtype || "Encuesta interna")}</b><span>${esc(instancia.periodLabel || "")}${instancia.supervisor ? ` · ${esc(instancia.supervisor)}` : ""}</span></div>
          </div>
          <div class="preview-device-body" id="bandejaMount"></div>
        </div>
        <p class="dl-muted bandeja-nota">Respuestas anónimas.</p>
      </div>`;
  }

  /* Monta el motor después de pintar la pantalla */
  function montarRespuesta() {
    if (!state.respondiendo) return;
    const nodo = document.getElementById("bandejaMount");
    if (!nodo) return;
    const { encuesta, instancia } = state.respondiendo;

    DL.createRuntime({
      mount: nodo,
      survey: DL.clone(encuesta),
      works: [],
      respondent: instancia.doctor,
      onOpen() {
        DL.api.abrirInstancia(instancia.id).catch(() => {});
      },
      async onFinish(respuestas) {
        await DL.api.responder(instancia.id, respuestas);
        showToast("¡Gracias! Sus respuestas quedaron registradas.");
        setTimeout(async () => {
          state.respondiendo = null;
          await cargarBandeja();
          renderView();
        }, 1800);
      },
    });
  }

  /* Los tres tabs del módulo */
  /* Los tres tabs del módulo, desde el punto de vista de quien entró:
     lo que le toca responder, las encuestas que administra y cómo lo
     evaluaron a él. */
  /* Los tres tabs del módulo:
       Bandeja encuestas -> todas las encuestas del módulo (administración)
       Mis encuestas     -> solo las que le asignaron a quien entró
       Mis resultados    -> el resultado de las encuestas en las que él
                            fue el evaluado
     Quien no administra el módulo ve únicamente los dos últimos. */
  function tabsEncuestas(vista, total) {
    const asignadas = (state.bandeja || []).filter((i) => !i.respondida).length;
    const resultados = (state.misResultados || []).length;
    return `
      ${esAdmin() ? `<button class="dl-tab ${["survey-list", "survey-edit"].includes(vista) ? "is-active" : ""}" type="button" data-view="survey-list">Bandeja encuestas${total != null ? ` (${total})` : ""}</button>` : ""}
      <button class="dl-tab ${vista === "inbox" ? "is-active" : ""}" type="button" data-view="inbox">Mis encuestas${asignadas ? ` <i class="dl-pend">${asignadas}</i>` : ""}</button>
      <button class="dl-tab ${vista === "my-results" ? "is-active" : ""}" type="button" data-view="my-results">Mis resultados${resultados ? ` (${resultados})` : ""}</button>`;
  }

  function renderSurveyList() {
    const all = state.surveys;
    const f = filtrosEnc();
    const list = encuestasFiltradas();
    const cuenta = cuentaFiltros(f, FILTROS_ENC);
    return `
      <div class="dl-tabs ${state.openMenu === "nueva" ? "menu-open" : ""}">
        <div class="dl-tabs-list">${tabsEncuestas("survey-list", all.length)}</div>
        <div class="dl-tabs-actions">
          <div class="menu-wrap">
            <button class="dl-tab-action dl-tab-action--primary" type="button" data-menu="nueva">Nueva encuesta</button>
            ${state.openMenu === "nueva" ? `
              <div class="menu-pop nueva">
                <button type="button" data-act="create" data-arg="Interna">Interna</button>
                <button type="button" data-act="create" data-arg="Externa">Externa</button>
              </div>` : ""}
          </div>
        </div>
      </div>

      <section class="dl-card ${state.openMenu ? "menu-open" : ""}">
        <div class="dl-filters">
          ${barraFiltros(state.filtrosOpen, cuenta)}
          ${state.filtrosOpen ? `
            <div class="dl-filter-panel">
              ${campoFiltro("Clasificación", "clasificacion", ["Externa", "Interna"], f.clasificacion)}
              ${campoFiltro("Estado", "estado", ["Borrador", "Activa", "Inactiva"], f.estado)}
              ${campoFiltro("Subcategoría", "subcategoria", unicos(all, "subtype"), f.subcategoria)}
              ${campoFiltro("Repetición", "repeticion", ["No repetir", "Mensual", "Trimestral", "Anual"], f.repeticion)}
              ${campoFiltro("Responde", "responde", unicos(all, "respondent"), f.responde)}
              <label class="dl-field dl-field--wide"><span>Búsqueda</span>
                <div class="dl-search">
                  <span class="dl-ico">⌕</span>
                  <input id="buscarEncuesta" data-filtro="texto" value="${attr(f.texto)}" placeholder="Encuesta, subcategoría o quién responde…">
                  ${f.texto ? `<button class="dl-search-clear" type="button" data-act="limpiar-texto" title="Limpiar">✕</button>` : ""}
                </div>
              </label>
              <label class="dl-field dl-field--check"><span>Estado del registro</span>
                <span class="dl-check-box ${f.inactivas ? "is-checked" : ""}"><input type="checkbox" data-filtro-check="inactivas" ${f.inactivas ? "checked" : ""}> Mostrar inactivas</span>
              </label>
            </div>` : ""}
        </div>

        <div class="dl-table-wrap">
          <table class="dl-table">
            <thead><tr>
              <th>Encuesta</th><th>Clasificación</th><th>Responde</th><th>Programación</th>
              <th>Próxima</th><th>Envíos</th><th>Estado</th><th class="dl-col-opts">Opciones</th>
            </tr></thead>
            <tbody>
              ${list.length === 0 ? `<tr><td colspan="8">Ninguna encuesta coincide con los filtros.</td></tr>` : list
                .map((survey) => {
                  const externa = survey.classification === "Externa";
                  const preguntas = survey.sections.reduce((total, section) => total + section.questions.length, 0);
                  const respondidas = survey._respondidas || 0;
                  return `
                    <tr class="dl-row-link" data-row-open="edit" data-row-arg="${esc(survey.id)}" title="Abrir la encuesta">
                      <td><b>${esc(survey.name)}</b> <i>${esc(survey.subtype)} · ${survey.sections.length} cat · ${preguntas} preg</i></td>
                      <td><span class="dl-badge ${externa ? "pink" : ""}">${esc(survey.classification)}</span></td>
                      <td>${esc(survey.respondent)}</td>
                      <td>${esc(survey.schedule.repeat)}${survey.schedule.repeat === "No repetir" ? "" : ` · día ${esc(survey.schedule.generationDay)} ${esc(survey.schedule.time)} → cierra ${esc(survey.schedule.closeDay)}`}</td>
                      <td>${esc(survey._proxima || "—")}</td>
                      <td>${survey._instancias || 0}</td>
                      <td><span class="dl-badge ${survey.status === "Activa" ? "ok" : survey.status === "Inactiva" ? "off" : "warn"}">${esc(survey.status.toUpperCase())}</span></td>
                      <td class="dl-col-opts">
                        <div class="menu-wrap">
                          <button class="dl-mini ${state.openMenu === "s-" + survey.id ? "on" : ""}" type="button" data-menu="s-${esc(survey.id)}">Opciones</button>
                          ${state.openMenu === "s-" + survey.id ? `
                            <div class="menu-pop">
                              <button type="button" data-act="sends" data-arg="${esc(survey.id)}">Envíos</button>
                              ${respondidas ? `<button type="button" data-act="answers-survey" data-arg="${esc(survey.id)}">Respuestas (${respondidas})</button>` : ""}
                              <button type="button" data-act="toggle-status" data-arg="${esc(survey.id)}">${survey.status === "Activa" ? "✕ Desactivar" : "✓ Activar"}</button>
                              <button class="danger" type="button" data-act="delete" data-arg="${esc(survey.id)}">Eliminar</button>
                            </div>` : ""}
                        </div>
                      </td>
                    </tr>`;
                })
                .join("")}
            </tbody>
          </table>
        </div>
        <div class="dl-table-foot"><span>${list.length} de ${all.length} encuesta(s)</span></div>
      </section>`;
  }

  /* ---------------- Editor ---------------- */
  const EDITOR_TABS = [
    ["detalle", "Detalle"],
    ["respuestas", "Respuestas"],
    ["envios", "Envíos"],
  ];

  function renderEditor() {
    const survey = draft();
    const editando = state.editando;

    const cuerpo = {
      detalle: cuerpoDetalle,
      respuestas: cuerpoRespuestas,
      envios: cuerpoEnvios,
    }[state.editorTab] || cuerpoDetalle;

    const abierto = state.openMenu === "editor-opts";

    return `
      <div class="edit-shell ${editando ? "" : "modo-consulta"}">
        <div class="toolbar-strip editor-top ${abierto ? "menu-open" : ""}">
          <div class="editor-tabs">
            ${EDITOR_TABS.map(([id, label]) => {
              const extra =
                id === "respuestas" ? (survey._respondidas ? `<i>${survey._respondidas}</i>` : "")
                  : id === "envios" ? (survey._instancias ? `<i>${survey._instancias}</i>` : "")
                    : "";
              return `<button class="editor-tab ${state.editorTab === id ? "is-active" : ""}" type="button" data-act="editor-tab" data-arg="${id}">${label}${extra}</button>`;
            }).join("")}

            ${/* Las opciones van pegadas al último tab */ ""}
            <div class="menu-wrap">
              <button class="dl-kebab ${abierto ? "on" : ""}" type="button" data-menu="editor-opts" title="Más opciones" aria-label="Más opciones">⋯<i>▾</i></button>
              ${abierto ? `
                <div class="menu-pop">
                  ${editando ? "" : `<button type="button" data-act="editar-encuesta">Editar</button>`}
                  <button type="button" data-act="preview">Vista previa</button>
                </div>` : ""}
            </div>
          </div>

          <div class="editor-acciones">
            ${editando ? `<span class="editor-modo">Modo edición</span>` : ""}
            <button class="link-action" type="button" data-view="survey-list">Regresar</button>
          </div>
        </div>

        ${/* Solo el nombre, suelto entre las dos tiras de tabs */ ""}
        <h1 class="editor-nombre" id="editorTitle">${esc(survey.name)}</h1>

        ${cuerpo()}
      </div>`;
  }

  /* ---- Tab Respuestas: lo que contestaron en esta encuesta ---- */
  function cuerpoRespuestas() {
    if (isExternal()) return cuerpoRespuestasDoctores();
    const survey = draft();
    const lista = state.respuestas || [];
    const porInstancia = {};
    lista.forEach((r) => {
      porInstancia[r.instanceId] = porInstancia[r.instanceId] || { quien: r.doctor, period: r.period, fecha: r.finishedAt, items: [] };
      porInstancia[r.instanceId].items.push(r);
    });
    const grupos = Object.values(porInstancia);

    return `
      <section class="dl-card">
        <div class="dl-table-wrap">
          <table class="dl-table">
            <thead><tr><th>${isExternal() ? "Doctor" : "Colaborador"}</th><th>Período</th><th>Pregunta</th><th>Área</th><th>Calificación</th><th>Nivel</th><th>Motivos</th><th>Comentario</th></tr></thead>
            <tbody>
              ${lista.length === 0
                ? `<tr><td colspan="8">Todavía nadie responde esta encuesta.</td></tr>`
                : lista.map((r) => `
                    <tr>
                      <td><b>${esc(survey.anonymous ? "Anónimo" : r.doctor)}</b></td>
                      <td>${esc(r.period)}</td>
                      <td class="wk-comment">${esc(r.pregunta)}</td>
                      <td>${esc(r.area)}</td>
                      <td>${r.calificacion ? `<span class="dl-badge ${r.calificacion >= 4 ? "ok" : "bad"}">${r.calificacion} ★</span>` : esc(r.valor || "—")}</td>
                      <td>${esc(r.nivel === "GENERAL" ? "General" : "Por orden")}</td>
                      <td>${esc((r.motivos || []).join(", ") || "—")}</td>
                      <td class="wk-comment">${esc(r.comentario || "—")}</td>
                    </tr>`).join("")}
            </tbody>
          </table>
        </div>
        <div class="dl-table-foot"><span>${grupos.length} encuesta(s) completada(s)${survey.anonymous ? " · respuestas anónimas" : ""}</span></div>
      </section>`;
  }

  /* ---- Tab Envíos: el JOB y el estado de cada envío ---- */
  function cuerpoEnvios() {
    if (isExternal()) return cuerpoEnviosDoctores();
    const survey = draft();
    const instancias = state.instancias || [];
    const externa = isExternal();
    const yaCorrio = instancias.length > 0;
    const sinEnviar = instancias.filter((item) => item.state === "Generada" && !item.sentAt).length;

    /* Recordables: ya recibieron la encuesta y no la han terminado, y
       todavía no llegaron al tope de recordatorios. */
    const rec = survey.reminders || {};
    const tope = Math.max(1, Number(rec.max) || 2);
    const recordables = instancias.filter(
      (item) => ["Enviada", "Abierta", "Parcial"].includes(item.state) && Number(item.reminders || 0) < tope
    ).length;
    const sinContestar = instancias.filter((item) => ["Enviada", "Abierta", "Parcial"].includes(item.state)).length;

    return `
      <div class="dercas-ribbon solo-acciones">
        <div class="ribbon-tags">
          <button class="btn primary" type="button" data-act="ejecutar-ahora">${yaCorrio ? "Volver a ejecutar (todos)" : "Ejecutar primera vez"}</button>
          <button class="btn" type="button" data-act="ejecutar-no-enviados">Ejecutar no enviados${sinEnviar ? ` (${sinEnviar})` : ""}</button>
          ${externa ? `<button class="btn" type="button" data-act="recordar" ${recordables ? "" : "disabled"}>Recordar a los que no han contestado${recordables ? ` (${recordables})` : ""}</button>` : ""}
        </div>
      </div>

      ${externa && sinContestar && !recordables ? `<p class="empty-note">Los ${sinContestar} que no han contestado ya llegaron al tope de ${tope} recordatorio(s). Puede subir el tope en el paso WhatsApp.</p>` : ""}

      ${state.esNueva ? `<p class="empty-note">La encuesta todavía no se ha creado. Guárdela primero y podrá ejecutarla desde aquí.</p>` : ""}

      <section class="dl-card">
        <div class="wk-block-head"><div><b>Envíos del período</b></div><span class="wk-count">${instancias.length}</span></div>
        <div class="dl-table-wrap">
          <table class="dl-table">
            <thead><tr>
              <th>${externa ? "Doctor" : "Colaborador"}</th><th>${externa ? "Clínica" : "Área"}</th>
              ${externa ? "<th>Trabajos</th>" : "<th>Evalúa a</th>"}
              ${externa ? "<th>WhatsApp</th>" : ""}<th>Estado</th><th>Generada</th><th>Enviada</th>${externa ? "<th>Recordatorios</th>" : ""}<th>Abierta</th><th>Completada</th><th class="dl-col-opts">Acciones</th>
            </tr></thead>
            <tbody>
              ${instancias.length === 0
                ? `<tr><td colspan="${externa ? 11 : 9}">Aún no hay envíos. Pulse <b>Ejecutar primera vez</b>.</td></tr>`
                : instancias.map((item) => `
                    <tr>
                      <td><b>${esc(item.doctor)}</b> <i>${esc(item.periodLabel)}</i></td>
                      <td>${esc(item.clinic || "—")}</td>
                      <td>${externa ? item.workIds.length : esc(item.supervisor || "—")}</td>
                      ${externa ? `<td class="wk-tel" title="Dato de muestra: el envío real va al número configurado">${esc(DL.telefono(item.doctorPhone))}</td>` : ""}
                      <td><span class="dl-badge ${item.state === "Completada" ? "ok" : String(item.state).startsWith("Cerrada") ? "off" : "warn"}">${esc(item.state)}</span></td>
                      <td>${esc(item.generatedAt || "—")}</td>
                      <td>${esc(item.sentAt || "—")}</td>
                      ${externa ? `<td>${Number(item.reminders || 0)
                        ? `<span class="dl-badge warn">${Number(item.reminders)} de ${tope}</span> <i class="tiny">${esc(item.lastReminderAt || "")}</i>`
                        : "—"}</td>` : ""}
                      <td>${esc(item.openedAt || "—")}</td>
                      <td>${esc(item.finishedAt || "—")}</td>
                      <td class="dl-col-opts">
                        <button class="dl-mini" type="button" data-act="open-instance" data-arg="${esc(item.id)}">Abrir</button>
                        ${externa ? `<button class="dl-mini" type="button" data-act="ver-mensaje" data-arg="${esc(item.id)}">Mensaje</button>` : ""}
                      </td>
                    </tr>`).join("")}
            </tbody>
          </table>
        </div>
        <div class="dl-table-foot"><span>Se actualiza sola cada 4 segundos</span></div>
      </section>`;
  }

  /* ---- Tab Detalle: los cinco pasos de siempre ---- */
  function cuerpoDetalle() {
    const stepIndex = STEPS.findIndex(([id]) => id === state.step);
    const body = ({ general: stepGeneral, audience: stepAudience, schedule: stepSchedule, envio: stepEnvio, questions: stepQuestions }[state.step] || stepGeneral)();

    return `
      <ol class="wizard-steps">
        ${STEPS.map(([id, label], index) => `
          <li class="wizard-step ${state.step === id ? "active" : ""} ${index < stepIndex ? "done" : ""}">
            <button type="button" data-step="${id}">
              <span class="step-text"><b>${label}</b></span>
            </button>
          </li>`).join("")}
      </ol>

      <div class="edit-body">${body}</div>

      ${state.editando ? `
        <div class="form-actions">
          <button class="dercas-btn ok" type="button" data-act="crear-encuesta">${state.esNueva ? "Crear encuesta" : "Guardar cambios"}</button>
          <button class="dercas-btn" type="button" data-act="guardar-borrador">Guardar como borrador</button>
          <button class="dercas-btn cancel" type="button" data-act="cancelar">Cancelar</button>
        </div>` : ""}`;
  }

  function stepGeneral() {
    const survey = draft();
    const external = isExternal();
    return `
      <section class="page-card">
        <h2 class="card-title">Datos generales</h2>
        <div class="form-grid g4">
          <label class="field"><span>Nombre de la encuesta *</span><input data-survey-field="name" value="${attr(survey.name)}"></label>
          <label class="field"><span>Subcategoría</span><select data-survey-field="subtype">${options(external ? ["Servicio y Calidad", "Encuesta general", "Nuevos productos"] : ["Liderazgo", "Clima laboral", "Capacitación", "Eventos y actividades", "Encuesta general"], survey.subtype)}</select></label>
          <label class="field span2"><span>Descripción</span><textarea rows="2" data-survey-field="description">${esc(survey.description)}</textarea></label>
          ${!external ? `
            <div class="field span4"><span>Sugerencias</span>
              <label class="switch-row"><input type="checkbox" data-survey-check="suggestions" ${survey.suggestions !== false ? "checked" : ""}> Comentario general al final de la encuesta.</label>
            </div>` : ""}
        </div>

        ${survey.works.enabled ? `
          <div class="periodo-box">
            <div class="periodo-head">
              <div><b>Período evaluado</b></div>
              <label class="switch-row"><input type="checkbox" data-survey-check="periodAuto" ${survey.periodAuto !== false ? "checked" : ""}> Automático</label>
            </div>
            ${survey.periodAuto !== false ? `
              <p class="periodo-auto">Siempre el <b>mes calendario anterior</b>. Hoy sería <b>${esc(etiquetaPeriodo())}</b> (${esc(bonita(survey.periodFrom))} al ${esc(bonita(survey.periodTo))}).</p>
            ` : `
              <div class="form-grid g4">
                <label class="field"><span>Desde *</span><input type="date" data-survey-field="periodFrom" value="${attr(survey.periodFrom || "")}"></label>
                <label class="field"><span>Hasta *</span><input type="date" data-survey-field="periodTo" value="${attr(survey.periodTo || "")}"></label>
                <label class="field span2"><span>Período</span><input value="${attr(etiquetaPeriodo())}" readonly></label>
              </div>
            `}
          </div>
        ` : ""}
      </section>`;
  }

  /* ==================================================================
     Público de una encuesta INTERNA
     Mismo modelo del sistema: modo de asignación, área del organigrama,
     supervisor evaluado y la lista de personas que responderán.
     ================================================================== */
  const MODOS_ASIGNACION = ["Por supervisor", "Por supervisor sin encargados", "Manual"];

  function audienciaInterna(survey) {
    const alcance = state.alcanceInterno;
    const manual = survey.assignMode === "Manual";
    const elegidos = survey.respondents || [];
    const gente = manual ? (state.empleadosLista || []) : (alcance ? alcance.gente : []);
    const fuera = survey.excluded || [];
    const marcados = manual ? gente.filter((g) => elegidos.includes(g.id)) : gente.filter((g) => !fuera.includes(g.id));
    const arbol = DL.AREAS_ARBOL || [];

    return `
      <section class="page-card">
        <h2 class="card-title">¿Quiénes van a responder?</h2>
        <div class="form-grid g4">
          <label class="field"><span>Modo de asignación *</span>
            <select data-survey-field="assignMode">${options(MODOS_ASIGNACION, survey.assignMode)}</select>
            <small>${
              manual
                ? "Elija a mano quién responde."
                : survey.assignMode === "Por supervisor sin encargados"
                  ? "Toma el área y sus subáreas, pero deja fuera a los encargados de subárea."
                  : "Toma el área seleccionada y todas sus subáreas."
            }</small>
          </label>
          <label class="field"><span>Área *</span>
            <select data-survey-field="areaKey" ${manual ? "disabled" : ""}>
              ${arbol.map((item) => `<option value="${attr(item.area)}" ${item.area === survey.areaKey ? "selected" : ""}>${esc(item.etiqueta)}</option>`).join("")}
            </select>
          </label>
          <label class="field"><span>Supervisor asignado *</span>
            <input value="${attr((alcance && alcance.supervisor) || survey.supervisorName || "—")}" readonly>
            <small>Es la persona que se evalúa en esta encuesta.</small>
          </label>
          <label class="field"><span>Respuestas</span>
            <select data-survey-field="anonymous"><option value="true" ${survey.anonymous ? "selected" : ""}>Anónimas</option><option value="false" ${!survey.anonymous ? "selected" : ""}>Identificadas</option></select>
          </label>
        </div>

        <div class="asig-box">
          <b>${manual ? "Asignación manual" : "Asignación automática por supervisor"}</b>
          <div class="asig-grid">
            <div class="asig-item"><span>Supervisor asignado</span><b>${esc((alcance && alcance.supervisor) || survey.supervisorName || "—")}</b></div>
            <div class="asig-item asig-item--pink"><span>Evaluado</span><b>${esc((alcance && alcance.supervisor) || survey.supervisorName || "—")}</b></div>
            <div class="asig-item asig-item--pink"><span>Respondedores</span><b>${marcados.length} colaborador(es)</b></div>
          </div>
        </div>
      </section>

      <section class="dl-card">
        <div class="wk-block-head">
          <div><b>Personas que responderán la encuesta</b><span>${manual ? "Marque a quienes deben responder." : "Se calculan con el área y el modo; puede quitar a quien no deba responder."}</span></div>
          <span class="wk-count">${marcados.length} registro(s)</span>
        </div>

        ${!manual && alcance && alcance.avisos.length
          ? alcance.avisos.map((aviso) => `<p class="asig-aviso">${esc(aviso)}</p>`).join("")
          : ""}

        <div class="dl-table-wrap">
          <table class="dl-table">
            <thead><tr>${manual ? "<th class=\"dl-col-check\"></th>" : ""}<th>Nombre</th><th>Puesto</th><th>Área</th><th>Correo</th><th class="dl-col-opts">Acciones</th></tr></thead>
            <tbody>
              ${gente.length === 0
                ? `<tr><td colspan="${manual ? 6 : 5}">${alcance === null ? "Calculando los respondedores…" : "No hay colaboradores para esta área."}</td></tr>`
                : gente.map((persona) => {
                    const dentro = manual ? elegidos.includes(persona.id) : !(survey.excluded || []).includes(persona.id);
                    return `
                      <tr class="${dentro ? "" : "fila-fuera"}">
                        ${manual ? `<td class="dl-col-check"><input type="checkbox" data-resp-pick="${attr(persona.id)}" ${dentro ? "checked" : ""}></td>` : ""}
                        <td><b>${esc(persona.name)}</b></td>
                        <td>${esc(persona.position)}</td>
                        <td>${esc(persona.area)}</td>
                        <td>${esc(persona.email)}</td>
                        <td class="dl-col-opts">
                          ${manual
                            ? ""
                            : dentro
                              ? `<button class="dl-mini" type="button" data-act="quitar-resp" data-arg="${attr(persona.id)}" title="Quitar de la encuesta">Quitar</button>`
                              : `<button class="dl-mini" type="button" data-act="devolver-resp" data-arg="${attr(persona.id)}" title="Volver a incluir">Incluir</button>`}
                        </td>
                      </tr>`;
                  }).join("")}
            </tbody>
          </table>
        </div>
      </section>`;
  }

  function stepAudience() {
    const survey = draft();
    if (!isExternal()) return audienciaInterna(survey);

    const eligible = elegibles();
    const manual = survey.audienceMode === "Selección manual";
    const elegidos = survey.audienceDoctors || [];

    const doctores = [...new Set(eligible.map((work) => work.doctor))].map((doctor) => ({
      doctor,
      clinic: (eligible.find((work) => work.doctor === doctor) || {}).clinic || "",
      phone: (eligible.find((work) => work.doctor === doctor) || {}).doctorPhone || "",
      works: eligible.filter((work) => work.doctor === doctor),
    }));

    return `
      <section class="page-card">
        <h2 class="card-title">¿A qué doctores se dirige?</h2>
        <div class="form-grid g4">
          <label class="field"><span>Asignación *</span>
            <select data-survey-field="audienceMode">${options(["Todos los doctores", "Selección manual"], survey.audienceMode)}</select>
          </label>
          <div class="field span3"><span>Alcance del período</span>
            <input value="${doctores.length} doctores · ${eligible.length} órdenes enviadas en ${attr(etiquetaPeriodo())}" readonly>
          </div>
        </div>

        ${doctores.length === 0 ? `
          <p class="empty-note">No hay órdenes en estado ENVIADO dentro del período <b>${esc(etiquetaPeriodo())}</b>.
          Cambie las fechas del período en <b>Datos generales</b> o deje el período en automático (mes anterior) para que aparezcan los doctores.</p>
        ` : ""}

        <div class="doctor-pick">
          ${doctores
            .map((grupo) => {
              const marcado = manual ? elegidos.includes(grupo.doctor) : true;
              const abierto = state.openDoctor === grupo.doctor;
              const suyas = manual
                ? grupo.works.filter((work) => survey.works.selectedIds.includes(work.id)).length
                : grupo.works.length;
              return `
                <article class="doctor-item ${marcado ? "on" : ""}">
                  <div class="doctor-head">
                    ${manual
                      ? `<label class="doctor-check">
                          <input type="checkbox" data-doctor-pick="${attr(grupo.doctor)}" ${marcado ? "checked" : ""}>
                          <span><b>${esc(grupo.doctor)}</b><small>${esc(grupo.clinic)} · WhatsApp ${esc(DL.telefono(grupo.phone))}</small></span>
                        </label>`
                      : `<span class="doctor-name"><b>${esc(grupo.doctor)}</b><small>${esc(grupo.clinic)} · WhatsApp ${esc(DL.telefono(grupo.phone))}</small></span>`}
                    <button class="mini-btn" type="button" data-act="toggle-doctor" data-arg="${attr(grupo.doctor)}">
                      ${manual ? `${suyas} de ${grupo.works.length} órdenes` : `${grupo.works.length} órdenes`}${abierto ? " · ocultar" : ""}
                    </button>
                  </div>
                  ${abierto ? `
                    <div class="doctor-works">
                      ${grupo.works
                        .map((work) => {
                          const detalle = `<span><b>Orden #${esc(work.code)} · ${esc(work.product)}</b><small>${esc(work.patient)} · Enviado ${esc(work.sent)} · Asesora: ${esc(work.advisor)}</small></span>`;
                          return manual
                            ? `<label class="work-item">
                                <input class="work-check" type="checkbox" data-selected-work="${attr(work.id)}" ${survey.works.selectedIds.includes(work.id) ? "checked" : ""} ${marcado ? "" : "disabled"}>
                                ${detalle}
                              </label>`
                            : `<div class="work-item plain">${detalle}</div>`;
                        })
                        .join("")}
                      ${manual && !marcado ? `<p class="tiny">Marque al doctor para poder elegir sus órdenes.</p>` : ""}
                    </div>` : ""}
                </article>`;
            })
            .join("")}
        </div>
        <p class="tiny hint-line">${manual
          ? `${elegidos.length} doctor(es) seleccionados · ${survey.works.selectedIds.length} órdenes a calificar.`
          : `Se evaluarán las ${eligible.length} órdenes del período. Despliegue cada doctor para ver cuáles.`}</p>
      </section>

      <section class="page-card">
        <h2 class="card-title">¿Esta encuesta lleva órdenes de trabajo?</h2>
        <label class="feature-toggle">
          <input type="checkbox" data-works-check="enabled" ${survey.works.enabled ? "checked" : ""}>
          <span><b>Sí, la encuesta evalúa trabajos del período</b><small>Se evalúan las órdenes que llegaron a estado ENVIADO. Las modalidades general, mixta e individual se configuran por categoría en el editor.</small></span>
        </label>
        ${survey.works.enabled
          ? `<p class="tiny hint-line">Origen: ${esc(survey.works.source)}. Al generar, el sistema agrupa por doctor y conserva la asesora de cada orden.</p>`
          : `<p class="empty-note">La encuesta se responderá sin asociar calificaciones a órdenes.</p>`}
      </section>`;
  }

  function stepSchedule() {
    const survey = draft();

    /* Tres columnas parejas: cada campo ocupa una celda completa, así la
       fila de arriba y la de abajo quedan alineadas. */
    return `
      <section class="page-card">
        <h2 class="card-title">¿Cada cuánto se ejecuta?</h2>
        <div class="form-grid g3">
          <label class="field"><span>Repetición *</span>
            <select data-sched-field="repeat">${options(["No repetir", "Mensual", "Trimestral", "Anual"], survey.schedule.repeat)}</select>
          </label>
          <div class="field"><span>Inicio disponibilidad *</span>
            <div class="ventana-fila">
              <input type="date" data-sched-field="startDate" value="${attr(survey.schedule.startDate || "")}">
              <input type="time" data-sched-field="startTime" value="${attr(survey.schedule.startTime || "07:00")}">
            </div>
          </div>
          <div class="field"><span>Fin disponibilidad *</span>
            <div class="ventana-fila">
              <input type="date" data-sched-field="endDate" value="${attr(survey.schedule.endDate || "")}">
              <input type="time" data-sched-field="endTime" value="${attr(survey.schedule.endTime || "23:59")}">
            </div>
          </div>

          <label class="field"><span>Primera ejecución</span><input value="${attr(corridas(survey).primera)}" readonly></label>
          <label class="field"><span>Próxima ejecución</span><input value="${attr(corridas(survey).proxima)}" readonly></label>
          <label class="field"><span>Última ejecución</span><input value="${attr(survey.schedule.lastRun || "—")}" readonly></label>
        </div>
      </section>`;
  }

  /* ==================================================================
     Paso WhatsApp (o Envío en las internas): canal y mensaje
     ================================================================== */
  function stepEnvio() {
    const survey = draft();
    const external = isExternal();

    return `
      <section class="page-card">
        <h2 class="card-title">${external ? "WhatsApp" : "Envío"}</h2>
        <div class="form-grid g4">
          <label class="field"><span>Canal *</span><select data-survey-field="channel">${options(external ? ["API WhatsApp", "Enlace directo"] : ["Enlace directo", "Correo interno"], survey.channel)}</select></label>
          ${survey.channel === "API WhatsApp"
            ? `<label class="field"><span>Número de prueba</span><input value="+${attr(state.estado ? state.estado.destino : "")}" readonly></label>`
            : `<label class="field"><span>Cómo llega la encuesta</span><input value="${external ? "Cada doctor abre su enlace" : "Se responde desde el portal"}" readonly></label>`}
          ${survey.channel === "API WhatsApp" ? `
            <label class="field span2"><span>Mensaje que acompaña el enlace *</span><textarea rows="3" data-survey-field="whatsappMessage">${esc(survey.whatsappMessage)}</textarea>
              <small>Variables: <code>{{doctor}}</code> <code>{{periodo}}</code> <code>{{casos}}</code> <code>{{cierre}}</code></small></label>` : ""}
        </div>
        ${survey.channel === "API WhatsApp" ? `
          <div class="whatsapp-preview">
            <b>Así llega el mensaje</b>
            <p>${esc(mensajeArmado(survey))}</p>
            <span>+ enlace individual de cada doctor</span>
          </div>` : ""}
      </section>

      ${survey.channel === "API WhatsApp" ? tarjetaRecordatorios(survey) : ""}`;
  }

  /* ==================================================================
     Recordatorios: se le vuelve a escribir a quien recibió la encuesta
     y todavía no la termina. Tiene su propia programación.
     ================================================================== */
  function tarjetaRecordatorios(survey) {
    const rec = survey.reminders || {};
    const activo = rec.active !== false;
    const cada = Math.max(1, Number(rec.everyDays) || 3);
    const tope = Math.max(1, Number(rec.max) || 2);

    return `
      <section class="page-card">
        <h2 class="card-title">Recordatorios
          <small>${activo
            ? `Cada ${cada} día(s) a las ${esc(String(rec.time || "09:00").slice(0, 5))}, hasta ${tope} vez(ces) por doctor`
            : "Desactivados"}</small>
        </h2>
        <div class="form-grid g4">
          <div class="field"><span>Recordatorios</span>
            <label class="switch-row"><input type="checkbox" data-rec-check="active" ${activo ? "checked" : ""}> Reenviar a quien no ha contestado</label>
          </div>
          ${activo ? `
            <label class="field"><span>Cada cuántos días *</span>
              <input type="number" min="1" max="30" data-rec-field="everyDays" value="${attr(cada)}">
            </label>
            <label class="field"><span>Hora *</span>
              <input type="time" data-rec-field="time" value="${attr(String(rec.time || "09:00").slice(0, 5))}">
            </label>
            <label class="field"><span>Máximo por doctor *</span>
              <input type="number" min="1" max="10" data-rec-field="max" value="${attr(tope)}">
            </label>
            <label class="field span3"><span>Mensaje del recordatorio *</span>
              <textarea rows="2" data-rec-field="message">${esc(rec.message || "")}</textarea>
              <small>Mismas variables: <code>{{doctor}}</code> <code>{{periodo}}</code> <code>{{casos}}</code></small>
            </label>
          ` : ""}
        </div>
        ${activo && String(rec.message || "").trim() ? `
          <div class="whatsapp-preview">
            <b>Así llega el recordatorio</b>
            <p>${esc(mensajeArmado(survey, rec.message))}</p>
            <span>+ enlace individual de cada doctor</span>
          </div>` : ""}
      </section>`;
  }

  function mensajeArmado(survey, plantilla) {
    const alcance = alcancePrevio();
    return String(plantilla != null ? plantilla : survey.whatsappMessage || "")
      .replace(/{{doctor}}/g, alcance.doctor || survey.respondent)
      .replace(/{{periodo}}/g, survey.periodLabel)
      .replace(/{{casos}}/g, alcance.works.length)
      .replace(/{{cierre}}/g, survey.schedule.closeDay || (survey.schedule.endDate || "").slice(8, 10) || "");
  }

  /* ---------- editor de preguntas ---------- */
  function stepQuestions() {
    const survey = draft();
    return `
      <section class="page-card">
        <div class="forms-board">
          <div class="editor-layout">
            <div class="forms-canvas"><div class="section-stack">${survey.sections.map(renderSectionCard).join("")}</div></div>
          </div>
        </div>
      </section>`;
  }

  function renderSectionCard(section, index) {
    const survey = draft();
    const total = survey.sections.length;
    return `
      <article data-section-id="${section.id}" class="section-block ${state.activeSectionId === section.id ? "focused" : ""}">
        <div class="section-badge">
          <span>Categoría ${index + 1} de ${total}</span>
          <span class="section-tools">
            <button class="text-btn" type="button" data-act="move-section" data-arg="${section.id}:up" ${index === 0 ? "disabled" : ""}>Subir</button>
            <button class="text-btn" type="button" data-act="move-section" data-arg="${section.id}:down" ${index === total - 1 ? "disabled" : ""}>Bajar</button>
            <button class="text-btn danger" type="button" data-act="delete-section" data-arg="${section.id}">Eliminar categoría</button>
            <button class="text-btn" type="button" data-act="add-section">Agregar categoría</button>
          </span>
        </div>
        <div class="forms-card section-head-card">
          <input class="section-title-input" data-section-field="title" value="${attr(section.title)}" aria-label="Título de la categoría">
          <textarea class="section-description-input" data-section-field="description" rows="1" aria-label="Descripción">${esc(section.description)}</textarea>
          <div class="section-meta-row">
            <span>${section.questions.length} pregunta${section.questions.length === 1 ? "" : "s"}</span>
          </div>
        </div>
        ${sectionBehavior(section)}
        ${section.questions.map((question, qIndex) => renderQuestionCard(section, question, qIndex)).join("")}
        <div class="section-route">
          <button class="mini-btn primary" type="button" data-act="add-question" data-arg="${section.id}">Agregar pregunta</button>
          <span>Después de esta categoría</span>
          <select data-section-field="next">
            <option value="continue" ${section.next === "continue" ? "selected" : ""}>Ir a la siguiente categoría</option>
            <option value="submit" ${section.next === "submit" ? "selected" : ""}>Enviar formulario</option>
          </select>
        </div>
      </article>`;
  }

  function sectionBehavior(section) {
    const survey = draft();
    if (!survey.works.enabled) {
      return `<div class="forms-card section-behavior compact-behavior"><b>Sin órdenes de trabajo</b></div>`;
    }
    /* El título hace de etiqueta: la casilla va sola, sin texto al lado */
    return `
      <div class="forms-card section-behavior">
        <div class="behavior-head">
          <div><b>¿Esta categoría se evalúa sobre los trabajos?</b></div>
          <label class="switch-row" title="Evaluar esta categoría sobre las órdenes del período">
            <input type="checkbox" data-section-check="useWorks" ${section.useWorks ? "checked" : ""}>
          </label>
        </div>
        ${section.useWorks ? `
          <div class="mode-config compact">
            <div><b>¿Cómo podrá responder el doctor en “${esc(section.title)}”?</b></div>
            <div class="mode-check-grid">
              ${["general", "mixed", "individual"].map((mode) => `
                <label class="mode-check ${(section.allowedModes || []).includes(mode) ? "selected" : ""}">
                  <input type="checkbox" data-section-mode="${mode}" ${(section.allowedModes || []).includes(mode) ? "checked" : ""}>
                  <span><b>${DL.MODE_LABELS[mode]}</b></span>
                </label>`).join("")}
            </div>
          </div>
        ` : ""}
      </div>`;
  }

  function renderQuestionCard(section, question, index) {
    const open = state.openQuestionId === question.id;
    const total = section.questions.length;
    if (!open) {
      return `
        <div class="forms-card question-card collapsed" data-section-id="${section.id}" data-question-id="${question.id}">
          <div class="q-summary">
            <span class="q-index">${index + 1}</span>
            <div><b>${esc(question.text)}</b><small>${DL.QUESTION_TYPES[question.type]} · ${esc(question.area)}${question.active ? "" : " · inactiva"}</small></div>
            <button class="text-btn" type="button" data-act="focus-question" data-arg="${question.id}">Editar</button>
          </div>
        </div>`;
    }
    return `
      <div class="forms-card question-card active" data-section-id="${section.id}" data-question-id="${question.id}">
        <div class="question-grid">
          <input class="question-title-input" data-question-field="text" value="${attr(question.text)}" aria-label="Texto de la pregunta">
          <select class="question-type" data-question-field="type">
            ${Object.entries(DL.QUESTION_TYPES).map(([value, label]) => `<option value="${value}" ${question.type === value ? "selected" : ""}>${label}</option>`).join("")}
          </select>
        </div>
        <input class="question-help-input" data-question-field="help" value="${attr(question.help)}" placeholder="Texto de ayuda (opcional)">
        ${answerControl(question)}
        ${motorPanel(section, question)}
        <div class="question-footer">
          <button class="text-btn" type="button" data-act="move-question" data-arg="${question.id}:up" ${index === 0 ? "disabled" : ""}>Subir</button>
          <button class="text-btn" type="button" data-act="move-question" data-arg="${question.id}:down" ${index === total - 1 ? "disabled" : ""}>Bajar</button>
          <button class="text-btn" type="button" data-act="duplicate-question" data-arg="${question.id}">Duplicar</button>
          <button class="text-btn danger" type="button" data-act="delete-question" data-arg="${question.id}">Eliminar</button>
          <label class="switch-row"><span>Activa</span><input type="checkbox" data-question-check="active" ${question.active ? "checked" : ""}></label>
          <label class="switch-row"><span>Obligatoria</span><input type="checkbox" data-question-check="required" ${question.required ? "checked" : ""}></label>
          <button class="text-btn" type="button" data-act="focus-question" data-arg="${question.id}">Contraer</button>
        </div>
      </div>`;
  }

  function answerControl(question) {
    if (question.type === "stars")
      return `<div class="answer-preview"><div class="stars-line"><span>★</span><span>★</span><span>★</span><span>☆</span><span>☆</span><small>El doctor califica de 1 a 5 estrellas</small></div></div>`;
    if (question.type === "short") return `<div class="answer-preview"><div class="short-placeholder">Texto de respuesta corta</div></div>`;
    if (question.type === "paragraph") return `<div class="answer-preview"><div class="paragraph-placeholder">Texto de respuesta larga</div></div>`;
    const marker = question.type === "multiple" ? "check-dot" : "radio-dot";
    return `
      <div class="answer-preview">
        ${question.options
          .map(
            (option, index) => `
            <div class="option-row">
              <span class="${marker}"></span>
              <input class="option-input" data-option-index="${index}" value="${attr(option)}">
              <button class="remove-option" type="button" data-act="remove-option" data-arg="${question.id}:${index}">×</button>
            </div>`
          )
          .join("")}
        <button class="add-option" type="button" data-act="add-option" data-arg="${question.id}">Agregar opción</button>
      </div>`;
  }

  function catalogEditor(question, field, label) {
    return `
      <div class="chip-editor">
        <span>${label}</span>
        <div class="chip-list">
          ${question[field].map((item, index) => `<span class="chip-item">${esc(item)}<button type="button" data-act="remove-catalog" data-arg="${question.id}:${field}:${index}">×</button></span>`).join("")}
        </div>
        <div class="chip-add">
          <input id="cat-${question.id}-${field}" data-catalog-input="${question.id}:${field}" placeholder="Agregar opción y presionar Enter">
          <button class="mini-btn" type="button" data-act="add-catalog" data-arg="${question.id}:${field}">＋</button>
        </div>
      </div>`;
  }

  function motorPanel(section, question) {
    const survey = draft();
    const conTrabajos = survey.works.enabled && section.useWorks;
    const starRules =
      question.type === "stars"
        ? `
        <div class="star-rule-grid span2">
          <section class="rule-box negative-rule">
            <header><span>1 a ${(question.lowThreshold || 4) - 1} ★</span><b>Qué pasa con una nota baja</b></header>
            <label class="field inline"><span>Se considera baja si es menor a</span>
              <select data-question-field="lowThreshold">${[3, 4, 5].map((value) => `<option value="${value}" ${Number(question.lowThreshold) === value ? "selected" : ""}>${value} estrellas</option>`).join("")}</select>
            </label>
            <label class="check-row"><input type="checkbox" data-question-check="lowOptionsRequired" ${question.lowOptionsRequired ? "checked" : ""}> Exigir al menos un motivo de mejora</label>
            <label class="check-row"><input type="checkbox" data-question-check="lowCommentRequired" ${question.lowCommentRequired ? "checked" : ""}> Exigir comentario obligatorio</label>
            <label class="field"><span>Pregunta que verá el doctor</span><input data-question-field="lowPrompt" value="${attr(question.lowPrompt)}"></label>
            ${catalogEditor(question, "improvementOptions", "Catálogo de oportunidades de mejora")}
          </section>
          <section class="rule-box positive-rule">
            <header><span>${question.lowThreshold || 4} a 5 ★</span><b>Qué pasa con una nota alta</b></header>
            <label class="check-row"><input type="checkbox" data-question-check="highOptionsOptional" ${question.highOptionsOptional ? "checked" : ""}> Mostrar aspectos valorados (opcional)</label>
            <label class="check-row"><input type="checkbox" data-question-check="highCommentOptional" ${question.highCommentOptional ? "checked" : ""}> Permitir comentario opcional</label>
            <label class="field"><span>Pregunta que verá el doctor</span><input data-question-field="highPrompt" value="${attr(question.highPrompt)}"></label>
            ${catalogEditor(question, "valueOptions", "Catálogo de aspectos valorados")}
          </section>
        </div>`
        : "";

    return `
      <div class="motor-panel">
        <h3>Reglas de la pregunta</h3>
        <div class="motor-grid">
          <label class="field"><span>Área responsable *</span><select data-question-field="area">${options(DL.AREAS, question.area)}</select><small>Esa área verá esta respuesta en Resultados.</small></label>
          <label class="field"><span>Aplicación a trabajos</span>
            <select data-question-field="workMode">
              ${(conTrabajos ? Object.entries(DL.WORK_MODES) : [["none", DL.WORK_MODES.none]])
                .map(([value, label]) => `<option value="${value}" ${question.workMode === value ? "selected" : ""}>${label}</option>`)
                .join("")}
            </select>
            <small>${question.workMode === "none" ? "Queda como percepción general del área." : "Conserva la relación orden → asesora."}</small>
          </label>
          ${starRules}
        </div>
      </div>`;
  }

  /* ---------------- Envíos ---------------- */
  function renderSendsPicker() {
    return `
      <section class="page-card">
        <h2 class="card-title">Envíos</h2>
        <p class="empty-note">Elija una encuesta para ver o ejecutar sus envíos.</p>
        <div class="review-actions">
          ${state.surveys.map((survey) => `<button class="btn" type="button" data-act="sends" data-arg="${esc(survey.id)}">${esc(survey.name)}</button>`).join("")}
        </div>
      </section>`;
  }

  function renderSends() {
    const survey = draft();
    const instancias = state.instancias;
    const conteo = DL.STATES.map((nombre) => [nombre, instancias.filter((item) => item.state === nombre).length]);
    const wa = state.estado.whatsapp;

    return `
      <div class="toolbar-strip">
        <div class="editor-id">
          <span class="badge ${isExternal() ? "pink" : "neutral"}">${esc(survey.classification.toUpperCase())}</span>
          <b>${esc(survey.name)}</b>
          <span class="tiny">Próxima ejecución: ${esc(survey.schedule.nextRun || "sin agenda")}</span>
        </div>
        <div>
          <button class="mini-btn" type="button" data-act="edit" data-arg="${esc(survey.id)}">Editar</button>
          <button class="link-action" type="button" data-view="survey-list">Regresar</button>
        </div>
      </div>

      <div class="dercas-ribbon">
        <div>
          <b>JOB mensual y envío por WhatsApp</b>
          <span>Genera una encuesta por doctor con sus trabajos elegibles y manda el enlace individual. ${
            wa.conectado ? `Conectado como <b>+${esc(wa.numero)}</b>; los envíos llegan a <b>+${esc(state.estado.destino)}</b>.` : "WhatsApp no está conectado: los mensajes quedan registrados en la bitácora."
          }</span>
        </div>
        <div class="ribbon-tags">
          <button class="btn primary" type="button" data-act="ejecutar-ahora">Ejecutar ahora</button>
          <button class="btn" type="button" data-act="generar">Solo generar</button>
          <button class="btn" type="button" data-act="enviar">Enviar</button>
          <button class="btn" type="button" data-act="cerrar-ventana">Cerrar ventana</button>
        </div>
      </div>

      <div class="area-result-grid states">
        ${conteo.map(([label, value]) => `<article><span>${esc(label)}</span><b>${value}</b></article>`).join("")}
      </div>

      <section class="page-card">
        <div class="table-wrap">
          <table class="data-table">
            <thead><tr><th>Doctor</th><th>Clínica</th><th>Trabajos</th><th>Estado</th><th>Generada</th><th>Enviada</th><th>Abierta</th><th>Completada</th><th>Acciones</th></tr></thead>
            <tbody>
              ${instancias.length
                ? instancias
                    .map(
                      (item) => `
                      <tr>
                        <td><b>${esc(item.doctor)}</b><span class="tiny">${esc(item.periodLabel)}</span></td>
                        <td>${esc(item.clinic || "—")}</td>
                        <td>${item.workIds.length}</td>
                        <td><span class="badge ${item.state === "Completada" ? "" : String(item.state).startsWith("Cerrada") ? "neutral" : "pink"}">${esc(item.state)}</span></td>
                        <td><span class="tiny">${esc(item.generatedAt || "—")}</span></td>
                        <td><span class="tiny">${esc(item.sentAt || "—")}</span></td>
                        <td><span class="tiny">${esc(item.openedAt || "—")}</span></td>
                        <td><span class="tiny">${esc(item.finishedAt || "—")}</span></td>
                        <td class="row-actions">
                          <button class="mini-btn primary" type="button" data-act="open-instance" data-arg="${esc(item.id)}">Abrir enlace</button>
                          <button class="mini-btn" type="button" data-act="ver-mensaje" data-arg="${esc(item.id)}">Mensaje</button>
                        </td>
                      </tr>`
                    )
                    .join("")
                : `<tr><td colspan="9"><p class="empty-note">Aún no hay envíos. Pulse <b>Ejecutar ahora</b> o programe una prueba en el paso de Programación.</p></td></tr>`}
            </tbody>
          </table>
        </div>
      </section>
      <p class="tiny hint-line">Esta tabla se actualiza sola cada 4 segundos: abra un enlace, respóndalo y verá cambiar el estado.</p>`;
  }

  /* ---------------- Respuestas ---------------- */
  function renderAnswers() {
    const respuestas = state.respuestas;
    const porInstancia = {};
    respuestas.forEach((r) => {
      porInstancia[r.instanceId] = porInstancia[r.instanceId] || { doctor: r.doctor, period: r.period, fecha: r.finishedAt, items: [] };
      porInstancia[r.instanceId].items.push(r);
    });
    const grupos = Object.entries(porInstancia);

    const dueña = state.answersSurveyId ? state.surveys.find((item) => item.id === state.answersSurveyId) : null;

    return `
      <div class="dl-tabs">
        <div class="dl-tabs-list">
          <button class="dl-tab is-active" type="button">Respuestas${dueña ? ` · ${esc(dueña.name)}` : ""}</button>
        </div>
        <div class="dl-tabs-actions">
          ${state.answersSurveyId ? `<button class="dl-tab-action" type="button" data-act="sends" data-arg="${esc(state.answersSurveyId)}">Envíos</button>` : ""}
          <button class="dl-tab-action" type="button" data-view="survey-list">Regresar</button>
        </div>
      </div>
      <div class="dercas-ribbon">
        <div><b>Lo que respondieron ${dueña && dueña.classification === "Interna" ? "los colaboradores" : "los doctores"}</b><span>Cada encuesta completada, con su nota, motivos y comentario tal como los escribió quien respondió.</span></div>
        <div class="ribbon-tags"><span class="badge neutral">${grupos.length} encuesta(s) completada(s)</span><span class="badge pink">${respuestas.length} respuestas</span></div>
      </div>
      ${grupos.length
        ? grupos
            .map(
              ([id, grupo]) => `
              <section class="page-card answer-card">
                <h2 class="card-title">${esc(grupo.doctor)} <small>${esc(grupo.period)} · ${esc(grupo.fecha || "")}</small></h2>
                <div class="answer-list">
                  ${grupo.items
                    .map(
                      (item) => `
                      <div class="answer-row ${item.calificacion && item.calificacion < 4 ? "baja" : ""}">
                        <div class="answer-main">
                          <b>${esc(item.pregunta)}</b>
                          <span class="tiny">${esc(item.area)} · ${esc(item.nivel)}${item.trabajos.length ? ` · Órdenes: ${esc(item.trabajos.join(", "))}` : ""}${item.asesoras.length ? ` · Asesora: ${esc(item.asesoras.join(", "))}` : ""}</span>
                        </div>
                        <div class="answer-score">${item.calificacion ? `${"★".repeat(item.calificacion)}<small>${item.calificacion}/5</small>` : esc(item.valor)}</div>
                        <div class="answer-extra">
                          ${item.motivos && item.motivos.length ? `<div class="answer-tags">${item.motivos.map((m) => `<span>${esc(m)}</span>`).join("")}</div>` : ""}
                          ${item.comentario ? `<p class="answer-comment">“${esc(item.comentario)}”</p>` : ""}
                        </div>
                      </div>`
                    )
                    .join("")}
                </div>
              </section>`
            )
            .join("")
        : `<p class="empty-note">Todavía nadie responde. Vaya a <b>Envíos</b>, ejecute el JOB, abra un enlace y respóndalo: aparecerá aquí en segundos.</p>`}`;
  }

  /* ---------------- Resultados ---------------- */
  function renderResults() {
    const respuestas = state.respuestas;
    const areas = {};
    respuestas
      .filter((r) => r.calificacion)
      .forEach((r) => {
        areas[r.area] = areas[r.area] || { total: 0, count: 0, tags: {} };
        areas[r.area].total += r.calificacion;
        areas[r.area].count += 1;
        (r.motivos || []).forEach((tag) => (areas[r.area].tags[tag] = (areas[r.area].tags[tag] || 0) + 1));
      });

    const cards = Object.entries(areas).map(([area, data]) => {
      const top = Object.entries(data.tags).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([tag]) => tag).join(" · ");
      return `<article><span>${esc(area)}</span><b>${(data.total / data.count).toFixed(2)} / 5</b><small>${data.count} evaluaciones</small><em>${esc(top || "Sin motivos registrados")}</em></article>`;
    });

    return `
      <div class="dercas-ribbon">
        <div><b>Resultados por área responsable</b><span>Cada respuesta viaja por la relación Pregunta → Área. Servicio al Cliente solo atribuye asesora cuando la respuesta se relaciona con una orden.</span></div>
        <div class="ribbon-tags"><span class="badge neutral">${respuestas.length} respuestas</span></div>
      </div>
      ${cards.length ? `<div class="area-result-grid">${cards.join("")}</div>` : `<p class="empty-note">Todavía no hay respuestas. Genere, envíe y responda una encuesta para ver los indicadores.</p>`}
      <section class="page-card">
        <h2 class="card-title">Detalle</h2>
        <div class="table-wrap">
          <table class="data-table">
            <thead><tr><th>Doctor</th><th>Pregunta</th><th>Área</th><th>Nota</th><th>Nivel</th><th>Órdenes</th><th>Asesora</th><th>Motivos</th><th>Comentario</th></tr></thead>
            <tbody>
              ${respuestas.length
                ? respuestas
                    .map(
                      (r) => `
                      <tr>
                        <td>${esc(r.doctor)}</td>
                        <td>${esc(r.pregunta)}</td>
                        <td>${esc(r.area)}</td>
                        <td><b>${r.calificacion ? `${r.calificacion} ★` : esc(r.valor)}</b></td>
                        <td><span class="badge ${r.nivel === "GENERAL" ? "neutral" : "pink"}">${esc(r.nivel)}</span></td>
                        <td>${r.trabajos.length ? esc(r.trabajos.join(", ")) : "—"}</td>
                        <td>${r.asesoras.length ? esc(r.asesoras.join(", ")) : "—"}</td>
                        <td>${esc((r.motivos || []).join(", ") || "—")}</td>
                        <td class="comment-cell">${esc(r.comentario || "—")}</td>
                      </tr>`
                    )
                    .join("")
                : `<tr><td colspan="9"><p class="empty-note">Sin respuestas.</p></td></tr>`}
            </tbody>
          </table>
        </div>
      </section>`;
  }

  /* ---------------- WhatsApp ---------------- */
  function renderWhatsapp() {
    const wa = state.estado.whatsapp;
    const mensajes = state.mensajes;

    let panel = "";
    if (!wa.disponible) {
      panel = `
        <div class="wa-panel sim">
          <b>Modo simulado</b>
          <p>No hay canal de WhatsApp configurado, así que los mensajes no salen; todo lo demás funciona y queda registrado abajo.</p>

          <p><b>Opción 1 — API oficial de Meta (no instala nada)</b><br>
          Cree una app en <code>developers.facebook.com</code>, agregue el producto WhatsApp,
          verifique el número +${esc(state.estado.destino)} y copie el token y el ID del número. Luego arranque así:</p>
          <pre>set WA_TOKEN=EAAG...
set WA_PHONE_ID=123456789
npm start</pre>

          <p><b>Opción 2 — whatsapp-web.js</b> (si npm coopera):</p>
          <pre>npm config set script-shell "C:\\Windows\\System32\\cmd.exe"
npm install whatsapp-web.js --ignore-scripts
set CHROME_PATH=C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe
npm start</pre>

          <p><b>Opción 3 — Baileys</b>:</p>
          <pre>npm cache clean --force
git config --global url."https://github.com/".insteadOf ssh://git@github.com/
npm install</pre>
        </div>`;
    } else if (wa.conectado && !wa.necesitaQR) {
      panel = `
        <div class="wa-panel on">
          <b>Conectado por la API oficial de Meta</b>
          <p class="tiny">Canal: ${esc(wa.proveedor)}${wa.numero ? ` · número ${esc(wa.numero)}` : ""}</p>
          <p>Los envíos llegan a <b>+${esc(state.estado.destino)}</b>. Recuerde que Meta solo permite
          texto libre si ese número le escribió en las últimas 24 horas; si no, responda primero
          desde el teléfono y vuelva a intentar.</p>
          ${wa.error ? `<p class="aviso">${esc(wa.error)}</p>` : ""}
          <div class="review-actions">
            <button class="btn primary" type="button" data-act="wa-prueba">Enviar mensaje de prueba</button>
          </div>
        </div>`;
    } else if (wa.conectado) {
      panel = `
        <div class="wa-panel on">
          <b>Conectado como +${esc(wa.numero)}</b>
          <p class="tiny">Librería: ${esc(wa.proveedor)}</p>
          <p>Los envíos de prueba llegan a <b>+${esc(state.estado.destino)}</b>.</p>
          ${wa.numero !== state.estado.origen ? `<p class="aviso">Se esperaba la cuenta +${esc(state.estado.origen)}.</p>` : ""}
          <div class="review-actions">
            <button class="btn primary" type="button" data-act="wa-prueba">Enviar mensaje de prueba</button>
            <button class="btn" type="button" data-act="wa-salir">Cerrar sesión</button>
          </div>
        </div>`;
    } else if (wa.qrImagen || wa.qrTexto) {
      panel = `
        <div class="wa-panel qr">
          <b>Escanee el código con el número +${esc(state.estado.origen)}</b>
          <p>WhatsApp → Dispositivos vinculados → Vincular un dispositivo.</p>
          ${wa.qrImagen ? `<img class="wa-qr" src="${wa.qrImagen}" alt="Código QR de WhatsApp">` : `<pre class="wa-qr-text">${esc(wa.qrTexto)}</pre><p class="tiny">Instale <code>qrcode</code> para ver la imagen, o mire el QR en la terminal.</p>`}
        </div>`;
    } else {
      const sinNavegador = /chrome|chromium|browser|executable|launch/i.test(wa.error || "");
      panel = `
        <div class="wa-panel qr">
          <b>${sinNavegador ? "No se encontró el navegador" : "Conectando con WhatsApp…"}</b>
          <p>${esc(wa.error || "Espere unos segundos; el código QR aparecerá aquí.")}</p>
          ${sinNavegador ? `<p>whatsapp-web.js necesita un Chrome. Cierre el servidor y arránquelo indicándole el suyo:</p>
          <pre>set CHROME_PATH=C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe
npm start</pre>` : ""}
          <button class="btn" type="button" data-act="wa-conectar">Reintentar</button>
        </div>`;
    }

    return `
      <div class="dercas-ribbon">
        <div><b>Canal de WhatsApp</b><span>${wa.proveedor ? `Envío por ${esc(wa.proveedor)}. ` : ""}Todos los mensajes de prueba se dirigen a +${esc(state.estado.destino)}. El enlace que se envía apunta a ${esc(state.estado.baseUrl)} — el teléfono debe estar en la misma red Wi-Fi.</span></div>
        <div class="ribbon-tags"><span class="badge ${wa.conectado ? "" : "neutral"}">${wa.conectado ? "CONECTADO" : wa.disponible ? "SIN CONECTAR" : "SIMULADO"}</span>${wa.proveedor ? `<span class="badge neutral">${esc(wa.proveedor)}</span>` : ""}</div>
      </div>
      <section class="page-card">${panel}</section>
      <section class="page-card">
        <h2 class="card-title">Bitácora de mensajes <small>lo último primero</small></h2>
        <div class="table-wrap">
          <table class="data-table">
            <thead><tr><th>Fecha</th><th>Tipo</th><th>Para</th><th>Doctor</th><th>Estado</th><th>Mensaje</th></tr></thead>
            <tbody>
              ${mensajes.length
                ? mensajes
                    .map(
                      (m) => `
                      <tr>
                        <td><span class="tiny">${esc(new Date(m.fecha).toLocaleString("es-GT", { hour12: false }))}</span></td>
                        <td>${esc(m.tipo)}</td>
                        <td>+${esc(m.destino)}</td>
                        <td>${esc(m.doctor || "—")}</td>
                        <td><span class="badge ${m.ok ? "" : "neutral"}">${m.ok ? "ENVIADO" : m.simulado ? "SIMULADO" : "ERROR"}</span></td>
                        <td class="comment-cell">${esc(m.texto)}</td>
                      </tr>`
                    )
                    .join("")
                : `<tr><td colspan="6"><p class="empty-note">Sin mensajes todavía.</p></td></tr>`}
            </tbody>
          </table>
        </div>
      </section>`;
  }

  /* ---------------- Trabajos ---------------- */
  function renderWorkList() {
    const f = filtrosTra();
    const list = trabajosFiltrados();
    const cuenta = cuentaFiltros(f, FILTROS_TRA);

    /* Paginado: con cientos de órdenes no se puede pintar todo de un tiro */
    const porPagina = Number(state.traPorPagina) || 50;
    const paginas = Math.max(1, Math.ceil(list.length / porPagina));
    const pagina = Math.min(Math.max(1, Number(state.traPagina) || 1), paginas);
    state.traPagina = pagina;
    const inicio = (pagina - 1) * porPagina;
    const visibles = list.slice(inicio, inicio + porPagina);

    const derecha = `
      <div class="dl-toolbar-right">
        <label class="dl-per-page">Mostrar
          <select data-tra-por-pagina>
            ${[25, 50, 100, 200].map((n) => `<option value="${n}" ${n === porPagina ? "selected" : ""}>${n}</option>`).join("")}
          </select>
          registros
        </label>
        <button class="dl-quick ${f.desde === DL.PERIODO_DESDE ? "is-active" : ""}" type="button" data-act="filtro-periodo">del período</button>
      </div>`;

    return `
      <div class="dl-tabs">
        <div class="dl-tabs-list">
          <button class="dl-tab is-active" type="button">Trabajos (${list.length})</button>
        </div>
      </div>

      <section class="dl-card">
        <div class="dl-filters">
          <div class="dl-toolbar">
            <button class="dl-filter-toggle ${state.filtrosTrabajosOpen ? "is-open" : ""}" type="button" data-act="toggle-filtros-trabajo">
              ${state.filtrosTrabajosOpen ? "Ocultar filtros" : "Ver filtros"}
              ${cuenta ? `<span class="dl-filter-count">${cuenta}</span>` : ""}
            </button>
            <button class="dl-filter-clear" type="button" data-act="limpiar-filtros-trabajo" ${cuenta ? "" : "disabled"}>Borrar filtros</button>
            ${derecha}
          </div>
          ${state.filtrosTrabajosOpen ? `
            <div class="dl-filter-panel">
              ${campoTrabajo("Cliente", "clinica", unicos(DL.WORKS, "clinic"), f.clinica, "dl-field--wide")}
              ${campoTrabajo("Doctor/a", "doctor", unicos(DL.WORKS, "doctor"), f.doctor)}
              ${campoTrabajo("Caja", "caja", unicos(DL.WORKS, "box"), f.caja, "dl-field--tiny")}
              ${campoTrabajo("Estado", "estado", unicos(DL.WORKS, "status"), f.estado)}
              ${campoTrabajo("Producto", "producto", unicos(DL.WORKS, "product"), f.producto)}
              ${campoTrabajo("Asesora", "asesora", unicos(DL.WORKS, "advisor"), f.asesora)}
              <div class="dl-date-card">
                <div class="dl-date-title">Envío</div>
                <label class="dl-field"><span>Desde</span><input type="date" data-filtro-trabajo="desde" value="${attr(f.desde)}"></label>
                <label class="dl-field"><span>Hasta</span><input type="date" data-filtro-trabajo="hasta" value="${attr(f.hasta)}"></label>
              </div>
              <label class="dl-field dl-field--wide"><span>Búsqueda</span>
                <div class="dl-search">
                  <span class="dl-ico">⌕</span>
                  <input id="buscarTrabajo" data-filtro-trabajo="texto" value="${attr(f.texto)}" placeholder="Código, paciente, doctor o clínica…">
                  ${f.texto ? `<button class="dl-search-clear" type="button" data-act="limpiar-texto-trabajo" title="Limpiar">✕</button>` : ""}
                </div>
              </label>
            </div>` : ""}
        </div>

        <div class="dl-table-wrap">
          <table class="dl-table">
            <thead><tr>
              <th>Código</th><th>Caja</th><th>Cliente</th><th>Doctor/a</th><th>Paciente</th>
              <th>Producto</th><th>Envío</th><th>Asesora</th><th>Estado</th><th class="dl-col-opts">Opciones</th>
            </tr></thead>
            <tbody>
              ${list.length === 0 ? `<tr><td colspan="10">Ningún trabajo coincide con los filtros.</td></tr>` : visibles.map((work) => {
                const eligible = ["enviado", "facturado"].includes(work.status);
                return `
                  <tr class="dl-row-link" data-row-open="work-detail" data-row-arg="${esc(work.id)}" title="Ver el trabajo">
                    <td><b>${esc(work.code)}</b></td>
                    <td>${esc(work.box)}</td>
                    <td>${esc(work.clinic)}</td>
                    <td>${esc(work.doctor)}</td>
                    <td>${esc(work.patient)}</td>
                    <td>${esc(work.product)}</td>
                    <td>${esc(work.sent)}</td>
                    <td>${esc(work.advisor)}</td>
                    <td><span class="dl-badge ${eligible ? "ok" : "warn"}">${esc(work.status)}</span></td>
                    <td class="dl-col-opts">
                      <div class="menu-wrap">
                        <button class="dl-mini ${state.openMenu === "w-" + work.id ? "on" : ""}" type="button" data-menu="w-${esc(work.id)}">Opciones</button>
                        ${state.openMenu === "w-" + work.id ? `
                          <div class="menu-pop">
                            <button type="button" data-act="work-detail" data-arg="${esc(work.id)}">Ver trabajo</button>
                            <button type="button" data-act="survey-from-work" data-arg="${esc(work.id)}" ${eligible ? "" : "disabled"}>Encuesta del doctor</button>
                          </div>` : ""}
                      </div>
                    </td>
                  </tr>`;
              }).join("")}
            </tbody>
          </table>
        </div>
        <div class="dl-table-foot">
          <span>${list.length === 0 ? "Sin registros" : `Mostrando ${inicio + 1} a ${Math.min(inicio + porPagina, list.length)} de ${list.length} registros`}${list.length !== DL.WORKS.length ? ` (de ${DL.WORKS.length} en total)` : ""}</span>
          ${paginador(pagina, paginas)}
        </div>
      </section>`;
  }

  /* Paginador corto: primera, anterior, una ventana de páginas, siguiente, última */
  function paginador(pagina, paginas, atributo = "data-tra-pagina") {
    if (paginas <= 1) return "";
    const boton = (etiqueta, destino, activa = false, apagada = false) =>
      `<button class="dl-page ${activa ? "is-active" : ""}" type="button" ${atributo}="${destino}" ${apagada ? "disabled" : ""}>${etiqueta}</button>`;

    const ventana = [];
    const desde = Math.max(1, Math.min(pagina - 2, paginas - 4));
    for (let n = desde; n <= Math.min(paginas, desde + 4); n += 1) ventana.push(n);

    return `
      <div class="dl-pager">
        ${boton("«", 1, false, pagina === 1)}
        ${boton("‹", pagina - 1, false, pagina === 1)}
        ${ventana.map((n) => boton(n, n, n === pagina)).join("")}
        ${ventana[ventana.length - 1] < paginas ? `<span class="dl-page-gap">…</span>${boton(paginas, paginas)}` : ""}
        ${boton("›", pagina + 1, false, pagina === paginas)}
        ${boton("»", paginas, false, pagina === paginas)}
      </div>`;
  }

  function campoTrabajo(etiqueta, campo, opciones, valor, ancho = "") {
    return `
      <label class="dl-field ${ancho}"><span>${etiqueta}</span>
        <select data-filtro-trabajo="${campo}">
          <option value="">- Cualquiera -</option>
          ${opciones.map((opcion) => `<option ${String(opcion) === String(valor) ? "selected" : ""}>${esc(opcion)}</option>`).join("")}
        </select>
      </label>`;
  }

  /* Resultado de la encuesta en la que entró esta orden */
  async function cargarEncuestasDelTrabajo(workId) {
    try {
      state.workSurveys = await DL.api.encuestasDeTrabajo(workId);
    } catch (error) {
      state.workSurveys = [];
    }
    if (state.view === "work-detail") renderView();
  }

  const estrellas = (nota) => "★★★★★".slice(0, Math.round(Number(nota) || 0)).padEnd(5, "☆");

  /* Puntuación que se ve junto al código del trabajo.
     Solo hay nota si el doctor ya respondió (RN-ENC-011). */
  function puntuacionTrabajo() {
    if (state.workSurveys === null) return `<div class="wk-score cargando"><span>Encuesta del doctor</span><b>Consultando…</b></div>`;
    if (!state.workSurveys.length) {
      return `<div class="wk-score vacia"><span>Encuesta del doctor</span><b>No incluida en ninguna encuesta</b></div>`;
    }
    const ultima = state.workSurveys[0];
    if (!ultima.respondida) {
      return `
        <div class="wk-score pendiente">
          <span>Encuesta del doctor</span>
          <b>${esc(ultima.state)}</b>
          <i>${esc(ultima.period)} · sin respuesta todavía</i>
        </div>`;
    }
    const nota = ultima.promedioOrden !== "—" ? ultima.promedioOrden : ultima.promedioEncuesta;
    const baja = Number(nota) < 4;
    return `
      <div class="wk-score ${baja ? "baja" : "alta"}">
        <span>Puntuación de la encuesta</span>
        <b>${esc(nota)} <em>/ 5</em></b>
        <i class="wk-stars">${estrellas(nota)}</i>
        <i>${esc(ultima.period)}${ultima.promedioOrden === "—" ? " · evaluación general" : ""}</i>
      </div>`;
  }

  function filaRespuesta(respuesta) {
    const nota = Number(respuesta.calificacion) || 0;
    return `
      <tr>
        <td><b>${esc(respuesta.pregunta)}</b></td>
        <td>${esc(respuesta.area)}</td>
        <td><span class="dl-badge ${nota >= 4 ? "ok" : nota ? "bad" : ""}">${respuesta.calificacion ? `${respuesta.calificacion} ★` : "—"}</span></td>
        <td>${esc(respuesta.nivel === "GENERAL" ? "General" : "Por orden")}</td>
        <td>${esc((respuesta.motivos || []).join(", ") || respuesta.valor || "—")}</td>
        <td class="wk-comment">${esc(respuesta.comentario || "—")}</td>
      </tr>`;
  }

  /* Bloque completo de la encuesta dentro de la ficha del trabajo */
  function bloqueEncuestaTrabajo(work) {
    if (state.workSurveys === null) {
      return `<section class="dl-card"><div class="wk-block-head"><div><b>Encuesta del doctor</b><span>Consultando el resultado de esta orden…</span></div></div></section>`;
    }
    if (!state.workSurveys.length) {
      return `
        <section class="dl-card">
          <div class="wk-block-head"><div><b>Encuesta del doctor</b><span>Resultado de la encuesta en la que entró esta orden.</span></div></div>
          <p class="wk-note dl-muted">Esta orden todavía no forma parte de ninguna encuesta generada. Se incluirá cuando se genere la encuesta del período de ${esc(work.doctor)}.</p>
        </section>`;
    }

    return state.workSurveys
      .map((res) => {
        const cabecera = `
          <div class="wk-block-head">
            <div><b>Encuesta del doctor · ${esc(res.surveyName)}</b><span>${esc(res.classification)}${res.subtype ? ` · ${esc(res.subtype)}` : ""} · período ${esc(res.period)} · ${res.totalOrdenes} orden(es) evaluadas</span></div>
            <span class="dl-badge ${res.respondida ? "ok" : "warn"}">${esc(res.state)}</span>
          </div>`;

        if (!res.respondida) {
          return `
            <section class="dl-card">
              ${cabecera}
              <div class="wk-panel wk-panel--plain">
                <div class="wk-item"><span>Enviada</span><b>${esc(res.sentAt || "—")}</b></div>
                <div class="wk-item"><span>Abierta</span><b>${esc(res.openedAt || "—")}</b></div>
                <div class="wk-item"><span>Respondida</span><b>—</b></div>
                <div class="wk-item"><span>Puntuación</span><b>Sin puntuación: el doctor no ha respondido</b></div>
              </div>
            </section>`;
        }

        return `
          <section class="dl-card">
            ${cabecera}
            <div class="wk-panel wk-panel--plain">
              <div class="wk-item"><span>Promedio de esta orden</span><b class="${Number(res.promedioOrden) < 4 ? "wk-bad" : "wk-good"}">${esc(res.promedioOrden)} ${res.promedioOrden === "—" ? "" : "★"}</b></div>
              <div class="wk-item"><span>Promedio de la encuesta</span><b>${esc(res.promedioEncuesta)} ★</b></div>
              <div class="wk-item"><span>Respuestas de esta orden</span><b>${res.respuestasOrden.length}</b></div>
              <div class="wk-item"><span>Enviada</span><b>${esc(res.sentAt || "—")}</b></div>
              <div class="wk-item"><span>Abierta</span><b>${esc(res.openedAt || "—")}</b></div>
              <div class="wk-item"><span>Respondida</span><b>${esc(res.finishedAt || "—")}</b></div>
            </div>
            <div class="dl-table-wrap">
              <table class="dl-table">
                <thead><tr><th>Pregunta</th><th>Área responsable</th><th>Calificación</th><th>Nivel</th><th>Motivos</th><th>Comentario</th></tr></thead>
                <tbody>
                  ${res.respuestasOrden.length ? res.respuestasOrden.map(filaRespuesta).join("") : `<tr><td colspan="6">Esta orden se evaluó dentro de la calificación general del doctor.</td></tr>`}
                  ${res.respuestasGenerales.length ? `<tr class="wk-total"><td colspan="6">Evaluación general del doctor (no se atribuye a una orden ni a una asesora)</td></tr>${res.respuestasGenerales.map(filaRespuesta).join("")}` : ""}
                </tbody>
              </table>
            </div>
          </section>`;
      })
      .join("");
  }

  /* ==================================================================
     LABORATORIO · Empleados
     ================================================================== */
  function renderEmpleados() {
    const f = filtrosEmp();
    const list = empleadosFiltrados();
    const cuenta = cuentaFiltros(f, FILTROS_EMP);
    const areas = unicos(state.empleados, "area");
    const puestos = unicos(state.empleados.filter((e) => !f.area || e.area === f.area), "position");

    return `
      <div class="dl-tabs">
        <div class="dl-tabs-list">
          <button class="dl-tab is-active" type="button">Empleados (${list.length})</button>
        </div>
        <div class="dl-tabs-actions">
          <button class="dl-tab-action" type="button" data-view="whatsapp">WhatsApp</button>
        </div>
      </div>

      <section class="dl-card">
        <div class="dl-filters">
          <div class="dl-toolbar">
            <button class="dl-filter-toggle ${state.filtrosEmpOpen ? "is-open" : ""}" type="button" data-act="toggle-filtros-emp">
              ${state.filtrosEmpOpen ? "Ocultar filtros" : "Ver filtros"}
              ${cuenta ? `<span class="dl-filter-count">${cuenta}</span>` : ""}
            </button>
            <button class="dl-filter-clear" type="button" data-act="limpiar-filtros-emp" ${cuenta ? "" : "disabled"}>Borrar filtros</button>
          </div>
          ${state.filtrosEmpOpen ? `
            <div class="dl-filter-panel">
              ${campoEmpleado("Área", "area", areas, f.area, "dl-field--wide")}
              ${campoEmpleado("Puesto", "puesto", puestos, f.puesto, "dl-field--wide")}
              <label class="dl-field dl-field--wide"><span>Búsqueda</span>
                <div class="dl-search">
                  <span class="dl-ico">⌕</span>
                  <input id="buscarEmpleado" data-filtro-emp="texto" value="${attr(f.texto)}" placeholder="Nombre, puesto o correo…">
                  ${f.texto ? `<button class="dl-search-clear" type="button" data-act="limpiar-texto-emp" title="Limpiar">✕</button>` : ""}
                </div>
              </label>
              <label class="dl-field dl-field--check"><span>Estado</span>
                <span class="dl-check-box ${f.inactivos ? "is-checked" : ""}"><input type="checkbox" data-filtro-emp-check="inactivos" ${f.inactivos ? "checked" : ""}> Mostrar todos</span>
              </label>
            </div>` : ""}
        </div>

        <div class="dl-table-wrap">
          <table class="dl-table">
            <thead><tr>
              <th>Empleado</th><th>Puesto</th><th>Área</th><th>Correo</th><th>Jefe directo</th>
              <th>Encuestas</th><th>Respondidas</th><th>Estado</th>
            </tr></thead>
            <tbody>
              ${list.length === 0 ? `<tr><td colspan="8">Ningún colaborador coincide con los filtros.</td></tr>` : list.map((persona) => `
                <tr class="dl-row-link" data-row-open="employee-detail" data-row-arg="${esc(persona.id)}" title="Abrir el mantenimiento del empleado">
                  <td><b>${esc(persona.name)}</b>${persona.supervisor ? ` <i>jefe de área</i>` : ""}</td>
                  <td>${esc(persona.position)}</td>
                  <td>${esc(persona.area)}</td>
                  <td>${esc(persona.email)}</td>
                  <td>${esc(persona.manager || "—")}</td>
                  <td>${persona._asignadas || 0}</td>
                  <td>${persona._respondidas ? `<span class="dl-badge ok">${persona._respondidas}</span>` : "0"}</td>
                  <td><span class="dl-badge ${persona.active ? "ok" : "off"}">${persona.active ? "Activo" : "Inactivo"}</span></td>
                </tr>`).join("")}
            </tbody>
          </table>
        </div>
        <div class="dl-table-foot"><span>${list.length} de ${state.empleados.length} colaborador(es)</span></div>
      </section>

      `;
  }

  /* ==================================================================
     LABORATORIO · Mantenimiento del empleado
     ================================================================== */
  const EMP_TABS = [
    ["personales", "Datos personales"],
    ["direccion", "Dirección"],
    ["ocupacion", "Ocupación"],
    ["marcajes", "Marcajes"],
    ["documentacion", "Documentación"],
    ["encuestas", "Encuestas"],
  ];

  /* Campos en modo consulta: se ven como el formulario del sistema */
  const campoTexto = (etiqueta, valor, ancho = "") => `
    <label class="emp-field ${ancho}"><span>${etiqueta}</span>
      <input value="${attr(valor == null || valor === "" ? "" : valor)}" placeholder="—" readonly>
    </label>`;

  const campoLista = (etiqueta, valor, opciones, ancho = "") => `
    <label class="emp-field ${ancho}"><span>${etiqueta}</span>
      <select disabled>${options(opciones, valor)}</select>
    </label>`;

  function renderEmpleadoDetalle() {
    const persona = state.empleado;
    if (!persona) return `<p class="cargando">Cargando la ficha del colaborador…</p>`;

    const cuerpo = {
      personales: empPersonales,
      direccion: empDireccion,
      ocupacion: empOcupacion,
      marcajes: empMarcajes,
      documentacion: empDocumentacion,
      encuestas: empEncuestas,
    }[state.empTab](persona);

    return `
      <div class="emp-head">
        <button class="emp-back" type="button" data-view="employees">Regresar</button>
        <h1>${esc(persona.name)}</h1>
        <span class="dl-badge ${persona.active ? "ok" : "off"}">${persona.active ? "Activo" : "Inactivo"}</span>
        <span class="emp-head-role">${esc(persona.position)} · ${esc(persona.area)}</span>
        <button class="emp-edit" type="button" data-act="emp-editar" title="Editar">Editar</button>
      </div>

      <div class="dl-tabs">
        <div class="dl-tabs-list">
          ${EMP_TABS.map(([id, label]) => `
            <button class="dl-tab ${state.empTab === id ? "is-active" : ""}" type="button" data-act="emp-tab" data-arg="${id}">${label}</button>`).join("")}
        </div>
      </div>

      ${cuerpo}`;
  }

  function empPersonales(persona) {
    const roles = ["ADMINISTRADOR", "JEFE DE DEPARTAMENTO", "OPERADOR", "RECURSOS HUMANOS", "SUPERVISOR DE AREA"];
    return `
      <section class="dl-card">
        <div class="wk-block-head"><div><b>Datos personales</b><span>Identificación y datos de contacto del colaborador.</span></div></div>
        <div class="emp-grid">
          ${campoTexto("Nombre *", persona.firstName)}
          ${campoTexto("Apellido *", persona.lastName)}
          ${campoTexto("Email *", persona.email)}
          ${campoTexto("Contraseña (opcional)", "")}
          ${campoTexto("Teléfono", persona.phone)}
          ${campoTexto("NIT", persona.nit)}
          ${campoTexto("DPI *", persona.dpi)}
          ${campoTexto("Fecha de nacimiento", persona.birthDate)}
          ${campoTexto("Cuenta bancaria", persona.bankAccount)}
          ${campoTexto("Tipo de cuenta", persona.accountType)}
          ${campoLista("Banco", persona.bankName, [persona.bankName])}
          ${campoTexto("Avatar", "")}
          <div class="emp-field emp-field--wide">
            <span class="emp-check ${persona.active ? "is-on" : ""}"><input type="checkbox" ${persona.active ? "checked" : ""} disabled> Empleado activo</span>
          </div>
          <div class="emp-field emp-field--wide">
            <span>Roles *</span>
            <div class="emp-roles">
              ${roles.map((rol) => `<span class="emp-role ${(persona.roles || []).includes(rol) ? "is-on" : ""}">${esc(rol)}</span>`).join("")}
            </div>
          </div>
        </div>
      </section>`;
  }

  function empDireccion(persona) {
    const municipios = (DL.MUNICIPIOS || {})[persona.department] || [persona.city];
    return `
      <section class="dl-card">
        <div class="wk-block-head"><div><b>Dirección</b><span>Información de domicilio del empleado.</span></div></div>
        <div class="emp-grid">
          ${campoTexto("Calle", persona.street, "emp-field--wide")}
          ${campoTexto("Calle 2nda línea", persona.street2, "emp-field--wide")}
          ${campoLista("Departamento", persona.department, DL.DEPARTAMENTOS || [persona.department])}
          ${campoLista("Municipio", persona.city, municipios)}
          ${campoTexto("Código postal", persona.postalCode)}
          ${campoLista("País", persona.country, [persona.country])}
        </div>
      </section>`;
  }

  function empOcupacion(persona) {
    return `
      <section class="dl-card">
        <div class="wk-block-head"><div><b>Asignación</b><span>Área, puesto y jefe directo dentro del laboratorio.</span></div></div>
        <div class="emp-grid">
          ${campoLista("Área *", persona.area, DL.AREAS_LAB || [persona.area], "emp-field--wide")}
          ${campoLista("Puesto *", persona.position, [persona.position], "emp-field--wide")}
          ${campoLista("Jefe directo", persona.manager || "—", [persona.manager || "—"], "emp-field--wide")}
          ${campoTexto("Horas diarias", persona.dailyHours)}
        </div>
      </section>

      <section class="dl-card">
        <div class="wk-block-head"><div><b>Condiciones</b><span>Contratación y forma de pago.</span></div></div>
        <div class="emp-grid">
          ${campoTexto("Fecha contratación", persona.hireDate)}
          ${campoLista("Tipo remuneración *", persona.payType, [persona.payType])}
          <label class="emp-field"><span>Color identificativo</span>
            <span class="emp-color"><i style="background:${attr(persona.color)}"></i><input value="${attr(persona.color)}" readonly></span>
          </label>
        </div>
      </section>

      <section class="dl-card">
        <div class="wk-block-head">
          <div><b>Fases preasignadas</b><span>Tareas que este colaborador puede tomar en producción.</span></div>
          <span class="wk-count">${(persona.phases || []).length} fase(s)</span>
        </div>
        <div class="dl-table-wrap">
          <table class="dl-table">
            <thead><tr><th>Fase</th><th>Capacidad diaria</th><th>Estado</th></tr></thead>
            <tbody>
              ${(persona.phases || []).map((fase) => `
                <tr><td><b>${esc(fase)}</b></td><td>0.00</td><td><span class="dl-badge warn">Pendiente</span></td></tr>`).join("")}
            </tbody>
          </table>
        </div>
      </section>`;
  }

  function empMarcajes(persona) {
    return `
      <section class="dl-card">
        <div class="wk-block-head"><div><b>Configuración de marcajes</b><span>Define control horario y horario asignado para el empleado.</span></div></div>
        <div class="emp-grid">
          <div class="emp-field emp-field--wide">
            <span class="emp-check ${persona.timeControl ? "is-on" : ""}"><input type="checkbox" ${persona.timeControl ? "checked" : ""} disabled> Activar control de horario</span>
          </div>
          ${campoLista("Horario asignado *", persona.schedule, [persona.schedule], "emp-field--wide")}
          <label class="emp-field"><span>ID usuario ZKTeco</span>
            <input value="${attr(persona.zktecoId)}" readonly>
            <small>Este valor debe coincidir con el User ID que devuelve el reloj ZKTeco.</small>
          </label>
        </div>
      </section>`;
  }

  function empDocumentacion(persona) {
    return `
      <section class="dl-card">
        <div class="wk-block-head">
          <div><b>Documentación</b><span>Expediente del colaborador.</span></div>
          <span class="wk-count">${(persona.documents || []).filter((d) => d.state === "Cargado").length} de ${(persona.documents || []).length} completos</span>
        </div>
        <div class="dl-table-wrap">
          <table class="dl-table">
            <thead><tr><th>Documento</th><th>Estado</th><th class="dl-col-opts">Archivo</th></tr></thead>
            <tbody>
              ${(persona.documents || []).map((doc) => `
                <tr>
                  <td><b>${esc(doc.name)}</b></td>
                  <td><span class="dl-badge ${doc.state === "Cargado" ? "ok" : "warn"}">${esc(doc.state)}</span></td>
                  <td class="dl-col-opts">${doc.state === "Cargado" ? `<button class="dl-mini" type="button" data-act="emp-editar">Ver</button>` : "—"}</td>
                </tr>`).join("")}
            </tbody>
          </table>
        </div>
      </section>`;
  }

  /* La razón por la que el personal vive en este prototipo */
  function empEncuestas(persona) {
    const list = persona._encuestas || [];
    const hechas = list.filter((e) => e.respondida);
    const notas = hechas.filter((e) => e.promedio !== "—").map((e) => Number(e.promedio));
    const media = notas.length ? (notas.reduce((a, b) => a + b, 0) / notas.length).toFixed(2) : "—";

    return `
      <section class="res-cards">
        <div class="res-card"><span>Colaborador</span><b>${esc(persona.name)}</b><i>${esc(persona.area)}</i></div>
        <div class="res-card"><span>Asignadas</span><b>${list.length}</b></div>
        <div class="res-card"><span>Respondidas</span><b>${hechas.length}</b></div>
        <div class="res-card res-card--total"><span>Promedio que ha puesto</span><b>${esc(media)}</b><i>${notas.length ? "de sus respuestas" : "sin respuestas"}</i></div>
      </section>

      <section class="dl-card">
        <div class="wk-block-head"><div><b>Encuestas internas de este colaborador</b><span>Las encuestas anónimas se muestran aquí solo como control de participación.</span></div></div>
        <div class="dl-table-wrap">
          <table class="dl-table">
            <thead><tr><th>Encuesta</th><th>Período</th><th>Evalúa a</th><th>Estado</th><th>Promedio</th><th>Respondida</th></tr></thead>
            <tbody>
              ${list.length === 0 ? `<tr><td colspan="6">Todavía no le toca ninguna encuesta. Ejecute una interna de su área desde Encuestas → Envíos.</td></tr>` : list.map((item) => `
                <tr>
                  <td><b>${esc(item.surveyName)}</b></td>
                  <td>${esc(item.period)}</td>
                  <td>${esc(item.supervisor || "—")}</td>
                  <td><span class="dl-badge ${item.respondida ? "ok" : "warn"}">${item.respondida ? "Respondida" : esc(item.state)}</span></td>
                  <td>${item.promedio === "—" ? "—" : `<span class="dl-badge ${Number(item.promedio) >= 4 ? "ok" : "bad"}">★ ${esc(item.promedio)}</span>`}</td>
                  <td>${esc(item.finishedAt || "—")}</td>
                </tr>`).join("")}
            </tbody>
          </table>
        </div>
      </section>`;
  }

  function campoEmpleado(etiqueta, campo, opciones, valor, ancho = "") {
    return `
      <label class="dl-field ${ancho}"><span>${etiqueta}</span>
        <select data-filtro-emp="${campo}">
          <option value="">- ${campo === "area" ? "Todas" : "Todos"} -</option>
          ${opciones.map((opcion) => `<option ${String(opcion) === String(valor) ? "selected" : ""}>${esc(opcion)}</option>`).join("")}
        </select>
      </label>`;
  }

  /* ==================================================================
     ENCUESTAS · Resultados (histórico del sistema anterior + motor nuevo)
     ================================================================== */
  const claseEscala = (texto) =>
    texto === "Excelente" ? "ok" : texto === "Bueno" ? "" : texto === "Regular" ? "warn" : "off";

  /* ==================================================================
     ENCUESTAS · Resultados de encuestas
     Igual que en el sistema: dos pestañas
       - Resultados Encuestas            -> internas (por supervisor y período)
       - Resultados encuestas a doctores -> externas (por encuesta enviada)
     Al abrir una encuesta a doctores se ve la encuesta con sus respuestas
     al estilo de un formulario: Resumen · Pregunta · Individual · Doctores.
     ================================================================== */

  /* Íconos (los mismos de lucide que usa el sistema) */
  const ICONOS = {
    eye: '<path d="M2.06 12.35a1 1 0 0 1 0-.7 10.75 10.75 0 0 1 19.88 0 1 1 0 0 1 0 .7 10.75 10.75 0 0 1-19.88 0"/><circle cx="12" cy="12" r="3"/>',
    users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
    check: '<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>',
    sliders: '<line x1="21" x2="14" y1="4" y2="4"/><line x1="10" x2="3" y1="4" y2="4"/><line x1="21" x2="12" y1="12" y2="12"/><line x1="8" x2="3" y1="12" y2="12"/><line x1="21" x2="16" y1="20" y2="20"/><line x1="12" x2="3" y1="20" y2="20"/><line x1="14" x2="14" y1="2" y2="6"/><line x1="8" x2="8" y1="10" y2="14"/><line x1="16" x2="16" y1="18" y2="22"/>',
    down: '<path d="m6 9 6 6 6-6"/>',
    x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
    back: '<path d="m12 19-7-7 7-7"/><path d="M19 12H5"/>',
    left: '<path d="m15 18-6-6 6-6"/>',
    right: '<path d="m9 18 6-6-6-6"/>',
    sheet: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M8 13h2"/><path d="M14 13h2"/><path d="M8 17h2"/><path d="M14 17h2"/>',
    chart: '<path d="M3 3v18h18"/><path d="M18 17V9"/><path d="M13 17V5"/><path d="M8 17v-3"/>',
    download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/>',
    star: '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>',
    briefcase: '<rect width="20" height="14" x="2" y="7" rx="2" ry="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/>',
    mail: '<rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>',
    clock: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16.5 12"/>',
    clipboard: '<rect width="8" height="4" x="8" y="2" rx="1" ry="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="M12 11h4"/><path d="M12 16h4"/><path d="M8 11h.01"/><path d="M8 16h.01"/>',
    message: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/><path d="M13 8H7"/><path d="M17 12H7"/>',
    trending: '<polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/>',
    shield: '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="M12 8v4"/><path d="M12 16h.01"/>',
    dot: '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="1"/>',
  };
  const ico = (nombre, tam = 14) =>
    `<svg xmlns="http://www.w3.org/2000/svg" width="${tam}" height="${tam}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONOS[nombre] || ""}</svg>`;

  const MESES_RES = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
  const LS_RES = "dl_resultados_encuestas";
  const FILTROS_RES = { tab: "internas", abiertos: false, buscar: "", anio: "all", mes: "all", area: "all", detalle: "detail" };
  const filtrosRes = () => (state.filtrosRes = state.filtrosRes || leerFiltros(LS_RES, FILTROS_RES));
  const guardarFiltrosRes = () => escribirFiltros(LS_RES, state.filtrosRes);

  /* Pestañas del grupo "Resultados de encuestas", como NavGroupTabs */
  function tabsResultados(activa) {
    if (!esAdmin()) return "";
    const items = [
      ["internas", "Resultados Encuestas"],
      ["doctores", "Resultados encuestas a doctores"],
    ];
    return `
      <div class="nav-group-tabs" role="tablist" aria-label="Opciones">
        ${items.map(([clave, nombre]) => `
          <button type="button" role="tab" aria-selected="${activa === clave}" class="nav-group-tab ${activa === clave ? "is-active" : ""}" data-act="res-tab" data-arg="${clave}" title="${attr(nombre)}">${esc(nombre)}</button>`).join("")}
      </div>`;
  }

  /* Carga lo que necesita la pestaña activa */
  async function cargarResultados() {
    const f = filtrosRes();
    if (f.tab === "doctores") {
      state.resDoctores = await DL.api.resultadosDoctores();
    }
    else state.resultados = await DL.api.resultados();
  }

  function renderResultadosLista() {
    const f = filtrosRes();
    return f.tab === "doctores" ? renderDoctoresLista() : renderInternasLista();
  }

  /* ---------------- Resultados Encuestas (internas) ---------------- */
  const etiquetaNota = (nota) => {
    if (nota === null || nota === undefined) return "—";
    if (nota >= 4.5) return "Excelente";
    if (nota >= 3.5) return "Bueno";
    if (nota >= 2.5) return "Regular";
    return "Crítico";
  };

  /* Como en el sistema: sin respuestas el promedio es 0.00 (Crítico) */
  const notaInterna = (r) => (r.respuestas && r.promedio !== "—" ? Number(r.promedio) : 0);
  const anioDe = (r) => Number(String(r.period || "").slice(0, 4)) || 0;
  const mesDe = (r) => Number(String(r.period || "").slice(5, 7)) || 0;

  function internasFiltradas() {
    const f = filtrosRes();
    const termino = String(f.buscar || "").trim().toLowerCase();
    return (state.resultados || []).filter((r) => {
      const coincide =
        !termino ||
        [r.surveyName, r.supervisor, r.area, r.periodLabel].some((v) => String(v || "").toLowerCase().includes(termino));
      return (
        coincide &&
        (f.anio === "all" || Number(f.anio) === anioDe(r)) &&
        (f.mes === "all" || Number(f.mes) === mesDe(r)) &&
        (f.area === "all" || f.area === r.area)
      );
    });
  }

  function renderInternasLista() {
    const f = filtrosRes();
    const todas = state.resultados || [];
    const filas = internasFiltradas();
    const anios = [...new Set(todas.map(anioDe).filter(Boolean))].sort((a, b) => b - a);
    const areas = [...new Set(todas.map((r) => r.area).filter((a) => a && a !== "—"))].sort();
    const activos = (String(f.buscar).trim() ? 1 : 0) + (f.anio !== "all" ? 1 : 0) + (f.mes !== "all" ? 1 : 0) + (f.area !== "all" ? 1 : 0);
    const asignados = filas.reduce((t, r) => t + Number(r.asignadas || 0), 0);
    const respuestas = filas.reduce((t, r) => t + Number(r.respuestas || 0), 0);
    const opcion = (valor, texto, actual) => `<option value="${attr(valor)}" ${String(actual) === String(valor) ? "selected" : ""}>${esc(texto)}</option>`;

    return `
      ${tabsResultados("internas")}
      <div class="svy-gmrst__page">
        <div class="svy-gmrst__filters">
          <div class="svy-gmrst__filter-toolbar">
            <button type="button" class="svy-gmrst__filter-toggle ${f.abiertos ? "is-open" : ""}" data-act="res-filtros" aria-expanded="${f.abiertos}">
              ${ico("sliders")}
              <span>${f.abiertos ? "Ocultar filtros" : "Ver filtros"}</span>
              ${activos ? `<span class="svy-gmrst__filter-count">${activos}</span>` : ""}
              ${ico("down", 14).replace("<svg ", '<svg class="svy-gmrst__filter-chevron" ')}
            </button>
            ${activos ? `<button type="button" class="svy-gmrst__filter-clear" data-act="res-limpiar">${ico("x", 13)} Borrar filtros</button>` : ""}
            ${f.abiertos ? `
              <div class="svy-gmrst__inline-filters">
                <div class="svy-gmrst__filter-field">
                  <label>Buscar</label>
                  <input id="buscarResultado" type="text" placeholder="Encuesta, área, supervisor o periodo" value="${attr(f.buscar)}" data-res-filtro="buscar">
                </div>
                <div class="svy-gmrst__filter-field">
                  <label>Año</label>
                  <select data-res-filtro="anio">${opcion("all", "Todos", f.anio)}${anios.map((a) => opcion(a, a, f.anio)).join("")}</select>
                </div>
                <div class="svy-gmrst__filter-field">
                  <label>Mes</label>
                  <select data-res-filtro="mes">${opcion("all", "Todos", f.mes)}${MESES_RES.map((m, i) => opcion(i + 1, m, f.mes)).join("")}</select>
                </div>
                <div class="svy-gmrst__filter-field">
                  <label>Área</label>
                  <select data-res-filtro="area">${opcion("all", "Todas", f.area)}${areas.map((a) => opcion(a, a, f.area)).join("")}</select>
                </div>
              </div>` : ""}
          </div>
        </div>

        <div class="svy-gmrst__table-card">
          <div class="dl-table-wrap">
            <table class="dl-table">
              <thead><tr>
                <th>Encuesta</th><th>Supervisor</th><th>Periodo</th><th>Área</th>
                <th>Asignadas</th><th>Respuestas</th><th>Promedio</th><th class="dl-col-opts">Acción</th>
              </tr></thead>
              <tbody>
                ${filas.length === 0 ? `<tr><td colspan="8">No hay resultados para mostrar.</td></tr>` : filas.map((r) => {
                  const nota = notaInterna(r);
                  return `
                  <tr class="dl-row-link" data-row-open="result-detail" data-row-arg="${attr(r.id)}" title="Ver el detalle">
                    <td><div class="svy-gmrst__primary-cell"><div class="svy-gmrst__primary-title" title="${attr(r.surveyName)}">${esc(r.surveyName)}</div></div></td>
                    <td>${esc(r.supervisor || "—")}</td>
                    <td>${esc(r.periodLabel)}</td>
                    <td>${esc(r.area || "—")}</td>
                    <td><span class="svy-gmrst__metric-chip">${ico("users")}${r.asignadas}</span></td>
                    <td><span class="svy-gmrst__metric-chip svy-gmrst__metric-chip-success">${ico("check")}${r.respuestas}</span></td>
                    <td><div class="svy-gmrst__score-box"><span class="svy-gmrst__score-value">${nota.toFixed(2)}</span><span class="svy-gmrst__score-label">${etiquetaNota(nota)}</span></div></td>
                    <td class="dl-col-opts"><button type="button" class="svy-gmrst__action-btn" data-act="result-detail" data-arg="${attr(r.id)}">${ico("eye")} Ver detalle</button></td>
                  </tr>`;
                }).join("")}
              </tbody>
            </table>
          </div>
          <div class="dl-table-foot"><span>${filas.length} registro(s)</span></div>
        </div>

        <div class="svy-gmrst__summary-grid">
          <div class="svy-gmrst__summary-card"><span class="svy-gmrst__label">Encuestas aplicadas</span><strong>${filas.length}</strong></div>
          <div class="svy-gmrst__summary-card"><span class="svy-gmrst__label">Colaboradores asignados</span><strong>${asignados}</strong></div>
          <div class="svy-gmrst__summary-card"><span class="svy-gmrst__label">Respuestas recibidas</span><strong>${respuestas}</strong></div>
        </div>
      </div>`;
  }

  /* ---------------- Detalle de una encuesta interna ---------------- */
  const ESTADO_COLAB = { Respondida: "submitted", Enviada: "pending", Abierta: "in_progress", Parcial: "in_progress" };

  function analisisInterno(r) {
    const preguntas = (r.preguntas || []).map((q, i) => ({
      questionId: i,
      questionText: q.texto,
      averageScore: q.promedio === "—" ? null : Number(q.promedio),
      responsesCount: q.respuestas,
    }));
    const dist = { excellent: 0, good: 0, regular: 0, critical: 0 };
    (r.colaboradores || []).forEach((c) => {
      if (c.promedio === "—") return;
      const n = Number(c.promedio);
      if (n >= 4.5) dist.excellent += 1;
      else if (n >= 3.5) dist.good += 1;
      else if (n >= 2.5) dist.regular += 1;
      else dist.critical += 1;
    });
    const conNota = preguntas.filter((q) => q.averageScore !== null);
    return {
      preguntas,
      dist,
      fortalezas: conNota.slice().sort((a, b) => b.averageScore - a.averageScore).slice(0, 3),
      debilidades: conNota.slice().sort((a, b) => a.averageScore - b.averageScore).slice(0, 3),
    };
  }

  function renderResultadoDetalle() {
    const r = state.resultado;
    const desdeAdmin = state.volverA !== "my-results";
    if (!r) return `${desdeAdmin ? tabsResultados("internas") : ""}<div class="svy-gmdet__page"><div class="svy-gmdet__state-card">Cargando detalle…</div></div>`;

    const f = filtrosRes();
    const tab = f.detalle === "analytics" ? "analytics" : "detail";
    const a = analisisInterno(r);
    const nota = notaInterna(r);
    const maxPregunta = Math.max(5, ...a.preguntas.map((q) => Number(q.averageScore || 0)));
    const maxDist = Math.max(1, a.dist.excellent, a.dist.good, a.dist.regular, a.dist.critical);
    const comentarios = (r.comentarios || []).filter((c) => String(c || "").trim());
    const nota2 = (v) => (v === null || v === undefined || v === "—" ? "—" : Number(v).toFixed(2));
    const colab = state.resColab !== null && state.resColab !== undefined ? (r.colaboradores || [])[state.resColab] : null;

    return `
      ${desdeAdmin ? tabsResultados("internas") : ""}
      <div class="svy-gmdet__page">
        <div class="svy-gmdet__tabs">
          <div class="svy-gmdet__tabs-list" role="tablist">
            <button type="button" role="tab" aria-selected="${tab === "detail"}" class="svy-gmdet__tab ${tab === "detail" ? "is-active" : ""}" data-act="res-det-tab" data-arg="detail">${ico("users", 16)} Detalle</button>
            <button type="button" role="tab" aria-selected="${tab === "analytics"}" class="svy-gmdet__tab ${tab === "analytics" ? "is-active" : ""}" data-act="res-det-tab" data-arg="analytics">${ico("chart", 16)} Análisis</button>
          </div>
          <div class="svy-gmdet__tabs-actions">
            <button type="button" class="svy-gmdet__tab-action" data-view="${state.volverA || "results-list"}">${ico("back", 16)} Regresar</button>
            <button type="button" class="svy-gmdet__tab-action svy-gmdet__tab-action--primary" data-act="res-exportar">${ico("download", 16)} Exportar Excel</button>
          </div>
        </div>

        <div class="svy-gmdet__summary-grid">
          <div class="svy-gmdet__summary-card"><span class="svy-gmdet__label">Supervisor evaluado</span><strong>${esc(r.supervisor || "—")}</strong></div>
          <div class="svy-gmdet__summary-card"><span class="svy-gmdet__label">Asignados</span><strong>${r.asignadas}</strong></div>
          <div class="svy-gmdet__summary-card"><span class="svy-gmdet__label">Respondieron</span><strong>${r.respuestas}</strong></div>
          <div class="svy-gmdet__summary-card svy-gmdet__summary-highlight"><span class="svy-gmdet__label">Resultado Total</span><strong>${nota.toFixed(2)}</strong></div>
        </div>

        ${tab === "detail" ? `
          <div class="svy-gmdet__table-card">
            <div class="svy-gmdet__table-header"><div>Colaborador</div><div>Estado</div><div>Promedio</div><div>Respuestas</div><div>Acción</div></div>
            ${(r.colaboradores || []).map((c, i) => {
              const estado = ESTADO_COLAB[c.estado] || "pending";
              const contestadas = (c.answers || []).filter((x) => x.score !== null && x.score !== undefined).length || (c.estado === "Respondida" ? c.respuestas : 0);
              return `
              <div class="svy-gmdet__row-wrap">
                <div class="svy-gmdet__table-row">
                  <div class="svy-gmdet__collaborator-cell">
                    <div class="svy-gmdet__collaborator-name">${esc(c.name)}</div>
                    <div class="svy-gmdet__collaborator-meta">
                      <span>${ico("briefcase", 13)}${esc(c.position || "—")}</span>
                      <span>${ico("mail", 13)}${esc(c.email || "—")}</span>
                    </div>
                  </div>
                  <div><div class="svy-gmdet__status-pill status-${estado}">${estado === "submitted" ? ico("check") : ico("clock")}<span>${estado === "submitted" ? "Respondida" : estado === "in_progress" ? "En progreso" : "Pendiente"}</span></div></div>
                  <div><span class="svy-gmdet__score-pill">${ico("star")}${nota2(c.promedio)}</span></div>
                  <div>${contestadas}</div>
                  <div class="svy-gmdet__row-actions">
                    <button type="button" class="svy-gmdet__expand-btn" data-act="res-colab" data-arg="${i}"><span>Ver detalle</span>${ico("down", 16)}</button>
                  </div>
                </div>
              </div>`;
            }).join("")}
          </div>

          <div class="svy-gmdet__question-results-card">
            <div class="svy-gmdet__question-header"><div>Pregunta</div><div>Promedio</div><div>Respuestas</div></div>
            ${a.preguntas.length === 0
              ? `<div class="svy-gmdet__empty-row">${ico("clipboard", 16)}<span>No hay resultados por pregunta para mostrar.</span></div>`
              : a.preguntas.map((q, i) => `
                <div class="svy-gmdet__question-row">
                  <div class="svy-gmdet__question-text"><strong>${i + 1}. ${esc(q.questionText)}</strong></div>
                  <div class="svy-gmdet__question-score">${nota2(q.averageScore)}</div>
                  <div class="svy-gmdet__question-count">${ico("clipboard")}<span>${q.responsesCount || 0}</span></div>
                </div>`).join("")}
          </div>

          <div class="svy-gmdet__comments-card">
            <div class="svy-gmdet__comments-head">${ico("message", 18)}<h2>Comentarios generales</h2></div>
            ${comentarios.length === 0
              ? `<div class="svy-gmdet__empty-row">${ico("message", 16)}<span>No hay comentarios generales registrados.</span></div>`
              : `<div class="svy-gmdet__comments-list">${comentarios.map((texto, i) => `<div class="svy-gmdet__comment-card"><span>Comentario ${i + 1}</span><p>${esc(texto)}</p></div>`).join("")}</div>`}
          </div>

          ${colab ? `
            <div class="svy-gmdet__modal-overlay" data-act="res-colab-cerrar">
              <div class="svy-gmdet__modal" data-act="res-noop">
                <div class="svy-gmdet__modal-header">
                  <div><h3>${esc(colab.name)}</h3><p>${esc(colab.position || "—")} · ${esc(colab.email || "—")}</p></div>
                  <button type="button" class="svy-gmdet__modal-close" data-act="res-colab-cerrar">Cerrar</button>
                </div>
                <div class="svy-gmdet__modal-meta">
                  <div class="svy-gmdet__status-pill status-${ESTADO_COLAB[colab.estado] || "pending"}">${colab.estado === "Respondida" ? ico("check") : ico("clock")}<span>${colab.estado === "Respondida" ? "Respondida" : "Pendiente"}</span></div>
                  <span class="svy-gmdet__score-pill">${ico("star")}${nota2(colab.promedio)}</span>
                </div>
                <div class="svy-gmdet__modal-body">
                  ${(colab.answers || []).length === 0
                    ? `<div class="svy-gmdet__empty-answers">${ico("dot", 16)}<span>No hay respuestas registradas para este colaborador.</span></div>`
                    : colab.answers.map((x, i) => `
                      <div class="svy-gmdet__answer-card">
                        <div class="svy-gmdet__answer-top">
                          <div class="svy-gmdet__answer-question">${i + 1}. ${esc(x.questionText)}</div>
                          <div class="svy-gmdet__answer-score">Calificación: ${x.score !== null && x.score !== undefined ? x.score : "—"}</div>
                        </div>
                        ${x.improvementComment ? `<div class="svy-gmdet__answer-block"><span class="svy-gmdet__answer-label">Comentario de mejora</span><p>${esc(x.improvementComment)}</p></div>` : ""}
                        ${x.justification ? `<div class="svy-gmdet__answer-block"><span class="svy-gmdet__answer-label">Justificación</span><p>${esc(x.justification)}</p></div>` : ""}
                      </div>`).join("")}
                </div>
              </div>
            </div>` : ""}` : `
          <div class="svy-gmdet__analytics-grid">
            <div class="svy-gmdet__analytics-card">
              <div class="svy-gmdet__analytics-head"><div class="svy-gmdet__analytics-title">${ico("trending", 16)}<span>Promedio por pregunta</span></div></div>
              <div class="svy-gmdet__bars-list">
                ${a.preguntas.map((q) => `
                  <div class="svy-gmdet__bar-row">
                    <div class="svy-gmdet__bar-labels">
                      <div class="svy-gmdet__bar-main-label">${esc(q.questionText)}</div>
                      <div class="svy-gmdet__bar-sub-label">Respuestas: ${q.responsesCount || 0}</div>
                    </div>
                    <div class="svy-gmdet__bar-track"><div class="svy-gmdet__bar-fill svy-gmdet__bar-fill-primary" style="width:${(Number(q.averageScore || 0) / maxPregunta) * 100}%"></div></div>
                    <div class="svy-gmdet__bar-value">${nota2(q.averageScore)}</div>
                  </div>`).join("")}
              </div>
            </div>

            <div class="svy-gmdet__analytics-card">
              <div class="svy-gmdet__analytics-head"><div class="svy-gmdet__analytics-title">${ico("shield", 16)}<span>Distribución de resultados</span></div></div>
              <div class="svy-gmdet__bars-list">
                ${[["excellent", "Excelente"], ["good", "Bueno"], ["regular", "Regular"], ["critical", "Crítico"]].map(([clave, nombre]) => `
                  <div class="svy-gmdet__bar-row">
                    <div class="svy-gmdet__distribution-tag tag-${clave}">${nombre}</div>
                    <div class="svy-gmdet__bar-track"><div class="svy-gmdet__bar-fill svy-gmdet__bar-fill-${clave}" style="width:${(a.dist[clave] / maxDist) * 100}%"></div></div>
                    <div class="svy-gmdet__bar-value">${a.dist[clave]}</div>
                  </div>`).join("")}
              </div>
            </div>

            <div class="svy-gmdet__analytics-card">
              <div class="svy-gmdet__analytics-head"><div class="svy-gmdet__analytics-title">${ico("trending", 16)}<span>Top fortalezas</span></div></div>
              <div class="svy-gmdet__insights-list">
                ${a.fortalezas.map((q) => `<div class="svy-gmdet__insight-item positive"><div class="svy-gmdet__insight-question">${esc(q.questionText)}</div><div class="svy-gmdet__insight-score">${nota2(q.averageScore)}</div></div>`).join("")}
              </div>
            </div>

            <div class="svy-gmdet__analytics-card">
              <div class="svy-gmdet__analytics-head"><div class="svy-gmdet__analytics-title">${ico("shield", 16)}<span>Top debilidades</span></div></div>
              <div class="svy-gmdet__insights-list">
                ${a.debilidades.map((q) => `<div class="svy-gmdet__insight-item negative"><div class="svy-gmdet__insight-question">${esc(q.questionText)}</div><div class="svy-gmdet__insight-score">${nota2(q.averageScore)}</div></div>`).join("")}
              </div>
            </div>
          </div>`}
      </div>`;
  }

  /* Descarga un CSV que abre directo en Excel */
  function descargarCSV(nombre, encabezados, filas) {
    const celda = (v) => `"${String(v === null || v === undefined ? "" : v).replace(/"/g, '""')}"`;
    const texto = [encabezados, ...filas].map((fila) => fila.map(celda).join(";")).join("\r\n");
    const blob = new Blob(["﻿" + texto], { type: "text/csv;charset=utf-8" });
    const enlace = document.createElement("a");
    enlace.href = URL.createObjectURL(blob);
    enlace.download = nombre;
    document.body.appendChild(enlace);
    enlace.click();
    enlace.remove();
    setTimeout(() => URL.revokeObjectURL(enlace.href), 1000);
  }

  function exportarInterna() {
    const r = state.resultado;
    if (!r) return;
    const filas = [];
    (r.colaboradores || []).forEach((c) => {
      const respuestas = c.answers && c.answers.length ? c.answers : [{ questionText: "", score: "" }];
      respuestas.forEach((x) => filas.push([r.surveyName, r.periodLabel, r.supervisor, c.name, c.position, c.email, c.estado, c.promedio, x.questionText, x.score, x.improvementComment || ""]));
    });
    descargarCSV(
      `Resultado_${String(r.surveyName).replace(/[^\w]+/g, "_").slice(0, 40)}_${r.period}.csv`,
      ["ENCUESTA", "PERIODO", "SUPERVISOR", "COLABORADOR", "PUESTO", "CORREO", "ESTADO", "PROMEDIO", "PREGUNTA", "CALIFICACION", "COMENTARIO"],
      filas
    );
  }

  /* ---------------- Resultados encuestas a doctores ---------------- */
  const pad2 = (n) => String(n).padStart(2, "0");
  function fechaLocal(valor) {
    const m = String(valor || "").replace("T", " ").match(/^(\d{4})-(\d{2})-(\d{2})(?: (\d{2}):(\d{2}))?/);
    return m ? { d: m[3], m: m[2], y: m[1], hh: m[4] || "00", mm: m[5] || "00" } : null;
  }
  const fmtFechaHora = (v) => {
    const f = fechaLocal(v);
    return f ? `${f.d}/${f.m}/${f.y} ${f.hh}:${f.mm}` : "—";
  };
  const pctRes = (parte, total) => (total ? Math.round((parte / total) * 100) : 0);
  const fmtProm = (v, digitos = 2) => (v === null || v === undefined ? "—" : Number(v).toFixed(digitos));
  const plural = (n, uno, varios) => `${n} ${n === 1 ? uno : varios}`;
  const fmtPctComa = (parte, total) => (total ? `${((parte / total) * 100).toFixed(1).replace(".", ",")} %` : "0 %");
  const NIVEL_TXT = { GENERAL: "General", GROUP: "Grupo de órdenes", WORK: "Por orden" };
  const MODO_TXT = { GENERAL: "General", MIXED: "Mixta", INDIVIDUAL: "Individual" };
  const ESTADO_INST = {
    GENERATED: "Generada", SENT: "Enviada", SEND_FAILED: "Envío fallido", OPENED: "Abierta", PARTIAL: "Parcial",
    COMPLETED: "Completada", CLOSED_PARTIAL: "Cerrada parcial", CLOSED_NO_RESPONSE: "Cerrada sin respuesta",
  };
  const tonoInst = (s) => (s === "COMPLETED" ? "ok" : s === "SEND_FAILED" ? "bad" : String(s).startsWith("CLOSED") ? "off" : "warn");
  const doctorTxt = (p) => [p && p.doctorPrefix, p && p.doctorName].filter(Boolean).join(" ") || "Doctor";
  const tieneNota = (r) => r.score !== null && r.score !== undefined && Number(r.score) > 0;

  /* Estrella llena, vacía o a medias */
  const estrella = (lleno) =>
    `<span class="dsv-rs-star"><span class="dsv-rs-star-off">★</span><span class="dsv-rs-star-on" style="width:${Math.round(Math.min(1, Math.max(0, lleno)) * 100)}%">★</span></span>`;
  const escalaEstrellas = (valor, tam = "md") => `
    <div class="dsv-rs-scale is-${tam}" role="img" aria-label="${fmtProm(valor)} de 5 estrellas">
      ${[1, 2, 3, 4, 5].map((n) => `<div class="dsv-rs-scale-item"><span class="dsv-rs-scale-num">${n}</span>${estrella((Number(valor) || 0) - (n - 1))}</div>`).join("")}
    </div>`;
  const estrellasLinea = (valor) =>
    `<span class="dsv-rs-inline-stars" role="img" aria-label="${fmtProm(valor, 1)} de 5 estrellas">${[1, 2, 3, 4, 5].map((n) => estrella((Number(valor) || 0) - (n - 1))).join("")}</span>`;

  const columnas = (dist, total) => {
    const max = Math.max(1, ...[1, 2, 3, 4, 5].map((n) => dist[n] || 0));
    return `
      <div class="dsv-rs-cols" role="img" aria-label="Distribución de ${total} calificaciones">
        ${[1, 2, 3, 4, 5].map((n) => {
          const c = dist[n] || 0;
          return `
          <div class="dsv-rs-col" title="${n} ★: ${c} de ${total} (${fmtPctComa(c, total)})">
            <div class="dsv-rs-col-plot">
              <span class="dsv-rs-col-value">${c} <small>(${fmtPctComa(c, total)})</small></span>
              <span class="dsv-rs-col-bar" style="height:${(c / max) * 100}%"></span>
            </div>
            <span class="dsv-rs-col-label">${n}</span>
          </div>`;
        }).join("")}
      </div>`;
  };

  const barras = (items, total) => `
    <div class="dsv-rs-bars">
      ${items.map((it) => {
        const p = pctRes(it.total, total);
        return `
        <div class="dsv-rs-bar" title="${attr(it.label)}: ${it.total} de ${total} (${p}%)">
          <span class="dsv-rs-bar-label">${esc(it.label)}</span>
          <span class="dsv-rs-bar-track"><span class="dsv-rs-bar-fill" style="width:${p}%"></span></span>
          <span class="dsv-rs-bar-value">${it.total} <small>(${p}%)</small></span>
        </div>`;
      }).join("")}
    </div>`;

  const COLORES_PASTEL = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300"];
  function pastel(items, total) {
    const suma = items.reduce((a, it) => a + it.total, 0);
    let angulo = 0;
    const punto = (a) => [60 + 56 * Math.sin(a), 60 - 56 * Math.cos(a)];
    const rebanadas = items.map((it, i) => {
      const desde = angulo;
      angulo += suma ? (it.total / suma) * Math.PI * 2 : 0;
      return Object.assign({}, it, { color: COLORES_PASTEL[i % COLORES_PASTEL.length], desde, hasta: angulo });
    });
    const dibujadas = rebanadas.filter((s) => s.total > 0);
    const arco = (s) => {
      const [x1, y1] = punto(s.desde);
      const [x2, y2] = punto(s.hasta);
      return `M 60 60 L ${x1.toFixed(2)} ${y1.toFixed(2)} A 56 56 0 ${s.hasta - s.desde > Math.PI ? 1 : 0} 1 ${x2.toFixed(2)} ${y2.toFixed(2)} Z`;
    };
    return `
      <div class="dsv-rs-pie">
        <svg viewBox="0 0 120 120" width="170" height="170" role="img" aria-label="Respuestas por opción">
          ${dibujadas.length === 1
            ? `<circle cx="60" cy="60" r="56" fill="${dibujadas[0].color}"><title>${esc(dibujadas[0].label)}</title></circle>`
            : dibujadas.map((s) => `<path d="${arco(s)}" fill="${s.color}" stroke="#fff" stroke-width="1.5"><title>${esc(s.label)}: ${s.total}</title></path>`).join("")}
          ${dibujadas.length === 0 ? `<circle cx="60" cy="60" r="56" fill="#f1f2f4"></circle>` : ""}
        </svg>
        <ul class="dsv-rs-legend">
          ${rebanadas.map((s) => `<li title="${attr(s.label)}: ${s.total} de ${total}"><i style="background:${s.color}"></i><span>${esc(s.label)}</span><b>${s.total} <small>(${fmtPctComa(s.total, suma)})</small></b></li>`).join("")}
        </ul>
      </div>`;
  }

  /* Encuesta como se configuró + las respuestas de cada pregunta */
  function modeloDoctores(detalle) {
    const rows = detalle.rows || [];
    const porPregunta = new Map();
    rows.forEach((r) => {
      if (r.questionId === null || r.questionId === undefined) return;
      if (!porPregunta.has(r.questionId)) porPregunta.set(r.questionId, []);
      porPregunta.get(r.questionId).push(r);
    });
    const usadas = new Set();
    const secciones = (detalle.sections || []).map((sec) => ({
      key: `sec-${sec.doctorSurveySectionId}`,
      title: sec.title || "Sin categoría",
      description: sec.description || "",
      useWorks: Boolean(sec.useWorks),
      questions: (sec.questions || [])
        .map((q) => {
          usadas.add(q.doctorSurveyQuestionId);
          return {
            key: `q-${q.doctorSurveyQuestionId}`,
            sectionTitle: sec.title || "",
            text: q.questionText || "",
            helpText: q.helpText || "",
            type: String(q.questionType || "STARS").toUpperCase(),
            areaName: q.responsibleAreaName || "",
            required: Boolean(q.isRequired),
            isActive: q.isActive !== false,
            lowPrompt: q.lowPrompt || "",
            highPrompt: q.highPrompt || "",
            config: { choices: q.choiceOptions || [], improvements: q.improvementOptions || [], values: q.valueOptions || [] },
            rows: porPregunta.get(q.doctorSurveyQuestionId) || [],
          };
        })
        .filter((q) => q.isActive || q.rows.length > 0),
    }));

    /* Respuestas a preguntas que ya no están en la encuesta */
    const sueltas = rows.filter((r) => r.questionId === null || r.questionId === undefined || !usadas.has(r.questionId));
    if (sueltas.length) {
      const porTexto = new Map();
      sueltas.forEach((r) => {
        const clave = `${r.sectionTitle || "Sin categoría"}::${r.questionText}`;
        if (!porTexto.has(clave)) porTexto.set(clave, { sectionTitle: r.sectionTitle || "Sin categoría", r, rows: [] });
        porTexto.get(clave).rows.push(r);
      });
      const extra = new Map();
      porTexto.forEach((item, clave) => {
        if (!extra.has(item.sectionTitle)) extra.set(item.sectionTitle, []);
        extra.get(item.sectionTitle).push({
          key: `old-${clave}`, sectionTitle: item.sectionTitle, text: item.r.questionText, helpText: "",
          type: item.r.questionType || "STARS", areaName: item.r.areaName || "", required: false, lowPrompt: "", highPrompt: "",
          config: { choices: [], improvements: [], values: [] }, rows: item.rows, removed: true,
        });
      });
      extra.forEach((questions, title) => secciones.push({ key: `old-${title}`, title, description: "", useWorks: false, questions }));
    }

    let numero = 0;
    return secciones
      .filter((s) => s.questions.length > 0)
      .map((s) => Object.assign({}, s, { questions: s.questions.map((q) => Object.assign({}, q, { number: ++numero })) }));
  }

  function estadisticas(q) {
    const dist = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    const cuenta = (lista) => {
      const m = new Map();
      lista.forEach((v) => {
        const k = String(v || "").trim();
        if (k) m.set(k, (m.get(k) || 0) + 1);
      });
      return m;
    };
    const conConfig = (config, mapa) => {
      const conocidas = new Set(config);
      return [
        ...config.map((label) => ({ label, total: mapa.get(label) || 0 })),
        ...[...mapa.entries()].filter(([k]) => !conocidas.has(k)).map(([label, total]) => ({ label, total })).sort((a, b) => b.total - a.total),
      ];
    };
    const doctores = new Set();
    const ordenes = new Set();
    const niveles = { GENERAL: 0, GROUP: 0, WORK: 0 };
    let calificaciones = 0;
    let suma = 0;
    let bajas = 0;
    q.rows.forEach((r) => {
      doctores.add(r.doctorSurveyInstanceId);
      (r.workCodes || []).forEach((c) => ordenes.add(`${r.doctorSurveyInstanceId}:${c}`));
      niveles[r.answerLevel || "GENERAL"] = (niveles[r.answerLevel || "GENERAL"] || 0) + 1;
      if (tieneNota(r)) {
        dist[Math.min(5, Math.max(1, Math.round(Number(r.score))))] += 1;
        calificaciones += 1;
        suma += Number(r.score);
        if (r.isLowScore) bajas += 1;
      }
    });
    return {
      answers: q.rows.length,
      respondents: doctores.size,
      works: ordenes.size,
      ratings: calificaciones,
      average: calificaciones ? suma / calificaciones : null,
      dist,
      lowCount: bajas,
      levels: niveles,
      choices: conConfig(q.config.choices, cuenta(q.rows.flatMap((r) => r.choiceOptions || []))),
      improvements: conConfig(q.config.improvements, cuenta(q.rows.flatMap((r) => r.improvementOptions || []))),
      values: conConfig(q.config.values, cuenta(q.rows.flatMap((r) => r.valueOptions || []))),
      texts: q.rows.filter((r) => String(r.textValue || "").trim()),
      comments: q.rows.filter((r) => String(r.comment || "").trim()),
      evidences: q.rows.filter((r) => Number(r.evidenceCount) > 0),
    };
  }

  /* Un elemento por doctor que respondió, el más reciente primero */
  function respondieron(detalle) {
    const mapa = new Map();
    (detalle.rows || []).forEach((r) => {
      if (!mapa.has(r.doctorSurveyInstanceId)) mapa.set(r.doctorSurveyInstanceId, { key: r.doctorSurveyInstanceId, doctorName: r.doctorName, answeredAt: r.answeredAt || "", rows: [] });
      const p = mapa.get(r.doctorSurveyInstanceId);
      p.rows.push(r);
      if (String(r.answeredAt || "") > String(p.answeredAt || "")) p.answeredAt = r.answeredAt;
    });
    const porId = new Map((detalle.instances || []).map((i) => [i.doctorSurveyInstanceId, i]));
    return [...mapa.values()]
      .map((p) => {
        const notas = p.rows.filter(tieneNota);
        return Object.assign({}, p, {
          ratings: notas.length,
          average: notas.length ? notas.reduce((a, r) => a + Number(r.score), 0) / notas.length : null,
          lowCount: notas.filter((r) => r.isLowScore).length,
          works: new Set(p.rows.flatMap((r) => r.workCodes || [])).size,
        }, porId.get(p.key) || {});
      })
      .sort((a, b) => String(b.answeredAt || "").localeCompare(String(a.answeredAt || "")) || String(a.doctorName).localeCompare(String(b.doctorName), "es"));
  }

  const modalidad = (rows) => {
    const niveles = new Set(rows.map((r) => r.answerLevel || "GENERAL"));
    if (niveles.has("GROUP")) return "MIXED";
    if (niveles.has("WORK")) return "INDIVIDUAL";
    return rows.some((r) => (r.workCodes || []).length > 0) ? "GENERAL" : null;
  };

  /* Lista de opciones como se configuraron, con las elegidas marcadas */
  const listaMarcas = (opciones, elegidas, radio = false) => {
    const sel = elegidas || [];
    const todas = [...(opciones || []), ...sel.filter((x) => !(opciones || []).includes(x))];
    if (!todas.length) return "";
    return `<ul class="dsv-rs-checks ${radio ? "is-radio" : ""}">${todas.map((l) => `<li class="${sel.includes(l) ? "is-on" : ""}"><i aria-hidden="true"></i><span>${esc(l)}</span></li>`).join("")}</ul>`;
  };

  const chipsOrdenes = (codigos, clave) => {
    if (!codigos || !codigos.length) return "";
    const abierto = (state.resDocMas || {})[clave];
    const vista = abierto ? codigos : codigos.slice(0, 8);
    return `<span class="dsv-rs-works">${vista.map((c) => `<code>${esc(c)}</code>`).join("")}${codigos.length > 8 ? `<button type="button" class="dsv-rs-link is-small" data-act="doc-mas" data-arg="${attr(clave)}">${abierto ? "ver menos" : `+${codigos.length - 8} más`}</button>` : ""}</span>`;
  };

  /* Lo que contestó un doctor en una pregunta, con el aspecto del formulario */
  function respuestaForm(q, r, sola) {
    const codigos = r.workCodes || [];
    const eleccion = q.type === "SINGLE" || q.type === "MULTIPLE";
    const verMejoras = (r.improvementOptions || []).length > 0 || (r.isLowScore && q.config.improvements.length > 0);
    const verValores = (r.valueOptions || []).length > 0;
    return `
      <div class="dsv-rs-fa ${sola ? "is-single" : "is-multi"} ${r.isLowScore ? "is-low" : ""}">
        ${codigos.length > 0 || !sola ? `
          <div class="dsv-rs-fa-scope">
            <span class="dsv-rs-tag">${esc(NIVEL_TXT[r.answerLevel] || r.answerLevel)}</span>
            ${codigos.length ? `<span class="dsv-rs-muted">${plural(codigos.length, "orden", "órdenes")}</span>` : ""}
            ${chipsOrdenes(codigos, r.doctorSurveyAnswerId)}
            ${(r.advisors || []).length ? `<span class="dsv-rs-muted">Asesora: ${esc(r.advisors.join(", "))}</span>` : ""}
          </div>` : ""}
        ${r.score ? (sola ? escalaEstrellas(r.score, "lg") : `
          <div class="dsv-rs-fa-score">${estrellasLinea(r.score)}<span>${r.score} / 5</span>${r.isLowScore ? `<span class="dsv-rs-pill is-bad">Nota baja</span>` : ""}</div>`) : ""}
        ${eleccion ? listaMarcas(q.config.choices, r.choiceOptions, q.type === "SINGLE") : ""}
        ${r.textValue ? `<p class="dsv-rs-fa-text">${esc(r.textValue)}</p>` : ""}
        ${verMejoras ? `<div class="dsv-rs-follow"><span class="dsv-rs-follow-title">${esc(q.lowPrompt || "¿Qué podemos mejorar?")}</span>${listaMarcas(q.config.improvements, r.improvementOptions)}</div>` : ""}
        ${verValores ? `<div class="dsv-rs-follow"><span class="dsv-rs-follow-title">${esc(q.highPrompt || "¿Qué fue lo que más valoró?")}</span>${listaMarcas(q.config.values, r.valueOptions)}</div>` : ""}
        ${r.comment ? `<div class="dsv-rs-follow"><span class="dsv-rs-follow-title">Comentario</span><p class="dsv-rs-fa-text">${esc(r.comment)}</p></div>` : ""}
      </div>`;
  }

  const bandaSeccion = (sec, derecha) => `
    <div class="dsv-rs-band"><b>${esc(sec.title)}</b>${derecha ? `<span>${esc(derecha)}</span>` : ""}</div>
    ${sec.description ? `<section class="dsv-rs-card dsv-rs-desc">${esc(sec.description)}</section>` : ""}`;
  const subBloque = (titulo, contenido) => `<div class="dsv-rs-subblock"><h4>${esc(titulo)}</h4>${contenido}</div>`;

  function resumenPregunta(q) {
    const st = estadisticas(q);
    const todos = (state.resDocComentarios || {})[q.key];
    const comentarios = todos ? st.comments : st.comments.slice(0, 5);
    const niveles = Object.entries(st.levels).filter(([, n]) => n > 0);
    return `
      <article class="dsv-rs-card">
        <header class="dsv-rs-qhead">
          <div>
            <h3>${q.number}. ${esc(q.text)}</h3>
            <p class="dsv-rs-sub">${plural(st.respondents, "respuesta", "respuestas")}${q.areaName ? ` · Área: ${esc(q.areaName)}` : ""}${q.removed ? " · esta pregunta ya no está en la encuesta" : ""}</p>
          </div>
          ${st.answers > 0 ? `<button type="button" class="dsv-rs-link" data-act="doc-ver-pregunta" data-arg="${attr(q.key)}">Ver respuestas</button>` : ""}
        </header>
        ${st.answers === 0 ? `<p class="dsv-rs-none">Nadie ha respondido esta pregunta.</p>` : `
          ${st.ratings > 0 ? `
            <div class="dsv-rs-avgbox"><b>Calificación promedio (${fmtProm(st.average)})</b>${escalaEstrellas(st.average)}</div>
            ${columnas(st.dist, st.ratings)}
            ${st.works > 0 || st.ratings !== st.respondents || st.lowCount > 0 ? `
              <p class="dsv-rs-note">
                <span>${plural(st.ratings, "calificación", "calificaciones")}</span>
                ${st.works > 0 ? `<span>${plural(st.works, "orden evaluada", "órdenes evaluadas")}</span>` : ""}
                ${st.works > 0 ? niveles.map(([nivel, n]) => `<span>${esc(NIVEL_TXT[nivel] || nivel)}: ${n}</span>`).join("") : ""}
                ${st.lowCount > 0 ? `<span class="dsv-rs-pill is-bad">${plural(st.lowCount, "nota baja", "notas bajas")}</span>` : ""}
              </p>` : ""}` : ""}
          ${st.choices.length > 0 ? (q.type === "SINGLE" && st.choices.length <= COLORES_PASTEL.length ? pastel(st.choices, st.answers) : barras(st.choices, st.answers)) : ""}
          ${st.texts.length > 0 ? `<ul class="dsv-rs-rows">${st.texts.map((r) => `<li><span>${esc(r.textValue)}</span><small>${esc(r.doctorName)}</small></li>`).join("")}</ul>` : ""}
          ${st.improvements.some((x) => x.total > 0) ? subBloque(q.lowPrompt || "Motivos de nota baja", barras(st.improvements, st.lowCount || st.ratings || st.answers)) : ""}
          ${st.values.some((x) => x.total > 0) ? subBloque(q.highPrompt || "Lo que más valoran", barras(st.values, st.ratings - st.lowCount || st.ratings || st.answers)) : ""}
          ${st.comments.length > 0 ? subBloque(`Comentarios (${st.comments.length})`, `
            <ul class="dsv-rs-rows">
              ${comentarios.map((r) => `
                <li>
                  ${r.score ? `<span class="dsv-rs-pill ${r.isLowScore ? "is-bad" : "is-ok"}">${r.score} ★</span>` : ""}
                  <span>${esc(r.comment)}</span>
                  <small>${esc(r.doctorName)}${(r.workCodes || []).length === 1 ? ` · orden ${esc(r.workCodes[0])}` : ""}</small>
                </li>`).join("")}
            </ul>
            ${st.comments.length > 5 ? `<button type="button" class="dsv-rs-link is-small" data-act="doc-comentarios" data-arg="${attr(q.key)}">${todos ? "Ver menos" : `Ver los ${st.comments.length} comentarios`}</button>` : ""}`) : ""}
        `}
      </article>`;
  }

  function vistaResumen(detalle, secciones) {
    const totales = detalle.totals || {};
    const enviadas = totales.sent || totales.instances || 0;
    const dist = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    let total = 0;
    let suma = 0;
    (detalle.rows || []).filter(tieneNota).forEach((r) => {
      dist[Math.min(5, Math.max(1, Math.round(Number(r.score))))] += 1;
      total += 1;
      suma += Number(r.score);
    });
    const promedio = totales.averageScore !== null && totales.averageScore !== undefined ? totales.averageScore : total ? suma / total : null;

    return `
      <section class="dsv-rs-card">
        <h3 class="dsv-rs-title">Estadísticas</h3>
        <div class="dsv-rs-tiles">
          <div><b>Enviadas</b><span>${enviadas}</span></div>
          <div><b>Respondidas</b><span>${totales.completed || 0} <small>(${pctRes(totales.completed || 0, enviadas)}%)</small></span></div>
          <div><b>Promedio general</b><span>${fmtProm(promedio)} <small>/ 5</small></span></div>
        </div>
        ${total > 0 ? `<p class="dsv-rs-charttitle">Distribución de las calificaciones</p>${columnas(dist, total)}` : ""}
      </section>

      ${(detalle.areas || []).length ? `
        <section class="dsv-rs-card">
          <h3 class="dsv-rs-title">Por área responsable</h3>
          <table class="dsv-rs-mini">
            <thead><tr><th>Área</th><th>Promedio</th><th>Calificaciones</th><th>Notas bajas</th><th>Motivos más marcados</th></tr></thead>
            <tbody>
              ${detalle.areas.map((a) => `
                <tr>
                  <td>${esc(a.areaName)}</td>
                  <td>${estrellasLinea(a.averageScore)} ${fmtProm(a.averageScore)}</td>
                  <td>${a.ratings}</td>
                  <td>${a.lowCount}</td>
                  <td class="dsv-rs-muted">${esc((a.topImprovements || []).map((x) => `${x.label} (${x.total})`).join(" · ") || "—")}</td>
                </tr>`).join("")}
            </tbody>
          </table>
        </section>` : ""}

      ${(detalle.advisors || []).length ? `
        <section class="dsv-rs-card">
          <h3 class="dsv-rs-title">Por asesora <small>solo respuestas ligadas a órdenes</small></h3>
          <table class="dsv-rs-mini">
            <thead><tr><th>Asesora</th><th>Promedio</th><th>Calificaciones</th><th>Órdenes evaluadas</th></tr></thead>
            <tbody>
              ${detalle.advisors.map((a) => `<tr><td>${esc(a.name)}</td><td>${estrellasLinea(a.averageScore)} ${fmtProm(a.averageScore)}</td><td>${a.ratings}</td><td>${a.works}</td></tr>`).join("")}
            </tbody>
          </table>
        </section>` : ""}

      ${secciones.map((sec) => `${bandaSeccion(sec, sec.useWorks ? "Se evalúa sobre las órdenes" : "")}${sec.questions.map(resumenPregunta).join("")}`).join("")}`;
  }

  const pagDoc = (indice, total, mover, selector) => `
    <section class="dsv-rs-card dsv-rs-pager">
      ${selector}
      <div class="dsv-rs-pager-nav">
        <button type="button" class="dsv-rs-arrow" data-act="${mover}" data-arg="-1" ${indice <= 0 ? "disabled" : ""} aria-label="Anterior">${ico("left", 18)}</button>
        <span><b>${total ? indice + 1 : 0}</b> de ${total}</span>
        <button type="button" class="dsv-rs-arrow" data-act="${mover}" data-arg="1" ${indice >= total - 1 ? "disabled" : ""} aria-label="Siguiente">${ico("right", 18)}</button>
      </div>
    </section>`;

  function vistaPregunta(preguntas) {
    const indice = Math.max(0, preguntas.findIndex((q) => q.key === state.resDocPregunta));
    const q = preguntas[indice];
    if (!q) return `<p class="dsv-rs-none">Esta encuesta no tiene preguntas.</p>`;
    const grupos = new Map();
    q.rows.forEach((r) => {
      if (!grupos.has(r.doctorSurveyInstanceId)) grupos.set(r.doctorSurveyInstanceId, { key: r.doctorSurveyInstanceId, doctorName: r.doctorName, rows: [] });
      grupos.get(r.doctorSurveyInstanceId).rows.push(r);
    });
    const lista = [...grupos.values()];

    return `
      ${pagDoc(indice, preguntas.length, "doc-mover-pregunta", `
        <select data-doc-select="pregunta" aria-label="Pregunta">
          ${preguntas.map((x) => `<option value="${attr(x.key)}" ${x.key === q.key ? "selected" : ""}>${x.number}. ${esc(x.text)}</option>`).join("")}
        </select>`)}
      <section class="dsv-rs-card">
        <small class="dsv-rs-eyebrow">${esc(q.sectionTitle)}</small>
        <h3>${q.number}. ${esc(q.text)}</h3>
        ${q.helpText ? `<p class="dsv-rs-sub">${esc(q.helpText)}</p>` : ""}
        <p class="dsv-rs-sub">${plural(lista.length, "respuesta", "respuestas")}${q.areaName ? ` · Área: ${esc(q.areaName)}` : ""}</p>
      </section>
      ${lista.length === 0 ? `<p class="dsv-rs-none">Nadie ha respondido esta pregunta.</p>` : ""}
      ${lista.map((g) => `
        <section class="dsv-rs-card">
          <header class="dsv-rs-qhead">
            <h3 class="dsv-rs-person-name">${esc(g.doctorName)}</h3>
            <button type="button" class="dsv-rs-link is-small" data-act="doc-ver-persona" data-arg="${attr(g.key)}">Ver su encuesta</button>
          </header>
          <div class="dsv-rs-divider"></div>
          ${g.rows.map((r) => respuestaForm(q, r, g.rows.length === 1)).join("")}
        </section>`).join("")}`;
  }

  function vistaIndividual(detalle, secciones, personas) {
    const indice = Math.max(0, personas.findIndex((p) => String(p.key) === String(state.resDocPersona)));
    const p = personas[indice];
    if (!p) return `<p class="dsv-rs-none">Todavía nadie responde esta encuesta.</p>`;
    const propias = (q) => q.rows.filter((r) => r.doctorSurveyInstanceId === p.key);
    const encuesta = detalle.survey || {};

    return `
      ${pagDoc(indice, personas.length, "doc-mover-persona", `
        <select data-doc-select="persona" aria-label="Doctor">
          ${personas.map((x) => `<option value="${attr(x.key)}" ${x.key === p.key ? "selected" : ""}>${esc(doctorTxt(x))}</option>`).join("")}
        </select>`)}
      <section class="dsv-rs-card dsv-rs-formtop">
        <div class="dsv-rs-formtop-meta">
          <span>${p.ratings > 0 ? `${estrellasLinea(p.average)} ${fmtProm(p.average)} de promedio` : "Sin calificaciones"}</span>
          <em>Respondió el ${fmtFechaHora(p.finishedAt || p.answeredAt)}</em>
        </div>
        <h2>${esc(encuesta.name || "Encuesta")}</h2>
        ${encuesta.description ? `<p class="dsv-rs-formtop-desc">${esc(encuesta.description)}</p>` : ""}
        <dl class="dsv-rs-facts">
          <div><dt>Doctor</dt><dd>${esc(doctorTxt(p))}</dd></div>
          <div><dt>Período evaluado</dt><dd>${esc((detalle.period || {}).periodLabel || "—")}</dd></div>
          ${p.clinicNames ? `<div><dt>Clínica</dt><dd>${esc(p.clinicNames)}</dd></div>` : ""}
          <div><dt>Órdenes del período</dt><dd>${p.worksCount !== undefined ? p.worksCount : p.works || 0}</dd></div>
          ${p.lowCount > 0 ? `<div><dt>Notas bajas</dt><dd>${p.lowCount}</dd></div>` : ""}
        </dl>
        <div class="seg-enlaces">
          <button class="dl-mini on" type="button" data-act="seg-detalle" data-arg="${attr(p.key)}">Ver detalle por orden</button>
          <button class="dl-mini" type="button" data-act="seg-historico" data-arg="${attr(p.doctorName || "")}">Ver histórico del doctor</button>
        </div>
      </section>
      ${secciones.map((sec) => {
        const filasSec = sec.questions.flatMap(propias);
        const modo = sec.useWorks ? modalidad(filasSec) : null;
        return `
          ${bandaSeccion(sec, modo ? `Respondió en modalidad ${MODO_TXT[modo] || modo}` : "")}
          ${sec.questions.map((q) => {
            const filas = propias(q);
            return `
              <article class="dsv-rs-card">
                <h3>${q.number}. ${esc(q.text)}${q.required ? `<span class="dsv-rs-req"> *</span>` : ""}</h3>
                ${q.helpText ? `<p class="dsv-rs-sub">${esc(q.helpText)}</p>` : ""}
                ${filas.length === 0 ? `<p class="dsv-rs-none is-left">Sin respuesta.</p>` : filas.map((r) => respuestaForm(q, r, filas.length === 1)).join("")}
              </article>`;
          }).join("")}`;
      }).join("")}`;
  }

  function vistaDoctores(detalle, respondidas) {
    const lista = detalle.instances || [];
    return `
      <section class="dsv-rs-card">
        <h3 class="dsv-rs-title">Doctores a los que se envió <small>clic en una respondida para ver su encuesta</small></h3>
        <table class="dsv-rs-mini is-clickable">
          <thead><tr><th>Doctor</th><th>Clínica</th><th>Órdenes</th><th>Enviada</th><th>Respondida</th><th>Promedio</th><th>Estado</th></tr></thead>
          <tbody>
            ${lista.length === 0 ? `<tr><td colspan="7">No se envió a ningún doctor.</td></tr>` : lista.map((i) => {
              const puede = respondidas.has(i.doctorSurveyInstanceId);
              return `
              <tr class="${puede ? "can-open" : ""}" ${puede ? `data-row-open="doc-ver-persona" data-row-arg="${attr(i.doctorSurveyInstanceId)}" title="Ver su encuesta"` : ""}>
                <td>${esc(doctorTxt(i))}</td>
                <td class="dsv-rs-muted">${esc(i.clinicNames || "—")}</td>
                <td>${i.worksCount || 0}</td>
                <td>${fmtFechaHora(i.sentAt)}</td>
                <td>${fmtFechaHora(i.finishedAt)}</td>
                <td>${i.averageScore === null || i.averageScore === undefined ? "—" : fmtProm(i.averageScore)}</td>
                <td><span class="dsv-rs-pill is-${tonoInst(i.status)}">${esc(ESTADO_INST[i.status] || i.status)}</span></td>
              </tr>`;
            }).join("")}
          </tbody>
        </table>
      </section>`;
  }

  /* "Ver en tabla": todas las respuestas, para revisar o exportar */
  function vistaTabla(detalle) {
    const rows = detalle.rows || [];
    return `
      <div class="dsv-rs-wide">
        <section class="dl-card">
          <div class="dl-tabs-actions" style="justify-content:flex-end;padding:6px 8px"><button type="button" class="dl-tab-action" data-act="doc-exportar">${ico("download")} Exportar Excel</button></div>
          <div class="dl-table-wrap">
            <table class="dl-table">
              <thead><tr><th>Doctor</th><th>Categoría</th><th>Pregunta</th><th>Área</th><th>Calificación</th><th>Nivel</th><th>Órdenes</th><th>Asesora</th><th>Motivos</th><th>Comentario</th><th>Fecha</th></tr></thead>
              <tbody>
                ${rows.length === 0 ? `<tr><td colspan="11">Todavía no hay respuestas.</td></tr>` : rows.map((r) => `
                  <tr>
                    <td><b>${esc(r.doctorName)}</b><br><small>${esc(r.periodLabel || "")}</small></td>
                    <td>${esc(r.sectionTitle || "—")}</td>
                    <td class="wk-comment" style="font-style:normal">${esc(r.questionText)}</td>
                    <td>${esc(r.areaName || "—")}</td>
                    <td>${r.score ? `<span class="dl-badge ${r.isLowScore ? "bad" : "ok"}">${r.score} ★</span>` : esc(r.textValue || (r.choiceOptions || []).join(", ") || "—")}</td>
                    <td><span class="dl-badge ${r.answerLevel === "GENERAL" ? "" : "pink"}">${esc(NIVEL_TXT[r.answerLevel] || r.answerLevel)}</span></td>
                    <td>${esc((r.workCodes || []).join(", ") || "—")}</td>
                    <td>${esc((r.advisors || []).join(", ") || "—")}</td>
                    <td>${esc([...(r.improvementOptions || []), ...(r.valueOptions || [])].join(", ") || "—")}</td>
                    <td>${esc(r.comment || "—")}</td>
                    <td>${fmtFechaHora(r.answeredAt)}</td>
                  </tr>`).join("")}
              </tbody>
            </table>
          </div>
          <div class="dl-table-foot"><span>${rows.length} respuesta(s)</span></div>
        </section>
      </div>`;
  }

  function exportarDoctores() {
    const d = state.resDocDetalle;
    if (!d) return;
    descargarCSV(
      "Respuestas_encuesta_doctores.csv",
      ["DOCTOR", "PERIODO", "CATEGORIA", "PREGUNTA", "AREA", "CALIFICACION", "NIVEL", "ORDENES", "ASESORA", "MOTIVOS", "COMENTARIO", "FECHA"],
      (d.rows || []).map((r) => [
        r.doctorName, r.periodLabel, r.sectionTitle, r.questionText, r.areaName,
        r.score || r.textValue || (r.choiceOptions || []).join(", "), NIVEL_TXT[r.answerLevel] || r.answerLevel,
        (r.workCodes || []).join(", "), (r.advisors || []).join(", "),
        [...(r.improvementOptions || []), ...(r.valueOptions || [])].join(", "), r.comment, fmtFechaHora(r.answeredAt),
      ])
    );
  }

  const TABS_DOC = [["summary", "Resumen"], ["question", "Pregunta"], ["person", "Individual"], ["doctors", "Doctores"]];

  function renderDoctorDetalle() {
    const resumen = state.resDoc || {};
    const detalle = state.resDocDetalle;
    const tab = state.resDocTab || "summary";
    const secciones = detalle ? modeloDoctores(detalle) : [];
    const preguntas = secciones.flatMap((s) => s.questions);
    const personas = detalle ? respondieron(detalle) : [];
    const respondidas = new Set(personas.map((p) => p.key));
    const periodo = (detalle && detalle.period) || resumen;
    const totales = (detalle && detalle.totals) || {};
    const enviadas = totales.sent || totales.instances || resumen.sentCount || resumen.instancesCount || 0;
    const cuantas = detalle ? Math.max(personas.length, totales.completed || 0) : resumen.completedCount || 0;
    const titulo = [(detalle && detalle.survey && detalle.survey.name) || resumen.surveyName, periodo.periodLabel].filter(Boolean).join(" · ");
    const estado = periodo.status === "CLOSED" ? "período cerrado" : periodo.availableTo ? `abierta hasta el ${fmtFechaHora(periodo.availableTo)}` : "abierta";

    let cuerpo;
    if (!detalle) cuerpo = `<p class="dsv-rs-none">Cargando respuestas…</p>`;
    else if (tab === "table") cuerpo = vistaTabla(detalle);
    else if (tab === "question") cuerpo = vistaPregunta(preguntas);
    else if (tab === "person") cuerpo = vistaIndividual(detalle, secciones, personas);
    else if (tab === "doctors") cuerpo = vistaDoctores(detalle, respondidas);
    else cuerpo = vistaResumen(detalle, secciones);

    return `
      ${tabsResultados("doctores")}
      <div class="dsv-page">
        <div class="dsv-rs dsv-rs-detail">
          <button type="button" class="dsv-rs-back" data-act="doc-volver">${ico("back")} Encuestas enviadas</button>
          <section class="dsv-rs-card dsv-rs-head">
            <div class="dsv-rs-head-top">
              <div>
                <small class="dsv-rs-eyebrow">${esc(titulo)}</small>
                <h2>${plural(cuantas, "respuesta", "respuestas")}</h2>
                <p class="dsv-rs-sub">de ${plural(enviadas, "encuesta enviada", "encuestas enviadas")} · ${pctRes(cuantas, enviadas)}% de respuesta · ${estado}</p>
              </div>
              <button type="button" class="dsv-rs-link" data-act="doc-tab" data-arg="${tab === "table" ? "summary" : "table"}">${ico("sheet", 15)} ${tab === "table" ? "Volver al detalle" : "Ver en tabla"}</button>
            </div>
            <div class="dsv-rs-tabs" role="tablist">
              ${TABS_DOC.map(([clave, nombre]) => `<button type="button" role="tab" aria-selected="${tab === clave}" class="${tab === clave ? "is-active" : ""}" data-act="doc-tab" data-arg="${clave}">${nombre}</button>`).join("")}
            </div>
          </section>
          ${cuerpo}
        </div>
      </div>`;
  }

  function renderDoctoresLista() {
    const todas = state.resDoctores || [];
    const filtro = state.resDocFiltro || "";
    const encuestas = [...new Map(todas.map((p) => [p.doctorSurveyId, p.surveyName])).entries()];
    const termino = String(state.resDocBuscar || "").trim().toLowerCase();
    const visibles = (filtro ? todas.filter((p) => String(p.doctorSurveyId) === String(filtro)) : todas)
      .filter((p) => !termino || [p.surveyName, p.periodLabel].some((t) => String(t || "").toLowerCase().includes(termino)));

    /* Datatable: orden por columna y páginas de 50 */
    const orden = state.resDocOrden || { col: "enviada", dir: "desc" };
    const valorDe = {
      encuesta: (p) => String(p.surveyName || "").toLowerCase(),
      periodo: (p) => String(p.period || ""),
      enviada: (p) => String(DL.aISO(p.generatedAt) || p.generatedAt || ""),
      cierre: (p) => String(p.availableTo || ""),
      doctores: (p) => p.sentCount || p.instancesCount || 0,
      respondidas: (p) => p.completedCount || 0,
      promedio: (p) => (p.averageScore === null || p.averageScore === undefined ? -1 : Number(p.averageScore)),
      estado: (p) => String(p.status || ""),
    }[orden.col] || ((p) => 0);
    const ordenadas = visibles.slice().sort((a, b) => {
      const x = valorDe(a);
      const y = valorDe(b);
      return (x > y ? 1 : x < y ? -1 : 0) * (orden.dir === "asc" ? 1 : -1);
    });
    const POR_PAGINA = 50;
    const paginas = Math.max(1, Math.ceil(ordenadas.length / POR_PAGINA));
    const pagina = Math.min(Math.max(1, state.resDocPagina || 1), paginas);
    const inicio = (pagina - 1) * POR_PAGINA;
    const pagRows = ordenadas.slice(inicio, inicio + POR_PAGINA);
    const th = (col, texto) => `<th class="dsv-rs-sort ${orden.col === col ? `is-${orden.dir}` : ""}" data-act="doc-orden" data-arg="${col}" title="Ordenar">${texto}</th>`;
    let enviadas = 0;
    let completas = 0;
    let suma = 0;
    visibles.forEach((p) => {
      enviadas += p.sentCount || p.instancesCount || 0;
      completas += p.completedCount || 0;
      if (p.averageScore !== null && p.averageScore !== undefined) suma += Number(p.averageScore) * (p.completedCount || 0);
    });
    const promedio = completas ? suma / completas : null;

    return `
      ${tabsResultados("doctores")}
      <div class="dsv-page">
        <div class="dsv-rs">
          <div class="dsv-rs-listhead">
            <div>
              <h2>Encuestas enviadas</h2>
              <p class="dsv-rs-sub">Clic en una encuesta para ver sus respuestas con detalle.</p>
            </div>
            <div class="dsv-rs-listtools">
              <label class="dsv-rs-filter">
                <span>Buscar</span>
                <input type="text" id="docBuscar" data-doc-buscar placeholder="Encuesta o período" value="${attr(state.resDocBuscar || "")}">
              </label>
            ${encuestas.length > 1 ? `
              <label class="dsv-rs-filter">
                <span>Encuesta</span>
                <select data-doc-select="encuesta">
                  <option value="">Todas</option>
                  ${encuestas.map(([id, nombre]) => `<option value="${attr(id)}" ${String(filtro) === String(id) ? "selected" : ""}>${esc(nombre)}</option>`).join("")}
                </select>
              </label>` : ""}
            </div>
          </div>

          <div class="dsv-rs-tiles is-list">
            <div><b>Encuestas enviadas</b><span>${visibles.length}</span></div>
            <div><b>Doctores</b><span>${enviadas}</span></div>
            <div><b>Respondidas</b><span>${completas} <small>(${pctRes(completas, enviadas)}%)</small></span></div>
            <div><b>Promedio</b><span>${fmtProm(promedio)} <small>/ 5</small></span></div>
          </div>

          <section class="dsv-rs-card is-flush">
            <table class="dsv-rs-mini is-clickable is-list">
              <thead><tr>${th("encuesta", "Encuesta")}${th("periodo", "Período evaluado")}${th("enviada", "Enviada")}${th("cierre", "Cierre")}${th("doctores", "Doctores")}${th("respondidas", "Respondidas")}${th("promedio", "Promedio")}${th("estado", "Estado")}<th aria-label="Abrir"></th></tr></thead>
              <tbody>
                ${state.resDoctores === null ? `<tr><td colspan="9">Cargando…</td></tr>` : visibles.length === 0 ? `<tr><td colspan="9">${termino ? "Ninguna encuesta coincide con la búsqueda." : "Todavía no se ha enviado ninguna encuesta."}</td></tr>` : pagRows.map((p) => {
                  const env = p.sentCount || p.instancesCount || 0;
                  const tasa = pctRes(p.completedCount || 0, env);
                  return `
                  <tr class="can-open" data-row-open="doc-abrir" data-row-arg="${attr(p.doctorSurveyPeriodId)}" title="Ver respuestas">
                    <td>${esc(p.surveyName)}</td>
                    <td>${esc(p.periodLabel)}</td>
                    <td>${fmtFechaHora(p.generatedAt)}</td>
                    <td>${fmtFechaHora(p.availableTo)}</td>
                    <td>${env}</td>
                    <td>
                      <div class="dsv-rs-rate" title="${p.completedCount || 0} de ${env} (${tasa}%)">
                        <span>${p.completedCount || 0} <small>(${tasa}%)</small></span>
                        <i><u style="width:${tasa}%"></u></i>
                      </div>
                    </td>
                    <td>${p.averageScore === null || p.averageScore === undefined ? "—" : `${estrellasLinea(p.averageScore)} ${fmtProm(p.averageScore)}`}</td>
                    <td><span class="dsv-rs-pill ${p.status === "CLOSED" ? "is-off" : "is-ok"}">${p.status === "CLOSED" ? "Cerrada" : "Abierta"}</span></td>
                    <td class="dsv-rs-chev">${ico("right", 15)}</td>
                  </tr>`;
                }).join("")}
              </tbody>
            </table>
            <div class="dl-table-foot">
              <span>${visibles.length === 0 ? "Sin registros" : `Mostrando ${inicio + 1} a ${Math.min(inicio + POR_PAGINA, visibles.length)} de ${visibles.length} registros`}${visibles.length !== todas.length ? ` (de ${todas.length} en total)` : ""}</span>
              ${paginador(pagina, paginas, "data-doc-pagina")}
            </div>
          </section>
        </div>
        </div>
      </div>`;
  }

  /* ==================================================================
     Seguimiento y consulta de las encuestas a doctores
       - Envíos: seguimiento operativo (WhatsApp aparte del estado de
         la encuesta).
       - Respuestas: filtros, búsqueda por orden y alertas de atención.
       - Detalle: General / En conjunto / Trabajos específicos.
       - Histórico del doctor: su evolución por período.
     Todo es de consulta: nada de aquí cambia lo que respondió el doctor.
     ================================================================== */
  const SEG_ESTADOS = [
    ["GENERADA", "Generada", "off", "Creada, todavía no se envía"],
    ["ENVIADA", "Enviada", "info", "Le llegó el enlace y no lo ha abierto"],
    ["PENDIENTE", "Pendiente", "warn", "Abrió el enlace y no ha terminado"],
    ["RESPONDIDA", "Respondida", "ok", "Terminó la encuesta"],
    ["VENCIDA", "Vencida", "bad", "Cerró sin respuesta completa"],
  ];
  const SEG_TONO = Object.fromEntries(SEG_ESTADOS.map(([k, , t]) => [k, t]));
  const WA_TONO = { ENVIADO: "ok", SIMULADO: "off", ERROR: "bad", NINGUNO: "off" };
  const TIPO_EVAL = {
    GENERAL: ["General", "Opinión global del período, sin órdenes"],
    INDIVIDUAL: ["Individual", "Solo trabajos concretos"],
    MIXTA: ["Mixta", "Opinión general y trabajos específicos"],
  };
  const NIVEL_SEG = { general: "General", group: "En conjunto", work: "Por orden" };

  const segPill = (clave, texto, nota) =>
    `<span class="dl-badge ${SEG_TONO[clave] || "off"}" ${nota ? `title="${attr(nota)}"` : ""}>${esc(texto)}</span>`;
  const tipoPill = (tipo) => {
    const t = TIPO_EVAL[tipo];
    return t ? `<span class="seg-tipo is-${tipo.toLowerCase()}" title="${attr(t[1])}">${esc(t[0])}</span>` : "—";
  };
  const notaSeg = (v) =>
    v === null || v === undefined
      ? "—"
      : `<span class="seg-nota ${Number(v) <= 3 ? "is-baja" : ""}">${ico("star", 12)} ${fmtProm(v, 1)}</span>`;
  /* Marca de atención: 1-3 estrellas en rojo, comentarios en azul. No crea incidencias. */
  const marcaAtencion = (bajas, comentarios) =>
    !bajas && !comentarios
      ? `<span class="seg-ok-dot" title="Sin alertas">·</span>`
      : `<span class="seg-alerta">
          ${bajas ? `<span class="seg-flag is-baja" title="${bajas} calificación(es) de 1 a 3 estrellas">${ico("shield", 12)} ${bajas}</span>` : ""}
          ${comentarios ? `<span class="seg-flag is-coment" title="${comentarios} comentario(s)">${ico("message", 12)} ${comentarios}</span>` : ""}
        </span>`;
  const fechaSeg = (v) => (v ? fmtFechaHora(v) : "—");

  async function cargarSeguimiento(surveyId) {
    if (!surveyId || state.esNueva) {
      state.seg = [];
      return;
    }
    state.seg = await DL.api.seguimiento(surveyId);
  }
  async function cargarRespuestasDoc(surveyId) {
    if (!surveyId || state.esNueva) {
      state.resp = [];
      return;
    }
    state.resp = await DL.api.respuestasDoctores(surveyId);
  }

  /* Pila para "Regresar" desde el detalle y el histórico */
  function apilar() {
    state.segPila = state.segPila || [];
    state.segPila.push({ view: state.view, editorTab: state.editorTab, module: state.module });
  }
  async function regresarSeg() {
    const atras = (state.segPila || []).pop();
    if (!atras) return irA("survey-list");
    state.view = atras.view;
    state.module = atras.module || "surveys";
    if (atras.view === "survey-edit") {
      state.editorTab = atras.editorTab;
      if (atras.editorTab === "respuestas") await cargarRespuestasDoc(draft().id);
      if (atras.editorTab === "envios") {
        state.instancias = await DL.api.instancias(draft().id);
        await cargarSeguimiento(draft().id);
        iniciarPoll("editor-envios");
      }
    }
    renderApp();
  }

  /* ---------------- Envíos: seguimiento operativo ---------------- */
  const SEG_FILTRO = { periodo: "", buscar: "", estado: "all", whatsapp: "all" };
  const segFiltro = () => (state.segFiltro = state.segFiltro || Object.assign({}, SEG_FILTRO));

  function cuerpoEnviosDoctores() {
    const survey = draft();
    const instancias = state.instancias || [];
    const filas = state.seg || [];
    const f = segFiltro();
    const yaCorrio = instancias.length > 0;
    const sinEnviar = instancias.filter((item) => item.state === "Generada" && !item.sentAt).length;
    const rec = survey.reminders || {};
    const tope = Math.max(1, Number(rec.max) || 2);
    const recordables = instancias.filter((item) => ["Enviada", "Abierta", "Parcial"].includes(item.state) && Number(item.reminders || 0) < tope).length;

    const periodos = [...new Map(filas.map((r) => [r.period, r.periodLabel])).entries()].sort((a, b) => String(b[0]).localeCompare(String(a[0])));
    /* Arranca en el período más reciente: es el que se está siguiendo */
    if (f.periodo === "" && periodos.length) f.periodo = periodos[0][0];
    const texto = String(f.buscar || "").trim().toUpperCase();
    const delPeriodo = filas.filter((r) => f.periodo === "all" || f.periodo === "" || r.period === f.periodo);
    const visibles = delPeriodo
      .filter((r) => !texto || `${r.doctor} ${r.doctorId} ${r.clinic}`.toUpperCase().includes(texto))
      .filter((r) => f.estado === "all" || r.status.clave === f.estado)
      .filter((r) => f.whatsapp === "all" || r.whatsapp.clave === f.whatsapp);
    const cuenta = (clave) => delPeriodo.filter((r) => r.status.clave === clave).length;
    const errores = delPeriodo.filter((r) => r.whatsapp.clave === "ERROR").length;
    const activos = (texto ? 1 : 0) + (f.estado !== "all" ? 1 : 0) + (f.whatsapp !== "all" ? 1 : 0);
    const opcion = (valor, txt, actual) => `<option value="${attr(valor)}" ${String(actual) === String(valor) ? "selected" : ""}>${esc(txt)}</option>`;

    return `
      <div class="dercas-ribbon solo-acciones">
        <div class="ribbon-tags">
          <button class="btn primary" type="button" data-act="ejecutar-ahora">${yaCorrio ? "Volver a ejecutar (todos)" : "Ejecutar primera vez"}</button>
          <button class="btn" type="button" data-act="ejecutar-no-enviados">Ejecutar no enviados${sinEnviar ? ` (${sinEnviar})` : ""}</button>
          <button class="btn" type="button" data-act="recordar" ${recordables ? "" : "disabled"}>Recordar a los que no han contestado${recordables ? ` (${recordables})` : ""}</button>
        </div>
      </div>

      ${state.esNueva ? `<p class="empty-note">La encuesta todavía no se ha creado. Guárdela primero y podrá ejecutarla desde aquí.</p>` : ""}

      <div class="seg">
        <div class="seg-kpis">
          ${SEG_ESTADOS.map(([clave, label, tono, ayuda]) => `
            <button type="button" class="seg-kpi is-${tono} ${f.estado === clave ? "is-on" : ""}" data-act="seg-estado" data-arg="${clave}" title="${attr(ayuda)}">
              <span>${esc(label)}</span><b>${cuenta(clave)}</b>
            </button>`).join("")}
          <button type="button" class="seg-kpi is-bad ${f.whatsapp === "ERROR" ? "is-on" : ""}" data-act="seg-wa-error" title="Mensajes de WhatsApp que no se pudieron entregar">
            <span>WhatsApp con error</span><b>${errores}</b>
          </button>
        </div>

        <div class="seg-filtros">
          <label class="seg-campo"><span>Período</span>
            <select data-seg-filtro="periodo">${opcion("all", "Todos", f.periodo)}${periodos.map(([p, l]) => opcion(p, l, f.periodo)).join("")}</select>
          </label>
          <label class="seg-campo is-ancho"><span>Doctor o ID</span>
            <input id="segBuscar" type="text" placeholder="Nombre, ID (DR-…) o clínica" value="${attr(f.buscar)}" data-seg-filtro="buscar">
          </label>
          <label class="seg-campo"><span>Estado de la encuesta</span>
            <select data-seg-filtro="estado">${opcion("all", "Todos", f.estado)}${SEG_ESTADOS.map(([k, l]) => opcion(k, l, f.estado)).join("")}</select>
          </label>
          <label class="seg-campo"><span>WhatsApp</span>
            <select data-seg-filtro="whatsapp">${opcion("all", "Todos", f.whatsapp)}${opcion("ENVIADO", "Enviado", f.whatsapp)}${opcion("SIMULADO", "Simulado", f.whatsapp)}${opcion("ERROR", "Error", f.whatsapp)}</select>
          </label>
          ${activos ? `<button type="button" class="seg-limpiar" data-act="seg-limpiar">${ico("x", 13)} Borrar filtros</button>` : ""}
        </div>

        <section class="dl-card">
          <div class="dl-table-wrap">
            <table class="dl-table seg-tabla">
              <thead><tr>
                <th>Doctor</th><th>Período</th><th>Trabajos</th><th>Fecha de envío</th><th>WhatsApp</th>
                <th>Recordatorio</th><th>Estado encuesta</th><th>Fecha de respuesta</th><th class="dl-col-opts">Acciones</th>
              </tr></thead>
              <tbody>
                ${state.seg === null || state.seg === undefined
                  ? `<tr><td colspan="9">Cargando…</td></tr>`
                  : filas.length === 0
                    ? `<tr><td colspan="9">Aún no hay envíos. Pulse <b>Ejecutar primera vez</b>.</td></tr>`
                    : visibles.length === 0
                      ? `<tr><td colspan="9">Ningún envío coincide con los filtros.</td></tr>`
                      : visibles.map((r) => `
                        <tr>
                          <td><div class="seg-doc"><b>${esc(r.doctor)}</b><span>${esc(r.doctorId)}${r.clinic ? ` · ${esc(r.clinic)}` : ""}</span></div></td>
                          <td>${esc(r.periodLabel)}</td>
                          <td class="seg-num">${r.worksCount}</td>
                          <td>${fechaSeg(r.sentAt)}</td>
                          <td><span class="dl-badge ${WA_TONO[r.whatsapp.clave] || "off"}" ${r.whatsapp.detalle ? `title="${attr(r.whatsapp.detalle)}"` : ""}>${esc(r.whatsapp.texto)}</span></td>
                          <td>${r.reminders
                            ? `<div class="seg-doc"><b>Sí · ${r.reminders} de ${r.remindersMax}</b><span>Último: ${fechaSeg(r.lastReminderAt)}</span></div>`
                            : `<span class="seg-muted">No</span>`}</td>
                          <td><div class="seg-doc">${segPill(r.status.clave, r.status.texto, r.status.nota)}<span>${esc(r.status.nota)}</span></div></td>
                          <td>${fechaSeg(r.answeredAt)}</td>
                          <td class="dl-col-opts">
                            ${r.answered ? `<button class="dl-mini on" type="button" data-act="seg-detalle" data-arg="${attr(r.instanceId)}">Ver respuesta</button>` : ""}
                            <button class="dl-mini" type="button" data-act="seg-historico" data-arg="${attr(r.doctorKey)}" title="Histórico del doctor">Histórico</button>
                            ${r.answered || r.status.clave === "VENCIDA" ? "" : `<button class="dl-mini" type="button" data-act="open-instance" data-arg="${attr(r.instanceId)}">Abrir</button>`}
                            <button class="dl-mini" type="button" data-act="ver-mensaje" data-arg="${attr(r.instanceId)}">Mensaje</button>
                          </td>
                        </tr>`).join("")}
              </tbody>
            </table>
          </div>
          <div class="dl-table-foot"><span>${visibles.length} de ${filas.length} envío(s) · WhatsApp muestra la comunicación; el estado de la encuesta, lo que hizo el doctor. Se actualiza sola cada 4 segundos.</span></div>
        </section>
      </div>`;
  }

  /* ---------------- Respuestas: consulta operativa ---------------- */
  const RESP_FILTRO = { periodo: "all", doctor: "", orden: "", area: "all", categoria: "all", nota: "all", comentario: "all", tipo: "all", atencion: false };
  const respFiltro = () => (state.respFiltro = state.respFiltro || Object.assign({}, RESP_FILTRO));

  /* ¿Dónde aparece la orden buscada dentro de esta respuesta? */
  function dondeOrden(r, orden) {
    if (!orden) return null;
    const coincide = (id) => String(id).includes(orden);
    const enAnswers = (nivel) => r.answers.some((a) => a.level === nivel && a.orders.some((o) => coincide(o.workId) || coincide(o.code)));
    if (enAnswers("work")) return { tono: "ok", texto: "Evaluada individualmente" };
    if (enAnswers("group")) return { tono: "info", texto: "Evaluada en conjunto" };
    if ((r.workIds || []).some(coincide)) return { tono: "off", texto: "En el período (opinión general)" };
    return null;
  }

  function respuestasFiltradas() {
    const f = respFiltro();
    const doctor = String(f.doctor || "").trim().toUpperCase();
    const orden = String(f.orden || "").replace(/\s/g, "");
    return (state.resp || []).filter((r) => {
      if (f.periodo !== "all" && r.period !== f.periodo) return false;
      if (doctor && !`${r.doctor} ${r.doctorId} ${r.clinic}`.toUpperCase().includes(doctor)) return false;
      if (orden && !dondeOrden(r, orden)) return false;
      if (f.tipo !== "all" && r.type !== f.tipo) return false;
      if (f.atencion && !r.attention) return false;
      if (f.comentario === "con" && !r.commentCount) return false;
      if (f.comentario === "sin" && r.commentCount) return false;
      /* Área, categoría y calificación deben cumplirse en una misma pregunta */
      if (f.area !== "all" || f.categoria !== "all" || f.nota !== "all") {
        return r.answers.some((a) =>
          (f.area === "all" || a.area === f.area) &&
          (f.categoria === "all" || a.category === f.categoria) &&
          (f.nota === "all" || (f.nota === "baja" ? a.low : Number(a.score) === Number(f.nota)))
        );
      }
      return true;
    });
  }

  function cuerpoRespuestasDoctores() {
    const todas = state.resp;
    const f = respFiltro();
    const lista = respuestasFiltradas();
    const fuente = todas || [];
    const periodos = [...new Map(fuente.map((r) => [r.period, r.periodLabel])).entries()].sort((a, b) => String(b[0]).localeCompare(String(a[0])));
    const unicos = (fn) => [...new Set(fuente.flatMap((r) => r.answers.map(fn)).filter(Boolean))].sort((a, b) => a.localeCompare(b, "es"));
    const areas = unicos((a) => a.area);
    const categorias = unicos((a) => a.category);
    const orden = String(f.orden || "").replace(/\s/g, "");
    const conNota = lista.filter((r) => r.average !== null);
    const prom = conNota.length ? conNota.reduce((t, r) => t + r.average, 0) / conNota.length : null;
    const atencion = fuente.filter((r) => r.attention).length;
    const activos = Object.keys(RESP_FILTRO).filter((k) => String(f[k]) !== String(RESP_FILTRO[k])).length;
    const opcion = (valor, txt, actual) => `<option value="${attr(valor)}" ${String(actual) === String(valor) ? "selected" : ""}>${esc(txt)}</option>`;

    return `
      <div class="seg">
        <div class="seg-filtros is-grid">
          <label class="seg-campo"><span>Período</span>
            <select data-resp-filtro="periodo">${opcion("all", "Todos", f.periodo)}${periodos.map(([p, l]) => opcion(p, l, f.periodo)).join("")}</select>
          </label>
          <label class="seg-campo is-ancho"><span>Doctor o ID</span>
            <input id="respDoctor" type="text" placeholder="Nombre, ID (DR-…) o clínica" value="${attr(f.doctor)}" data-resp-filtro="doctor">
          </label>
          <label class="seg-campo"><span>No. de orden</span>
            <input id="respOrden" type="text" inputmode="numeric" placeholder="Ej. 202609494" value="${attr(f.orden)}" data-resp-filtro="orden">
          </label>
          <label class="seg-campo"><span>Tipo de evaluación</span>
            <select data-resp-filtro="tipo">${opcion("all", "Todos", f.tipo)}${Object.entries(TIPO_EVAL).map(([k, v]) => opcion(k, v[0], f.tipo)).join("")}</select>
          </label>
          <label class="seg-campo"><span>Área</span>
            <select data-resp-filtro="area">${opcion("all", "Todas", f.area)}${areas.map((a) => opcion(a, a, f.area)).join("")}</select>
          </label>
          <label class="seg-campo"><span>Categoría</span>
            <select data-resp-filtro="categoria">${opcion("all", "Todas", f.categoria)}${categorias.map((c) => opcion(c, c, f.categoria)).join("")}</select>
          </label>
          <label class="seg-campo"><span>Calificación</span>
            <select data-resp-filtro="nota">${opcion("all", "Todas", f.nota)}${opcion("baja", "1 a 3 estrellas", f.nota)}${[5, 4, 3, 2, 1].map((n) => opcion(n, `${n} ${n === 1 ? "estrella" : "estrellas"}`, f.nota)).join("")}</select>
          </label>
          <label class="seg-campo"><span>Comentario</span>
            <select data-resp-filtro="comentario">${opcion("all", "Todos", f.comentario)}${opcion("con", "Con comentario", f.comentario)}${opcion("sin", "Sin comentario", f.comentario)}</select>
          </label>
        </div>

        <div class="seg-barra">
          <button type="button" class="seg-chip ${f.atencion ? "is-on" : ""}" data-act="resp-atencion">${ico("shield", 13)} Requieren atención <b>${atencion}</b></button>
          <span class="seg-resumen">${lista.length} de ${fuente.length} respuesta(s) · Promedio ${fmtProm(prom, 2)}</span>
          ${activos ? `<button type="button" class="seg-limpiar" data-act="resp-limpiar">${ico("x", 13)} Borrar filtros</button>` : ""}
        </div>

        <section class="dl-card">
          <div class="dl-table-wrap">
            <table class="dl-table seg-tabla">
              <thead><tr>
                <th class="seg-col-alerta" title="1 a 3 estrellas o comentario">Atención</th><th>Doctor</th><th>Período</th><th>Respondió</th><th>Tipo</th>
                <th>Trabajos del período</th><th>Evaluados por orden</th><th>Promedio</th>${orden ? "<th>Orden buscada</th>" : ""}<th class="dl-col-opts">Acciones</th>
              </tr></thead>
              <tbody>
                ${todas === null || todas === undefined
                  ? `<tr><td colspan="10">Cargando…</td></tr>`
                  : fuente.length === 0
                    ? `<tr><td colspan="10">Todavía nadie responde esta encuesta.</td></tr>`
                    : lista.length === 0
                      ? `<tr><td colspan="10">Ninguna respuesta coincide con los filtros${orden ? `: la orden <b>${esc(orden)}</b> no aparece en ninguna respuesta` : ""}.</td></tr>`
                      : lista.map((r) => {
                        const hallazgo = dondeOrden(r, orden);
                        return `
                        <tr class="dl-row-link ${r.attention ? "seg-fila-alerta" : ""}" data-row-open="seg-detalle" data-row-arg="${attr(r.instanceId)}" title="Ver la respuesta">
                          <td class="seg-col-alerta">${marcaAtencion(r.lowCount, r.commentCount)}</td>
                          <td><div class="seg-doc"><b>${esc(r.doctor)}</b><span>${esc(r.doctorId)}${r.clinic ? ` · ${esc(r.clinic)}` : ""}</span></div></td>
                          <td>${esc(r.periodLabel)}</td>
                          <td>${fechaSeg(r.answeredAt)}</td>
                          <td>${tipoPill(r.type)}</td>
                          <td class="seg-num">${r.worksInPeriod}</td>
                          <td class="seg-num">${r.worksEvaluated}${r.worksGrouped ? ` <span class="seg-muted" title="Evaluados en conjunto">+${r.worksGrouped}</span>` : ""}</td>
                          <td>${notaSeg(r.average)}</td>
                          ${orden ? `<td>${hallazgo ? `<span class="dl-badge ${hallazgo.tono}">${esc(hallazgo.texto)}</span>` : "—"}</td>` : ""}
                          <td class="dl-col-opts">
                            <button class="dl-mini on" type="button" data-act="seg-detalle" data-arg="${attr(r.instanceId)}">Ver detalle</button>
                            <button class="dl-mini" type="button" data-act="seg-historico" data-arg="${attr(r.doctorKey)}">Histórico</button>
                          </td>
                        </tr>`;
                      }).join("")}
              </tbody>
            </table>
          </div>
          <div class="dl-table-foot"><span>Atención: ${ico("shield", 11)} calificaciones de 1 a 3 estrellas · ${ico("message", 11)} comentarios escritos por el doctor. Es solo para revisar: no crea incidencias.</span></div>
        </section>
      </div>`;
  }

  /* ---------------- Detalle de una respuesta ---------------- */
  function filaPregunta(a) {
    const alerta = a.low || a.hasComment;
    return `
      <div class="seg-q ${a.low ? "is-baja" : ""}">
        <div class="seg-q-main">
          <b>${esc(a.question)}</b>
          <span>${esc([a.area, a.category].filter(Boolean).join(" · "))}</span>
        </div>
        <div class="seg-q-nota">
          ${a.score
            ? `${estrellasLinea(a.score)} <b>${a.score}/5</b>`
            : a.value
              ? `<span class="seg-valor">${esc(a.value)}</span>`
              : "—"}
        </div>
        <div class="seg-q-extra">
          ${a.reasons && a.reasons.length ? `<div class="seg-motivos">${a.reasons.map((m) => `<span>${esc(m)}</span>`).join("")}</div>` : ""}
          ${a.comment ? `<p class="seg-comentario">“${esc(a.comment)}”</p>` : ""}
          ${a.evidence && a.evidence.length ? `<span class="seg-muted">Evidencia: ${a.evidence.length} archivo(s)</span>` : ""}
          ${alerta ? `<span class="seg-flag ${a.low ? "is-baja" : "is-coment"}">${a.low ? "Calificación baja" : "Con comentario"}</span>` : ""}
          <span class="seg-ref" title="Identificador de la respuesta; servirá para ligarla a una incidencia más adelante">Ref. ${esc(a.answerId)}</span>
        </div>
      </div>`;
  }

  function renderRespuestaDetalle() {
    const d = state.respDet;
    if (!d) return `<div class="seg"><p class="empty-note">Cargando la respuesta…</p></div>`;
    const verPaciente = esAdmin();
    const prom = (lista) => {
      const n = lista.filter((a) => a.score).map((a) => a.score);
      return n.length ? n.reduce((x, y) => x + y, 0) / n.length : null;
    };
    const ficha = (w) => `
      <dl class="seg-ficha">
        <div><dt>Orden</dt><dd><b>${esc(w.code)}</b></dd></div>
        <div><dt>Paciente</dt><dd>${verPaciente ? esc(w.patient || "—") : `<span class="seg-muted">Restringido</span>`}</dd></div>
        <div><dt>Producto</dt><dd>${esc(w.product || "—")}</dd></div>
        <div><dt>Fecha</dt><dd>${esc(w.date || "—")}</dd></div>
        <div><dt>Asesora</dt><dd>${esc(w.advisor || "—")}</dd></div>
      </dl>`;

    return `
      <div class="seg seg-detalle">
        <div class="toolbar-strip seg-top">
          <div class="seg-top-titulo">
            <span class="seg-muted">Respuesta de la encuesta</span>
            <b>${esc(d.surveyName)}</b>
          </div>
          <div class="seg-top-acciones">
            <button class="btn" type="button" data-act="seg-historico" data-arg="${attr(d.doctorKey)}">${ico("trending", 14)} Ver histórico del doctor</button>
            <button class="link-action" type="button" data-act="seg-regresar">Regresar</button>
          </div>
        </div>

        <section class="dl-card seg-encabezado">
          <div class="seg-enc-doc">
            <h2>${esc(d.doctor)}</h2>
            <span>${esc(d.doctorId)}${d.clinic ? ` · ${esc(d.clinic)}` : ""}</span>
          </div>
          <dl class="seg-enc-datos">
            <div><dt>Período</dt><dd>${esc(d.periodLabel)}</dd></div>
            <div><dt>Fecha de respuesta</dt><dd>${fechaSeg(d.answeredAt)}</dd></div>
            <div><dt>Tipo de evaluación</dt><dd>${tipoPill(d.type)}</dd></div>
            <div><dt>Trabajos del período</dt><dd>${d.worksInPeriod}</dd></div>
            <div><dt>Evaluados individualmente</dt><dd>${d.worksEvaluated}${d.worksGrouped ? ` <span class="seg-muted">(+${d.worksGrouped} en conjunto)</span>` : ""}</dd></div>
            <div><dt>Promedio</dt><dd>${notaSeg(d.average)}</dd></div>
            <div><dt>Atención</dt><dd>${marcaAtencion(d.lowCount, d.commentCount)}</dd></div>
          </dl>
          <p class="seg-candado">${ico("shield", 12)} Solo lectura: la respuesta original del doctor no se modifica desde aquí.</p>
        </section>

        <h3 class="seg-bloque-titulo">Evaluación general <small>Opinión del doctor sobre el período, sin órdenes asociadas</small></h3>
        <section class="dl-card seg-bloque">
          ${d.general.length ? d.general.map(filaPregunta).join("") : `<p class="seg-vacio">El doctor no dio una opinión general en esta encuesta.</p>`}
        </section>

        ${d.group ? `
          <h3 class="seg-bloque-titulo">Trabajos evaluados en conjunto <small>Una misma calificación para ${d.group.works.length} orden(es)</small></h3>
          <section class="dl-card seg-bloque">
            <div class="seg-chips-ordenes">${d.group.works.map((w) => `<button type="button" class="seg-orden-chip" data-act="work-detail" data-arg="${attr(w.workId)}" title="${attr([w.product, w.date].filter(Boolean).join(" · "))}">${esc(w.code)}</button>`).join("")}</div>
            ${d.group.answers.map(filaPregunta).join("")}
          </section>` : ""}

        <h3 class="seg-bloque-titulo">Trabajos específicos evaluados <small>${d.works.length ? `${d.works.length} orden(es), cada una ligada por su ID` : "Ninguna orden se evaluó por separado"}</small></h3>
        ${d.works.length
          ? d.works.map((w) => `
            <section class="dl-card seg-bloque seg-trabajo">
              <div class="seg-trabajo-head">
                ${ficha(w)}
                <div class="seg-trabajo-acc">
                  ${notaSeg(w.average)}
                  <button class="dl-mini" type="button" data-act="work-detail" data-arg="${attr(w.workId)}">Ver orden</button>
                </div>
              </div>
              ${w.answers.map(filaPregunta).join("")}
            </section>`).join("")
          : `<section class="dl-card seg-bloque"><p class="seg-vacio">${d.type === "GENERAL" ? "Evaluación general: no se asocia a órdenes específicas." : "Sin trabajos evaluados uno por uno."}</p></section>`}

        ${d.notEvaluated && d.notEvaluated.length ? `
          <p class="seg-muted seg-no-eval">Trabajos del período sin evaluación por separado: ${d.notEvaluated.map((w) => esc(w.code)).join(", ")}</p>` : ""}
      </div>`;
  }

  /* ---------------- Histórico del doctor ---------------- */
  function renderHistoricoDoctor() {
    const h = state.hist;
    if (!h) return `<div class="seg"><p class="empty-note">Cargando el histórico…</p></div>`;
    const tendencia = h.last !== null && h.previous !== null ? h.last - h.previous : null;
    const cronologico = h.rows.filter((r) => r.answered && r.average !== null).slice().reverse();

    return `
      <div class="seg seg-detalle">
        <div class="toolbar-strip seg-top">
          <div class="seg-top-titulo">
            <span class="seg-muted">Histórico del doctor</span>
            <b>${esc(h.doctor)}</b>
          </div>
          <div class="seg-top-acciones">
            <button class="link-action" type="button" data-act="seg-regresar">Regresar</button>
          </div>
        </div>

        <section class="dl-card seg-encabezado">
          <div class="seg-enc-doc">
            <h2>${esc(h.doctor)}</h2>
            <span>${esc(h.doctorId)}${h.clinic ? ` · ${esc(h.clinic)}` : ""}</span>
          </div>
          <div class="seg-kpis is-static">
            <div class="seg-kpi"><span>Encuestas recibidas</span><b>${h.received}</b></div>
            <div class="seg-kpi"><span>Respondidas</span><b>${h.answered}</b></div>
            <div class="seg-kpi"><span>Promedio histórico</span><b>${fmtProm(h.average, 1)}</b></div>
            <div class="seg-kpi"><span>Último vs. anterior</span><b class="${!tendencia ? "" : tendencia < 0 ? "seg-baja" : "seg-sube"}">${tendencia === null ? "—" : `${tendencia > 0 ? "▲ +" : tendencia < 0 ? "▼ " : "= "}${fmtProm(tendencia, 1)}`}</b></div>
            <div class="seg-kpi"><span>Respuestas con atención</span><b>${h.attention}</b></div>
          </div>
        </section>

        ${cronologico.length > 1 ? `
          <section class="dl-card seg-bloque">
            <h3 class="seg-card-titulo">Promedio por período</h3>
            <div class="seg-barras" role="img" aria-label="Promedio por período">
              ${cronologico.map((r) => `
                <div class="seg-barra-col" title="${attr(`${r.periodLabel}: ${fmtProm(r.average, 1)}`)}">
                  <span>${fmtProm(r.average, 1)}</span>
                  <i class="${r.average <= 3 ? "is-baja" : ""}" style="height:${Math.round((r.average / 5) * 100)}%"></i>
                  <small>${esc(r.periodLabel)}</small>
                </div>`).join("")}
            </div>
          </section>` : ""}

        <section class="dl-card">
          <div class="dl-table-wrap">
            <table class="dl-table seg-tabla">
              <thead><tr><th>Período</th><th>Encuesta</th><th>Fecha respuesta</th><th>Tipo</th><th>Promedio</th><th>Trabajos específicos</th><th>Atención</th><th>Estado</th><th class="dl-col-opts">Acción</th></tr></thead>
              <tbody>
                ${h.rows.map((r) => `
                  <tr ${r.answered ? `class="dl-row-link ${r.attention ? "seg-fila-alerta" : ""}" data-row-open="seg-detalle" data-row-arg="${attr(r.instanceId)}"` : ""}>
                    <td><b>${esc(r.periodLabel)}</b></td>
                    <td>${esc(r.surveyName)}</td>
                    <td>${fechaSeg(r.answeredAt)}</td>
                    <td>${r.answered ? tipoPill(r.type) : "—"}</td>
                    <td>${notaSeg(r.average)}</td>
                    <td class="seg-num" title="Uno por uno: ${r.worksEvaluated || 0} · En conjunto: ${r.worksGrouped || 0}">${r.answered ? (r.worksEvaluated || 0) + (r.worksGrouped || 0) : "—"}</td>
                    <td>${r.answered ? marcaAtencion(r.lowCount, r.commentCount) : "—"}</td>
                    <td>${segPill(r.status.clave, r.status.texto, r.status.nota)}</td>
                    <td class="dl-col-opts">${r.answered ? `<button class="dl-mini on" type="button" data-act="seg-detalle" data-arg="${attr(r.instanceId)}">Ver</button>` : ""}</td>
                  </tr>`).join("")}
              </tbody>
            </table>
          </div>
        </section>
      </div>`;
  }

  /* Acciones del seguimiento; devuelve true si la atendió */
  async function accionSeguimiento(act, arg) {
    switch (act) {
      case "seg-estado": {
        const f = segFiltro();
        f.estado = f.estado === arg ? "all" : arg;
        renderView();
        return true;
      }
      case "seg-wa-error": {
        const f = segFiltro();
        f.whatsapp = f.whatsapp === "ERROR" ? "all" : "ERROR";
        renderView();
        return true;
      }
      case "seg-limpiar":
        state.segFiltro = Object.assign({}, SEG_FILTRO);
        renderView();
        return true;
      case "resp-limpiar":
        state.respFiltro = Object.assign({}, RESP_FILTRO);
        renderView();
        return true;
      case "resp-atencion":
        respFiltro().atencion = !respFiltro().atencion;
        renderView();
        return true;
      case "seg-detalle": {
        detenerPoll();
        if (!["resp-detail"].includes(state.view)) apilar();
        state.view = "resp-detail";
        state.module = "surveys";
        state.respDet = null;
        renderApp();
        state.respDet = await DL.api.respuestaDoctor(arg);
        renderView();
        window.scrollTo(0, 0);
        return true;
      }
      case "seg-historico": {
        detenerPoll();
        apilar();
        state.view = "doctor-history";
        state.module = "surveys";
        state.hist = null;
        renderApp();
        state.hist = await DL.api.historicoDoctor(arg);
        renderView();
        window.scrollTo(0, 0);
        return true;
      }
      case "seg-regresar":
        await regresarSeg();
        return true;
      default:
        return false;
    }
  }

  /* Filtros del seguimiento y de las respuestas; devuelve true si lo atendió */
  function cambioSeguimiento(target, escribiendo) {
    if (target.matches("[data-seg-filtro]")) {
      const campo = target.dataset.segFiltro;
      if (escribiendo && target.tagName === "SELECT") return true;
      segFiltro()[campo] = target.value;
      if (target.tagName === "INPUT") refrescarListado(target.id);
      else renderView();
      return true;
    }
    if (target.matches("[data-resp-filtro]")) {
      const campo = target.dataset.respFiltro;
      if (escribiendo && target.tagName === "SELECT") return true;
      respFiltro()[campo] = target.value;
      if (target.tagName === "INPUT") refrescarListado(target.id);
      else renderView();
      return true;
    }
    return false;
  }

  /* ==================================================================
     DASHBOARD · Encuestas
     Igual que en el sistema: el módulo Dashboard tiene su menú
     (Hallazgos, Actitudes, Control Horario, Encuestas). En Encuestas:
       - Internas: el análisis del sistema (ranking de supervisores,
         distribución, tasa de respuesta y promedio por área).
       - Doctores: el tablero de las encuestas externas, con lo que
         sirve para actuar: dónde se cae la respuesta, qué se califica
         bajo, por qué, qué asesora y qué doctores hay que atender.
     ================================================================== */
  const DASH_MODULOS = [
    ["hallazgos", "Hallazgos", "chart"],
    ["actitudes", "Actitudes", "briefcase"],
    ["control-horario", "Control Horario", "clock"],
    ["encuestas", "Encuestas", "clipboard"],
  ];
  const LS_DASH = "dl_dashboard_encuestas";
  const DASH_FILTROS = { modulo: "encuestas", tab: "doctores", abiertos: false, buscar: "", anio: "all", mes: "all", area: "all", dPeriodo: "all", dEncuesta: "all", dArea: "all" };
  const dashFiltros = () => (state.dashF = state.dashF || leerFiltros(LS_DASH, DASH_FILTROS));
  const guardarDash = () => escribirFiltros(LS_DASH, state.dashF);

  async function cargarDashboard() {
    const f = dashFiltros();
    if (f.modulo !== "encuestas") return;
    if (f.tab === "internas") {
      state.resultados = await DL.api.resultados();
      return;
    }
    state.dashDoc = await DL.api.tableroDoctores({ periodo: f.dPeriodo, encuesta: f.dEncuesta, area: f.dArea });
  }

  function renderDashSidebar() {
    const f = dashFiltros();
    els.sidebar.innerHTML = `
      <div class="side-title">DASHBOARD</div>
      <div class="dsh-menu">
        ${DASH_MODULOS.map(([clave, nombre, icono]) => `
          <button type="button" class="dsh-opcion ${f.modulo === clave ? "active" : ""}" data-act="dash-modulo" data-arg="${clave}">
            <span>${ico(icono, 16)}</span><strong>${nombre}</strong>
          </button>`).join("")}
      </div>`;
  }

  function renderDashboard() {
    const f = dashFiltros();
    if (f.modulo !== "encuestas") {
      const nombre = (DASH_MODULOS.find(([c]) => c === f.modulo) || [])[1] || "";
      return `<div class="svy-dash"><div class="svy-dash__state">El tablero de <b>${esc(nombre)}</b> vive en el sistema. En el prototipo solo se trabaja el de <b>Encuestas</b>.</div></div>`;
    }
    const tabs = [["internas", "Internas"], ["doctores", "Doctores"]];
    return `
      <div class="dsh-tabs" role="tablist">
        ${tabs.map(([clave, nombre]) => `<button type="button" role="tab" aria-selected="${f.tab === clave}" class="${f.tab === clave ? "is-active" : ""}" data-act="dash-tab" data-arg="${clave}">${nombre}</button>`).join("")}
      </div>
      ${f.tab === "internas" ? dashInternas() : dashDoctores()}`;
  }

  /* ---------- Barra horizontal (el mismo renglón del sistema) ---------- */
  const barra = ({ rango = "", titulo, sub = "", valor, ancho, clase = "primary", tip = "", act = "", arg = "" }) => `
    <div class="svy-dash__bar-row ${act ? "is-click" : ""}" ${tip ? `title="${attr(tip)}"` : ""} ${act ? `data-act="${act}" data-arg="${attr(arg)}"` : ""}>
      <div class="svy-dash__bar-rank">${rango}</div>
      <div class="svy-dash__bar-labels">
        <div class="svy-dash__bar-main-label">${esc(titulo)}</div>
        ${sub ? `<div class="svy-dash__bar-sub-label">${sub}</div>` : ""}
      </div>
      <div class="svy-dash__bar-track"><div class="svy-dash__bar-fill svy-dash__bar-fill-${clase}" style="width:${Math.max(0, Math.min(100, ancho))}%"></div></div>
      <div class="svy-dash__bar-value">${valor}</div>
    </div>`;

  const tarjeta = (icono, titulo, cuerpo, extra = "", ayuda = "") => `
    <div class="svy-dash__card ${extra}">
      <div class="svy-dash__card-head">
        <div class="svy-dash__card-title">${ico(icono, 16)}<span>${titulo}</span></div>
        ${ayuda ? `<div class="dsh-ayuda">${ayuda}</div>` : ""}
      </div>
      ${cuerpo}
    </div>`;

  const dona = (porcentaje, etiqueta, color = "#d84b91") => `
    <div class="svy-dash__donut" style="background: conic-gradient(${color} 0% ${porcentaje}%, #e5e7eb ${porcentaje}% 100%)">
      <div class="svy-dash__donut-inner"><strong>${Math.round(porcentaje)}%</strong><span>${etiqueta}</span></div>
    </div>`;

  const claseNota = (v) => (v === null || v === undefined ? "primary" : v >= 4.5 ? "excellent" : v >= 3.5 ? "good" : v >= 2.5 ? "regular" : "critical");

  /* ---------- Filtros (Ver filtros, como el sistema) ---------- */
  function dashFiltrosBarra(campos, activos) {
    const f = dashFiltros();
    return `
      <div class="svy-dash__filters">
        <div class="svy-dash__filter-toolbar">
          <button type="button" class="svy-dash__filter-toggle ${f.abiertos ? "is-open" : ""}" data-act="dash-filtros" aria-expanded="${f.abiertos}">
            ${ico("sliders", 14)}<span>${f.abiertos ? "Ocultar filtros" : "Ver filtros"}</span>
            ${activos ? `<span class="svy-dash__filter-count">${activos}</span>` : ""}
            <span class="svy-dash__filter-chevron">${ico("down", 14)}</span>
          </button>
          ${activos ? `<button type="button" class="svy-dash__filter-clear" data-act="dash-limpiar">${ico("x", 13)} Borrar filtros</button>` : "<span></span>"}
          ${f.abiertos ? `<div class="svy-dash__inline-filters">${campos}</div>` : ""}
        </div>
      </div>`;
  }

  const campoSelect = (etiqueta, campo, valor, opciones) => `
    <div class="svy-dash__filter-field">
      <label>${etiqueta}</label>
      <select data-dash-filtro="${campo}">
        ${opciones.map(([v, t]) => `<option value="${attr(v)}" ${String(valor) === String(v) ? "selected" : ""}>${esc(t)}</option>`).join("")}
      </select>
    </div>`;

  /* ---------------- Internas: igual que el sistema ---------------- */
  function dashInternas() {
    const f = dashFiltros();
    const filas = (state.resultados || []).map((r) => ({
      template: r.surveyName || "Encuesta",
      area: r.area || "—",
      supervisor: r.supervisor || "—",
      anio: anioDe(r),
      mes: Number(String(r.period || "").slice(5, 7)) || 0,
      periodo: r.periodLabel || "",
      asignadas: Number(r.asignadas || 0),
      respondidas: Number(r.respuestas || 0),
      nota: r.respuestas && r.promedio !== "—" ? Number(r.promedio) : null,
    }));
    const termino = String(f.buscar || "").trim().toLowerCase();
    const vis = filas.filter((r) =>
      (!termino || [r.template, r.supervisor, r.area, r.periodo].some((t) => t.toLowerCase().includes(termino))) &&
      (f.anio === "all" || Number(f.anio) === r.anio) &&
      (f.mes === "all" || Number(f.mes) === r.mes) &&
      (f.area === "all" || f.area === r.area));

    const asignadas = vis.reduce((t, r) => t + r.asignadas, 0);
    const respondidas = vis.reduce((t, r) => t + r.respondidas, 0);
    const pendientes = Math.max(asignadas - respondidas, 0);
    const tasa = asignadas ? (respondidas / asignadas) * 100 : 0;

    const promediar = (clave) => {
      const mapa = new Map();
      vis.filter((r) => r.nota !== null).forEach((r) => {
        const k = r[clave];
        if (!mapa.has(k)) mapa.set(k, []);
        mapa.get(k).push(r.nota);
      });
      return [...mapa.entries()].map(([k, n]) => ({ k, v: n.reduce((a, b) => a + b, 0) / n.length })).sort((a, b) => b.v - a.v);
    };
    const ranking = promediar("supervisor").slice(0, 10);
    const areas = promediar("area");
    const dist = [["excellent", "Excelente"], ["good", "Bueno"], ["regular", "Regular"], ["critical", "Crítico"]]
      .map(([k, label]) => ({ k, label, v: vis.filter((r) => r.nota !== null && claseNota(r.nota) === k).length }));
    const maxDist = Math.max(...dist.map((d) => d.v), 1);

    const anios = [...new Set(filas.map((r) => r.anio).filter(Boolean))].sort((a, b) => b - a);
    const areasOp = [...new Set(filas.map((r) => r.area).filter(Boolean))].sort();
    const activos = (termino ? 1 : 0) + (f.anio !== "all" ? 1 : 0) + (f.mes !== "all" ? 1 : 0) + (f.area !== "all" ? 1 : 0);

    return `
      <div class="svy-dash">
        ${dashFiltrosBarra(`
          <div class="svy-dash__filter-field">
            <label>Buscar</label>
            <input type="text" id="dashBuscar" data-dash-filtro="buscar" placeholder="Encuesta, área, supervisor o periodo" value="${attr(f.buscar)}">
          </div>
          ${campoSelect("Año", "anio", f.anio, [["all", "Todos"], ...anios.map((a) => [a, a])])}
          ${campoSelect("Mes", "mes", f.mes, [["all", "Todos"], ...MESES_RES.map((m, i) => [i + 1, m])])}
          ${campoSelect("Área", "area", f.area, [["all", "Todas"], ...areasOp.map((a) => [a, a])])}`, activos)}
        <div class="svy-dash__grid">
          ${tarjeta("trending", "Ranking de supervisores", ranking.length
            ? `<div class="svy-dash__bars">${ranking.map((r, i) => barra({ rango: `#${i + 1}`, titulo: r.k, sub: etiquetaNota(r.v), valor: r.v.toFixed(2), ancho: (r.v / 5) * 100 })).join("")}</div>`
            : `<div class="svy-dash__empty">No hay suficientes datos para generar el ranking.</div>`)}
          ${tarjeta("shield", "Distribución de resultados", `<div class="svy-dash__bars">${dist.map((d) => `
            <div class="svy-dash__bar-row">
              <div class="svy-dash__tag tag-${d.k}">${d.label}</div>
              <div class="svy-dash__bar-track"><div class="svy-dash__bar-fill svy-dash__bar-fill-${d.k}" style="width:${(d.v / maxDist) * 100}%"></div></div>
              <div class="svy-dash__bar-value">${d.v}</div>
            </div>`).join("")}</div>`)}
          ${tarjeta("check", "Tasa de respuesta", `
            <div class="svy-dash__response">
              ${dona(tasa, "respuesta")}
              <div class="svy-dash__response-stats">
                <div class="svy-dash__response-item"><div class="svy-dash__dot dot-answered"></div><div><strong>${respondidas}</strong><span>Respondidas</span></div></div>
                <div class="svy-dash__response-item"><div class="svy-dash__dot dot-pending"></div><div><strong>${pendientes}</strong><span>No respondidas</span></div></div>
              </div>
            </div>`)}
          ${tarjeta("briefcase", "Promedio por área", areas.length
            ? `<div class="svy-dash__bars">${areas.map((a) => `
              <div class="svy-dash__bar-row">
                <div class="svy-dash__bar-labels svy-dash__bar-labels-area"><div class="svy-dash__bar-main-label">${esc(a.k)}</div></div>
                <div class="svy-dash__bar-track"><div class="svy-dash__bar-fill svy-dash__bar-fill-area" style="width:${(a.v / 5) * 100}%"></div></div>
                <div class="svy-dash__bar-value">${a.v.toFixed(2)}</div>
              </div>`).join("")}</div>`
            : `<div class="svy-dash__empty">No hay suficientes datos por área.</div>`)}
        </div>
        <div class="svy-dash__summary">
          <div class="svy-dash__summary-card"><span class="svy-dash__summary-label">Encuestas aplicadas</span><strong>${vis.length}</strong></div>
          <div class="svy-dash__summary-card"><span class="svy-dash__summary-label">Colaboradores asignados</span><strong>${asignadas}</strong></div>
          <div class="svy-dash__summary-card"><span class="svy-dash__summary-label">Respuestas recibidas</span><strong>${respondidas}</strong></div>
        </div>
      </div>`;
  }

  /* ---------------- Doctores: encuestas externas ---------------- */
  function dashDoctores() {
    const f = dashFiltros();
    const t = state.dashDoc;
    if (!t) return `<div class="svy-dash"><div class="svy-dash__state">Cargando tablero…</div></div>`;
    const op = t.options || {};
    const activos = (f.dPeriodo !== "all" ? 1 : 0) + (f.dEncuesta !== "all" ? 1 : 0) + (f.dArea !== "all" ? 1 : 0);
    const filtros = dashFiltrosBarra(`
      ${campoSelect("Período", "dPeriodo", f.dPeriodo, [["all", "Todos"], ...(op.periods || []).slice().reverse().map((p) => [p.period, p.periodLabel])])}
      ${campoSelect("Encuesta", "dEncuesta", f.dEncuesta, [["all", "Todas"], ...(op.surveys || []).map((s) => [s.id, s.name])])}
      ${campoSelect("Área", "dArea", f.dArea, [["all", "Todas"], ...(op.areas || []).map((a) => [a, a])])}`, activos);

    if (!t.sent && !t.answered) {
      return `<div class="svy-dash">${filtros}<div class="svy-dash__state">Todavía no hay encuestas a doctores enviadas con estos filtros. Puede cargar datos de prueba desde el menú de Encuestas.</div></div>`;
    }

    const periodoTxt = f.dPeriodo !== "all" ? ((op.periods || []).find((p) => p.period === f.dPeriodo) || {}).periodLabel || f.dPeriodo : "Todos los períodos";
    const kpi = (etiqueta, valor, sub = "", clase = "") => `
      <div class="svy-dash__summary-card ${clase}"><span class="svy-dash__summary-label">${etiqueta}</span><strong>${valor}</strong>${sub ? `<small>${sub}</small>` : ""}</div>`;

    /* Tendencia: promedio (barra), % respuesta y % con atención (líneas) */
    const per = t.periods || [];
    const ancho = 100 / Math.max(per.length, 1);
    const punto = (i, v) => `${(i + 0.5) * ancho},${100 - v}`;
    const tendencia = `
      <div class="dsh-trend">
        <div class="dsh-trend-plot">
          ${per.map((p) => `
            <button type="button" class="dsh-trend-col ${f.dPeriodo === p.period ? "is-sel" : ""}" data-act="dash-periodo" data-arg="${attr(p.period)}"
              title="${attr(`${p.periodLabel}: promedio ${fmtProm(p.average)} · ${p.answered} de ${p.sent} respondieron (${p.rate}%) · ${p.attention} con atención (${p.attentionRate}%)`)}">
              <span class="dsh-trend-val">${fmtProm(p.average, 1)}</span>
              <i class="svy-dash__bar-fill-${claseNota(p.average)}" style="height:${p.average ? (p.average / 5) * 100 : 0}%"></i>
            </button>`).join("")}
          <svg class="dsh-trend-lines" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
            <polyline class="is-tasa" points="${per.map((p, i) => punto(i, p.rate)).join(" ")}"/>
            <polyline class="is-atencion" points="${per.map((p, i) => punto(i, p.attentionRate)).join(" ")}"/>
          </svg>
        </div>
        <div class="dsh-trend-labels">${per.map((p) => `<span>${esc(p.periodLabel.replace(/ \d{4}$/, ""))}<small>${p.rate}% resp.</small></span>`).join("")}</div>
        <div class="dsh-leyenda"><span><i class="is-prom"></i>Promedio (barra)</span><span><i class="is-tasa"></i>% de respuesta</span><span><i class="is-atencion"></i>% con atención</span><span class="dsh-nota">Clic en un mes para filtrarlo</span></div>
      </div>`;

    /* Embudo: dónde se pierde la respuesta */
    const fu = t.funnel || {};
    const pasos = [["Generadas", fu.generated], ["Enviadas", fu.sent], ["Entregadas por WhatsApp", fu.delivered], ["Abrieron el enlace", fu.opened], ["Respondieron", fu.answered]];
    const embudo = `<div class="svy-dash__bars">${pasos.map(([n, v], i) => barra({
      titulo: n,
      sub: i ? `${pasos[i - 1][1] ? Math.round((v / pasos[i - 1][1]) * 100) : 0}% del paso anterior` : "",
      valor: v,
      ancho: fu.generated ? (v / fu.generated) * 100 : 0,
      clase: i === pasos.length - 1 ? "excellent" : "primary",
    })).join("")}</div>
      <div class="dsh-chips">
        <button type="button" class="dsh-chip is-rojo" data-act="dash-ir-envios" title="Ver en Envíos">${t.waErrors} con error de WhatsApp</button>
        <span class="dsh-chip">${t.expired} vencidas sin respuesta</span>
      </div>`;

    /* Calificaciones de 1 a 5 */
    const est = t.stars || [];
    const totalEst = est.reduce((a, e) => a + e.count, 0);
    const maxEst = Math.max(...est.map((e) => e.count), 1);
    const bajas = est.filter((e) => e.stars <= 3).reduce((a, e) => a + e.count, 0);
    const estrellas = `
      <div class="dsh-hist">
        ${est.map((e) => `
          <div class="dsh-hist-col" title="${attr(`${e.count} calificaciones de ${e.stars} estrella(s)`)}">
            <span>${e.count}<small>${totalEst ? Math.round((e.count / totalEst) * 100) : 0}%</small></span>
            <i class="${e.stars <= 3 ? "is-baja" : ""}" style="height:${(e.count / maxEst) * 100}%"></i>
            <b>${"★".repeat(e.stars)}</b>
          </div>`).join("")}
      </div>
      <div class="dsh-pie-nota"><b>${totalEst ? Math.round((bajas / totalEst) * 100) : 0}%</b> de las calificaciones son de 1 a 3 estrellas (${bajas} de ${totalEst}).</div>`;

    /* Tipo de evaluación (cómo prefieren evaluar los doctores) */
    const tipos = t.types || [];
    const totalTipos = tipos.reduce((a, x) => a + x.count, 0) || 1;
    const colTipo = { GENERAL: "#64748b", INDIVIDUAL: "#16a34a", MIXTA: "#7c3aed" };
    const tipoTxt = { GENERAL: "General", INDIVIDUAL: "Individual", MIXTA: "Mixta" };
    const tiposHtml = `
      <div class="dsh-stack">${tipos.map((x) => `<i style="width:${(x.count / totalTipos) * 100}%;background:${colTipo[x.type]}" title="${attr(`${tipoTxt[x.type]}: ${x.count}`)}"></i>`).join("")}</div>
      <div class="dsh-stack-ley">${tipos.map((x) => `<span><i style="background:${colTipo[x.type]}"></i>${tipoTxt[x.type]} <b>${x.count}</b> (${Math.round((x.count / totalTipos) * 100)}%)</span>`).join("")}</div>
      <div class="dsh-pie-nota">Con Individual y Mixta se sabe qué orden falló; con General solo se conoce la opinión del mes.</div>`;

    const areas = (t.areas || []).map((a) => barra({ titulo: a.area, sub: `${a.ratings} calificaciones · ${a.lowRate}% bajas`, valor: fmtProm(a.average), ancho: (a.average / 5) * 100, clase: claseNota(a.average), act: "dash-area", arg: a.area, tip: "Clic para filtrar por esta área" })).join("");
    const maxMot = Math.max(...(t.reasons || []).map((r) => r.count), 1);
    const motivos = (t.reasons || []).length
      ? (t.reasons || []).map((r, i) => barra({ rango: `#${i + 1}`, titulo: r.reason, sub: `${r.share}% de los motivos`, valor: r.count, ancho: (r.count / maxMot) * 100, clase: "critical" })).join("")
      : `<div class="svy-dash__empty">Sin calificaciones bajas con motivo.</div>`;
    const asesoras = (t.advisors || []).length
      ? (t.advisors || []).map((a, i) => barra({ rango: `#${i + 1}`, titulo: a.advisor, sub: `${etiquetaNota(a.average)} · ${a.ratings} calif. · ${a.low} bajas`, valor: fmtProm(a.average), ancho: (a.average / 5) * 100, clase: claseNota(a.average) })).join("")
      : `<div class="svy-dash__empty">Sin órdenes evaluadas individualmente.</div>`;
    const preguntas = (t.questions || []).map((q) => barra({ titulo: q.question, sub: `${esc(q.area)} · ${q.lowRate}% bajas`, valor: fmtProm(q.average), ancho: (q.average / 5) * 100, clase: claseNota(q.average) })).join("");

    const flecha = (v) => (v === null || v === undefined ? `<span class="dsh-tend">—</span>`
      : `<span class="dsh-tend ${v < 0 ? "is-baja" : v > 0 ? "is-sube" : ""}">${v < 0 ? "▼" : v > 0 ? "▲" : "="} ${Math.abs(v).toFixed(1)}</span>`);
    const riesgo = (t.riskDoctors || []).length ? `
      <table class="dsh-tabla">
        <thead><tr><th>Doctor</th><th>Promedio</th><th>Último vs. anterior</th><th>Notas bajas</th><th>Respuestas</th><th></th></tr></thead>
        <tbody>${t.riskDoctors.map((d) => `
          <tr>
            <td><b>${esc(d.doctor)}</b><small>${esc(d.doctorId)} · ${esc(d.clinic)}</small></td>
            <td><span class="dsh-nota-pill is-${claseNota(d.average)}">${fmtProm(d.average)}</span></td>
            <td>${flecha(d.trend)}</td>
            <td>${d.lowCount}</td>
            <td>${d.responses}</td>
            <td class="dsh-acc">
              <button type="button" class="mini-btn" data-act="seg-detalle" data-arg="${attr(d.instanceId)}">Última respuesta</button>
              <button type="button" class="mini-btn" data-act="seg-historico" data-arg="${attr(d.doctorKey)}">Histórico</button>
            </td>
          </tr>`).join("")}</tbody>
      </table>` : `<div class="svy-dash__empty">Sin respuestas en este período.</div>`;

    return `
      <div class="svy-dash">
        ${filtros}
        <div class="dsh-kpis">
          ${kpi("Encuestas enviadas", t.sent, `${t.doctors} doctores · ${esc(periodoTxt)}`)}
          ${kpi("Respondidas", t.answered, `${t.rate}% de respuesta`)}
          ${kpi("Promedio", `${fmtProm(t.average)} <em>/ 5</em>`, etiquetaNota(t.average), `is-${claseNota(t.average)}`)}
          ${kpi("Requieren atención", t.attention, `${t.attentionRate}% de las respuestas`, t.attention ? "is-alerta" : "")}
          ${kpi("WhatsApp con error", t.waErrors, "No recibieron la encuesta", t.waErrors ? "is-alerta" : "")}
        </div>
        <div class="svy-dash__grid">
          ${tarjeta("trending", "Tendencia por período", tendencia, "is-ancha", "¿Mejora o empeora la satisfacción mes a mes, y responde más gente?")}
          ${tarjeta("check", "Embudo de respuesta", embudo, "", "Dónde se pierde la respuesta del doctor.")}
          ${tarjeta("star", "Calificaciones de 1 a 5", estrellas, "", "Cuántas notas bajas hay realmente.")}
          ${tarjeta("briefcase", "Promedio por área", `<div class="svy-dash__bars">${areas}</div>`, "", "Qué área responde por las notas bajas.")}
          ${tarjeta("message", "Motivos de mejora", `<div class="svy-dash__bars">${motivos}</div>`, "", "Lo que marcan los doctores cuando califican bajo.")}
          ${tarjeta("users", "Ranking de asesoras", `<div class="svy-dash__bars">${asesoras}</div>`, "", "Solo cuenta lo evaluado por orden (Individual o Mixta).")}
          ${tarjeta("shield", "Preguntas con promedio más bajo", `<div class="svy-dash__bars">${preguntas}</div>`)}
          ${tarjeta("users", "Doctores a atender", riesgo, "is-ancha", "Los de promedio más bajo. Abra su última respuesta o su histórico para darles seguimiento.")}
          ${tarjeta("clipboard", "Tipo de evaluación", tiposHtml, "is-ancha")}
        </div>
      </div>`;
  }

  async function accionDashboard(act, arg) {
    const f = dashFiltros();
    switch (act) {
      case "dash-modulo":
        f.modulo = arg;
        break;
      case "dash-tab":
        f.tab = arg;
        break;
      case "dash-filtros":
        f.abiertos = !f.abiertos;
        guardarDash();
        renderView();
        return true;
      case "dash-limpiar":
        Object.assign(f, f.tab === "internas" ? { buscar: "", anio: "all", mes: "all", area: "all" } : { dPeriodo: "all", dEncuesta: "all", dArea: "all" });
        break;
      case "dash-periodo":
        f.dPeriodo = f.dPeriodo === arg ? "all" : arg;
        break;
      case "dash-area":
        f.dArea = f.dArea === arg ? "all" : arg;
        break;
      case "dash-abrir":
        f.modulo = "encuestas";
        f.tab = "doctores";
        guardarDash();
        await irA("dashboard");
        return true;
      case "dash-ir-envios": {
        const enc = f.dEncuesta !== "all" ? f.dEncuesta : ((state.dashDoc.options.surveys || [])[0] || {}).id;
        if (!enc) return true;
        await runAction("edit", enc);
        state.module = "surveys";
        state.segFiltro = Object.assign({}, SEG_FILTRO, { whatsapp: "ERROR", periodo: f.dPeriodo !== "all" ? f.dPeriodo : "all" });
        await runAction("editor-tab", "envios");
        renderApp();
        return true;
      }
      default:
        return false;
    }
    guardarDash();
    await cargarDashboard();
    renderApp();
    return true;
  }

  function cambioDashboard(target, escribiendo) {
    if (!target.matches("[data-dash-filtro]")) return false;
    if (escribiendo && target.tagName === "SELECT") return true;
    dashFiltros()[target.dataset.dashFiltro] = target.value;
    guardarDash();
    if (target.tagName === "INPUT") {
      refrescarListado(target.id);
      return true;
    }
    cargarDashboard().then(renderView);
    return true;
  }

  /* Acciones de resultados; devuelve true si la atendió */
  async function accionResultados(act, arg) {
    const f = filtrosRes();
    switch (act) {
      case "doc-orden": {
        const o = state.resDocOrden || { col: "enviada", dir: "desc" };
        state.resDocOrden = { col: arg, dir: o.col === arg && o.dir === "desc" ? "asc" : "desc" };
        state.resDocPagina = 1;
        renderView();
        return true;
      }
      case "res-tab":
        f.tab = arg === "doctores" ? "doctores" : "internas";
        guardarFiltrosRes();
        state.resDoc = null;
        state.resDocDetalle = null;
        irA("results-list");
        return true;
      case "res-filtros":
        f.abiertos = !f.abiertos;
        guardarFiltrosRes();
        renderView();
        return true;
      case "res-limpiar":
        Object.assign(f, { buscar: "", anio: "all", mes: "all", area: "all" });
        guardarFiltrosRes();
        renderView();
        return true;
      case "res-det-tab":
        f.detalle = arg === "analytics" ? "analytics" : "detail";
        guardarFiltrosRes();
        state.resColab = null;
        renderView();
        return true;
      case "res-colab":
        state.resColab = Number(arg);
        renderView();
        return true;
      case "res-colab-cerrar":
        state.resColab = null;
        renderView();
        return true;
      case "res-exportar":
        exportarInterna();
        return true;
      case "res-noop":
        return true;
      case "doc-abrir": {
        state.resDoc = (state.resDoctores || []).find((p) => p.doctorSurveyPeriodId === arg) || { doctorSurveyPeriodId: arg };
        state.resDocDetalle = null;
        state.resDocTab = "summary";
        state.resDocPregunta = "";
        state.resDocPersona = "";
        state.resDocComentarios = {};
        state.resDocMas = {};
        state.view = "doctor-result";
        state.module = "surveys";
        renderApp();
        try {
          state.resDocDetalle = await DL.api.resultadoDoctores(arg);
        } catch (error) {
          showToast(error.message);
        }
        if (state.view === "doctor-result") renderView();
        return true;
      }
      case "doc-volver":
        state.resDoc = null;
        state.resDocDetalle = null;
        irA("results-list");
        return true;
      case "doc-tab":
        state.resDocTab = arg;
        renderView();
        window.scrollTo(0, 0);
        return true;
      case "doc-ver-pregunta":
        state.resDocPregunta = arg;
        state.resDocTab = "question";
        renderView();
        window.scrollTo(0, 0);
        return true;
      case "doc-ver-persona":
        state.resDocPersona = arg;
        state.resDocTab = "person";
        renderView();
        window.scrollTo(0, 0);
        return true;
      case "doc-mover-pregunta":
      case "doc-mover-persona": {
        const d = state.resDocDetalle;
        if (!d) return true;
        const pregunta = act === "doc-mover-pregunta";
        const lista = pregunta ? modeloDoctores(d).flatMap((s) => s.questions) : respondieron(d);
        const actual = pregunta ? state.resDocPregunta : state.resDocPersona;
        const i = Math.max(0, lista.findIndex((x) => String(x.key) === String(actual)));
        const otro = lista[i + Number(arg)];
        if (otro) {
          if (pregunta) state.resDocPregunta = otro.key;
          else state.resDocPersona = otro.key;
          renderView();
        }
        return true;
      }
      case "doc-comentarios":
        state.resDocComentarios = Object.assign({}, state.resDocComentarios, { [arg]: !(state.resDocComentarios || {})[arg] });
        renderView();
        return true;
      case "doc-mas":
        state.resDocMas = Object.assign({}, state.resDocMas, { [arg]: !(state.resDocMas || {})[arg] });
        renderView();
        return true;
      case "doc-exportar":
        exportarDoctores();
        return true;
      default:
        return false;
    }
  }

  /* Filtros y selectores de resultados (input y change) */
  function cambioResultados(target, escribiendo) {
    if (target.matches("[data-res-filtro]")) {
      filtrosRes()[target.dataset.resFiltro] = target.value;
      guardarFiltrosRes();
      if (escribiendo) refrescarListado("buscarResultado");
      else renderView();
      return true;
    }
    if (target.matches("[data-doc-buscar]")) {
      state.resDocBuscar = target.value;
      state.resDocPagina = 1;
      refrescarListado("docBuscar");
      return true;
    }
    if (target.matches("[data-doc-select]")) {
      if (escribiendo) return true;
      const cual = target.dataset.docSelect;
      if (cual === "encuesta") {
        state.resDocFiltro = target.value;
        state.resDocPagina = 1;
      }
      if (cual === "pregunta") state.resDocPregunta = target.value;
      if (cual === "persona") state.resDocPersona = target.value;
      renderView();
      return true;
    }
    return false;
  }

  /* ---------------- Ficha del trabajo (los mismos datos del sistema) ---------------- */
  function renderWorkDetail() {
    const work = selectedWork();
    const eligible = ["enviado", "facturado"].includes(work.status);
    /* Solo las del mismo mes que esta orden: son las que caerían en su
       misma encuesta, no todo el historial del doctor. */
    const mes = String(DL.aISO(work.sent) || "").slice(0, 7);
    const ultimo = mes ? new Date(Number(mes.slice(0, 4)), Number(mes.slice(5, 7)), 0).getDate() : 0;
    const mismos = mes
      ? DL.worksByDoctor(work.doctor, ["enviado", "facturado"], `${mes}-01`, `${mes}-${String(ultimo).padStart(2, "0")}`)
      : [];
    const dato = (etiqueta, valor) => `<div class="wk-item"><span>${etiqueta}</span><b>${esc(valor || "—")}</b></div>`;

    return `
      <div class="dl-tabs">
        <div class="dl-tabs-list">
          <button class="dl-tab is-active" type="button">Resumen</button>
          <button class="dl-tab" type="button" data-act="work-findings">Hallazgos</button>
        </div>
        <div class="dl-tabs-actions">
          <button class="dl-tab-action" type="button" data-act="survey-from-work" data-arg="${esc(work.id)}" ${eligible ? "" : "disabled"}>Encuesta del doctor</button>
          <button class="dl-tab-action" type="button" data-view="work-list">Volver</button>
        </div>
      </div>

      <section class="wk-head">
        <div class="wk-head-main">
          <div><span>Código trabajo</span><h1>${esc(work.code)}</h1></div>
          <div><span>Técnico ingreso</span><b>${esc(work.technician)}</b></div>
          ${puntuacionTrabajo()}
        </div>
        <span class="wk-status">${esc(work.status)} ⌄</span>
      </section>

      <section class="wk-panel">
        ${dato("Cliente", work.clinic)}
        ${dato("Centro", work.center)}
        ${dato("Doctor/a", work.doctor)}
        ${dato("Paciente", work.patient)}
        ${dato("Edad/Sexo", `${work.age}/${work.sex}`)}
        ${dato("Caja", work.box)}
        ${dato("Fecha de creación", work.createdAt)}
        ${dato("Fecha de aceptación", work.acceptedAt)}
        ${dato("Fecha de finalización", work.finishedAt)}
        ${dato("Fecha de envío", work.sent)}
        ${dato("Fecha de pedido", work.orderedAt)}
        ${dato("Fecha límite", work.dueAt)}
        ${dato("Entrega estimada", work.estimatedAt)}
        ${dato("Fecha de albarán", work.albaranAt)}
        ${dato("Total", work.total)}
        ${dato("Total con IVA", work.totalIVA)}
      </section>

      <section class="dl-card">
        <div class="wk-block-head"><div><b>Etiquetas de trabajo</b><span>Etiquetas asignadas a la orden en el sistema externo.</span></div></div>
        <div class="wk-tags">${(work.tags || []).map((tag, i) => `<span class="wk-tag"><i>${i + 2}</i> ${esc(tag)}</span>`).join("") || `<span class="dl-muted">Sin etiquetas.</span>`}</div>
      </section>

      <section class="dl-card">
        <div class="wk-block-head">
          <div><b>Productos</b><span>Líneas de producto/concepto de la orden.</span></div>
          <span class="wk-count">${(work.products || []).length} línea(s)</span>
        </div>
        <div class="dl-table-wrap">
          <table class="dl-table">
            <thead><tr><th>#</th><th>Producto/Concepto</th><th>Unidades</th><th>Dientes</th><th>Precio</th><th>Dto. (%)</th><th>Precio/Un.</th><th>Total</th><th>IVA</th></tr></thead>
            <tbody>
              ${(work.products || []).map((item) => `
                <tr>
                  <td>${item.line}</td>
                  <td><b>${esc(item.code)} - ${esc(item.name)}</b> <i>${esc(item.ref)}</i></td>
                  <td>${item.units}</td><td>${item.teeth}</td><td>${esc(item.price)}</td>
                  <td>${esc(item.discount)}</td><td>${esc(item.unitPrice)}</td><td>${esc(item.total)}</td><td>${esc(item.iva)}</td>
                </tr>`).join("")}
              <tr class="wk-total"><td></td><td>Total</td><td>${(work.products || []).reduce((t, i) => t + i.units, 0)}</td><td colspan="5"></td><td>${esc(work.total)}</td></tr>
              <tr class="wk-total"><td colspan="7"></td><td>Total con IVA</td><td>${esc(work.totalIVA)}</td></tr>
            </tbody>
          </table>
        </div>
      </section>

      <section class="dl-card">
        <div class="wk-block-head">
          <div><b>Fases de la orden</b><span>Tareas registradas en el sistema externo, en orden de ejecución.</span></div>
          <span class="wk-count">${(work.phases || []).length} fase(s)</span>
        </div>
        <div class="dl-table-wrap">
          <table class="dl-table">
            <thead><tr><th>#</th><th>Fase</th><th>Responsable</th><th>Estado</th><th>Inicio</th><th>Fin</th><th>Entrega est.</th><th>Dientes</th><th>Coste</th><th>Comisión</th><th>Tiempo</th></tr></thead>
            <tbody>
              ${(work.phases || []).map((fase) => `
                <tr>
                  <td>${fase.line}</td>
                  <td>${esc(fase.name)}</td>
                  <td><b>${esc(fase.responsible)}</b> <i>${esc(fase.role)}</i></td>
                  <td><span class="dl-badge ${fase.state === "terminada" ? "ok" : "warn"}">${esc(fase.state)}</span></td>
                  <td>${esc(fase.start)}</td><td>${esc(fase.end)}</td><td>${esc(fase.estimated)}</td>
                  <td>${fase.teeth}</td><td>${esc(fase.cost)}</td><td>${esc(fase.commission)}</td><td>${esc(fase.time)}</td>
                </tr>`).join("")}
            </tbody>
          </table>
        </div>
      </section>

      <section class="wk-notes">
        <div class="dl-card">
          <div class="wk-block-head"><div><b>Observaciones</b><span>Indicaciones enviadas por la clínica.</span></div></div>
          <p class="wk-note">${esc(work.observations)}</p>
        </div>
        <div class="dl-card">
          <div class="wk-block-head"><div><b>Notas internas</b><span>Notas visibles solo para el laboratorio.</span></div></div>
          <p class="wk-note">${esc(work.internalNotes)}</p>
        </div>
      </section>

      ${bloqueEncuestaTrabajo(work)}

      <section class="dl-card">
        <div class="wk-block-head"><div><b>Órdenes del mismo doctor en el mes de esta orden</b><span>Son las que entrarían en la misma encuesta de ${esc(work.doctor)}.</span></div><span class="wk-count">${mismos.length} orden(es)</span></div>
        <div class="dl-table-wrap">
          <table class="dl-table">
            <thead><tr><th>Orden</th><th>Paciente</th><th>Producto</th><th>Envío</th><th>Asesora</th></tr></thead>
            <tbody>${mismos.map((item) => `<tr><td><b>${esc(item.code)}</b></td><td>${esc(item.patient)}</td><td>${esc(item.product)}</td><td>${esc(item.sent)}</td><td>${esc(item.advisor)}</td></tr>`).join("")}</tbody>
          </table>
        </div>
      </section>`;
  }

  /* ==================================================================
     Vista previa
     ================================================================== */
  function openPreview() {
    if (!state.draft) return;
    state.previewOpen = true;
    els.previewTitle.textContent = state.draft.name;
    mountPreview();
    els.previewDrawer.classList.add("open");
    els.previewDrawer.setAttribute("aria-hidden", "false");
  }

  function closePreview() {
    state.previewOpen = false;
    els.previewDrawer.classList.remove("open");
    els.previewDrawer.setAttribute("aria-hidden", "true");
  }

  function refreshPreview() {
    if (state.previewOpen) mountPreview();
  }

  /* Doctor y órdenes que corresponden a la configuración actual:
     la vista previa muestra exactamente lo que recibiría ese doctor. */
  function alcancePrevio() {
    const survey = state.draft;
    if (!isExternal() || !survey.works.enabled) {
      return { doctor: survey.respondent, works: [], doctores: [] };
    }
    const manual = survey.audienceMode === "Selección manual";
    const lista = elegibles();
    let doctores = [...new Set(lista.map((work) => work.doctor))];
    if (manual) doctores = doctores.filter((doctor) => (survey.audienceDoctors || []).includes(doctor));

    const doctor = doctores.includes(state.previewDoctor) ? state.previewDoctor : doctores[0] || "";
    let works = lista.filter((work) => work.doctor === doctor);
    if (manual) works = works.filter((work) => survey.works.selectedIds.includes(work.id));
    return { doctor: doctor || survey.respondent, works, doctores };
  }

  function mountPreview() {
    const survey = state.draft;
    const alcance = alcancePrevio();
    const externa = survey.classification === "Externa";

    els.previewContent.innerHTML = `
      <div class="preview-simulator">
        <div>
          <b>Así responde ${externa ? "el doctor" : "el colaborador"}</b>
          <span>Es la encuesta real, con sus validaciones${alcance.works.length ? ` · ${alcance.works.length} orden(es) del período` : ""}.</span>
        </div>
        <div class="simulator-group">
          ${alcance.doctores.length > 1
            ? `<select class="simulator-select" data-preview-doctor>${alcance.doctores
                .map((doctor) => `<option ${doctor === alcance.doctor ? "selected" : ""}>${esc(doctor)}</option>`)
                .join("")}</select>`
            : ""}
          <button class="simulator-btn" type="button" data-act="preview-reset">Reiniciar</button>
          <button class="simulator-btn" type="button" data-act="public-link">Abrir en pestaña</button>
        </div>
      </div>
      <div class="preview-device">
        <div class="preview-device-top">
          <img src="../assets/LOGO_DLABS2.png" alt="Digital Labs">
          <div><b>${esc(survey.subtype || (externa ? "Encuesta externa" : "Encuesta interna"))}</b><span>${esc(alcance.doctor)} · ${esc(survey.periodLabel)}</span></div>
        </div>
        <div class="preview-device-body" id="previewMount"></div>
      </div>`;

    DL.createRuntime({
      mount: document.getElementById("previewMount"),
      survey: DL.clone(survey),
      works: alcance.works,
      respondent: alcance.doctor,
      compact: true,
      onFinish: async () => {},
    });
  }

  /* ==================================================================
     Utilidades
     ================================================================== */
  function options(list, selected) {
    return list.map((item) => `<option ${item === selected ? "selected" : ""}>${esc(item)}</option>`).join("");
  }

  function showToast(message) {
    clearTimeout(state.toastTimer);
    els.toast.textContent = message;
    els.toast.classList.add("show");
    state.toastTimer = setTimeout(() => els.toast.classList.remove("show"), 3600);
  }
})();
