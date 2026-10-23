(() => {
  const preview = document.getElementById('preview');
  const checks = document.getElementById('checks');
  const result = document.getElementById('result');
  const caption = document.getElementById('caption');
  const retry = document.getElementById('retry');
  const report = {};

  retry.addEventListener('click', () => location.reload());

  function addCheck(name) {
    const li = document.createElement('li');
    li.dataset.state = 'pending';
    li.textContent = name;
    checks.appendChild(li);
    return {
      pass(detail) {
        li.dataset.state = 'pass';
        li.textContent = detail ? `${name} — ${detail}` : name;
      },
      fail(detail) {
        li.dataset.state = 'fail';
        li.textContent = detail ? `${name} — ${detail}` : name;
      },
    };
  }

  function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function waitUntil(label, pred, ms) {
    const start = performance.now();
    while (performance.now() - start < ms) {
      const value = pred();
      if (value) return value;
      await wait(50);
    }
    throw new Error(label);
  }

  function snapshot() {
    const api = window.__meeteleport;
    if (!api) return { installed: false };
    return {
      installed: true,
      frames: api.frames,
      mode: api.mode,
      activePipes: api.activePipes,
      sourcesReleased: api.sourcesReleased,
      lastError: api.lastError,
      logs: api.logs,
    };
  }

  function sampleCorner() {
    if (!preview.videoWidth) return null;
    const canvas = document.createElement('canvas');
    canvas.width = preview.videoWidth;
    canvas.height = preview.videoHeight;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(preview, 0, 0);
    const pixel = ctx.getImageData(4, 4, 1, 1).data;
    return [pixel[0], pixel[1], pixel[2]];
  }

  function isCyan(pixel) {
    return pixel && pixel[0] < 80 && pixel[1] > 200 && pixel[2] > 200;
  }

  function sampleGrid() {
    const width = preview.videoWidth;
    const height = preview.videoHeight;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(preview, 0, 0);
    const points = [];
    for (let y = 0.15; y <= 0.85; y += 0.14) {
      for (let x = 0.15; x <= 0.85; x += 0.14) {
        const pixel = ctx.getImageData(
          Math.min(width - 1, Math.floor(x * width)),
          Math.min(height - 1, Math.floor(y * height)),
          1,
          1,
        ).data;
        points.push(pixel[0], pixel[1], pixel[2]);
      }
    }
    return points;
  }

  function diffSamples(left, right) {
    let total = 0;
    const count = Math.min(left.length, right.length);
    for (let i = 0; i < count; i += 1) total += Math.abs(left[i] - right[i]);
    return total;
  }

  async function openCamera(audio) {
    return navigator.mediaDevices.getUserMedia({
      video: { width: 640, height: 480 },
      audio,
    });
  }

  async function show(stream) {
    preview.srcObject = stream;
    await preview.play();
  }

  async function releaseVideo(stream) {
    const api = window.__meeteleport;
    const before = api.sourcesReleased;
    const audioTracks = stream.getAudioTracks();
    stream.getVideoTracks()[0].stop();
    await waitUntil('la cámara de origen no se soltó', () => {
      return api.sourcesReleased > before && api.activePipes === 0;
    }, 2500);
    for (const track of audioTracks) {
      if (track.readyState !== 'live') {
        throw new Error('el tubo también cortó el micrófono');
      }
      track.stop();
    }
  }

  async function run() {
    result.dataset.status = 'running';
    result.textContent = 'Probando el tubo…';
    const hook = addCheck('La extensión está enganchada');
    const audioOnly = addCheck('Un audio solo no abre el tubo');
    const direct = addCheck('El vídeo pasa por el tubo directo');
    const room = addCheck('La foto de la habitación sustituye a la cámara');
    const release = addCheck('Al cortar la pista se suelta la cámara');
    const marker = addCheck('La marca cian sale en el banco de pruebas');
    const pill = addCheck('La pastilla ve el tubo');

    await waitUntil('la extensión no está cargada en esta página', () => window.__meeteleport?.installed, 2000);
    const api = window.__meeteleport;
    hook.pass(api.supportsInsertable ? 'tubo directo disponible' : 'este Chrome solo tiene canvas');
    if (typeof api.setGesture === 'function') api.setGesture(false);
    report.supportsInsertable = api.supportsInsertable;

    try {
      const audio = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      if (api.activePipes !== 0) throw new Error(`abrió ${api.activePipes} tubos`);
      audio.getTracks().forEach((track) => track.stop());
      audioOnly.pass('no abre el tubo');
    } catch (err) {
      if (err.name === 'NotFoundError') audioOnly.pass('este equipo no tiene micrófono');
      else throw err;
    }

    api.setMarker(false);
    const framesBefore = api.frames;
    let stream;
    let withAudio = true;
    try {
      stream = await openCamera(true);
    } catch (err) {
      if (err.name !== 'NotFoundError' && err.name !== 'NotAllowedError') throw err;
      withAudio = false;
      stream = await openCamera(false);
    }
    await show(stream);
    const track = stream.getVideoTracks()[0];
    await waitUntil('el tubo no entregó frames', () => {
      return preview.videoWidth > 0 && api.frames > framesBefore + 8;
    }, 5000);
    if (api.supportsInsertable && api.mode !== 'insertable') {
      throw new Error(`se esperaba tubo directo y llegó ${api.mode || 'nada'}${api.lastError ? ` (${api.lastError})` : ''}`);
    }
    if (!api.supportsInsertable && api.mode !== 'canvas') {
      throw new Error(`se esperaba canvas y llegó ${api.mode || 'nada'}`);
    }
    if (!String(track.stop).includes('meeteleportStop')) {
      throw new Error('la pista de vídeo no es la del tubo');
    }
    if (withAudio && stream.getAudioTracks().length !== 1) {
      throw new Error('falta la pista de audio');
    }
    direct.pass(`${api.mode}, ${api.frames - framesBefore} frames, pista del tubo`);
    report.passthrough = {
      mode: api.mode,
      frames: api.frames - framesBefore,
      label: track.label,
      audio: withAudio,
    };
    caption.textContent = 'Tubo directo: la imagen va sin marca.';

    if (api.setVanished(true) !== false) throw new Error('desapareció sin tener foto de la habitación');
    const shot = await api.captureRoom();
    if (!shot?.width || !api.hasRoom) throw new Error('no se guardó la habitación');
    if (api.setVanished(true) !== true) throw new Error('no se pudo salir de cuadro');
    await wait(400);
    const frozenA = sampleGrid();
    await wait(500);
    const frozenB = sampleGrid();
    const frozen = diffSamples(frozenA, frozenB);
    api.setVanished(false);
    await wait(700);
    const live = diffSamples(frozenB, sampleGrid());
    if (frozen > 40) throw new Error(`la habitación congelada se movió (${frozen})`);
    if (live < 80) throw new Error(`al volver, el vídeo no cambió (${live})`);
    room.pass(`quieta ${frozen}, en vivo ${live}`);
    report.room = { width: shot.width, height: shot.height, frozen, live };
    caption.textContent = 'La foto quieta sustituye a la cámara. Al volver, la imagen se mueve otra vez.';

    await releaseVideo(stream);
    preview.srcObject = null;
    release.pass('cámara de origen cerrada, micrófono intacto hasta que se corta aparte');
    report.released = true;

    if (!api.setMarker(true)) throw new Error('la marca de prueba no se activó en este origen');
    const markedFrames = api.frames;
    const marked = await openCamera(false);
    await show(marked);
    if (!String(marked.getVideoTracks()[0].stop).includes('meeteleportStop')) {
      throw new Error('la pista con marca no es la del tubo');
    }
    const pixel = await waitUntil('el cuadrado cian no apareció', () => {
      if (api.mode !== 'canvas' || api.frames < markedFrames + 3 || !preview.videoWidth) return null;
      const sample = sampleCorner();
      return isCyan(sample) ? sample : null;
    }, 5000);
    marker.pass(`rgb(${pixel.join(', ')}) en tubo canvas`);
    report.marker = { mode: api.mode, pixel };

    const pillText = await waitUntil('la pastilla no ve el tubo canvas', () => {
      const host = document.getElementById('meeteleport-root');
      const text = host?.shadowRoot?.getElementById('meeteleport-label')?.textContent?.trim() || '';
      return text.includes('canvas') ? text : '';
    }, 3000);
    pill.pass(pillText);
    report.pill = pillText;
    report.pipesWhilePreview = api.activePipes;
    caption.textContent = 'Cuadrado cian: solo en este banco. En Meet la imagen va limpia.';

    result.dataset.status = 'pass';
    result.dataset.detail = JSON.stringify(report);
    result.textContent = 'La cámara pasa por la extensión.';
  }

  run().catch((err) => {
    const pending = checks.querySelector('li[data-state="pending"]');
    if (pending) {
      pending.dataset.state = 'fail';
      pending.textContent = `${pending.textContent} — ${err.message}`;
    }
    result.dataset.status = 'fail';
    result.dataset.detail = JSON.stringify({ error: err.message, ...snapshot() });
    result.textContent = err.message;
    caption.textContent = 'La prueba se detuvo.';
  }).finally(() => {
    retry.disabled = false;
  });
})();
