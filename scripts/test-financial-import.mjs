import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';

const execFileAsync = promisify(execFile);
const tempDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'maklarspaning-import-test-'));

try {
  const sourceData = JSON.parse(await fs.readFile('site/data/app-data.json', 'utf8'));
  const company = sourceData.companies.find(item => item.isBenchmark);
  const newerSnapshotCompany = sourceData.companies.find(item =>
    item.id !== company.id &&
    item.fiscalYear === '2025-12' &&
    Number.isFinite(item.revenueKsek)
  );
  newerSnapshotCompany.history = [];
  const originalPeriods = company.history.length;
  const targetDataPath = path.join(tempDirectory, 'app-data.json');
  const payloadPath = path.join(tempDirectory, 'payload.json');
  const fiscalYear = company.fiscalYear;

  await fs.writeFile(targetDataPath, `${JSON.stringify(sourceData, null, 2)}\n`);
  await fs.writeFile(payloadPath, `${JSON.stringify({
    source: 'Bolagsverket · Värdefulla datamängder',
    retrievedAt: '2026-07-30',
    companies: [
      {
        orgNo: company.orgNo,
        periods: [{
          year: Number(fiscalYear.slice(0, 4)),
          fiscalYear,
          startDate: `${fiscalYear.slice(0, 4)}-01-01`,
          endDate: `${fiscalYear}-31`,
          currency: 'SEK',
          source: 'Bolagsverket · digital årsredovisning',
          sourceUrl: 'https://bolagsverket.se/apierochoppnadata/hamtaforetagsinformation/vardefulladatamangder/apiforvardefulladatamangder.5513.html',
          sourceDocumentId: 'official-test-document',
          registeredAt: '2026-06-01',
          retrievedAt: '2026-07-30',
          isPrimaryPeriod: true,
          netRevenueKsek: 43000,
          revenueKsek: 43000,
          profitAfterFinancialKsek: 7000,
          profitKsek: 7000
        }]
      },
      {
        orgNo: newerSnapshotCompany.orgNo,
        periods: [{
          year: 2024,
          fiscalYear: '2024-12',
          startDate: '2024-01-01',
          endDate: '2024-12-31',
          currency: 'SEK',
          source: 'Bolagsverket · digital årsredovisning',
          sourceUrl: 'https://bolagsverket.se/apierochoppnadata/hamtaforetagsinformation/vardefulladatamangder/apiforvardefulladatamangder.5513.html',
          sourceDocumentId: 'official-prior-year-test-document',
          registeredAt: '2025-06-01',
          retrievedAt: '2026-07-30',
          isPrimaryPeriod: true,
          revenueKsek: 1000,
          profitKsek: 100
        }]
      }
    ]
  }, null, 2)}\n`);

  await execFileAsync(process.execPath, ['scripts/import-financials.mjs', payloadPath, targetDataPath]);
  const imported = JSON.parse(await fs.readFile(targetDataPath, 'utf8'));
  const updated = imported.companies.find(item => item.id === company.id);
  const period = updated.history.find(item => item.fiscalYear === fiscalYear);

  assert.equal(updated.history.length, originalPeriods, 'en överlappande period ska ersättas, inte dubbleras');
  assert.equal(period.revenueKsek, 43000);
  assert.equal(period.profitKsek, 7000);
  assert.equal(period.sourceDocumentId, 'official-test-document');
  assert.equal(period.employees, undefined, 'äldre tredjepartstal får inte felaktigt få officiell källmärkning');
  assert.equal(updated.revenueKsek, 43000);
  assert.equal(updated.profitKsek, 7000);
  assert.equal(updated.employees, null);
  assert.equal(imported.meta.financialDataUpdatedAt, '2026-07-30');

  const snapshotPreserved = imported.companies.find(item => item.id === newerSnapshotCompany.id);
  assert.equal(snapshotPreserved.history.length, 2);
  assert.equal(snapshotPreserved.history.at(-1).fiscalYear, '2025-12');
  assert.equal(snapshotPreserved.history.at(-1).source, 'Tidigare verifierat publikt bokslut');
  assert.equal(snapshotPreserved.revenueKsek, newerSnapshotCompany.revenueKsek);
  assert.equal(snapshotPreserved.profitKsek, newerSnapshotCompany.profitKsek);

  console.log('Sammanslagning och källisolering för officiella perioder verifierade.');
} finally {
  await fs.rm(tempDirectory, {recursive: true, force: true});
}
