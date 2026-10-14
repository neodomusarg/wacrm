# Base de conocimiento — compatibilidad domótica (Neo Domus)

> Documento para subir en **Settings → AI Agents → Knowledge**. El agente
> responde solo con lo que está acá. Revisar y ajustar a los productos y
> marcas que Neo Domus vende realmente antes de subirlo; agregar precios
> y tiempos de envío vigentes en un documento aparte para poder
> actualizarlos sin tocar este.

## Protocolos: WiFi, Zigbee y Matter

**WiFi**
- Cada dispositivo se conecta directo al router. No necesita hub.
- Ideal para pocos dispositivos (hasta ~15-20) y para empezar.
- Requiere WiFi de 2,4 GHz con buena señal en el lugar del dispositivo. La mayoría no funciona en 5 GHz.
- Si se corta internet, muchos dispositivos WiFi dejan de responder desde la app (los interruptores siguen funcionando a mano).

**Zigbee**
- Necesita un hub/gateway Zigbee conectado al router.
- Red en malla: los dispositivos enchufados a 220 V (interruptores, enchufes) repiten la señal y extienden el alcance.
- Recomendado para casas completas, muchos sensores, y sensores a pila (consumen muy poco: pilas de 1-2 años).
- Las automatizaciones locales del hub pueden seguir funcionando sin internet.
- Un dispositivo Zigbee NO se conecta directo al WiFi: siempre necesita el hub.

**Matter**
- Estándar nuevo que permite usar el mismo dispositivo con Google Home, Alexa, Apple Home y SmartThings.
- Funciona sobre WiFi o Thread (Thread necesita un "border router", p. ej. algunos parlantes inteligentes o hubs).
- Conviene para quien quiere no quedar atado a una marca.

**Regla rápida para recomendar**
- 1 a 10 dispositivos, sin sensores a pila → WiFi.
- Casa completa, sensores de puerta/movimiento, cortinas, o mala señal WiFi → Zigbee con hub.
- Usa varios ecosistemas (iPhone + Alexa, etc.) → priorizar Matter.

## Interruptores y el cable neutro

- En Argentina muchas cajas de llave (caja rectangular de la pared) solo tienen **fase y retorno**, sin **neutro** (cable celeste).
- Interruptores inteligentes **con neutro**: necesitan fase + neutro en la caja. Son los más estables.
- Interruptores **sin neutro**: funcionan solo con fase y retorno. Con lámparas LED de muy bajo consumo pueden parpadear; a veces se soluciona con un capacitor/bypass que se instala en la lámpara.
- Cómo saber si hay neutro: lo ideal es que lo verifique un electricista matriculado. Nunca recomendar que el cliente abra la caja con tensión.
- Combinaciones (llaves de 3 vías / escaleras): requieren modelos compatibles o un módulo; derivar a un asesor.
- Módulos "detrás de la tecla": permiten mantener la tecla existente y automatizarla; también existen con y sin neutro.

## Asistentes de voz y apps

- Alexa y Google Home: compatibles con la mayoría de los dispositivos WiFi y con los hubs Zigbee de las marcas que vendemos.
- Apple Home (Siri): solo con dispositivos Matter o HomeKit.
- Todo se controla desde una app en el celular; se pueden crear escenas ("llegué a casa", "me voy") y horarios.

## Instalación

- La instalación profesional la hacemos en Córdoba Capital y Gran Córdoba.
- Para el resto del país: venta online con envío; recomendamos que la instalación eléctrica la haga un electricista matriculado.
- Obra nueva o en construcción: es el mejor momento — se puede prever neutro en todas las cajas, cableado de red y ubicación del hub. Conviene contactarnos en etapa de planos o instalaciones.

## Preguntas frecuentes

- **¿Funciona si se corta internet?** Los interruptores siguen funcionando a mano. Con Zigbee y escenas locales, muchas automatizaciones siguen andando; el control remoto desde la app vuelve cuando vuelve internet.
- **¿Funciona si se corta la luz?** Al volver la energía los dispositivos se reconectan solos; las cerraduras inteligentes tienen batería y llave mecánica de respaldo.
- **¿Puedo empezar con pocos dispositivos y sumar después?** Sí. Si planea crecer a toda la casa, conviene empezar con un hub Zigbee/Matter.
- **¿Necesito un celular específico?** Funciona con Android y iPhone.
