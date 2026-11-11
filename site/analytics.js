(() => {
  // Cloudflare Web Analytics beacon token of the site in site.mjs: a public identifier, not an account API
  // credential. The site agent-hub-community.github.io was added on 2026-11-11 under the Haoqingeric@gmail.com
  // account; before that the token was empty and only D1 page views (views.js) counted the new address.
  const token = '373b0ca1891b430f83c1c483e60ad8d2';
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
