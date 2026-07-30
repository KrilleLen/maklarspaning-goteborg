const DEFAULT_TOKEN_URL = 'https://portal.api.bolagsverket.se/oauth2/token';
const DEFAULT_API_BASE_URL = 'https://gw.api.bolagsverket.se/vardefulla-datamangder/v1';
const DEFAULT_SCOPE = 'vardefulla-datamangder:read vardefulla-datamangder:ping';

export class BolagsverketClient {
  constructor({
    clientId,
    clientSecret,
    tokenUrl = DEFAULT_TOKEN_URL,
    apiBaseUrl = DEFAULT_API_BASE_URL,
    scope = DEFAULT_SCOPE,
    fetchImpl = globalThis.fetch,
    timeoutMs = 30_000,
    maxRetries = 5
  }) {
    if (!clientId || !clientSecret) throw new Error('Bolagsverkets client ID och client secret måste anges.');
    if (typeof fetchImpl !== 'function') throw new Error('Fetch saknas i den här Node-miljön.');
    this.clientId = clientId;
    this.clientSecret = clientSecret;
    this.tokenUrl = tokenUrl;
    this.apiBaseUrl = apiBaseUrl.replace(/\/$/, '');
    this.scope = scope;
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
    this.maxRetries = maxRetries;
    this.cachedToken = null;
  }

  async isAlive() {
    const response = await this.request('/isalive', {accept: '*/*'});
    return response.text();
  }

  async getOrganisation(orgNo) {
    const response = await this.request('/organisationer', {
      method: 'POST',
      body: {identitetsbeteckning: digits(orgNo)}
    });
    return response.json();
  }

  async listDocuments(orgNo) {
    const response = await this.request('/dokumentlista', {
      method: 'POST',
      body: {identitetsbeteckning: digits(orgNo)}
    });
    return response.json();
  }

  async getDocument(documentId) {
    const safeId = encodeURIComponent(String(documentId || ''));
    if (!safeId) throw new Error('Dokument-ID saknas.');
    const response = await this.request(`/dokument/${safeId}`, {accept: 'application/zip'});
    return Buffer.from(await response.arrayBuffer());
  }

  async request(path, {method = 'GET', body, accept = 'application/json'} = {}) {
    let refreshedAfterUnauthorized = false;
    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      const token = await this.accessToken();
      const headers = {
        Authorization: `Bearer ${token}`,
        Accept: accept
      };
      if (body !== undefined) headers['Content-Type'] = 'application/json';
      let response;
      try {
        response = await this.fetchImpl(`${this.apiBaseUrl}${path}`, {
          method,
          headers,
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: AbortSignal.timeout(this.timeoutMs)
        });
      } catch (error) {
        if (attempt >= this.maxRetries) throw new Error(`Bolagsverkets API kunde inte nås: ${error.message}`);
        await delay(backoff(attempt));
        continue;
      }

      if (response.status === 401 && !refreshedAfterUnauthorized) {
        this.cachedToken = null;
        refreshedAfterUnauthorized = true;
        continue;
      }
      if ((response.status === 429 || response.status >= 500) && attempt < this.maxRetries) {
        await delay(retryDelay(response, attempt));
        continue;
      }
      if (!response.ok) {
        const detail = await safeErrorDetail(response);
        throw new Error(`Bolagsverket svarade HTTP ${response.status}${detail ? `: ${detail}` : ''}`);
      }
      return response;
    }
    throw new Error('Bolagsverkets API-anrop kunde inte slutföras.');
  }

  async accessToken() {
    const now = Date.now();
    if (this.cachedToken?.expiresAt > now + 60_000) return this.cachedToken.value;

    const form = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: this.clientId,
      client_secret: this.clientSecret,
      scope: this.scope
    });
    let response;
    try {
      response = await this.fetchImpl(this.tokenUrl, {
        method: 'POST',
        headers: {'Content-Type': 'application/x-www-form-urlencoded'},
        body: form,
        signal: AbortSignal.timeout(this.timeoutMs)
      });
    } catch (error) {
      throw new Error(`Bolagsverkets token-tjänst kunde inte nås: ${error.message}`);
    }
    if (!response.ok) {
      const detail = await safeErrorDetail(response);
      throw new Error(`Bolagsverkets autentisering misslyckades (HTTP ${response.status})${detail ? `: ${detail}` : ''}`);
    }
    const payload = await response.json();
    if (!payload.access_token) throw new Error('Bolagsverkets token-svar saknar access_token.');
    this.cachedToken = {
      value: payload.access_token,
      expiresAt: now + Math.max(60, Number(payload.expires_in) || 3600) * 1000
    };
    return this.cachedToken.value;
  }
}

export function clientFromEnvironment(env = process.env) {
  return new BolagsverketClient({
    clientId: env.BOLAGSVERKET_CLIENT_ID,
    clientSecret: env.BOLAGSVERKET_CLIENT_SECRET,
    tokenUrl: env.BOLAGSVERKET_TOKEN_URL || DEFAULT_TOKEN_URL,
    apiBaseUrl: env.BOLAGSVERKET_API_BASE_URL || DEFAULT_API_BASE_URL
  });
}

function digits(value) {
  return String(value || '').replace(/\D/g, '');
}

function backoff(attempt) {
  return Math.min(8000, 500 * 2 ** attempt);
}

function retryDelay(response, attempt) {
  const retryAfter = Number(response.headers?.get?.('retry-after'));
  if (Number.isFinite(retryAfter) && retryAfter > 0) return Math.min(60_000, retryAfter * 1000);
  if (response.status === 429) return Math.min(60_000, 10_000 * 2 ** attempt);
  return backoff(attempt);
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function safeErrorDetail(response) {
  try {
    const text = await response.text();
    if (!text) return '';
    const payload = JSON.parse(text);
    return String(payload.detail || payload.title || payload.error || '').slice(0, 300);
  } catch {
    return '';
  }
}
