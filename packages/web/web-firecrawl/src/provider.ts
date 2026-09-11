/** Self-hosted Firecrawl providers for the Harness web capability seam. */

import { WebError } from '@deepseek-ai/dsh-web'
import type {
  WebFetchProvider,
  WebFetchRequest,
  WebFetchResult,
  WebSearchProvider,
  WebSearchRequest,
  WebSearchResult,
  WebSearchSource,
} from '@deepseek-ai/dsh-web'
import type {
  FirecrawlScrapeMetadata,
  FirecrawlScrapeResponse,
  FirecrawlSearchItem,
  FirecrawlSearchResponse,
} from './types.ts'

/** Stable provider id used independently by the search and fetch registries. */
export const FIRECRAWL_PROVIDER_ID = 'firecrawl'

/** Loopback default for the self-hosted diagnostic API in the ANVIL stack. */
export const FIRECRAWL_DEFAULT_BASE_URL = 'http://127.0.0.1:33102'

/** Default maximum number of search sources requested from Firecrawl. */
export const FIRECRAWL_DEFAULT_SEARCH_LIMIT = 8

/** Default JSON response bound for the provider API, including scrape Markdown. */
export const FIRECRAWL_DEFAULT_MAX_RESPONSE_BYTES = 10_000_000

/** Resolved settings shared by Firecrawl's search and fetch providers. */
export interface FirecrawlProviderOptions {
  /** Self-hosted Firecrawl API root, with or without a trailing `/v1`. */
  readonly baseURL: string
  /** Optional API key for an authenticated Firecrawl deployment. */
  readonly apiKey?: string
  /** Default search result bound when the seam request omits `maxResults`. */
  readonly searchLimit: number
  /** Maximum JSON response body accepted from Firecrawl. */
  readonly maxResponseBytes: number
}

/** Firecrawl-backed search provider. */
export class FirecrawlSearchProvider implements WebSearchProvider {
  readonly id = FIRECRAWL_PROVIDER_ID

  constructor(private readonly options: FirecrawlProviderOptions) {}

  available(): boolean {
    return validBaseURL(this.options.baseURL)
      && positiveInteger(this.options.searchLimit)
      && positiveInteger(this.options.maxResponseBytes)
  }

  async search(request: WebSearchRequest, signal?: AbortSignal): Promise<WebSearchResult> {
    const limit = request.maxResults ?? this.options.searchLimit
    const payload = await postJson<FirecrawlSearchResponse>(
      'search',
      endpoint(this.options.baseURL, '/search'),
      {
        query: request.query,
        ...limit !== undefined ? { limit } : {},
      },
      this.options,
      signal,
    )
    if (payload.success !== true || !Array.isArray(payload.data)) {
      throw firecrawlShapeError('search', payload)
    }

    const seen = new Set<string>()
    const sources: WebSearchSource[] = []
    for (const item of payload.data as FirecrawlSearchItem[]) {
      if (!isRecord(item) || typeof item.url !== 'string' || item.url.length === 0 || seen.has(item.url)) continue
      seen.add(item.url)
      const title = stringField(item.title)
      const snippet = stringField(item.description) ?? stringField(item.snippet)
      const publishedAt = stringField(item.publishedDate)
      sources.push({
        url: item.url,
        ...title === undefined || title.length === 0 ? {} : { title },
        ...snippet === undefined || snippet.length === 0 ? {} : { snippet },
        ...publishedAt === undefined || publishedAt.length === 0 ? {} : { publishedAt },
      })
    }
    return { sources, truncated: false }
  }
}

/** Firecrawl-backed URL retrieval provider. */
export class FirecrawlFetchProvider implements WebFetchProvider {
  readonly id = FIRECRAWL_PROVIDER_ID

  constructor(private readonly options: FirecrawlProviderOptions) {}

  available(): boolean {
    return validBaseURL(this.options.baseURL) && positiveInteger(this.options.maxResponseBytes)
  }

  async fetch(request: WebFetchRequest, signal?: AbortSignal): Promise<WebFetchResult> {
    const payload = await postJson<FirecrawlScrapeResponse>(
      'scrape',
      endpoint(this.options.baseURL, '/scrape'),
      {
        url: request.url,
        formats: ['markdown', 'html'],
        // The ANVIL adapter rejects the unsafe true value. Making false explicit
        // also prevents Firecrawl's default from changing the downstream ABI.
        skipTlsVerification: false,
      },
      this.options,
      signal,
    )
    if (payload.success !== true || !isRecord(payload.data)) {
      throw firecrawlShapeError('scrape', payload)
    }

    const data = payload.data as Record<string, unknown>
    const metadata = isRecord(data.metadata) ? data.metadata as FirecrawlScrapeMetadata : {}
    const markdown = typeof data.markdown === 'string' ? data.markdown : undefined
    const html = typeof data.html === 'string' ? data.html : undefined
    if (markdown === undefined && html === undefined) {
      throw new WebError('Firecrawl scrape response contained neither markdown nor html', 'WEB_PROVIDER_ERROR')
    }

    const body = markdown !== undefined
      ? { kind: 'text' as const, content: markdown }
      : { kind: 'html' as const, content: html as string }
    const statusCode = positiveIntegerValue(metadata.statusCode) ? metadata.statusCode as number : 200
    const finalUrl = typeof metadata.url === 'string' && metadata.url.length > 0 ? metadata.url : request.url
    return { url: finalUrl, statusCode, body, truncated: false }
  }
}

/** Build a Firecrawl endpoint while accepting either an API root or `/v1` base. */
export function endpoint(baseURL: string, path: '/search' | '/scrape'): string {
  const base = baseURL.replace(/\/+$/, '')
  return `${base.endsWith('/v1') ? base : `${base}/v1`}${path}`
}

/** Validate a configured provider endpoint without making a network request. */
export function validBaseURL(baseURL: string): boolean {
  try {
    const parsed = new URL(baseURL)
    return (parsed.protocol === 'http:' || parsed.protocol === 'https:')
      && parsed.username.length === 0
      && parsed.password.length === 0
  } catch {
    return false
  }
}

async function postJson<T>(
  operation: 'search' | 'scrape',
  url: string,
  body: Record<string, unknown>,
  options: FirecrawlProviderOptions,
  signal?: AbortSignal,
): Promise<T> {
  if (signal?.aborted === true) throw aborted(operation)
  let response: Response
  try {
    response = await fetch(url, {
      method: 'POST',
      // Firecrawl is a configured, credential-bearing provider boundary: never
      // forward the request body or API key through an automatic redirect.
      redirect: 'error',
      headers: {
        'accept': 'application/json',
        'content-type': 'application/json',
        'user-agent': 'deepseek-harness-firecrawl/0.1.0',
        ...options.apiKey === undefined || options.apiKey.length === 0 ? {} : {
          'authorization': `Bearer ${options.apiKey}`,
          'x-api-key': options.apiKey,
        },
      },
      body: JSON.stringify(body),
      ...signal === undefined ? {} : { signal },
    })
  } catch (error: unknown) {
    if (signal?.aborted || isAbortError(error)) throw aborted(operation, error)
    throw new WebError(`Firecrawl ${operation} request failed: ${String(error)}`, 'WEB_PROVIDER_ERROR', { cause: error })
  }

  let text: string
  try {
    const declared = Number(response.headers.get('content-length'))
    if (Number.isFinite(declared) && declared > options.maxResponseBytes) {
      throw new WebError(`Firecrawl ${operation} response exceeds ${options.maxResponseBytes} bytes`, 'WEB_PROVIDER_ERROR')
    }
    text = await response.text()
  } catch (error: unknown) {
    if (signal?.aborted || isAbortError(error)) throw aborted(operation, error)
    if (error instanceof WebError) throw error
    throw new WebError(`Firecrawl ${operation} response could not be read: ${String(error)}`, 'WEB_PROVIDER_ERROR', { cause: error })
  }
  if (new TextEncoder().encode(text).byteLength > options.maxResponseBytes) {
    throw new WebError(`Firecrawl ${operation} response exceeds ${options.maxResponseBytes} bytes`, 'WEB_PROVIDER_ERROR')
  }

  let payload: unknown
  try {
    payload = text.length === 0 ? undefined : JSON.parse(text)
  } catch (error: unknown) {
    throw new WebError(`Firecrawl ${operation} returned an unprocessable response body: ${String(error)}`, 'WEB_PROVIDER_ERROR', { cause: error })
  }
  if (!response.ok) {
    throw new WebError(firecrawlHttpError(operation, response.status, payload), 'WEB_PROVIDER_ERROR')
  }
  if (!isRecord(payload)) {
    throw new WebError(`Firecrawl ${operation} returned an unprocessable response body`, 'WEB_PROVIDER_ERROR')
  }
  return payload as T
}

function firecrawlHttpError(operation: string, status: number, payload: unknown): string {
  const detail = isRecord(payload)
    ? stringField(payload.error) ?? stringField(payload.message) ?? stringField(payload.code)
    : undefined
  return detail === undefined
    ? `Firecrawl ${operation} API error (HTTP ${status})`
    : `Firecrawl ${operation} API error (HTTP ${status}): ${detail}`
}

function firecrawlShapeError(operation: string, payload: FirecrawlSearchResponse | FirecrawlScrapeResponse): WebError {
  const detail = stringField(payload.error) ?? stringField(payload.message) ?? stringField(payload.code)
  return new WebError(
    detail === undefined
      ? `Firecrawl ${operation} returned an unsuccessful or malformed response`
      : `Firecrawl ${operation} failed: ${detail}`,
    'WEB_PROVIDER_ERROR',
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stringField(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function positiveInteger(value: number): boolean {
  return Number.isInteger(value) && value > 0
}

function positiveIntegerValue(value: unknown): boolean {
  return typeof value === 'number' && positiveInteger(value)
}

function aborted(operation: string, cause?: unknown): WebError {
  return new WebError(`Firecrawl ${operation} request aborted`, 'WEB_ABORTED', cause === undefined ? {} : { cause })
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}
