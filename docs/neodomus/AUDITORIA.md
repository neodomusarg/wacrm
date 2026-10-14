# Neo Domus × WaCRM — auditoría técnica y plan de embudos duales

Rama: `claude/wacrm-audit-dual-pipelines-5ebe2b` (no toca producción).
Fecha: 13/10/2026.

## 1. Resumen ejecutivo — fallos hallados

Severidad: 🔴 alto impacto comercial · 🟠 medio · 🟡 bajo.
Estado: ✅ corregido en esta rama · ⚙️ requiere configuración · 📋 recomendado (no implementado).

| # | Sev. | Hallazgo | Dónde | Estado |
|---|---|---|---|---|
| 1 | 🔴 | **El agente de IA se apaga para toda la cuenta** apenas existe UNA automatización activa de "mensaje recibido" o "palabra clave" (aunque no haya respondido nada). Crear un keyword "precio" silenciaba el bot en todas las conversaciones. | `src/lib/ai/auto-reply.ts` | ✅ ahora solo se calla si algo (automatización o persona) ya respondió *ese* mensaje |
| 2 | 🔴 | **Un Flow que deriva a humano no pausa la IA.** El run termina, el siguiente mensaje del cliente ya no lo consume el Flow y la IA contesta una conversación recién escalada. Además la nota de traspaso nunca se interpolaba (`{{vars.x}}` literal) y quedaba en `flow_run_events`, donde nadie la ve. | `src/lib/flows/engine.ts` (`executeHandoff`, fallback) | ✅ pausa IA + nota interpolada en el banner del inbox |
| 3 | 🔴 | **Los ✓✓ de lectura retroceden.** Meta no garantiza el orden de los estados (`read` suele llegar antes que `delivered`) y el webhook pisaba `messages.status` sin condición; un `failed` tardío podía marcar como fallido un mensaje leído. | `src/app/api/whatsapp/webhook/route.ts` | ✅ update condicionado en SQL (solo avanza) + `src/lib/whatsapp/message-status.ts` |
| 4 | 🔴 | **Triggers que nunca se disparan:** "Conversación asignada" y "Por horario" se ofrecen en el constructor pero ningún código del servidor los emite → automatizaciones activas que jamás corren. | `automation-builder.tsx`, `engine.ts` | ✅ `conversation_assigned` vía outbox de DB · "Por horario" oculto para nuevas |
| 5 | 🔴 | **Sin integridad deal ↔ etapa ↔ pipeline ↔ cuenta.** Nada impedía un deal en una etapa de otro pipeline (o de otra cuenta, vía el paso `create_deal` que usa service role). Encima `create_deal` ignoraba el error del INSERT y registraba "deal created" aunque no se guardara nada. | DB, `engine.ts` | ✅ trigger `enforce_deal_stage_integrity` + error propagado + no duplica deals abiertos |
| 6 | 🟠 | **Variables de plantilla sin interpolar.** `send_template` mandaba los valores literales y el motor solo entendía `{{message.text}}`/`{{vars.*}}`: imposible "Hola Juan, tu pedido #123 salió por Andreani…". Los botones/listas tampoco se interpolaban. | `engine.ts` (`interpolate`) | ✅ `{{contact.*}}`, `{{deal.*}}`, `{{stage.*}}`, `{{pipeline.*}}` en texto, botones y plantillas |
| 7 | 🟠 | **Mensajes libres fuera de la ventana de 24 h** fallaban recién en Meta (131047). La plantilla "Follow-up Reminder" espera exactamente 24 h y manda texto libre: **falla siempre**, y además se dispara por cada mensaje entrante. | `engine.ts`, `templates.ts` | ✅ chequeo previo con mensaje claro · ✅ nuevo trigger "Ventana de 24 h por vencer" que la reemplaza |
| 8 | 🟠 | **Esperas (Wait) huérfanas:** si el contenedor se reinicia a mitad de ejecución, la fila queda `running` para siempre. Y **en Easypanel nada llama al cron**: sin un scheduler, los Wait nunca se reanudan. | `api/automations/cron/route.ts` | ✅ filas viejas → `failed` · ⚙️ configurar cron (ver §5) |
| 9 | 🟠 | **"Horario" evaluado en UTC.** La condición `time_of_day` usa el reloj del servidor; la imagen Docker corre en UTC → "09:00-18:00" se evalúa 3 h corrido para Argentina. | `engine.ts` (`evaluateCondition`) | ⚙️ variable `TZ=America/Argentina/Cordoba` en Easypanel |
| 10 | 🟠 | **"Ganados/Perdidos este mes" inflado:** usaba `updated_at`, que cambia con cualquier edición (p. ej. cargar el tracking de un pedido ya cobrado). | `pipeline-analytics.tsx` | ✅ columna `closed_at` |
| 11 | 🟠 | **Pérdida silenciosa de mensajes entrantes:** el webhook responde 200 a Meta antes de procesar (correcto, por el timeout de 20 s), pero si el INSERT falla o el contenedor se reinicia en ese momento, el mensaje se pierde sin reintento ni registro del payload. | `webhook/route.ts` | 📋 tabla `webhook_inbox` con el payload crudo + reprocesador |
| 12 | 🟡 | Crear pipeline no verificaba el INSERT de etapas → pipeline vacío inutilizable. | `pipelines/page.tsx` | ✅ rollback |
| 13 | 🟡 | El formulario de deal carga **todos** los contactos sin paginar: PostgREST corta en 1000 filas → los contactos más nuevos no aparecen y la carga es pesada. | `deal-form.tsx` | 📋 combobox con búsqueda server-side |
| 14 | 🟡 | KPI del tablero: las etapas "En pausa" no suman a "Total deals" ni "Pipeline value" (la captura muestra **0** con 10 deals por ARS 424.270 en pausa). Es una decisión de diseño de la migración 043, pero confunde. | `neodomus.ts` (`countsTowardActiveValue`) | 📋 decidir: ¿mostrar "en pausa" como KPI aparte? |
| 15 | 🟡 | Rate limiter en memoria del proceso: correcto con 1 contenedor; si se escala a 2+ réplicas el límite por cuenta se multiplica. | `src/lib/rate-limit.ts` | 📋 Redis/DB si se escala |
| 16 | 🟡 | `.env.local.example` remite a `docs/automations-and-cron.md`, que no existe. | docs | ✅ referencia actualizada |

**Puntos sólidos (no tocar):** firma HMAC del webhook verificada sobre el body crudo; inserción idempotente por `(conversation_id, message_id)`; contador de no leídos atómico en SQL; tokens cifrados AES-GCM con upgrade desde CBC; deduplicación de contactos por sufijo telefónico + BSUID (usernames de WhatsApp); guard SSRF en webhooks salientes; claim atómico del cupo de respuestas de IA.

**Tokens de Meta:** usar un token de **System User permanente** (Business Manager → Usuarios del sistema) con permisos `whatsapp_business_messaging` y `whatsapp_business_management`. Los tokens temporales del panel de la app vencen a las 24 h; el CRM ya traduce el error 190 a un mensaje claro, pero no avisa antes.

## 2. Arquitectura propuesta

```
WhatsApp Cloud API ──► /api/whatsapp/webhook ──► contacto + conversación + mensaje
                                    │                 (last_inbound_at ← bump RPC)
                                    ├─► Flows (menús deterministas)
                                    ├─► Automatizaciones (mensaje / keyword / botón)
                                    └─► Agente IA ── [[LEAD {...}]] ──► conversations.ai_lead_profile
                                                                   └─► deal en el embudo correcto

Tablero / formulario / API / create_deal
        │  UPDATE deals.stage_id
        ▼
  triggers Postgres ──► deal_stage_history (auditoría)
                    └─► automation_event_queue (outbox) ◄── asignación de conversación
                                    │
   cron cada 1 min ─► /api/automations/cron
                        ├─ drena la outbox → "Deal entra en una etapa" / "Conversación asignada"
                        ├─ busca ventanas de 24 h por vencer → "Ventana de 24 h por vencer"
                        └─ reanuda Waits vencidos
```

Por qué outbox en la base: los deals se mueven desde el navegador directo contra Supabase (sin pasar por el servidor). Un trigger de Postgres captura **todos** los caminos (tablero, formulario, API pública, otras automatizaciones) y el evento existe solo si el cambio se confirmó. El claim usa `FOR UPDATE SKIP LOCKED`, así dos ejecuciones del cron nunca procesan el mismo evento.

### Migración `044_dual_pipelines_automation_events.sql`

| Objeto | Para qué |
|---|---|
| `pipelines.business_line` (`general`/`online`/`projects`) | Embudos separados pero centralizados en la misma cuenta |
| `pipeline_stages.stage_key` | Slug estable (`online_shipped`, `proj_install_scheduled`…) para automatizaciones e IA |
| `deals.order_ref`, `tracking_code`, `shipping_carrier`, `province`, `city`, `installation_date` | Datos del pedido online y de la obra |
| `deals.stage_entered_at`, `deals.closed_at` | Tiempo en etapa y métricas mensuales correctas |
| CHECKs ampliados | Segmentos `Instalador / Electricista`, `Revendedor / Partner`, `Comprador online`; orígenes `Tienda Nube`, `MercadoLibre`, `WhatsApp entrante`; motivos `Sin stock`, `Costo / plazo de envío`, `Pago no concretado`, `Incompatibilidad técnica`, `Fuera de zona` |
| `enforce_deal_stage_integrity` | Etapa ∈ pipeline ∈ cuenta |
| `deal_stage_history` | Historial de movimientos (RLS de lectura por cuenta) |
| `automation_event_queue` + `claim_automation_events()` | Outbox con reintentos (3) y recuperación de claims huérfanos |
| `conversations.last_inbound_at`, `window_nudge_for` + `claim_expiring_conversations()` | Ventana de 24 h y reactivación sin duplicados |
| `conversations.ai_lead_profile` | Calificación extraída por la IA |
| `automation_pending_executions.claimed_at` | Detección de Waits huérfanos |

Probada sobre Postgres embebido aplicando **001 → 044** en orden, re-ejecutando 044 (idempotente) y verificando: rechazo de etapa ajena, historial, evento encolado con from/to, `closed_at`, claim exclusivo, ventana (solo si el cliente nos dejó en visto, una vez por ciclo), `last_inbound_at`, evento de asignación, y el seed adoptando "WS / TiendaNube" sin mover deals.

### Embudos

**Ventas Online (B2C, todo el país)** — `business_line = online`

| # | Etapa | Tipo | Automatización sugerida |
|---|---|---|---|
| 0 | Consulta entrante | activa | creada por el menú/IA |
| 1 | Carrito / Cotización enviada | activa | — |
| 2 | Pago pendiente | activa | recordatorio dentro de la ventana |
| 3 | En pausa / Recontactar | pausa | pide fecha de recontacto |
| 4 | Compra confirmada / En preparación | **ganado** | plantilla "pedido confirmado" |
| 5 | Despachado | ganado | plantilla con transporte + tracking |
| 6 | Entregado / Postventa | ganado | plantilla de reseña / soporte (+7 días) |
| 7 | Perdido | perdido | pide motivo |

**Proyectos e Instalaciones (B2B, Córdoba)** — `business_line = projects`

| # | Etapa | Tipo |
|---|---|---|
| 0 | Lead nuevo (arquitecto / constructora / cliente final) | activa |
| 1 | Relevamiento técnico / Planos | activa |
| 2 | Propuesta técnica enviada | activa |
| 3 | Negociación / Ajuste | activa |
| 4 | En pausa / Recontactar | pausa |
| 5 | Obra / Instalación agendada | activa |
| 6 | Instalación finalizada / Cobrado | **ganado** |
| 7 | Fidelización / Red de revendedores | ganado |
| 8 | Perdido (con motivo) | perdido |

Varias etapas "ganado" son intencionales: el ingreso se reconoce al cobrar y las siguientes siguen la logística/postventa. "Marcar como ganado" usa la primera. La advertencia de etapas terminales ahora solo salta con más de una "Perdido".

## 3. Automatizaciones y Flows

Plantillas nuevas en **Automatizaciones → Plantillas Neo Domus** (se clonan inactivas; elegir pipeline/etapa/etiqueta/plantilla y activar):

| Plantilla | Trigger | Qué hace |
|---|---|---|
| Bienvenida y derivación | Primer mensaje | Botones: *Comprar online* · *Proyecto/instalación* · *Soy profesional* |
| Ruta compra online | Botón `nd_online` | Link a la tienda + deal en Ventas Online + etiqueta |
| Ruta proyecto | Botón `nd_project` | Pide ciudad / tipo de propiedad / qué automatizar + deal en Proyectos + asigna asesor (round robin) |
| Ruta profesional | Botón `nd_professional` | Pide rubro y zona + deal en Proyectos (segmento partner) + asigna |
| Pedido despachado | Deal entra en "Despachado" | Plantilla Meta con `{{contact.first_name}}`, `{{deal.order_ref}}`, `{{deal.shipping_carrier}}`, `{{deal.tracking_code}}` |
| Instalación agendada | Deal entra en "Obra / Instalación agendada" | Plantilla con `{{deal.installation_date}}` |
| Reactivación antes de 24 h | Ventana por vencer (120 min) | Solo si el cliente nos dejó en visto, solo 09–21 h: un recordatorio libre (gratis dentro de la ventana) |

Los `create_deal` no duplican: si el contacto ya tiene un deal abierto en ese pipeline, el paso se saltea.

**Plantillas de Meta a crear** (categoría *Utilidad*, idioma `es_AR`) — los avisos de pedido/instalación llegan días después del último mensaje, fuera de la ventana, así que **tienen que ser plantillas**:

- `pedido_despachado`: "¡Hola {{1}}! Tu pedido {{2}} ya salió por {{3}}. Código de seguimiento: {{4}}. Cualquier consulta respondé este mensaje."
- `instalacion_agendada`: "¡Hola {{1}}! Confirmamos la instalación de Neo Domus para el {{2}}. Si necesitás reprogramar, respondé este mensaje."
- `pedido_confirmado` y `postventa_resena` (opcionales) con la misma lógica.

**Orden de prioridad por mensaje entrante:** Flow activo → automatizaciones → IA (solo si nada respondió ese mensaje). Un toque de botón nunca lo responde la IA.

## 4. Agente de IA

- **Prompt de negocio:** `docs/neodomus/ai-agent-prompt.md` (rol, alcance, cuándo derivar, reglas de seguridad eléctrica y de precios).
- **Base de conocimiento:** `docs/neodomus/knowledge-domotica.md` (Zigbee/WiFi/Matter, neutro, voz, instalación, FAQ). Revisar marcas/modelos reales antes de subir.
- **Calificación estructurada:** en modo auto-respuesta el modelo agrega al final una línea `[[LEAD {"intent":"project","city":"Córdoba",…}]]`. El servidor la **quita siempre** antes de enviar (también si viene cortada o con JSON inválido), la valida campo por campo (`sanitizeLeadProfile`) y la acumula en `conversations.ai_lead_profile`.
- **Ruteo automático:** con `intent` conocido, crea un deal en la primera etapa activa del embudo que corresponde (`online` → Ventas Online; `project`/`reseller` → Proyectos), con ciudad/provincia, segmento, origen "WhatsApp entrante" y el resumen en notas. Idempotente por contacto + pipeline.
- **Traspaso sin fricción:** al derivar, la nota del banner del inbox incluye el perfil (`Lead: Proyecto / instalación · 📍 Villa Allende, Córdoba · Interés: …`), la IA queda pausada en esa conversación y se asigna al agente de traspaso configurado.

## 5. Plan de despliegue (paso a paso)

1. **Backup** de la base (Supabase → Database → Backups) antes de migrar.
2. **Migración:** ejecutar `supabase/migrations/044_dual_pipelines_automation_events.sql` en el SQL Editor (requiere 043, ya aplicada).
3. **Embudos:** ejecutar `supabase/neodomus/seed_dual_pipelines.sql` (convierte "WS / TiendaNube" en Ventas Online sin mover sus deals; las etapas viejas quedan al final para reasignar a mano y luego borrar). Alternativa desde la UI: selector de pipeline → *Crear embudos Neo Domus*.
4. **Desplegar** esta rama en un servicio de staging de Easypanel; probar; luego merge a `main`.
5. **Variables en Easypanel:** `AUTOMATION_CRON_SECRET=<openssl rand -hex 32>` y `TZ=America/Argentina/Cordoba`.
6. **Cron:** nada dentro del contenedor está programado. Usar un scheduler externo (cron-job.org, un cron del VPS, o un servicio cron en Easypanel si tu versión lo trae), cada 1 min:
   `curl -fsS -H "x-cron-secret: $AUTOMATION_CRON_SECRET" https://wacrm-wacrm.abkszs.easypanel.host/api/automations/cron`
   y cada 5 min lo mismo contra `/api/flows/cron`.
7. **Meta:** crear las plantillas de §3 y esperar aprobación.
8. **IA:** pegar el prompt, subir la base de conocimiento, activar auto-reply.
9. **Automatizaciones:** clonar las plantillas Neo Domus, completar pipeline/etapa/etiqueta/plantilla, activar.

## 6. Archivos modificados / creados

| Archivo | Cambio |
|---|---|
| `supabase/migrations/044_dual_pipelines_automation_events.sql` | **nuevo** — esquema de §2 |
| `supabase/neodomus/seed_dual_pipelines.sql` | **nuevo** — embudos para la cuenta |
| `supabase/ci/verify-schema.sql` | verifica 044 en CI |
| `src/lib/neodomus.ts` | blueprints Online/Proyectos, valores ampliados, perfil de lead |
| `src/types/index.ts` | tipos nuevos (pipeline, deal, conversación, triggers) |
| `src/app/(dashboard)/pipelines/page.tsx` | tipo de embudo al crear, badge, "Crear embudos Neo Domus", rollback |
| `src/components/pipelines/deal-form.tsx` | ubicación, pedido online, fecha de instalación |
| `src/components/pipelines/pipeline-settings.tsx` | cambiar tipo de embudo; aviso solo por varias "Perdido" |
| `src/components/pipelines/pipeline-analytics.tsx` | métricas mensuales con `closed_at` |
| `src/app/api/whatsapp/webhook/route.ts` | estados forward-only; ventana para el gate de IA |
| `src/lib/whatsapp/message-status.ts` | **nuevo** — escalera de estados |
| `src/lib/automations/engine.ts` | triggers nuevos, variables, chequeo 24 h, `create_deal` robusto |
| `src/lib/automations/events.ts` | **nuevo** — outbox + escáner de ventanas |
| `src/app/api/automations/cron/route.ts` | drena eventos, escanea ventanas, limpia Waits huérfanos |
| `src/lib/automations/{validate,trigger-meta,templates}.ts` | validación, estilos y plantillas Neo Domus |
| `src/components/automations/automation-builder.tsx` | UI de los triggers nuevos |
| `src/app/(dashboard)/automations/{page,new/page}.tsx` | galería Neo Domus |
| `src/lib/ai/{auto-reply,generate,defaults,types}.ts`, `lead-routing.ts` (**nuevo**) | gate preciso, `[[LEAD]]`, ruteo |
| `src/lib/flows/engine.ts` | handoff pausa IA + nota visible |
| `messages/{es,en,pt,ko}.json` | textos nuevos |
| tests | `message-status`, `neodomus-pipelines` (paridad CHECK/seed ↔ TS), lead parsing, triggers, gate de IA |

## 7. Pendientes recomendados (siguiente iteración)

1. Bandeja `webhook_inbox` con el payload crudo de Meta y reproceso (hallazgo 11).
2. Integración Tienda Nube: webhook `order/paid` / `order/fulfilled` → mover el deal a "Compra confirmada" / "Despachado" con `order_ref` y tracking, disparando las notificaciones sin carga manual.
3. Selector de contactos con búsqueda server-side en el formulario de deal (hallazgo 13).
4. KPI separado de "en pausa" en el tablero (hallazgo 14).
5. Vista "tiempo en etapa" con `stage_entered_at` + alertas de deals estancados.
