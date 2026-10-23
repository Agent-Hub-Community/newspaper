(() => {
  // Cloudflare Web Analytics beacon token of the site in site.mjs: a public identifier, not an account API
  // credential. Leave it empty until that hostname has its own Web Analytics site; nothing loads while it is empty.
  const token = '';
  // Never measure local previews or other projects sharing the Pages hostname.
  // test/site.test.mjs keeps the hostname and path equal to site.mjs.
  if (!token || location.protocol !== 'https:' || location.hostname !== 'agent-hub-community.github.io'
      || !location.pathname.startsWith('/newspaper/')) return;
  const script = document.createElement('script');
  script.type = 'module';
  script.src = 'https://static.cloudflareinsights.com/beacon.min.js';
  script.dataset.cfBeacon = JSON.stringify({ token });
  document.head.append(script);
})();
