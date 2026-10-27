# Zigga

Zigga es un CRM para un equipo de ventas con dos áreas (FTD y Retención) que empuja al vendedor a seguir cada lead hasta cerrarlo:

- **Modo Siguiente**: un lead a la vez, en orden de urgencia, con resultados de un toque (No contestó · Volver a llamar · Interesado · Reunión · Perdido) que registran el historial y programan el siguiente paso solos.
- **Cronómetro de primer contacto** y **reparto automático** de leads por turnos con tope diario y reasignación si nadie los toca.
- **Prioridad automática** (0–100): reglas por formulario y perfil del lead + historial de cierres + frescura − señales de calidad.
- **Tablero kanban**, lista con filtros, ficha con historial, tareas y recordatorios, métricas y **marcador del equipo** con modo TV.
- **Zigga IA** (opcional, con la API de Claude): chat que consulta la base en vivo ("Pregúntale a Zigga") y **coach diario** para cada vendedor e informe del equipo para el administrador.
- Acceso por área (FTD / Retención) por usuario; roles administrador y vendedor.
- Entrada de leads desde Meta Lead Ads: archivo de export, sincronización automática con el Graph API o webhook.

Sin dependencias externas de base de datos: Node 22 + Express + SQLite (módulo `node:sqlite`). Todo vive en un archivo dentro de `DATA_DIR`.

## Correr en local

```bash
npm install
ADMIN_PASSWORD=mi-clave npm start
# http://localhost:3000  → usuario admin / mi-clave
```

## Desplegar en Railway

1. Nuevo proyecto → **Deploy from GitHub repo** → este repositorio (Railway usa el `Dockerfile`).
2. En el servicio → **Volumes** → agrega un volumen montado en `/data` (ahí queda la base de datos).
3. **Variables**: `ADMIN_PASSWORD` (obligatoria la primera vez), `WEBHOOK_KEY` (opcional), `META_ACCESS_TOKEN` + `META_FORM_IDS` (opcional, para que los leads lleguen solos cada 5 minutos), `ANTHROPIC_API_KEY` (opcional, activa el chat y el coach; `ANTHROPIC_MODEL` por defecto `claude-sonnet-5-5`; `COACH_HORA` por defecto 6).
4. **Settings → Networking → Generate domain** para obtener la URL pública.

Cada vez que haces push a la rama principal, Railway vuelve a desplegar.

## Entrada de leads desde Meta

- **Archivo**: en *Importar*, sube el export (.xls, .csv o .xlsx) del Centro de clientes potenciales. Los leads se deduplican por su ID de Meta.
- **Automático**: define `META_ACCESS_TOKEN` (token de usuario del sistema con `leads_retrieval` y `pages_show_list` sobre la página) y `META_FORM_IDS`. El servidor consulta `/{form_id}/leads` cada `META_POLL_MINUTES` minutos y crea solo los nuevos.
- **Webhook**: `POST /api/webhooks/leads?key=WEBHOOK_KEY` con JSON. Acepta el lead tal como lo entrega Meta (`field_data`) o un objeto simple `{ "nombre", "correo", "whatsapp", "pais", "ciudad", "respuestas": {} }`. Útil desde n8n.

### Repetidos (la misma persona vuelve a llenar el formulario)

Por cualquier vía de entrada, si el WhatsApp o el correo ya están en la base **no se crea otro lead**: se anota en la ficha original (historial y tabla `repeticiones`, con lo que respondió esta vez), se le crea la tarea «Te volvió a escribir» al responsable y se le manda la notificación del navegador (a los administradores si no hay responsable). Si el original está en Retención se marca como «Cliente existente». Al crear un lead a mano que ya existe, Zigga lo avisa y ofrece anotarlo en el original; solo el administrador puede crearlo de todas formas.

## Roles

- **Administrador**: ve todo, asigna leads, crea usuarios, cambia etapas y motivos, importa y exporta.
- **Vendedor**: ve y trabaja solo los leads que tiene asignados; crea leads (quedan asignados a él) y tareas.

## API (resumen)

`POST /api/login` · `GET /api/bootstrap` · `POST|PATCH|DELETE /api/leads[/:id]` · `POST /api/leads/:id/retencion` · `POST /api/leads/assign` · `GET /api/leads/:id/activities` · `POST /api/leads/:id/notas` · `POST|PATCH|DELETE /api/tasks[/:id]` · `POST|PATCH /api/users[/:id]` · `PUT /api/settings` · `POST /api/import` · `POST /api/meta/sync` · `GET /api/export.csv`
