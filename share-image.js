(() => {
  const dialog = document.querySelector('#share-dialog');
  const status = dialog.querySelector('#share-status');
  const preview = dialog.querySelector('#share-image');
  const download = dialog.querySelector('#share-download');
  const nativeShare = dialog.querySelector('#share-native');
  const retry = dialog.querySelector('#share-retry');
  const assetRoot = window.AgentHubRoutes?.root || document.baseURI;
  // iOS Safari refuses canvases above about 16.7M pixels or 16384px per side.
  const maxPixels = 16e6, maxSide = 16384;
  let busy = false, objectUrl = '', shareFile = null, lastRequest;

  let bundledImages;
  function loadBundledImages() {
    if (!bundledImages) bundledImages = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = new URL('export-images.js', assetRoot).href;
      script.onload = () => resolve(window.AGENT_HUB_EXPORT_IMAGES);
      script.onerror = () => { bundledImages = null; script.remove(); reject(new Error('Export images unavailable')); };
      document.head.append(script);
    });
    return bundledImages;
  }

  // The capture library is only needed after a reader asks for an image.
  let screenshotLibrary;
  function loadScreenshot() {
    if (window.modernScreenshot) return Promise.resolve(window.modernScreenshot);
    if (!screenshotLibrary) screenshotLibrary = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = new URL(document.querySelector('meta[name="agenthub-screenshot"]')?.content || 'screenshot.js', assetRoot).href;
      script.onload = () => resolve(window.modernScreenshot);
      script.onerror = () => { screenshotLibrary = null; script.remove(); reject(new Error('Screenshot library unavailable')); };
      document.head.append(script);
    });
    return screenshotLibrary;
  }

  // CSS backgrounds omit image cache queries; compare canonical local paths.
  async function inlineImage(url) {
    if (url.startsWith('data:')) return url;
    const target = new URL(url, document.baseURI);
    if (location.protocol === 'file:') {
      const images = await loadBundledImages();
      const entry = Object.entries(images).find(([file]) => new URL(file, assetRoot).pathname === target.pathname);
      if (!entry) throw new Error('Missing export image');
      return entry[1];
    }
    const image = [...document.images].find(img => img.complete && img.naturalWidth &&
      new URL(img.src).pathname === target.pathname);
    if (!image) throw new Error('Export image not loaded');
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    canvas.getContext('2d').drawImage(image, 0, 0);
    return canvas.toDataURL('image/png');
  }

  // Controls are hidden on an off-screen copy, so the reader's page never reflows.
  async function render() {
    const shell = document.querySelector('.paper-shell');
    const stage = document.createElement('div');
    stage.className = 'capture-stage';
    stage.setAttribute('aria-hidden', 'true');
    stage.inert = true;
    stage.style.width = `${shell.getBoundingClientRect().width}px`;
    const copy = shell.cloneNode(true);
    const link = document.createElement('span');
    link.className = 'capture-link';
    link.textContent = `${location.host}${location.pathname}${location.hash}`;
    copy.querySelector('#back-top').replaceWith(link);
    stage.append(copy);
    document.body.append(stage);
    try {
      await Promise.all([...copy.querySelectorAll('img')].map(img => img.decode().catch(() => {})));
      const { width, height } = copy.getBoundingClientRect();
      const scale = Math.min(2, Math.sqrt(maxPixels / (width * height)), maxSide / width, maxSide / height);
      return await (await loadScreenshot()).domToBlob(copy, {
        scale, type: 'image/png', font: false, fetchFn: inlineImage,
        backgroundColor: getComputedStyle(document.body).backgroundColor,
      });
    } finally {
      stage.remove();
    }
  }

  function reset() {
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrl = '';
    shareFile = null;
    preview.hidden = download.hidden = nativeShare.hidden = retry.hidden = true;
    preview.removeAttribute('src');
    download.removeAttribute('href');
    dialog.querySelector('.share-preview').scrollTop = 0;
  }

  async function save(name, filename) {
    if (busy) return;
    busy = true;
    lastRequest = { name, filename };
    reset();
    status.textContent = '正在生成图片…';
    if (!dialog.open) dialog.showModal();
    try {
      if (location.protocol === 'file:') await loadBundledImages();
      const blob = await render();
      if (!dialog.open) return;
      objectUrl = URL.createObjectURL(blob);
      download.href = objectUrl;
      download.download = filename;
      // The CSP allows data: images but not blob: images.
      preview.src = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(blob);
      });
      if (!dialog.open) return;
      preview.alt = `${name}图片`;
      preview.hidden = download.hidden = false;
      // WeChat and phones ignore download links; there, long-pressing the preview saves it.
      const touch = matchMedia('(pointer: coarse)').matches || /MicroMessenger/i.test(navigator.userAgent);
      if (touch) {
        status.textContent = '长按图片即可保存或发送给朋友。';
        const file = new File([blob], filename, { type: 'image/png' });
        if (navigator.share && navigator.canShare?.({ files: [file] })) {
          shareFile = file;
          nativeShare.hidden = false;
        }
      } else {
        download.click();
        status.textContent = '图片已开始下载。如果没有保存，可以右键图片另存。';
      }
    } catch {
      if (dialog.open) {
        reset();
        status.textContent = '图片生成失败，请重试。';
        retry.hidden = false;
      }
    } finally {
      busy = false;
    }
  }

  retry.addEventListener('click', () => save(lastRequest.name, lastRequest.filename));
  nativeShare.addEventListener('click', async () => {
    if (!shareFile) return;
    nativeShare.disabled = true;
    try {
      await navigator.share({ files: [shareFile] });
    } catch (error) {
      if (dialog.open && error.name !== 'AbortError') status.textContent = '分享失败，仍可长按图片保存。';
    } finally {
      nativeShare.disabled = false;
    }
  });
  dialog.addEventListener('close', reset);
  window.AgentHubShare = { save };
})();
