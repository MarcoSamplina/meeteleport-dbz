// Engancha getUserMedia antes de que la página lo use.
// Meet recibe otra pista de vídeo; en reposo los frames se reenvían sin dibujarlos.
(() => {
  'use strict';

  const state = {
    frames: 0,
    mode: '',
    activePipes: 0,
    sourcesReleased: 0,
    lastError: '',
    logs: [],
    marker: false,
    flashUntil: 0,
  };
  const gesture = {
    enabled: true,
    pending: false,
    seen: 0,
    nextId: 1,
    progress: 0,
    hand: false,
    face: false,
    lastSample: 0,
    hold: null,
  };
  const roomState = {
    bitmap: null,
    vanished: false,
    pending: null,
  };
  let hooked = false;
  const BRIDGE = 'MEETELEPORT_V1';

  function message(err) {
    if (!err) return 'error desconocido';
    return err.message || String(err);
  }

  function log(line) {
    state.logs.push(line);
    if (state.logs.length > 40) state.logs.shift();
    console.info('[meeteleport]', line);
  }

  function supportsInsertable() {
    return typeof MediaStreamTrackProcessor === 'function' &&
      typeof MediaStreamTrackGenerator === 'function';
  }

  function markerAllowed() {
    const host = location.hostname;
    const local = host === '127.0.0.1' || host === 'localhost';
    return local && location.port === '8765';
  }

  function setMarker(on) {
    state.marker = Boolean(on) && markerAllowed();
    log(state.marker ? 'marca de prueba activada' : 'marca de prueba desactivada');
    return state.marker;
  }

  function publish() {
    if (!hooked) return;
    const root = document.documentElement;
    if (!root) return;
    root.dataset.meeteleport = 'on';
    root.dataset.meeteleportFrames = String(state.frames);
    root.dataset.meeteleportMode = state.mode;
    root.dataset.meeteleportPipes = String(state.activePipes);
    root.dataset.meeteleportError = state.lastError;
    root.dataset.meeteleportVanished = roomState.vanished ? '1' : '0';
    root.dataset.meeteleportRoom = roomState.bitmap ? '1' : '0';
    root.dataset.meeteleportGesture = gesture.enabled ? '1' : '0';
    root.dataset.meeteleportCharge = String(Math.round(gesture.progress * 100));
  }

  function publishApi() {
    if (window.__meeteleport?.installed) return;
    const api = {};
    Object.defineProperties(api, {
      installed: { value: true },
      version: { value: '0.3.0' },
      supportsInsertable: { get: supportsInsertable },
      frames: { get: () => state.frames },
      mode: { get: () => state.mode },
      activePipes: { get: () => state.activePipes },
      sourcesReleased: { get: () => state.sourcesReleased },
      lastError: { get: () => state.lastError },
      logs: { get: () => state.logs.slice() },
      marker: { get: () => state.marker },
      vanished: { get: () => roomState.vanished },
      hasRoom: { get: () => Boolean(roomState.bitmap) },
      setMarker: { value: setMarker },
      captureRoom: { value: captureRoom },
      setVanished: { value: setVanished },
      toggleVanished: { value: toggleVanished },
      setGesture: { value: setGesture },
    });
    window.__meeteleport = Object.freeze(api);
  }

  // Cierra la cámara de origen cuando Meet suelta la pista que le dimos.
  function bindLifetime(output, source, extraCleanup) {
    let cleaned = false;
    let counted = false;
    let nativeStop = null;
    try {
      nativeStop = output.stop.bind(output);
      output.stop = function meeteleportStop() {
        try { nativeStop(); } catch { /* ya terminó */ }
        finish('stop');
      };
    } catch (err) {
      log('no se pudo envolver stop(): ' + message(err));
    }

    const watch = setInterval(() => {
      if (output.readyState === 'ended' || source.readyState === 'ended') finish('watch');
    }, 150);

    function noteReleased() {
      if (counted) return;
      counted = true;
      state.sourcesReleased += 1;
    }

    async function finish(reason) {
      if (cleaned) return;
      cleaned = true;
      clearInterval(watch);
      state.activePipes -= 1;
      // Primero se suelta el lector. Si no, Chrome no deja cerrar la cámara de origen.
      try { await extraCleanup(); } catch (err) { log('limpieza: ' + message(err)); }
      try {
        if (source.readyState === 'live') source.stop();
      } catch (err) {
        log('stop origen: ' + message(err));
      }
      try {
        if (nativeStop && output.readyState === 'live') nativeStop();
      } catch { /* ya terminó */ }
      if (source.readyState === 'ended') noteReleased();
      log('tubo cerrado (' + reason + ') origen=' + source.readyState);
      publish();
    }

    output.addEventListener('ended', () => finish('output-ended'));
    source.addEventListener('ended', () => {
      noteReleased();
      finish('source-ended');
    });
  }

  function adoptRoom(bitmap) {
    if (roomState.bitmap && roomState.bitmap !== bitmap) {
      try { roomState.bitmap.close(); } catch { /* ya cerrado */ }
    }
    roomState.bitmap = bitmap;
    publish();
  }

  function captureRoom() {
    if (state.activePipes < 1) return Promise.reject(new Error('no hay cámara en el tubo'));
    if (roomState.pending) return roomState.pending.promise;
    let finish = null;
    const promise = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (roomState.pending?.finish !== finish) return;
        roomState.pending = null;
        reject(new Error('no llegó un frame para la habitación'));
      }, 2000);
      finish = (err, info) => {
        clearTimeout(timer);
        if (roomState.pending?.finish === finish) roomState.pending = null;
        if (err) reject(err);
        else resolve(info);
      };
    });
    roomState.pending = { finish, promise };
    return promise;
  }

  function setVanished(on) {
    const next = Boolean(on);
    if (next && !roomState.bitmap) return false;
    roomState.vanished = next;
    log(next ? 'fuera de cuadro' : 'de vuelta en cuadro');
    publish();
    return roomState.vanished;
  }

  function toggleVanished() {
    return setVanished(!roomState.vanished);
  }

  const paint = document.createElement('canvas');
  const paintCtx = paint.getContext('2d', { alpha: false });

  function paintRoom(timestamp, width, height) {
    if (!paintCtx || !roomState.bitmap) throw new Error('sin habitación');
    if (paint.width !== width || paint.height !== height) {
      paint.width = width;
      paint.height = height;
    }
    paintCtx.drawImage(roomState.bitmap, 0, 0, width, height);
    const stamped = Math.round(timestamp);
    try {
      return new VideoFrame(paint, { timestamp: stamped, alpha: 'discard' });
    } catch {
      return new VideoFrame(paint, { timestamp: stamped });
    }
  }

  async function bitmapFromSource(source) {
    try {
      return await createImageBitmap(source);
    } catch {
      const copy = document.createElement('canvas');
      const width = source.displayWidth || source.videoWidth || source.width;
      const height = source.displayHeight || source.videoHeight || source.height;
      copy.width = width;
      copy.height = height;
      copy.getContext('2d').drawImage(source, 0, 0, width, height);
      return createImageBitmap(copy);
    }
  }

  function rememberRoom() {
    if (!roomState.bitmap || !paintCtx) return;
    if (paint.width !== roomState.bitmap.width || paint.height !== roomState.bitmap.height) {
      paint.width = roomState.bitmap.width;
      paint.height = roomState.bitmap.height;
    }
    paintCtx.drawImage(roomState.bitmap, 0, 0);
    const image = paint.toDataURL('image/jpeg', 0.72);
    window.postMessage({ type: BRIDGE, action: 'ROOM_SAVED', image }, location.origin);
  }

  async function takePendingRoom(source) {
    const pending = roomState.pending;
    if (!pending) return;
    roomState.pending = null;
    const sample = source.clone ? source.clone() : source;
    try {
      const bitmap = await bitmapFromSource(sample);
      adoptRoom(bitmap);
      pending.finish(null, { width: bitmap.width, height: bitmap.height });
      rememberRoom();
    } catch (err) {
      pending.finish(err);
    } finally {
      if (sample !== source) {
        try { sample.close(); } catch { /* el clon ya se cerró */ }
      }
    }
  }

  function loadRoomImage(image) {
    if (typeof image !== 'string' || !image.startsWith('data:image/jpeg')) return;
    const img = new Image();
    img.onload = () => {
      createImageBitmap(img).then(adoptRoom).catch((err) => {
        state.lastError = message(err);
        publish();
      });
    };
    img.src = image;
  }

  function setGesture(on) {
    gesture.enabled = Boolean(on);
    if (!gesture.enabled) gesture.progress = 0;
    publish();
    return gesture.enabled;
  }

  function holdGate() {
    if (!gesture.hold && globalThis.MeetTeleportGesture) {
      gesture.hold = globalThis.MeetTeleportGesture.createHold();
    }
    return gesture.hold;
  }

  function teleport() {
    if (!roomState.bitmap) return false;
    state.flashUntil = performance.now() + 320;
    const gone = toggleVanished();
    log(gone ? 'teletransporte' : 'de vuelta');
    publish();
    return true;
  }

  function flashStrength() {
    if (!state.flashUntil) return 0;
    const left = state.flashUntil - performance.now();
    if (left <= 0) {
      state.flashUntil = 0;
      return 0;
    }
    return Math.sin((1 - left / 320) * Math.PI) * 0.72;
  }

  function drawFlash(ctx, width, height) {
    const alpha = flashStrength();
    if (alpha <= 0) return;
    const glow = ctx.createRadialGradient(width / 2, height * 0.28, 8, width / 2, height * 0.34, width * 0.58);
    glow.addColorStop(0, `rgba(255,255,255,${alpha})`);
    glow.addColorStop(0.4, `rgba(125,240,255,${alpha * 0.8})`);
    glow.addColorStop(1, 'rgba(125,240,255,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, width, height);
  }

  const sampleCanvas = document.createElement('canvas');
  const sampleCtx = sampleCanvas.getContext('2d', { alpha: false });

  function maybeSample(source) {
    if (!gesture.enabled || !roomState.bitmap || gesture.pending || document.hidden) return;
    const now = performance.now();
    if (now - gesture.lastSample < 170) return;
    const width = source.displayWidth || source.videoWidth || source.width;
    const height = source.displayHeight || source.videoHeight || source.height;
    if (!width || !height || !sampleCtx) return;
    const targetW = 320;
    const targetH = Math.max(1, Math.round(height * (targetW / width)));
    if (sampleCanvas.width !== targetW || sampleCanvas.height !== targetH) {
      sampleCanvas.width = targetW;
      sampleCanvas.height = targetH;
    }
    try {
      sampleCtx.drawImage(source, 0, 0, targetW, targetH);
    } catch {
      return;
    }
    gesture.lastSample = now;
    gesture.pending = true;
    const id = gesture.nextId;
    gesture.nextId += 1;
    const timer = setTimeout(() => {
      if (gesture.seen < id) gesture.pending = false;
    }, 4000);
    sampleCanvas.toBlob((blob) => {
      if (!blob) {
        clearTimeout(timer);
        gesture.pending = false;
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        window.postMessage({
          type: BRIDGE,
          action: 'GESTURE_FRAME',
          id,
          image: reader.result,
        }, location.origin);
      };
      reader.readAsDataURL(blob);
    }, 'image/jpeg', 0.62);
  }

  function noteGesture(data) {
    if (!data || !Number.isInteger(data.id) || data.id <= gesture.seen) return;
    gesture.seen = data.id;
    gesture.pending = false;
    gesture.hand = data.hand === true;
    gesture.face = data.face === true;
    if (data.skipped) {
      publish();
      return;
    }
    const gate = holdGate();
    if (!gate || data.ok === false) {
      publish();
      return;
    }
    const update = gate.update(data.gesture === true && !data.skipped, performance.now());
    gesture.progress = update.progress;
    publish();
    if (update.triggered) teleport();
  }

  function outgoingFrame(source, timestamp, width, height) {
    if (!paintCtx) throw new Error('sin lienzo');
    if (paint.width !== width || paint.height !== height) {
      paint.width = width;
      paint.height = height;
    }
    if (source === 'room') paintCtx.drawImage(roomState.bitmap, 0, 0, width, height);
    else paintCtx.drawImage(source, 0, 0, width, height);
    drawFlash(paintCtx, width, height);
    const stamped = Math.round(timestamp);
    try {
      return new VideoFrame(paint, { timestamp: stamped, alpha: 'discard' });
    } catch {
      return new VideoFrame(paint, { timestamp: stamped });
    }
  }

  function pipeInsertable(track) {
    const processor = new MediaStreamTrackProcessor({ track });
    const generator = new MediaStreamTrackGenerator({ kind: 'video' });
    const reader = processor.readable.getReader();
    const writer = generator.writable.getWriter();
    state.mode = 'insertable';
    state.activePipes += 1;
    log('cámara en tubo directo');
    publish();

    let running = true;
    bindLifetime(generator, track, () => {
      running = false;
      return Promise.allSettled([reader.cancel(), writer.close()]);
    });

    (async () => {
      try {
        while (running) {
          const { done, value } = await reader.read();
          if (done || !value) break;
          if (!running || generator.readyState !== 'live') {
            value.close();
            break;
          }
          try {
            maybeSample(value);
            await takePendingRoom(value);
            if (!running || generator.readyState !== 'live') {
              value.close();
              break;
            }
            const width = value.displayWidth || value.codedWidth;
            const height = value.displayHeight || value.codedHeight;
            const timestamp = Number.isFinite(value.timestamp) ? value.timestamp : performance.now() * 1000;
            const flash = flashStrength();
            if ((roomState.vanished && roomState.bitmap) || flash > 0) {
              let stamped = null;
              try {
                stamped = outgoingFrame(roomState.vanished && roomState.bitmap ? 'room' : value, timestamp, width, height);
              } catch (err) {
                state.lastError = message(err);
                log('no pude componer el frame: ' + state.lastError);
              }
              if (stamped) {
                value.close();
                await writer.write(stamped);
                state.frames += 1;
                continue;
              }
            }
            await writer.write(value);
          } catch (err) {
            try { value.close(); } catch { /* el frame ya se consumió */ }
            if (running) {
              state.lastError = message(err);
              log('escritura de frame falló: ' + state.lastError);
            }
            break;
          }
          state.frames += 1;
        }
      } catch (err) {
        if (running) {
          state.lastError = message(err);
          log('lectura de frame falló: ' + state.lastError);
        }
      } finally {
        if (running) {
          try { generator.stop(); } catch { /* ya cerrado */ }
        }
      }
    })();

    return generator;
  }

  function pipeCanvas(track) {
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.autoplay = true;
    video.srcObject = new MediaStream([track]);

    const canvas = document.createElement('canvas');
    const settings = typeof track.getSettings === 'function' ? track.getSettings() : {};
    canvas.width = settings.width || 640;
    canvas.height = settings.height || 480;
    const ctx = canvas.getContext('2d', { alpha: false, desynchronized: true });
    if (!ctx) throw new Error('sin contexto 2d');
    const output = canvas.captureStream(30).getVideoTracks()[0];
    if (!output) throw new Error('captureStream no dio pista de vídeo');

    state.mode = 'canvas';
    state.activePipes += 1;
    log(state.marker ? 'cámara en tubo canvas con marca' : 'cámara en tubo canvas');
    publish();

    let running = true;
    const timer = setInterval(draw, 1000 / 30);
    bindLifetime(output, track, () => {
      running = false;
      clearInterval(timer);
      try { video.pause(); } catch { /* ya pausado */ }
      video.srcObject = null;
      video.remove();
    });

    ensurePlay();
    return output;

    function draw() {
      if (!running || video.readyState < 2) return;
      const width = video.videoWidth;
      const height = video.videoHeight;
      if (!width || !height) return;
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      if (roomState.pending) {
        const pending = roomState.pending;
        roomState.pending = null;
        createImageBitmap(video).then((bitmap) => {
          adoptRoom(bitmap);
          pending.finish(null, { width: bitmap.width, height: bitmap.height });
          rememberRoom();
        }).catch((err) => pending.finish(err));
      }
      maybeSample(video);
      if (roomState.vanished && roomState.bitmap) {
        ctx.drawImage(roomState.bitmap, 0, 0, width, height);
      } else {
        ctx.drawImage(video, 0, 0, width, height);
        if (state.marker) {
          ctx.fillStyle = '#00ffff';
          ctx.fillRect(0, 0, 24, 24);
        }
      }
      drawFlash(ctx, width, height);
      state.frames += 1;
    }

    async function ensurePlay() {
      let logged = false;
      while (running) {
        try {
          await video.play();
          return;
        } catch (err) {
          if (!logged) {
            logged = true;
            log('reintentando reproducir el vídeo oculto: ' + message(err));
          }
          await new Promise((resolve) => setTimeout(resolve, 300));
        }
      }
    }
  }

  function pipeVideoTrack(track) {
    const useCanvas = state.marker || !supportsInsertable();
    if (!useCanvas) {
      try {
        return pipeInsertable(track);
      } catch (err) {
        state.lastError = message(err);
        log('tubo directo no disponible, uso canvas: ' + state.lastError);
      }
    }
    try {
      return pipeCanvas(track);
    } catch (err) {
      state.lastError = message(err);
      log('canvas no disponible, devuelvo la cámara original: ' + state.lastError);
      return track;
    }
  }

  function pipeStream(stream) {
    try {
      const videos = stream.getVideoTracks();
      if (videos.length === 0) return stream;
      const out = new MediaStream();
      for (const track of stream.getAudioTracks()) out.addTrack(track);
      for (const track of videos) out.addTrack(pipeVideoTrack(track));
      return out;
    } catch (err) {
      state.lastError = message(err);
      log('no se pudo abrir el tubo: ' + state.lastError);
      publish();
      return stream;
    }
  }

  function install() {
    const Ctor = window.MediaDevices;
    const devices = navigator.mediaDevices;
    if (!Ctor || !devices || typeof Ctor.prototype.getUserMedia !== 'function') return false;
    publishApi();
    if (Ctor.prototype.getUserMedia.__meeteleport) {
      hooked = true;
      publish();
      window.postMessage({ type: BRIDGE, action: 'READY' }, location.origin);
      return true;
    }

    const original = Ctor.prototype.getUserMedia;
    function getUserMedia(constraints) {
      let pending;
      try {
        pending = original.call(this, constraints);
      } catch (err) {
        return Promise.reject(err);
      }
      return Promise.resolve(pending).then(pipeStream);
    }
    try { getUserMedia.__meeteleport = true; } catch { /* función sellada */ }
    Ctor.prototype.getUserMedia = getUserMedia;
    hooked = true;
    log('tubo listo');
    publish();
    window.postMessage({ type: BRIDGE, action: 'READY' }, location.origin);
    return true;
  }

  function boot() {
    if (install()) return;
    const started = Date.now();
    const timer = setInterval(() => {
      if (install() || Date.now() - started > 10000) clearInterval(timer);
    }, 20);
  }

  window.addEventListener('message', (event) => {
    if (event.source !== window || event.origin !== location.origin) return;
    const data = event.data;
    if (!data || data.type !== BRIDGE) return;
    if (data.action === 'GESTURE') {
      setGesture(!gesture.enabled);
    } else if (data.action === 'GESTURE_RESULT') {
      noteGesture(data);
    } else if (data.action === 'CAPTURE') {
      captureRoom().catch((err) => {
        state.lastError = message(err);
        log(state.lastError);
        publish();
      });
    } else if (data.action === 'TOGGLE') {
      toggleVanished();
    } else if (data.action === 'ROOM_LOAD') {
      loadRoomImage(data.image);
    }
  });

  boot();
  setInterval(publish, 250);
  document.addEventListener('DOMContentLoaded', publish);
})();
