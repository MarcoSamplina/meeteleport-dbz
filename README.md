# Meet Teleport

Extensión de Chrome para desaparecer de Google Meet con el gesto de la Transmisión Instantánea. Todo el vídeo se procesa en el navegador.

## Fase 1: el tubo

Meet no recibe la cámara a pelo. La extensión envuelve `getUserMedia` y le entrega otra pista de vídeo. En reposo los frames se reenvían sin redibujarlos. Todavía no hay gesto ni fogonazo: quien esté en la llamada te ve igual que siempre.

Una pastilla arriba a la derecha, visible solo para ti, dice si la cámara está en el tubo y a cuántos fps.

## Probarla

1. Abre `chrome://extensions`, activa el modo de desarrollador y carga la carpeta `extension`.
2. Sirve el banco de pruebas en el puerto 8765:

   ```bash
   python3 -m http.server 8765 --bind 127.0.0.1 --directory sandbox
   ```

3. Abre http://127.0.0.1:8765/ y acepta la cámara.

La página comprueba el tubo directo, que al cortar el vídeo se suelta la cámara, y pinta un cuadrado cian que solo existe en este banco. En Meet ese cuadrado no aparece.

El puerto tiene que ser el 8765. Así la extensión no toca otras páginas locales.

En una llamada, deja apagados el desenfoque y los fondos de Meet.

## Qué no hace todavía

No detecta los dos dedos en la frente, no guarda la habitación vacía y no teletransporta. Eso es lo que sigue.
