/* ---------------------------------------------------------------
   Base de datos en un solo archivo JSON: data/db.json
   Sin dependencias. Escritura sincrona (el volumen es pequeno).
   --------------------------------------------------------------- */
const fs = require("fs");
const path = require("path");
const catalogo = require("./catalogo");

const CARPETA = path.join(__dirname, "..", "data");
const ARCHIVO = path.join(CARPETA, "db.json");

let datos = null;

function inicial() {
  return { encuestas: catalogo.semilla(), instancias: [], mensajes: [] };
}

function cargar() {
  if (datos) return datos;
  try {
    if (fs.existsSync(ARCHIVO)) {
      datos = JSON.parse(fs.readFileSync(ARCHIVO, "utf8"));
      datos.encuestas = datos.encuestas || [];
      datos.instancias = datos.instancias || [];
      datos.mensajes = datos.mensajes || [];
      return datos;
    }
  } catch (error) {
    console.error("[db] archivo dañado, se recrea:", error.message);
  }
  datos = inicial();
  guardar();
  return datos;
}

function guardar() {
  if (!fs.existsSync(CARPETA)) fs.mkdirSync(CARPETA, { recursive: true });
  fs.writeFileSync(ARCHIVO, JSON.stringify(datos, null, 2), "utf8");
}

function reiniciar() {
  datos = inicial();
  guardar();
  return datos;
}

/* ---------- encuestas ---------- */
const encuestas = {
  listar: () => cargar().encuestas,
  obtener: (id) => cargar().encuestas.find((e) => e.id === id) || null,
  crear(encuesta) {
    cargar().encuestas.unshift(encuesta);
    guardar();
    return encuesta;
  },
  guardar(encuesta) {
    const lista = cargar().encuestas;
    const i = lista.findIndex((e) => e.id === encuesta.id);
    if (i >= 0) lista[i] = encuesta;
    else lista.unshift(encuesta);
    guardar();
    return encuesta;
  },
  borrar(id) {
    const d = cargar();
    d.encuestas = d.encuestas.filter((e) => e.id !== id);
    d.instancias = d.instancias.filter((i) => i.surveyId !== id);
    guardar();
  },
};

/* ---------- instancias (una encuesta por doctor) ---------- */
const instancias = {
  listar: (surveyId) => {
    const lista = cargar().instancias;
    return surveyId ? lista.filter((i) => i.surveyId === surveyId) : lista;
  },
  obtener: (id) => cargar().instancias.find((i) => i.id === id) || null,
  guardar(instancia) {
    const lista = cargar().instancias;
    const i = lista.findIndex((x) => x.id === instancia.id);
    if (i >= 0) lista[i] = instancia;
    else lista.push(instancia);
    guardar();
    return instancia;
  },
  reemplazarPeriodo(surveyId, periodo, nuevas) {
    const d = cargar();
    d.instancias = d.instancias.filter((i) => !(i.surveyId === surveyId && i.period === periodo));
    d.instancias.push(...nuevas);
    guardar();
    return nuevas;
  },
};

/* ---------- bitacora de mensajes ---------- */
const mensajes = {
  listar: () => cargar().mensajes.slice(-200).reverse(),
  registrar(mensaje) {
    const d = cargar();
    d.mensajes.push(Object.assign({ fecha: new Date().toISOString() }, mensaje));
    if (d.mensajes.length > 500) d.mensajes = d.mensajes.slice(-500);
    guardar();
    return mensaje;
  },
};

module.exports = { cargar, guardar, reiniciar, encuestas, instancias, mensajes, ARCHIVO };
