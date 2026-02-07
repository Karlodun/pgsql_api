const statusEl = document.getElementById('status');

const tabs = document.querySelectorAll('.tab');
const tabContents = document.querySelectorAll('.tab-content');

tabs.forEach((tab) => {
  tab.addEventListener('click', () => {
    tabs.forEach((btn) => btn.classList.remove('active'));
    tabContents.forEach((content) => content.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById(`tab-${tab.dataset.tab}`).classList.add('active');
  });
});

async function fetchJson(action) {
  const response = await fetch(`api.php?action=${action}`);
  return response.json();
}

function renderList(targetId, items, formatter) {
  const target = document.getElementById(targetId);
  target.innerHTML = '';
  items.forEach((item) => {
    const li = document.createElement('li');
    li.textContent = formatter(item);
    target.appendChild(li);
  });
}

async function init() {
  try {
    const meta = await fetchJson('meta');
    statusEl.textContent = meta.ok ? 'Подключено' : 'Ошибка';

    const pools = await fetchJson('pools');
    renderList('pools', pools.data || [], (pool) => {
      return `${pool.name} (${pool.raid}) · ${pool.used_gb}/${pool.total_gb} GB · ${pool.tier}`;
    });

    const devices = await fetchJson('devices');
    renderList('devices', devices.data || [], (device) => {
      return `${device.name} · ${device.type} · ${device.size_gb} GB · ${device.status}`;
    });

    const snapshots = await fetchJson('snapshots');
    const snapshotList = snapshots.data?.snapshots || [];
    renderList('snapshots', snapshotList, (snapshot) => {
      return `${snapshot.path} · ${snapshot.created_at}`;
    });

    const policies = snapshots.data?.policies || [];
    document.getElementById('snapshot-policies').textContent = JSON.stringify(policies, null, 2);

    const settings = {
      hosts: meta.data?.security?.local_only ? 'Local only' : 'Remote',
      sudo_ttl: meta.data?.security?.sudo_ttl_minutes,
    };
    document.getElementById('settings').textContent = JSON.stringify(settings, null, 2);

    const zenbox = await fetchJson('zenbox');
    document.getElementById('zenbox').textContent = JSON.stringify(zenbox.data, null, 2);

    const operations = await fetchJson('operations');
    document.getElementById('operations').textContent = JSON.stringify(operations.data, null, 2);
  } catch (error) {
    statusEl.textContent = 'Ошибка загрузки';
  }
}

init();
