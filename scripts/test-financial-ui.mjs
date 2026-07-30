import fs from 'node:fs/promises';
import vm from 'node:vm';

const [appSource,data] = await Promise.all([
  fs.readFile('site/app.js','utf8'),
  fs.readFile('site/data/app-data.json','utf8').then(JSON.parse)
]);

const sandbox = {
  console,
  Intl,
  Date,
  Math,
  Number,
  String,
  Set,
  Map,
  JSON,
  URL,
  window:{addEventListener(){}},
  document:{addEventListener(){},querySelector(){return null}},
  navigator:{onLine:true},
  localStorage:{getItem(){return null},setItem(){}}
};
vm.createContext(sandbox);
vm.runInContext(`${appSource}
globalThis.__financialTest = {
  state,
  els,
  renderCompanies,
  openCompanyDetail,
  financialCoverage,
  companyHistory
};`,sandbox);

const api = sandbox.__financialTest;
api.state.data = data;
api.els.detailDialogContent = {innerHTML:''};
api.els.detailDialog = {open:false,showModal(){this.open=true}};

const market = api.renderCompanies();
assertContains(market,'full ekonomivy inne på bolaget','Marknadsvyn saknar vägen till fördjupningen');
assertContains(market,'Öppna ekonomin','Mobilkorten saknar ekonomiknapp');

const targets = data.companies;

for (const company of targets) {
  for (const tab of ['overview','income','costs','balance','ratios','sources']) {
    api.openCompanyDetail(company.id,tab);
    const html = api.els.detailDialogContent.innerHTML;
    assertContains(html,'financial-tabs',`${company.legalName}: fliknavigation saknas`);
    assertContains(html,`data-financial-tab="${tab}"`,`${company.legalName}: ${tab} saknas`);
    assertContains(html,'aria-selected="true"',`${company.legalName}: aktiv flik markeras inte`);
    if (/\bNaN\b|\bundefined\b/.test(html)) throw new Error(`${company.legalName}: ogiltigt värde i ${tab}`);
  }
}

const benchmark = data.companies.find(company => company.isBenchmark);
if (api.financialCoverage(benchmark).years < 2) throw new Error('Benchmarkens historik tappades bort');
console.log(`UI-logik verifierad för ${targets.length} bolag och 6 ekonomiflikar.`);

function assertContains(value,needle,message) {
  if (!value.includes(needle)) throw new Error(message);
}
