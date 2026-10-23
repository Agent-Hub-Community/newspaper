(() => {
  const key = 'agenthub-appearance';
  const modes = ['system', 'light', 'dark'];
  const names = { system: '跟随系统', light: '浅色', dark: '深色' };
  // Inline SVG (Lucide sun-moon, sun, moon) so pages without the icon bundle can use the toggle.
  const icons = {
    system: '<path d="M12 8a2.83 2.83 0 0 0 4 4 4 4 0 1 1-4-4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.9 4.9 1.4 1.4"/><path d="m17.7 17.7 1.4 1.4"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.3 17.7-1.4 1.4"/><path d="m19.1 4.9-1.4 1.4"/>',
    light: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/>',
    dark: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>',
  };
  const system = matchMedia('(prefers-color-scheme: dark)');
  let mode = 'system';
  try {
    const saved = localStorage.getItem(key);
    if (modes.includes(saved)) mode = saved;
  } catch { /* Storage can be blocked; the current tab still supports switching. */ }
  function update() {
    document.documentElement.dataset.colorScheme = mode === 'system' ? (system.matches ? 'dark' : 'light') : mode;
    for (const button of document.querySelectorAll('.appearance-toggle')) {
      const next = modes[(modes.indexOf(mode) + 1) % modes.length];
      button.title = `明暗：${names[mode]}；点击切换为${names[next]}`;
      button.setAttribute('aria-label', button.title);
      button.dataset.mode = mode;
      button.innerHTML = `<svg class="lucide" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[mode]}</svg>`;
    }
  }
  window.AgentHubAppearance = { update };
  document.addEventListener('click', event => {
    if (!event.target.closest('.appearance-toggle')) return;
    mode = modes[(modes.indexOf(mode) + 1) % modes.length];
    try { localStorage.setItem(key, mode); } catch { /* Keep the tab preference. */ }
    update();
  });
  window.addEventListener('storage', event => {
    if (event.key !== key && event.key !== null) return;
    mode = modes.includes(event.newValue) ? event.newValue : 'system';
    update();
  });
  system.addEventListener('change', update);
  document.addEventListener('DOMContentLoaded', update);
  update();
})();
