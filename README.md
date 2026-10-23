# Meet Teleport

Extensión de Chrome para desaparecer de Google Meet con el gesto de la Transmisión Instantánea. Todo el vídeo se procesa en el navegador.

## Qué hace ahora

Meet no recibe la cámara a pelo. La extensión envuelve `getUserMedia` y le entrega otra pista de vídeo. Mientras estás en cuadro, los frames se reenvían sin redibujarlos.

Con la cámara encendida, pulsa **Habitación** en la pastilla, sal del cuadro durante la cuenta atrás y vuelve. **Desaparecer** —o `Alt+Shift+V`— muestra esa foto. **Volver** te devuelve. La foto se queda en el almacenamiento local del navegador.

La idea de la habitación vacía sale de [deniza-png/snap](https://github.com/deniza-png/snap) (Meet Vanish). Ese repositorio no tiene licencia para su código propio, así que no está copiado aquí. Su gesto es una V y su efecto es polvo; aquí el disparo será dos dedos en la frente y el efecto, el fogonazo.

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

No detecta los dos dedos en la frente ni dibuja el fogonazo. Desaparecer, por ahora, es un corte a la foto.
