# Zigga

Zigga es un CRM para un equipo de ventas con dos áreas (FTD y Retención): tablero kanban por etapas, lista con filtros, ficha por lead con historial, tareas y recordatorios, métricas, equipo con roles (administrador / vendedor) y entrada de leads desde Meta Lead Ads (archivo de export, sincronización automática con el Graph API o webhook).

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
3. **Variables**: `ADMIN_PASSWORD` (obligatoria la primera vez), `WEBHOOK_KEY` (opcional), `META_ACCESS_TOKEN` + `META_FORM_IDS` (opcional, para que los leads lleguen solos cada 5 minutos).
4. **Settings → Networking → Generate domain** para obtener la URL pública.

Cada vez que haces push a la rama principal, Railway vuelve a desplegar.

## Entrada de leads desde Meta

- **Archivo**: en *Importar*, sube el export (.xls, .csv o .xlsx) del Centro de clientes potenciales. Los leads se deduplican por su ID de Meta.
- **Automático**: define `META_ACCESS_TOKEN` (token de usuario del sistema con `leads_retrieval` y `pages_show_list` sobre la página) y `META_FORM_IDS`. El servidor consulta `/{form_id}/leads` cada `META_POLL_MINUTES` minutos y crea solo los nuevos.
- **Webhook**: `POST /api/webhooks/leads?key=WEBHOOK_KEY` con JSON. Acepta el lead tal como lo entrega Meta (`field_data`) o un objeto simple `{ "nombre", "correo", "whatsapp", "pais", "ciudad", "respuestas": {} }`. Útil desde n8n.

## Roles

- **Administrador**: ve todo, asigna leads, crea usuarios, cambia etapas y motivos, importa y exporta.
- **Vendedor**: ve y trabaja solo los leads que tiene asignados; crea leads (quedan asignados a él) y tareas.

## API (resumen)

`POST /api/login` · `GET /api/bootstrap` · `POST|PATCH|DELETE /api/leads[/:id]` · `POST /api/leads/:id/retencion` · `POST /api/leads/assign` · `GET /api/leads/:id/activities` · `POST /api/leads/:id/notas` · `POST|PATCH|DELETE /api/tasks[/:id]` · `POST|PATCH /api/users[/:id]` · `PUT /api/settings` · `POST /api/import` · `POST /api/meta/sync` · `GET /api/export.csv`
