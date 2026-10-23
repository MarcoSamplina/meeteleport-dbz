const OFFSCREEN = 'src/gesture-offscreen.html';
let gestureQueue = Promise.resolve();

async function ensureOffscreen() {
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
    documentUrls: [chrome.runtime.getURL(OFFSCREEN)],
  });
  if (contexts.length) return;
  await chrome.offscreen.createDocument({
    url: OFFSCREEN,
    reasons: ['BLOBS'],
    justification: 'Reconoce en local la pose de dos dedos en la frente.',
  });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== 'MEETELEPORT_GESTURE_FRAME') return false;
  const image = message.image;
  if (!sender.tab || typeof image !== 'string' || image.length > 250000 || !image.startsWith('data:image/jpeg;base64,')) {
    sendResponse({ ok: false, gesture: false });
    return false;
  }
  gestureQueue = gestureQueue.catch(() => {}).then(async () => {
    await ensureOffscreen();
    return chrome.runtime.sendMessage({
      target: 'MEETELEPORT_OFFSCREEN',
      type: 'DETECT',
      image,
    });
  }).then(
    (result) => sendResponse(result || { ok: false, gesture: false }),
    () => sendResponse({ ok: false, gesture: false }),
  );
  return true;
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== 'toggle-vanish') return;
  try {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (!tab?.id) return;
    if (tab.url && !tab.url.startsWith('https://meet.google.com/') &&
        !tab.url.startsWith('http://127.0.0.1:8765/') &&
        !tab.url.startsWith('http://localhost:8765/')) return;
    await chrome.tabs.sendMessage(tab.id, { type: 'MEETELEPORT_TOGGLE' });
  } catch (err) {
    console.debug('[meeteleport] atajo no disponible en esta pestaña', err);
  }
});
