import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {BolagsverketClient} from './bolagsverket/client.mjs';
import {deriveCrossPeriodRatios, parseAnnualReportPackage, parseXbrlDocument} from './bolagsverket/ixbrl.mjs';

const fixture = await fs.readFile('scripts/fixtures/annual-report-sample.xml', 'utf8');
const parsed = parseAnnualReportPackage([{name: 'annual-report.xml', content: fixture}], {
  orgNo: '559309-3247',
  sourceDocumentId: 'document-2024',
  reportingPeriodEnd: '2024-12-31',
  registeredAt: '2025-06-01T10:00:00Z',
  retrievedAt: '2026-07-30'
});
assert.equal(parsed.orgNo, '5593093247');
assert.equal(parsed.periods.length, 2);
const periods = deriveCrossPeriodRatios(parsed.periods);
const latest = periods.at(-1);
assert.equal(latest.fiscalYear, '2024-12');
assert.equal(latest.revenueKsek, 42043.123, 'den mest precisa dubbletten ska väljas');
assert.equal(latest.profitAfterFinancialKsek, 6450);
assert.equal(latest.employees, 13);
assert.equal(latest.cashKsek, 9000);
assert.equal(latest.currentRatioPct, 200);
assert.equal(latest.sourceDocumentId, 'document-2024');
assert.equal(latest.isPrimaryPeriod, true);
assert.ok(latest.returnOnEquityPct > 48 && latest.returnOnEquityPct < 49);
assert.ok(latest.returnOnAssetsPct > 31 && latest.returnOnAssetsPct < 32);
assert.equal(latest.premisesCostsKsek, undefined, 'lokalkostnad får inte gissas');

const inline = `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns:xbrli="http://www.xbrl.org/2003/instance" xmlns:ix="http://www.xbrl.org/2013/inlineXBRL">
  <body>
    <xbrli:context id="period0"><xbrli:entity><xbrli:identifier scheme="test">5593093247</xbrli:identifier></xbrli:entity><xbrli:period><xbrli:startDate>2024-01-01</xbrli:startDate><xbrli:endDate>2024-12-31</xbrli:endDate></xbrli:period></xbrli:context>
    <xbrli:unit id="SEK"><xbrli:measure>iso4217:SEK</xbrli:measure></xbrli:unit>
    <ix:nonNumeric name="se-cd-base:Organisationsnummer" contextRef="period0">559309-3247</ix:nonNumeric>
    <ix:nonFraction name="se-gen-base:Nettoomsattning" contextRef="period0" unitRef="SEK" format="ixt:numcommadecimal" scale="3" decimals="-3">42 043</ix:nonFraction>
    <ix:nonFraction name="se-gen-base:ResultatEfterFinansiellaPoster" contextRef="period0" unitRef="SEK" format="ixt:numcommadecimal" scale="3" sign="-" decimals="-3">330</ix:nonFraction>
  </body>
</html>`;
const inlineReport = parseXbrlDocument(inline);
const inlineRevenue = inlineReport.facts.find(fact => fact.localName === 'Nettoomsattning');
const inlineLoss = inlineReport.facts.find(fact => fact.localName === 'ResultatEfterFinansiellaPoster');
assert.equal(inlineRevenue.numericValue, 42_043_000);
assert.equal(inlineLoss.numericValue, -330_000);

const calls = [];
const fakeFetch = async (url, options) => {
  calls.push({url, options});
  if (url.endsWith('/oauth2/token')) {
    return new Response(JSON.stringify({access_token: 'temporary-token', expires_in: 3600}), {
      status: 200,
      headers: {'content-type': 'application/json'}
    });
  }
  if (url.endsWith('/isalive')) return new Response('OK', {status: 200});
  if (url.endsWith('/dokumentlista')) {
    return new Response(JSON.stringify({dokument: []}), {
      status: 200,
      headers: {'content-type': 'application/json'}
    });
  }
  return new Response('', {status: 404});
};
const client = new BolagsverketClient({
  clientId: 'test-id',
  clientSecret: 'test-secret',
  tokenUrl: 'https://example.test/oauth2/token',
  apiBaseUrl: 'https://example.test/v1',
  fetchImpl: fakeFetch
});
assert.equal(await client.isAlive(), 'OK');
assert.deepEqual(await client.listDocuments('559309-3247'), {dokument: []});
assert.equal(calls.filter(call => call.url.endsWith('/oauth2/token')).length, 1, 'tokenen ska återanvändas');
assert.equal(calls.at(-1).options.headers.Authorization, 'Bearer temporary-token');
assert.ok(!JSON.stringify(calls.slice(1)).includes('test-secret'), 'client secret får inte skickas till API-resurserna');

console.log('Bolagsverket-klient och XBRL-normalisering verifierade.');
