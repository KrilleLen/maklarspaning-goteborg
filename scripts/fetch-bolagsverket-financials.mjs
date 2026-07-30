import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {clientFromEnvironment} from './bolagsverket/client.mjs';
import {deriveCrossPeriodRatios, parseAnnualReportPackage, periodQuality} from './bolagsverket/ixbrl.mjs';

const execFileAsync = promisify(execFile);
const outputPath = process.argv[2] || 'tmp/bolagsverket-financial-import.json';
const appDataPath = process.argv[3] || 'site/data/app-data.json';
const retrievedAt = new Date().toISOString().slice(0, 10);
const maxDocuments = positiveInteger(process.env.BOLAGSVERKET_MAX_DOCUMENTS, 8);
const pauseMs = positiveInteger(process.env.BOLAGSVERKET_REQUEST_PAUSE_MS, 150);
const client = clientFromEnvironment();
const appData = JSON.parse(await fs.readFile(appDataPath, 'utf8'));
const orgNoFilter = commaSeparatedDigits(process.env.BOLAGSVERKET_ORG_NOS);
const targetCompanies = orgNoFilter.size
  ? appData.companies.filter(company => orgNoFilter.has(digits(company.orgNo)))
  : appData.companies;
const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'maklarspaning-bv-'));
const companies = [];
const warnings = [];

try {
  if (!targetCompanies.length) throw new Error('Inga bolag matchade BOLAGSVERKET_ORG_NOS.');
  const health = await client.isAlive();
  if (String(health).trim().toUpperCase() !== 'OK') throw new Error('Bolagsverkets hälsokontroll gav ett oväntat svar.');

  for (const [index, company] of targetCompanies.entries()) {
    const orgNo = digits(company.orgNo);
    process.stdout.write(`[${index + 1}/${targetCompanies.length}] ${company.legalName}: `);
    try {
      const list = await client.listDocuments(orgNo);
      const documents = (list.dokument || [])
        .slice()
        .sort((a, b) => documentSortKey(b).localeCompare(documentSortKey(a)))
        .slice(0, maxDocuments);
      if (!documents.length) {
        console.log('inga digitala årsredovisningar');
        companies.push({orgNo, periods: []});
        await delay(pauseMs);
        continue;
      }

      const parsedPeriods = [];
      for (const document of documents) {
        const archive = await client.getDocument(document.dokumentId);
        const packageFiles = await extractPackage(archive, tempRoot, document.dokumentId);
        const parsed = parseAnnualReportPackage(packageFiles, {
          orgNo,
          sourceDocumentId: document.dokumentId,
          reportingPeriodEnd: document.rapporteringsperiodTom,
          registeredAt: document.registreringstidpunkt,
          retrievedAt
        });
        parsedPeriods.push(...parsed.periods);
        for (const warning of parsed.warnings) warnings.push(`${company.legalName}: ${warning}`);
        await delay(pauseMs);
      }
      const periods = deriveCrossPeriodRatios(selectBestPeriods(parsedPeriods));
      companies.push({orgNo, periods});
      console.log(`${periods.length} bokslutsperioder`);
    } catch (error) {
      warnings.push(`${company.legalName}: ${error.message}`);
      companies.push({orgNo, periods: []});
      console.log('kunde inte hämtas');
    }
    await delay(pauseMs);
  }

  const populated = companies.filter(company => company.periods.length).length;
  if (!populated) throw new Error('Ingen årsredovisning kunde normaliseras. Befintlig appdata har inte ändrats.');
  const payload = {
    source: 'Bolagsverket · Värdefulla datamängder',
    retrievedAt,
    companies
  };
  await fs.mkdir(path.dirname(outputPath), {recursive: true});
  await fs.writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  console.log(`Normaliserad import skapad för ${populated} av ${companies.length} bolag.`);
  if (warnings.length) {
    console.warn(`Varningar (${warnings.length}):`);
    for (const warning of warnings.slice(0, 50)) console.warn(`- ${warning}`);
  }
} finally {
  await fs.rm(tempRoot, {recursive: true, force: true});
}

function selectBestPeriods(periods) {
  const selected = new Map();
  for (const period of periods) {
    const key = period.fiscalYear;
    const existing = selected.get(key);
    if (!existing || comparePeriodQuality(period, existing) > 0) selected.set(key, period);
  }
  return [...selected.values()].sort((a, b) => a.fiscalYear.localeCompare(b.fiscalYear));
}

function comparePeriodQuality(left, right) {
  if (Boolean(left.isPrimaryPeriod) !== Boolean(right.isPrimaryPeriod)) return left.isPrimaryPeriod ? 1 : -1;
  const qualityDifference = periodQuality(left) - periodQuality(right);
  if (qualityDifference) return qualityDifference;
  return String(left.registeredAt || '').localeCompare(String(right.registeredAt || ''));
}

async function extractPackage(archive, root, documentId) {
  const safeName = String(documentId).replace(/[^a-zA-Z0-9._-]/g, '_');
  const archivePath = path.join(root, `${safeName}.zip`);
  const outputDirectory = path.join(root, safeName);
  await fs.writeFile(archivePath, archive, {mode: 0o600});
  await fs.mkdir(outputDirectory, {recursive: true});
  await execFileAsync('unzip', ['-qq', '-o', archivePath, '-d', outputDirectory]);
  const files = await walk(outputDirectory);
  return Promise.all(files
    .filter(file => /\.(xhtml?|xml)$/i.test(file))
    .map(async file => ({name: path.basename(file), content: await fs.readFile(file, 'utf8')})));
}

async function walk(directory) {
  const entries = await fs.readdir(directory, {withFileTypes: true});
  const nested = await Promise.all(entries.map(entry => {
    const target = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(target) : [target];
  }));
  return nested.flat();
}

function documentSortKey(document) {
  return `${document.rapporteringsperiodTom || ''}|${document.registreringstidpunkt || ''}`;
}

function digits(value) {
  return String(value || '').replace(/\D/g, '');
}

function commaSeparatedDigits(value) {
  return new Set(String(value || '')
    .split(',')
    .map(digits)
    .filter(Boolean));
}

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

function delay(ms) {
  return ms > 0 ? new Promise(resolve => setTimeout(resolve, ms)) : Promise.resolve();
}
