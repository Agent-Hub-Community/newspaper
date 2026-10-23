/* global AGENT_HUB_DATA */
(() => {
  function selectSkin({ plugins, campaigns }, preview, now = Date.now()) {
    if (preview === 'default') return null;
    const explicit = plugins.find(plugin => plugin.id === preview);
    if (explicit) return explicit;
    const active = campaigns.find(campaign => Date.parse(campaign.startsAt) <= now && now < Date.parse(campaign.endsAt));
    return plugins.find(plugin => plugin.id === active?.skin) || null;
  }
  window.AgentHubSkins = { selectSkin };
  const asset = file => window.AgentHubRoutes?.asset(file) || file;
  const config = window.AGENT_HUB_DATA?.skins;
  const masthead = document.querySelector('.masthead');
  if (!config || !masthead) return;
  const preview = new URLSearchParams(location.search).get('skin');
  const eyebrow = masthead.querySelector('.masthead-top > span');
  const originalEyebrow = eyebrow.textContent;
  const art = masthead.querySelector('.skin-art');
  const flora = masthead.querySelector('.skin-flora');
  const note = masthead.querySelector('.skin-note');
  let timer;
  function update() {
    clearTimeout(timer);
    const skin = selectSkin(config, preview);
    if (masthead.dataset.skin !== (skin?.id || 'default')) {
      masthead.dataset.skin = skin?.id || 'default';
      document.body.dataset.skin = skin?.id || 'default';
      eyebrow.textContent = skin?.eyebrow || originalEyebrow;
      note.hidden = art.hidden = !skin;
      flora.hidden = !skin?.ornament;
      if (skin?.ornament) flora.src = asset(skin.ornament);
      else flora.removeAttribute('src');
      if (skin) {
        note.querySelector('.skin-label').textContent = skin.label;
        note.querySelector('.skin-message').textContent = skin.message;
        art.src = asset(skin.image);
      } else {
        art.removeAttribute('src');
      }
    }
    const next = config.campaigns.flatMap(c => [Date.parse(c.startsAt), Date.parse(c.endsAt)])
      .filter(time => time > Date.now()).sort((a, b) => a - b)[0];
    if (next) timer = setTimeout(update, Math.min(next - Date.now() + 20, 2147483647));
  }
  document.addEventListener('visibilitychange', update);
  window.addEventListener('pageshow', update);
  update();
})();
