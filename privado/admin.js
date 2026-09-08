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
    ["audience", "Público", "A quién se dirige y si usa órdenes"],
    ["schedule", "Programación y envío", "Cada cuánto corre y cómo se manda"],
    ["questions", "Preguntas", "Editor tipo Google Forms"],
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
    previewOpen: false,
    focusAfterRender: "",
    toastTimer: null,
    saveTimer: null,
    poll: null,
  };

  const els = {};

  document.addEventListener("DOMContentLoaded", async () => {
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
  const selectedWork = () => DL.WORKS.find((work) => work.id === state.selectedWorkId) || DL.WORKS[0];

  function abrirBorrador(survey) {
    state.draft = DL.clone(survey);
    state.activeSectionId = state.draft.sections[0].id;
    state.activeQuestionId = state.draft.sections[0].questions[0].id;
    state.openQuestionId = state.activeQuestionId;
  }

  function guardar(mensaje) {
    if (!state.draft) return;
    const badge = document.getElementById("saveState");
    if (badge) badge.textContent = "Guardando cambios…";
    clearTimeout(state.saveTimer);
    state.saveTimer = setTimeout(async () => {
      try {
        const guardada = await DL.api.guardarEncuesta(state.draft);
        state.draft.schedule.nextRun = guardada.schedule.nextRun;
        state.surveys = await DL.api.encuestas();
        if (badge) badge.textContent = "Se han guardado todos los cambios";
        if (mensaje) showToast(mensaje);
      } catch (error) {
        if (badge) badge.textContent = "Error al guardar";
        showToast("No se pudo guardar: " + error.message);
      }
    }, 350);
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
      if (survey.works.enabled) items.push(["Órdenes cargadas para la muestra", survey.works.selectedIds.length > 0]);
    } else {
      items.push(["Público interno definido", (survey.audienceAreas || []).length > 0]);
    }
    return items;
  }

  /* ==================================================================
     Eventos
     ================================================================== */
  function onClick(event) {
    const moduleTab = event.target.closest("[data-module]");
    if (moduleTab) {
      state.module = moduleTab.dataset.module;
      state.view = state.module === "works" ? "work-list" : state.module === "reports" ? "results" : "survey-list";
      renderApp();
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
    const questionCard = event.target.closest("[data-question-id]");
    if (questionCard && !event.target.closest("input, textarea, select, button")) {
      state.activeSectionId = questionCard.dataset.sectionId;
      state.activeQuestionId = questionCard.dataset.questionId;
      state.openQuestionId = questionCard.dataset.questionId;
      renderView();
    }
  }

  async function irA(view) {
    state.view = view;
    state.module = view.startsWith("work") ? "works" : "surveys";
    detenerPoll();
    try {
      if (view === "survey-list") state.surveys = await DL.api.encuestas();
      if (view === "sends" && state.draft) state.instancias = await DL.api.instancias(state.draft.id);
      if (view === "answers") state.respuestas = await DL.api.respuestas();
      if (view === "results") state.respuestas = await DL.api.respuestas();
      if (view === "whatsapp") state.mensajes = await DL.api.mensajes();
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
        if (view === "answers") state.respuestas = await DL.api.respuestas();
        if (view === "whatsapp") state.mensajes = await DL.api.mensajes();
        renderView();
      } catch (error) {
        /* silencio */
      }
    }, 4000);
  }

  function detenerPoll() {
    if (state.poll) clearInterval(state.poll);
    state.poll = null;
  }

  async function runAction(act, arg, node) {
    const survey = state.draft;

    try {
      switch (act) {
        case "new-survey":
          state.view = "survey-type";
          renderApp();
          return;

        case "create": {
          const creada = await DL.api.crearEncuesta(arg);
          state.surveys = await DL.api.encuestas();
          abrirBorrador(creada);
          state.view = "survey-edit";
          state.step = "general";
          renderApp();
          showToast(`Encuesta ${arg.toLowerCase()} creada. Complete los pasos y publíquela.`);
          return;
        }

        case "edit": {
          abrirBorrador(await DL.api.encuesta(arg));
          state.view = "survey-edit";
          state.step = node && node.dataset.target ? node.dataset.target : "general";
          renderApp();
          return;
        }

        case "sends": {
          if (arg) abrirBorrador(await DL.api.encuesta(arg));
          state.instancias = await DL.api.instancias(state.draft.id);
          state.view = "sends";
          state.module = "surveys";
          renderApp();
          iniciarPoll("sends");
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
          renderApp();
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
    if (!state.draft) return;
    const target = event.target;

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
    if (!state.draft) return;
    const target = event.target;
    const survey = state.draft;

    if (target.matches("[data-survey-field]")) {
      survey[target.dataset.surveyField] = target.dataset.surveyField === "anonymous" ? target.value === "true" : target.value;
      guardar();
      renderView();
      refreshPreview();
      return;
    }
    if (target.matches("[data-sched-field]")) {
      survey.schedule[target.dataset.schedField] = target.value;
      guardar();
      renderView();
      return;
    }
    if (target.matches("[data-sched-check]")) {
      survey.schedule[target.dataset.schedCheck] = target.checked;
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

  function renderModuleNav() {
    els.moduleNav.innerHTML =
      modules
        .map(([id, label]) => `<button class="module-tab ${state.module === id ? "active" : ""}" type="button" data-module="${id}">▨ ${label}</button>`)
        .join("") + waChip();
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
    els.sidebar.innerHTML = `
      <div class="side-title">ENCUESTAS</div>
      <button class="side-link ${["survey-list", "survey-edit"].includes(state.view) ? "active" : ""}" type="button" data-view="survey-list">▧ Encuestas</button>
      <button class="side-link ${state.view === "sends" ? "active" : ""}" type="button" data-view="sends">✈ Envíos</button>
      <button class="side-link ${state.view === "answers" ? "active" : ""}" type="button" data-view="answers">✓ Respuestas</button>
      <button class="side-link ${state.view === "results" ? "active" : ""}" type="button" data-view="results">▧ Resultados por área</button>
      <button class="side-link ${state.view === "whatsapp" ? "active" : ""}" type="button" data-view="whatsapp">◱ WhatsApp</button>
      <div class="side-foot"><button class="mini-btn" type="button" data-act="reset-demo">↺ Restaurar demo</button></div>`;
  }

  function renderView() {
    const vistas = {
      "survey-list": renderSurveyList,
      "survey-type": renderSurveyType,
      "survey-edit": renderEditor,
      sends: renderSends,
      answers: renderAnswers,
      results: renderResults,
      whatsapp: renderWhatsapp,
      "work-list": renderWorkList,
      "work-detail": renderWorkDetail,
    };
    if (["survey-edit"].includes(state.view) && !state.draft) state.view = "survey-list";
    if (state.view === "sends" && !state.draft) {
      els.appView.innerHTML = renderSendsPicker();
      return;
    }
    els.appView.innerHTML = (vistas[state.view] || renderSurveyList)();
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
  function renderSurveyList() {
    const all = state.surveys;
    const list = all.filter((survey) =>
      state.listFilter === "all" ? true : survey.classification === (state.listFilter === "ext" ? "Externa" : "Interna")
    );
    const counts = {
      all: all.length,
      ext: all.filter((s) => s.classification === "Externa").length,
      int: all.filter((s) => s.classification === "Interna").length,
    };

    return `
      <div class="toolbar-strip">
        <div class="view-tabs">
          <button class="tab-lite ${state.listFilter === "all" ? "active" : ""}" type="button" data-act="filter" data-arg="all">☷ Todas (${counts.all})</button>
          <button class="tab-lite ${state.listFilter === "ext" ? "active" : ""}" type="button" data-act="filter" data-arg="ext">Externas (${counts.ext})</button>
          <button class="tab-lite ${state.listFilter === "int" ? "active" : ""}" type="button" data-act="filter" data-arg="int">Internas (${counts.int})</button>
        </div>
        <button class="btn primary" type="button" data-act="new-survey">＋ Nueva encuesta</button>
      </div>

      <section class="page-card">
        <div class="table-wrap">
          <table class="data-table">
            <thead><tr><th>Encuesta</th><th>Clasificación</th><th>Responde</th><th>Programación</th><th>Envíos</th><th>Estado</th><th>Opciones</th></tr></thead>
            <tbody>
              ${list
                .map((survey) => {
                  const externa = survey.classification === "Externa";
                  const preguntas = survey.sections.reduce((total, section) => total + section.questions.length, 0);
                  return `
                    <tr class="${externa ? "row-external" : ""}">
                      <td><b>${esc(survey.name)}</b><span class="tiny">${esc(survey.subtype)} · ${survey.sections.length} categorías · ${preguntas} preguntas</span></td>
                      <td><span class="badge ${externa ? "pink" : "neutral"}">${esc(survey.classification)}</span></td>
                      <td>${esc(survey.respondent)}</td>
                      <td><b>${esc(survey.schedule.repeat)}</b><span class="tiny">${
                        survey.schedule.repeat === "No repetir"
                          ? "Sin agenda"
                          : `Día ${esc(survey.schedule.generationDay)} ${esc(survey.schedule.time)} → cierra ${esc(survey.schedule.closeDay)}`
                      }</span>${survey._proxima ? `<span class="tiny next">Próxima: ${esc(survey._proxima)}</span>` : ""}</td>
                      <td>${survey._instancias || 0}</td>
                      <td><span class="badge ${survey.status === "Activa" ? "" : "neutral"}">${esc(survey.status.toUpperCase())}</span></td>
                      <td class="row-actions">
                        <button class="mini-btn primary" type="button" data-act="edit" data-arg="${esc(survey.id)}">✎ Abrir</button>
                        <button class="mini-btn" type="button" data-act="edit" data-arg="${esc(survey.id)}" data-target="questions">▧ Preguntas</button>
                        <button class="mini-btn" type="button" data-act="preview" data-arg="${esc(survey.id)}">◎ Vista previa</button>
                        <button class="mini-btn" type="button" data-act="sends" data-arg="${esc(survey.id)}">✈ Envíos</button>
                        <button class="mini-btn" type="button" data-act="duplicate" data-arg="${esc(survey.id)}">Duplicar</button>
                        <button class="mini-btn" type="button" data-act="toggle-status" data-arg="${esc(survey.id)}">${survey.status === "Activa" ? "Desactivar" : "Activar"}</button>
                        <button class="mini-btn danger" type="button" data-act="delete" data-arg="${esc(survey.id)}">Eliminar</button>
                      </td>
                    </tr>`;
                })
                .join("")}
            </tbody>
          </table>
        </div>
      </section>
      <div class="bottom-actions"><span>Mostrando ${list.length} de ${all.length} encuestas</span><span>‹ 1 ›</span></div>`;
  }

  function renderSurveyType() {
    return `
      <div class="toolbar-strip">
        <div class="view-tabs"><span class="tab-lite active">Nueva encuesta</span></div>
        <button class="link-action" type="button" data-view="survey-list">← Regresar</button>
      </div>
      <section class="creation-shell">
        <header class="creation-head">
          <span class="eyebrow">PASO 1 DE 5</span>
          <h1>¿Qué tipo de encuesta desea crear?</h1>
          <p>Las dos usan el mismo editor y la misma vista previa. Cambia a quién se dirige y cómo se envía.</p>
        </header>
        <div class="creation-grid">
          <button class="creation-card" type="button" data-act="create" data-arg="Interna">
            <span class="creation-icon">I</span><span class="badge neutral">INTERNA</span>
            <b>Para el personal</b>
            <span>Colaboradores por área o supervisor. Puede enviarse una vez o repetirse.</span>
            <strong>Crear encuesta interna →</strong>
          </button>
          <button class="creation-card featured" type="button" data-act="create" data-arg="Externa">
            <span class="creation-icon">E</span><span class="badge pink">EXTERNA</span>
            <b>Para doctores</b>
            <span>Jala las órdenes del mes del doctor y se envía por WhatsApp.</span>
            <strong>Crear encuesta externa →</strong>
          </button>
        </div>
        <div class="flow-summary">${STEPS.map(([, label], index) => `<span><b>${index + 1}</b> ${label}</span>`).join("")}</div>
      </section>`;
  }

  /* ---------------- Editor ---------------- */
  function renderEditor() {
    const survey = draft();
    const stepIndex = STEPS.findIndex(([id]) => id === state.step);
    const body = { general: stepGeneral, audience: stepAudience, schedule: stepSchedule, questions: stepQuestions, review: stepReview }[state.step]();

    return `
      <div class="edit-shell">
        <div class="toolbar-strip">
          <div class="editor-id">
            <span class="badge ${isExternal() ? "pink" : "neutral"}">${esc(survey.classification.toUpperCase())}</span>
            <b id="editorTitle">${esc(survey.name)}</b>
            <span class="tiny">${esc(survey.subtype)} · ${esc(survey.status)}</span>
          </div>
          <div>
            <button class="mini-btn" type="button" data-act="preview">◎ Vista previa</button>
            <button class="mini-btn" type="button" data-act="sends" data-arg="">✈ Envíos</button>
            <button class="link-action" type="button" data-view="survey-list">← Regresar</button>
          </div>
        </div>

        <ol class="wizard-steps">
          ${STEPS.map(([id, label, help], index) => `
            <li class="wizard-step ${state.step === id ? "active" : ""} ${index < stepIndex ? "done" : ""}">
              <button type="button" data-step="${id}">
                <span class="step-num">${index < stepIndex ? "✓" : index + 1}</span>
                <span class="step-text"><b>${label}</b><small>${help}</small></span>
              </button>
            </li>`).join("")}
        </ol>

        ${body}

        <div class="bottom-actions sticky">
          <span class="save-state" id="saveState">Se han guardado todos los cambios</span>
          <div>
            ${stepIndex > 0 ? `<button class="btn" type="button" data-act="prev-step">← Anterior</button>` : ""}
            ${stepIndex < STEPS.length - 1
              ? `<button class="btn primary" type="button" data-act="next-step">Siguiente: ${STEPS[stepIndex + 1][1]} →</button>`
              : `<button class="btn primary" type="button" data-act="publish">Publicar encuesta</button>`}
          </div>
        </div>
      </div>`;
  }

  function stepGeneral() {
    const survey = draft();
    const external = isExternal();
    return `
      <section class="page-card">
        <h2 class="card-title"><span class="pink-icon">▧</span> Datos generales</h2>
        <div class="summary-grid">
          <div class="form-grid">
            <label class="field span2"><span>Nombre de la encuesta *</span><input data-survey-field="name" value="${attr(survey.name)}"></label>
            <label class="field span2"><span>Descripción <small>se muestra al abrir la encuesta</small></span><textarea rows="3" data-survey-field="description">${esc(survey.description)}</textarea></label>
            <label class="field"><span>Subcategoría</span><select data-survey-field="subtype">${options(external ? ["Servicio y Calidad", "Encuesta general", "Nuevos productos"] : ["Liderazgo", "Clima laboral", "Capacitación", "Eventos y actividades", "Encuesta general"], survey.subtype)}</select></label>
            <label class="field"><span>Estado</span><select data-survey-field="status">${options(["Borrador", "Activa", "Inactiva"], survey.status)}</select></label>
            <label class="field"><span>Período visible</span><input data-survey-field="periodLabel" value="${attr(survey.periodLabel)}"></label>
            <label class="field span2"><span>Mensaje de bienvenida</span><input data-survey-field="intro" value="${attr(survey.intro)}"></label>
          </div>
          <aside class="side-summary">
            <div><b>${external ? "Encuesta externa" : "Encuesta interna"}</b><span>${external ? "Se dirige a doctores, usa las órdenes del período y se envía por WhatsApp." : "Se dirige al personal por área o supervisor."}</span></div>
            <div><b>Vista previa en vivo</b><span>Lo que configure se refleja de inmediato: la vista previa es la encuesta real.</span></div>
            <button class="btn primary full" type="button" data-act="preview">◎ Ver cómo se responde</button>
          </aside>
        </div>
      </section>`;
  }

  function stepAudience() {
    const survey = draft();
    if (!isExternal()) {
      return `
        <section class="page-card">
          <h2 class="card-title"><span class="pink-icon">▣</span> ¿Quiénes van a responder?</h2>
          <div class="form-grid g4">
            <label class="field"><span>Asignación *</span><select data-survey-field="audienceMode">${options(["Por área y supervisor", "Por supervisor", "Por área", "Selección manual", "Toda la empresa"], survey.audienceMode)}</select></label>
            <label class="field"><span>Respuestas</span><select data-survey-field="anonymous"><option value="true" ${survey.anonymous ? "selected" : ""}>Anónimas</option><option value="false" ${!survey.anonymous ? "selected" : ""}>Identificadas</option></select></label>
          </div>
          <div class="area-pick">
            <b>Áreas incluidas</b>
            <div class="mode-check-grid areas">
              ${["Área de Administración", "Área de Control de Producción/PPR", "Área de Estructuras 1", "Área de Estructuras 2", "Área de Mensajería", "Área de Servicio al Cliente", "RRHH"]
                .map((area) => `<label class="mode-check ${(survey.audienceAreas || []).includes(area) ? "selected" : ""}"><input type="checkbox" data-area-pick="${attr(area)}" ${(survey.audienceAreas || []).includes(area) ? "checked" : ""}><span><b>${esc(area)}</b></span></label>`)
                .join("")}
            </div>
          </div>
        </section>`;
    }

    const eligible = DL.eligibleWorks(survey.works.statuses);
    const doctors = [...new Set(eligible.map((work) => work.doctor))];
    return `
      <section class="page-card">
        <h2 class="card-title"><span class="pink-icon">▣</span> ¿A qué doctores se dirige?</h2>
        <div class="form-grid g4">
          <label class="field span2"><span>Asignación *</span><select data-survey-field="audienceMode">${options(["Automática por doctor", "Selección manual de doctores", "Enlace abierto"], survey.audienceMode)}</select><small>Automática: se genera una encuesta por cada doctor con trabajos elegibles.</small></label>
          <label class="field span2"><span>Doctor de muestra <small>para la vista previa</small></span><select data-survey-field="respondent">${options(doctors, survey.respondent)}</select></label>
        </div>
      </section>

      <section class="page-card">
        <h2 class="card-title"><span class="pink-icon">▤</span> ¿Esta encuesta lleva órdenes de trabajo?</h2>
        <label class="feature-toggle">
          <input type="checkbox" data-works-check="enabled" ${survey.works.enabled ? "checked" : ""}>
          <span><b>Sí, la encuesta evalúa trabajos del período</b><small>Habilita jalar las órdenes del mes del doctor. Las modalidades general, mixta e individual se configuran por categoría en el editor.</small></span>
        </label>

        ${survey.works.enabled ? `
          <div class="form-grid g4 compact-grid">
            <label class="field span2"><span>Origen de las órdenes</span><select data-works-field="source">${options(["Mes calendario anterior por doctor", "Período manual por doctor", "Selección manual"], survey.works.source)}</select></label>
            <div class="field span2"><span>Estado elegible</span>
              <div class="inline-checks">
                ${["enviado", "facturado", "finalizado"].map((status) => `<label class="check-row"><input type="checkbox" data-status-filter="${status}" ${survey.works.statuses.includes(status) ? "checked" : ""}> ${status}</label>`).join("")}
              </div>
            </div>
          </div>

          <div class="load-works-row">
            <div><b>${survey.works.selectedIds.length} órdenes cargadas para la vista previa</b><span>Al generar, el sistema agrupa por doctor automáticamente.</span></div>
            <div class="load-actions">
              <select id="doctorPick">${options(doctors, survey.respondent)}</select>
              <button class="btn primary" type="button" data-act="load-month">Jalar órdenes del mes del doctor</button>
              <button class="btn" type="button" data-act="clear-works">Limpiar</button>
            </div>
          </div>

          <div class="work-list">
            ${eligible
              .map(
                (work) => `
                <label class="work-item">
                  <input class="work-check" type="checkbox" data-selected-work="${attr(work.id)}" ${survey.works.selectedIds.includes(work.id) ? "checked" : ""}>
                  <span><b>Orden #${esc(work.code)} · ${esc(work.product)}</b><small>${esc(work.doctor)} · ${esc(work.patient)} · Enviado ${esc(work.sent)} · Asesora: ${esc(work.advisor)}</small></span>
                  <span class="badge">${esc(work.status)}</span>
                </label>`
              )
              .join("")}
          </div>
        ` : `<p class="empty-note">La encuesta se responderá sin asociar calificaciones a órdenes.</p>`}
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
          <label class="field"><span>Repetición *</span><select data-sched-field="repeat">${options(["No repetir", "Mensual", "Trimestral", "Anual"], survey.schedule.repeat)}</select></label>
          ${repite ? `
            <label class="field"><span>Día de generación</span><input type="number" min="1" max="28" data-sched-field="generationDay" value="${attr(survey.schedule.generationDay)}"></label>
            <label class="field"><span>Hora</span><input type="time" data-sched-field="time" value="${attr(survey.schedule.time)}"></label>
            <label class="field"><span>Día de cierre</span><input type="number" min="1" max="28" data-sched-field="closeDay" value="${attr(survey.schedule.closeDay)}"></label>
          ` : ""}
          <label class="field"><span>Agenda</span><label class="switch-row"><input type="checkbox" data-sched-check="active" ${survey.schedule.active ? "checked" : ""}> Activa</label><small>Con la agenda activa el servidor ejecuta el JOB solo.</small></label>
          <label class="field span2"><span>Próxima ejecución</span><input value="${attr(survey.schedule.nextRun || "—")}" readonly></label>
          <label class="field"><span>Última ejecución</span><input value="${attr(survey.schedule.lastRun || "—")}" readonly></label>
        </div>

        <div class="agenda-test">
          <div><b>Probar la agenda sin esperar al día ${esc(survey.schedule.generationDay)}</b>
            <span>Programa una corrida real dentro de unos minutos: generará las encuestas y las enviará por WhatsApp.</span>
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
          <label class="field span3"><span>Número de prueba</span><input value="+${attr(state.estado ? state.estado.destino : "")} (todos los envíos de prueba llegan aquí)" readonly></label>
          ${survey.channel === "API WhatsApp" ? `
            <label class="field span4"><span>Mensaje que acompaña el enlace *</span><textarea rows="3" data-survey-field="whatsappMessage">${esc(survey.whatsappMessage)}</textarea>
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
    return String(survey.whatsappMessage || "")
      .replace(/{{doctor}}/g, survey.respondent)
      .replace(/{{periodo}}/g, survey.periodLabel)
      .replace(/{{casos}}/g, survey.works.selectedIds.length)
      .replace(/{{cierre}}/g, survey.schedule.closeDay);
  }

  /* ---------- editor de preguntas ---------- */
  function stepQuestions() {
    const survey = draft();
    return `
      <section class="page-card">
        <h2 class="card-title"><span class="pink-icon">▧</span> Editor tipo Google Forms</h2>
        <div class="forms-board">
          <header class="forms-top">
            <span class="forms-mark" aria-hidden="true"><span></span><span></span><span></span><span></span><span></span><span></span></span>
            <input class="form-name-input" data-survey-field="name" value="${attr(survey.name)}" aria-label="Nombre del formulario">
            <span class="save-state" id="saveState">Se han guardado todos los cambios</span>
          </header>
          <div class="forms-dercas-strip">
            <span><b>Tipo:</b> ${esc(survey.classification)} / ${esc(survey.subtype)}</span>
            <span><b>Responde:</b> ${esc(survey.respondent)}</span>
            <span><b>Órdenes:</b> ${survey.works.enabled ? `${survey.works.selectedIds.length} cargadas` : "no utiliza"}</span>
            <button class="mini-btn primary" type="button" data-act="preview">◎ Vista previa</button>
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
            <label class="switch-row"><input type="checkbox" data-section-check="active" ${section.active !== false ? "checked" : ""}> Categoría activa</label>
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
          <label class="feature-toggle subtle">
            <input type="checkbox" data-section-check="allowCaseDimensions" ${section.allowCaseDimensions ? "checked" : ""}>
            <span><b>Permitir elegir qué preguntas evaluar en cada orden</b><small>En una orden específica el doctor marca solo las dimensiones que desea calificar.</small></span>
          </label>
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
            ${conTrabajos ? `<label class="check-row"><input type="checkbox" data-question-check="linkLowRatingToWorks" ${question.linkLowRatingToWorks ? "checked" : ""}> Preguntar si se relaciona con casos específicos</label>` : ""}
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
          <label class="field"><span>ID</span><input value="${attr(question.id)}" readonly></label>
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
        ${pending ? `<p class="empty-note">Faltan ${pending} punto(s) por completar.</p>` : `<p class="ready-note">Todo listo. Puede publicar la encuesta.</p>`}
      </section>
      <section class="page-card">
        <h2 class="card-title">Resumen</h2>
        <div class="review-grid">
          <div><span>Clasificación</span><b>${esc(survey.classification)} · ${esc(survey.subtype)}</b></div>
          <div><span>Responde</span><b>${esc(survey.respondent)}</b></div>
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

    return `
      <div class="dercas-ribbon">
        <div><b>Lo que respondieron los doctores</b><span>Cada encuesta completada, con su nota, motivos y comentario tal como los escribió el doctor.</span></div>
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
      panel = `
        <div class="wa-panel qr">
          <b>Conectando con WhatsApp…</b>
          <p>${esc(wa.error || "Espere unos segundos; el código QR aparecerá aquí.")}</p>
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
    return `
      <div class="dercas-ribbon">
        <div><b>Trabajos elegibles</b><span>Desde una orden puede crear la encuesta del doctor con todas sus órdenes del período.</span></div>
        <div class="ribbon-tags"><span class="badge neutral">Estado ENVIADO</span></div>
      </div>
      <section class="page-card">
        <div class="table-wrap">
          <table class="data-table">
            <thead><tr><th>Código</th><th>Clínica</th><th>Doctor</th><th>Paciente</th><th>Producto</th><th>Enviado</th><th>Asesora</th><th>Estado</th><th>Acciones</th></tr></thead>
            <tbody>
              ${DL.WORKS.map((work) => {
                const eligible = ["enviado", "facturado"].includes(work.status);
                return `
                  <tr>
                    <td>${esc(work.code)}</td><td>${esc(work.clinic)}</td><td>${esc(work.doctor)}</td>
                    <td>${esc(work.patient)}</td><td>${esc(work.product)}</td><td>${esc(work.sent)}</td>
                    <td>${esc(work.advisor)}</td><td>${esc(work.status)}</td>
                    <td class="row-actions">
                      <button class="mini-btn" type="button" data-act="work-detail" data-arg="${esc(work.id)}">Ver</button>
                      <button class="mini-btn ${eligible ? "primary" : ""}" type="button" data-act="survey-from-work" data-arg="${esc(work.id)}" ${eligible ? "" : "disabled"}>${eligible ? "Crear encuesta del doctor" : "No elegible"}</button>
                    </td>
                  </tr>`;
              }).join("")}
            </tbody>
          </table>
        </div>
      </section>`;
  }

  function renderWorkDetail() {
    const work = selectedWork();
    const eligible = ["enviado", "facturado"].includes(work.status);
    const mismos = DL.worksByDoctor(work.doctor, ["enviado", "facturado"]);
    return `
      <div class="work-detail-head">
        <div><span class="muted">Código trabajo</span><h1>${esc(work.code)}</h1><b>Asesora</b> ${esc(work.advisor)}</div>
        <div class="head-actions">
          <button class="btn" type="button" data-view="work-list">← Regresar</button>
          <button class="btn ${eligible ? "primary" : ""}" type="button" data-act="survey-from-work" data-arg="${esc(work.id)}" ${eligible ? "" : "disabled"}>${eligible ? "Crear encuesta para este doctor" : "No elegible"}</button>
        </div>
      </div>
      <section class="page-card">
        <div class="detail-grid">
          <div class="detail-item"><span>Cliente</span><b>${esc(work.clinic)}</b></div>
          <div class="detail-item"><span>Doctor/a</span><b>${esc(work.doctor)}</b></div>
          <div class="detail-item"><span>Paciente</span><b>${esc(work.patient)}</b></div>
          <div class="detail-item"><span>Producto</span><b>${esc(work.product)}</b></div>
          <div class="detail-item"><span>Fecha estado Enviado</span><b>${esc(work.sent)}</b></div>
          <div class="detail-item"><span>Asesora asociada</span><b>${esc(work.advisor)}</b></div>
        </div>
      </section>
      <section class="detail-section">
        <h3>Órdenes del mismo doctor en el período</h3>
        <div class="table-wrap">
          <table class="data-table">
            <thead><tr><th>Orden</th><th>Paciente</th><th>Producto</th><th>Enviado</th><th>Asesora</th></tr></thead>
            <tbody>${mismos.map((item) => `<tr><td>${esc(item.code)}</td><td>${esc(item.patient)}</td><td>${esc(item.product)}</td><td>${esc(item.sent)}</td><td>${esc(item.advisor)}</td></tr>`).join("")}</tbody>
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

  function mountPreview() {
    const survey = state.draft;
    els.previewContent.innerHTML = `
      <div class="preview-simulator">
        <div><b>Así responde ${survey.classification === "Externa" ? "el doctor" : "el colaborador"}</b><span>Es la encuesta real, con sus validaciones.</span></div>
        <div class="simulator-group">
          <button class="simulator-btn" type="button" data-act="preview-reset">↺ Reiniciar</button>
          <button class="simulator-btn" type="button" data-act="public-link">↗ Abrir en pestaña</button>
        </div>
      </div>
      <div class="preview-device">
        <div class="preview-device-top">
          <img src="../assets/LOGO_DLABS2.png" alt="Digital Labs">
          <div><b>${esc(survey.classification === "Externa" ? "Encuesta de Servicio y Calidad" : "Encuesta interna")}</b><span>${esc(survey.periodLabel)}</span></div>
        </div>
        <div class="preview-device-body" id="previewMount"></div>
      </div>`;

    DL.createRuntime({
      mount: document.getElementById("previewMount"),
      survey: DL.clone(survey),
      works: DL.findWorks(survey.works.selectedIds),
      respondent: survey.respondent,
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
