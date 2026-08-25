# Changelog · FASE 10 — Menú del prototipo y las pantallas que faltaban

**Estado:** completa salvo la corrida de Playwright (ver «Pendiente de ejecutar»).
258 unitarias + 198 e2e de API en verde.

## Por qué

El menú lateral tenía **10 entradas planas**; la especificación visual (`docs/index_v2.html`,
que CLAUDE.md §Documentos declara mandante en UI) tiene **17 en tres secciones**, con icono,
insignia de pendientes y el cierre de sesión anclado al pie.

Detrás del menú había tres situaciones que conviene no confundir:

- **Tres pantallas que no existían en ninguna parte**: Métricas, Autoagendamiento web y Reglas de
  prioridad.
- **Cuatro enterradas en pestañas**: Carga masiva, Auditoría y Pantallas dentro de Administración;
  Prestadores dentro de Catálogo.
- **Una que no se construye todavía**: el simulador de WhatsApp · IA.

## El menú se filtra por permisos, no por rol

`App.tsx` filtraba con `usuario.rol`. La plataforma tiene 19 permisos granulares y perfiles
editables desde Administración, así que el ejemplo que el propio `packages/shared/src/permisos.ts`
pone en su cabecera —«un coordinador que ve métricas y nada más»— **no se podía expresar en el
menú**: el perfil existía, concedía lo suyo, y la persona seguía viendo las mismas entradas que
cualquier otro con su rol.

Ahora cada entrada declara el permiso que exige y el menú se arma con la lista efectiva del perfil.
Una sección sin entradas visibles no pinta su rótulo.

## Dos defectos que el trabajo destapó

**`GET /auth/yo` no devolvía nombre ni correo.** Retornaba `UsuarioAutenticado` —el contexto del
guard: `{id, rol, sedeId, permisos, prestadorId}`— mientras `login` devolvía
`{id, nombre, email, rol, prestadorId}`. El backoffice usa el primero al entrar y el segundo al
recargar, así que **al pulsar F5 el bloque de usuario se quedaba con el nombre vacío**, con la
sesión perfectamente viva. Y un menú filtrado por permisos habría salido vacío al entrar y completo
al recargar.

Se unifica en `AuthService.sesionDe()`, que usan login, refresco y `yo`. `UsuarioAutenticado` **no**
se toca: meter nombre y correo en el contexto de cada petición metería PII donde hoy no la hay.

**`GET /metricas/resumen` tenía cliente en el frontend y ninguna pantalla.** La Fase 6 construyó la
API de métricas y su changelog la describe, pero su lista de «Pantallas de administración» no
incluía ninguna: el Dashboard consume `reporte` y `balanceo` y es la vista del día. El período
—ausentismo, cancelaciones, reparto por tipo— no se veía en ninguna parte.

## Pantallas nuevas

**Métricas** (`vistas/Metricas.tsx`) · cero backend. Cuatro KPI y cuatro tarjetas de barras sobre el
rango elegido, más el reparto por servicio. **RN-02 es la trampa de esta pantalla**: el conteo
comparativo entre médicos generales excluye controles y el porcentaje de ocupación sí los cuenta.
La vista usa `consultasGenerales`, no el total, y no recalcula nada: `metricas.service.ts` ya
resuelve las dos métricas y aquí solo se pintan.

**Autoagendamiento web** (`vistas/PortalWeb.tsx`) · el QR ya lo generaba la API desde la Fase 5
(`GET /api/portal/qr.png`, ruta pública) y no lo pedía ninguna pantalla, así que imprimirlo obligaba
a llamar al endpoint a mano. Ahora se ve, se descarga a 1200 px y se comprueba que apunta a donde
debe. Se añade `GET /api/portal/enlace`, que devuelve en texto la misma URL que codifica el QR —una
imagen no se puede leer desde el navegador—; es pública, como el resto del módulo, y va limitada.

**Reglas de prioridad** (`vistas/Prioridad.tsx`) · los tres parámetros de llegada que un motor lee
de verdad (`anticipacion_llegada_min`, `tolerancia_retraso_min`, `hueco_max_min`), con nombre en
lenguaje llano en vez de filas crudas de la tabla clave/valor.

**Los niveles son de solo lectura, a propósito.** El prototipo dibuja una escalera P1–P4 que **no es
lo que está implementado**: el motor usa `alta/media/baja` con marcación manual y condiciones del
paciente (`turnos/turnos.reglas.ts`). Los criterios definitivos siguen pendientes de Grupo Provivir
—P4, anotado en el propio `schema.prisma`— así que la pantalla describe el motor que corre hoy en
lugar de ofrecer criterios configurables: modelarlos ahora sería adivinar. Por la misma razón no se
siembra el cuarto parámetro del prototipo («retraso máximo antes de revisión manual»): ningún motor
lo lee, y un parámetro que nadie consulta es decoración.

## Las pestañas se promueven sin quitarse

Cuatro entradas de menú abren una vista que ya existía dentro de una pestaña, mediante una prop
`inicial`. Las pestañas siguen visibles: hay dos caminos hacia la misma pantalla y nadie pierde el
que ya conocía. Cero código duplicado.

«Catálogo» desaparece como etiqueta y se parte en «Prestadores» y «Servicios y exámenes», como en la
especificación visual.

## Detalle de implementación que evita romper la suite

Los iconos van en `<span className="ic" aria-hidden="true">`. El contenido `aria-hidden` no entra en
el nombre accesible, así que `getByRole('button', { name: 'Base de conocimiento' })` sigue
coincidiendo exactamente. Sin eso se habrían roto seis aserciones de Playwright por un adorno.

## Deriva de datos encontrada, no corregida

**El perfil Asistente de esta instalación no tiene `conocimiento.ver`.** El catálogo de código
(`permisos.ts`) dice que debería tenerlo; la fila de la base tiene 10 permisos y no lo incluye.

La causa está en `asegurarPerfilesBase()`: solo el perfil de **acceso completo** se reconcilia al
arrancar, así que un permiso añadido después de crear la fila —`conocimiento.*` llegó en la Fase 7—
no alcanza nunca a los perfiles base ya existentes. Administración lo recibió; Asistente no.

Consecuencia hasta hoy: la asistente **veía** «Base de conocimiento» en el menú, porque el menú
filtraba por rol, y la API le respondía **403**. Con el menú filtrado por permisos la entrada
desaparece, que es coherente, pero **la pregunta de fondo sigue abierta**: si la asistente debe
poder consultar la base —y el catálogo de permisos dice que sí—, hay que conceder el permiso al
perfil. Es un cambio de datos en producción y no se hace desde aquí:

```sql
UPDATE perfil SET permisos = array_append(permisos, 'conocimiento.ver')
WHERE nombre = 'Asistente' AND NOT ('conocimiento.ver' = ANY(permisos));
```

O, sin SQL, marcando la casilla en Administración → Perfiles y usuarios.

La prueba `RN-09: los permisos salen del perfil guardado, no del catálogo de código` comprueba **la
regla** y no el dato concreto, justamente para no tapar la deriva.

## Lo que sigue faltando

**El simulador de WhatsApp · IA.** Es la única entrada del prototipo que no se entrega, y la única
sin backend: `apps/api/src/ia/` no expone controlador, y `POST /conocimiento/probar` solo ensaya la
recuperación de la base de conocimiento —nunca llama al modelo—. Construirlo exige un
`POST /ia/simular` sobre `IaService.responder()` (que `IaModule` ya exporta), con dos costes que
conviene decidir antes: consume tokens de Anthropic en cada prueba, y hay que aislarlo para que las
conversaciones simuladas no ensucien la bandeja ni las métricas de resolución automática.

## Pendiente de ejecutar

Las pruebas de navegador (`npm run e2e -- --project=backoffice`) no se corrieron: Playwright recrea
`provivir_e2e` con `prisma migrate reset --force`, y Prisma exige consentimiento explícito del
usuario para que un agente ejecute esa orden. Las siete pruebas nuevas están escritas.
