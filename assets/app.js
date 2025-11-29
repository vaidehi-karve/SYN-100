// Mapping of buttons to JSON filenames (placed in `data/`)
// Swap filenames here to match your exported Plotly JSON files.
const MAPS = [
  { id: 'economic', label: 'Economic Status', file: 'pollution_income.json' },
  { id: 'race', label: 'Race', file: 'pollution_race.json' },
  { id: 'age', label: 'Age', file: 'pollution_age.json' },
  { id: 'pollution', label: 'PM2.5', file: 'pollution_pm25.json' }
];

const dataPath = 'data/'; // relative path to JSON files in repo
const filtersEl = document.getElementById('filters');
const statusEl = document.getElementById('status');
const mapEl = document.getElementById('map');

function setStatus(text) {
  statusEl.textContent = text || '';
}

function makeButton(map) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.textContent = map.label;
  btn.dataset.file = map.file;
  btn.addEventListener('click', () => {
    document.querySelectorAll('#filters button').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    loadMap(map.file);
  });
  return btn;
}

async function loadMap(filename) {
  setStatus('Loading ' + filename + '...');
  try {
    const resp = await fetch(dataPath + filename, {cache: 'no-store'});
    if (!resp.ok) throw new Error(`HTTP ${resp.status} ${resp.statusText}`);
    const fig = await resp.json();

    // fig may be either a full figure object {data, layout} or an array of traces
    const data = fig.data || fig;
    const layout = fig.layout || (typeof fig === 'object' && fig.layout === undefined ? {} : fig.layout);

    const config = {
      responsive: true,
      displayModeBar: true,
      scrollZoom: false
    };

    // Use Plotly.react to update the existing div while keeping interactivity
    await Plotly.react(mapEl, data, layout, config);
    setStatus('');
  } catch (err) {
    console.error('Failed to load map', err);
    setStatus('Error loading ' + filename + ': ' + err.message);
    mapEl.innerHTML = '<div style="padding:18px;color:#b91c1c">Failed to load map. See console for details.</div>';
  }
}

function init() {
  // create buttons
  MAPS.forEach((m, i) => {
    const btn = makeButton(m);
    filtersEl.appendChild(btn);
    if (i === 0) btn.classList.add('active');
  });

  // Load the first map by default (if exists)
  if (MAPS.length) loadMap(MAPS[0].file);

  // Resize handler to trigger Plotly relayout for some embed contexts
  window.addEventListener('resize', () => {
    if (window.Plotly && mapEl.data) Plotly.Plots.resize(mapEl);
  });
}

document.addEventListener('DOMContentLoaded', init);
