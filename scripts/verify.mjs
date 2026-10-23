// Abre Chrome, instala la extensión y comprueba el banco de pruebas.
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const extensionDir = path.join(root, 'extension');
const sandboxDir = path.join(root, 'sandbox');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function drain(stream, bucket) {
  stream.on('data', (chunk) => {
    bucket.push(chunk);
    let total = bucket.reduce((sum, part) => sum + part.length, 0);
    while (total > 30000 && bucket.length > 1) total -= bucket.shift().length;
  });
}

function createPipe(pipeWrite, pipeRead) {
  let buffer = Buffer.alloc(0);
  let nextId = 0;
  const pending = new Map();

  pipeRead.on('data', (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    let end = buffer.indexOf(0);
    while (end !== -1) {
      const raw = buffer.subarray(0, end).toString('utf8');
      buffer = buffer.subarray(end + 1);
      if (raw) {
        let message;
        try {
          message = JSON.parse(raw);
        } catch (err) {
          console.error('CDP ilegible:', raw.slice(0, 200));
          end = buffer.indexOf(0);
          continue;
        }
        if (message.id && pending.has(message.id)) {
          const { resolve, reject } = pending.get(message.id);
          pending.delete(message.id);
          if (message.error) reject(new Error(message.error.message || JSON.stringify(message.error)));
          else resolve(message.result || {});
        }
      }
      end = buffer.indexOf(0);
    }
  });

  function send(method, params = {}, sessionId, timeout = 20000) {
    const id = ++nextId;
    const payload = sessionId ? { id, sessionId, method, params } : { id, method, params };
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`tiempo agotado en ${method}`));
      }, timeout);
      pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        reject: (err) => {
          clearTimeout(timer);
          reject(err);
        },
      });
      pipeWrite.write(JSON.stringify(payload));
      pipeWrite.write('\0');
    });
  }

  return { send };
}

async function waitForServer() {
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch('http://127.0.0.1:8765/');
      if (response.ok) return;
    } catch { /* todavía arranca */ }
    await sleep(100);
  }
  throw new Error('el banco de pruebas no arrancó en el puerto 8765');
}

async function evaluate(send, sessionId, expression) {
  const { result, exceptionDetails } = await send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
  }, sessionId);
  if (exceptionDetails) {
    throw new Error(exceptionDetails.exception?.description || exceptionDetails.text || 'evaluate falló');
  }
  return result?.value;
}

async function screenshot(send, sessionId, file, captureBeyondViewport = true) {
  const shot = await send('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport,
  }, sessionId);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, Buffer.from(shot.data, 'base64'));
}

async function main() {
  const userDataDir = await mkdtemp(path.join(tmpdir(), 'meeteleport-chrome-'));
  const stdout = [];
  const stderr = [];
  let chrome;
  let server;
  let failed = false;

  const shutdown = async () => {
    if (chrome && !chrome.killed) {
      try { process.kill(-chrome.pid, 'SIGTERM'); } catch { try { chrome.kill('SIGTERM'); } catch { /* ya cerrado */ } }
    }
    if (server && !server.killed) server.kill('SIGTERM');
    await sleep(400);
    if (chrome && chrome.exitCode === null) {
      try { process.kill(-chrome.pid, 'SIGKILL'); } catch { try { chrome.kill('SIGKILL'); } catch { /* ya cerrado */ } }
    }
    await rm(userDataDir, { recursive: true, force: true });
  };

  try {
    server = spawn('python3', ['-m', 'http.server', '8765', '--bind', '127.0.0.1', '--directory', sandboxDir], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    drain(server.stdout, stdout);
    drain(server.stderr, stderr);
    await waitForServer();

    chrome = spawn('google-chrome', [
      '--remote-debugging-pipe',
      '--enable-unsafe-extension-debugging',
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      '--autoplay-policy=no-user-gesture-required',
      '--no-sandbox',
      '--disable-dev-shm-usage',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-sync',
      '--lang=es',
      '--window-size=1280,900',
      `--user-data-dir=${userDataDir}`,
      'about:blank',
    ], {
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe', 'pipe', 'pipe'],
      env: { ...process.env, DISPLAY: process.env.DISPLAY || ':1' },
    });
    drain(chrome.stdout, stdout);
    drain(chrome.stderr, stderr);
    const pipe = createPipe(chrome.stdio[3], chrome.stdio[4]);

    await pipe.send('Browser.getVersion');
    const loaded = await pipe.send('Extensions.loadUnpacked', { path: extensionDir });
    console.log('extensión instalada:', loaded.id);

    const { targetInfos } = await pipe.send('Target.getTargets');
    const page = targetInfos.find((target) => target.type === 'page');
    if (!page) throw new Error('Chrome no abrió una pestaña');
    const { sessionId } = await pipe.send('Target.attachToTarget', {
      targetId: page.targetId,
      flatten: true,
    });
    await pipe.send('Page.enable', {}, sessionId);
    await pipe.send('Runtime.enable', {}, sessionId);
    await pipe.send('Page.navigate', { url: 'http://127.0.0.1:8765/' }, sessionId);

    const deadline = Date.now() + 25000;
    let outcome;
    while (Date.now() < deadline) {
      outcome = await evaluate(pipe.send, sessionId, `(() => {
        const el = document.querySelector('#result');
        if (!el) return { status: 'missing' };
        return {
          status: el.dataset.status || '',
          detail: el.dataset.detail || '',
          text: el.textContent || '',
        };
      })()`);
      if (outcome?.status === 'pass' || outcome?.status === 'fail') break;
      await sleep(200);
    }

    const shot = path.join(tmpdir(), 'meeteleport-banco.png');
    await screenshot(pipe.send, sessionId, shot);
    console.log('captura banco:', shot);

    console.log('banco:', outcome?.status, outcome?.text);
    if (outcome?.detail) console.log(outcome.detail);
    if (outcome?.status !== 'pass') {
      failed = true;
      const debugShot = path.join(tmpdir(), 'meeteleport-fail.png');
      try { await screenshot(pipe.send, sessionId, debugShot); console.log('captura de fallo:', debugShot); } catch { /* sin captura */ }
      throw new Error(outcome?.text || 'la prueba no terminó');
    }

    await pipe.send('Page.navigate', { url: 'https://meet.google.com/meet/abc-defg-hij' }, sessionId);
    const meetDeadline = Date.now() + 20000;
    let meet;
    while (Date.now() < meetDeadline) {
      try {
        meet = await evaluate(pipe.send, sessionId, `(() => ({
          href: location.href,
          host: location.hostname,
          hook: document.documentElement?.dataset.meeteleport || '',
          installed: Boolean(window.__meeteleport?.installed),
          pill: document.getElementById('meeteleport-root')?.shadowRoot?.getElementById('meeteleport-label')?.textContent || '',
          width: window.innerWidth,
          ready: document.readyState,
        }))()`);
      } catch (err) {
        meet = { href: '', host: '', hook: '', installed: false, pill: '', error: err.message };
      }
      if (meet.host === 'meet.google.com' && meet.hook === 'on' && meet.installed && meet.pill.includes('Teleport') && meet.width > 200) break;
      await sleep(300);
    }
    console.log('meet:', JSON.stringify(meet));
    if (meet?.host === 'meet.google.com' && meet.hook === 'on' && meet.installed && meet.pill?.includes('Teleport')) {
      const cameraDeadline = Date.now() + 6000;
      while (Date.now() < cameraDeadline && !meet.pill.includes('tubo')) {
        await sleep(400);
        try {
          const next = await evaluate(pipe.send, sessionId, `(() => ({
            href: location.href,
            host: location.hostname,
            hook: document.documentElement?.dataset.meeteleport || '',
            installed: Boolean(window.__meeteleport?.installed),
            pill: document.getElementById('meeteleport-root')?.shadowRoot?.getElementById('meeteleport-label')?.textContent || '',
            width: window.innerWidth,
          }))()`);
          if (next?.host) meet = next;
        } catch { /* la página sigue navegando */ }
      }
      console.log('meet tras la espera:', JSON.stringify(meet));
      const meetShot = path.join(tmpdir(), 'meeteleport-meet.png');
      try {
        await screenshot(pipe.send, sessionId, meetShot, false);
      } catch (err) {
        await pipe.send('Emulation.setDeviceMetricsOverride', {
          width: 1280,
          height: 900,
          deviceScaleFactor: 1,
          mobile: false,
        }, sessionId);
        await screenshot(pipe.send, sessionId, meetShot, false);
        console.log('captura meet tras ajustar el viewport:', err.message);
      }
      console.log('captura meet:', meetShot);
    } else if (String(meet?.href || '').includes('meet.google.com')) {
      throw new Error('Meet cargó sin el gancho de la extensión');
    } else {
      console.log('Meet no se quedó en meet.google.com; el banco de pruebas sí pasó.');
    }
  } catch (err) {
    failed = true;
    console.error(err.message || err);
    const errText = Buffer.concat(stderr).toString('utf8').slice(-4000);
    if (errText.trim()) console.error(errText);
    process.exitCode = 1;
  } finally {
    await shutdown();
  }

  if (!failed) console.log('fase 1 verificada');
}

main();
