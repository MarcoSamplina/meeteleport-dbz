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
