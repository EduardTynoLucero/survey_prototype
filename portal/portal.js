/* =====================================================================
   Portal del colaborador.
   Login de prueba por correo: detecta al usuario del laboratorio,
   le muestra sus encuestas internas pendientes y, si es jefe de área,
   el resultado de su equipo.
   ===================================================================== */
(() => {
  "use strict";

  const state = {
    empleado: null,
    bandeja: [],
    resultados: [],
    personal: [],
    vista: "bandeja",
    encuesta: null,
    instancia: null,
    error: "",
    cargando: false,
  };

  const mount = document.getElementById("portalMount");
  const topMeta = document.getElementById("topMeta");
  const toast = document.getElementById("toast");

  const esc = (texto) =>
    String(texto == null ? "" : texto).replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
    );

  const attr = (texto) => esc(texto);

  let temporizador = null;
  function avisar(mensaje) {
    toast.textContent = mensaje;
    toast.classList.add("show");
    clearTimeout(temporizador);
    temporizador = setTimeout(() => toast.classList.remove("show"), 3600);
  }

  const iniciales = (nombre) =>
    String(nombre || "")
      .split(" ")
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => p[0])
      .join("");

  /* ==================================================================
     Login
     ================================================================== */
  /* ==================================================================
     Bandeja
     ================================================================== */
  async function cargarBandeja() {
    state.cargando = true;
    render();
    try {
      const datos = await DL.api.portalBandeja(state.empleado.id);
      state.empleado = datos.empleado;
      state.bandeja = datos.bandeja || [];
      state.resultados = datos.resultados || [];
    } catch (error) {
      avisar(error.message);
    }
    state.cargando = false;
    render();
  }

  function renderCabecera() {
    const emp = state.empleado;
    topMeta.innerHTML = `
      <div class="portal-user">
        <span class="portal-avatar">${esc(iniciales(emp.name))}</span>
        <div>
          <b>${esc(emp.name)}</b>
          <span>${esc(emp.position)} · ${esc(emp.area)}</span>
        </div>
      </div>
      <button class="portal-exit" type="button" data-act="salir">Cerrar sesión</button>`;
  }

  function renderBandeja() {
    const pendientes = state.bandeja.filter((i) => !i.respondida);
    const hechas = state.bandeja.filter((i) => i.respondida);

    return `
      <div class="portal-tabs">
        <button class="portal-tab ${state.vista === "bandeja" ? "is-active" : ""}" type="button" data-act="ver-bandeja">
          Bandeja de encuestas${pendientes.length ? ` <i>${pendientes.length}</i>` : ""}
        </button>
        ${state.empleado.supervisor
          ? `<button class="portal-tab ${state.vista === "mis" ? "is-active" : ""}" type="button" data-act="ver-mis">Mis resultados</button>`
          : ""}
      </div>

      ${state.cargando ? `<p class="portal-loading">Cargando…</p>` : ""}

      ${pendientes.length === 0 && hechas.length === 0
        ? `<section class="portal-empty">
             <b>No tiene encuestas asignadas</b>
             <p>Cuando Gestión Humana ejecute una encuesta interna de su área, le aparecerá aquí.</p>
           </section>`
        : ""}

      ${pendientes.length ? `
        <h2 class="portal-title">Pendientes de responder</h2>
        <div class="portal-list">
          ${pendientes.map((item) => tarjetaEncuesta(item, true)).join("")}
        </div>` : ""}

      ${hechas.length ? `
        <h2 class="portal-title">Ya respondidas</h2>
        <div class="portal-list">
          ${hechas.map((item) => tarjetaEncuesta(item, false)).join("")}
        </div>` : ""}`;
  }

  function tarjetaEncuesta(item, pendiente) {
    return `
      <article class="portal-item ${pendiente ? "" : "hecha"}">
        <div class="portal-item-main">
          <b>${esc(item.surveyName)}</b>
          <span>${esc(item.subtype)} · período ${esc(item.period)} · ${item.preguntas} pregunta(s)</span>
          ${item.supervisor ? `<span class="portal-item-sup">Evalúa a: <b>${esc(item.supervisor)}</b></span>` : ""}
        </div>
        <div class="portal-item-side">
          ${pendiente
            ? `<span class="portal-chip pend">${esc(item.state)}</span>
               <button class="portal-btn" type="button" data-act="responder" data-arg="${attr(item.instanceId)}">Responder</button>`
            : `<span class="portal-chip ok">Respondida</span>
               <span class="portal-when">${esc(item.finishedAt || "")}</span>`}
        </div>
      </article>`;
  }

  /* ==================================================================
     Mis resultados (solo jefes de área)
     ================================================================== */
  function renderMisResultados() {
    const list = state.resultados;

    return `
      <div class="portal-tabs">
        <button class="portal-tab" type="button" data-act="ver-bandeja">Bandeja de encuestas</button>
        <button class="portal-tab is-active" type="button" data-act="ver-mis">Mis resultados</button>
      </div>

      ${list.length === 0
        ? `<section class="portal-empty"><b>Todavía no hay resultados de su equipo</b><p>Aparecerán cuando su área complete una encuesta.</p></section>`
        : `<div class="portal-list">
            ${list.map((r) => `
              <article class="portal-result">
                <div>
                  <b>${esc(r.surveyName)}</b>
                  <span>${esc(r.periodLabel)} · ${esc(r.area)} · ${r.respuestas} de ${r.asignadas} respondieron</span>
                </div>
                <div class="portal-result-score ${r.escala === "Regular" ? "baja" : "alta"}">
                  <b>${esc(r.promedio)}</b>
                  <i>${esc(r.escala)}</i>
                </div>
              </article>`).join("")}
           </div>
           <p class="portal-nota">Las encuestas internas son anónimas: se ve el promedio del equipo, no quién puso cada nota.</p>`}`;
  }

  /* ==================================================================
     Responder una encuesta (usa el mismo motor que la vista previa)
     ================================================================== */
  async function responder(instanceId) {
    try {
      const datos = await DL.api.instancia(instanceId);
      state.instancia = datos.instancia;
      state.encuesta = datos.encuesta;
    } catch (error) {
      avisar(error.message);
      return;
    }

    if (state.instancia.state === "Completada") {
      avisar("Esta encuesta ya fue finalizada y no puede modificarse.");
      await cargarBandeja();
      return;
    }

    state.vista = "responder";
    mount.innerHTML = `
      <div class="portal-answer">
        <button class="portal-back" type="button" data-act="ver-bandeja">← Volver a mi bandeja</button>
        <div class="portal-device">
          <div class="portal-device-top">
            <b>${esc(state.encuesta.subtype || "Encuesta interna")}</b>
            <span>${esc(state.instancia.periodLabel || "")}${state.instancia.supervisor ? ` · ${esc(state.instancia.supervisor)}` : ""}</span>
          </div>
          <div id="answerMount"></div>
        </div>
        <p class="portal-nota">Sus respuestas son anónimas: el resultado se muestra como promedio del área.</p>
      </div>`;

    DL.createRuntime({
      mount: document.getElementById("answerMount"),
      survey: state.encuesta,
      works: [],
      respondent: state.instancia.doctor,
      onOpen() {
        DL.api.abrirInstancia(state.instancia.id).catch(() => {});
      },
      async onFinish(respuestas) {
        await DL.api.responder(state.instancia.id, respuestas);
        avisar("¡Gracias! Sus respuestas quedaron registradas.");
        setTimeout(async () => {
          state.vista = "bandeja";
          await cargarBandeja();
        }, 1800);
      },
    });
  }

  /* ==================================================================
     Render y eventos
     ================================================================== */
  function render() {
    if (!state.empleado) return;
    renderCabecera();
    if (state.vista === "responder") return; /* lo dibuja responder() */
    mount.innerHTML = state.vista === "mis" ? renderMisResultados() : renderBandeja();
  }

  document.addEventListener("click", async (event) => {
    const boton = event.target.closest("[data-act]");
    if (!boton) return;
    const { act, arg } = boton.dataset;

    if (act === "salir") return DL_SESION.salir("../");
    if (act === "ver-bandeja") {
      state.vista = "bandeja";
      await cargarBandeja();
      return;
    }
    if (act === "ver-mis") {
      state.vista = "mis";
      render();
      return;
    }
    if (act === "responder") return responder(arg);
  });

  /* La sesión la abre la pantalla de inicio (localhost:3000) */
  (async () => {
    const sesion = DL_SESION.exigir(["colaborador", "supervisor", "admin"], "../");
    if (!sesion) return;
    state.empleado = sesion;
    await cargarBandeja();
  })();
})();
