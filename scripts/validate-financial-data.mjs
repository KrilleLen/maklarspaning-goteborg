import fs from 'node:fs/promises';

const target = process.argv[2] || 'site/data/app-data.json';
const data = JSON.parse(await fs.readFile(target, 'utf8'));
const errors = [];
const orgNumbers = new Set();

if (!Array.isArray(data.companies) || data.companies.length === 0) {
  errors.push('companies måste vara en icke-tom lista');
}

for (const company of data.companies || []) {
  const orgNo = String(company.orgNo || '').replace(/\D/g, '');
  if (!/^\d{10}$/.test(orgNo)) errors.push(`${company.legalName || company.id}: ogiltigt organisationsnummer`);
  if (orgNumbers.has(orgNo)) errors.push(`${company.legalName || company.id}: organisationsnumret förekommer flera gånger`);
  orgNumbers.add(orgNo);

  const periods = Array.isArray(company.history) ? company.history : [];
  const fiscalYears = new Set();
  for (const period of periods) {
    const fiscalYear = String(period.fiscalYear || '');
    if (!/^\d{4}-\d{2}$/.test(fiscalYear)) errors.push(`${company.legalName}: ogiltig bokslutsperiod ${fiscalYear || '(tom)'}`);
    if (fiscalYears.has(fiscalYear)) errors.push(`${company.legalName}: bokslutsperiod ${fiscalYear} förekommer flera gånger`);
    fiscalYears.add(fiscalYear);
    for (const [key,value] of Object.entries(period)) {
      if (key.endsWith('Ksek') && value !== null && !Number.isFinite(value)) {
        errors.push(`${company.legalName} ${fiscalYear}: ${key} måste vara ett tal eller null`);
      }
    }
    if (period.sourceDocumentId) {
      if (period.source !== 'Bolagsverket · digital årsredovisning') {
        errors.push(`${company.legalName} ${fiscalYear}: Bolagsverket-ID saknar officiell källmärkning`);
      }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(period.retrievedAt || '')) {
        errors.push(`${company.legalName} ${fiscalYear}: hämtad-datum saknas för officiell period`);
      }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(period.startDate || '') || !/^\d{4}-\d{2}-\d{2}$/.test(period.endDate || '')) {
        errors.push(`${company.legalName} ${fiscalYear}: räkenskapsperiod saknas för officiell period`);
      }
    }
  }
}

if (errors.length) {
  console.error(errors.map(error => `- ${error}`).join('\n'));
  process.exit(1);
}

console.log(`Finansiell data verifierad: ${data.companies.length} bolag, ${orgNumbers.size} unika organisationsnummer.`);
