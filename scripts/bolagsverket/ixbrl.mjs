const SOURCE_LABEL = 'Bolagsverket · digital årsredovisning';
const SOURCE_URL = 'https://bolagsverket.se/apierochoppnadata/hamtaforetagsinformation/vardefulladatamangder/apiforvardefulladatamangder.5513.html';
const ADJUSTED_EQUITY_FACTOR = 0.794;

const CONCEPTS = {
  netRevenueKsek: ['Nettoomsattning'],
  otherRevenueKsek: ['OvrigaRorelseintakter'],
  operatingCostsKsek: ['Rorelsekostnader'],
  depreciationKsek: ['AvskrivningarNedskrivningarMateriellaImmateriellaAnlaggningstillgangar'],
  operatingProfitKsek: ['Rorelseresultat'],
  financialIncomeKsek: [
    'OvrigaRanteintakterLiknandeResultatposter',
    'RanteintakterLiknandeResultatposter'
  ],
  financialCostsKsek: ['RantekostnaderLiknandeResultatposter'],
  profitAfterFinancialKsek: ['ResultatEfterFinansiellaPoster'],
  profitBeforeTaxKsek: ['ResultatForeSkatt'],
  taxKsek: ['SkattAretsResultat'],
  netIncomeKsek: ['AretsResultat'],
  proposedDividendKsek: ['ForslagDispositionUtdelning', 'Utdelning'],
  intangibleAssetsKsek: ['ImmateriellaAnlaggningstillgangar'],
  tangibleAssetsKsek: ['MateriellaAnlaggningstillgangar'],
  financialAssetsKsek: ['FinansiellaAnlaggningstillgangar'],
  fixedAssetsKsek: ['Anlaggningstillgangar'],
  inventoryKsek: ['VarulagerMm'],
  receivablesKsek: ['KortfristigaFordringar'],
  cashKsek: ['KassaBank'],
  currentAssetsKsek: ['Omsattningstillgangar'],
  totalAssetsKsek: ['Tillgangar'],
  equityKsek: ['EgetKapital'],
  untaxedReservesKsek: ['ObeskattadeReserver'],
  provisionsKsek: ['Avsattningar'],
  longTermLiabilitiesKsek: ['LangfristigaSkulder'],
  tradePayablesKsek: ['Leverantorsskulder'],
  currentLiabilitiesKsek: ['KortfristigaSkulder'],
  totalEquityAndLiabilitiesKsek: ['EgetKapitalSkulder'],
  personnelCostsKsek: ['Personalkostnader'],
  externalCostsKsek: ['OvrigaExternaKostnader'],
  employees: ['MedelantaletAnstallda']
};

const COST_FIELDS = new Set([
  'operatingCostsKsek',
  'depreciationKsek',
  'financialCostsKsek',
  'taxKsek',
  'personnelCostsKsek',
  'externalCostsKsek',
  'proposedDividendKsek'
]);

const BALANCE_FIELDS = new Set([
  'intangibleAssetsKsek',
  'tangibleAssetsKsek',
  'financialAssetsKsek',
  'fixedAssetsKsek',
  'inventoryKsek',
  'receivablesKsek',
  'cashKsek',
  'currentAssetsKsek',
  'totalAssetsKsek',
  'equityKsek',
  'untaxedReservesKsek',
  'provisionsKsek',
  'longTermLiabilitiesKsek',
  'tradePayablesKsek',
  'currentLiabilitiesKsek',
  'totalEquityAndLiabilitiesKsek'
]);

export function parseAnnualReportPackage(documents, meta = {}) {
  const candidates = documents
    .filter(document => /\.(xhtml?|xml)$/i.test(document.name || ''))
    .map(document => ({document, report: parseXbrlDocument(document.content)}))
    .filter(candidate => candidate.report.facts.length);

  const wantedOrgNo = digits(meta.orgNo);
  const matching = candidates.filter(candidate => !wantedOrgNo || !candidate.report.orgNo || candidate.report.orgNo === wantedOrgNo);
  const best = (matching.length ? matching : candidates)
    .sort((a, b) => reportScore(b.report, wantedOrgNo) - reportScore(a.report, wantedOrgNo))[0];

  if (!best) return {orgNo: wantedOrgNo, periods: [], warnings: ['Paketet saknar läsbara XBRL-fakta.']};
  const periods = periodsFromReport(best.report, meta);
  const warnings = [];
  if (wantedOrgNo && best.report.orgNo && best.report.orgNo !== wantedOrgNo) {
    warnings.push(`Årsredovisningens organisationsnummer ${best.report.orgNo} matchar inte ${wantedOrgNo}.`);
  }
  if (best.report.currency !== 'SEK') warnings.push(`Valutan ${best.report.currency} stöds inte fullt ut i tkr-vyn.`);
  return {orgNo: best.report.orgNo || wantedOrgNo, periods, warnings};
}

export function parseXbrlDocument(content) {
  const xml = String(content || '');
  const contexts = parseContexts(xml);
  const units = parseUnits(xml);
  const facts = [...parseInstanceFacts(xml), ...parseInlineFacts(xml)]
    .map(fact => normalizeFact(fact, units))
    .filter(fact => fact.localName && fact.contextRef);
  const bestFacts = deduplicateFacts(facts);
  const orgNo = digits(findTextFact(bestFacts, ['Organisationsnummer'])?.rawText);
  const currencyList = findTextFact(bestFacts, ['RedovisningsvalutaHandlingList'])?.rawText || '';
  const currency = /Euro/i.test(currencyList) ? 'EUR' : inferCurrency(bestFacts, units);
  return {contexts, facts: bestFacts, orgNo, currency};
}

export function deriveCrossPeriodRatios(periods) {
  const sorted = periods.slice().sort((a, b) => String(a.endDate || a.fiscalYear).localeCompare(String(b.endDate || b.fiscalYear)));
  for (let index = 0; index < sorted.length; index += 1) {
    const period = sorted[index];
    const previous = sorted[index - 1];
    const adjustedEquity = adjustedEquityValue(period);
    const previousAdjustedEquity = previous ? adjustedEquityValue(previous) : null;
    const averageEquity = average(adjustedEquity, previousAdjustedEquity);
    const averageAssets = average(period.totalAssetsKsek, previous?.totalAssetsKsek);
    if (Number.isFinite(period.netIncomeKsek) && Number.isFinite(averageEquity) && averageEquity !== 0) {
      period.returnOnEquityPct = period.netIncomeKsek / averageEquity * 100;
    }
    const capitalReturn = Number.isFinite(period.profitAfterFinancialKsek)
      ? period.profitAfterFinancialKsek + (Number.isFinite(period.financialCostsKsek) ? period.financialCostsKsek : 0)
      : null;
    if (Number.isFinite(capitalReturn) && Number.isFinite(averageAssets) && averageAssets !== 0) {
      period.returnOnAssetsPct = capitalReturn / averageAssets * 100;
    }
  }
  return sorted;
}

export function periodQuality(period) {
  return Object.keys(period).filter(key => (key.endsWith('Ksek') || key === 'employees') && Number.isFinite(period[key])).length;
}

function periodsFromReport(report, meta) {
  const durationContexts = [...report.contexts.values()]
    .filter(context => context.startDate && context.endDate && !context.dimensional);
  const byPeriod = new Map();
  for (const context of durationContexts) {
    const key = `${context.startDate}|${context.endDate}`;
    const existing = byPeriod.get(key);
    if (!existing || contextFactCount(report.facts, context.id) > contextFactCount(report.facts, existing.id)) {
      byPeriod.set(key, context);
    }
  }

  const periods = [];
  for (const context of byPeriod.values()) {
    const durationFacts = factsForContext(report.facts, context.id);
    if (!hasFinancialAnchor(durationFacts)) continue;
    const instantContextIds = [...report.contexts.values()]
      .filter(candidate => candidate.instant === context.endDate && !candidate.dimensional)
      .map(candidate => candidate.id);
    const period = {
      year: Number(context.endDate.slice(0, 4)),
      fiscalYear: context.endDate.slice(0, 7),
      startDate: context.startDate,
      endDate: context.endDate,
      currency: report.currency,
      source: SOURCE_LABEL,
      sourceUrl: meta.sourceUrl || SOURCE_URL,
      sourceDocumentId: meta.sourceDocumentId || null,
      registeredAt: dateOnly(meta.registeredAt),
      retrievedAt: meta.retrievedAt || new Date().toISOString().slice(0, 10),
      isPrimaryPeriod: !meta.reportingPeriodEnd || context.endDate === dateOnly(meta.reportingPeriodEnd)
    };

    for (const [field, conceptNames] of Object.entries(CONCEPTS)) {
      const contextIds = BALANCE_FIELDS.has(field) ? instantContextIds : [context.id];
      const fact = bestConceptFact(report.facts, conceptNames, contextIds);
      if (!fact || !Number.isFinite(fact.numericValue)) continue;
      let value = field === 'employees' ? fact.numericValue : fact.numericValue / 1000;
      if (COST_FIELDS.has(field)) value = Math.abs(value);
      period[field] = value;
    }

    period.revenueKsek = firstNumber(period.netRevenueKsek);
    period.profitKsek = firstNumber(period.profitAfterFinancialKsek, period.profitBeforeTaxKsek);
    if (Number.isFinite(period.operatingProfitKsek) && Number.isFinite(period.depreciationKsek)) {
      period.ebitdaKsek = period.operatingProfitKsek + period.depreciationKsek;
    }
    addSinglePeriodRatios(period);
    periods.push(removeNullish(period));
  }
  return periods.sort((a, b) => a.fiscalYear.localeCompare(b.fiscalYear));
}

function addSinglePeriodRatios(period) {
  if (positive(period.revenueKsek)) {
    if (Number.isFinite(period.profitKsek)) period.margin = period.profitKsek / period.revenueKsek;
    if (Number.isFinite(period.ebitdaKsek)) period.ebitdaMargin = period.ebitdaKsek / period.revenueKsek;
  }
  if (positive(period.employees)) {
    if (Number.isFinite(period.revenueKsek)) period.revenuePerEmployeeKsek = period.revenueKsek / period.employees;
    if (Number.isFinite(period.profitKsek)) period.profitPerEmployeeKsek = period.profitKsek / period.employees;
    if (Number.isFinite(period.personnelCostsKsek)) period.personnelCostPerEmployeeKsek = period.personnelCostsKsek / period.employees;
  }
  if (positive(period.currentLiabilitiesKsek) && Number.isFinite(period.currentAssetsKsek)) {
    const liquidCurrentAssets = period.currentAssetsKsek - (Number.isFinite(period.inventoryKsek) ? period.inventoryKsek : 0);
    period.currentRatioPct = liquidCurrentAssets / period.currentLiabilitiesKsek * 100;
  }
  const adjustedEquity = adjustedEquityValue(period);
  if (positive(period.totalAssetsKsek) && Number.isFinite(adjustedEquity)) {
    period.equityRatioPct = adjustedEquity / period.totalAssetsKsek * 100;
  }
  const debt = sumFinite(period.provisionsKsek, period.longTermLiabilitiesKsek, period.currentLiabilitiesKsek);
  if (positive(adjustedEquity) && Number.isFinite(debt)) period.debtToEquity = debt / adjustedEquity;
}

function parseContexts(xml) {
  const contexts = new Map();
  const expression = /<(?:xbrli:)?context\b([^>]*)>([\s\S]*?)<\/(?:xbrli:)?context>/gi;
  for (const match of xml.matchAll(expression)) {
    const attrs = parseAttributes(match[1]);
    const id = attrs.id;
    if (!id) continue;
    const body = match[2];
    contexts.set(id, {
      id,
      startDate: tagText(body, 'startDate'),
      endDate: tagText(body, 'endDate'),
      instant: tagText(body, 'instant'),
      dimensional: /<(?:xbrli:)?(?:segment|scenario)\b/i.test(body)
    });
  }
  return contexts;
}

function parseUnits(xml) {
  const units = new Map();
  const expression = /<(?:xbrli:)?unit\b([^>]*)>([\s\S]*?)<\/(?:xbrli:)?unit>/gi;
  for (const match of xml.matchAll(expression)) {
    const attrs = parseAttributes(match[1]);
    const measure = tagText(match[2], 'measure');
    if (attrs.id && measure) units.set(attrs.id, measure.split(':').at(-1).toUpperCase());
  }
  return units;
}

function parseInstanceFacts(xml) {
  const facts = [];
  const expression = /<((?:se-[\w.-]+):([\w.-]+))\b([^>]*)>([\s\S]*?)<\/\1>/gi;
  for (const match of xml.matchAll(expression)) {
    const attrs = parseAttributes(match[3]);
    if (!attrs.contextRef) continue;
    facts.push({
      qName: match[1],
      localName: match[2],
      contextRef: attrs.contextRef,
      unitRef: attrs.unitRef,
      decimals: attrs.decimals,
      scale: attrs.scale,
      sign: attrs.sign,
      format: attrs.format,
      rawText: cleanText(match[4]),
      sourceKind: 'xbrl'
    });
  }
  return facts;
}

function parseInlineFacts(xml) {
  const facts = [];
  const expression = /<ix:(nonFraction|nonNumeric)\b([^>]*)>([\s\S]*?)<\/ix:\1>/gi;
  for (const match of xml.matchAll(expression)) {
    const attrs = parseAttributes(match[2]);
    const qName = attrs.name || '';
    const localName = qName.split(':').at(-1);
    if (!localName || !attrs.contextRef) continue;
    facts.push({
      qName,
      localName,
      contextRef: attrs.contextRef,
      unitRef: attrs.unitRef,
      decimals: attrs.decimals,
      scale: attrs.scale,
      sign: attrs.sign,
      format: attrs.format,
      rawText: cleanText(match[3]),
      sourceKind: match[1]
    });
  }
  return facts;
}

function normalizeFact(fact, units) {
  const numericValue = fact.sourceKind === 'nonNumeric' || !fact.unitRef
    ? parseMaybeNumeric(fact.rawText, fact)
    : parseNumeric(fact.rawText, fact);
  return {
    ...fact,
    currency: units.get(fact.unitRef) || null,
    numericValue,
    precision: precisionScore(fact.decimals)
  };
}

function deduplicateFacts(facts) {
  const selected = new Map();
  for (const fact of facts) {
    const key = `${fact.localName}|${fact.contextRef}`;
    const existing = selected.get(key);
    if (!existing || fact.precision > existing.precision || (fact.precision === existing.precision && fact.sourceKind === 'xbrl')) {
      selected.set(key, fact);
    }
  }
  return [...selected.values()];
}

function bestConceptFact(facts, conceptNames, contextIds) {
  const allowed = new Set(contextIds);
  return facts
    .filter(fact => allowed.has(fact.contextRef) && conceptNames.includes(fact.localName) && Number.isFinite(fact.numericValue))
    .sort((a, b) => conceptNames.indexOf(a.localName) - conceptNames.indexOf(b.localName) || b.precision - a.precision)[0];
}

function findTextFact(facts, conceptNames) {
  return facts.find(fact => conceptNames.includes(fact.localName));
}

function factsForContext(facts, contextId) {
  return facts.filter(fact => fact.contextRef === contextId);
}

function hasFinancialAnchor(facts) {
  return facts.some(fact => ['Nettoomsattning', 'ResultatEfterFinansiellaPoster', 'ResultatForeSkatt', 'AretsResultat'].includes(fact.localName));
}

function contextFactCount(facts, contextId) {
  return facts.filter(fact => fact.contextRef === contextId && Object.values(CONCEPTS).flat().includes(fact.localName)).length;
}

function reportScore(report, wantedOrgNo) {
  const financialFacts = report.facts.filter(fact => Object.values(CONCEPTS).flat().includes(fact.localName)).length;
  const orgBonus = wantedOrgNo && report.orgNo === wantedOrgNo ? 1000 : 0;
  return orgBonus + financialFacts;
}

function parseNumeric(value, attrs = {}) {
  let text = String(value || '').trim().replace(/\u2212/g, '-').replace(/\u00a0/g, ' ');
  let negative = /^\(.*\)$/.test(text);
  text = text.replace(/[()'’\s]/g, '').replace(/[^\d,.\-+]/g, '');
  if (!text || !/\d/.test(text)) return null;

  const comma = text.lastIndexOf(',');
  const dot = text.lastIndexOf('.');
  if (comma >= 0 && dot >= 0) {
    const decimalSeparator = comma > dot ? ',' : '.';
    const thousandsSeparator = decimalSeparator === ',' ? /\./g : /,/g;
    text = text.replace(thousandsSeparator, '').replace(decimalSeparator, '.');
  } else if (comma >= 0) {
    text = /numcommadecimal/i.test(attrs.format || '') || /,\d{1,2}$/.test(text)
      ? text.replace(/\./g, '').replace(',', '.')
      : text.replace(/,/g, '');
  } else if (dot >= 0 && !/numdotdecimal/i.test(attrs.format || '') && !/\.\d{1,2}$/.test(text)) {
    text = text.replace(/\./g, '');
  }

  let numeric = Number(text);
  if (!Number.isFinite(numeric)) return null;
  if (negative || attrs.sign === '-') numeric = -Math.abs(numeric);
  const scale = Number(attrs.scale);
  if (Number.isFinite(scale) && scale !== 0) numeric *= 10 ** scale;
  return numeric;
}

function parseMaybeNumeric(value, attrs) {
  return /\d/.test(String(value || '')) ? parseNumeric(value, attrs) : null;
}

function precisionScore(decimals) {
  if (String(decimals || '').toUpperCase() === 'INF') return 10_000;
  const parsed = Number(decimals);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseAttributes(source) {
  const attrs = {};
  for (const match of String(source || '').matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
    attrs[match[1].split(':').at(-1)] = match[2] ?? match[3] ?? '';
  }
  return attrs;
}

function tagText(source, localName) {
  const expression = new RegExp(`<(?:[\\w.-]+:)?${localName}\\b[^>]*>([\\s\\S]*?)<\\/(?:[\\w.-]+:)?${localName}>`, 'i');
  const match = String(source || '').match(expression);
  return match ? cleanText(match[1]) : '';
}

function cleanText(value) {
  return decodeEntities(
    String(value || '')
      .replace(/<ix:exclude\b[\s\S]*?<\/ix:exclude>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  );
}

function decodeEntities(value) {
  return value
    .replace(/&nbsp;|&#160;|&#xA0;/gi, ' ')
    .replace(/&minus;/gi, '−')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>');
}

function inferCurrency(facts, units) {
  for (const fact of facts) {
    const currency = fact.currency || units.get(fact.unitRef);
    if (currency === 'SEK' || currency === 'EUR') return currency;
  }
  return 'SEK';
}

function adjustedEquityValue(period) {
  if (!Number.isFinite(period.equityKsek)) return null;
  return period.equityKsek + (Number.isFinite(period.untaxedReservesKsek) ? period.untaxedReservesKsek * ADJUSTED_EQUITY_FACTOR : 0);
}

function average(current, previous) {
  if (Number.isFinite(current) && Number.isFinite(previous)) return (current + previous) / 2;
  return null;
}

function sumFinite(...values) {
  const finite = values.filter(Number.isFinite);
  return finite.length ? finite.reduce((sum, value) => sum + value, 0) : null;
}

function positive(value) {
  return Number.isFinite(value) && value > 0;
}

function firstNumber(...values) {
  return values.find(Number.isFinite) ?? null;
}

function digits(value) {
  return String(value || '').replace(/\D/g, '');
}

function dateOnly(value) {
  return value ? String(value).slice(0, 10) : null;
}

function removeNullish(value) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== null && item !== undefined));
}
