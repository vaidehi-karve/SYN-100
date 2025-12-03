// The app now loads `data/manifest.json` to discover JSON files in the `data/` folder.
// `manifest.json` should be an array of filenames (strings) or objects {file, label}.
// If the manifest isn't present, FALLBACK_MAPS will be used.
const FALLBACK_MAPS = [
  { id: 'economic', label: 'Economic Status', file: 'pollution_income.json' },
  { id: 'race', label: 'Race', file: 'pollution_race.json' },
  { id: 'age', label: 'Age', file: 'pollution_age.json' },
  { id: 'pollution', label: 'PM2.5', file: 'pollution_pm25.json' }
];

const dataPath = 'data/'; // relative path to JSON files in repo (and manifest)
const filtersEl = document.getElementById('filters');
const statusEl = document.getElementById('status');
const mapEl = document.getElementById('map');
const subcatEl = document.getElementById('subcategories');

// Store discovered maps so we can rebuild UI when subcategories change
let ALL_MAPS = [];
let CURRENT_MAPS = [];

function setStatus(text) {
  statusEl.textContent = text || '';
}

function tidyLabel(filename) {
  if (!filename) return '';
  const name = filename.replace(/\.json$/i, '').replace(/[_-]+/g, ' ');
  return name.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

// County mapping and Bay Area filter (ported from your notebook)
const COUNTY_MAP = {
  '001': 'Alameda',
  '013': 'Contra Costa',
  '041': 'Marin',
  '055': 'Napa',
  '075': 'San Francisco',
  '081': 'San Mateo',
  '085': 'Santa Clara',
  '095': 'Solano',
  '097': 'Sonoma'
};

const BAY_COUNTIES = [
  'Alameda', 'Contra Costa', 'Marin', 'Napa',
  'San Francisco', 'Solano', 'Sonoma',
  'San Mateo', 'Santa Clara'
];

function percentileRanks(values) {
  // values: array of numbers (may contain null). Returns array of percentiles 0..1.
  const pairs = values.map((v, i) => ({ v, i }));
  const valid = pairs.filter(p => p.v !== null && !Number.isNaN(p.v));
  valid.sort((a, b) => a.v - b.v);
  const n = valid.length;
  const rank = new Array(values.length).fill(null);
  for (let j = 0; j < valid.length; j++) {
    const countLE = j + 1; // number of items <= current
    rank[valid[j].i] = countLE / n;
  }
  return rank;
}

function buildChoroplethFromGeojson(geojson) {
  // Accepts a FeatureCollection where each feature.properties has `geoid` and `value`.
  const features = (geojson && geojson.type === 'FeatureCollection') ? geojson.features.slice() : [];

  // compute county and filter to Bay Area
  const filtered = features.filter(f => {
    const geoid = String((f.properties && f.properties.geoid) || '');
    if (geoid.length < 5) return false;
    const county_fips = geoid.slice(2, 5);
    const county = COUNTY_MAP[county_fips] || null;
    if (!county) return false;
    f.properties.county = county;
    return BAY_COUNTIES.includes(county);
  });

  // helper to coerce numeric-like strings to numbers (removes commas, percent signs)
  function parseNum(v) {
    if (v === undefined || v === null) return null;
    if (typeof v === 'number') return v;
    if (typeof v === 'string') {
      const s = v.trim().replace(/,/g, '').replace(/%/g, '');
      if (s === '') return null;
      const n = Number(s);
      return Number.isFinite(n) ? n : null;
    }
    return null;
  }

  // attach id and gather values (coerce strings)
  const values = filtered.map(f => {
    const raw = f.properties && (f.properties.value ?? f.properties.VALUE ?? f.properties.Val ?? f.properties.val);
    const v = parseNum(raw);
    f.properties.id = String(f.properties.geoid);
    return v;
  });

  // basic stats for diagnostics
  const validValues = values.filter(v => v !== null && !Number.isNaN(v));
  const count = filtered.length;
  const validCount = validValues.length;
  const min = validCount ? Math.min(...validValues) : null;
  const max = validCount ? Math.max(...validValues) : null;
  const mean = validCount ? validValues.reduce((a,b) => a+b,0)/validCount : null;
  console.info('Choropleth data:', { count, validCount, min, max, mean });
  setStatus(`Loaded ${count} features — ${validCount} values (min: ${min ?? 'n/a'}, max: ${max ?? 'n/a'})`);

  const percentiles = percentileRanks(values);
  filtered.forEach((f, idx) => {
    f.properties.percentile = percentiles[idx] === null ? null : percentiles[idx];
  });

  const fc = { type: 'FeatureCollection', features: filtered };

  const locations = filtered.map(f => f.properties.id);
  const z = filtered.map((f, idx) => percentiles[idx]);
  const customdata = filtered.map((f, idx) => [f.properties.value]);

  // resolve colorscale: accepts a preset string or an explicit array via window.PAGE_COLORSCALE
  const DEFAULT_RDYLGN = [
    [0, '#a50026'],   // deep red
    [0.5, '#ffffbf'], // pale yellow
    [1, '#006837']    // deep green
  ];

  const PRESET_SCALES = {
    // use Plotly/ColorBrewer 'Blues' gradient
    'Blues': [
      [0.0, '#f7fbff'],
      [0.125, '#deebf7'],
      [0.25, '#c6dbef'],
      [0.375, '#9ecae1'],
      [0.5, '#6baed6'],
      [0.625, '#4292c6'],
      [0.75, '#2171b5'],
      [0.875, '#08519c'],
      [1.0, '#08306b']
    ],
    // Greens (ColorBrewer / Plotly Greens)
    'Greens': [
      [0.0, '#f7fcf5'],
      [0.125, '#e5f5e0'],
      [0.25, '#c7e9c0'],
      [0.375, '#a1d99b'],
      [0.5, '#74c476'],
      [0.625, '#41ab5d'],
      [0.75, '#238b45'],
      [0.875, '#006d2c'],
      [1.0, '#00441b']
    ],
    'RdYlGn': DEFAULT_RDYLGN
  };

  function resolveColorscale() {
    const spec = window.PAGE_COLORSCALE;
    if (!spec) return DEFAULT_RDYLGN;
    if (Array.isArray(spec)) return spec;
    if (typeof spec === 'string') {
      if (PRESET_SCALES[spec]) return PRESET_SCALES[spec];
      // allow simple names 'RdYlGn' -> default, 'RdYlGn_r' -> reversed
      if (spec === 'RdYlGn_r') return DEFAULT_RDYLGN.slice().reverse();
    }
    return DEFAULT_RDYLGN;
  }

  const chosenColorscale = resolveColorscale();

  const trace = {
    type: 'choroplethmapbox',
    geojson: fc,
    locations: locations,
    z: z,
    colorscale: chosenColorscale,
    zmin: 0,
    zmax: 1,
    reversescale: false,
    zauto: false,
    marker: { opacity: 0.8, line: { width: 0.5, color: '#ffffff' } },
    colorbar: { title: 'Percentile', titleside: 'right', tickvals: [0, 0.5, 1], ticktext: ['0%', '50%', '100%'] },
    featureidkey: 'properties.id',
    customdata: customdata,
    hovertemplate: 'GEOID: %{location}<br>Value: %{customdata[0]}<br>Percentile: %{z:.2f}<extra></extra>'
  };

  const layout = {
    mapbox: {
      style: 'open-street-map',
      center: { lat: 38, lon: -122.5 },
      zoom: 7.5
    },
    margin: { r: 0, t: 0, l: 0, b: 0 },
    height: Math.max(window.innerHeight * 0.7, 420)
  };

  return { data: [trace], layout };
}

function makeButton(map) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.textContent = map.label || tidyLabel(map.file || map);
  btn.dataset.file = map.file;
  btn.addEventListener('click', () => {
    document.querySelectorAll('#filters button').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    loadMap(map.file);
  });
  return btn;
}

function buildFilterButtons(maps) {
  // clear existing
  filtersEl.innerHTML = '';
  if (!maps || !maps.length) {
    setStatus('No maps available for this selection.');
    return;
  }
  maps.forEach((m, i) => {
    const btn = makeButton(m);
    filtersEl.appendChild(btn);
    if (i === 0) btn.classList.add('active');
  });
  // load first
  if (maps.length) loadMap(maps[0].file);
}

window.setPageSubcategory = function(name) {
  // name: key in window.PAGE_SUBCATEGORIES
  if (!window.PAGE_SUBCATEGORIES || !window.PAGE_SUBCATEGORIES[name]) return;
  // If the page defines per-subcategory colors, apply it now so plots use the right palette
  if (window.PAGE_SUBCATEGORY_COLORS && window.PAGE_SUBCATEGORY_COLORS[name]) {
    window.PAGE_COLORSCALE = window.PAGE_SUBCATEGORY_COLORS[name];
  }
  // update subcategory button active state
  if (subcatEl) {
    subcatEl.querySelectorAll('button').forEach(b => b.classList.remove('active'));
    const btn = subcatEl.querySelector(`button[data-sub="${name}"]`);
    if (btn) btn.classList.add('active');
  }
  const allowed = new Set(window.PAGE_SUBCATEGORIES[name]);
  CURRENT_MAPS = ALL_MAPS.filter(m => allowed.has((m && m.file) ? m.file : m));
  // apply optional label overrides if present
  if (window.PAGE_LABEL_OVERRIDES && typeof window.PAGE_LABEL_OVERRIDES === 'object') {
    CURRENT_MAPS = CURRENT_MAPS.map(m => ({ ...(typeof m === 'string' ? { file: m } : m), label: (window.PAGE_LABEL_OVERRIDES[m.file] || m.label) }));
  }
  buildFilterButtons(CURRENT_MAPS);
};

async function loadMap(filename) {
  setStatus('Loading ' + filename + '...');
  try {
    const resp = await fetch(dataPath + filename, {cache: 'no-store'});
    if (!resp.ok) throw new Error(`HTTP ${resp.status} ${resp.statusText}`);
    const fig = await resp.json();

    // If the fetched object already looks like a Plotly figure, render it directly.
    let plot;
    if (fig && (fig.data || (Array.isArray(fig) && fig.length && fig[0].type))) {
      plot = { data: fig.data || fig, layout: fig.layout || {} };
    } else if (fig && fig.type === 'FeatureCollection') {
      // Build choropleth client-side from GeoJSON features (ported from your geopandas code)
      plot = buildChoroplethFromGeojson(fig);
    } else {
      // Unknown format — attempt to interpret as geojson-like
      if (fig && fig.features) {
        plot = buildChoroplethFromGeojson(fig);
      } else {
        throw new Error('Unrecognized JSON format for ' + filename);
      }
    }

    const config = { responsive: true, displayModeBar: true, scrollZoom: false };
    await Plotly.react(mapEl, plot.data, plot.layout, config);
    setStatus('');
  } catch (err) {
    console.error('Failed to load map', err);
    setStatus('Error loading ' + filename + ': ' + err.message);
    mapEl.innerHTML = '<div style="padding:18px;color:#b91c1c">Failed to load map. See console for details.</div>';
  }
}

function init() {
  // Attempt to load the manifest to discover files automatically.
  (async () => {
    let maps = FALLBACK_MAPS;
    try {
      const resp = await fetch(dataPath + 'manifest.json', { cache: 'no-store' });
      if (resp.ok) {
        const list = await resp.json();
        maps = list.map(item => {
          if (typeof item === 'string') return { file: item, label: tidyLabel(item) };
          return item;
        });
      } else {
        console.warn('No manifest found, falling back to static MAPS');
      }
    } catch (err) {
      console.warn('Error fetching manifest, falling back to static MAPS', err);
    }

    // If the page defines a filter list, use it to restrict available files.
    // Provide `window.PAGE_MAP_FILTER = ['file1.json','file2.json']` in the page HTML.
    if (Array.isArray(window.PAGE_MAP_FILTER) && window.PAGE_MAP_FILTER.length) {
      const allow = new Set(window.PAGE_MAP_FILTER);
      maps = maps.filter(m => allow.has((m && m.file) ? m.file : m));
    }

    // Optional label overrides: window.PAGE_LABEL_OVERRIDES = { 'file.json': 'Pretty Name' }
    if (window.PAGE_LABEL_OVERRIDES && typeof window.PAGE_LABEL_OVERRIDES === 'object') {
      maps = maps.map(m => ({ ...(typeof m === 'string' ? { file: m } : m), label: (window.PAGE_LABEL_OVERRIDES[m.file] || m.label) }));
    }

    // Optional page title: window.PAGE_TITLE = 'My Title'
    if (window.PAGE_TITLE && document.querySelector('.site-header h1')) {
      document.querySelector('.site-header h1').textContent = window.PAGE_TITLE;
    }

    // store all maps for later dynamic filtering
    ALL_MAPS = maps.map(m => (typeof m === 'string' ? { file: m, label: tidyLabel(m) } : m));

    // If the page defines PAGE_SUBCATEGORIES, render subcategory buttons
    if (window.PAGE_SUBCATEGORIES && typeof window.PAGE_SUBCATEGORIES === 'object') {
      if (subcatEl) {
        subcatEl.innerHTML = '';
        Object.keys(window.PAGE_SUBCATEGORIES).forEach((key, idx) => {
          const b = document.createElement('button');
          b.type = 'button';
          b.textContent = key;
          b.dataset.sub = key;
          b.className = idx === 0 ? 'active' : '';
          b.addEventListener('click', () => window.setPageSubcategory(key));
          subcatEl.appendChild(b);
        });
      }
      const defaultSub = window.PAGE_SUBCATEGORY_DEFAULT || Object.keys(window.PAGE_SUBCATEGORIES)[0];
      // initialize CURRENT_MAPS via setPageSubcategory
      window.setPageSubcategory(defaultSub);
    } else {
      // If the page defines a filter list, use it to restrict available files.
      if (Array.isArray(window.PAGE_MAP_FILTER) && window.PAGE_MAP_FILTER.length) {
        const allow = new Set(window.PAGE_MAP_FILTER);
        CURRENT_MAPS = ALL_MAPS.filter(m => allow.has((m && m.file) ? m.file : m));
      } else {
        CURRENT_MAPS = ALL_MAPS.slice();
      }

      // Optional label overrides: window.PAGE_LABEL_OVERRIDES = { 'file.json': 'Pretty Name' }
      if (window.PAGE_LABEL_OVERRIDES && typeof window.PAGE_LABEL_OVERRIDES === 'object') {
        CURRENT_MAPS = CURRENT_MAPS.map(m => ({ ...(typeof m === 'string' ? { file: m } : m), label: (window.PAGE_LABEL_OVERRIDES[m.file] || m.label) }));
      }

      // create buttons and load first
      buildFilterButtons(CURRENT_MAPS);
    }
  })();

  // Resize handler to trigger Plotly relayout for some embed contexts
  window.addEventListener('resize', () => {
    if (window.Plotly && mapEl.data) Plotly.Plots.resize(mapEl);
  });
}

document.addEventListener('DOMContentLoaded', init);
