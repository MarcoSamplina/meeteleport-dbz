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
  };
  let hooked = false;

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
  }

  function publishApi() {
    if (window.__meeteleport?.installed) return;
    const api = {};
    Object.defineProperties(api, {
      installed: { value: true },
      version: { value: '0.1.0' },
      supportsInsertable: { get: supportsInsertable },
      frames: { get: () => state.frames },
      mode: { get: () => state.mode },
      activePipes: { get: () => state.activePipes },
      sourcesReleased: { get: () => state.sourcesReleased },
      lastError: { get: () => state.lastError },
      logs: { get: () => state.logs.slice() },
      marker: { get: () => state.marker },
      setMarker: { value: setMarker },
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
      ctx.drawImage(video, 0, 0, width, height);
      if (state.marker) {
        ctx.fillStyle = '#00ffff';
        ctx.fillRect(0, 0, 24, 24);
      }
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
    return true;
  }

  function boot() {
    if (install()) return;
    const started = Date.now();
    const timer = setInterval(() => {
      if (install() || Date.now() - started > 10000) clearInterval(timer);
    }, 20);
  }

  boot();
  setInterval(publish, 250);
  document.addEventListener('DOMContentLoaded', publish);
})();
