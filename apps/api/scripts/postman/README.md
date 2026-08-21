# Probar el webhook de WhatsApp con Postman

## Importar

Postman → **Import** → `provivir-webhook.postman_collection.json`

## Variables

En la pestaña **Variables** de la colección (o en un Environment):

| Variable | Local | Servidor |
|---|---|---|
| `base` | `http://localhost:3000` | `https://provivir.exagos.co` |
| `META_APP_SECRET` | el del `.env` | el de la app en el panel de Meta |
| `META_WEBHOOK_VERIFY_TOKEN` | `djvnksdfj489_` | el mismo |
| `telefono` | `573001234567` | cualquier número de prueba |

`wamid` y `timestamp` no se tocan: los genera el script en cada envío.

## La firma se calcula sola

El *pre-request script* de la colección firma cada POST con HMAC-SHA256, igual que
Meta. No hay que copiar nada a mano.

Dos detalles que hacen fallar esto cuando se arma a mano y que aquí ya están resueltos:

**Se firma el cuerpo YA resuelto.** Si se firma la plantilla con `{{telefono}}` sin
expandir, la firma no coincide nunca con lo que realmente viaja y todo da 401 sin
explicación aparente.

**Cada envío lleva un `wamid` único.** El `waMessageId` es la clave de idempotencia:
Meta reintenta los webhooks, y la plataforma ignora los repetidos. Si se reenvía el
mismo id, la respuesta es **200 pero no pasa nada** — parece que funcionó y no procesó.

## Orden sugerido

1. **Verificación de registro** — confirma que el token está bien antes de tocar el panel de Meta.
2. **Firma HMAC** — confirma que se rechaza lo que debe rechazarse.
3. **Tipos de mensaje** — texto, nota de voz, imagen, documento y botón.
4. **Eventos que no son mensajes** — acuses de entrega: se aceptan y se ignoran.

Las peticiones traen tests: la pestaña **Test Results** dice si pasó.

## Un 200 no significa que se procesó

El webhook responde 200 y **encola**; el trabajo real corre en el worker. Para ver qué
pasó después, mira la bandeja en el backoffice o los logs de la API.

Sin clave de IA configurada, toda conversación escala a la asistente — eso es lo
correcto, no una falla.

## Petición "Sin firma → 401"

Esa necesita un paso manual: hay que **desactivar el pre-request script de la colección**
desde la pestaña *Scripts* de esa petición, o dejar `META_APP_SECRET` vacío. Si no, el
script la firma y devuelve 200.

## Alternativa sin Postman

```bash
npm run webhook:probar -w @provivir/api
BASE=https://provivir.exagos.co npm run webhook:probar -w @provivir/api
```

Las mismas 15 comprobaciones, sin importar nada.
