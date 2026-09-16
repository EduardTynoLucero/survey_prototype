/* =====================================================================
   MOTOR DE ENCUESTAS - Digital Labs
   Nucleo compartido entre el sistema privado (editor) y la vista publica.
   El mismo codigo que dibuja la vista previa dibuja la encuesta real.
   Los datos viven en el servidor (server/), no en el navegador.
   ===================================================================== */
(() => {
  "use strict";

  const DL = (window.DL = window.DL || {});

  /* ------------------------------------------------------------------
     Utilidades
     ------------------------------------------------------------------ */
  const esc = (value) =>
    String(value ?? "").replace(/[&<>"']/g, (char) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;",
    }[char]));

  const attr = (value) => esc(value).replace(/`/g, "&#096;");
  const uid = (prefix) => `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const clone = (value) => JSON.parse(JSON.stringify(value));

  DL.esc = esc;
  DL.attr = attr;
  DL.uid = uid;
  DL.clone = clone;

  /* ------------------------------------------------------------------
     Cliente de la API
     ------------------------------------------------------------------ */
  async function pedir(metodo, ruta, cuerpo) {
    const opciones = { method: metodo, headers: { "Content-Type": "application/json" } };
    if (cuerpo !== undefined) opciones.body = JSON.stringify(cuerpo);
    const respuesta = await fetch(ruta, opciones);
    const texto = await respuesta.text();
    let datos = null;
    try {
      datos = texto ? JSON.parse(texto) : null;
    } catch (error) {
      datos = { error: texto };
    }
    if (!respuesta.ok) {
      const mensaje = (datos && datos.error) || `Error ${respuesta.status}`;
      const fallo = new Error(mensaje);
      fallo.datos = datos;
      throw fallo;
    }
    return datos;
  }

  DL.api = {
    estado: () => pedir("GET", "/api/estado"),
    trabajos: () => pedir("GET", "/api/trabajos"),
    empleados: () => pedir("GET", "/api/empleados"),
    empleado: (id) => pedir("GET", `/api/empleados/${encodeURIComponent(id)}`),
    catalogos: () => pedir("GET", "/api/catalogos"),
    respondedores: (area, modo) =>
      pedir("GET", `/api/respondedores?area=${encodeURIComponent(area)}&modo=${encodeURIComponent(modo || "Por supervisor")}`),
    resultados: () => pedir("GET", "/api/resultados"),
    resultado: (id) => pedir("GET", `/api/resultados/${encodeURIComponent(id)}`),
    portalLogin: (correo) => pedir("POST", "/api/portal/login", { correo }),
    portalPersonal: () => pedir("GET", "/api/portal/personal"),
    portalBandeja: (id) => pedir("GET", `/api/portal/${encodeURIComponent(id)}/bandeja`),
    encuestasDeTrabajo: (id) => pedir("GET", `/api/trabajos/${encodeURIComponent(id)}/encuesta`),
    mensajes: () => pedir("GET", "/api/mensajes"),
    reiniciar: () => pedir("POST", "/api/reiniciar"),

    encuestas: () => pedir("GET", "/api/encuestas"),
    encuesta: (id) => pedir("GET", `/api/encuestas/${id}`),
    plantilla: (classification) => pedir("POST", "/api/plantilla", { classification }),
    crearEncuesta: (classification) => pedir("POST", "/api/encuestas", { classification }),
    crearDesdeBorrador: (encuesta) => pedir("POST", "/api/encuestas", encuesta),
    guardarEncuesta: (encuesta) => pedir("PUT", `/api/encuestas/${encuesta.id}`, encuesta),
    borrarEncuesta: (id) => pedir("DELETE", `/api/encuestas/${id}`),
    duplicarEncuesta: (id) => pedir("POST", `/api/encuestas/${id}/duplicar`),

    generar: (id) => pedir("POST", `/api/encuestas/${id}/generar`),
    enviar: (id) => pedir("POST", `/api/encuestas/${id}/enviar`),
    ejecutar: (id) => pedir("POST", `/api/encuestas/${id}/ejecutar`),
    completar: (id) => pedir("POST", `/api/encuestas/${id}/completar`),
    recordar: (id) => pedir("POST", `/api/encuestas/${id}/recordar`),
    cerrar: (id) => pedir("POST", `/api/encuestas/${id}/cerrar`),
    programarPrueba: (id, minutos) => pedir("POST", `/api/encuestas/${id}/prueba`, { minutos }),
    instancias: (id) => pedir("GET", `/api/encuestas/${id}/instancias`),
    respuestas: (id) => pedir("GET", id ? `/api/encuestas/${id}/respuestas` : "/api/respuestas"),
    mensajeDe: (id) => pedir("GET", `/api/encuestas/${id}/mensaje`),

    instancia: (id) => pedir("GET", `/api/instancias/${id}`),
    abrirInstancia: (id) => pedir("POST", `/api/instancias/${id}/abrir`),
    responder: (id, respuestas) => pedir("POST", `/api/instancias/${id}/responder`, { respuestas }),
    mensajeInstancia: (id) => pedir("GET", `/api/instancias/${id}/mensaje`),

    pruebaWhatsapp: (texto) => pedir("POST", "/api/whatsapp/prueba", { texto }),
    conectarWhatsapp: () => pedir("POST", "/api/whatsapp/conectar"),
    salirWhatsapp: () => pedir("POST", "/api/whatsapp/salir"),
  };

  /* ------------------------------------------------------------------
     Catalogos
     ------------------------------------------------------------------ */
  DL.AREAS = [
    "Control de Calidad",
    "Servicio al Cliente",
    "Control de Producción",
    "Mensajería",
    "Recursos Humanos",
    "Administración",
    "Gerencia",
  ];

  DL.QUESTION_TYPES = {
    stars: "Estrellas 1 a 5",
    single: "Opción múltiple",
    multiple: "Casillas",
    short: "Respuesta corta",
    paragraph: "Párrafo",
  };

  DL.WORK_MODES = {
    none: "Sin trabajos (percepción general)",
    inherit: "Usar la modalidad que elija el doctor",
    allWorks: "Siempre una nota para todos",
    individual: "Siempre trabajo por trabajo",
  };

  DL.MODE_LABELS = { general: "General", mixed: "Mixta", individual: "Individual" };

  DL.MODE_HELP = {
    general: "Una sola calificación se aplica a todos los trabajos del período.",
    mixed: "Agrupa los trabajos que comparten una nota y el resto se evalúa uno por uno.",
    individual: "Cada trabajo se evalúa por separado con sus propias estrellas y comentarios.",
  };

  DL.STATES = ["Generada", "Enviada", "Abierta", "Parcial", "Completada", "Cerrada sin respuesta", "Cerrada parcial"];

  /* Telefono del doctor con formato legible. Hoy es un dato de muestra:
     cuando el ETL lo entregue, llega igual en work.doctorPhone. */
  DL.telefono = (numero) => {
    const d = String(numero || "").replace(/\D/g, "");
    return d.length === 8 ? `${d.slice(0, 4)} ${d.slice(4)}` : d || "—";
  };

  /* Trabajos cargados desde el servidor */
  DL.WORKS = [];
  DL.findWorks = (ids) => DL.WORKS.filter((work) => (ids || []).includes(work.id));

  /* "DD/MM/YYYY" -> "YYYY-MM-DD", para comparar fechas como texto */
  DL.aISO = (fecha) => {
    if (!fecha || !String(fecha).includes("/")) return "";
    const [dia, mes, anio] = String(fecha).split("/");
    return `${anio}-${mes}-${dia}`;
  };

  /* Mes calendario anterior, para el botón rápido "del período" */
  (function periodoAnterior() {
    const hoy = new Date();
    const d = new Date(hoy.getFullYear(), hoy.getMonth() - 1, 1);
    const anio = d.getFullYear();
    const mes = String(d.getMonth() + 1).padStart(2, "0");
    const ultimo = String(new Date(anio, d.getMonth() + 1, 0).getDate()).padStart(2, "0");
    DL.PERIODO_DESDE = `${anio}-${mes}-01`;
    DL.PERIODO_HASTA = `${anio}-${mes}-${ultimo}`;
  })();

  DL.enRango = (work, desde, hasta) => {
    if (!desde && !hasta) return true;
    const fecha = DL.aISO(work.sent);
    if (!fecha) return false;
    if (desde && fecha < desde) return false;
    if (hasta && fecha > hasta) return false;
    return true;
  };

  DL.eligibleWorks = (statuses, desde, hasta) =>
    DL.WORKS.filter((work) => (statuses || ["enviado"]).includes(work.status) && DL.enRango(work, desde, hasta));

  DL.worksByDoctor = (doctor, statuses, desde, hasta) =>
    DL.eligibleWorks(statuses, desde, hasta).filter((work) => work.doctor === doctor);

  DL.cargarTrabajos = async () => {
    DL.WORKS = await DL.api.trabajos();
    return DL.WORKS;
  };

  /* ------------------------------------------------------------------
     Fabricas para el editor
     ------------------------------------------------------------------ */
  DL.createQuestion = (overrides = {}) =>
    Object.assign(
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
        linkLowRatingToWorks: true,
        lowPrompt: "¿Qué considera que podemos mejorar?",
        improvementOptions: ["Comunicación", "Tiempo", "Proceso", "Resultado", "Otro"],
        highOptionsOptional: true,
        highCommentOptional: true,
        highPrompt: "¿Qué es lo que más valora de nuestro servicio?",
        valueOptions: ["Rapidez", "Claridad", "Atención", "Resultado", "Otro"],
      },
      overrides
    );

  DL.createSection = (overrides = {}) =>
    Object.assign(
      {
        id: uid("sec"),
        title: "Nueva categoría",
        description: "Descripción de la categoría.",
        active: true,
        useWorks: false,
        allowedModes: [],
        allowCaseDimensions: false,
        next: "continue",
        questions: [DL.createQuestion()],
      },
      overrides
    );

  /* ------------------------------------------------------------------
     Construccion del flujo
     ------------------------------------------------------------------ */
  const activeSections = (survey) => (survey.sections || []).filter((section) => section.active !== false);
  const activeQuestions = (section) => (section.questions || []).filter((question) => question.active !== false);
  const usesWorks = (survey, section) => Boolean(survey.works && survey.works.enabled && section.useWorks);

  DL.sectionModes = (section) => {
    const modes = (section.allowedModes || []).filter((mode) => DL.MODE_LABELS[mode]);
    return modes.length ? modes : ["general"];
  };

  function effectiveWorkMode(question, sectionMode) {
    if (question.workMode === "inherit") return sectionMode;
    if (question.workMode === "allWorks") return "general";
    if (question.workMode === "individual") return "individual";
    return "none";
  }

  DL.buildFlow = function buildFlow(survey, state, works) {
    const flow = [];
    const all = works || [];

    if (survey.showIntro !== false) flow.push({ kind: "intro" });

    activeSections(survey).forEach((section) => {
      const questions = activeQuestions(section);
      if (!questions.length) return;

      const conTrabajos = usesWorks(survey, section) && all.length > 0;
      const modes = conTrabajos ? DL.sectionModes(section) : [];
      const chosen = state.modes[section.id] || modes[0] || "general";

      if (conTrabajos && modes.length > 1) {
        flow.push({ kind: "mode", sectionId: section.id, modes });
      }

      const generales = [];
      const conOrden = [];
      questions.forEach((question) => {
        const mode = conTrabajos ? effectiveWorkMode(question, chosen) : "none";
        if (mode === "none") generales.push(question);
        else conOrden.push({ question, mode });
      });

      generales.forEach((question) => {
        flow.push({ kind: "question", sectionId: section.id, questionId: question.id, level: "general", workIds: [] });
      });

      if (!conOrden.length) return;

      if (chosen === "mixed") {
        flow.push({ kind: "mixed", sectionId: section.id });
        const selected = state.mixed[section.id] || [];
        const pending = all.filter((work) => !selected.includes(work.id)).map((work) => work.id);

        if (selected.length) {
          conOrden
            .filter((item) => item.mode !== "individual")
            .forEach((item) => {
              flow.push({
                kind: "question",
                sectionId: section.id,
                questionId: item.question.id,
                level: "group",
                workIds: selected.slice(),
              });
            });
        }
        pending.forEach((workId) => {
          flow.push({
            kind: "work",
            sectionId: section.id,
            workId,
            questionIds: conOrden.map((item) => item.question.id),
          });
        });
        return;
      }

      if (chosen === "individual") {
        all.forEach((work) => {
          flow.push({
            kind: "work",
            sectionId: section.id,
            workId: work.id,
            questionIds: conOrden.map((item) => item.question.id),
          });
        });
        return;
      }

      conOrden.forEach((item) => {
        if (item.mode === "individual") {
          all.forEach((work) => {
            flow.push({ kind: "work", sectionId: section.id, workId: work.id, questionIds: [item.question.id] });
          });
          return;
        }
        flow.push({
          kind: "question",
          sectionId: section.id,
          questionId: item.question.id,
          level: "general",
          workIds: all.map((work) => work.id),
        });
      });
    });

    flow.push({ kind: "review" });
    return flow;
  };

  /* ------------------------------------------------------------------
     Runtime
     ------------------------------------------------------------------ */
  DL.createRuntime = function createRuntime(config) {
    const mount = config.mount;
    const survey = config.survey;
    const works = config.works || [];
    const onFinish = config.onFinish || (async () => {});
    const onOpen = config.onOpen || (() => {});
    const compact = Boolean(config.compact);

    const state = {
      index: 0,
      modes: {},
      mixed: {},
      dimensions: {},
      answers: {},
      error: "",
      finished: false,
      sending: false,
      opened: false,
    };

    const findSection = (id) => survey.sections.find((section) => section.id === id);
    const findQuestion = (id) => {
      for (const section of survey.sections) {
        const question = section.questions.find((item) => item.id === id);
        if (question) return question;
      }
      return null;
    };
    const findWork = (id) => works.find((work) => work.id === id);
    const worksByIds = (ids) => works.filter((work) => (ids || []).includes(work.id));

    function answerKey(questionId, level, workId) {
      return `${questionId}::${level}::${workId || "-"}`;
    }

    function getAnswer(questionId, level, workId, workIds) {
      const key = answerKey(questionId, level, workId);
      if (!state.answers[key]) {
        const question = findQuestion(questionId);
        state.answers[key] = {
          key,
          questionId,
          questionText: question ? question.text : "",
          area: question ? question.area : "",
          level,
          rating: 0,
          value: "",
          values: [],
          tags: [],
          comment: "",
          workIds: workIds || (workId ? [workId] : []),
        };
      } else if (workIds) {
        state.answers[key].workIds = workIds;
      }
      return state.answers[key];
    }

    const flow = () => DL.buildFlow(survey, state, works);
    const isLow = (question, rating) => rating > 0 && rating < (question.lowThreshold || 4);

    /* ---------- validacion ---------- */
    function validateQuestion(question, answer, allowSkip) {
      if (allowSkip) return "";
      if (question.type === "stars") {
        if (!answer.rating) return question.required ? `Seleccione una calificación en “${question.text}”.` : "";
        if (isLow(question, answer.rating)) {
          if (question.lowOptionsRequired && !answer.tags.length) return "Seleccione al menos un motivo de mejora.";
          if (question.lowCommentRequired && !answer.comment.trim())
            return "El comentario es obligatorio cuando la calificación es menor a 4 estrellas.";
        }
        return "";
      }
      if (!question.required) return "";
      if (question.type === "multiple") return answer.values.length ? "" : `Seleccione al menos una opción en “${question.text}”.`;
      return String(answer.value || "").trim() ? "" : `Complete la respuesta de “${question.text}”.`;
    }

    function validateScreen(screen) {
      if (screen.kind === "mode") return state.modes[screen.sectionId] ? "" : "Seleccione cómo desea evaluar sus trabajos.";
      if (screen.kind === "mixed") {
        const selected = state.mixed[screen.sectionId] || [];
        return selected.length ? "" : "Seleccione al menos un trabajo para la calificación compartida.";
      }
      if (screen.kind === "question") {
        const question = findQuestion(screen.questionId);
        return validateQuestion(question, getAnswer(question.id, screen.level, null, screen.workIds));
      }
      if (screen.kind === "work") {
        const section = findSection(screen.sectionId);
        const picked = state.dimensions[`${screen.sectionId}::${screen.workId}`];
        if (section.allowCaseDimensions && picked && !picked.length) {
          return `Orden #${screen.workId}: seleccione al menos una dimensión a evaluar.`;
        }
        for (const questionId of screen.questionIds) {
          const question = findQuestion(questionId);
          const skip = section.allowCaseDimensions && picked && !picked.includes(questionId);
          const message = validateQuestion(question, getAnswer(questionId, "work", screen.workId), skip);
          if (message) return `Orden #${screen.workId}: ${message}`;
        }
      }
      return "";
    }

    function firstInvalid() {
      const screens = flow();
      for (let index = 0; index < screens.length; index += 1) {
        const message = validateScreen(screens[index]);
        if (message) return { index, message };
      }
      return null;
    }

    /* ---------- render ---------- */
    const ETIQUETAS = ["Muy insatisfecho", "Insatisfecho", "Regular", "Satisfecho", "Muy satisfecho"];

    function starsHtml(answer) {
      return `<div class="stars">${[1, 2, 3, 4, 5]
        .map(
          (rating) =>
            `<button type="button" class="${answer.rating >= rating ? "sel" : ""}" data-star="${rating}" aria-label="${rating} estrellas">★</button>`
        )
        .join("")}${answer.rating ? `<small class="stars-hint">${esc(ETIQUETAS[answer.rating - 1])}</small>` : ""}</div>`;
    }

    function chipsHtml(options, selected) {
      return `<div class="chips">${options
        .map(
          (option) =>
            `<label class="${selected.includes(option) ? "on" : ""}"><input type="checkbox" data-tag="${attr(option)}" ${
              selected.includes(option) ? "checked" : ""
            }> ${esc(option)}</label>`
        )
        .join("")}</div>`;
    }

    function worksTable(list, title) {
      if (!list.length) return "";
      return `<div class="work-list"><b>${esc(title)}</b>${list
        .map(
          (work) =>
            `<div class="work-row"><span>Orden #${esc(work.code)}</span><span>${esc(work.patient)}</span><span>${esc(work.product)}</span><span>${esc(work.sent)}</span></div>`
        )
        .join("")}</div>`;
    }

    function feedbackHtml(question, answer) {
      if (question.type !== "stars" || !answer.rating) return "";
      const low = isLow(question, answer.rating);
      const options = low ? question.improvementOptions : question.valueOptions;
      const show = low ? question.lowOptionsRequired : question.highOptionsOptional;
      const comment = low ? question.lowCommentRequired : question.highCommentOptional;
      const prompt = low ? question.lowPrompt : question.highPrompt;

      return `
        <div class="follow ${low ? "is-low" : "is-high"}">
          ${show || comment ? `<div class="feedback-block">
            <b>${esc(prompt)}${low ? ' <em class="req">obligatorio</em>' : ' <em class="opt">opcional</em>'}</b>
            ${show ? chipsHtml(options, answer.tags) : ""}
            ${comment ? `<textarea data-comment rows="3" placeholder="${low ? "Cuéntenos qué ocurrió para poder mejorarlo" : "Si desea, cuéntenos qué hicimos bien"}">${esc(answer.comment)}</textarea>` : ""}
          </div>` : ""}
        </div>`;
    }

    function answerControl(question, answer) {
      if (question.type === "stars") return starsHtml(answer);
      if (question.type === "short") return `<input class="rt-input" data-value placeholder="Su respuesta" value="${attr(answer.value)}">`;
      if (question.type === "paragraph")
        return `<textarea class="rt-input" data-value rows="4" placeholder="Su respuesta">${esc(answer.value)}</textarea>`;
      if (question.type === "single") {
        return `<div class="option-list">${question.options
          .map(
            (option) =>
              `<label class="${answer.value === option ? "on" : ""}"><input type="radio" name="opt-${esc(answer.key)}" data-single="${attr(option)}" ${
                answer.value === option ? "checked" : ""
              }> ${esc(option)}</label>`
          )
          .join("")}</div>`;
      }
      return `<div class="option-list">${question.options
        .map(
          (option) =>
            `<label class="${answer.values.includes(option) ? "on" : ""}"><input type="checkbox" data-multi="${attr(option)}" ${
              answer.values.includes(option) ? "checked" : ""
            }> ${esc(option)}</label>`
        )
        .join("")}</div>`;
    }

    function questionCard(question, answer, extra) {
      return `
        <article class="question" data-answer="${esc(answer.key)}">
          <div class="question-line">
            <div class="question-title">
              <b>${esc(question.text)}${question.required ? " *" : ""}</b>
              ${question.help ? `<small>${esc(question.help)}</small>` : ""}
            </div>
            ${answerControl(question, answer)}
          </div>
          ${feedbackHtml(question, answer)}
          ${extra || ""}
        </article>`;
    }

    function screenHeader(screen) {
      const section = screen.sectionId ? findSection(screen.sectionId) : null;
      if (screen.kind === "intro")
        return { kicker: "", title: survey.name, description: "" };
      if (screen.kind === "review")
        return {
          kicker: "Último paso",
          title: "Revise y envíe sus respuestas",
          description: "Verifique la información antes de finalizar. Una vez enviada no podrá modificarse.",
        };
      if (screen.kind === "mode")
        return {
          kicker: section.title,
          title: "¿Cómo desea evaluar sus trabajos?",
          description: `Durante este período trabajamos ${works.length} caso${works.length === 1 ? "" : "s"} para usted.`,
        };
      if (screen.kind === "mixed")
        return {
          kicker: section.title,
          title: "Seleccione los trabajos que comparten calificación",
          description: "Los trabajos que deje sin marcar se evaluarán uno por uno.",
        };
      if (screen.kind === "work") {
        const work = findWork(screen.workId);
        return {
          kicker: section.title,
          title: `Orden #${work.code}`,
          description: `${work.patient} · ${work.product} · Enviado el ${work.sent}`,
        };
      }
      /* El titulo de la categoria se muestra una sola vez: como titulo.
         La subcategoria solo se ve en la cabecera de la vista previa. */
      return { kicker: "", title: section.title, description: section.description };
    }

    function screenBody(screen) {
      if (screen.kind === "intro") {
        return `
          <div class="intro-card">
            <p>${esc(survey.description)}</p>
            ${survey.works.enabled && works.length ? `<div class="intro-count"><b>${works.length}</b><span>casos trabajados en ${esc(survey.periodLabel)}</span></div>` : ""}
            ${survey.works.enabled && works.length ? worksTable(works, "Trabajos del período") : ""}
          </div>`;
      }

      if (screen.kind === "mode") {
        const chosen = state.modes[screen.sectionId] || "";
        return `<fieldset class="mode-grid"><legend>Modalidad</legend>${screen.modes
          .map(
            (mode) => `<label class="mode-card ${chosen === mode ? "on" : ""}">
              <input type="radio" name="mode-${esc(screen.sectionId)}" data-mode="${attr(mode)}" ${chosen === mode ? "checked" : ""}>
              <span><b>${esc(DL.MODE_LABELS[mode])}</b><small>${esc(DL.MODE_HELP[mode])}</small></span>
            </label>`
          )
          .join("")}</fieldset>`;
      }

      if (screen.kind === "mixed") {
        const selected = state.mixed[screen.sectionId] || [];
        return `<div class="selection-list">${works
          .map(
            (work) => `<label class="work-select-card ${selected.includes(work.id) ? "on" : ""}">
              <input type="checkbox" data-mixed="${attr(work.id)}" ${selected.includes(work.id) ? "checked" : ""}>
              <span><b>Orden #${esc(work.code)}</b><small>${esc(work.patient)} · ${esc(work.product)} · ${esc(work.sent)}</small></span>
            </label>`
          )
          .join("")}</div>
          <p class="muted small">Seleccionados: ${selected.length} · Se evaluarán uno por uno: ${works.length - selected.length}</p>`;
      }

      if (screen.kind === "question") {
        const question = findQuestion(screen.questionId);
        const answer = getAnswer(question.id, screen.level, null, screen.workIds);
        const scope =
          screen.workIds && screen.workIds.length
            ? worksTable(
                worksByIds(screen.workIds),
                screen.level === "group"
                  ? "Esta calificación se aplicará a estos trabajos"
                  : "La misma calificación se aplicará a todos estos trabajos"
              )
            : "";
        return questionCard(question, answer, scope);
      }

      if (screen.kind === "work") {
        const section = findSection(screen.sectionId);
        const dimKey = `${screen.sectionId}::${screen.workId}`;
        const questions = screen.questionIds.map(findQuestion);
        let picked = state.dimensions[dimKey];
        if (!picked) {
          picked = questions.map((question) => question.id);
          state.dimensions[dimKey] = picked;
        }
        const picker =
          section.allowCaseDimensions && questions.length > 1
            ? `<div class="dim-picker"><b>¿Qué desea evaluar de esta orden?</b><div class="chips">${questions
                .map(
                  (question) =>
                    `<label class="${picked.includes(question.id) ? "on" : ""}"><input type="checkbox" data-dim="${attr(question.id)}" ${
                      picked.includes(question.id) ? "checked" : ""
                    }> ${esc(question.text)}</label>`
                )
                .join("")}</div></div>`
            : "";
        const cards = questions
          .filter((question) => picked.includes(question.id))
          .map((question) => questionCard(question, getAnswer(question.id, "work", screen.workId)))
          .join("");
        return `${picker}<div class="individual-list">${cards}</div>`;
      }

      /* review */
      const rows = Object.values(state.answers).filter((answer) => answer.rating || answer.value || answer.values.length);
      const byArea = {};
      rows.forEach((answer) => {
        byArea[answer.area] = byArea[answer.area] || [];
        byArea[answer.area].push(answer);
      });
      const areaBlocks = Object.entries(byArea)
        .map(
          ([area, list]) => `
            <div class="review-area">
              <header><b>${esc(area)}</b><span>${list.length} respuesta${list.length === 1 ? "" : "s"}</span></header>
              ${list
                .map((answer) => {
                  const detail = answer.rating ? `${answer.rating} ★` : esc(answer.values.length ? answer.values.join(", ") : answer.value);
                  const scope =
                    answer.level === "work"
                      ? `Orden #${esc(answer.workIds[0] || "")}`
                      : answer.level === "group"
                        ? `${answer.workIds.length} trabajos`
                        : "General";
                  return `<div class="review-row"><span>${esc(answer.questionText)}</span><b>${detail}</b><small>${scope}</small></div>`;
                })
                .join("")}
            </div>`
        )
        .join("");

      return `
        <div class="review">
          <div><span>${survey.classification === "Externa" ? "Doctor" : "Colaborador"}</span><b>${esc(config.respondent || survey.respondent)}</b></div>
          <div><span>Período</span><b>${esc(survey.periodLabel)}</b></div>
          <div><span>Respuestas registradas</span><b>${rows.length}</b></div>
          <div><span>Trabajos del período</span><b>${works.length}</b></div>
        </div>
        ${areaBlocks || '<p class="muted">Aún no hay respuestas registradas.</p>'}
        <p class="muted small">Cada respuesta se envía al área responsable de la pregunta. Al finalizar no podrá modificarla.</p>`;
    }

    function render(options = {}) {
      const screens = flow();
      state.index = Math.max(0, Math.min(state.index, screens.length - 1));
      const screen = screens[state.index];
      const head = screenHeader(screen);
      const percent = Math.round(((state.index + 1) / screens.length) * 100);

      if (state.finished) {
        mount.innerHTML = `
          <div class="success">
            <div class="icon">✓</div>
            <h2>Encuesta completada</h2>
            <p>Gracias por su tiempo. Sus respuestas fueron registradas y enviadas a cada área responsable.</p>
            <p class="muted small">Esta encuesta ya no puede modificarse.</p>
          </div>`;
        return;
      }

      mount.innerHTML = `
        <div class="rt-shell ${compact ? "compact" : ""}">
          <div class="progress-wrap">
            <div class="progress"><span style="width:${percent}%"></span></div>
            <div class="progress-label">${state.index + 1}/${screens.length}</div>
          </div>
          ${state.error ? `<div class="error" role="alert">${esc(state.error)}</div>` : ""}
          <section class="section-panel">
            ${head.kicker ? `<p class="section-kicker">${esc(head.kicker)}</p>` : ""}
            <h1>${esc(head.title)}</h1>
            ${head.description ? `<p class="screen-description">${esc(head.description)}</p>` : ""}
            <div class="rt-content">${screenBody(screen)}</div>
            <div class="actions">
              ${state.index > 0 ? `<button class="btn" type="button" data-rt="prev">Regresar</button>` : "<span></span>"}
              <button class="btn primary" type="button" data-rt="next" ${state.sending ? "disabled" : ""}>${
                screen.kind === "review" ? (state.sending ? "Enviando…" : "Enviar encuesta") : "Continuar"
              }</button>
            </div>
          </section>
        </div>`;

      if (options.scroll) {
        if (compact) mount.scrollTop = 0;
        else window.scrollTo({ top: 0, behavior: "smooth" });
      }
    }

    function currentScreen() {
      const screens = flow();
      return screens[Math.max(0, Math.min(state.index, screens.length - 1))];
    }

    function answerFromNode(node) {
      const card = node.closest("[data-answer]");
      return card ? state.answers[card.dataset.answer] || null : null;
    }

    mount.addEventListener("click", async (event) => {
      const nav = event.target.closest("[data-rt]");
      if (nav) {
        state.error = "";
        if (nav.dataset.rt === "prev") {
          state.index -= 1;
          render({ scroll: true });
          return;
        }
        const screen = currentScreen();
        if (screen.kind === "review") {
          const invalid = firstInvalid();
          if (invalid) {
            state.index = invalid.index;
            state.error = invalid.message;
            render({ scroll: true });
            return;
          }
          state.sending = true;
          render();
          try {
            await onFinish(exportAnswers());
            state.finished = true;
          } catch (error) {
            state.error = error.message || "No se pudo enviar la encuesta.";
          }
          state.sending = false;
          render();
          return;
        }
        const message = validateScreen(screen);
        if (message) {
          state.error = message;
          render();
          return;
        }
        if (!state.opened) {
          state.opened = true;
          onOpen();
        }
        state.index += 1;
        render({ scroll: true });
        return;
      }

      const star = event.target.closest("[data-star]");
      if (star) {
        const answer = answerFromNode(star);
        if (!answer) return;
        const rating = Number(star.dataset.star);
        const question = findQuestion(answer.questionId);
        const wasLow = isLow(question, answer.rating);
        const nowLow = isLow(question, rating);
        if (answer.rating && wasLow !== nowLow) {
          answer.tags = [];
          answer.comment = "";
        }
        answer.rating = rating;
        state.error = "";
        render();
      }
    });

    mount.addEventListener("change", (event) => {
      const target = event.target;
      state.error = "";

      const mode = target.closest("[data-mode]");
      if (mode) {
        state.modes[currentScreen().sectionId] = mode.dataset.mode;
        render();
        return;
      }
      const mixed = target.closest("[data-mixed]");
      if (mixed) {
        const id = currentScreen().sectionId;
        const list = new Set(state.mixed[id] || []);
        mixed.checked ? list.add(mixed.dataset.mixed) : list.delete(mixed.dataset.mixed);
        state.mixed[id] = [...list];
        render();
        return;
      }
      const dim = target.closest("[data-dim]");
      if (dim) {
        const screen = currentScreen();
        const key = `${screen.sectionId}::${screen.workId}`;
        const list = new Set(state.dimensions[key] || []);
        dim.checked ? list.add(dim.dataset.dim) : list.delete(dim.dataset.dim);
        state.dimensions[key] = [...list];
        render();
        return;
      }
      const tag = target.closest("[data-tag]");
      if (tag) {
        const answer = answerFromNode(tag);
        if (!answer) return;
        const list = new Set(answer.tags);
        tag.checked ? list.add(tag.dataset.tag) : list.delete(tag.dataset.tag);
        answer.tags = [...list];
        render();
        return;
      }
      const single = target.closest("[data-single]");
      if (single) {
        const answer = answerFromNode(single);
        if (!answer) return;
        answer.value = single.dataset.single;
        render();
        return;
      }
      const multi = target.closest("[data-multi]");
      if (multi) {
        const answer = answerFromNode(multi);
        if (!answer) return;
        const list = new Set(answer.values);
        multi.checked ? list.add(multi.dataset.multi) : list.delete(multi.dataset.multi);
        answer.values = [...list];
        render();
      }
    });

    mount.addEventListener("input", (event) => {
      const comment = event.target.closest("[data-comment]");
      if (comment) {
        const answer = answerFromNode(comment);
        if (answer) answer.comment = comment.value;
        state.error = "";
        return;
      }
      const value = event.target.closest("[data-value]");
      if (value) {
        const answer = answerFromNode(value);
        if (answer) answer.value = value.value;
        state.error = "";
      }
    });

    /* ---------- salida estructurada ---------- */
    function exportAnswers() {
      return Object.values(state.answers)
        .filter((answer) => answer.rating || answer.value || answer.values.length)
        .map((answer) => {
          /* Una evaluación general no se atribuye a órdenes ni a asesoras (RN-ENC-003). */
          const linked = answer.level === "general" ? [] : answer.workIds;
          const asesoras = [...new Set(worksByIds(linked).map((work) => work.advisor))];
          return {
            pregunta: answer.questionText,
            area: answer.area,
            calificacion: answer.rating || null,
            valor: answer.values.length ? answer.values.join(", ") : answer.value,
            nivel: answer.level === "general" ? "GENERAL" : "ESPECÍFICA",
            trabajos: linked,
            asesoras: answer.level === "general" ? [] : asesoras,
            motivos: answer.tags,
            comentario: answer.comment,
            fecha: new Date().toISOString(),
          };
        });
    }

    function reset() {
      state.index = 0;
      state.modes = {};
      state.mixed = {};
      state.dimensions = {};
      state.answers = {};
      state.error = "";
      state.finished = false;
      state.sending = false;
      render();
    }

    render();
    return { render, reset, state, exportAnswers };
  };
})();
