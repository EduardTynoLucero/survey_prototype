/* ---------------------------------------------------------------
   Servidor del Motor de Encuestas. Node puro, sin dependencias.
   Sirve el prototipo y expone la API que usan el sistema privado
   y la vista publica del doctor.

   Arranque:   node server/server.js      (o  cd server && npm start)
   --------------------------------------------------------------- */
const http = require("http");
const fs = require("fs");
const path = require("path");
const url = require("url");

const config = require("./config");
const catalogo = require("./catalogo");
const personal = require("./personal");
const db = require("./db");
const whatsapp = require("./whatsapp");
const operaciones = require("./operaciones");
const agenda = require("./agenda");
const resultadosDoctores = require("./resultadosDoctores");
const seguimiento = require("./seguimiento");
const datosPrueba = require("./datosPrueba");

const RAIZ = path.join(__dirname, "..");

/* Se pone en false si no se puede escribir en data/: el healthcheck falla
   y el panel de Dokploy marca el contenedor como no saludable. */
let sano = true;

const TIPOS = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

/* ------------------------------------------------------------------
   Utilidades HTTP
   ------------------------------------------------------------------ */
function json(res, datos, codigo = 200) {
  const cuerpo = JSON.stringify(datos);
  res.writeHead(codigo, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(cuerpo);
}

function leerCuerpo(req) {
  return new Promise((resolve) => {
    let datos = "";
    req.on("data", (parte) => {
      datos += parte;
      if (datos.length > 5e6) req.destroy();
    });
    req.on("end", () => {
      try {
        resolve(datos ? JSON.parse(datos) : {});
      } catch (error) {
        resolve({});
      }
    });
  });
}

function estatico(res, ruta) {
  const limpia = decodeURIComponent(ruta.split("?")[0]);
  let archivo = path.join(RAIZ, limpia === "/" ? "index.html" : limpia);
  if (!archivo.startsWith(RAIZ)) return json(res, { error: "ruta inválida" }, 400);
  if (archivo.includes(path.join(RAIZ, "server")) || archivo.includes(path.join(RAIZ, "data"))) {
    return json(res, { error: "no disponible" }, 403);
  }
  if (fs.existsSync(archivo) && fs.statSync(archivo).isDirectory()) {
    archivo = path.join(archivo, "index.html");
  }
  if (!fs.existsSync(archivo)) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    return res.end("No encontrado");
  }
  const tipo = TIPOS[path.extname(archivo).toLowerCase()] || "application/octet-stream";
  res.writeHead(200, { "Content-Type": tipo, "Cache-Control": "no-store" });
  fs.createReadStream(archivo).pipe(res);
}

/* ------------------------------------------------------------------
   API
   ------------------------------------------------------------------ */
async function api(req, res, ruta, consulta) {
  const partes = ruta.split("/").filter(Boolean); // ["api", ...]
  const cuerpo = ["POST", "PUT", "PATCH"].includes(req.method) ? await leerCuerpo(req) : {};

  /* ---- estado general ---- */
  if (partes[1] === "estado" && req.method === "GET") {
    if (!sano) {
      return json(res, { error: "El servidor no puede escribir en data/. Revise el volumen." }, 503);
    }
    return json(res, {
      whatsapp: {
        disponible: whatsapp.estado.disponible,
        proveedor: whatsapp.estado.proveedor,
        necesitaQR: whatsapp.estado.necesitaQR,
        conectado: whatsapp.estado.conectado,
        conectando: whatsapp.estado.conectando,
        numero: whatsapp.estado.numero,
        qrImagen: whatsapp.estado.qrImagen,
        qrTexto: whatsapp.estado.qrTexto,
        error: whatsapp.estado.ultimoError,
      },
      destino: config.NUMERO_DESTINO,
      origen: config.NUMERO_ORIGEN,
      baseUrl: config.BASE_URL,
      areas: catalogo.AREAS,
    });
  }

  /* ---- personal del laboratorio ---- */
  if (partes[1] === "empleados" && !partes[2] && req.method === "GET") {
    const gente = personal.listar().map((persona) => {
      const suyas = db.instancias.listar().filter((i) => i.employeeId === persona.id && i.period !== "libre");
      return Object.assign({}, persona, {
        _asignadas: suyas.length,
        _respondidas: suyas.filter((i) => i.answers && i.answers.length).length,
      });
    });
    return json(res, gente);
  }

  if (partes[1] === "empleados" && partes[2] && req.method === "GET") {
    const persona = personal.obtener(decodeURIComponent(partes[2]));
    if (!persona) return json(res, { error: "colaborador no encontrado" }, 404);

    /* Sus encuestas internas, para el apartado de encuestas de la ficha */
    const suyas = db.instancias
      .listar()
      .filter((i) => i.employeeId === persona.id && i.period !== "libre")
      .map((instancia) => {
        const encuesta = db.encuestas.obtener(instancia.surveyId);
        const notas = (instancia.answers || []).filter((r) => r.calificacion).map((r) => r.calificacion);
        return {
          instanceId: instancia.id,
          surveyName: encuesta ? encuesta.name : "Encuesta eliminada",
          period: instancia.periodLabel,
          supervisor: instancia.supervisor || "",
          state: instancia.state,
          respondida: notas.length > 0,
          promedio: notas.length ? (notas.reduce((a, b) => a + b, 0) / notas.length).toFixed(2) : "—",
          finishedAt: instancia.finishedAt,
        };
      });

    return json(res, Object.assign({}, persona, { _encuestas: suyas }));
  }

  /* Quiénes responderían una encuesta interna con esa área y modo */
  if (partes[1] === "respondedores" && req.method === "GET") {
    const area = ((consulta || {}).area || "GERENCIA GENERAL").toString();
    const modo = ((consulta || {}).modo || "Por supervisor").toString();
    return json(res, personal.respondedores(area, modo));
  }

  if (partes[1] === "catalogos" && req.method === "GET") {
    return json(res, {
      areas: personal.AREAS_LAB,
      arbol: personal.areasJerarquia(),
      departamentos: personal.DEPARTAMENTOS,
      municipios: personal.MUNICIPIOS_POR_DEPTO,
      fases: personal.FASES_LAB,
      puestos: [...new Set(personal.listar().map((p) => p.position))].sort(),
    });
  }

  /* ---- resultados de encuestas internas: histórico + motor nuevo ---- */
  if (partes[1] === "resultados" && !partes[2] && req.method === "GET") {
    return json(res, operaciones.resultados().map((r) => Object.assign({}, r, { preguntas: undefined, colaboradores: undefined, comentarios: undefined })));
  }

  if (partes[1] === "resultados" && partes[2] && req.method === "GET") {
    const resultado = operaciones.resultadoDe(decodeURIComponent(partes[2]));
    if (!resultado) return json(res, { error: "resultado no encontrado" }, 404);
    return json(res, resultado);
  }

  /* ---- resultados de encuestas a doctores (externas) ---- */
  /* ---- seguimiento de encuestas a doctores (solo lectura) ---- */
  if (partes[1] === "seguimiento" && partes[2] && req.method === "GET") {
    const filas = seguimiento.envios(partes[2]);
    return filas ? json(res, filas) : json(res, { error: "encuesta no encontrada" }, 404);
  }
  if (partes[1] === "respuestas-doctores" && !partes[2] && req.method === "GET") {
    return json(res, seguimiento.respuestas((consulta || {}).encuesta));
  }
  if (partes[1] === "respuestas-doctores" && partes[2] && req.method === "GET") {
    const detalle = seguimiento.respuesta(partes[2]);
    return detalle ? json(res, detalle) : json(res, { error: "respuesta no encontrada" }, 404);
  }
  if (partes[1] === "historico-doctor" && req.method === "GET") {
    const datos = seguimiento.historico((consulta || {}).doctor || "");
    return datos ? json(res, datos) : json(res, { error: "doctor sin encuestas" }, 404);
  }
  if (partes[1] === "tablero-doctores" && partes[2] === "detalle" && req.method === "GET") {
    const c = consulta || {};
    return json(res, seguimiento.detalleTablero(c, c.grafico || "", c.clave || ""));
  }
  if (partes[1] === "tablero-doctores" && req.method === "GET") {
    return json(res, seguimiento.tablero(consulta || {}));
  }

  if (partes[1] === "resultados-doctores" && !partes[2] && req.method === "GET") {
    return json(res, resultadosDoctores.periodos());
  }

  if (partes[1] === "resultados-doctores" && partes[2] && req.method === "GET") {
    const detalle = resultadosDoctores.detalle(decodeURIComponent(partes[2]));
    if (!detalle) return json(res, { error: "encuesta enviada no encontrada" }, 404);
    return json(res, detalle);
  }

  /* ---- portal del colaborador ---- */
  if (partes[1] === "portal" && partes[2] === "login" && req.method === "POST") {
    const persona = personal.porCorreo(cuerpo.correo);
    if (!persona) return json(res, { error: "No encontramos ese correo en el personal del laboratorio." }, 404);
    return json(res, persona);
  }

  if (partes[1] === "portal" && partes[2] === "personal" && req.method === "GET") {
    return json(res, personal.listar().map((p) => ({
      id: p.id, name: p.name, email: p.email, area: p.area,
      position: p.position, supervisor: p.supervisor, role: p.role,
    })));
  }

  if (partes[1] === "portal" && partes[2] && partes[3] === "bandeja" && req.method === "GET") {
    const persona = personal.obtener(decodeURIComponent(partes[2]));
    if (!persona) return json(res, { error: "colaborador no encontrado" }, 404);

    const bandeja = db.instancias
      .listar()
      .filter((i) => i.employeeId === persona.id && i.period !== "libre")
      .map((instancia) => {
        const encuesta = db.encuestas.obtener(instancia.surveyId);
        return {
          instanceId: instancia.id,
          surveyId: instancia.surveyId,
          surveyName: encuesta ? encuesta.name : "Encuesta eliminada",
          subtype: encuesta ? encuesta.subtype : "",
          description: encuesta ? encuesta.description : "",
          period: instancia.periodLabel,
          supervisor: instancia.supervisor || "",
          state: instancia.state,
          respondida: Boolean(instancia.answers && instancia.answers.length),
          finishedAt: instancia.finishedAt,
          preguntas: encuesta ? (encuesta.sections || []).reduce((t, sec) => t + (sec.questions || []).length, 0) : 0,
        };
      })
      .sort((a, b) => Number(a.respondida) - Number(b.respondida));

    /* Encuestas libres que su jefe le hizo a su equipo */
    const jefe = personal.jefeDe(persona.id);
    const formularios = jefe
      ? db.encuestas.listar()
          .filter((e) => catalogo.esLibre(e) && e.ownerId === jefe.id && e.status !== "Borrador")
          .map((e) => {
            const suya = db.instancias.listar(e.id).find((i) => i.employeeId === persona.id);
            const respondida = Boolean(suya);
            const abierta = resultadosDoctores.disponible(e);
            const prog = e.schedule || {};
            return {
              surveyId: e.id,
              surveyName: e.name,
              description: e.description || "",
              owner: jefe.name,
              anonymous: e.anonymous !== false,
              availableTo: prog.endDate ? `${prog.endDate} ${String(prog.endTime || "23:59").slice(0, 5)}` : "",
              open: abierta.ok,
              reason: abierta.motivo,
              respondida,
              finishedAt: suya ? suya.finishedAt : "",
              preguntas: (e.sections || []).reduce((t, sec) => t + (sec.questions || []).length, 0),
            };
          })
          .filter((f) => f.open || f.respondida)
      : [];

    /* Si es supervisor, también ve el resultado de su equipo */
    const mios = persona.supervisor
      ? operaciones.resultados().filter((r) => r.supervisor === persona.name)
      : [];

    return json(res, { empleado: persona, bandeja, resultados: mios, formularios });
  }

  /* Encuestas libres de un jefe para su equipo */
  if (partes[1] === "portal" && partes[2] && partes[3] === "equipo" && req.method === "GET") {
    const jefe = personal.obtener(decodeURIComponent(partes[2]));
    if (!jefe) return json(res, { error: "colaborador no encontrado" }, 404);
    const equipo = personal.equipoDe(jefe.id);
    const formularios = db.encuestas
      .listar()
      .filter((e) => catalogo.esLibre(e) && e.ownerId === jefe.id)
      .map((e) => {
        const lista = db.instancias.listar(e.id);
        const prog = e.schedule || {};
        return {
          id: e.id,
          name: e.name,
          description: e.description || "",
          status: e.status,
          anonymous: e.anonymous !== false,
          createdAt: e.createdAt || "",
          startsAt: prog.startDate ? `${prog.startDate} ${String(prog.startTime || "00:00").slice(0, 5)}` : "",
          availableTo: prog.endDate ? `${prog.endDate} ${String(prog.endTime || "23:59").slice(0, 5)}` : "",
          open: resultadosDoctores.disponible(e).ok,
          preguntas: (e.sections || []).reduce((t, sec) => t + (sec.questions || []).length, 0),
          respondidas: lista.filter((i) => equipo.some((m) => m.id === i.employeeId)).length,
          equipo: equipo.length,
        };
      });
    return json(res, {
      equipo: equipo.map((m) => ({ id: m.id, name: m.name, position: m.position, area: m.area, email: m.email })),
      formularios,
    });
  }

  if (partes[1] === "trabajos" && partes[2] && partes[3] === "encuesta" && req.method === "GET") {
    return json(res, operaciones.encuestasDeTrabajo(decodeURIComponent(partes[2])));
  }

  if (partes[1] === "trabajos" && req.method === "GET") {
    return json(res, catalogo.TRABAJOS);
  }

  if (partes[1] === "mensajes" && req.method === "GET") {
    return json(res, db.mensajes.listar());
  }

  /* Datos de prueba: seis meses de envíos y respuestas a doctores */
  if (partes[1] === "datos-prueba" && req.method === "POST") {
    return json(res, datosPrueba.cargar());
  }
  if (partes[1] === "datos-prueba" && req.method === "DELETE") {
    return json(res, datosPrueba.quitar());
  }

  if (partes[1] === "reiniciar" && req.method === "POST") {
    db.reiniciar();
    return json(res, { ok: true });
  }

  /* ---- WhatsApp ---- */
  if (partes[1] === "whatsapp") {
    if (partes[2] === "prueba" && req.method === "POST") {
      const texto = cuerpo.texto || `Prueba del Motor de Encuestas Digital Labs — ${operaciones.ahora()}`;
      const salida = await whatsapp.enviar(texto, { tipo: "prueba" });
      return json(res, salida);
    }
    if (partes[2] === "conectar" && req.method === "POST") {
      whatsapp.conectar();
      return json(res, { ok: true });
    }
    if (partes[2] === "salir" && req.method === "POST") {
      await whatsapp.cerrarSesion();
      return json(res, { ok: true });
    }
  }

  /* Día de generación y día de cierre salen de la ventana */
  function sincronizarAgenda(encuesta) {
    const d = agenda.derivar(encuesta);
    encuesta.schedule.generationDay = d.dia;
    encuesta.schedule.time = d.desde;
    encuesta.schedule.closeDay = d.fin ? d.fin.getDate() : encuesta.schedule.closeDay;
    encuesta.schedule.active = d.repite;
    encuesta.schedule.nextRun = agenda.proximaEjecucion(encuesta);
    encuesta.schedule.firstRun = agenda.primeraEjecucion(encuesta);
    return encuesta;
  }

  /* ---- plantilla: encuesta nueva en blanco que NO se guarda ---- */
  if (partes[1] === "plantilla" && req.method === "POST") {
    const encuesta = catalogo.nuevaEncuesta(cuerpo.classification === "Interna" ? "Interna" : "Externa");
    catalogo.aplicarPeriodoAuto(encuesta);
    sincronizarAgenda(encuesta);
    return json(res, encuesta);
  }

  /* ---- encuestas ---- */
  if (partes[1] === "encuestas") {
    const id = partes[2];

    if (!id && req.method === "GET") {
      const lista = db.encuestas.listar().map((encuesta) =>
        Object.assign({}, encuesta, {
          schedule: Object.assign({}, encuesta.schedule, {
            firstRun: agenda.primeraEjecucion(encuesta),
            nextRun: agenda.proximaEjecucion(encuesta),
          }),
          _instancias: db.instancias.listar(encuesta.id).length,
          _respondidas: db.instancias.listar(encuesta.id).filter((i) => i.answers && i.answers.length).length,
          _proxima: agenda.proximaEjecucion(encuesta),
          _prueba: agenda.pruebaDe(encuesta.id),
        })
      );
      return json(res, lista);
    }

    if (!id && req.method === "POST") {
      const completa = cuerpo && Array.isArray(cuerpo.sections);
      const encuesta = completa
        ? Object.assign(catalogo.nuevaEncuesta(cuerpo.classification === "Interna" ? "Interna" : "Externa"), cuerpo)
        : catalogo.nuevaEncuesta(cuerpo.classification === "Interna" ? "Interna" : "Externa");
      if (!encuesta.id || db.encuestas.obtener(encuesta.id)) encuesta.id = catalogo.uid("enc");
      catalogo.aplicarPeriodoAuto(encuesta);
      sincronizarAgenda(encuesta);
      db.encuestas.crear(encuesta);
      return json(res, encuesta, 201);
    }

    const encuesta = db.encuestas.obtener(id);
    if (!encuesta) return json(res, { error: "encuesta no encontrada" }, 404);

    if (!partes[3]) {
      if (req.method === "GET") {
        return json(res, Object.assign({}, encuesta, {
          schedule: Object.assign({}, encuesta.schedule, {
            firstRun: agenda.primeraEjecucion(encuesta),
            nextRun: agenda.proximaEjecucion(encuesta),
          }),
        }));
      }
      if (req.method === "PUT") {
        const actualizada = Object.assign({}, encuesta, cuerpo, { id: encuesta.id });
        /* La marca de la ultima corrida de recordatorios la pone la agenda,
           no el navegador: si se guarda sin ella el recordatorio podria
           repetirse en la misma hora. */
        actualizada.reminders = Object.assign({}, encuesta.reminders, cuerpo.reminders, {
          lastMark: (encuesta.reminders || {}).lastMark || "",
        });
        catalogo.aplicarPeriodoAuto(actualizada);
        sincronizarAgenda(actualizada);
        db.encuestas.guardar(actualizada);
        return json(res, actualizada);
      }
      if (req.method === "DELETE") {
        agenda.cancelarPrueba(id);
        db.encuestas.borrar(id);
        return json(res, { ok: true });
      }
    }

    if (partes[3] === "duplicar" && req.method === "POST") {
      const copia = JSON.parse(JSON.stringify(encuesta));
      copia.id = catalogo.uid("cop");
      copia.name = `${copia.name} (copia)`;
      copia.status = "Borrador";
      copia.schedule.active = false;
      db.encuestas.crear(copia);
      return json(res, copia, 201);
    }

    if (partes[3] === "generar" && req.method === "POST") {
      const instancias = operaciones.generar(encuesta);
      return json(res, instancias);
    }

    if (partes[3] === "enviar" && req.method === "POST") {
      const salida = await operaciones.enviar(encuesta);
      return json(res, salida);
    }

    if (partes[3] === "ejecutar" && req.method === "POST") {
      const salida = await agenda.ejecutarGeneracion(encuesta, "manual");
      return json(res, { instancias: salida.instancias.length, envios: salida.envios, agregadas: salida.agregadas });
    }

    /* Recordatorio manual a los que no han contestado */
    if (partes[3] === "recordar" && req.method === "POST") {
      const salida = await operaciones.recordar(encuesta, { forzar: true });
      return json(res, { enviados: salida.enviados || [], motivo: salida.motivo || "" });
    }

    /* Cuántos esperan recordatorio ahora mismo */
    if (partes[3] === "recordatorios" && req.method === "GET") {
      return json(res, {
        pendientes: operaciones.pendientesDeRecordatorio(encuesta, { forzar: true }).length,
      });
    }

    /* Solo lo que falta: no toca lo ya generado ni lo ya respondido */
    if (partes[3] === "completar" && req.method === "POST") {
      const salida = await agenda.ejecutarGeneracion(encuesta, "manual (no enviados)", { soloNoEnviados: true });
      return json(res, { agregadas: salida.agregadas, envios: salida.envios });
    }

    if (partes[3] === "cerrar" && req.method === "POST") {
      const cerradas = operaciones.cerrar(encuesta);
      return json(res, { cerradas });
    }

    if (partes[3] === "prueba" && req.method === "POST") {
      const cuando = agenda.programarPrueba(encuesta, cuerpo.minutos);
      return json(res, { cuando: cuando.toISOString() });
    }

    if (partes[3] === "instancias" && req.method === "GET") {
      return json(res, db.instancias.listar(id));
    }

    if (partes[3] === "respuestas" && req.method === "GET") {
      return json(res, operaciones.respuestas(id));
    }

    if (partes[3] === "mensaje" && req.method === "GET") {
      return json(res, { texto: operaciones.armarMensaje(encuesta, null) });
    }

    /* ---- Formulario libre: respuestas y llenado por enlace ---- */
    if (partes[3] === "formulario" && req.method === "GET") {
      if (!catalogo.esLibre(encuesta)) return json(res, { error: "la encuesta no es un formulario libre" }, 400);
      return json(res, resultadosDoctores.detalleLibre(encuesta));
    }
    if (partes[3] === "disponible" && req.method === "GET") {
      if (encuesta.ownerId) {
        const jefe = personal.obtener(encuesta.ownerId);
        return json(res, { ok: false, motivo: `Esta encuesta es solo para el equipo de ${jefe ? jefe.name : "su jefe"}. Respóndala desde "Mis encuestas" en el sistema.` });
      }
      return json(res, resultadosDoctores.disponible(encuesta));
    }
    if (partes[3] === "libre" && req.method === "POST") {
      if (!catalogo.esLibre(encuesta)) return json(res, { error: "la encuesta no es un formulario libre" }, 400);
      const puede = resultadosDoctores.disponible(encuesta);
      if (!puede.ok) return json(res, { error: puede.motivo }, 409);
      const respuestas = Array.isArray(cuerpo.respuestas) ? cuerpo.respuestas : [];
      if (!respuestas.length) return json(res, { error: "sin respuestas" }, 400);
      const cuantas = db.instancias.listar(encuesta.id).length;
      let nombre = String(cuerpo.nombre || "").trim().slice(0, 120);
      let empleado = "";
      /* Encuesta de equipo: solo la responde el equipo del jefe, una vez cada uno */
      if (encuesta.ownerId) {
        const persona = personal.obtener(String(cuerpo.employeeId || ""));
        if (!persona || !personal.equipoDe(encuesta.ownerId).some((m) => m.id === persona.id)) {
          return json(res, { error: "Esta encuesta es solo para el equipo de quien la creó." }, 403);
        }
        if (db.instancias.listar(encuesta.id).some((i) => i.employeeId === persona.id)) {
          return json(res, { error: "Usted ya respondió esta encuesta." }, 409);
        }
        empleado = persona.id;
        nombre = encuesta.anonymous === false ? persona.name : "";
      }
      const cuando = new Date().toLocaleString("es-GT", { hour12: false });
      const instancia = {
        id: catalogo.uid("lib"),
        surveyId: encuesta.id,
        period: "libre",
        periodLabel: encuesta.ownerId ? "Encuesta de equipo" : "Formulario libre",
        doctor: nombre || `Respuesta ${cuantas + 1}`,
        clinic: "",
        employeeId: empleado,
        workIds: [],
        state: "Completada",
        generatedAt: cuando,
        sentAt: "",
        openedAt: cuando,
        finishedAt: cuando,
        answers: respuestas,
        reminders: 0,
        lastReminderAt: "",
      };
      db.instancias.guardar(instancia);
      return json(res, { ok: true, id: instancia.id }, 201);
    }
  }

  /* ---- instancias ---- */
  if (partes[1] === "instancias") {
    const id = partes[2];
    if (!id && req.method === "GET") {
      return json(res, db.instancias.listar(consulta.encuesta));
    }
    const instancia = db.instancias.obtener(id);
    if (!instancia) return json(res, { error: "envío no encontrado" }, 404);

    if (!partes[3] && req.method === "GET") {
      const encuesta = db.encuestas.obtener(instancia.surveyId);
      return json(res, {
        instancia,
        encuesta,
        trabajos: datosPrueba.todosLosTrabajos().filter((t) => instancia.workIds.includes(t.id)),
      });
    }
    if (partes[3] === "abrir" && req.method === "POST") {
      return json(res, operaciones.abrir(instancia));
    }
    if (partes[3] === "responder" && req.method === "POST") {
      if (instancia.state === "Completada" || String(instancia.state).startsWith("Cerrada")) {
        return json(res, { error: "La encuesta ya no admite respuestas", estado: instancia.state }, 409);
      }
      const actualizada = await operaciones.responder(instancia, cuerpo.respuestas || []);
      return json(res, actualizada);
    }
    if (partes[3] === "mensaje" && req.method === "GET") {
      const encuesta = db.encuestas.obtener(instancia.surveyId);
      return json(res, { texto: operaciones.armarMensaje(encuesta, instancia) });
    }
  }

  /* ---- respuestas globales ---- */
  if (partes[1] === "respuestas" && req.method === "GET") {
    return json(res, operaciones.respuestas(consulta.encuesta));
  }

  return json(res, { error: "ruta no encontrada", ruta }, 404);
}

/* ------------------------------------------------------------------
   Arranque
   ------------------------------------------------------------------ */
const servidor = http.createServer(async (req, res) => {
  const partes = url.parse(req.url, true);
  try {
    if (partes.pathname.startsWith("/api/")) {
      return await api(req, res, partes.pathname, partes.query);
    }
    return estatico(res, partes.pathname);
  } catch (error) {
    console.error("[servidor]", error);
    return json(res, { error: error.message }, 500);
  }
});

function verificarEscritura() {
  try {
    db.cargar();
    return true;
  } catch (error) {
    console.log("\n  ✖ NO SE PUEDE ESCRIBIR EN data/");
    console.log(`     ${error.message}`);
    console.log("     El contenedor corre como usuario 'node' (uid 1000). Si montó un");
    console.log("     volumen sobre /app/data, use un volumen con nombre (Volume Mount),");
    console.log("     no un bind mount a una carpeta del servidor. Si tiene que ser bind:");
    console.log("        sudo chown -R 1000:1000 <carpeta-del-host>\n");
    return false;
  }
}

servidor.listen(config.PUERTO, () => {
  sano = verificarEscritura();
  console.log("\n==============================================");
  console.log("  MOTOR DE ENCUESTAS — Digital Labs");
  console.log("==============================================");
  console.log(`  Sistema privado : http://localhost:${config.PUERTO}/privado/`);
  console.log(`  Vista del doctor: http://localhost:${config.PUERTO}/doctor/`);
  console.log(`  Enlace que se envía: ${config.BASE_URL}/doctor/index.html?i=…`);
  console.log(`  Envío de prueba : +${config.NUMERO_DESTINO}`);
  console.log(`  Cuenta esperada : +${config.NUMERO_ORIGEN}`);
  console.log(`  Datos           : data/db.json`);
  console.log("==============================================\n");
  const privada = /localhost|127\.0\.0\.1|^https?:\/\/(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(config.BASE_URL);
  if (privada && process.env.NODE_ENV === "production") {
    console.log("  ⚠  BASE_URL no es pública: los enlaces que se envíen por WhatsApp");
    console.log("     no se podrán abrir desde fuera. Defina BASE_URL con su dominio.\n");
  }
  if (!sano) return;
  agenda.iniciar();
  whatsapp.conectar();
});
