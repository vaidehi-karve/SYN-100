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

  // attach id and gather values
  const values = filtered.map(f => {
    const v = f.properties && f.properties.value;
    f.properties.id = String(f.properties.geoid);
    return (v === undefined || v === null) ? null : Number(v);
  });

  const percentiles = percentileRanks(values);
  filtered.forEach((f, idx) => {
    f.properties.percentile = percentiles[idx] === null ? null : percentiles[idx];
  });

  const fc = { type: 'FeatureCollection', features: filtered };

  const locations = filtered.map(f => f.properties.id);
  const z = filtered.map((f, idx) => percentiles[idx]);
  const customdata = filtered.map((f, idx) => [f.properties.value]);

  const trace = {
    type: 'choroplethmapbox',
    geojson: fc,
    locations: locations,
    z: z,
    colorscale: 'Blues_r',
    zmin: 0,
    zmax: 1,
    marker: { opacity: 0.8, line: { width: 0.5, color: '#ffffff' } },
    colorbar: { title: 'Percentile', titleside: 'right' },
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

    // create buttons
    maps.forEach((m, i) => {
      const btn = makeButton(m);
      filtersEl.appendChild(btn);
      if (i === 0) btn.classList.add('active');
    });

    // Load the first map by default (if exists)
    if (maps.length) loadMap(maps[0].file);
  })();

  // Resize handler to trigger Plotly relayout for some embed contexts
  window.addEventListener('resize', () => {
    if (window.Plotly && mapEl.data) Plotly.Plots.resize(mapEl);
  });
}

document.addEventListener('DOMContentLoaded', init);
