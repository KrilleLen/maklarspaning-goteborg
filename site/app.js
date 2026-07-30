'use strict';

const NAV_ITEMS = [
  { id: 'overview', label: 'Beslut', icon: '⌂' },
  { id: 'companies', label: 'Marknad', icon: '▦' },
  { id: 'areas', label: 'Områden', icon: '◉' },
  { id: 'offices', label: 'Kontor', icon: '◎' },
  { id: 'radar', label: 'Rekrytering', icon: '↗' }
];

const PIPELINE_KEY = 'maklarspaning.pipeline.v1';
const APP_STATE_KEY = 'maklarspaning.state.v2';
const AREA_KEY = 'maklarspaning.areas.v1';
const APP_VERSION = '8.0';
const CANDIDATE_WEIGHTS = { localPresence:25, activity:20, reviews:15, areaFit:20, experience:20 };
const FINANCIAL_TABS = [
  { id:'overview', label:'Översikt' },
  { id:'income', label:'Resultat' },
  { id:'costs', label:'Kostnader' },
  { id:'balance', label:'Balans' },
  { id:'ratios', label:'Nyckeltal' },
  { id:'sources', label:'Källor' }
];
let serviceWorkerRefreshing = false;

const state = {
  data: null,
  view: 'overview',
  compare: new Set(),
  selectedWorkforceBrand: 'Erik Olsson',
  companyFilters: { search: '', brand: 'Alla', municipality: 'Alla', riskOnly: false, sort: 'profitPerEmployeeKsek', direction: 'desc' },
  officeFilters: { search: '', brand: 'Alla', confidence: 'Alla' },
  radarFilters: { search: '', minimum: 0, owner: 'Alla', status: 'Alla' },
  areaFilters: { search: '' },
  areas: [],
  pipeline: [],
  editingCandidateId: null,
  deferredInstallPrompt: null,
  openOfficeId: null,
  activeCompanyId: null,
  activeFinancialTab: 'overview'
};

const els = {};

window.addEventListener('DOMContentLoaded', init);

async function init() {
  cacheElements();
  bindGlobalEvents();
  restoreState();
  renderNavigation();
  updateOnlineStatus();

  try {
    const response = await fetch('./data/app-data.json', { cache: 'no-store' });
    if (!response.ok) throw new Error(`Kunde inte läsa data (${response.status})`);
    state.data = await response.json();
    if (!state.data.workforce.some(w => w.brand === state.selectedWorkforceBrand)) {
      state.selectedWorkforceBrand = state.data.workforce[0]?.brand || '';
    }
    state.pipeline = loadPipeline();
    state.areas = loadAreas();
    els.appLoading.hidden = true;
    els.viewRoot.hidden = false;
    renderApp();
    renderMethodDialog();
    registerServiceWorker();
  } catch (error) {
    console.error(error);
    els.appLoading.hidden = true;
    els.appError.hidden = false;
    els.appError.innerHTML = `<h2>Appen kunde inte starta</h2><p>${escapeHtml(error.message)}</p><p>Öppna appen via en webbserver eller GitHub Pages – inte direkt som en lokal fil.</p>`;
  }
}

function cacheElements() {
  Object.assign(els, {
    desktopNav: document.querySelector('#desktopNav'),
    mobileNav: document.querySelector('#mobileNav'),
    appLoading: document.querySelector('#appLoading'),
    appError: document.querySelector('#appError'),
    viewRoot: document.querySelector('#viewRoot'),
    compareDock: document.querySelector('#compareDock'),
    compareCount: document.querySelector('#compareCount'),
    clearCompare: document.querySelector('#clearCompare'),
    openCompare: document.querySelector('#openCompare'),
    detailDialog: document.querySelector('#detailDialog'),
    detailDialogContent: document.querySelector('#detailDialogContent'),
    methodDialog: document.querySelector('#methodDialog'),
    methodDialogContent: document.querySelector('#methodDialogContent'),
    openMethod: document.querySelector('#openMethod'),
    installButton: document.querySelector('#installButton'),
    toast: document.querySelector('#toast'),
    offlineBanner: document.querySelector('#offlineBanner')
  });
}

function bindGlobalEvents() {
  document.addEventListener('click', handleClick);
  document.addEventListener('input', handleInput);
  document.addEventListener('change', handleChange);
  els.clearCompare.addEventListener('click', () => {
    state.compare.clear();
    updateCompareDock();
    renderApp();
  });
  els.openCompare.addEventListener('click', openCompareDialog);
  els.openMethod.addEventListener('click', () => els.methodDialog.showModal());

  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault();
    state.deferredInstallPrompt = event;
    els.installButton.hidden = false;
  });
  els.installButton.addEventListener('click', installApp);
  window.addEventListener('appinstalled', () => {
    els.installButton.hidden = true;
    state.deferredInstallPrompt = null;
    toast('Appen är installerad på enheten.');
  });
  window.addEventListener('online', updateOnlineStatus);
  window.addEventListener('offline', updateOnlineStatus);
}

function renderNavigation() {
  const nav = NAV_ITEMS.map(item => `
    <button class="nav-button ${state.view === item.id ? 'active' : ''}" data-nav="${item.id}" aria-current="${state.view === item.id ? 'page' : 'false'}">
      <span class="nav-icon" aria-hidden="true">${item.icon}</span>
      <span>${item.label}</span>
    </button>
  `).join('');
  els.desktopNav.innerHTML = nav;
  els.mobileNav.innerHTML = nav;
}

function renderApp() {
  if (!state.data) return;
  renderNavigation();
  const renderers = {
    overview: renderOverview,
    companies: renderCompanies,
    offices: renderOffices,
    areas: renderAreas,
    radar: renderRadar
  };
  els.viewRoot.innerHTML = renderers[state.view]();
  updateCompareDock();
  persistState();
}

function renderOverview() {
  const companies = financialCompanies();
  const benchmark = benchmarkCompany();
  const attention = buildAttentionItems();
  const dueCandidates = pipelineSorted().filter(c => candidateAttention(c).urgent).slice(0,5);
  const pressure = companies.filter(c => !c.isBenchmark).map(c => ({ company:c, signal:pressureSignal(c) })).sort((a,b)=>b.signal.score-a.signal.score).slice(0,5);
  const areaSummary = areaPortfolioSummary();
  const benchmarkRows = benchmarkMetrics();
  const eoHistory = companyHistory(benchmark);
  const latest = eoHistory.at(-1);
  const prior = eoHistory.at(-2);
  const revenueGrowth = latest && prior ? (latest.revenueKsek-prior.revenueKsek)/Math.abs(prior.revenueKsek||1) : null;

  return `<section class="view">
    <div class="decision-hero">
      <div>
        <span class="hero-label">● Delägarläge · ${formatDate(new Date())}</span>
        <h2>Vad kräver <span>vår uppmärksamhet?</span></h2>
        <p>En operativ vy för rekrytering, konkurrenter, EO:s utveckling och marknadsandel. Varje signal ska mynna ut i ett ansvar eller nästa steg.</p>
      </div>
      <div class="decision-score"><strong>${attention.filter(x=>x.level==='high').length}</strong><span>skarpa punkter</span><small>${attention.length} totalt att bedöma</small></div>
    </div>

    <div class="attention-grid">
      ${attention.length ? attention.slice(0,6).map(attentionCard).join('') : '<article class="attention-card good"><strong>Inget akut</strong><p>Inga förfallna aktiviteter eller höga bevakningssignaler just nu.</p></article>'}
    </div>

    <div class="metric-grid">
      ${metricCard('EO omsättning', formatMsek(benchmark.revenueKsek), `${revenueGrowth===null?'Historik saknas':`${formatSignedPercent(revenueGrowth)} mot föregående år`}`, revenueGrowth===null?'':revenueGrowth>=0?'positive':'negative')}
      ${metricCard('Vinst / anställd', formatKsek(benchmark.profitPerEmployeeKsek), `${formatSignedPercent(deltaVs(benchmark.profitPerEmployeeKsek, medianMetric('profitPerEmployeeKsek')))} mot median`, 'accent')}
      ${metricCard('Kandidater', formatInteger(state.pipeline.length), `${dueCandidates.length} kräver uppföljning`, dueCandidates.length?'negative':'positive')}
      ${metricCard('Områden med data', formatInteger(areaSummary.withData), `${areaSummary.stale} behöver uppdateras`)}
    </div>

    <div class="dashboard-grid partner-dashboard">
      <article class="panel panel-wide">
        <div class="panel-header"><div><h3>EO mot marknaden</h3><p>Median, toppkvartil och jämförbara bolag i samma storleksklass.</p></div><button class="button button-small button-ghost" data-nav="companies">Öppna marknaden</button></div>
        <div class="benchmark-matrix">${benchmarkRows.map(benchmarkMatrixCard).join('')}</div>
      </article>

      <article class="panel panel-narrow">
        <div class="panel-header"><div><h3>Följ upp nu</h3><p>Kandidater sorterade på förfallodatum och poäng.</p></div><button class="button button-small button-ghost" data-nav="radar">Öppna CRM</button></div>
        <div class="focus-list">${dueCandidates.length?dueCandidates.map(candidateFocusItem).join(''):'<div class="empty-state compact">Inga kandidater med förfallen eller nära aktivitet.</div>'}</div>
      </article>

      <article class="panel panel-wide">
        <div class="panel-header"><div><h3>EO:s femårsutveckling</h3><p>Verifierade bokslut 2021–2025. Omsättning och resultat i miljoner kronor.</p></div>${latest?.sourceUrl?`<a class="button button-small button-ghost" target="_blank" rel="noopener" href="${safeUrl(latest.sourceUrl)}">Källa ↗</a>`:''}</div>
        ${historyChart(benchmark)}
      </article>

      <article class="panel panel-narrow">
        <div class="panel-header"><div><h3>Kontor under press</h3><p>Prioriterad bolagsbevakning, inte ett påstående om individer.</p></div><button class="button button-small button-ghost" data-nav="companies">Visa alla</button></div>
        <div class="signal-list">${pressure.map(({company,signal})=>pressureItem(company,signal)).join('')}</div>
      </article>

      <article class="panel panel-full">
        <div class="panel-header"><div><h3>Marknadsandel i mikroområden</h3><p>Internt registrerade eller verifierat importerade uppgifter. Tomma områden är medvetet tomma.</p></div><button class="button button-small button-accent" data-nav="areas">Öppna områdesradar</button></div>
        ${areaSnapshotGrid()}
      </article>
    </div>
  </section>`;
}

function renderCompanies() {
  const filters = state.companyFilters;
  const brands = unique(state.data.companies.map(c => c.brand).filter(Boolean));
  const municipalities = unique(state.data.companies.map(c => c.municipality).filter(Boolean));
  const filtered = filteredCompanies();
  const benchmark = benchmarkCompany();
  const pressureRows = financialCompanies().filter(c=>!c.isBenchmark).map(c=>({company:c,signal:pressureSignal(c)})).sort((a,b)=>b.signal.score-a.signal.score).slice(0,8);

  return `<section class="view">
    ${viewHeader('Marknad & bolag', 'Följ EO över tid, jämför mot marknaden och hitta kontor som förtjänar närmare granskning. Inga bolagstal fylls ut när underlag saknas.', `
      <button class="button button-ghost" data-action="export-companies">Exportera CSV</button>
      <button class="button button-accent" data-action="print">Skriv ut</button>
    `)}

    <div class="market-top-grid">
      <article class="panel history-panel"><div class="panel-header"><div><h3>${escapeHtml(benchmark.legalName)} · fem år</h3><p>Omsättning, resultat och årsanställda från publika bokslut.</p></div><span class="badge badge-accent">${companyHistory(benchmark).length} verifierade år</span></div>${historyChart(benchmark)}</article>
      <article class="panel"><div class="panel-header"><div><h3>EO:s position</h3><p>Jämförelse mot median, topp 25 % och liknande storlek.</p></div></div><div class="benchmark-matrix compact">${benchmarkMetrics().map(benchmarkMatrixCard).join('')}</div></article>
    </div>

    <article class="panel pressure-panel">
      <div class="panel-header"><div><h3>Kontor under press</h3><p>Poängen kombinerar lönsamhet, effektivitet och verifierad trend där flera år finns. Hög poäng betyder bevaka – inte att bolaget är i kris.</p></div><span class="badge badge-blue">${pressureRows.filter(r=>r.signal.level==='Hög').length} hög bevakning</span></div>
      <div class="pressure-grid">${pressureRows.map(({company,signal})=>pressureCard(company,signal)).join('')}</div>
    </article>

    <div class="filter-bar">
      ${field('companySearch', 'Sök bolag, kedja eller kontor', `<input id="companySearch" type="search" placeholder="Sök…" value="${escapeAttr(filters.search)}">`, 'field-search')}
      ${field('companyBrand', 'Kedja', `<select id="companyBrand"><option>Alla</option>${brands.map(v => option(v, filters.brand)).join('')}</select>`)}
      ${field('companyMunicipality', 'Kommun', `<select id="companyMunicipality"><option>Alla</option>${municipalities.map(v => option(v, filters.municipality)).join('')}</select>`)}
      ${field('companySort', 'Sortering', `<select id="companySort">
        ${sortOption('profitPerEmployeeKsek','Vinst / anställd',filters.sort)}
        ${sortOption('revenuePerEmployeeKsek','Omsättning / anställd',filters.sort)}
        ${sortOption('margin','Vinstmarginal',filters.sort)}
        ${sortOption('profitKsek','Resultat',filters.sort)}
        ${sortOption('revenueKsek','Omsättning',filters.sort)}
        ${sortOption('employees','Anställda',filters.sort)}
      </select>`)}
      <label class="checkbox-field"><input id="riskOnly" type="checkbox" ${filters.riskOnly ? 'checked' : ''}> Endast negativt resultat</label>
    </div>
    <div class="results-meta"><span>${filtered.length} av ${state.data.companies.length} bolag</span><span>Snabb överblick här · full ekonomivy inne på bolaget</span></div>
    <div class="company-table-wrap">
      <table>
        <thead><tr>
          <th>Bolag / kontor</th><th>Kedja</th><th>Omsättning</th><th>Resultat</th><th>Anställda</th><th>Marginal</th><th>Oms./anst.</th><th>Vinst/anst.</th><th>Historik</th><th>Press</th><th>Åtgärd</th>
        </tr></thead>
        <tbody>${filtered.map(companyTableRow).join('')}</tbody>
      </table>
    </div>
    <div class="company-cards">${filtered.map(companyCard).join('')}</div>
    ${filtered.length ? '' : '<div class="empty-state">Inga bolag matchar filtret.</div>'}
  </section>`;
}

function renderOffices() {
  const filters = state.officeFilters;
  const brands = unique(state.data.offices.map(o => o.brand).filter(Boolean));
  const offices = state.data.offices.filter(o => {
    const haystack = `${o.brand} ${o.office} ${o.legalName} ${o.municipality}`.toLowerCase();
    return (!filters.search || haystack.includes(filters.search.toLowerCase())) &&
      (filters.brand === 'Alla' || o.brand === filters.brand) &&
      (filters.confidence === 'Alla' || normalizeConfidence(o.confidence) === filters.confidence);
  });
  const workforce = state.data.workforce.find(w => w.brand === state.selectedWorkforceBrand) || state.data.workforce[0];
  const workforceBrands = state.data.workforce.map(w => w.brand);

  const coverage = state.data.peopleCoverage || {};
  return `<section class="view">
    ${viewHeader('Kontor & personal', 'Personerna visas direkt inne i appen. Kontorsverifierade listor hålls isär från kedjegemensamma personer som ännu inte kan placeras säkert på ett kontor.', '')}
    <div class="people-coverage">
      ${coverageMetric(coverage.officesWithPeople, 'kontor med publik personal', coverage.officeCount || 91)}
      ${coverageMetric(coverage.verifiedOfficeLists, 'verifierade kontorslistor', coverage.officeCount || 91)}
      ${coverageMetric(coverage.officeAssignments, 'personkopplingar')}
      ${coverageMetric(coverage.unassignedBrandPeople, 'kedjegemensamma utan säker kontorsplacering')}
    </div>
    <div class="filter-bar">
      ${field('officeSearch','Sök kontor',`<input id="officeSearch" type="search" placeholder="Sök kontor, kedja eller bolag…" value="${escapeAttr(filters.search)}">`,'field-search')}
      ${field('officeBrand','Kedja',`<select id="officeBrand"><option>Alla</option>${brands.map(v => option(v,filters.brand)).join('')}</select>`)}
      ${field('officeConfidence','Säkerhet',`<select id="officeConfidence"><option>Alla</option>${['Hög','Medel','Låg'].map(v => option(v,filters.confidence)).join('')}</select>`)}
      ${field('workforceBrand','Kedjeöversikt',`<select id="workforceBrand">${workforceBrands.map(v => option(v,state.selectedWorkforceBrand)).join('')}</select>`)}
    </div>
    <div class="office-layout">
      <div>
        <div class="results-meta"><span>${offices.length} kontorskopplingar</span><span>Personal uppdaterad ${escapeHtml(coverage.updatedAt || state.data.meta.peopleUpdatedAt || '—')}</span></div>
        <div class="office-list">${offices.map(officeCard).join('')}</div>
        ${offices.length ? '' : '<div class="empty-state">Inga kontor matchar filtret.</div>'}
      </div>
      <aside class="workforce-column">
        ${workforceCard(workforce)}
        <div class="disclaimer"><strong>Datakvalitet:</strong> Grön status betyder att kontoret eller personprofilen är verifierad. Gul status betyder att personer arbetar över flera kontor eller ännu bara kan kopplas till kedjan. Appen gissar aldrig kontor.</div>
        <article class="panel">
          <div class="panel-header"><div><h3>Kvar att kartlägga</h3><p>Aktörer där ekonomin ännu inte kan kopplas säkert till rätt lokalt driftbolag.</p></div></div>
          <div class="additional-grid">${state.data.additionalActors.slice(0,5).map(additionalActorCard).join('')}</div>
        </article>
      </aside>
    </div>
  </section>`;
}


function renderAreas() {
  const query = state.areaFilters.search.toLowerCase();
  const areas = state.areas.filter(a => a.name.toLowerCase().includes(query));
  const summary = areaPortfolioSummary();
  return `<section class="view">
    ${viewHeader('Områdesradar', 'Följ marknadsandel per mikroområde. Ange antal EO-affärer och marknadens total när det finns – då räknas andelen automatiskt. Direkt procenttal kan användas när endast verifierad andel finns.', `
      <button class="button button-ghost" data-action="export-areas">Exportera områden</button>
      <label class="button button-ghost" for="importAreas">Importera<input id="importAreas" type="file" accept="application/json" hidden></label>
    `)}
    <div class="metric-grid">
      ${metricCard('Områden', formatInteger(state.areas.length), `${summary.withData} med registrerad data`, 'accent')}
      ${metricCard('Senaste kärnandel', Number.isFinite(summary.coreShare)?formatPercentValue(summary.coreShare):'—', summary.coreChange===null?'Ingen jämförelseperiod':`${formatSignedPercentagePoints(summary.coreChange)} mot föregående period`, summary.coreChange===null?'':summary.coreChange>=0?'positive':'negative')}
      ${metricCard('Behöver uppdateras', formatInteger(summary.stale), 'Äldre än 120 dagar eller saknar datum', summary.stale?'negative':'positive')}
      ${metricCard('Under eget mål', formatInteger(summary.belowTarget), 'Endast områden med satt mål')}
    </div>

    <details class="panel data-editor" open>
      <summary><strong>Registrera verifierad områdesdata</strong><span>Lokal data · sparas på den här enheten</span></summary>
      ${areaForm()}
    </details>

    <div class="filter-bar">${field('areaSearch','Sök område',`<input id="areaSearch" type="search" placeholder="Stampen, Heden…" value="${escapeAttr(state.areaFilters.search)}">`,'field-search')}</div>
    <div class="area-grid">${areas.map(areaCard).join('')}</div>
    ${areas.length?'':'<div class="empty-state">Inga områden matchar sökningen.</div>'}
    <div class="disclaimer"><strong>Datadisciplin:</strong> Skriv alltid period och källa. Appen visar inga antagna marknadsandelar. De två startvärdena för kärnområdet är märkta som internt uppgivna och ska kontrolleras mot ert affärssystem innan extern användning.</div>
  </section>`;
}

function renderRadar() {
  const query = state.radarFilters.search.toLowerCase();
  const minimum = number(state.radarFilters.minimum);
  const rows = financialCompanies()
    .filter(c => !c.isBenchmark)
    .map(company => ({ company, signal: pressureSignal(company) }))
    .filter(({ company, signal }) => signal.score >= minimum && `${company.brand} ${company.office} ${company.legalName}`.toLowerCase().includes(query))
    .sort((a,b) => b.signal.score - a.signal.score);
  const candidates = pipelineSorted().filter(c =>
    (state.radarFilters.owner === 'Alla' || (c.owner || 'Ej fördelad') === state.radarFilters.owner) &&
    (state.radarFilters.status === 'Alla' || normalizeCandidateStatus(c.status) === state.radarFilters.status) &&
    (!query || `${c.name} ${c.brand} ${c.office} ${c.owner}`.toLowerCase().includes(query))
  );
  const owners = unique(state.pipeline.map(c=>c.owner||'Ej fördelad'));
  const statuses = candidateStatuses();
  const phases = [
    {title:'Identifiera', statuses:['Identifierad','Intressant']},
    {title:'Kontakta', statuses:['Kontakt planerad','Kontaktad']},
    {title:'Dialog', statuses:['Första möte','Dialog pågår','Erbjudande']},
    {title:'Utfall', statuses:['Rekryterad','Inte aktuell']}
  ];

  return `<section class="view">
    ${viewHeader('Rekrytering', 'Kombinera bolagssignaler med en transparent individuell bedömning. Kandidatpoängen bygger bara på yrkesrelaterade faktorer som ni själva fyller i.', `
      <button class="button button-ghost" data-action="export-pipeline">Exportera pipeline</button>
      <label class="button button-ghost" for="importPipeline">Importera<input id="importPipeline" type="file" accept="application/json" hidden></label>
    `)}
    <div class="metric-grid">
      ${metricCard('Aktiva kandidater',formatInteger(state.pipeline.filter(c=>!['Rekryterad','Inte aktuell'].includes(normalizeCandidateStatus(c.status))).length),'Exklusive avslutade','accent')}
      ${metricCard('Förfallna aktiviteter',formatInteger(state.pipeline.filter(c=>candidateAttention(c).overdue).length),'Kräver beslut eller nytt datum',state.pipeline.some(c=>candidateAttention(c).overdue)?'negative':'positive')}
      ${metricCard('A-kandidater',formatInteger(state.pipeline.filter(c=>{const a=candidateAssessment(c);return a.complete&&a.score>=75;}).length),'75+ poäng och 5/5 faktorer bedömda')}
      ${metricCard('Hög bolagspress',formatInteger(rows.filter(r=>r.signal.level==='Hög').length),'Kontor att granska närmare')}
    </div>

    <details class="panel data-editor candidate-editor" ${state.editingCandidateId?'open':''}>
      <summary><strong>${state.editingCandidateId?'Redigera kandidat':'Lägg till kandidat'}</strong><span>Ansvar, nästa steg och transparent score</span></summary>
      ${candidateForm()}
    </details>

    <div class="filter-bar">
      ${field('radarSearch','Sök',`<input id="radarSearch" type="search" placeholder="Kandidat, kedja eller bolag…" value="${escapeAttr(state.radarFilters.search)}">`,'field-search')}
      ${field('radarOwner','Ansvarig',`<select id="radarOwner"><option>Alla</option>${owners.map(v=>option(v,state.radarFilters.owner)).join('')}</select>`)}
      ${field('radarStatus','Status',`<select id="radarStatus"><option>Alla</option>${statuses.map(v=>option(v,state.radarFilters.status)).join('')}</select>`)}
      ${field('radarMinimum','Minsta bolagssignal',`<select id="radarMinimum">${[0,30,50,70].map(v => `<option value="${v}" ${minimum === v ? 'selected' : ''}>${v === 0 ? 'Alla nivåer' : `${v}+ poäng`}</option>`).join('')}</select>`)}
    </div>

    <div class="recruitment-top-grid">
      <article class="panel"><div class="panel-header"><div><h3>Kontor att granska</h3><p>Offentlig ekonomi och verifierad trend. Klicka för bolagsdetalj.</p></div></div><div class="radar-table">${rows.slice(0,8).map(radarRow).join('')}</div></article>
      <article class="panel"><div class="panel-header"><div><h3>Närmast nästa steg</h3><p>Förfallna kandidater först, därefter datum och score.</p></div></div><div class="focus-list">${candidates.slice(0,7).map(candidateFocusItem).join('')||'<div class="empty-state compact">Ingen kandidat matchar filtret.</div>'}</div></article>
    </div>

    <div class="pipeline-board">${phases.map(phase=>`<section class="pipeline-column"><div class="pipeline-column-head"><h3>${phase.title}</h3><span>${candidates.filter(c=>phase.statuses.includes(normalizeCandidateStatus(c.status))).length}</span></div><div class="pipeline-list">${candidates.filter(c=>phase.statuses.includes(normalizeCandidateStatus(c.status))).map(pipelineCard).join('')||'<div class="empty-state compact">Tomt</div>'}</div></section>`).join('')}</div>
  </section>`;
}

function viewHeader(title, text, actions = '') {
  return `<div class="view-header"><div><h2>${title}</h2><p>${text}</p></div>${actions ? `<div class="view-actions">${actions}</div>` : ''}</div>`;
}

function metricCard(label, value, note, className = '') {
  return `<article class="metric-card ${className}"><span class="metric-label">${label}</span><strong>${value}</strong><small>${note}</small></article>`;
}

function rankList(companies, key, formatter, benchmarkId) {
  const max = Math.max(...companies.map(c => Math.max(0, number(c[key]))), 1);
  return `<div class="rank-list">${companies.map((c, index) => `
    <button class="rank-row" data-company-id="${c.id}" style="width:100%;border:0;background:transparent;color:inherit;text-align:inherit">
      <span class="rank-number">${index + 1}</span>
      <span class="rank-name"><strong>${escapeHtml(c.legalName)} ${c.id === benchmarkId ? '<span class="badge badge-accent" style="display:inline-flex">EO</span>' : ''}</strong><span>${escapeHtml(c.office || c.brand)}</span></span>
      <span class="bar-track"><span class="bar-fill" style="--w:${Math.max(0, number(c[key])) / max * 100}%"></span></span>
      <span class="rank-value">${formatter(c[key])}</span>
    </button>`).join('')}</div>`;
}

function signalItem(company, signal) {
  return `<button class="signal-item" data-company-id="${company.id}" style="width:100%;text-align:left;color:inherit">
    <div><strong>${escapeHtml(company.brand)} · ${escapeHtml(company.office || '')}</strong><span>${escapeHtml(signal.reasons.slice(0,2).join(' · '))}</span></div>
    <span class="badge ${signalBadgeClass(signal.level)}">${signal.score}</span>
  </button>`;
}

function workforceOverview() {
  const list = [...state.data.workforce].filter(w => Number.isFinite(w.agents)).sort((a,b) => b.agents - a.agents).slice(0,7);
  const max = Math.max(...list.map(w => w.agents), 1);
  return `<div class="rank-list">${list.map((w,index) => `
    <button class="rank-row" data-workforce-brand="${escapeAttr(w.brand)}" data-nav="offices" style="width:100%;border:0;background:transparent;color:inherit;text-align:inherit">
      <span class="rank-number">${index+1}</span>
      <span class="rank-name"><strong>${escapeHtml(w.brand)}</strong><span>${formatInteger(w.offices)} kontor · ${w.rating ? `${formatDecimal(w.rating,1)} betyg` : 'publik profil'}</span></span>
      <span class="bar-track"><span class="bar-fill" style="--w:${w.agents/max*100}%"></span></span>
      <span class="rank-value">${formatInteger(w.agents)} mäklare</span>
    </button>`).join('')}</div>`;
}

function inlineBenchmarkComparison(benchmark, candidates) {
  const uniqueCompanies = [benchmark, ...candidates.filter(Boolean).filter((c,i,a) => c.id !== benchmark.id && a.findIndex(x => x.id === c.id) === i)].slice(0,4);
  return compareCards(uniqueCompanies, benchmark);
}

function companyTableRow(company) {
  const signal = pressureSignal(company);
  const coverage = financialCoverage(company);
  return `<tr class="${company.isBenchmark ? 'benchmark-row' : ''}">
    <td class="company-name-cell"><strong>${escapeHtml(company.legalName)} ${company.isBenchmark ? '<span class="badge badge-accent">Benchmark</span>' : ''}</strong><span>${escapeHtml(company.office || '')} · ${escapeHtml(company.fiscalYear || 'år saknas')} · ${escapeHtml(company.mapping || 'okänd mappning')}</span></td>
    <td>${escapeHtml(company.brand || '—')}</td>
    <td>${formatKsek(company.revenueKsek)}</td>
    <td class="${number(company.profitKsek) < 0 ? 'table-negative' : 'table-positive'}">${formatKsek(company.profitKsek)}</td>
    <td>${formatIntegerOrDash(company.employees)}</td>
    <td>${formatPercent(company.margin)}</td>
    <td>${formatKsek(company.revenuePerEmployeeKsek)}</td>
    <td class="${number(company.profitPerEmployeeKsek) < 0 ? 'table-negative' : ''}">${formatKsek(company.profitPerEmployeeKsek)}</td>
    <td><span class="coverage-label ${coverage.className}"><strong>${coverage.years}</strong> år · ${coverage.label}</span></td>
    <td><span class="badge ${signalBadgeClass(signal.level)}">${signal.score}</span></td>
    <td><div class="table-actions"><button class="table-link" data-company-id="${company.id}">Ekonomi</button><button class="table-link" data-compare-id="${company.id}">${state.compare.has(company.id) ? 'Vald' : 'Jämför'}</button></div></td>
  </tr>`;
}

function companyCard(company) {
  const signal = pressureSignal(company);
  const coverage = financialCoverage(company);
  return `<article class="company-card ${company.isBenchmark ? 'benchmark' : ''}">
    <div class="company-card-header"><div><h3>${escapeHtml(company.legalName)}</h3><span class="subtle">${escapeHtml(company.brand)} · ${escapeHtml(company.office || '')}</span></div><span class="badge ${signalBadgeClass(signal.level)}">Signal ${signal.score}</span></div>
    <div class="company-card-metrics">
      ${miniMetric('Vinst / anst.',formatKsek(company.profitPerEmployeeKsek))}
      ${miniMetric('Oms. / anst.',formatKsek(company.revenuePerEmployeeKsek))}
      ${miniMetric('Marginal',formatPercent(company.margin))}
      ${miniMetric('Anställda',formatIntegerOrDash(company.employees))}
    </div>
    <div class="company-data-status"><span class="coverage-label ${coverage.className}"><strong>${coverage.years}</strong> bokslutsår · ${coverage.label}</span><span>${escapeHtml(company.fiscalYear || 'år saknas')}</span></div>
    <div class="card-actions"><button class="button button-small button-accent" data-company-id="${company.id}">Öppna ekonomin</button><button class="button button-small ${state.compare.has(company.id) ? 'button-accent' : 'button-ghost'}" data-compare-id="${company.id}">${state.compare.has(company.id) ? 'Vald' : 'Jämför'}</button>${company.allabolagUrl ? `<a class="button button-small button-ghost" href="${safeUrl(company.allabolagUrl)}" target="_blank" rel="noopener">Källa ↗</a>` : ''}</div>
  </article>`;
}

function miniMetric(label,value) { return `<div class="mini-metric"><span>${label}</span><strong>${value}</strong></div>`; }

function officeCard(office) {
  const confidence = normalizeConfidence(office.confidence);
  const people = officePeopleFor(office.id);
  const brokerCount = people.filter(person => person.type === 'broker').length;
  const staffCount = people.filter(person => person.type !== 'broker').length;
  const countLabel = people.length ? ` (${people.length})` : '';
  const isOpen = state.openOfficeId === office.id;
  const statusLabel = {
    'verified-office':'Kontorsverifierad lista',
    'verified-profile-match':'Verifierad via personprofil',
    'shared-or-partial':'Delad eller delvis verifierad lista',
    'no-public-list':'Ingen publik lista hittad'
  }[office.peopleStatus] || (people.length ? 'Publika personer' : 'Ingen publik lista hittad');
  const peopleStatus = people.length
    ? `${statusLabel} · ${brokerCount} mäklare${staffCount ? ` · ${staffCount} övriga` : ''}`
    : statusLabel;
  return `<article class="office-card ${isOpen ? 'office-card-open' : ''}" data-office-card-id="${escapeAttr(office.id)}">
    <div><h3>${escapeHtml(office.brand)} · ${escapeHtml(office.office || 'Kontor')}</h3><p>${escapeHtml(office.municipality || '')}${office.address ? ` · ${escapeHtml(office.address)}` : ''}</p></div>
    <div><div class="confidence ${confidence.toLowerCase()}"><i></i><strong>${confidence} säkerhet</strong></div><p>${escapeHtml(office.legalName || office.status || 'Juridisk mappning saknas')}</p><span class="staff-scope ${office.peopleComplete ? 'exact' : people.length ? 'partial' : 'unverified'}">${escapeHtml(peopleStatus)}</span></div>
    <div class="office-links">
      ${office.allabolagUrl ? `<a class="button button-small button-ghost" target="_blank" rel="noopener" href="${safeUrl(office.allabolagUrl)}">Bolag ↗</a>` : ''}
      ${office.officialUrl ? `<a class="button button-small button-ghost" target="_blank" rel="noopener" href="${safeUrl(office.officialUrl)}">Kontor ↗</a>` : ''}
      <button type="button" class="button button-small ${people.length ? 'button-accent' : 'button-warning'}" data-office-people="${escapeAttr(office.id)}" aria-expanded="${isOpen}" aria-controls="office-people-${escapeAttr(office.id)}">${isOpen ? 'Dölj personal' : 'Visa personal'}${countLabel}</button>
    </div>
    ${isOpen ? renderOfficePeopleInline(office) : ''}
  </article>`;
}

function renderOfficePeopleInline(office) {
  const people = officePeopleFor(office.id).slice().sort((a,b) => {
    if (a.type !== b.type) return a.type === 'broker' ? -1 : 1;
    return a.name.localeCompare(b.name, 'sv');
  });
  const brokers = people.filter(person => person.type === 'broker').length;
  const otherStaff = people.length - brokers;
  const statusText = {
    'verified-office':'Kontorets officiella personallista är verifierad.',
    'verified-profile-match':'Personerna är kopplade till kontoret via offentliga personprofiler.',
    'shared-or-partial':'Listan är delvis verifierad eller delas mellan flera kontor.',
    'no-public-list':'Ingen säker offentlig personallista kunde hämtas för kontoret.'
  }[office.peopleStatus] || 'Publik persondata.';
  const cards = people.length
    ? people.map(person => officePersonCard(person, office)).join('')
    : `<div class="people-empty"><strong>Ingen verifierad personlista ännu</strong><p>Appen visar inte gissade namn. Kontoret är markerat för fortsatt kontroll.</p></div>`;
  return `<section class="office-inline-people" id="office-people-${escapeAttr(office.id)}" aria-live="polite">
    <div class="office-inline-head">
      <div><span class="eyebrow">Personal på kontoret</span><h4>${escapeHtml(office.brand)} · ${escapeHtml(office.office || 'Kontor')}</h4></div>
      <span class="badge ${people.length ? 'badge-green' : 'badge-blue'}">${brokers} mäklare${otherStaff ? ` · ${otherStaff} övriga` : ''}</span>
    </div>
    <p class="office-inline-status">${escapeHtml(statusText)}</p>
    <div class="office-people-list">${cards}</div>
    ${office.peopleSourceUrl ? `<a class="button button-small button-ghost" href="${safeUrl(office.peopleSourceUrl)}" target="_blank" rel="noopener">Kontrollera källan ↗</a>` : ''}
  </section>`;
}

function officePeopleFor(officeId) {
  return (state.data.officePeople || []).filter(person => person.officeId === officeId);
}

function unassignedPeopleForBrand(brand) {
  return (state.data.unassignedPeople || []).filter(person => person.brand === brand);
}

function openOfficePeople(officeId) {
  const office = state.data.offices.find(item => item.id === officeId);
  if (!office) return;
  const people = officePeopleFor(officeId).slice().sort((a,b) => {
    if (a.type !== b.type) return a.type === 'broker' ? -1 : 1;
    return a.name.localeCompare(b.name, 'sv');
  });
  const brokers = people.filter(person => person.type === 'broker').length;
  const otherStaff = people.length - brokers;
  const brandUnassigned = unassignedPeopleForBrand(office.brand);
  const statusText = {
    'verified-office':'Kontorets officiella personallista är verifierad.',
    'verified-profile-match':'Personerna är kopplade till kontoret via offentliga personprofiler.',
    'shared-or-partial':'Listan innehåller publika personer, men någon eller några arbetar över flera kontor eller kan inte avgränsas helt.',
    'no-public-list':'Ingen säker offentlig personallista kunde hämtas för kontoret.'
  }[office.peopleStatus] || 'Publik persondata.';
  const coverage = `${statusText} ${brokers} mäklare${otherStaff ? ` och ${otherStaff} övriga medarbetare` : ''}.`;
  const cards = people.length ? people.map(person => officePersonCard(person, office)).join('') : `
    <div class="people-empty">
      <strong>Ingen kontorsverifierad personlista</strong>
      <p>Appen visar inte namn på ett specifikt kontor utan en säker offentlig koppling.</p>
    </div>`;
  const unassignedCards = brandUnassigned.length ? `
    <div class="detail-section unassigned-people">
      <h3>Kedjegemensamma personer utan säker kontorsplacering (${brandUnassigned.length})</h3>
      <p>Personerna är publikt kopplade till ${escapeHtml(office.brand)}, men inte placerade på detta kontor utan bevis.</p>
      <div class="office-people-list">${brandUnassigned.map(person => officePersonCard(person, office, false)).join('')}</div>
    </div>` : '';
  els.detailDialogContent.innerHTML = `
    <div class="people-dialog-head">
      <span class="eyebrow">Kontorspersonal</span>
      <h2>${escapeHtml(office.brand)} · ${escapeHtml(office.office || 'Kontor')}</h2>
      <p>${escapeHtml(coverage)}</p>
      ${office.peopleNote ? `<div class="data-caveat">${escapeHtml(office.peopleNote)}</div>` : ''}
    </div>
    <div class="office-people-list">${cards}</div>
    ${unassignedCards}
    <div class="detail-section people-source">
      <h3>Källa</h3>
      <p>${escapeHtml(office.peopleSourceLabel || office.staffSource || 'Offentlig kontorssida')} · kontrollerad ${escapeHtml(office.peopleUpdatedAt || state.data.meta.peopleUpdatedAt || '—')}</p>
      ${office.peopleSourceUrl ? `<a class="button button-ghost" href="${safeUrl(office.peopleSourceUrl)}" target="_blank" rel="noopener">Öppna offentlig kontorslista ↗</a>` : ''}
    </div>`;
  els.detailDialog.showModal();
}

function officePersonCard(person, office, allowCandidate=true) {
  const isBroker = person.type === 'broker';
  const initials = person.name.split(/\s+/).map(part => part[0]).join('').slice(0,2).toUpperCase();
  return `<article class="office-person-card">
    <div class="person-avatar" aria-hidden="true">${escapeHtml(initials)}</div>
    <div class="person-main">
      <div class="person-title-row"><h3>${escapeHtml(person.name)}</h3><span class="badge ${isBroker ? 'badge-green' : 'badge-blue'}">${isBroker ? 'Mäklare' : 'Övrig personal'}</span></div>
      <p>${escapeHtml(person.role || (isBroker ? 'Fastighetsmäklare' : 'Medarbetare'))}</p>
      <div class="person-actions">
        ${person.profileUrl ? `<a class="button button-small button-accent" href="${safeUrl(person.profileUrl)}" target="_blank" rel="noopener">${escapeHtml(person.profileSource || 'Personprofil')} ↗</a>` : `<span class="button button-small button-disabled">Ingen verifierad personprofil</span>`}
        ${isBroker && allowCandidate && person.officeId ? `<button class="button button-small button-ghost" data-add-office-person="${escapeAttr(person.id)}" data-office-id="${escapeAttr(office.id)}">+ Kandidat</button>` : ''}
      </div>
    </div>
  </article>`;
}

function workforceCard(workforce) {
  if (!workforce) return '<article class="workforce-card"><p>Ingen publik persondata i snapshoten.</p></article>';
  return `<article class="workforce-card">
    <div class="panel-header"><div><h3>${escapeHtml(workforce.brand)}</h3><p>Publik snapshot från Booli/Hittamäklare.</p></div>${workforce.rating ? `<span class="badge badge-blue">★ ${formatDecimal(workforce.rating,1)}</span>` : ''}</div>
    <div class="workforce-stats">
      ${workforceStat(workforce.agents,'mäklare')}
      ${workforceStat(workforce.offices,'kontor')}
      ${workforceStat(workforce.sold6m,'sålda 6 mån')}
    </div>
    ${workforce.avgPrice ? `<p style="color:var(--muted);font-size:.75rem">Snittpris: <strong style="color:var(--text)">${formatSek(workforce.avgPrice)}</strong>${workforce.reviews ? ` · ${formatInteger(workforce.reviews)} omdömen` : ''}</p>` : ''}
    <div class="people-list">${(workforce.sample || []).map(name => `<button class="person-chip" data-add-person="${escapeAttr(name)}" data-person-brand="${escapeAttr(workforce.brand)}" title="Lägg till i pipeline">+ ${escapeHtml(name)}</button>`).join('')}</div>
    <div class="card-actions"><a class="button button-accent" href="${safeUrl(workforce.url)}" target="_blank" rel="noopener">Öppna hos Booli/Hittamäklare ↗</a></div>
  </article>`;
}

function coverageMetric(value,label,total=null) { const display=Number.isFinite(value)?formatInteger(value):'—'; const suffix=Number.isFinite(total)?` / ${formatInteger(total)}`:''; return `<div class="coverage-metric"><strong>${display}${suffix}</strong><span>${label}</span></div>`; }

function workforceStat(value,label) { return `<div class="workforce-stat"><strong>${formatIntegerOrDash(value)}</strong><span>${label}</span></div>`; }

function additionalActorCard(actor) {
  return `<article class="additional-card"><h4>${escapeHtml(actor.brand)}</h4><p>${escapeHtml(actor.note)}</p><a class="button button-small button-ghost" target="_blank" rel="noopener" href="${safeUrl(actor.url)}">Öppna profil ↗</a></article>`;
}

function radarRow({ company, signal }) {
  return `<article class="radar-row">
    <div><h4>${escapeHtml(company.brand)} · ${escapeHtml(company.office || company.legalName)}</h4><p>${escapeHtml(signal.reasons.join(' · '))}</p></div>
    <div class="radar-score-track"><div class="radar-score-fill" style="--w:${signal.score}%"></div></div>
    <div class="radar-score">${signal.score}</div>
    <div><button class="button button-small button-ghost" data-company-id="${company.id}">Granska</button></div>
  </article>`;
}

function candidateForm() {
  const candidate = state.pipeline.find(c => c.id === state.editingCandidateId) || {};
  const brands = unique([...state.data.workforce.map(w => w.brand), ...state.data.companies.map(c => c.brand).filter(Boolean)]);
  const factors = candidate.factors || {};
  return `<form id="candidateForm">
    <div class="form-grid candidate-form-grid">
      ${field('candidateName','Namn',`<input id="candidateName" name="name" required placeholder="För- och efternamn" value="${escapeAttr(candidate.name || '')}">`)}
      ${field('candidateBrand','Kedja',`<select id="candidateBrand" name="brand"><option value="">Välj kedja</option>${brands.map(v => option(v,candidate.brand || '')).join('')}</select>`)}
      ${field('candidateOffice','Kontor / område',`<input id="candidateOffice" name="office" placeholder="Kontor eller geografiskt område" value="${escapeAttr(candidate.office || '')}">`)}
      ${field('candidateOwner','Ansvarig delägare',`<input id="candidateOwner" name="owner" list="ownerSuggestions" placeholder="Christoffer, Lina…" value="${escapeAttr(candidate.owner || '')}"><datalist id="ownerSuggestions"><option value="Christoffer"><option value="Lina"><option value="Ej fördelad"></datalist>`)}
      ${field('candidateStatus','Status',`<select id="candidateStatus" name="status">${candidateStatuses().map(v => option(v,normalizeCandidateStatus(candidate.status || 'Identifierad'))).join('')}</select>`)}
      ${field('candidateNextAction','Nästa aktivitet',`<input id="candidateNextAction" name="nextAction" placeholder="Ring, boka lunch, följ upp…" value="${escapeAttr(candidate.nextAction || '')}">`)}
      ${field('candidateNextDate','Datum',`<input id="candidateNextDate" name="nextActionDate" type="date" value="${escapeAttr(candidate.nextActionDate || '')}">`)}
      ${field('candidateUrl','Publik länk',`<input id="candidateUrl" name="url" type="url" placeholder="https://…" value="${escapeAttr(candidate.url || '')}">`)}
      <fieldset class="score-fieldset full"><legend>Rekryteringsscore · 0 = ej bedömd, 5 = mycket stark</legend><div class="score-grid">
        ${scoreSelect('localPresence','Lokal närvaro',factors.localPresence,25)}
        ${scoreSelect('activity','Aktivitet / affärer',factors.activity,20)}
        ${scoreSelect('reviews','Kundomdömen',factors.reviews,15)}
        ${scoreSelect('areaFit','Match mot våra områden',factors.areaFit,20)}
        ${scoreSelect('experience','Erfarenhet / stabilitet',factors.experience,20)}
      </div><p class="score-help">Poängen visar varför kandidaten prioriteras. Den ska komplettera – inte ersätta – möte, referenser och professionell bedömning.</p></fieldset>
      ${field('candidateNotes','Egna anteckningar',`<textarea id="candidateNotes" name="notes" placeholder="Varför intressant, kontaktläge och viktig kontext…">${escapeHtml(candidate.notes || '')}</textarea>`,'full')}
    </div>
    <div class="form-actions">${state.editingCandidateId ? '<button type="button" class="button button-ghost" data-action="cancel-edit-candidate">Avbryt</button>' : ''}<button class="button button-accent" type="submit">${state.editingCandidateId ? 'Spara ändringar' : 'Lägg till kandidat'}</button></div>
  </form>`;
}

function pipelineCard(candidate) {
  const assessment = candidateAssessment(candidate);
  const score = assessment.score;
  const attention = candidateAttention(candidate);
  const scoreClass = assessment.complete && score>=75 ? 'high' : assessment.complete && score>=50 ? 'medium' : 'low';
  return `<article class="pipeline-card ${attention.overdue?'overdue':''}">
    <div class="pipeline-card-header"><div><h4>${escapeHtml(candidate.name)}</h4><p>${escapeHtml(candidate.brand || 'Okänd kedja')}${candidate.office ? ` · ${escapeHtml(candidate.office)}` : ''}</p></div><div class="candidate-score ${scoreClass}"><strong>${assessment.assessedCount ? score : '—'}</strong><span>${assessment.complete ? 'score' : `${assessment.assessedCount}/5 bedömda`}</span></div></div>
    <div class="candidate-meta"><span class="badge ${pipelineStatusClass(normalizeCandidateStatus(candidate.status))}">${escapeHtml(normalizeCandidateStatus(candidate.status))}</span><span>Ansvar: <strong>${escapeHtml(candidate.owner || 'Ej fördelad')}</strong></span></div>
    ${(candidate.nextAction||candidate.nextActionDate||attention.missingPlan)?`<div class="next-action ${attention.overdue?'late':attention.dueSoon||attention.missingPlan?'soon':''}"><strong>${escapeHtml(candidate.nextAction || 'Nästa aktivitet saknas')}</strong><span>${candidate.nextActionDate?formatDate(candidate.nextActionDate):'Datum saknas'}</span></div>`:''}
    ${candidate.notes ? `<div class="pipeline-notes">${escapeHtml(candidate.notes)}</div>` : ''}
    ${assessment.assessedCount?candidateScoreBreakdown(candidate):'<div class="score-missing">Score saknas – bedöm fem yrkesfaktorer.</div>'}
    <div class="pipeline-actions">${candidate.url ? `<a class="button button-small button-ghost" target="_blank" rel="noopener" href="${safeUrl(candidate.url)}">Profil ↗</a>` : ''}<button class="button button-small button-ghost" data-edit-candidate="${escapeAttr(candidate.id)}">Redigera</button><button class="button button-small button-danger" data-delete-candidate="${escapeAttr(candidate.id)}">Ta bort</button></div>
  </article>`;
}

function openCompanyDetail(companyId, activeTab = 'overview') {
  const company = state.data.companies.find(c => c.id === companyId);
  if (!company) return;
  const tab = FINANCIAL_TABS.some(item => item.id === activeTab) ? activeTab : 'overview';
  state.activeCompanyId = companyId;
  state.activeFinancialTab = tab;
  const signal = pressureSignal(company);
  const benchmark = benchmarkCompany();
  const workforce = state.data.workforce.find(w => w.brand === company.brand);
  const mappedOffices = state.data.offices.filter(o => o.legalName === company.legalName || (o.brand === company.brand && o.office === company.office));
  const coverage = financialCoverage(company);
  els.detailDialogContent.innerHTML = `
    <div class="company-detail-head">
      <div>
        <div class="detail-badges">
          <span class="badge ${company.isBenchmark ? 'badge-accent' : signalBadgeClass(signal.level)}">${company.isBenchmark ? 'EO benchmark' : `Bevakningssignal ${signal.score}`}</span>
          <span class="coverage-label ${coverage.className}"><strong>${coverage.years}</strong> år · ${coverage.label}</span>
        </div>
        <h2>${escapeHtml(company.legalName)}</h2>
        <p class="lead">${escapeHtml(company.brand)} · ${escapeHtml(company.office || '')} · org.nr ${escapeHtml(company.orgNo || 'saknas')} · senaste bokslut ${escapeHtml(company.fiscalYear || 'saknas')}</p>
      </div>
    </div>
    <div class="detail-metrics">
      ${miniMetric('Omsättning',formatKsek(company.revenueKsek))}
      ${miniMetric('Resultat',formatKsek(company.profitKsek))}
      ${miniMetric('Anställda',formatIntegerOrDash(company.employees))}
      ${miniMetric('Marginal',formatPercent(company.margin))}
      ${miniMetric('Oms./anst.',formatKsek(company.revenuePerEmployeeKsek))}
      ${miniMetric('Vinst/anst.',formatKsek(company.profitPerEmployeeKsek))}
    </div>
    ${financialTabNavigation(company, tab)}
    <div class="financial-tab-panel" role="tabpanel">${financialTabContent(company, tab, {signal, benchmark, workforce, mappedOffices, coverage})}</div>
    <div class="card-actions detail-section">
      ${company.allabolagUrl ? `<a class="button button-ghost" href="${safeUrl(company.allabolagUrl)}" target="_blank" rel="noopener">Allabolag ↗</a>` : ''}
      ${company.officialUrl ? `<a class="button button-ghost" href="${safeUrl(company.officialUrl)}" target="_blank" rel="noopener">Officiell webb ↗</a>` : ''}
      ${workforce?.url ? `<a class="button button-accent" href="${safeUrl(workforce.url)}" target="_blank" rel="noopener">Publika mäklarprofiler ↗</a>` : ''}
      <button class="button ${state.compare.has(company.id) ? 'button-accent' : 'button-ghost'}" data-compare-id="${company.id}">${state.compare.has(company.id) ? 'Vald för jämförelse' : 'Lägg till jämförelse'}</button>
    </div>`;
  if (!els.detailDialog.open) els.detailDialog.showModal();
}

function openCompareDialog() {
  const benchmark = benchmarkCompany();
  const selected = [...state.compare].map(id => state.data.companies.find(c => c.id === id)).filter(Boolean);
  const companies = [benchmark, ...selected.filter(c => c.id !== benchmark.id)];
  els.detailDialogContent.innerHTML = `
    <span class="badge badge-accent">Benchmarkjämförelse</span>
    <h2>EO Göteborg 21 mot valda bolag</h2>
    <p class="lead">Alla staplar normaliseras inom den valda gruppen. Delta visas mot EO.</p>
    ${compareCards(companies, benchmark)}
    <div class="detail-section"><p>Bokslutsår kan skilja. Använd jämförelsen som orientering och öppna Allabolag för kontroll innan beslut.</p></div>`;
  els.detailDialog.showModal();
}

function compareCards(companies, benchmark) {
  const metrics = [
    { key:'profitPerEmployeeKsek', label:'Vinst / anställd', format:formatKsek },
    { key:'revenuePerEmployeeKsek', label:'Omsättning / anställd', format:formatKsek },
    { key:'margin', label:'Vinstmarginal', format:formatPercent },
    { key:'profitKsek', label:'Totalt resultat', format:formatKsek }
  ];
  const maxima = Object.fromEntries(metrics.map(m => [m.key, Math.max(...companies.map(c => Number.isFinite(c[m.key]) ? Math.abs(c[m.key]) : 0),1)]));
  return `<div class="compare-grid">${companies.map(c => `
    <article class="compare-card ${c.id === benchmark.id ? 'benchmark' : ''}">
      <h4>${escapeHtml(c.legalName)}</h4><p>${escapeHtml(c.office || c.brand)} · ${escapeHtml(c.fiscalYear || '')}</p>
      ${metrics.map(m => {
        const hasValue = Number.isFinite(c[m.key]);
        const hasBase = Number.isFinite(benchmark[m.key]);
        const value = hasValue ? c[m.key] : null;
        const base = hasBase ? benchmark[m.key] : null;
        const delta = hasValue && hasBase && base !== 0 ? (value-base)/Math.abs(base) : null;
        const width = hasValue ? Math.abs(value)/maxima[m.key]*100 : 0;
        return `<div class="compare-metric"><div class="compare-metric-head"><span>${m.label}</span><strong>${m.format(value)}</strong></div><div class="bar-track"><div class="bar-fill ${hasValue&&value<0?'negative':''}" style="--w:${width}%"></div></div>${!hasValue ? '<div class="compare-delta missing">Data saknas</div>' : c.id === benchmark.id || delta === null ? '' : `<div class="compare-delta">${delta >= 0 ? '+' : ''}${formatPercent(delta)} mot EO</div>`}</div>`;
      }).join('')}
    </article>`).join('')}</div>`;
}

function renderMethodDialog() {
  if (!state.data) return;
  const excluded = state.data.excluded;
  els.methodDialogContent.innerHTML = `
    <span class="badge badge-blue">Datakvalitet</span>
    <h2>Så ska appen läsas</h2>
    <p class="lead">Appen är ett beslutsstöd för bolags- och marknadsspaning. Den ersätter inte kontroll av årsredovisning, anställningsförhållande eller individuell rekryteringsbedömning.</p>
    <div class="method-list">
      ${state.data.meta.notes.map((note,index) => `<div class="method-item"><strong>${index+1}. Viktig begränsning</strong><p>${escapeHtml(note)}</p></div>`).join('')}
      <div class="method-item"><strong>Vinst per anställd</strong><p>Resultat efter finansiella poster dividerat med rapporterat medelantal anställda. Ett starkt nyckeltal, men ägarlöner, konsulter och provisionsmodeller kan påverka jämförbarheten.</p></div>
      <div class="method-item"><strong>Bevakningssignal</strong><p>Poäng 0–100 från lönsamhet, effektivitet och verifierad flerårstrend där den finns. Det är en prioriteringsflagga på bolagsnivå – inte ett påstående om personalen.</p></div>
      <div class="method-item"><strong>Fördjupad ekonomi</strong><p>Grundvyn visar bara säkra jämförelsetal. Resultat-, kostnads-, balans- och nyckeltalsflikarna visar exakt vilka rader som finns för varje period. Tomma fält uppskattas aldrig. Lokalkostnad visas bara när den uttryckligen kan beläggas i årsredovisningen.</p></div>
      <div class="method-item"><strong>Datakälla för automatisk uppdatering</strong><p>Systematisk kopiering från Allabolag används inte. Full historik ska importeras från Bolagsverkets officiella API eller från kontrollerade årsredovisningar med tydlig källhänvisning.</p></div>
      <div class="method-item"><strong>Personuppgifter</strong><p>Endast publika yrkesnamn från mäklarguider finns i snapshoten. Kandidater, score och områdesdata sparas lokalt i webbläsaren. Exportera regelbundet för backup och delning.</p></div>
    </div>
    <div class="detail-section"><h3>Exkluderade juridiska bolag</h3><p>Holding-, service- och skalbolag hålls utanför den operativa rankingen för att inte förstöra jämförelsen.</p><div class="additional-grid">${excluded.map(x => `<div class="additional-card"><h4>${escapeHtml(x.legalName || x.name || 'Bolag')}</h4><p>${escapeHtml(x.reason || x.comment || x.type || 'Exkluderat från driftjämförelsen')}</p></div>`).join('')}</div></div>
    <div class="detail-section"><h3>Snapshot</h3><p>Appversion ${APP_VERSION} · ${escapeHtml(state.data.meta.snapshot)} · källa: ${escapeHtml(state.data.meta.sourceWorkbook)}</p></div>`;
}

function handleClick(event) {
  const close = event.target.closest('[data-close-dialog]');
  if (close) { close.closest('dialog').close(); return; }

  const financialTab = event.target.closest('[data-financial-tab]');
  if (financialTab) {
    openCompanyDetail(financialTab.dataset.companyId, financialTab.dataset.financialTab);
    return;
  }

  const nav = event.target.closest('[data-nav]');
  if (nav) {
    const workforceBrand = nav.dataset.workforceBrand;
    if (workforceBrand) state.selectedWorkforceBrand = workforceBrand;
    state.view = nav.dataset.nav;
    window.scrollTo({ top: 0, behavior: 'smooth' });
    renderApp();
    return;
  }

  const companyTarget = event.target.closest('[data-company-id]');
  if (companyTarget) { openCompanyDetail(companyTarget.dataset.companyId); return; }

  const officePeopleTarget = event.target.closest('[data-office-people]');
  if (officePeopleTarget) {
    const officeId = officePeopleTarget.dataset.officePeople;
    state.openOfficeId = state.openOfficeId === officeId ? null : officeId;
    renderApp();
    if (state.openOfficeId) {
      requestAnimationFrame(() => {
        const card = document.querySelector(`[data-office-card-id="${cssEscape(state.openOfficeId)}"]`);
        if (card) card.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    }
    return;
  }

  const addOfficePerson = event.target.closest('[data-add-office-person]');
  if (addOfficePerson) {
    const person = (state.data.officePeople || []).find(item => item.id === addOfficePerson.dataset.addOfficePerson);
    const office = state.data.offices.find(item => item.id === addOfficePerson.dataset.officeId);
    if (!person || !office) return;
    const existing = state.pipeline.find(candidate => candidate.name.toLowerCase() === person.name.toLowerCase() && candidate.brand === office.brand);
    if (existing) { toast('Personen finns redan i pipelinen.'); return; }
    state.pipeline.unshift({
      id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()),
      name: person.name, brand: office.brand, office: office.office || '', status: 'Identifierad', owner: 'Ej fördelad',
      nextAction: 'Granska profil och fördela ansvar', nextActionDate: '', factors: {}, url: person.profileUrl || office.peopleSourceUrl || '', notes: '', createdAt: new Date().toISOString()
    });
    savePipeline();
    toast('Tillagd i kandidatpipelinen.');
    renderApp();
    return;
  }

  const compareTarget = event.target.closest('[data-compare-id]');
  if (compareTarget) {
    const inDialog = Boolean(compareTarget.closest('#detailDialog'));
    if (inDialog && els.detailDialog.open) els.detailDialog.close();
    toggleCompare(compareTarget.dataset.compareId);
    return;
  }

  const workforceTarget = event.target.closest('[data-workforce-brand]');
  if (workforceTarget) {
    state.selectedWorkforceBrand = workforceTarget.dataset.workforceBrand;
    state.view = 'offices';
    renderApp();
    return;
  }

  const addPerson = event.target.closest('[data-add-person]');
  if (addPerson) {
    const workforce = state.data.workforce.find(w => w.brand === addPerson.dataset.personBrand);
    const existing = state.pipeline.find(c => c.name.toLowerCase() === addPerson.dataset.addPerson.toLowerCase() && c.brand === addPerson.dataset.personBrand);
    if (existing) { toast('Personen finns redan i pipelinen.'); return; }
    state.pipeline.unshift({
      id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()),
      name: addPerson.dataset.addPerson,
      brand: addPerson.dataset.personBrand,
      office: '',
      status: 'Identifierad',
      owner: 'Ej fördelad',
      nextAction: 'Granska profil och fördela ansvar',
      nextActionDate: '',
      factors: {},
      url: workforce?.url || '',
      notes: '',
      createdAt: new Date().toISOString()
    });
    savePipeline();
    toast('Tillagd i kandidatpipelinen.');
    renderApp();
    return;
  }

  const deleteAreaEntry = event.target.closest('[data-delete-area-entry]');
  if (deleteAreaEntry) {
    if (!window.confirm('Ta bort den här områdesperioden?')) return;
    const area = state.areas.find(a=>a.id===deleteAreaEntry.dataset.areaId);
    if (area) area.entries = area.entries.filter(e=>e.id!==deleteAreaEntry.dataset.deleteAreaEntry);
    saveAreas(); renderApp(); toast('Områdesperioden togs bort.'); return;
  }

  const edit = event.target.closest('[data-edit-candidate]');
  if (edit) {
    state.editingCandidateId = edit.dataset.editCandidate; state.view = 'radar'; renderApp();
    requestAnimationFrame(() => document.querySelector('.candidate-editor')?.scrollIntoView({ behavior:'smooth', block:'start' }));
    return;
  }
  const remove = event.target.closest('[data-delete-candidate]');
  if (remove) {
    if (!window.confirm('Ta bort kandidaten från pipelinen?')) return;
    state.pipeline = state.pipeline.filter(c => c.id !== remove.dataset.deleteCandidate);
    if (state.editingCandidateId === remove.dataset.deleteCandidate) state.editingCandidateId = null;
    savePipeline(); renderApp(); toast('Kandidaten togs bort.'); return;
  }

  const action = event.target.closest('[data-action]')?.dataset.action;
  if (!action) return;
  if (action === 'print') window.print();
  if (action === 'export-companies') exportCompaniesCsv();
  if (action === 'export-pipeline') exportPipeline();
  if (action === 'export-areas') exportAreas();
  if (action === 'cancel-edit-candidate') { state.editingCandidateId = null; renderApp(); }
  if (action === 'quick-compare-top') quickCompareTop();
}

function handleInput(event) {
  const id = event.target.id;
  if (id === 'companySearch') { state.companyFilters.search = event.target.value; renderPreservingInput(id, event.target.selectionStart); }
  if (id === 'officeSearch') { state.officeFilters.search = event.target.value; renderPreservingInput(id, event.target.selectionStart); }
  if (id === 'radarSearch') { state.radarFilters.search = event.target.value; renderPreservingInput(id, event.target.selectionStart); }
  if (id === 'areaSearch') { state.areaFilters.search = event.target.value; renderPreservingInput(id, event.target.selectionStart); }
}

function renderPreservingInput(id, cursorPosition) {
  renderApp();
  const input = document.getElementById(id);
  if (!input) return;
  input.focus({ preventScroll: true });
  if (typeof input.setSelectionRange === 'function' && Number.isFinite(cursorPosition)) {
    input.setSelectionRange(cursorPosition, cursorPosition);
  }
}

function handleChange(event) {
  const id = event.target.id;
  if (id === 'companyBrand') { state.companyFilters.brand = event.target.value; renderApp(); }
  if (id === 'companyMunicipality') { state.companyFilters.municipality = event.target.value; renderApp(); }
  if (id === 'companySort') { state.companyFilters.sort = event.target.value; renderApp(); }
  if (id === 'riskOnly') { state.companyFilters.riskOnly = event.target.checked; renderApp(); }
  if (id === 'officeBrand') { state.officeFilters.brand = event.target.value; renderApp(); }
  if (id === 'officeConfidence') { state.officeFilters.confidence = event.target.value; renderApp(); }
  if (id === 'workforceBrand') { state.selectedWorkforceBrand = event.target.value; renderApp(); }
  if (id === 'radarMinimum') { state.radarFilters.minimum = number(event.target.value); renderApp(); }
  if (id === 'radarOwner') { state.radarFilters.owner = event.target.value; renderApp(); }
  if (id === 'radarStatus') { state.radarFilters.status = event.target.value; renderApp(); }
  if (id === 'importPipeline' && event.target.files?.[0]) importPipeline(event.target.files[0]);
  if (id === 'importAreas' && event.target.files?.[0]) importAreas(event.target.files[0]);
}

document.addEventListener('submit', event => {
  if (event.target.id === 'candidateForm') {
    event.preventDefault();
    const form = new FormData(event.target);
    const factorNames = ['localPresence','activity','reviews','areaFit','experience'];
    const factors = Object.fromEntries(factorNames.map(key=>[key,Math.max(0,Math.min(5,number(form.get(key))))]));
    const candidate = {
      id: state.editingCandidateId || (crypto.randomUUID ? crypto.randomUUID() : String(Date.now())),
      name: String(form.get('name') || '').trim(),
      brand: String(form.get('brand') || '').trim(),
      office: String(form.get('office') || '').trim(),
      owner: String(form.get('owner') || 'Ej fördelad').trim() || 'Ej fördelad',
      status: normalizeCandidateStatus(String(form.get('status') || 'Identifierad')),
      nextAction: String(form.get('nextAction') || '').trim(),
      nextActionDate: sanitizeIsoDate(form.get('nextActionDate')),
      factors,
      url: String(form.get('url') || '').trim(),
      notes: String(form.get('notes') || '').trim(),
      updatedAt: new Date().toISOString()
    };
    if (!candidate.name) return;
    if (state.editingCandidateId) state.pipeline = state.pipeline.map(c => c.id === state.editingCandidateId ? { ...c, ...candidate } : c);
    else { candidate.createdAt = candidate.updatedAt; state.pipeline.unshift(candidate); }
    state.editingCandidateId = null;
    savePipeline(); renderApp(); toast('Pipelinen är uppdaterad.');
    return;
  }

  if (event.target.id === 'areaForm') {
    event.preventDefault();
    const form = new FormData(event.target);
    const selected = String(form.get('areaId')||'new');
    const name = String(form.get('newAreaName')||'').trim();
    const target = parseOptionalNumber(form.get('targetShare'));
    const eoSales = parseOptionalNumber(form.get('eoSales'));
    const marketSales = parseOptionalNumber(form.get('marketSales'));
    let sharePct = parseOptionalNumber(form.get('sharePct'));
    const period=String(form.get('period')||'').trim();
    const source=String(form.get('source')||'').trim();
    const asOf=String(form.get('asOf')||'').trim() || new Date().toISOString().slice(0,10);

    if (selected==='new'&&!name) { toast('Ange ett områdesnamn.'); return; }
    if (target!==null&&(target<0||target>100)) { toast('Målet måste vara mellan 0 och 100 %.'); return; }
    if ((eoSales===null)!==(marketSales===null)) { toast('Ange både EO-affärer och marknadens total.'); return; }
    if (eoSales!==null&&marketSales!==null) {
      if (marketSales<=0) { toast('Marknadens total måste vara större än noll.'); return; }
      if (eoSales<0||eoSales>marketSales) { toast('EO-affärer kan inte vara fler än marknadens total.'); return; }
      sharePct=eoSales/marketSales*100;
    }
    if (sharePct===null) { toast('Ange affärsantal eller verifierad andel.'); return; }
    if (sharePct<0||sharePct>100) { toast('Marknadsandelen måste vara mellan 0 och 100 %.'); return; }

    let area=selected==='new'?null:state.areas.find(a=>a.id===selected);
    if(selected==='new') { area={id:slugify(name)+'-'+Date.now(),name,targetShare:null,entries:[]}; state.areas.push(area); }
    if(!area)return;
    if(target!==null)area.targetShare=target;
    if(area.entries.some(e=>e.period===period&&e.asOf===asOf)){toast('Den perioden och mätdagen finns redan för området.');return;}
    area.entries.push({
      id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()),
      period:period || 'Period saknas',
      eoSales, marketSales, sharePct,
      source:source || 'Källa saknas',
      sourceUrl:String(form.get('sourceUrl')||'').trim(),
      asOf,
      createdAt:new Date().toISOString()
    });
    saveAreas(); event.target.reset(); renderApp(); toast('Områdesdata sparades.');
  }
});

function toggleCompare(companyId) {
  const benchmark = benchmarkCompany();
  if (companyId === benchmark.id) { toast('EO ligger alltid med som benchmark.'); return; }
  if (state.compare.has(companyId)) state.compare.delete(companyId);
  else {
    if (state.compare.size >= 4) { toast('Max fyra konkurrenter åt gången.'); return; }
    state.compare.add(companyId);
  }
  updateCompareDock();
  renderApp();
}

function updateCompareDock() {
  const count = state.compare.size;
  els.compareDock.hidden = count === 0;
  els.compareCount.textContent = `${count} ${count === 1 ? 'bolag valt' : 'bolag valda'}`;
}

function quickCompareTop() {
  const top = rankBy('profitPerEmployeeKsek', true).filter(c => !c.isBenchmark).slice(0,3);
  state.compare = new Set(top.map(c => c.id));
  updateCompareDock();
  openCompareDialog();
}

function filteredCompanies() {
  const f = state.companyFilters;
  const direction = f.direction === 'asc' ? 1 : -1;
  return state.data.companies.filter(c => {
    const haystack = `${c.legalName} ${c.brand} ${c.office} ${c.orgNo}`.toLowerCase();
    return (!f.search || haystack.includes(f.search.toLowerCase())) &&
      (f.brand === 'Alla' || c.brand === f.brand) &&
      (f.municipality === 'Alla' || c.municipality === f.municipality) &&
      (!f.riskOnly || number(c.profitKsek) < 0);
  }).sort((a,b) => {
    if (a.isBenchmark && !b.isBenchmark) return -1;
    if (!a.isBenchmark && b.isBenchmark) return 1;
    const av = a[f.sort]; const bv = b[f.sort];
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    return (number(av)-number(bv))*direction;
  });
}

function financialCompanies() {
  return state.data.companies.filter(c => Number.isFinite(c.revenueKsek) || Number.isFinite(c.profitKsek));
}

function benchmarkCompany() {
  return state.data.companies.find(c => c.isBenchmark) || state.data.companies[0];
}

function rankBy(key, descending = true) {
  return financialCompanies().filter(c => Number.isFinite(c[key])).sort((a,b) => (number(a[key])-number(b[key])) * (descending ? -1 : 1));
}

function benchmarkCompositeScore(benchmark, companies) {
  const keys = ['profitPerEmployeeKsek','revenuePerEmployeeKsek','margin'];
  const percentiles = keys.map(key => percentileRank(number(benchmark[key]), companies.map(c => c[key]).filter(Number.isFinite)));
  return Math.round(percentiles.reduce((a,b) => a+b,0)/percentiles.length*100);
}

function percentileRank(value, values) {
  if (!values.length) return 0;
  const below = values.filter(v => v < value).length;
  const equal = values.filter(v => v === value).length;
  return (below + Math.max(0,equal-1)/2) / Math.max(1,values.length-1);
}

function pressureSignal(company) {
  let score = 5;
  const reasons = [];
  let available = 0;
  const totalChecks = 7;
  const profit = Number.isFinite(company.profitKsek) ? company.profitKsek : null;
  const margin = Number.isFinite(company.margin) ? company.margin : null;
  const profitPerEmployee = Number.isFinite(company.profitPerEmployeeKsek) ? company.profitPerEmployeeKsek : null;
  const revenuePerEmployee = Number.isFinite(company.revenuePerEmployeeKsek) ? company.revenuePerEmployeeKsek : null;
  const employees = Number.isFinite(company.employees) ? company.employees : null;
  const history = companyHistory(company);

  if (profit!==null) { available++; if (profit < 0) { score += 31; reasons.push('negativt resultat'); } else reasons.push('positivt resultat'); }
  if (margin!==null) { available++; if (margin < 0) { score += 22; reasons.push('negativ marginal'); } else if (margin < .05) { score += 18; reasons.push('marginal under 5 %'); } else if (margin < .10) { score += 9; reasons.push('marginal under 10 %'); } else if (margin > .20) score -= 5; }
  if (profitPerEmployee!==null) { available++; if (profitPerEmployee < 0) { score += 18; reasons.push('negativ vinst per anställd'); } else if (profitPerEmployee < 100) { score += 11; reasons.push('svag vinst per anställd'); } else if (profitPerEmployee > 500) score -= 5; }
  if (revenuePerEmployee!==null) { available++; if (revenuePerEmployee < 1500) { score += 12; reasons.push('låg omsättning per anställd'); } else if (revenuePerEmployee < 2200) { score += 6; reasons.push('måttlig omsättning per anställd'); } else if (revenuePerEmployee > 3200) score -= 4; }
  if (employees!==null) { available++; if (employees>=10) { score+=7; reasons.push('större kandidatbas'); } else if (employees>=5) { score+=4; reasons.push('relevant kandidatbas'); } }

  if (history.length>1) {
    available+=2;
    const latest=history.at(-1), prior=history.at(-2);
    const revChange=deltaVs(latest.revenueKsek,prior.revenueKsek);
    const profitChange=deltaVs(latest.profitKsek,prior.profitKsek);
    if (revChange < -.10) { score+=13; reasons.push(`omsättningen föll ${formatPercent(Math.abs(revChange))}`); }
    else if (revChange > .10) score-=4;
    if (profitChange < -.20) { score+=13; reasons.push(`resultatet föll ${formatPercent(Math.abs(profitChange))}`); }
    else if (profitChange > .20) score-=4;
  } else reasons.push('flerårstrend saknas');

  if (company.mapping && normalizeConfidence(company.mapping) !== 'Hög') { score -= 2; reasons.push('juridisk mappning bör verifieras'); }
  score = Math.max(0, Math.min(100, Math.round(score)));
  const level = score >= 60 ? 'Hög' : score >= 33 ? 'Medel' : 'Låg';
  return { score, level, reasons:[...new Set(reasons)], coverage:Math.round(available/totalChecks*100) };
}
function recruitmentSignal(company) { return pressureSignal(company); }

function signalBadgeClass(level) { return level === 'Hög' ? 'badge-high' : level === 'Medel' ? 'badge-medium' : 'badge-low'; }
function pipelineStatusClass(status='') {
  const normalized=normalizeCandidateStatus(status);
  if (['Rekryterad','Erbjudande'].includes(normalized)) return 'badge-accent';
  if (['Första möte','Dialog pågår'].includes(normalized)) return 'badge-high';
  if (['Kontaktad','Kontakt planerad'].includes(normalized)) return 'badge-blue';
  if (normalized === 'Inte aktuell') return 'badge-muted';
  return 'badge-low';
}

function field(id,label,control,className='') { return `<div class="field ${className}"><label for="${id}">${label}</label>${control}</div>`; }
function option(value,selected) { return `<option value="${escapeAttr(value)}" ${value === selected ? 'selected' : ''}>${escapeHtml(value)}</option>`; }
function sortOption(value,label,selected) { return `<option value="${value}" ${value === selected ? 'selected' : ''}>${label}</option>`; }


function buildAttentionItems() {
  const items=[];
  const overdue=state.pipeline.filter(c=>candidateAttention(c).overdue);
  if (overdue.length) items.push({level:'high',title:`${overdue.length} förfallna kandidatuppföljningar`,text:'Nytt datum eller ett tydligt beslut behövs.',view:'radar',tag:'Rekrytering'});
  const missingPlan=state.pipeline.filter(c=>candidateAttention(c).missingPlan).length;
  if (missingPlan) items.push({level:'medium',title:`${missingPlan} kandidater saknar komplett nästa steg`,text:'Lägg till både aktivitet och datum så att uppföljningen syns.',view:'radar',tag:'Uppföljning'});
  const unowned=state.pipeline.filter(c=>!c.owner || c.owner==='Ej fördelad').length;
  if (unowned) items.push({level:'medium',title:`${unowned} kandidater utan ansvarig`,text:'Fördela ägarskap så att ingen kontakt faller mellan stolarna.',view:'radar',tag:'Ansvar'});
  const highPressure=financialCompanies().filter(c=>!c.isBenchmark && pressureSignal(c).level==='Hög');
  if (highPressure.length) items.push({level:'high',title:`${highPressure.length} bolag med hög bevakningssignal`,text:'Granska ekonomi, personalrörelser och lokal marknadsposition.',view:'companies',tag:'Konkurrent'});
  const metrics=benchmarkMetrics();
  const belowTop=metrics.filter(m=>m.eo<m.q75);
  if (belowTop.length) items.push({level:'medium',title:`EO under toppkvartilen i ${belowTop.length} nyckeltal`,text:belowTop.map(x=>x.label.toLowerCase()).join(', ')+'.',view:'companies',tag:'Benchmark'});
  const area=areaPortfolioSummary();
  if (area.stale) items.push({level:'medium',title:`${area.stale} områden behöver färsk data`,text:'Uppdatera period och källa för att få en aktuell marknadsbild.',view:'areas',tag:'Områden'});
  if (!area.withData) items.push({level:'high',title:'Ingen områdesdata registrerad',text:'Lägg in verifierade försäljningar eller andelar per mikroområde.',view:'areas',tag:'Marknadsandel'});
  return items;
}
function attentionCard(item) { return `<button class="attention-card ${item.level}" data-nav="${item.view}"><span>${escapeHtml(item.tag)}</span><strong>${escapeHtml(item.title)}</strong><p>${escapeHtml(item.text)}</p><i>Öppna →</i></button>`; }

function companyHistory(company) {
  const rows=Array.isArray(company.history)?company.history.map(x=>({...x})):[];
  if (!rows.some(x=>String(x.fiscalYear||x.year)===String(company.fiscalYear||'').slice(0,4) || x.year===Number(String(company.fiscalYear||'').slice(0,4)))) {
    const year=Number(String(company.fiscalYear||'').slice(0,4));
    if (year && (Number.isFinite(company.revenueKsek)||Number.isFinite(company.profitKsek))) rows.push({year,fiscalYear:company.fiscalYear,revenueKsek:company.revenueKsek,profitKsek:company.profitKsek,ebitdaKsek:company.ebitdaKsek,employees:company.employees,margin:company.margin,revenuePerEmployeeKsek:company.revenuePerEmployeeKsek,profitPerEmployeeKsek:company.profitPerEmployeeKsek,sourceUrl:company.allabolagUrl,source:'Senaste bolagssnapshot'});
  }
  return rows.filter(x=>x.year).map(normalizeFinancialPeriod).sort((a,b)=>a.year-b.year);
}

function normalizeFinancialPeriod(row) {
  const revenueKsek = firstFinancialNumber(row.revenueKsek, row.turnoverKsek, row.totalRevenueKsek);
  const netRevenueKsek = firstFinancialNumber(row.netRevenueKsek, revenueKsek);
  const profitKsek = firstFinancialNumber(row.profitKsek, row.profitAfterFinancialKsek);
  const employees = firstFinancialNumber(row.employees);
  const margin = firstFinancialNumber(row.margin, Number.isFinite(profitKsek) && revenueKsek ? profitKsek / revenueKsek : null);
  const revenuePerEmployeeKsek = firstFinancialNumber(row.revenuePerEmployeeKsek, Number.isFinite(revenueKsek) && employees ? revenueKsek / employees : null);
  const profitPerEmployeeKsek = firstFinancialNumber(row.profitPerEmployeeKsek, Number.isFinite(profitKsek) && employees ? profitKsek / employees : null);
  const ebitdaKsek = firstFinancialNumber(row.ebitdaKsek);
  const ebitdaMargin = firstFinancialNumber(row.ebitdaMargin, Number.isFinite(ebitdaKsek) && revenueKsek ? ebitdaKsek / revenueKsek : null);
  const currentAssetsKsek = firstFinancialNumber(row.currentAssetsKsek);
  const currentLiabilitiesKsek = firstFinancialNumber(row.currentLiabilitiesKsek);
  const totalAssetsKsek = firstFinancialNumber(row.totalAssetsKsek);
  const equityKsek = firstFinancialNumber(row.equityKsek);
  return {
    ...row,
    year: Number(row.year || String(row.fiscalYear || '').slice(0,4)),
    revenueKsek,
    netRevenueKsek,
    profitKsek,
    profitAfterFinancialKsek: firstFinancialNumber(row.profitAfterFinancialKsek, profitKsek),
    employees,
    margin,
    revenuePerEmployeeKsek,
    profitPerEmployeeKsek,
    ebitdaKsek,
    ebitdaMargin,
    currentRatioPct: firstFinancialNumber(row.currentRatioPct, Number.isFinite(currentAssetsKsek) && currentLiabilitiesKsek ? currentAssetsKsek / currentLiabilitiesKsek * 100 : null),
    equityRatioPct: firstFinancialNumber(row.equityRatioPct, Number.isFinite(equityKsek) && totalAssetsKsek ? equityKsek / totalAssetsKsek * 100 : null)
  };
}

function firstFinancialNumber(...values) {
  for (const value of values) {
    if (value === null || value === undefined || value === '' || value === '-') continue;
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function financialCoverage(company) {
  const periods = companyHistory(company);
  const detailFields = [
    'operatingCostsKsek','operatingProfitKsek','netIncomeKsek','personnelCostsKsek',
    'premisesCostsKsek','externalCostsKsek','cashKsek','currentAssetsKsek',
    'totalAssetsKsek','equityKsek','currentLiabilitiesKsek','longTermLiabilitiesKsek',
    'currentRatioPct','equityRatioPct','returnOnEquityPct','returnOnAssetsPct'
  ];
  const deepAvailable = periods.reduce((total,period) => total + detailFields.filter(key => Number.isFinite(period[key])).length, 0);
  const essentialAvailable = periods.reduce((total,period) => total + ['revenueKsek','profitKsek','employees','margin'].filter(key => Number.isFinite(period[key])).length, 0);
  const possible = Math.max(1, periods.length * (detailFields.length + 4));
  const percent = Math.round((deepAvailable + essentialAvailable) / possible * 100);
  if (deepAvailable >= Math.max(6, periods.length * 3)) return {years:periods.length,label:'Fördjupad',className:'complete',percent,deepAvailable};
  if (periods.length >= 2) return {years:periods.length,label:'Historik',className:'history',percent,deepAvailable};
  return {years:periods.length,label:'Grunddata',className:'basic',percent,deepAvailable};
}

function financialTabNavigation(company, activeTab) {
  return `<div class="financial-tabs" role="tablist" aria-label="Ekonomisk fördjupning">${FINANCIAL_TABS.map(tab => `
    <button role="tab" aria-selected="${tab.id === activeTab}" class="${tab.id === activeTab ? 'active' : ''}" data-company-id="${escapeAttr(company.id)}" data-financial-tab="${tab.id}">${escapeHtml(tab.label)}</button>
  `).join('')}</div>`;
}

function financialTabContent(company, activeTab, context) {
  const renderers = {
    overview: () => financialOverviewTab(company, context),
    income: () => financialIncomeTab(company),
    costs: () => financialCostsTab(company),
    balance: () => financialBalanceTab(company),
    ratios: () => financialRatiosTab(company),
    sources: () => financialSourcesTab(company, context)
  };
  return (renderers[activeTab] || renderers.overview)();
}

function financialOverviewTab(company, {signal, benchmark}) {
  const history = companyHistory(company);
  const insights = financialInsights(company);
  return `
    ${financialCoverageNotice(company)}
    <div class="financial-insight-grid">${insights.map(item => `<article class="financial-insight ${item.className || ''}"><span>${escapeHtml(item.label)}</span><strong>${escapeHtml(item.value)}</strong><p>${escapeHtml(item.note)}</p></article>`).join('')}</div>
    <div class="detail-section"><div class="detail-section-head"><div><h3>Historisk utveckling</h3><p>Omsättning, resultat och rapporterade årsanställda.</p></div><span class="badge badge-blue">${history.length} år</span></div>${history.length>1?historyChart(company):`<div class="empty-state compact">Endast senaste bokslutet är verifierat. Trend visas först när minst två perioder finns.</div>`}</div>
    ${company.isBenchmark ? `<div class="detail-section"><h3>EO mot marknaden</h3><div class="benchmark-matrix">${benchmarkMetrics().map(benchmarkMatrixCard).join('')}</div></div>` : `<div class="detail-section"><h3>Mot EO Göteborg 21</h3>${compareCards([benchmark,company],benchmark)}</div>`}
    <div class="detail-section"><h3>Bevakningssignal</h3><ul>${signal.reasons.map(reason => `<li>${escapeHtml(reason)}</li>`).join('')}</ul><p>Datatäckning i signalen: ${signal.coverage} %. Signalen är en prioritering för vidare analys, inte ett påstående om att bolaget är i kris.</p></div>`;
}

function financialIncomeTab(company) {
  const lines = [
    {key:'netRevenueKsek',label:'Nettoomsättning'},
    {key:'otherRevenueKsek',label:'Övriga rörelseintäkter'},
    {key:'revenueKsek',label:'Omsättning',emphasis:true},
    {key:'operatingCostsKsek',label:'Rörelsekostnader'},
    {key:'ebitdaKsek',label:'EBITDA'},
    {key:'depreciationKsek',label:'Avskrivningar'},
    {key:'operatingProfitKsek',label:'Rörelseresultat'},
    {key:'financialIncomeKsek',label:'Finansiella intäkter'},
    {key:'financialCostsKsek',label:'Finansiella kostnader'},
    {key:'profitAfterFinancialKsek',label:'Resultat efter finansnetto',emphasis:true},
    {key:'profitBeforeTaxKsek',label:'Resultat före skatt'},
    {key:'taxKsek',label:'Skatt'},
    {key:'netIncomeKsek',label:'Årets resultat'},
    {key:'proposedDividendKsek',label:'Föreslagen utdelning'}
  ];
  return `<div class="financial-tab-intro"><h3>Resultaträkning</h3><p>Fem år sida vid sida när underlag finns. Belopp i tkr; streck betyder att raden ännu inte är verifierad.</p></div>${financialStatementTable(company, lines)}`;
}

function financialCostsTab(company) {
  const latest = companyHistory(company).at(-1) || {};
  const cards = [
    {label:'Rörelsekostnader',value:formatKsek(latest.operatingCostsKsek),note:formatShareOfRevenue(latest.operatingCostsKsek,latest.revenueKsek)},
    {label:'Personalkostnader',value:formatKsek(latest.personnelCostsKsek),note:formatShareOfRevenue(latest.personnelCostsKsek,latest.revenueKsek)},
    {label:'Lokalkostnader',value:formatKsek(latest.premisesCostsKsek),note:Number.isFinite(latest.premisesCostsKsek)?'Uttryckligen redovisad kostnad':'Visas inte utan stöd i not'},
    {label:'Övriga externa kostnader',value:formatKsek(latest.externalCostsKsek),note:formatShareOfRevenue(latest.externalCostsKsek,latest.revenueKsek)}
  ];
  const lines = [
    {key:'operatingCostsKsek',label:'Rörelsekostnader totalt',emphasis:true},
    {key:'personnelCostsKsek',label:'Personalkostnader'},
    {key:'premisesCostsKsek',label:'Lokalkostnader / hyra'},
    {key:'marketingCostsKsek',label:'Marknadsföring'},
    {key:'externalCostsKsek',label:'Övriga externa kostnader'},
    {key:'depreciationKsek',label:'Avskrivningar'},
    {key:'personnelCostPerEmployeeKsek',label:'Personalkostnad / anställd'}
  ];
  return `
    <div class="financial-tab-intro"><h3>Kostnadsstruktur</h3><p>Senaste periodens viktigaste kostnader. Appen räknar inte baklänges fram hyra eller andra noter.</p></div>
    <div class="financial-cost-grid">${cards.map(card => `<article><span>${escapeHtml(card.label)}</span><strong>${card.value}</strong><small>${escapeHtml(card.note)}</small></article>`).join('')}</div>
    <div class="data-warning"><strong>Lokalkostnad kräver notdata.</strong><span>Den finns inte som standardrad i alla bokslut och ska aldrig uppskattas utifrån övriga kostnader.</span></div>
    ${financialStatementTable(company, lines)}`;
}

function financialBalanceTab(company) {
  const lines = [
    {key:'intangibleAssetsKsek',label:'Immateriella anläggningstillgångar'},
    {key:'tangibleAssetsKsek',label:'Materiella anläggningstillgångar'},
    {key:'financialAssetsKsek',label:'Finansiella anläggningstillgångar'},
    {key:'fixedAssetsKsek',label:'Anläggningstillgångar',emphasis:true},
    {key:'inventoryKsek',label:'Varulager'},
    {key:'receivablesKsek',label:'Kortfristiga fordringar'},
    {key:'cashKsek',label:'Kassa och bank'},
    {key:'currentAssetsKsek',label:'Omsättningstillgångar',emphasis:true},
    {key:'totalAssetsKsek',label:'Summa tillgångar',emphasis:true},
    {key:'equityKsek',label:'Eget kapital',emphasis:true},
    {key:'untaxedReservesKsek',label:'Obeskattade reserver'},
    {key:'provisionsKsek',label:'Avsättningar'},
    {key:'longTermLiabilitiesKsek',label:'Långfristiga skulder'},
    {key:'tradePayablesKsek',label:'Leverantörsskulder'},
    {key:'currentLiabilitiesKsek',label:'Kortfristiga skulder',emphasis:true},
    {key:'totalEquityAndLiabilitiesKsek',label:'Summa eget kapital och skulder',emphasis:true}
  ];
  return `<div class="financial-tab-intro"><h3>Balansräkning</h3><p>Likviditet, kapital och skulder över tid. Belopp i tkr.</p></div>${financialStatementTable(company, lines, {emptyText:'Balansräkningen är ännu inte importerad för det här bolaget.'})}`;
}

function financialRatiosTab(company) {
  const lines = [
    {key:'margin',label:'Vinstmarginal',format:formatPercent},
    {key:'ebitdaMargin',label:'EBITDA-marginal',format:formatPercent},
    {key:'currentRatioPct',label:'Kassalikviditet',format:formatPercentNumber},
    {key:'equityRatioPct',label:'Soliditet',format:formatPercentNumber},
    {key:'debtToEquity',label:'Skuldsättningsgrad',format:formatDecimalOrDash},
    {key:'returnOnEquityPct',label:'Avkastning på eget kapital',format:formatPercentNumber},
    {key:'returnOnAssetsPct',label:'Avkastning på totalt kapital',format:formatPercentNumber},
    {key:'employees',label:'Anställda',format:formatIntegerOrDash},
    {key:'revenuePerEmployeeKsek',label:'Omsättning / anställd',format:formatKsek},
    {key:'profitPerEmployeeKsek',label:'Vinst / anställd',format:formatKsek},
    {key:'personnelCostPerEmployeeKsek',label:'Personalkostnad / anställd',format:formatKsek}
  ];
  return `<div class="financial-tab-intro"><h3>Nyckeltal & effektivitet</h3><p>Här syns både rapporterade och transparent härledda nyckeltal. Härledda mått bygger endast på verifierade rader.</p></div>${financialStatementTable(company, lines, {valueFormatter:null})}`;
}

function financialSourcesTab(company, {mappedOffices, workforce, coverage}) {
  const sources = companyFinancialSources(company);
  return `
    <div class="financial-tab-intro"><h3>Källor & datakvalitet</h3><p>Varje period ska gå att spåra. Fullständighet betyder inte automatiskt att kontorskopplingen är säker.</p></div>
    <div class="coverage-panel">
      <div class="coverage-ring" style="--coverage:${coverage.percent}%"><strong>${coverage.percent}%</strong><span>fält täckta</span></div>
      <div><h4>${escapeHtml(coverage.label)} ekonomidata</h4><p>${coverage.years} bokslutsår i appen. ${coverage.deepAvailable ? `${coverage.deepAvailable} fördjupade fält är verifierade.` : 'Fördjupade resultat- och balansrader väntar på officiell import.'}</p></div>
    </div>
    <div class="source-list">${sources.length?sources.map(source => `<article><div><strong>${escapeHtml(source.period || 'Bolagskälla')}</strong><span>${escapeHtml(source.label)}</span>${source.meta?`<small>${escapeHtml(source.meta)}</small>`:''}</div>${source.url?`<a class="button button-small button-ghost" href="${safeUrl(source.url)}" target="_blank" rel="noopener">Öppna ↗</a>`:''}</article>`).join(''):'<div class="empty-state compact">Ingen periodkälla är registrerad.</div>'}</div>
    <div class="detail-section"><h3>Juridisk mappning</h3><p><strong>Säkerhet:</strong> ${escapeHtml(company.mapping || 'okänd')}. ${escapeHtml(company.comment || '')}</p>${mappedOffices.length ? `<p><strong>Kontorskopplingar:</strong> ${mappedOffices.map(office => escapeHtml(office.office)).join(', ')}.</p>` : ''}</div>
    ${workforce ? `<div class="detail-section"><h3>Publik kedjeprofil</h3><p>${formatIntegerOrDash(workforce.agents)} mäklare i ${formatIntegerOrDash(workforce.offices)} kontor i snapshoten. Kedjeprofilen är separat från juridiskt bokslut.</p></div>` : ''}
    <div class="data-warning"><strong>Ingen systematisk Allabolag-skrapning.</strong><span>Automatiska uppdateringar ska använda Bolagsverkets API eller kontrollerade årsredovisningar.</span></div>`;
}

function financialCoverageNotice(company) {
  const coverage = financialCoverage(company);
  if (coverage.deepAvailable) return `<div class="data-success"><strong>Fördjupad ekonomidata finns.</strong><span>Öppna flikarna för resultat, kostnader, balans och nyckeltal.</span></div>`;
  return `<div class="data-warning"><strong>${coverage.years > 1 ? 'Historiken är på grundnivå.' : 'Endast grunddata är inläst.'}</strong><span>Full resultaträkning, balansräkning och noter fylls på via den officiella bokslutsimporten. Tomma värden uppskattas inte.</span></div>`;
}

function financialInsights(company) {
  const periods = companyHistory(company);
  const latest = periods.at(-1) || {};
  const previous = periods.at(-2);
  const revenueChange = previous ? deltaVs(latest.revenueKsek,previous.revenueKsek) : null;
  const profitChange = previous ? deltaVs(latest.profitKsek,previous.profitKsek) : null;
  const employeeChange = previous && Number.isFinite(latest.employees) && Number.isFinite(previous.employees) ? latest.employees-previous.employees : null;
  return [
    {label:'Omsättningstrend',value:revenueChange===null?'En period':formatSignedPercent(revenueChange),note:previous?`${escapePlainPeriod(previous)} till ${escapePlainPeriod(latest)}`:'Fler år krävs för trend',className:revenueChange===null?'':revenueChange>=0?'positive':'negative'},
    {label:'Resultattrend',value:profitChange===null?'En period':formatSignedPercent(profitChange),note:`Senaste resultat ${formatKsek(latest.profitKsek)}`,className:profitChange===null?'':profitChange>=0?'positive':'negative'},
    {label:'Bemanning',value:formatIntegerOrDash(latest.employees),note:employeeChange===null?'Rapporterade årsanställda':`${employeeChange>=0?'+':''}${employeeChange} mot föregående år`,className:''}
  ];
}

function escapePlainPeriod(period) {
  return String(period.fiscalYear || period.year || 'period');
}

function financialStatementTable(company, lines, options = {}) {
  const periods = companyHistory(company).slice(-5).reverse();
  const hasAny = periods.some(period => lines.some(line => Number.isFinite(period[line.key])));
  if (!periods.length || !hasAny) return `<div class="empty-state">${escapeHtml(options.emptyText || 'De här bokslutsraderna är ännu inte importerade för bolaget.')}</div>`;
  return `<div class="financial-table-wrap"><table class="financial-table">
    <thead><tr><th>Post</th>${periods.map(period => `<th>${escapeHtml(period.fiscalYear || String(period.year))}</th>`).join('')}</tr></thead>
    <tbody>${lines.map(line => {
      const formatter = line.format || options.valueFormatter || formatKsek;
      return `<tr class="${line.emphasis?'emphasis':''}"><th>${escapeHtml(line.label)}</th>${periods.map(period => `<td>${formatter(period[line.key])}</td>`).join('')}</tr>`;
    }).join('')}</tbody>
  </table></div>`;
}

function companyFinancialSources(company) {
  const seen = new Set();
  return companyHistory(company).slice().reverse().map(period => ({
    period:period.fiscalYear || String(period.year),
    label:period.source || 'Publikt bokslut',
    url:period.sourceUrl || company.allabolagUrl || '',
    meta:period.sourceDocumentId
      ? `Registrerad ${period.registeredAt || 'datum saknas'} · Bolagsverket-ID ${period.sourceDocumentId}`
      : period.retrievedAt ? `Hämtad ${period.retrievedAt}` : ''
  })).filter(source => {
    const key=`${source.period}|${source.url}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function formatShareOfRevenue(value,revenue) {
  return Number.isFinite(value) && Number.isFinite(revenue) && revenue ? `${formatPercent(Math.abs(value)/Math.abs(revenue))} av omsättningen` : 'Detalj saknas';
}

function formatPercentNumber(value) {
  return Number.isFinite(value) ? `${oneDecimalFormatter.format(value)} %` : '—';
}

function formatDecimalOrDash(value) {
  return Number.isFinite(value) ? formatDecimal(value,1) : '—';
}

function historyChart(company) {
  const rows=companyHistory(company);
  if (!rows.length) return '<div class="empty-state compact">Ingen verifierad historik.</div>';
  const maxRevenue=Math.max(...rows.map(x=>number(x.revenueKsek)),1);
  const maxProfit=Math.max(...rows.map(x=>Math.max(0,number(x.profitKsek))),1);
  const first=rows[0],last=rows.at(-1);
  const revGrowth=rows.length>1?deltaVs(last.revenueKsek,first.revenueKsek):null;
  const employeeChange=rows.length>1 && Number.isFinite(first.employees)&&Number.isFinite(last.employees)?last.employees-first.employees:null;
  return `<div class="history-wrap"><div class="history-summary"><div><span>Omsättning sedan ${first.year}</span><strong>${revGrowth===null?'—':formatSignedPercent(revGrowth)}</strong></div><div><span>Senaste marginal</span><strong>${formatPercent(last.margin)}</strong></div><div><span>Anställda</span><strong>${formatIntegerOrDash(last.employees)}${employeeChange===null?'':` (${employeeChange>=0?'+':''}${employeeChange})`}</strong></div></div><div class="history-chart">${rows.map(row=>`<div class="history-year"><div class="history-bars"><div class="history-bar revenue" style="--h:${Math.max(5,number(row.revenueKsek)/maxRevenue*100)}%"><span>${formatMsek(row.revenueKsek)}</span></div><div class="history-bar profit ${number(row.profitKsek)<0?'negative':''}" style="--h:${Math.max(3,Math.abs(number(row.profitKsek))/maxProfit*65)}%"><span>${formatMsek(row.profitKsek)}</span></div></div><strong>${row.year}</strong><small>${formatIntegerOrDash(row.employees)} anst.</small></div>`).join('')}</div><div class="history-legend"><span><i class="revenue"></i>Omsättning</span><span><i class="profit"></i>Resultat efter finansnetto</span></div></div>`;
}

function metricValues(key) { return financialCompanies().map(c=>c[key]).filter(Number.isFinite).sort((a,b)=>a-b); }
function medianMetric(key) { const values=metricValues(key); return quantile(values,.5); }
function benchmarkMetrics() {
  const eo=benchmarkCompany();
  const sizePeers=financialCompanies().filter(c=>Number.isFinite(c.employees)&&c.employees>=Math.max(3,eo.employees*.5)&&c.employees<=eo.employees*2);
  return [
    {key:'profitPerEmployeeKsek',label:'Vinst / anställd',format:formatKsek},
    {key:'revenuePerEmployeeKsek',label:'Omsättning / anställd',format:formatKsek},
    {key:'margin',label:'Vinstmarginal',format:formatPercent}
  ].map(m=>{const values=metricValues(m.key),eoValue=eo[m.key];return {...m,eo:eoValue,median:quantile(values,.5),q75:quantile(values,.75),peerMedian:quantile(sizePeers.map(c=>c[m.key]).filter(Number.isFinite).sort((a,b)=>a-b),.5),rank:rankBy(m.key,true).findIndex(c=>c.id===eo.id)+1,count:values.length,percentile:Math.round(percentileRank(eoValue,values)*100)};});
}
function benchmarkMatrixCard(m) { const delta=deltaVs(m.eo,m.median); return `<article class="benchmark-cell"><div><span>${escapeHtml(m.label)}</span><strong>${m.format(m.eo)}</strong></div><div class="benchmark-lines"><p><span>Median</span><b>${m.format(m.median)}</b><em class="${delta===null?'':delta>=0?'positive':'negative'}">${formatSignedPercent(delta)}</em></p><p><span>Topp 25 %</span><b>${m.format(m.q75)}</b></p><p><span>Liknande storlek</span><b>${m.format(m.peerMedian)}</b></p></div><footer><span>#${m.rank} av ${m.count}</span><strong>${m.percentile}:e percentilen</strong></footer></article>`; }

function pressureItem(company,signal){return `<button class="signal-item" data-company-id="${company.id}" style="width:100%;text-align:left;color:inherit"><div><strong>${escapeHtml(company.brand)} · ${escapeHtml(company.office||'')}</strong><span>${escapeHtml(signal.reasons.slice(0,2).join(' · '))}</span></div><span class="badge ${signalBadgeClass(signal.level)}">${signal.score}</span></button>`;}
function pressureCard(company,signal){return `<button class="pressure-card" data-company-id="${company.id}"><div class="pressure-score ${signal.level.toLowerCase()}"><strong>${signal.score}</strong><span>press</span></div><div><h4>${escapeHtml(company.brand)} · ${escapeHtml(company.office||company.legalName)}</h4><p>${escapeHtml(signal.reasons.slice(0,3).join(' · '))}</p><small>${signal.coverage}% datatäckning · ${escapeHtml(company.fiscalYear||'år saknas')}</small></div></button>`;}

function candidateStatuses(){return ['Identifierad','Intressant','Kontakt planerad','Kontaktad','Första möte','Dialog pågår','Erbjudande','Rekryterad','Inte aktuell'];}
function normalizeCandidateStatus(status=''){const map={'Research':'Identifierad','Dialog':'Dialog pågår','Möte bokat':'Första möte'};const value=map[status]||status||'Identifierad';return candidateStatuses().includes(value)?value:'Identifierad';}
function scoreSelect(name,label,value,weight){return `<label class="score-select"><span>${label}<small>${weight}%</small></span><select name="${name}">${[0,1,2,3,4,5].map(v=>`<option value="${v}" ${number(value)===v?'selected':''}>${v}${v===0?' · ej bedömd':''}</option>`).join('')}</select></label>`;}
function candidateAssessment(candidate){
  const f=candidate.factors||{};
  const assessed=Object.entries(CANDIDATE_WEIGHTS).filter(([k])=>number(f[k])>0);
  const assessedWeight=assessed.reduce((sum,[,w])=>sum+w,0);
  const weighted=assessed.reduce((sum,[k,w])=>sum+number(f[k])/5*w,0);
  return {score:assessedWeight?Math.round(weighted/assessedWeight*100):0,coverage:assessedWeight,assessedCount:assessed.length,complete:assessed.length===Object.keys(CANDIDATE_WEIGHTS).length};
}
function candidateScore(candidate){return candidateAssessment(candidate).score;}
function candidatePriorityScore(candidate){const a=candidateAssessment(candidate);return Math.round(a.score*a.coverage/100);}
function candidateScoreBreakdown(candidate){const f=candidate.factors||{};const labels={localPresence:'Lokal',activity:'Aktivitet',reviews:'Omdömen',areaFit:'Områdesmatch',experience:'Erfarenhet'};const a=candidateAssessment(candidate);return `<div class="score-breakdown">${Object.entries(labels).map(([k,l])=>`<span title="${l}: ${number(f[k])}/5"><i style="--w:${number(f[k])/5*100}%"></i>${l}</span>`).join('')}</div><p class="score-coverage">${a.assessedCount}/5 faktorer bedömda · ${a.coverage}% av viktningen täckt${a.complete?'':' · preliminär score'}</p>`;}
function candidateAttention(candidate){const today=new Date();today.setHours(0,0,0,0);const d=candidate.nextActionDate?new Date(candidate.nextActionDate+'T00:00:00'):null;const closed=['Rekryterad','Inte aktuell'].includes(normalizeCandidateStatus(candidate.status));const days=d?Math.round((d-today)/86400000):null;const missingOwner=!candidate.owner||candidate.owner==='Ej fördelad';const missingPlan=!closed&&(!String(candidate.nextAction||'').trim()||!d);return {overdue:!closed&&Boolean(d)&&days<0,dueSoon:!closed&&Boolean(d)&&days>=0&&days<=7,urgent:!closed&&((Boolean(d)&&days<=7)||missingOwner||missingPlan),missingOwner,missingPlan,days};}
function pipelineSorted(){return [...state.pipeline].sort((a,b)=>{const aa=candidateAttention(a),bb=candidateAttention(b);if(aa.overdue!==bb.overdue)return aa.overdue?-1:1;if(aa.urgent!==bb.urgent)return aa.urgent?-1:1;const ad=a.nextActionDate||'9999-12-31',bd=b.nextActionDate||'9999-12-31';if(ad!==bd)return ad.localeCompare(bd);return candidatePriorityScore(b)-candidatePriorityScore(a);});}
function candidateFocusItem(c){const a=candidateAttention(c),assessment=candidateAssessment(c);return `<button class="focus-item" data-edit-candidate="${escapeAttr(c.id)}"><div><strong>${escapeHtml(c.name)}</strong><span>${escapeHtml(c.nextAction||'Nästa aktivitet saknas')} · ${escapeHtml(c.owner||'Ej fördelad')}</span></div><div><b class="${a.overdue?'negative':a.dueSoon||a.missingPlan?'warning':''}">${c.nextActionDate?formatDate(c.nextActionDate):'Datum saknas'}</b><small>${assessment.assessedCount?`${assessment.score} p${assessment.complete?'':' · prelim.'}`:'Ej bedömd'}</small></div></button>`;}

function defaultAreas(){return JSON.parse(JSON.stringify(state.data.marketAreas||[]));}
function sanitizeAreaId(value,fallback){const cleaned=String(value||'').replace(/[^a-zA-Z0-9._:-]/g,'-').replace(/-+/g,'-').slice(0,90);return cleaned||fallback;}
function sanitizeArea(raw,index=0){
  if(!raw||typeof raw.name!=='string'||!raw.name.trim())return null;
  const id=sanitizeAreaId(raw.id,`area-${index}-${Date.now()}`);
  const target=parseOptionalNumber(raw.targetShare);
  const entries=Array.isArray(raw.entries)?raw.entries.map((e,i)=>{const share=parseOptionalNumber(e?.sharePct);if(share===null||share<0||share>100)return null;return {id:sanitizeAreaId(e.id,`${id}-entry-${i}`),period:String(e.period||'Period saknas').slice(0,120),eoSales:parseOptionalNumber(e.eoSales),marketSales:parseOptionalNumber(e.marketSales),sharePct:share,source:String(e.source||'Källa saknas').slice(0,240),sourceUrl:String(e.sourceUrl||'').slice(0,1000),asOf:/^\d{4}-\d{2}-\d{2}$/.test(String(e.asOf||''))?String(e.asOf):'',createdAt:String(e.createdAt||'')};}).filter(Boolean):[];
  return {id,name:raw.name.trim().slice(0,120),targetShare:target!==null&&target>=0&&target<=100?target:null,entries};
}
function loadAreas(){
  const defaults=defaultAreas().map(sanitizeArea).filter(Boolean);
  try{
    const saved=JSON.parse(localStorage.getItem(AREA_KEY));
    const clean=Array.isArray(saved)?saved.map(sanitizeArea).filter(Boolean):[];
    const ids=new Set(clean.map(a=>a.id));
    return [...clean,...defaults.filter(a=>!ids.has(a.id))];
  }catch{return defaults;}
}
function saveAreas(){try{localStorage.setItem(AREA_KEY,JSON.stringify(state.areas));}catch{}}
function areaEntries(area){return [...(Array.isArray(area.entries)?area.entries:[])].sort((a,b)=>(a.asOf||'').localeCompare(b.asOf||''));}
function areaLatest(area){return areaEntries(area).at(-1)||null;}
function areaPortfolioSummary(){const latest=state.areas.map(areaLatest).filter(Boolean);const core=state.areas.find(a=>a.id==='core')||state.areas[0];const coreEntries=core?areaEntries(core):[];const coreLatest=coreEntries.at(-1),corePrior=coreEntries.at(-2);const now=new Date();const stale=state.areas.filter(a=>{const e=areaLatest(a);if(!e||!e.asOf)return true;return (now-new Date(e.asOf+'T00:00:00'))/86400000>120;}).length;return {withData:latest.length,stale,belowTarget:state.areas.filter(a=>Number.isFinite(a.targetShare)&&areaLatest(a)&&areaLatest(a).sharePct<a.targetShare).length,coreShare:coreLatest?.sharePct,coreChange:coreLatest&&corePrior?coreLatest.sharePct-corePrior.sharePct:null};}
function areaForm(){return `<form id="areaForm"><div class="form-grid area-form-grid">${field('areaId','Område',`<select id="areaId" name="areaId"><option value="new">+ Nytt område</option>${state.areas.map(a=>`<option value="${escapeAttr(a.id)}">${escapeHtml(a.name)}</option>`).join('')}</select>`)}${field('newAreaName','Nytt områdesnamn',`<input id="newAreaName" name="newAreaName" placeholder="Används endast vid Nytt område">`)}${field('areaPeriod','Period',`<input id="areaPeriod" name="period" required placeholder="Q2 2026 eller senaste 12 mån">`)}${field('areaAsOf','Mätdatum',`<input id="areaAsOf" name="asOf" type="date" value="${new Date().toISOString().slice(0,10)}">`)}${field('areaEoSales','EO-affärer',`<input id="areaEoSales" name="eoSales" type="number" min="0" placeholder="Ex. 18">`)}${field('areaMarketSales','Marknad totalt',`<input id="areaMarketSales" name="marketSales" type="number" min="1" placeholder="Ex. 30">`)}${field('areaSharePct','Alternativ: verifierad andel %',`<input id="areaSharePct" name="sharePct" type="number" min="0" max="100" step="0.1" placeholder="Ex. 60">`)}${field('areaTargetShare','Eget mål %',`<input id="areaTargetShare" name="targetShare" type="number" min="0" max="100" step="0.1" placeholder="Valfritt">`)}${field('areaSource','Källa',`<input id="areaSource" name="source" required placeholder="Vitec, Booli-export, intern rapport…">`,'full')}${field('areaSourceUrl','Källänk',`<input id="areaSourceUrl" name="sourceUrl" type="url" placeholder="https://… (valfritt)">`,'full')}</div><div class="form-actions"><button class="button button-accent" type="submit">Spara period</button></div></form>`;}
function areaCard(area){const entries=areaEntries(area),latest=entries.at(-1),prior=entries.at(-2),change=latest&&prior?latest.sharePct-prior.sharePct:null;return `<article class="area-card ${latest?'':'empty'}"><div class="area-card-head"><div><h3>${escapeHtml(area.name)}</h3><p>${latest?escapeHtml(latest.period):'Ingen registrerad period'}</p></div><div class="share-orb ${change!==null&&change<0?'down':''}"><strong>${latest?formatPercentValue(latest.sharePct):'—'}</strong><span>EO-andel</span></div></div>${latest?`<div class="area-kpis"><div><span>Förändring</span><strong>${change===null?'—':formatSignedPercentagePoints(change)}</strong></div><div><span>EO / marknad</span><strong>${Number.isFinite(latest.eoSales)&&Number.isFinite(latest.marketSales)?`${latest.eoSales} / ${latest.marketSales}`:'Andel angiven'}</strong></div><div><span>Mål</span><strong>${Number.isFinite(area.targetShare)?formatPercentValue(area.targetShare):'Ej satt'}</strong></div></div><div class="area-history">${entries.map(e=>`<div><span>${escapeHtml(e.period)}</span><b>${formatPercentValue(e.sharePct)}</b><small>${escapeHtml(e.source||'Källa saknas')}</small>${e.sourceUrl?`<a href="${safeUrl(e.sourceUrl)}" target="_blank" rel="noopener">Källa ↗</a>`:''}<button data-delete-area-entry="${escapeAttr(e.id)}" data-area-id="${escapeAttr(area.id)}" aria-label="Ta bort perioden">×</button></div>`).join('')}</div>`:'<div class="empty-state compact">Lägg in verifierade affärer eller procentandel.</div>'}</article>`;}
function areaSnapshotGrid(){const areas=state.areas.filter(a=>areaLatest(a)).slice(0,4);return `<div class="area-snapshot-grid">${areas.map(a=>{const e=areaLatest(a),rows=areaEntries(a),p=rows.at(-2),change=p?e.sharePct-p.sharePct:null;return `<button data-nav="areas"><span>${escapeHtml(a.name)}</span><strong>${formatPercentValue(e.sharePct)}</strong><small>${change===null?'En period':formatSignedPercentagePoints(change)}</small></button>`;}).join('')||'<div class="empty-state compact">Ingen områdesdata registrerad.</div>'}</div>`;}
function exportAreas(){downloadText(JSON.stringify({exportedAt:new Date().toISOString(),areas:state.areas},null,2),'maklarspaning-omraden.json','application/json');}
async function importAreas(file){try{const p=JSON.parse(await file.text());const rows=Array.isArray(p)?p:p.areas;if(!Array.isArray(rows))throw new Error('Filen saknar områden.');const clean=rows.map(sanitizeArea).filter(Boolean);if(!clean.length)throw new Error('Inga giltiga områden hittades.');state.areas=clean;saveAreas();renderApp();toast(`${clean.length} områden importerades.`);}catch(error){toast(`Import misslyckades: ${error.message}`);}}

function quantile(sorted,q){if(!sorted.length)return null;const pos=(sorted.length-1)*q,base=Math.floor(pos),rest=pos-base;return sorted[base+1]!==undefined?sorted[base]+rest*(sorted[base+1]-sorted[base]):sorted[base];}
function deltaVs(value,base){return Number.isFinite(value)&&Number.isFinite(base)&&base!==0?(value-base)/Math.abs(base):null;}
function parseOptionalNumber(value){if(value===null||value===undefined||String(value).trim()==='')return null;const n=Number(String(value).replace(',','.'));return Number.isFinite(n)?n:null;}
function slugify(v){return String(v).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,'-').replace(/(^-|-$)/g,'');}
function formatSignedPercent(v){return Number.isFinite(v)?`${v>=0?'+':''}${formatPercent(v)}`:'—';}
function formatPercentValue(v){return Number.isFinite(v)?`${oneDecimalFormatter.format(v)} %`:'—';}
function formatSignedPercentagePoints(v){return Number.isFinite(v)?`${v>=0?'+':''}${oneDecimalFormatter.format(v)} procentenheter`:'—';}
function formatDate(value){try{return new Intl.DateTimeFormat('sv-SE',{day:'numeric',month:'short',year:'numeric'}).format(value instanceof Date?value:new Date(value));}catch{return String(value||'');}}

function exportCompaniesCsv() {
  const rows = filteredCompanies();
  const headers = ['Kedja','Kontor','Juridiskt bolag','Org.nr','Bokslut','Omsättning tkr','Resultat tkr','Anställda','Marginal','Oms/anst tkr','Vinst/anst tkr','Bevakningssignal'];
  const body = rows.map(c => [c.brand,c.office,c.legalName,c.orgNo,c.fiscalYear,c.revenueKsek,c.profitKsek,c.employees,c.margin,c.revenuePerEmployeeKsek,c.profitPerEmployeeKsek,pressureSignal(c).score]);
  downloadText('\ufeff' + [headers,...body].map(row => row.map(csvCell).join(';')).join('\n'), 'maklarbolag-goteborg.csv', 'text/csv;charset=utf-8');
}

function exportPipeline() {
  const payload = { exportedAt: new Date().toISOString(), app: state.data.meta.title, version:APP_VERSION, candidates: state.pipeline };
  downloadText(JSON.stringify(payload,null,2),'maklarspaning-pipeline.json','application/json');
}

function sanitizeCandidateFactors(raw){return Object.fromEntries(Object.keys(CANDIDATE_WEIGHTS).map(k=>[k,Math.max(0,Math.min(5,number(raw?.[k])))]));}
function sanitizeIsoDate(value){const text=String(value||'');return /^\d{4}-\d{2}-\d{2}$/.test(text)&&!Number.isNaN(new Date(text+'T00:00:00').getTime())?text:'';}
async function importPipeline(file) {
  try {
    const parsed = JSON.parse(await file.text());
    const candidates = Array.isArray(parsed) ? parsed : parsed.candidates;
    if (!Array.isArray(candidates)) throw new Error('Filen saknar kandidatlista.');
    const cleaned = candidates.filter(c => c && typeof c.name === 'string' && c.name.trim()).map(c => ({
      id: sanitizeAreaId(c.id, crypto.randomUUID ? crypto.randomUUID() : String(Date.now()+Math.random())),
      name: c.name.trim(), brand: String(c.brand || ''), office: String(c.office || ''), owner:String(c.owner||'Ej fördelad'),
      status: normalizeCandidateStatus(c.status), nextAction:String(c.nextAction||''), nextActionDate:sanitizeIsoDate(c.nextActionDate),
      factors:sanitizeCandidateFactors(c.factors), url: String(c.url || ''), notes: String(c.notes || ''),
      createdAt: c.createdAt || new Date().toISOString(), updatedAt: new Date().toISOString()
    }));
    state.pipeline = cleaned;
    savePipeline(); renderApp(); toast(`${cleaned.length} kandidater importerades.`);
  } catch (error) { toast(`Import misslyckades: ${error.message}`); }
}

function downloadText(content, filename, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 500);
}

function csvCell(value) {
  if (value == null) return '';
  const text = String(value).replace(/"/g,'""');
  return /[;"\n]/.test(text) ? `"${text}"` : text;
}

function loadPipeline() {
  try {
    const value = JSON.parse(localStorage.getItem(PIPELINE_KEY));
    if (!Array.isArray(value)) return [];
    return value.filter(c=>c&&typeof c.name==='string'&&c.name.trim()).map(c=>({ ...c, id:sanitizeAreaId(c.id, crypto.randomUUID ? crypto.randomUUID() : String(Date.now()+Math.random())), owner:c.owner||'Ej fördelad', status:normalizeCandidateStatus(c.status), nextAction:String(c.nextAction||''), nextActionDate:sanitizeIsoDate(c.nextActionDate), factors:sanitizeCandidateFactors(c.factors) }));
  } catch { return []; }
}
function savePipeline() { try{localStorage.setItem(PIPELINE_KEY, JSON.stringify(state.pipeline));}catch{} }
function persistState() {
  try { localStorage.setItem(APP_STATE_KEY, JSON.stringify({ view:state.view, selectedWorkforceBrand:state.selectedWorkforceBrand })); } catch {}
}
function restoreState() {
  try {
    const saved = JSON.parse(localStorage.getItem(APP_STATE_KEY));
    if (NAV_ITEMS.some(item=>item.id===saved?.view)) state.view = saved.view;
    if (typeof saved?.selectedWorkforceBrand==='string') state.selectedWorkforceBrand = saved.selectedWorkforceBrand;
  } catch {}
}

async function installApp() {
  if (!state.deferredInstallPrompt) {
    toast('På iPhone: Dela → Lägg till på hemskärmen.');
    return;
  }
  state.deferredInstallPrompt.prompt();
  await state.deferredInstallPrompt.userChoice;
  state.deferredInstallPrompt = null;
  els.installButton.hidden = true;
}

function registerServiceWorker() {
  if (!('serviceWorker' in navigator) || !location.protocol.startsWith('http')) return;
  const hadController = Boolean(navigator.serviceWorker.controller);
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (hadController && !serviceWorkerRefreshing) { serviceWorkerRefreshing = true; window.location.reload(); }
  });
  navigator.serviceWorker.register('./sw.js').catch(console.warn);
}

function updateOnlineStatus() {
  els.offlineBanner.hidden = navigator.onLine;
}

let toastTimer;
function toast(message) {
  els.toast.textContent = message;
  els.toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => els.toast.classList.remove('show'), 2600);
}

function sum(items,key) { return items.reduce((total,item) => total + (Number.isFinite(item[key]) ? item[key] : 0),0); }
function number(value) { const n = Number(value); return Number.isFinite(n) ? n : 0; }
function unique(values) { return [...new Set(values)].sort((a,b) => a.localeCompare(b,'sv')); }
function normalizeConfidence(value='') {
  const text = String(value).toLowerCase();
  if (text.includes('hög')) return 'Hög';
  if (text.includes('låg')) return 'Låg';
  return 'Medel';
}

const integerFormatter = new Intl.NumberFormat('sv-SE',{maximumFractionDigits:0});
const oneDecimalFormatter = new Intl.NumberFormat('sv-SE',{minimumFractionDigits:1,maximumFractionDigits:1});
const sekFormatter = new Intl.NumberFormat('sv-SE',{style:'currency',currency:'SEK',maximumFractionDigits:0});
function formatInteger(value) { return integerFormatter.format(number(value)); }
function formatIntegerOrDash(value) { return Number.isFinite(value) ? integerFormatter.format(value) : '—'; }
function formatDecimal(value,digits=1) { return new Intl.NumberFormat('sv-SE',{minimumFractionDigits:digits,maximumFractionDigits:digits}).format(number(value)); }
function formatPercent(value) { return Number.isFinite(value) ? oneDecimalFormatter.format(value*100)+' %' : '—'; }
function formatKsek(value) { return Number.isFinite(value) ? `${integerFormatter.format(value)} tkr` : '—'; }
function formatMsek(value) { return Number.isFinite(value) ? `${oneDecimalFormatter.format(value/1000)} mkr` : '—'; }
function formatSek(value) { return Number.isFinite(value) ? sekFormatter.format(value) : '—'; }

function isLikelyStaffUrl(url='') {
  try { const path=new URL(url,location.href).pathname.toLowerCase(); return /(maklare|mäklare|hitta-maklare|maklarbyra|fastighetsmaklare|team|medarbetare|people)/.test(path); } catch { return false; }
}
function safeUrl(url='') {
  try { const parsed = new URL(url,location.href); return ['http:','https:'].includes(parsed.protocol) ? parsed.href : '#'; }
  catch { return '#'; }
}
function cssEscape(value) {
  if (window.CSS && typeof window.CSS.escape === 'function') return window.CSS.escape(String(value));
  return String(value).replace(/[^a-zA-Z0-9_-]/g, char => `\\${char}`);
}

function escapeHtml(value='') { return String(value).replace(/[&<>'"]/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char])); }
function escapeAttr(value='') { return escapeHtml(value); }
