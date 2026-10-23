// Pastilla local. Solo la ve quien tiene la extensión; no entra en el vídeo.
(() => {
  'use strict';

  let isTop = false;
  try { isTop = window.top === window; } catch { isTop = false; }
  if (!isTop) return;

  const host = document.createElement('div');
  host.id = 'meeteleport-root';
  host.style.setProperty('all', 'initial', 'important');
  host.style.setProperty('position', 'fixed', 'important');
  host.style.setProperty('top', '12px', 'important');
  host.style.setProperty('right', '12px', 'important');
  host.style.setProperty('z-index', '2147483647', 'important');
  host.style.setProperty('pointer-events', 'auto', 'important');
  host.style.setProperty('display', 'block', 'important');

  const shadow = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = `
    .pill {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 6px 10px;
      border-radius: 999px;
      background: rgba(12, 18, 20, 0.92);
      color: #e7f6f6;
      font: 12px/1.2 ui-sans-serif, system-ui, sans-serif;
      border: 1px solid rgba(0, 229, 229, 0.45);
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.28);
      white-space: nowrap;
    }
    .dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: #8b9696;
      flex: none;
    }
    .dot.live { background: #5ee7e7; }
    .dot.warn { background: #e2b341; }
    button {
      border: 0;
      border-radius: 999px;
      background: #12383a;
      color: inherit;
      font: inherit;
      padding: 3px 8px;
      cursor: pointer;
    }
    button:disabled { opacity: 0.45; cursor: default; }
  `;
  const pill = document.createElement('div');
  pill.className = 'pill';
  pill.setAttribute('role', 'status');
  const dot = document.createElement('span');
  dot.className = 'dot';
  const label = document.createElement('span');
  label.id = 'meeteleport-label';
  label.textContent = 'Teleport · esperando la cámara';
  const captureBtn = document.createElement('button');
  captureBtn.type = 'button';
  captureBtn.textContent = 'Habitación';
  const toggleBtn = document.createElement('button');
  toggleBtn.type = 'button';
  toggleBtn.textContent = 'Desaparecer';
  toggleBtn.disabled = true;
  pill.append(dot, label, captureBtn, toggleBtn);
  shadow.append(style, pill);

  const BRIDGE = 'MEETELEPORT_V1';
  let countdown = 0;

  function post(action, extra) {
    window.postMessage({ type: BRIDGE, action, ...extra }, location.origin);
  }

  function sendStoredRoom() {
    chrome.storage.local.get('room', (items) => {
      if (chrome.runtime.lastError || typeof items.room !== 'string') return;
      if (!items.room.startsWith('data:image/jpeg') || items.room.length > 2_000_000) return;
      post('ROOM_LOAD', { image: items.room });
    });
  }

  captureBtn.addEventListener('click', async () => {
    if (countdown) return;
    captureBtn.disabled = true;
    for (let step = 3; step >= 1; step -= 1) {
      countdown = step;
      label.textContent = `Sal del cuadro · ${step}`;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    countdown = 0;
    captureBtn.disabled = false;
    post('CAPTURE');
  });
  toggleBtn.addEventListener('click', () => post('TOGGLE'));

  window.addEventListener('message', (event) => {
    if (event.source !== window || event.origin !== location.origin) return;
    const data = event.data;
    if (!data || data.type !== BRIDGE) return;
    if (data.action === 'READY') sendStoredRoom();
    if (data.action === 'ROOM_SAVED' && typeof data.image === 'string' &&
        data.image.startsWith('data:image/jpeg') && data.image.length <= 2_000_000) {
      chrome.storage.local.set({ room: data.image });
    }
  });
  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === 'MEETELEPORT_TOGGLE') post('TOGGLE');
  });

  function mount() {
    if (!document.body) return;
    if (host.isConnected) return;
    document.body.appendChild(host);
  }

  let lastFrames = 0;
  let lastTime = performance.now();
  const started = lastTime;
  let sawHook = false;

  function tick() {
    mount();
    const root = document.documentElement;
    const hook = root?.dataset.meeteleport === 'on';
    if (hook) sawHook = true;
    const frames = Number(root?.dataset.meeteleportFrames || 0);
    const pipes = Number(root?.dataset.meeteleportPipes || 0);
    const mode = root?.dataset.meeteleportMode || '';
    const error = root?.dataset.meeteleportError || '';
    const vanished = root?.dataset.meeteleportVanished === '1';
    const hasRoom = root?.dataset.meeteleportRoom === '1';
    toggleBtn.disabled = !hasRoom;
    toggleBtn.textContent = vanished ? 'Volver' : 'Desaparecer';
    const now = performance.now();
    const dt = (now - lastTime) / 1000;
    const fps = dt > 0 ? Math.round((frames - lastFrames) / dt) : 0;
    lastFrames = frames;
    lastTime = now;

    if (countdown > 0) {
      dot.className = 'dot warn';
      label.textContent = `Sal del cuadro · ${countdown}`;
      return;
    }
    if (vanished) {
      dot.className = 'dot live';
      label.textContent = 'Teleport · fuera de cuadro';
      return;
    }
    if (!sawHook && now - started > 1500) {
      dot.className = 'dot warn';
      label.textContent = 'Teleport · gancho no instalado';
      return;
    }
    if (pipes > 0) {
      const modeLabel = mode === 'canvas' ? 'tubo canvas' : mode === 'insertable' ? 'tubo directo' : 'tubo';
      dot.className = 'dot live';
      label.textContent = fps >= 1
        ? `Teleport · ${modeLabel} · ${fps} fps`
        : `Teleport · ${modeLabel} · en marcha`;
      return;
    }
    if (error && frames === 0) {
      dot.className = 'dot warn';
      label.textContent = 'Teleport · no se pudo enganchar la cámara';
      return;
    }
    dot.className = 'dot';
    label.textContent = 'Teleport · esperando la cámara';
  }

  setInterval(() => {
    mount();
    tick();
  }, 500);
  document.addEventListener('DOMContentLoaded', mount);
  mount();
})();
