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
    ["general", "Datos generales", "Nombre, clasificación y descripción"],
    ["questions", "Preguntas", "Editor tipo Google Forms"],
    ["audience", "Público", "A quién se dirige y si usa órdenes"],
    ["schedule", "Programación y envío", "Cada cuánto corre y cómo se manda"],
    ["review", "Revisión", "Verificar y publicar"],
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
    step: "general",
    activeSectionId: "",
    activeQuestionId: "",
    openQuestionId: "",
    selectedWorkId: "15281",
    openDoctor: "",
    openMenu: "",
    filtros: null,
    filtrosOpen: false,
    filtrosTrabajos: null,
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
      /* La bandeja se necesita desde el arranque: es la vista de quien
         no administra el módulo y el contador del tab de quien sí. */
      await cargarBandeja();
      if (esJefe()) await cargarMisResultados();
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
          <span class="dl-ico">⚙</span>${abierto ? "Ocultar filtros" : "Ver filtros"}
          ${cuenta ? `<span class="dl-filter-count">${cuenta}</span>` : ""}
          <span class="dl-chevron">⌄</span>
        </button>
        <button class="dl-filter-clear" type="button" data-act="limpiar-filtros" ${cuenta ? "" : "disabled"}>✕ Borrar filtros</button>
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
    state.step = "general";
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
      const inicio = { works: "work-list", lab: "employees", reports: "results-list" };
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
    state.view = view;
    state.module = view.startsWith("work")
      ? "works"
      : ["employees", "whatsapp"].includes(view)
        ? "lab"
        : "surveys";
    if (view !== "inbox") state.respondiendo = null;
    detenerPoll();
    try {
      if (view === "survey-list") {
        state.surveys = await DL.api.encuestas();
        cargarBandeja();
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
      if (view === "results-list") state.resultados = await DL.api.resultados();
      if (view === "inbox") await cargarBandeja();
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
        if (view === "editor-envios" && state.draft) state.instancias = await DL.api.instancias(state.draft.id);
        if (view === "answers") state.respuestas = await DL.api.respuestas(state.answersSurveyId || undefined);
        if (view === "whatsapp") state.mensajes = await DL.api.mensajes();
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
  const REQUIERE_GUARDADA = ["sends", "ejecutar-ahora", "probar-agenda", "generar", "enviar", "cerrar", "public-link", "mensaje-instancia"];

  async function runAction(act, arg, node) {
    const survey = state.draft;
    state.openMenu = "";

    if (state.esNueva && !arg && REQUIERE_GUARDADA.includes(act)) {
      showToast("Primero cree la encuesta o guárdela como borrador.");
      renderView();
      return;
    }

    try {
      switch (act) {
        case "create": {
          const plantilla = await DL.api.plantilla(arg);
          abrirBorrador(plantilla, true);
          state.view = "survey-edit";
          state.step = "general";
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

        case "crear-encuesta":
        case "crear-y-enviar": {
          if (!survey) return;
          const faltan = checklist().filter((item) => !item[1]).map((item) => item[0]);
          if (faltan.length) {
            state.step = "review";
            renderApp();
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
          state.step = node && node.dataset.target ? node.dataset.target : "general";
          renderApp();
          return;
        }

        case "sends": {
          if (arg) abrirBorrador(await DL.api.encuesta(arg));
          state.instancias = await DL.api.instancias(state.draft.id);
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
          if (arg === "respuestas") state.respuestas = await DL.api.respuestas(survey.id);
          if (arg === "envios") state.instancias = await DL.api.instancias(survey.id);
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
          renderView();
          showToast(`${state.instancias.length} encuesta(s) generada(s), una por doctor.`);
          return;

        case "enviar": {
          showToast("Enviando por WhatsApp…");
          const salida = await DL.api.enviar(survey.id);
          state.instancias = await DL.api.instancias(survey.id);
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

        case "ejecutar-ahora": {
          showToast("Ejecutando el JOB…");
          const salida = await DL.api.ejecutar(survey.id);
          state.instancias = await DL.api.instancias(survey.id);
          state.surveys = await DL.api.encuestas();
          renderView();
          showToast(`JOB ejecutado: ${salida.instancias} encuesta(s), ${salida.envios.length} envío(s).`);
          return;
        }

        case "probar-agenda": {
          const input = document.getElementById("minutosPrueba");
          const minutos = Number(input ? input.value : 2) || 2;
          const salida = await DL.api.programarPrueba(survey.id, minutos);
          state.surveys = await DL.api.encuestas();
          renderView();
          showToast(`Programado: el JOB correrá solo a las ${new Date(salida.cuando).toLocaleTimeString("es-GT", { hour12: false })}.`);
          return;
        }

        case "cerrar-ventana": {
          const salida = await DL.api.cerrar(survey.id);
          state.instancias = await DL.api.instancias(survey.id);
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
      if (target.checked) state.openDoctor = doctor;
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
      /* La vista previa y el enlace público no cambian nada: siguen activos */
      if (boton.dataset.act === "preview" || boton.dataset.act === "public-link") return;
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
        .map(([id, label]) => `<button class="module-tab ${state.module === id ? "active" : ""}" type="button" data-module="${id}">▨ ${label}</button>`)
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
    return `<button class="wa-chip ${clase}" id="waChip" type="button" data-view="whatsapp" title="Ver estado de WhatsApp">● ${esc(texto)}</button>`;
  }

  function renderSidebar() {
    if (state.module === "works") {
      els.sidebar.innerHTML = `
        <div class="side-title">TRABAJOS</div>
        <div class="side-search"><input placeholder="Código (ej: 15281)"></div>
        <button class="side-link active" type="button" data-view="work-list">▧ Trabajos</button>`;
      return;
    }

    /* En Laboratorio va el personal y el estado de WhatsApp */
    if (state.module === "lab") {
      els.sidebar.innerHTML = `
        <div class="side-title">LABORATORIO</div>
        <button class="side-link ${state.view === "employees" ? "active" : ""}" type="button" data-view="employees">▧ Empleados</button>
        <button class="side-link ${state.view === "whatsapp" ? "active" : ""}" type="button" data-view="whatsapp">◱ WhatsApp</button>`;
      return;
    }

    /* El colaborador solo tiene su bandeja; el jefe además sus resultados */
    if (!esAdmin()) {
      els.sidebar.innerHTML = `
        <div class="side-title">ENCUESTAS</div>
        <button class="side-link ${state.view === "inbox" ? "active" : ""}" type="button" data-view="inbox">✎ Bandeja de encuestas</button>
        ${esJefe() ? `<button class="side-link ${state.view === "my-results" ? "active" : ""}" type="button" data-view="my-results">✓ Mis resultados</button>` : ""}`;
      return;
    }

    els.sidebar.innerHTML = `
      <div class="side-title">ENCUESTAS</div>
      <button class="side-link ${["survey-list", "survey-edit"].includes(state.view) ? "active" : ""}" type="button" data-view="survey-list">▧ Encuestas</button>
      ${/* La bandeja vive en su pestaña; aquí solo aparece cuando ya se entró en ella */ ""}
      ${["inbox", "my-results"].includes(state.view)
        ? `<button class="side-link ${state.view === "inbox" ? "active" : ""}" type="button" data-view="inbox">✎ Bandeja de encuestas</button>
           ${esJefe() ? `<button class="side-link ${state.view === "my-results" ? "active" : ""}" type="button" data-view="my-results">✓ Mis resultados</button>` : ""}`
        : ""}
      <button class="side-link ${["results-list", "result-detail"].includes(state.view) ? "active" : ""}" type="button" data-view="results-list">✓ Resultados de encuestas</button>
      <div class="side-foot"><button class="mini-btn" type="button" data-act="reset-demo">↺ Restaurar demo</button></div>`;
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
    };
    if (["survey-edit"].includes(state.view) && !state.draft) state.view = "survey-list";
    if (state.view === "sends" && !state.draft) {
      els.appView.innerHTML = renderSendsPicker();
      return;
    }
    /* Quien no administra el módulo solo entra a su bandeja y sus resultados */
    const permitidas = esJefe() ? ["inbox", "my-results", "result-detail"] : ["inbox"];
    if (!esAdmin() && !permitidas.includes(state.view)) state.view = "inbox";

    els.appView.innerHTML = (vistas[state.view] || (esAdmin() ? renderSurveyList : renderBandejaInterna))();
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
     ENCUESTAS · Mis resultados (jefes de área)
     ================================================================== */
  async function cargarMisResultados() {
    if (!sesion) return;
    try {
      const datos = await DL.api.portalBandeja(sesion.id);
      state.misResultados = datos.resultados || [];
    } catch (error) {
      state.misResultados = [];
    }
  }

  function renderMisResultados() {
    const list = state.misResultados || [];

    return `
      <div class="dl-tabs">
        <div class="dl-tabs-list">${tabsEncuestas("my-results", state.surveys.length || null)}</div>
      </div>

      ${list.length === 0
        ? `<section class="dl-card">
             <div class="dl-table-wrap">
               <table class="dl-table"><tbody><tr><td colspan="7">Todavía no hay resultados de su equipo.</td></tr></tbody></table>
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
                       <td class="dl-col-opts"><button class="dl-mini" type="button" data-act="result-detail" data-arg="${esc(r.id)}">◎ Ver detalle</button></td>
                     </tr>`).join("")}
                 </tbody>
               </table>
             </div>
             <div class="dl-table-foot"><span>${list.length} período(s) · respuestas anónimas</span></div>
           </section>`}`;
  }

  /* ==================================================================
     ENCUESTAS · Bandeja de quien está usando el sistema
     Aquí responde su propia encuesta interna, sin salir del módulo.
     ================================================================== */
  async function cargarBandeja() {
    if (!sesion) return;
    try {
      const datos = await DL.api.portalBandeja(sesion.id);
      state.bandeja = datos.bandeja || [];
    } catch (error) {
      state.bandeja = [];
    }
  }

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
                    <td class="dl-col-opts"><button class="dl-mini" type="button" data-act="responder-bandeja" data-arg="${attr(item.instanceId)}">✎ Responder</button></td>
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
          <button class="dl-tab-action" type="button" data-act="cerrar-respuesta">← Volver a mi bandeja</button>
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

  /* Los dos tabs del módulo: la configuración y la bandeja de quien entró */
  function tabsEncuestas(vista, total) {
    const pendientes = (state.bandeja || []).filter((i) => !i.respondida).length;
    return `
      ${esAdmin() ? `<button class="dl-tab ${vista === "survey-list" ? "is-active" : ""}" type="button" data-view="survey-list">Encuestas${total != null ? ` (${total})` : ""}</button>` : ""}
      <button class="dl-tab ${vista === "inbox" ? "is-active" : ""}" type="button" data-view="inbox">Bandeja de encuestas${pendientes ? ` <i class="dl-pend">${pendientes}</i>` : ""}</button>
      ${esJefe() ? `<button class="dl-tab ${vista === "my-results" ? "is-active" : ""}" type="button" data-view="my-results">Mis resultados</button>` : ""}`;
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
            <button class="dl-tab-action dl-tab-action--primary" type="button" data-menu="nueva">＋ Nueva encuesta ▾</button>
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
                          <button class="dl-mini ${state.openMenu === "s-" + survey.id ? "on" : ""}" type="button" data-menu="s-${esc(survey.id)}">Opciones ▾</button>
                          ${state.openMenu === "s-" + survey.id ? `
                            <div class="menu-pop">
                              <button type="button" data-act="sends" data-arg="${esc(survey.id)}">✈ Envíos</button>
                              ${respondidas ? `<button type="button" data-act="answers-survey" data-arg="${esc(survey.id)}">✓ Respuestas (${respondidas})</button>` : ""}
                              <button type="button" data-act="toggle-status" data-arg="${esc(survey.id)}">${survey.status === "Activa" ? "✕ Desactivar" : "✓ Activar"}</button>
                              <button class="danger" type="button" data-act="delete" data-arg="${esc(survey.id)}">🗑 Eliminar</button>
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

    return `
      <div class="edit-shell ${editando ? "" : "modo-consulta"}">
        <div class="toolbar-strip editor-top">
          <div class="editor-tabs">
            ${EDITOR_TABS.map(([id, label]) => {
              const extra =
                id === "respuestas" ? (survey._respondidas ? `<i>${survey._respondidas}</i>` : "")
                  : id === "envios" ? (survey._instancias ? `<i>${survey._instancias}</i>` : "")
                    : "";
              return `<button class="editor-tab ${state.editorTab === id ? "is-active" : ""}" type="button" data-act="editor-tab" data-arg="${id}">${label}${extra}</button>`;
            }).join("")}
          </div>

          <div class="editor-acciones">
            ${editando
              ? `<span class="editor-modo">Modo edición</span>`
              : `<button class="mini-btn primary" type="button" data-act="editar-encuesta" title="Editar">✎ Editar</button>`}
            <button class="mini-btn" type="button" data-act="preview">◎ Vista previa</button>
            <button class="link-action" type="button" data-view="survey-list">← Regresar</button>
          </div>

          <div class="editor-id">
            <span class="badge ${isExternal() ? "pink" : "neutral"}">${esc(survey.classification.toUpperCase())}</span>
            <span class="editor-id-txt">
              <b id="editorTitle">${esc(survey.name)}</b>
              <small>${esc(survey.subtype)}</small>
            </span>
          </div>
        </div>

        ${cuerpo()}
      </div>`;
  }

  /* ---- Tab Respuestas: lo que contestaron en esta encuesta ---- */
  function cuerpoRespuestas() {
    const survey = draft();
    const lista = state.respuestas || [];
    const porInstancia = {};
    lista.forEach((r) => {
      porInstancia[r.instanceId] = porInstancia[r.instanceId] || { quien: r.doctor, period: r.period, fecha: r.finishedAt, items: [] };
      porInstancia[r.instanceId].items.push(r);
    });
    const grupos = Object.values(porInstancia);
    const notas = lista.filter((r) => r.calificacion).map((r) => r.calificacion);
    const promedio = notas.length ? (notas.reduce((a, b) => a + b, 0) / notas.length).toFixed(2) : "—";

    return `
      <section class="res-cards">
        <div class="res-card"><span>Encuestas completadas</span><b>${grupos.length}</b></div>
        <div class="res-card"><span>Respuestas</span><b>${lista.length}</b></div>
        <div class="res-card"><span>Con nota baja</span><b>${lista.filter((r) => r.calificacion && r.calificacion < 4).length}</b></div>
        <div class="res-card res-card--total"><span>Promedio</span><b>${esc(promedio)}</b><i>${notas.length ? "de las notas" : "sin notas"}</i></div>
      </section>

      <section class="dl-card">
        <div class="wk-block-head"><div><b>Respuestas de esta encuesta</b></div><span class="wk-count">${lista.length}</span></div>
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
    const survey = draft();
    const instancias = state.instancias || [];
    const conteo = DL.STATES.map((nombre) => [nombre, instancias.filter((item) => item.state === nombre).length]);
    const wa = (state.estado && state.estado.whatsapp) || {};
    const externa = isExternal();

    return `
      <div class="dercas-ribbon">
        <div>
          <b>${externa ? "Generación y envío por WhatsApp" : "Generación para los colaboradores"}</b>
          <span>${
            externa
              ? wa.conectado
                ? `Conectado como <b>+${esc(wa.numero)}</b>; los envíos de prueba llegan a <b>+${esc(state.estado.destino)}</b>.`
                : "WhatsApp no está conectado: los mensajes quedan en la bitácora."
              : "Cada colaborador la responde desde su Bandeja de encuestas."
          }</span>
        </div>
        <div class="ribbon-tags">
          <button class="btn primary" type="button" data-act="ejecutar-ahora">▶ Ejecutar ahora</button>
          <button class="btn" type="button" data-act="generar">Solo generar</button>
          ${externa ? `<button class="btn" type="button" data-act="enviar">✈ Enviar</button>` : ""}
          <button class="btn" type="button" data-act="cerrar-ventana">■ Cerrar ventana</button>
        </div>
      </div>

      <div class="area-result-grid states">
        ${conteo.map(([label, value]) => `<article><span>${esc(label)}</span><b>${value}</b></article>`).join("")}
      </div>

      <section class="dl-card">
        <div class="wk-block-head"><div><b>Envíos del período</b></div><span class="wk-count">${instancias.length}</span></div>
        <div class="dl-table-wrap">
          <table class="dl-table">
            <thead><tr>
              <th>${externa ? "Doctor" : "Colaborador"}</th><th>${externa ? "Clínica" : "Área"}</th>
              ${externa ? "<th>Trabajos</th>" : "<th>Evalúa a</th>"}
              <th>Estado</th><th>Generada</th><th>Enviada</th><th>Abierta</th><th>Completada</th><th class="dl-col-opts">Acciones</th>
            </tr></thead>
            <tbody>
              ${instancias.length === 0
                ? `<tr><td colspan="9">Aún no hay envíos. Pulse <b>▶ Ejecutar ahora</b>.</td></tr>`
                : instancias.map((item) => `
                    <tr>
                      <td><b>${esc(item.doctor)}</b> <i>${esc(item.periodLabel)}</i></td>
                      <td>${esc(item.clinic || "—")}</td>
                      <td>${externa ? item.workIds.length : esc(item.supervisor || "—")}</td>
                      <td><span class="dl-badge ${item.state === "Completada" ? "ok" : String(item.state).startsWith("Cerrada") ? "off" : "warn"}">${esc(item.state)}</span></td>
                      <td>${esc(item.generatedAt || "—")}</td>
                      <td>${esc(item.sentAt || "—")}</td>
                      <td>${esc(item.openedAt || "—")}</td>
                      <td>${esc(item.finishedAt || "—")}</td>
                      <td class="dl-col-opts">
                        <button class="dl-mini" type="button" data-act="open-instance" data-arg="${esc(item.id)}">↗ Abrir</button>
                        ${externa ? `<button class="dl-mini" type="button" data-act="ver-mensaje" data-arg="${esc(item.id)}">◱ Mensaje</button>` : ""}
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
    const body = { general: stepGeneral, audience: stepAudience, schedule: stepSchedule, questions: stepQuestions, review: stepReview }[state.step]();

    return `
      <ol class="wizard-steps">
        ${STEPS.map(([id, label], index) => `
          <li class="wizard-step ${state.step === id ? "active" : ""} ${index < stepIndex ? "done" : ""}">
            <button type="button" data-step="${id}">
              <span class="step-num">${index < stepIndex ? "✓" : index + 1}</span>
              <span class="step-text"><b>${label}</b></span>
            </button>
          </li>`).join("")}
      </ol>

      <div class="edit-body">${body}</div>

      ${state.editando ? `
        <div class="form-actions">
          <button class="dercas-btn ok" type="button" data-act="crear-encuesta">✓ ${state.esNueva ? "Crear encuesta" : "Guardar cambios"}</button>
          <button class="dercas-btn" type="button" data-act="guardar-borrador">↓ Guardar como borrador</button>
          ${isExternal() ? `<button class="dercas-btn" type="button" data-act="crear-y-enviar">➤ ${state.esNueva ? "Crear y enviar" : "Guardar y enviar"}</button>` : ""}
          <button class="dercas-btn cancel" type="button" data-act="cancelar">✕ Cancelar</button>
        </div>` : ""}`;
  }

  function stepGeneral() {
    const survey = draft();
    const external = isExternal();
    return `
      <section class="page-card">
        <h2 class="card-title"><span class="pink-icon">▧</span> Datos generales</h2>
        <div class="form-grid g4">
          <label class="field"><span>Nombre de la encuesta *</span><input data-survey-field="name" value="${attr(survey.name)}"></label>
          <label class="field"><span>Subcategoría</span><select data-survey-field="subtype">${options(external ? ["Servicio y Calidad", "Encuesta general", "Nuevos productos"] : ["Liderazgo", "Clima laboral", "Capacitación", "Eventos y actividades", "Encuesta general"], survey.subtype)}</select></label>
          <label class="field span2"><span>Descripción <small>lo que ve quien abre la encuesta</small></span><textarea rows="2" data-survey-field="description">${esc(survey.description)}</textarea></label>
          ${!external ? `
            <div class="field span4"><span>Sugerencias</span>
              <label class="switch-row"><input type="checkbox" data-survey-check="suggestions" ${survey.suggestions !== false ? "checked" : ""}> Comentario general al final de la encuesta.</label>
            </div>` : ""}
        </div>

        ${survey.works.enabled ? `
          <div class="periodo-box">
            <div class="periodo-head">
              <div><b>Período evaluado</b><span>Define qué órdenes entran en la encuesta.</span></div>
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
            <p class="tiny">Con este período hay <b>${elegibles().length}</b> orden(es) enviadas, de <b>${[...new Set(elegibles().map((w) => w.doctor))].length}</b> doctor(es).</p>
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
        <h2 class="card-title"><span class="pink-icon">▣</span> ¿Quiénes van a responder?</h2>
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
                              ? `<button class="dl-mini" type="button" data-act="quitar-resp" data-arg="${attr(persona.id)}" title="Quitar de la encuesta">🗑</button>`
                              : `<button class="dl-mini" type="button" data-act="devolver-resp" data-arg="${attr(persona.id)}" title="Volver a incluir">↺</button>`}
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
      works: eligible.filter((work) => work.doctor === doctor),
    }));

    return `
      <section class="page-card">
        <h2 class="card-title"><span class="pink-icon">▣</span> ¿A qué doctores se dirige?</h2>
        <div class="form-grid g4">
          <label class="field"><span>Asignación *</span>
            <select data-survey-field="audienceMode">${options(["Todos los doctores", "Selección manual"], survey.audienceMode)}</select>
            <small>${manual ? "Solo se enviará a los doctores y las órdenes que marque abajo." : "Se genera una encuesta por cada doctor con trabajos del período."}</small>
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
                          <span><b>${esc(grupo.doctor)}</b><small>${esc(grupo.clinic)}</small></span>
                        </label>`
                      : `<span class="doctor-name"><b>${esc(grupo.doctor)}</b><small>${esc(grupo.clinic)}</small></span>`}
                    <button class="mini-btn" type="button" data-act="toggle-doctor" data-arg="${attr(grupo.doctor)}">
                      ${manual ? `${suyas} de ${grupo.works.length} órdenes` : `${grupo.works.length} órdenes`} ${abierto ? "▴" : "▾"}
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
        <h2 class="card-title"><span class="pink-icon">▤</span> ¿Esta encuesta lleva órdenes de trabajo?</h2>
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
    const external = isExternal();
    const repite = survey.schedule.repeat !== "No repetir";
    const prueba = (state.surveys.find((item) => item.id === survey.id) || {})._prueba;

    return `
      <section class="page-card">
        <h2 class="card-title"><span class="pink-icon">▣</span> ¿Cada cuánto se ejecuta?</h2>
        <div class="form-grid g4">
          <label class="field"><span>Repetición *</span>
            <select data-sched-field="repeat">${options(["No repetir", "Mensual", "Trimestral", "Anual"], survey.schedule.repeat)}</select>
            <small>${
              survey.schedule.repeat === "No repetir"
                ? "Corre una sola vez, en la fecha y hora de inicio"
                : `${survey.schedule.repeat === "Mensual" ? "Todos los meses" : survey.schedule.repeat === "Trimestral" ? "Cada 3 meses" : "Una vez al año"} el día ${diaDeInicio(survey)} a las ${horaDeInicio(survey)}`
            }</small>
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
          <label class="field span2"><span>Próxima ejecución</span><input value="${attr(corridas(survey).proxima)}" readonly></label>
          <label class="field span2"><span>Última ejecución</span><input value="${attr(survey.schedule.lastRun || "—")}" readonly></label>
        </div>

        <div class="agenda-test">
          <div><b>${repite ? `Probar la agenda sin esperar al día ${diaDeInicio(survey)}` : "Probar la corrida sin esperar la fecha de inicio"}</b>
            <span>Programa una corrida real dentro de unos minutos: generará ${external ? "una encuesta por doctor" : "una encuesta por colaborador"}${survey.channel === "API WhatsApp" ? " y las enviará por WhatsApp" : " y dejará listo el enlace de cada persona"}.</span>
            ${prueba ? `<span class="next">Prueba programada para ${new Date(prueba).toLocaleTimeString("es-GT", { hour12: false })}</span>` : ""}
          </div>
          <div class="load-actions">
            <input id="minutosPrueba" type="number" min="1" max="60" value="2" style="width:70px">
            <span class="tiny">minutos</span>
            <button class="btn" type="button" data-act="probar-agenda">Programar prueba</button>
            <button class="btn primary" type="button" data-act="ejecutar-ahora">▶ Ejecutar ahora</button>
          </div>
        </div>
      </section>

      <section class="page-card">
        <h2 class="card-title"><span class="pink-icon">✈</span> Envío</h2>
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
      </section>`;
  }

  function mensajeArmado(survey) {
    const alcance = alcancePrevio();
    return String(survey.whatsappMessage || "")
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
          <div class="forms-dercas-strip">
            <span><b>Tipo:</b> ${esc(survey.classification)} / ${esc(survey.subtype)}</span>
            <span><b>Responde:</b> ${esc(survey.respondent)}</span>
            <span><b>Órdenes:</b> ${survey.works.enabled ? `${survey.works.selectedIds.length} cargadas` : "no utiliza"}</span>
            <span><b>Período:</b> ${esc(etiquetaPeriodo())}</span>
            <span><b>Preguntas:</b> ${survey.sections.reduce((total, seccion) => total + seccion.questions.length, 0)}</span>
          </div>

          <div class="editor-layout">
            <aside class="outline-rail">
              <div class="outline-head">Estructura</div>
              ${survey.sections
                .map(
                  (section, index) => `
                  <div class="outline-section ${state.activeSectionId === section.id ? "active" : ""}">
                    <button type="button" class="outline-sec-btn" data-act="focus-question" data-arg="${esc(section.questions[0].id)}">
                      <b>${index + 1}. ${esc(section.title)}</b>
                      <small>${section.questions.length} pregunta(s)${section.useWorks ? " · con órdenes" : ""}</small>
                    </button>
                    <div class="outline-questions">
                      ${section.questions
                        .map((question) => `<button type="button" class="outline-q ${state.activeQuestionId === question.id ? "active" : ""}" data-act="focus-question" data-arg="${esc(question.id)}" title="${attr(question.text)}">${esc(question.text)}</button>`)
                        .join("")}
                    </div>
                  </div>`
                )
                .join("")}
              <button class="outline-add" type="button" data-act="add-section">＋ Agregar categoría</button>
            </aside>
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
            <button class="text-btn" type="button" data-act="move-section" data-arg="${section.id}:up" ${index === 0 ? "disabled" : ""}>↑</button>
            <button class="text-btn" type="button" data-act="move-section" data-arg="${section.id}:down" ${index === total - 1 ? "disabled" : ""}>↓</button>
            <button class="text-btn danger" type="button" data-act="delete-section" data-arg="${section.id}">Eliminar categoría</button>
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
          <button class="mini-btn primary" type="button" data-act="add-question" data-arg="${section.id}">＋ Agregar pregunta</button>
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
      return `<div class="forms-card section-behavior compact-behavior"><b>Sin órdenes de trabajo</b><span>Las respuestas se registran como percepción general y se envían al área responsable de cada pregunta.</span></div>`;
    }
    return `
      <div class="forms-card section-behavior">
        <div class="behavior-head">
          <div><b>¿Esta categoría se evalúa sobre los trabajos?</b><span>Si la activa, antes de responder se le pregunta al doctor cómo desea evaluar.</span></div>
          <label class="switch-row"><input type="checkbox" data-section-check="useWorks" ${section.useWorks ? "checked" : ""}> Usar órdenes</label>
        </div>
        ${section.useWorks ? `
          <div class="mode-config compact">
            <div><b>¿Cómo podrá responder el doctor en “${esc(section.title)}”?</b><span>Si solo deja una, no verá la pantalla de elección.</span></div>
            <div class="mode-check-grid">
              ${["general", "mixed", "individual"].map((mode) => `
                <label class="mode-check ${(section.allowedModes || []).includes(mode) ? "selected" : ""}">
                  <input type="checkbox" data-section-mode="${mode}" ${(section.allowedModes || []).includes(mode) ? "checked" : ""}>
                  <span><b>${DL.MODE_LABELS[mode]}</b><small>${DL.MODE_HELP[mode]}</small></span>
                </label>`).join("")}
            </div>
          </div>
        ` : `<span class="tiny">Las preguntas de esta categoría se responden una sola vez, sin relacionarlas con una orden ni con una asesora.</span>`}
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
          <button class="text-btn" type="button" data-act="move-question" data-arg="${question.id}:up" ${index === 0 ? "disabled" : ""}>↑ Subir</button>
          <button class="text-btn" type="button" data-act="move-question" data-arg="${question.id}:down" ${index === total - 1 ? "disabled" : ""}>↓ Bajar</button>
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

  function stepReview() {
    const survey = draft();
    const items = checklist();
    const pending = items.filter(([, ok]) => !ok).length;
    const questions = survey.sections.flatMap((section) => section.questions);
    const byArea = {};
    questions.forEach((question) => (byArea[question.area] = (byArea[question.area] || 0) + 1));

    return `
      <section class="page-card">
        <h2 class="card-title"><span class="pink-icon">✓</span> Lista de verificación</h2>
        <div class="publish-check">${items.map(([label, ok]) => `<div class="${ok ? "ok" : "no"}"><span>${ok ? "✓" : "!"}</span>${esc(label)}</div>`).join("")}</div>
        ${pending ? `<p class="empty-note">Faltan ${pending} punto(s) por completar.</p>` : `<p class="ready-note">Todo listo. Ya puede crear la encuesta con el botón <b>Crear encuesta</b>.</p>`}
      </section>
      <section class="page-card">
        <h2 class="card-title">Resumen</h2>
        <div class="review-grid">
          <div><span>Clasificación</span><b>${esc(survey.classification)} · ${esc(survey.subtype)}</b></div>
          <div><span>Responde</span><b>${esc(isExternal() ? (survey.audienceMode === "Selección manual" ? `${(survey.audienceDoctors || []).length} doctor(es) seleccionados` : "Todos los doctores del período") : survey.respondent)}</b></div>
          <div><span>Canal</span><b>${esc(survey.channel)}</b></div>
          <div><span>Repetición</span><b>${esc(survey.schedule.repeat)}</b></div>
          <div><span>Próxima ejecución</span><b>${esc(survey.schedule.nextRun || "—")}</b></div>
          <div><span>Órdenes</span><b>${survey.works.enabled ? `${survey.works.selectedIds.length} cargadas` : "No utiliza"}</b></div>
          <div><span>Categorías</span><b>${survey.sections.length}</b></div>
          <div><span>Preguntas</span><b>${questions.length}</b></div>
        </div>
        <div class="area-map">
          <b>Distribución por área responsable</b>
          <div class="area-map-list">${Object.entries(byArea).map(([area, count]) => `<span><b>${count}</b> ${esc(area)}</span>`).join("")}</div>
        </div>
        <div class="review-actions">
          <button class="btn" type="button" data-act="preview">◎ Probar la encuesta</button>
          <button class="btn" type="button" data-act="public-link">↗ Abrir enlace público</button>
          <button class="btn primary" type="button" data-act="sends" data-arg="">✈ Ir a envíos</button>
        </div>
      </section>`;
  }

  /* ---------------- Envíos ---------------- */
  function renderSendsPicker() {
    return `
      <section class="page-card">
        <h2 class="card-title"><span class="pink-icon">✈</span> Envíos</h2>
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
          <button class="mini-btn" type="button" data-act="edit" data-arg="${esc(survey.id)}">✎ Editar</button>
          <button class="link-action" type="button" data-view="survey-list">← Regresar</button>
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
          <button class="btn primary" type="button" data-act="ejecutar-ahora">▶ Ejecutar ahora</button>
          <button class="btn" type="button" data-act="generar">Solo generar</button>
          <button class="btn" type="button" data-act="enviar">✈ Enviar</button>
          <button class="btn" type="button" data-act="cerrar-ventana">■ Cerrar ventana</button>
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
                          <button class="mini-btn primary" type="button" data-act="open-instance" data-arg="${esc(item.id)}">↗ Abrir enlace</button>
                          <button class="mini-btn" type="button" data-act="ver-mensaje" data-arg="${esc(item.id)}">◱ Mensaje</button>
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
          ${state.answersSurveyId ? `<button class="dl-tab-action" type="button" data-act="sends" data-arg="${esc(state.answersSurveyId)}">✈ Envíos</button>` : ""}
          <button class="dl-tab-action" type="button" data-view="survey-list">← Regresar</button>
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
                <h2 class="card-title"><span class="pink-icon">✓</span> ${esc(grupo.doctor)} <small>${esc(grupo.period)} · ${esc(grupo.fecha || "")}</small></h2>
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
              <span class="dl-ico">⚙</span>${state.filtrosTrabajosOpen ? "Ocultar filtros" : "Ver filtros"}
              ${cuenta ? `<span class="dl-filter-count">${cuenta}</span>` : ""}
              <span class="dl-chevron">⌄</span>
            </button>
            <button class="dl-filter-clear" type="button" data-act="limpiar-filtros-trabajo" ${cuenta ? "" : "disabled"}>✕ Borrar filtros</button>
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
                        <button class="dl-mini ${state.openMenu === "w-" + work.id ? "on" : ""}" type="button" data-menu="w-${esc(work.id)}">Opciones ▾</button>
                        ${state.openMenu === "w-" + work.id ? `
                          <div class="menu-pop">
                            <button type="button" data-act="work-detail" data-arg="${esc(work.id)}">▤ Ver trabajo</button>
                            <button type="button" data-act="survey-from-work" data-arg="${esc(work.id)}" ${eligible ? "" : "disabled"}>✚ Encuesta del doctor</button>
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
  function paginador(pagina, paginas) {
    if (paginas <= 1) return "";
    const boton = (etiqueta, destino, activa = false, apagada = false) =>
      `<button class="dl-page ${activa ? "is-active" : ""}" type="button" data-tra-pagina="${destino}" ${apagada ? "disabled" : ""}>${etiqueta}</button>`;

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
          <button class="dl-tab-action" type="button" data-view="whatsapp">◱ WhatsApp</button>
        </div>
      </div>

      <section class="dl-card">
        <div class="dl-filters">
          <div class="dl-toolbar">
            <button class="dl-filter-toggle ${state.filtrosEmpOpen ? "is-open" : ""}" type="button" data-act="toggle-filtros-emp">
              <span class="dl-ico">⚙</span>${state.filtrosEmpOpen ? "Ocultar filtros" : "Ver filtros"}
              ${cuenta ? `<span class="dl-filter-count">${cuenta}</span>` : ""}
              <span class="dl-chevron">⌄</span>
            </button>
            <button class="dl-filter-clear" type="button" data-act="limpiar-filtros-emp" ${cuenta ? "" : "disabled"}>✕ Borrar filtros</button>
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
        <button class="emp-back" type="button" data-view="employees">← Regresar</button>
        <h1>${esc(persona.name)}</h1>
        <span class="dl-badge ${persona.active ? "ok" : "off"}">${persona.active ? "Activo" : "Inactivo"}</span>
        <span class="emp-head-role">${esc(persona.position)} · ${esc(persona.area)}</span>
        <button class="emp-edit" type="button" data-act="emp-editar" title="Editar">✎</button>
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

  function renderResultadosLista() {
    const list = state.resultados;
    const delMotor = list.filter((r) => r.origen === "Motor de encuestas").length;

    return `
      <div class="dl-tabs">
        <div class="dl-tabs-list">
          <button class="dl-tab is-active" type="button">Resultados de encuestas (${list.length})</button>
        </div>
        <div class="dl-tabs-actions">
          <button class="dl-tab-action" type="button" data-view="survey-list">▧ Encuestas</button>
        </div>
      </div>

      <div class="dercas-ribbon">
        <div><b>Períodos evaluados</b><span>Los resultados que ya venían del sistema anterior y los que va generando este motor, en una sola tabla.</span></div>
        <div class="ribbon-tags"><span class="badge neutral">${list.length - delMotor} del sistema anterior</span><span class="badge pink">${delMotor} de este motor</span></div>
      </div>

      <section class="dl-card">
        <div class="dl-table-wrap">
          <table class="dl-table">
            <thead><tr>
              <th>Encuesta</th><th>Supervisor</th><th>Período</th><th>Área</th>
              <th>Asignadas</th><th>Respuestas</th><th>Promedio</th><th>Origen</th><th class="dl-col-opts">Acción</th>
            </tr></thead>
            <tbody>
              ${list.length === 0 ? `<tr><td colspan="9">Todavía no hay períodos evaluados.</td></tr>` : list.map((r) => `
                <tr class="dl-row-link" data-row-open="result-detail" data-row-arg="${esc(r.id)}" title="Ver el detalle">
                  <td><b>${esc(r.surveyName)}</b></td>
                  <td>${esc(r.supervisor || "—")}</td>
                  <td>${esc(r.periodLabel)}</td>
                  <td>${esc(r.area)}</td>
                  <td><span class="dl-badge">${r.asignadas}</span></td>
                  <td><span class="dl-badge ${r.respuestas ? "ok" : "off"}">${r.respuestas}</span></td>
                  <td><b class="${r.escala === "Regular" ? "wk-bad" : "wk-good"}">${esc(r.promedio)}</b> <i>${esc(r.escala)}</i></td>
                  <td><span class="dl-badge ${r.origen === "Motor de encuestas" ? "pink" : "off"}">${esc(r.origen)}</span></td>
                  <td class="dl-col-opts"><button class="dl-mini" type="button" data-act="result-detail" data-arg="${esc(r.id)}">◎ Ver detalle</button></td>
                </tr>`).join("")}
            </tbody>
          </table>
        </div>
        <div class="dl-table-foot"><span>${list.length} registro(s)</span></div>
      </section>`;
  }

  function renderResultadoDetalle() {
    const r = state.resultado;
    if (!r) return `<p class="cargando">Cargando el detalle…</p>`;

    return `
      <div class="dl-tabs">
        <div class="dl-tabs-list">
          <button class="dl-tab is-active" type="button">Detalle</button>
        </div>
        <div class="dl-tabs-actions">
          <button class="dl-tab-action" type="button" data-view="${state.volverA || "results-list"}">← Regresar</button>
        </div>
      </div>

      <section class="res-cards">
        <div class="res-card"><span>Supervisor evaluado</span><b>${esc(r.supervisor || "—")}</b></div>
        <div class="res-card"><span>Asignados</span><b>${r.asignadas}</b></div>
        <div class="res-card"><span>Respondieron</span><b>${r.respuestas}</b></div>
        <div class="res-card res-card--total"><span>Resultado total</span><b>${esc(r.promedio)}</b><i>${esc(r.escala)}</i></div>
      </section>

      <section class="dl-card">
        <div class="wk-block-head">
          <div><b>${esc(r.surveyName)}</b><span>${esc(r.periodLabel)} · ${esc(r.area)} · ${esc(r.origen)}</span></div>
          <span class="dl-badge ${r.origen === "Motor de encuestas" ? "pink" : "off"}">${esc(r.origen)}</span>
        </div>
        <div class="dl-table-wrap">
          <table class="dl-table">
            <thead><tr><th>Colaborador</th><th>Puesto</th><th>Correo</th><th>Estado</th><th>Promedio</th><th>Respuestas</th></tr></thead>
            <tbody>
              ${(r.colaboradores || []).map((c) => `
                <tr>
                  <td><b>${esc(c.name)}</b></td>
                  <td>${esc(c.position || "—")}</td>
                  <td>${esc(c.email || "—")}</td>
                  <td><span class="dl-badge ${c.estado === "Respondida" ? "ok" : "warn"}">${esc(c.estado)}</span></td>
                  <td>${c.promedio === "—" ? "—" : `<span class="dl-badge ${Number(c.promedio) >= 4 ? "ok" : "bad"}">★ ${esc(c.promedio)}</span>`}</td>
                  <td>${c.respuestas}</td>
                </tr>`).join("")}
            </tbody>
          </table>
        </div>
      </section>

      <section class="dl-card">
        <div class="wk-block-head"><div><b>Promedio por pregunta</b><span>Así respondió el equipo cada punto de la encuesta.</span></div></div>
        <div class="dl-table-wrap">
          <table class="dl-table">
            <thead><tr><th>Pregunta</th><th>Promedio</th><th>Respuestas</th></tr></thead>
            <tbody>
              ${(r.preguntas || []).map((q, i) => `
                <tr>
                  <td class="wk-comment"><b>${i + 1}.</b> ${esc(q.texto)}</td>
                  <td><b class="${Number(q.promedio) < 4 ? "wk-bad" : "wk-good"}">${esc(q.promedio)}</b></td>
                  <td>${q.respuestas}</td>
                </tr>`).join("")}
            </tbody>
          </table>
        </div>
      </section>

      ${(r.comentarios || []).length ? `
        <section class="dl-card">
          <div class="wk-block-head"><div><b>Comentarios generales</b><span>Tal como los escribió el personal. Las encuestas internas son anónimas.</span></div></div>
          <div class="res-comments">
            ${r.comentarios.map((texto, i) => `<div class="res-comment"><span>COMENTARIO ${i + 1}</span><p>${esc(texto)}</p></div>`).join("")}
          </div>
        </section>` : ""}`;
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
          <button class="dl-tab-action" type="button" data-act="survey-from-work" data-arg="${esc(work.id)}" ${eligible ? "" : "disabled"}>✚ Encuesta del doctor</button>
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
          <button class="simulator-btn" type="button" data-act="preview-reset">↺ Reiniciar</button>
          <button class="simulator-btn" type="button" data-act="public-link">↗ Abrir en pestaña</button>
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
