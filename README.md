# Motor de Encuestas – Digital Labs

Prototipo funcional de encuestas **internas (personal)** y **externas (doctores)** con
envío real por **WhatsApp (Baileys)**, agenda que corre sola y respuestas en vivo.

---

## 1. Cómo arrancarlo

Necesita **Node.js 18 o superior** instalado en la PC.

**Opción fácil (Windows):** doble clic en `iniciar.bat`.

**Opción manual:** desde la carpeta `ENCUESTA DOCTOR` (la que tiene `index.html`):

```
npm install        (solo la primera vez, instala Baileys)
npm start
```

Si prefiere, también funciona entrando primero a `cd server` y corriendo ahí los mismos
dos comandos. Lo que **no** funciona es `npm install` desde `MOTOR ENCUESTAS`: hay que
estar dentro de `ENCUESTA DOCTOR`.

Luego abra **http://localhost:3000/privado/**

> El servidor funciona aunque no haga `npm install`: arranca en **modo simulado**, donde
> todo se ve igual y los mensajes quedan registrados en la bitácora, pero no salen a
> WhatsApp. Con la librería instalada el envío es real.

### Si `npm install` falla

Hay **tres** formas de mandar WhatsApp. El servidor usa la primera que encuentre
configurada, así que basta con que una funcione.

#### Opción 1 — API oficial de Meta (no instala nada)

La más segura si npm da problemas: son llamadas HTTPS que Node ya sabe hacer.

1. Entre a `https://developers.facebook.com/` y cree una app de tipo **Business**.
2. Agregue el producto **WhatsApp**.
3. Copie el **token de acceso temporal** y el **identificador del número de teléfono**.
4. En la sección "Para", agregue y verifique el número **+502 3076 9579**.
5. Arranque así:

```
set WA_TOKEN=EAAG...
set WA_PHONE_ID=123456789
npm start
```

> Meta solo permite texto libre si el destinatario le escribió en las últimas 24 horas.
> Para la prueba: mande un "hola" desde el +502 3076 9579 al número de prueba de Meta y
> ya queda abierta la ventana.

#### Opción 2 — whatsapp-web.js

Si el error de npm son líneas `sh ... dofork: child died` con código `0xC0000142`, es el
`sh.exe` de Git for Windows el que está roto. Se rodea así:

```
npm config set script-shell "C:\Windows\System32\cmd.exe"
npm install whatsapp-web.js --ignore-scripts
set CHROME_PATH=C:\Program Files\Google\Chrome\Application\chrome.exe
npm start
```

`--ignore-scripts` evita la descarga de Chromium (por eso se le indica el Chrome que ya
tiene con `CHROME_PATH`).

#### Opción 3 — Baileys

Falla al clonar `libsignal` de GitHub por SSH. Se arregla así:

```
npm cache clean --force
git config --global url."https://github.com/".insteadOf ssh://git@github.com/
npm install
```

---

## 2. Conectar WhatsApp

En el menú lateral entre a **WhatsApp**. Ahí verá qué canal está usando y qué le falta.

* **Con la API de Meta:** ya aparece conectado; solo pulse **Enviar mensaje de prueba**.
* **Con Baileys o whatsapp-web.js:** escanee el código QR con el número
  **+502 4639 8632** (WhatsApp → Dispositivos vinculados → Vincular un dispositivo).
  El QR también sale en la terminal.

En ambos casos el mensaje de prueba debe llegar a **+502 3076 9579**.

La sesión queda guardada en `server/auth/`, así que no hay que escanear cada vez.
Todos los envíos de prueba van al mismo número; se cambia en `server/config.js`.

---

## 3. Prueba completa de punta a punta

1. **Encuestas → Nueva encuesta → Externa** (o abra la que ya existe).
2. **Paso 2 – Público:** elija el doctor y pulse *Jalar órdenes del mes del doctor*.
3. **Paso 3 – Programación y envío:** día de generación, hora, día de cierre y el mensaje
   de WhatsApp. Para no esperar al día 8 use **Programar prueba** (corre sola en N minutos)
   o **Ejecutar ahora**.
4. **Paso 4 – Preguntas:** categorías, áreas, y por categoría si usa órdenes y con qué
   modalidades (general, mixta, individual).
5. **Envíos:** se genera una encuesta por doctor con sus órdenes y sale el enlace por
   WhatsApp. La tabla se actualiza sola.
6. Abra el enlace desde el celular, responda, y verá el estado pasar a **Completada**.
7. **Respuestas:** lo que contestó cada doctor, con nota, motivos y comentario.
8. **Resultados por área:** promedios y motivos por área responsable.

> El enlace que viaja por WhatsApp usa la **IP local** de la PC (por ejemplo
> `http://192.168.1.20:3000/...`), así que el teléfono debe estar en la misma red Wi-Fi.
> Para probar desde fuera, levante un túnel y arranque con
> `BASE_URL=https://xxxx.ngrok.io npm start`.

---

## 4. Estructura

| Archivo | Qué hace |
| --- | --- |
| `server/server.js` | Servidor HTTP + API. Node puro, sin dependencias. |
| `server/config.js` | Puerto, números de WhatsApp y base del enlace. |
| `server/catalogo.js` | Órdenes de muestra, áreas y plantillas de encuesta. |
| `server/db.js` | Base de datos en `data/db.json`. |
| `server/whatsapp.js` | Canal de WhatsApp: API de Meta, Baileys o whatsapp-web.js. Cae a modo simulado si no hay ninguno. |
| `server/operaciones.js` | Generar, enviar, abrir, responder y cerrar. |
| `server/agenda.js` | JOB mensual: revisa cada 20 s si toca generar o cerrar. |
| `assets/engine.js` | Motor compartido: modelo, flujo y runtime de la encuesta. |
| `assets/client.js` | Vista pública del doctor. |
| `privado/admin.js` | Sistema privado: asistente, editor tipo Forms, envíos y respuestas. |

Todas las dependencias son opcionales. Con la API de Meta no hace falta instalar nada;
las librerías (Baileys / whatsapp-web.js) y `qrcode` solo se necesitan para el canal por
QR. El resto es Node y JavaScript de navegador, sin librerías.

---

## 5. Qué configura el editor

**Por categoría:** título, si está activa, si se evalúa sobre trabajos, qué modalidades
permite (general / mixta / individual) y si el doctor puede elegir qué dimensiones evaluar
en cada orden.

**Por pregunta:** texto, ayuda, tipo, obligatoria, **área responsable**, aplicación a
trabajos, y las reglas de estrellas:

* Umbral de nota baja (menor a 3, 4 o 5).
* **1–3 ★** → motivo obligatorio, comentario obligatorio y la pregunta *"¿se relaciona con
  algún caso en particular?"* con selección de órdenes.
* **4–5 ★** → aspectos valorados y comentario, ambos opcionales.
* Catálogos editables de oportunidades de mejora y aspectos valorados.

---

## 6. Modalidades

* **General:** una calificación aplica a todos los trabajos del período.
* **Mixta:** el doctor marca los trabajos que comparten nota, los califica juntos y luego
  evalúa uno por uno los restantes.
* **Individual:** cada orden se evalúa por separado.

---

## 7. Datos

Todo vive en `data/db.json` (encuestas, envíos, respuestas y bitácora de mensajes).
Para empezar de cero: **Restaurar demo** en el menú lateral, o borre ese archivo.
La sesión de WhatsApp está en `server/auth/`; bórrela para vincular otro número.

---

## 8. Enlaces útiles

* `http://localhost:3000/privado/` – sistema privado
* `http://localhost:3000/doctor/index.html?i=<id de envío>` – encuesta de un doctor
* `http://localhost:3000/doctor/index.html?s=<id de encuesta>` – encuesta suelta para probar

---

## 9. Ponerlo en un servidor (Docker)

```
cp .env.example .env      # y edite BASE_URL y el canal de WhatsApp
docker compose up -d --build
docker compose logs -f
```

Queda en `http://<servidor>:3000/privado/`.

### Qué poner en `.env`

* **`BASE_URL`** — la URL pública. Es la que viaja dentro del mensaje de WhatsApp, así que
  el doctor tiene que poder abrirla desde su teléfono. Si la deja apuntando a `localhost`
  o a una IP interna, el servidor se lo advierte al arrancar.
* **Canal de WhatsApp** — elija uno:
  * `WA_TOKEN` + `WA_PHONE_ID` → API oficial de Meta. **Es la recomendada en servidor:**
    no usa Chromium, no hay QR y la sesión no se cae.
  * Ambos vacíos → usa whatsapp-web.js con el Chromium que ya trae la imagen. Hay que
    entrar una vez a `/privado/` → WhatsApp y escanear el QR.

### Datos que se conservan

Tres volúmenes, para que un reinicio no borre nada:

| Volumen | Contiene |
| --- | --- |
| `encuestas-datos` | Encuestas, envíos, respuestas y bitácora (`data/db.json`) |
| `encuestas-sesion` | Sesión de whatsapp-web.js (evita reescanear el QR) |
| `encuestas-sesion-baileys` | Sesión de Baileys, si lo llegara a usar |

Respaldo:

```
docker run --rm -v encuestas-datos:/d -v $PWD:/b alpine tar czf /b/respaldo.tgz -C /d .
```

### HTTPS con dominio

El contenedor habla HTTP simple; ponga un proxy delante. Con Caddy son tres líneas y el
certificado es automático:

```
encuestas.sudominio.com {
    reverse_proxy localhost:3000
}
```

Luego ponga `BASE_URL=https://encuestas.sudominio.com` en el `.env` y reinicie con
`docker compose up -d`.

### Notas de la imagen

* Base `node:20-bookworm-slim` con Chromium del sistema; Puppeteer no descarga nada.
* Corre como usuario `node`, no como root.
* `tini` como init, para que Chrome no deje procesos zombis.
* `shm_size: 1gb` en el compose: sin eso Chromium se cae dentro de Docker.
* Baileys se omite en la imagen (`--omit=optional`) porque necesita git y no hace falta.
* Healthcheck contra `/api/estado`; `docker compose ps` muestra el estado real.
