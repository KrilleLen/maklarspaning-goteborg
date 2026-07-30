import fs from 'node:fs/promises';

const inputPath = process.argv[2];
const appDataPath = process.argv[3] || 'site/data/app-data.json';

if (!inputPath) {
  console.error('Användning: node scripts/import-financials.mjs <normaliserad-import.json> [app-data.json]');
  process.exit(1);
}

const [payload, appData] = await Promise.all([
  fs.readFile(inputPath, 'utf8').then(JSON.parse),
  fs.readFile(appDataPath, 'utf8').then(JSON.parse)
]);

if (!payload.source || !/^\d{4}-\d{2}-\d{2}$/.test(payload.retrievedAt || '') || !Array.isArray(payload.companies)) {
  throw new Error('Importfilen måste innehålla source, retrievedAt och companies.');
}

const companyByOrgNo = new Map(appData.companies.map(company => [digits(company.orgNo),company]));
let matched = 0;
let importedPeriods = 0;
const unmatched = [];

for (const incoming of payload.companies) {
  const company = companyByOrgNo.get(digits(incoming.orgNo));
  if (!company) {
    unmatched.push(incoming.orgNo);
    continue;
  }
  matched += 1;
  const byPeriod = new Map((company.history || []).map(period => [period.fiscalYear,{...period}]));
  const previousSnapshot = snapshotPeriod(company,appData.meta);
  if (previousSnapshot && !byPeriod.has(previousSnapshot.fiscalYear)) {
    byPeriod.set(previousSnapshot.fiscalYear,previousSnapshot);
  }
  for (const rawPeriod of incoming.periods || []) {
    if (!/^\d{4}-\d{2}$/.test(rawPeriod.fiscalYear || '')) {
      throw new Error(`${incoming.orgNo}: ogiltig fiscalYear ${rawPeriod.fiscalYear || '(tom)'}`);
    }
    const clean = cleanPeriod(rawPeriod,payload);
    const existing = byPeriod.get(clean.fiscalYear) || {};
    const base = clean.sourceDocumentId ? withoutFinancialValues(existing) : existing;
    byPeriod.set(clean.fiscalYear,{...base,...clean});
    importedPeriods += 1;
  }
  company.history = [...byPeriod.values()].sort((a,b) => a.fiscalYear.localeCompare(b.fiscalYear));
  const latest = company.history.at(-1);
  if (latest) updateCompanySnapshot(company,latest);
}

appData.meta.financialDataUpdatedAt = payload.retrievedAt;
appData.meta.financialDataSource = payload.source;
appData.meta.financialSchemaVersion = 1;
await fs.writeFile(appDataPath,`${JSON.stringify(appData,null,2)}\n`,'utf8');

console.log(`Importerade ${importedPeriods} perioder till ${matched} bolag.`);
if (unmatched.length) console.warn(`Saknade bolagskoppling för: ${unmatched.join(', ')}`);

function digits(value) {
  return String(value || '').replace(/\D/g,'');
}

function cleanPeriod(period,payloadMeta) {
  const clean = {
    ...period,
    year:Number(period.year || String(period.fiscalYear).slice(0,4)),
    source:period.source || payloadMeta.source,
    retrievedAt:period.retrievedAt || payloadMeta.retrievedAt
  };
  for (const [key,value] of Object.entries(clean)) {
    if ((key.endsWith('Ksek') || ['employees','margin','ebitdaMargin','currentRatioPct','equityRatioPct','debtToEquity','returnOnEquityPct','returnOnAssetsPct','revenuePerEmployeeKsek','profitPerEmployeeKsek'].includes(key)) && value !== null) {
      const parsed = Number(value);
      if (!Number.isFinite(parsed)) throw new Error(`${period.fiscalYear}: ${key} måste vara numeriskt`);
      clean[key] = parsed;
    }
  }
  return clean;
}

function updateCompanySnapshot(company,latest) {
  company.fiscalYear = latest.fiscalYear;
  company.revenueKsek = firstNumber(latest.revenueKsek,latest.netRevenueKsek);
  company.profitKsek = firstNumber(latest.profitAfterFinancialKsek,latest.profitKsek);
  company.ebitdaKsek = firstNumber(latest.ebitdaKsek);
  company.employees = firstNumber(latest.employees);
  company.margin = firstNumber(latest.margin,company.revenueKsek ? company.profitKsek/company.revenueKsek : null);
  company.revenuePerEmployeeKsek = firstNumber(latest.revenuePerEmployeeKsek,company.employees ? company.revenueKsek/company.employees : null);
  company.profitPerEmployeeKsek = firstNumber(latest.profitPerEmployeeKsek,company.employees ? company.profitKsek/company.employees : null);
}

function snapshotPeriod(company,meta = {}) {
  if (!/^\d{4}-\d{2}$/.test(company.fiscalYear || '')) return null;
  const period = {
    year:Number(company.fiscalYear.slice(0,4)),
    fiscalYear:company.fiscalYear,
    source:'Tidigare verifierat publikt bokslut',
    sourceUrl:company.allabolagUrl || null,
    retrievedAt:meta.snapshot || null
  };
  const fields = [
    'revenueKsek','profitKsek','ebitdaKsek','employees','margin',
    'revenuePerEmployeeKsek','profitPerEmployeeKsek'
  ];
  for (const key of fields) {
    if (company[key] !== null && company[key] !== undefined && company[key] !== '') {
      period[key] = company[key];
    }
  }
  if (period.revenueKsek !== undefined) period.netRevenueKsek = period.revenueKsek;
  if (period.profitKsek !== undefined) period.profitAfterFinancialKsek = period.profitKsek;
  return period;
}

function withoutFinancialValues(period) {
  return Object.fromEntries(Object.entries(period).filter(([key]) => {
    if (key.endsWith('Ksek')) return false;
    return ![
      'employees','margin','ebitdaMargin','currentRatioPct','equityRatioPct','debtToEquity',
      'returnOnEquityPct','returnOnAssetsPct','revenuePerEmployeeKsek',
      'profitPerEmployeeKsek','personnelCostPerEmployeeKsek'
    ].includes(key);
  }));
}

function firstNumber(...values) {
  for (const value of values) {
    if (value === null || value === undefined || value === '') continue;
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}
