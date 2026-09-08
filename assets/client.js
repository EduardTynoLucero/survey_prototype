/* =====================================================================
   Vista publica (doctor o colaborador).
   Renderiza exactamente la encuesta configurada en el sistema privado.
     ?i=<id de envio>      envio individual con los trabajos del doctor
     ?s=<id de encuesta>   encuesta directa (para probar)
   ===================================================================== */
(() => {
  "use strict";

  const params = new URLSearchParams(window.location.search);
  const mount = document.getElementById("surveyMount");
  const metaTitle = document.getElementById("metaTitle");
  const metaPeriod = document.getElementById("metaPeriod");

  function aviso(icono, titulo, texto, clase = "") {
    mount.innerHTML = `
      <div class="success ${clase}">
        <div class="icon">${icono}</div>
        <h2>${titulo}</h2>
        <p>${texto}</p>
      </div>`;
  }

  async function iniciar() {
    mount.innerHTML = '<p class="muted small cargando">Cargando encuesta…</p>';

    const instanceId = params.get("i");
    const surveyId = params.get("s");

    let survey = null;
    let works = [];
    let instancia = null;

    try {
      await DL.cargarTrabajos();

      if (instanceId) {
        const datos = await DL.api.instancia(instanceId);
        instancia = datos.instancia;
        survey = datos.encuesta;
        works = datos.trabajos;
      } else {
        const encuestas = await DL.api.encuestas();
        survey = surveyId
          ? encuestas.find((item) => item.id === surveyId)
          : encuestas.find((item) => item.classification === "Externa" && item.status === "Activa") || encuestas[0];
        if (survey) works = DL.findWorks(survey.works.selectedIds);
      }
    } catch (error) {
      aviso("!", "No se pudo cargar la encuesta", error.message, "closed");
      return;
    }

    if (!survey) {
      aviso("!", "No hay encuestas configuradas", "Cree una encuesta desde el sistema privado.", "closed");
      return;
    }

    metaTitle.textContent = survey.classification === "Externa" ? "Encuesta de Servicio y Calidad" : "Encuesta interna";
    metaPeriod.textContent = survey.periodLabel || "";
    document.title = survey.name;

    if (instancia && String(instancia.state).startsWith("Cerrada")) {
      aviso("⏳", "Período de respuesta finalizado", "La encuesta se encuentra cerrada y ya no admite respuestas ni modificaciones.", "closed");
      return;
    }
    if (instancia && instancia.state === "Completada") {
      aviso("✓", "Encuesta completada", "Esta encuesta ya fue finalizada y no puede modificarse.");
      return;
    }

    DL.createRuntime({
      mount,
      survey,
      works,
      respondent: instancia ? instancia.doctor : survey.respondent,
      onOpen() {
        if (instancia) DL.api.abrirInstancia(instancia.id).catch(() => {});
      },
      async onFinish(respuestas) {
        if (!instancia) return; // prueba directa sin envío asociado
        await DL.api.responder(instancia.id, respuestas);
      },
    });
  }

  iniciar();
})();
