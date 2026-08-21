# Guía de despliegue · Grupo Provivir (CDC Oriente)

Servidor de referencia: VPS Ubuntu 24 con Docker y Docker Compose.

---

## 1. Preparar el servidor

```bash
sudo apt-get update && sudo apt-get install -y docker.io docker-compose-v2 git
sudo usermod -aG docker "$USER"   # cerrar y reabrir sesión
sudo mkdir -p /etc/provivir && sudo chmod 700 /etc/provivir
```

## 2. Secretos

Todos los secretos viven en `/etc/provivir/.env`, con permisos `600`, **fuera del repositorio**.

```bash
sudo tee /etc/provivir/.env > /dev/null <<'ENV'
NODE_ENV=production
PORT=3000

# Base de datos y Redis (contraseñas fuertes, generadas aquí)
POSTGRES_USER=provivir
POSTGRES_PASSWORD=CAMBIAR
POSTGRES_DB=provivir
REDIS_PASSWORD=CAMBIAR

# JWT · generar con: openssl rand -base64 48
JWT_SECRET=CAMBIAR
JWT_ACCESS_TTL=15m
JWT_REFRESH_TTL=7d

# Dominio público. Temporal: provivir.exagos.co
# Cambiarlo aquí actualiza Caddy, el QR y el enlace que envía el bot por WhatsApp.
DOMINIO=provivir.exagos.co
CORS_ORIGINS=https://provivir.exagos.co
PORTAL_URL=https://provivir.exagos.co/citas

# Rate limiting (valores de producción)
THROTTLE_TTL_MS=60000
THROTTLE_LIMIT=120
THROTTLE_LOGIN_LIMIT=5

# Sede y banderas
SEDE_ID=cdc-oriente
KIOSKO_ACTIVO=false

# WhatsApp · Meta Cloud API
META_APP_SECRET=
META_ACCESS_TOKEN=
META_PHONE_NUMBER_ID=
META_WEBHOOK_VERIFY_TOKEN=

# IA
ANTHROPIC_API_KEY=
ANTHROPIC_MODEL=claude-opus-5

# Transcripción de notas de voz (opcional)
STT_URL=
STT_API_KEY=

# CAPTCHA del portal
TURNSTILE_SECRET=

# Respaldos
RESPALDO_CLAVE=CAMBIAR
ENV
sudo chmod 600 /etc/provivir/.env
```

**Sin `RESPALDO_CLAVE` el script de respaldo se niega a correr**: un dump con 400.000
pacientes sin cifrar no debe existir.

## 3. Desplegar

```bash
git clone <repo> /opt/provivir && cd /opt/provivir
npm ci && npm run build          # genera los tres frontends

# Dominio único con rutas: el backoffice va en la raíz, portal y TV en subcarpetas
# que coinciden con el `base` con que se compilaron.
mkdir -p despliegue/web
cp -r apps/backoffice/dist/.  despliegue/web/
cp -r apps/portal/dist        despliegue/web/citas
cp -r apps/tv/dist            despliegue/web/tv

docker compose -f despliegue/docker-compose.prod.yml --env-file /etc/provivir/.env up -d
docker compose -f despliegue/docker-compose.prod.yml exec api npx prisma migrate deploy
```

El seed **no se corre en producción**: crea usuarios con contraseña conocida. Las
credenciales reales se crean aparte, una vez.

## 4. DNS y TLS

Un solo registro `A` apuntando al servidor:

```
provivir.exagos.co    A    <IP del VPS>
```

Caddy emite y renueva el certificado solo. Todo cuelga de ese host:

| Ruta | Aplicación |
|---|---|
| `/` | Backoffice (tras login) |
| `/citas` | Portal público de autoagendamiento |
| `/tv` | Pantallas de sala — **solo desde la red de la sede** |
| `/api` | API |
| `/api/webhooks/whatsapp` | Webhook de Meta |
| `/tiempo-real` | WebSocket de llamados |

Ajusta los rangos IP de `@redInterna` en el `Caddyfile` a la red real de la clínica.

### Cambiar al dominio definitivo

Cuando el cliente defina su dominio, son tres líneas en `/etc/provivir/.env`:

```bash
DOMINIO=agenda.grupoprovivir.com
CORS_ORIGINS=https://agenda.grupoprovivir.com
PORTAL_URL=https://agenda.grupoprovivir.com/citas
```

Luego `docker compose up -d caddy api`. Caddy pide el certificado nuevo solo.

**Antes de cambiar, revisa qué apunta al dominio viejo:** el webhook registrado en el
panel de Meta, los QR impresos en la sede y el iframe embebido en el sitio del cliente.
Si el dominio definitivo permite subdominios, `Caddyfile.subdominios.ejemplo` tiene la
variante con un host por aplicación.

## 5. Webhook de Meta

En el panel de Meta, con el número de **prueba** primero:

- URL: `https://provivir.exagos.co/api/webhooks/whatsapp`
- Token de verificación: el mismo `META_WEBHOOK_VERIFY_TOKEN`
- Campo suscrito: `messages`

La plataforma responde el `hub.challenge` solo si el token coincide.

## 6. Respaldos automáticos

```bash
sudo crontab -e
# Diario a las 2:00
0 2 * * * . /etc/provivir/.env && /opt/provivir/apps/api/scripts/respaldo.sh >> /var/log/provivir-respaldo.log 2>&1
```

**Probar la restauración antes del lanzamiento** — un respaldo que nunca se restauró
no es un respaldo:

```bash
docker compose -f despliegue/docker-compose.prod.yml exec postgres \
  psql -U provivir -d postgres -c "CREATE DATABASE prueba_restauracion;"
DATABASE_URL="postgresql://provivir:...@localhost:5432/prueba_restauracion" \
  ./apps/api/scripts/respaldo.sh --restaurar respaldos/provivir-XXXX.dump.gz.enc
```

Copiar los respaldos **fuera del servidor**: si el VPS muere, los respaldos mueren con él.

## 7. Verificación posterior

```bash
curl -sS https://provivir.exagos.co/api/health/ready       # {"estado":"ok","db":"ok"}
docker compose -f despliegue/docker-compose.prod.yml ps          # todo healthy
docker compose -f despliegue/docker-compose.prod.yml logs -f api
```

Revisa las cabeceras en <https://securityheaders.com> apuntando a `https://provivir.exagos.co`
y a `https://provivir.exagos.co/citas`, que llevan políticas distintas.

## 8. Actualizaciones

```bash
cd /opt/provivir && git pull
npm ci && npm run build && cp -r apps/backoffice/dist/. despliegue/web/ && cp -r apps/portal/dist despliegue/web/citas && cp -r apps/tv/dist despliegue/web/tv
docker compose -f despliegue/docker-compose.prod.yml up -d --build api
docker compose -f despliegue/docker-compose.prod.yml exec api npx prisma migrate deploy
```

Las migraciones son versionadas y se aplican con `migrate deploy`, que **nunca** borra datos.

## 9. Reversa

Si la API de Meta falla, el número sigue operable a mano: las asistentes atienden desde
la bandeja y el mostrador funciona sin WhatsApp. El agendamiento por portal y backoffice
es independiente del canal.
