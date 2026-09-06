# RN-04.8 · La ventana de autoagendamiento

**Estado:** implementada (fase 22). Extiende RN-04 y convive con RN-04.6, RN-04.7 y RN-06.5.

Hasta ahora, quien se agendaba solo —portal o bot— podía reservar **cualquier día a partir
de mañana** y a cualquier hora que tuviera la agenda. La única regla era
`agendamiento_anticipacion_dias`. El cliente quiere gobernar eso, y lo mandó como una tabla.

---

## La tabla

El día en que el paciente agenda determina qué días puede reservar:

| Si agenda un… | Puede reservar desde | hasta | (el `+N` que anotó el cliente) |
|---|---|---|---|
| lunes | miércoles | viernes | +2 |
| martes | jueves | viernes | +2 |
| miércoles | lunes | viernes | +5 |
| jueves | lunes | viernes | +4 |
| viernes | martes | viernes | +4 |
| sábado | martes | viernes | +3 |
| domingo **o festivo** | miércoles | viernes | +3 |

**El `+N` no se guarda: es derivable.** Es la próxima ocurrencia del día «desde»
estrictamente posterior a hoy. Las siete filas dan exactamente los números que anotó el
cliente, comprobados uno a uno, así que basta con guardar «desde qué día hasta qué día».
Guardar además el `+N` sería guardar dos veces la misma verdad y dejar que se separen.

## Lo que la tabla no dice y hubo que decidir

**Un festivo no puede dar más margen que un día laborable.** «Domingo o festivos»
comparten fila, pero aplicarla a secas puede abrir la ventana *antes*: un 1 de enero en
martes daría +1 —la fila del domingo empieza en miércoles— frente a los +2 de un martes
corriente. Un día en que la clínica está cerrada no puede ser más permisivo que uno en que
está abierta, así que se toma **el más tardío** de los dos resultados. En la práctica casi
nunca se nota: la Ley Emiliani corre los festivos colombianos a lunes, y para un lunes las
dos filas coinciden.

**La ventana envuelve la semana sin caso especial.** `fin` es la próxima ocurrencia de
«hasta» *en o después* de `inicio`. Con `desde == hasta` sale una ventana de un solo día en
vez de irse a la semana siguiente, y si «hasta» cae antes que «desde» la ventana cruza el
fin de semana. El ancho máximo es siempre de seis días.

**Los parsers caen hacia la restricción, nunca hacia el canal abierto.** Un valor ilegible
en configuración vuelve a la tabla base, no a «sin reglas». Y el `PUT` de configuración lo
rechaza en el momento de guardar, con un validador por clave: así el operador se entera al
guardar y no tres días después.

---

## Los cinco parámetros

Están en Administración → **Autoagendamiento**, y también, en crudo, en Reglas.

| Clave | Valor inicial | Qué es |
|---|---|---|
| `autoagendamiento_ventana_activa` | `true` | El interruptor de toda la regla |
| `autoagendamiento_ventana_dias` | `1:3-5,2:4-5,3:1-5,4:1-5,5:2-5,6:2-5,7:3-5` | La tabla |
| `autoagendamiento_dias_excluidos` | `6,7` | Días que no se ofrecen nunca |
| `autoagendamiento_horario_cita` | `12:00-23:59` | Solo se ofrecen cupos que empiecen dentro |
| `autoagendamiento_horario_canal` | `00:00-23:59` | Reloj: fuera de esta franja, el canal pide llamar |

**Por qué el formato compacto y no JSON.** Son veintiún números. En JSON con nombres
legibles ocupan 211 caracteres, once por encima del tope de la tabla de configuración, y
habría que levantarle el límite a esta clave. Pero la razón de fondo es otra: el
`estadoPrev`/`estadoNext` de la auditoría con un bloque JSON de 211 caracteres no lo lee
nadie, mientras que en `1:3-5,2:4-5,…` se ve de un vistazo qué fila cambió.

**Los sábados no son una redundancia de que las ventanas acaben en viernes.** Hay 6 franjas
de sábado configuradas en producción: la clínica trabaja el sábado y quiere reservarlo para
el mostrador. Por eso el sábado está en «días excluidos» y no simplemente fuera de la tabla.

---

## Dónde se aplica, y sobre todo dónde no

Las tres guardas viven **al nivel superior de `cupos()` y de `crear()`, nunca dentro de
`validarCupo()`**. No es un detalle de estilo: `validarCupo` lo comparten `crear` y
`reprogramar`, así que meter la regla ahí la dejaría latente sobre las reprogramaciones, y
el día que alguien cablee una reprogramación de autoservicio se activaría sola.

**Esto solo aplica a crear citas nuevas. Cancelar y reprogramar siguen siempre activos** —
lo pidió el cliente explícitamente, y está fijado estructuralmente, no por casualidad. Hay
dos pruebas cuya única razón de existir es que esa propiedad no se pierda.

Las tres guardas, todas con `if (!opciones?.autoservicio) return;` —el mostrador no se ve
afectado por nada de aquí—, en este orden:

1. **Canal abierto** (reloj de la sede). Se evalúa en `cupos()` y en `crear()`. Si el
   paciente abre el portal a las 17:59 y confirma a las 18:01 **se rechaza**: la regla es
   sobre el momento de agendar. El mensaje dice el horario, para que sepa cuándo volver.
2. **Fecha dentro de la ventana**, después de `validarDiaLaborable` para que el motivo del
   cierre —que es mejor mensaje— gane cuando aplican los dos.
3. **Horario de la cita**: en `cupos()` **filtra** los cupos ofrecidos; en `crear()`
   **rechaza**. Filtrar en la consulta es lo que ya hace el motor con todo lo demás;
   rechazar en la creación es la garantía, y es lo que impide que el bot o un cliente
   manipulado se lo salten.

## Que el paciente no adivine

Una regla que solo se descubre chocando contra un 400 no es una regla, es una trampa.

- **El portal** pide la ventana vigente a un endpoint público nuevo y acota el selector de
  fecha con ella. Cuando la ventana deja huecos —un sábado excluido, un festivo en medio—
  los lista, porque un `<input type="date">` no sabe deshabilitar días sueltos. Y el vacío
  de cupos deja de mentir: antes decía «no hay horarios disponibles ese día» cuando sí los
  había, solo que no para este canal.
- **El bot** recibe las fechas como **dato** en el prompt, igual que ya recibía
  `primeraFechaAgendable`. Escribir la tabla de siete filas en el prompt la convertiría en
  una sugerencia que el modelo puede reinterpretar. Puede seguir pidiendo lo que quiera: la
  invariante vive en el motor.
- **El backoffice** pinta, debajo de la tabla, la ventana que sale de lo que el operador
  acaba de escribir. Por eso las reglas puras están en `packages/shared` y no en la API:
  calcularlas dos veces sería garantizar que un día difieran.

---

## Lo que hay que mirar después de encenderla

**«Solo tardes» apaga más de la mitad de la clínica.** De las 27 franjas configuradas en
producción, **14 son solo de mañana**, 8 solo de tarde y 5 cruzan el mediodía. Con
`autoagendamiento_horario_cita` en `12:00-23:59`, esas 14 no ofrecen un solo cupo por
autoservicio — se seguirán agendando desde el mostrador. No es un defecto del diseño, es la
consecuencia de la regla; pero es grande, y la franja se cambia sin desplegar.

**La regla entra encendida**, por decisión del cliente. Hoy las 27 agendas están bloqueadas
y no hay cupos por ningún canal, así que el efecto no se verá hasta que se desbloqueen — y
entonces se sumarán dos restricciones a la vez. El interruptor la apaga en un clic.

**La caché de configuración es por proceso.** Hoy hay una sola instancia de la API, así que
no muerde, pero conviene saberlo antes de escalar.
