(() => {
  const prefix = 'agenthub:feedback:v1:';
  const endpoint = window.AGENT_HUB_DATA?.feedbackEndpoint;
  const remote = location.protocol !== 'file:' && Boolean(endpoint);
  const read = key => {
    try { return localStorage.getItem(prefix + key); } catch { return null; }
  };
  const write = (key, value) => {
    try { localStorage.setItem(prefix + key, value); return true; } catch { return false; }
  };
  let voter = read('voter');
  if (!/^[a-f0-9-]{36}$/.test(voter || '')) {
    voter = crypto.randomUUID();
    write('voter', voter);
  }
  const memory = new Map();
  function validate(data) {
    if (![null, 'up', 'down'].includes(data.vote)
        || !Number.isSafeInteger(data.up) || data.up < 0
        || !Number.isSafeInteger(data.down) || data.down < 0) {
      throw new Error('Invalid feedback response');
    }
    return data;
  }
  async function request(story, vote) {
    const url = new URL('votes', endpoint.endsWith('/') ? endpoint : `${endpoint}/`);
    const options = { credentials: 'omit', referrerPolicy: 'no-referrer', signal: AbortSignal.timeout(8000) };
    if (vote === undefined) {
      url.search = new URLSearchParams({ story, voter });
    } else {
      options.method = 'PUT';
      options.headers = { 'Content-Type': 'application/json' };
      options.body = JSON.stringify({ story, voter, vote });
    }
    const response = await fetch(url, options);
    if (!response.ok) throw new Error('Feedback unavailable');
    return validate(await response.json());
  }
  window.AgentHubFeedback = {
    mount(container, stories) {
      [...container.querySelectorAll('.brief')].forEach((article, index) => {
        const story = stories[index]?.feedbackId;
        if (!story) return;
        const stored = memory.get(story) ?? read(story);
        let state = { vote: ['up', 'down'].includes(stored) ? stored : null, up: null, down: null };
        let busy = false, loaded = !remote;
        const row = document.createElement('div');
        row.className = 'story-feedback';
        row.setAttribute('role', 'group');
        row.setAttribute('aria-label', `评价：${stories[index].title}`);
        row.innerHTML = `<div class="feedback-actions">
          <button type="button" data-vote="up" aria-label="赞" aria-pressed="false" title="赞"><i data-lucide="thumbs-up"></i><span class="vote-count"></span></button>
          <button type="button" data-vote="down" aria-label="踩" aria-pressed="false" title="踩"><i data-lucide="thumbs-down"></i><span class="vote-count"></span></button>
        </div><span class="feedback-status" role="status" aria-live="polite"></span>`;
        // Share the article's last row with the discussion trigger when there is one.
        (article.querySelector('.brief-actions') || article).append(row);
        const status = row.querySelector('.feedback-status');
        const buttons = [...row.querySelectorAll('button')];
        function paint() {
          row.setAttribute('aria-busy', String(busy));
          for (const button of buttons) {
            const selected = state.vote === button.dataset.vote;
            const label = button.dataset.vote === 'up' ? '赞' : '踩';
            button.setAttribute('aria-pressed', String(selected));
            button.setAttribute('aria-label', selected ? `取消${label}` : label);
            button.title = (selected ? `取消${label}` : label) + (remote ? '' : '（仅保存在此设备）');
            button.disabled = busy;
            const count = state[button.dataset.vote];
            button.querySelector('.vote-count').textContent = count ?? '—';
            button.setAttribute('aria-description', count === null
              ? (remote ? '计数暂未获取' : '本地预览不计入全站票数')
              : `${count} 人${label}`);
          }
        }
        async function load() {
          busy = true;
          paint();
          try {
            state = await request(story);
            loaded = true;
            status.textContent = '';
          } catch {
            // The endpoint sits on workers.dev, which mainland networks block without a proxy.
            status.textContent = '当前网络连不上反馈服务，点击重试';
          } finally {
            busy = false;
            paint();
          }
        }
        for (const button of buttons) button.onclick = async () => {
          if (busy) return;
          if (!loaded) { await load(); return; }
          const vote = state.vote === button.dataset.vote ? null : button.dataset.vote;
          if (!remote) {
            state.vote = vote;
            memory.set(story, vote || '');
            const saved = write(story, vote || '');
            status.textContent = saved ? '仅保存在此设备' : '仅本次有效，浏览器无法保存';
            paint();
            return;
          }
          busy = true;
          status.textContent = '正在提交';
          paint();
          try {
            state = await request(story, vote);
            status.textContent = state.vote ? '已提交' : '已取消';
          } catch {
            // A timeout may have committed on the server. Re-read before another vote.
            loaded = false;
            status.textContent = '未确认提交，点击重试';
          } finally {
            busy = false;
            paint();
          }
        };
        paint();
        if (remote) load();
      });
    },
  };
})();
