/* global lucide */
(() => {
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const labels = { week: '周榜', month: '月榜', all: '总榜' };
  const titles = { week: '本周最活跃的群友', month: '本月最活跃的群友', all: '累计最活跃的群友' };
  const groupLabels = { 'group-1': '一群', 'group-2': '二群', 'group-3': '三群', 'group-4': '四群', 'group-5': '五群' };
  const asset = file => window.AgentHubRoutes?.asset(file) || file;
  const dayText = date => date.replace(/^\d{4}-0?(\d+)-0?(\d+)$/, '$1 月 $2 日');
  // One board shows the whole community and every group for the chosen period, all alike; a group in
  // the route (rank/week/group-2/) is only kept for the way back to that group's daily page.
  // The masthead already gives the end date.
  window.renderRanking = (period, navigate, data, groupId) => {
    const activity = data.activity;
    const window = activity?.windows?.[period.id];
    const groups = activity?.groups.filter(group => Object.hasOwn(groupLabels, group.id)) || [];
    // Records of a group can start after the period does (总榜 has no common start); that column says so.
    const start = from => from && from !== window?.from ? `${dayText(from)}起` : '';
    const firstOf = group => window?.from && group.first ? (window.from > group.first ? window.from : group.first) : window?.from || group.first;
    const communityFirst = groups.map(group => group.first).filter(Boolean).sort()[0];
    const leaders = (stats, label) => stats?.leaders?.length
      ? `<ol class="activity-leaders" aria-label="${esc(label)}${esc(labels[period.id])}前三名">${stats.leaders.slice(0, 3).map(member =>
        `<li><span class="avatar-frame">${activity.avatars[member.key]
          ? `<img src="${esc(asset(activity.avatars[member.key]))}${data.avatarVersion ? `?v=${esc(data.avatarVersion)}` : ''}" alt="第 ${esc(member.rank)} 名成员头像" width="56" height="56"><span class="avatar-missing" aria-label="头像未获取" hidden><i data-lucide="user-round"></i></span>`
          : '<span class="avatar-missing" aria-label="头像未获取"><i data-lucide="user-round"></i></span>'}</span><span class="rank-number">${esc(member.rank)}</span></li>`).join('')}</ol>`
      : `<p class="rank-empty">${stats ? '本期暂无' : '暂无记录'}</p>`;
    const column = (id, label, stats, since) => `<section class="rank-column" aria-labelledby="rank-${id}">
        <h2 id="rank-${id}">${esc(label)}</h2>${since ? `<p class="rank-since">${esc(since)}</p>` : ''}${leaders(stats, label)}</section>`;
    document.querySelector('#reading').innerHTML = `
      <header class="digest-heading rank-page-heading">
        <div><h1>${titles[period.id]}</h1>
          <p class="digest-deck">${period.id === 'all' ? '从各群有记录的那天算起' : window?.from ? `${esc(dayText(window.from))}起` : ''}</p></div>
        <div class="rank-periods" role="group" aria-label="榜单周期">${Object.entries(labels).map(([id, label]) =>
          `<button type="button" data-rank="${id}" aria-pressed="${id === period.id}">${label}</button>`).join('')}</div>
      </header>
      ${activity ? `<div class="rank-board">${column('community', '全社区', activity.ranks?.[period.id], period.id === 'all' ? start(communityFirst) : '')}${groups.map(group =>
        column(group.id, groupLabels[group.id], group.available ? group.ranks?.[period.id] : null, group.available ? start(firstOf(group)) : '')).join('')}</div>`
        : '<p class="rank-empty" role="status">暂无可用榜单</p>'}`;
    for (const button of document.querySelectorAll('[data-rank]')) button.onclick = () => {
      if (button.getAttribute('aria-pressed') === 'true') return;
      navigate('rank', button.dataset.rank, false, groupId);
      document.querySelector(`[data-rank="${button.dataset.rank}"]`)?.focus({ preventScroll: true });
    };
    for (const image of document.querySelectorAll('.avatar-frame img')) image.addEventListener('error', () => {
      image.hidden = true;
      image.nextElementSibling.hidden = false;
    }, { once: true });
  };
})();
