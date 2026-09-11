import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import WebRuntime from '@deepseek-ai/dsh-web'
import {
  FirecrawlFetchProvider,
  FirecrawlSearchProvider,
  FIRECRAWL_PROVIDER_ID,
  endpoint,
  validBaseURL,
} from '../src/index.ts'
import * as firecrawlPlugin from '../src/index.ts'

const options = {
  baseURL: 'http://firecrawl.test',
  searchLimit: 8,
  maxResponseBytes: 10_000,
}

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' }, ...init })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('Firecrawl endpoint and mapping', () => {
  it('accepts an API root or a /v1 base', () => {
    expect(endpoint('http://firecrawl.test', '/search')).toBe('http://firecrawl.test/v1/search')
    expect(endpoint('http://firecrawl.test/v1/', '/scrape')).toBe('http://firecrawl.test/v1/scrape')
    expect(validBaseURL('http://firecrawl.test')).toBe(true)
    expect(validBaseURL('https://user:secret@firecrawl.test')).toBe(false)
    expect(validBaseURL('not-a-url')).toBe(false)
  })

  it('maps Firecrawl search result fields and dedupes URLs', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({
      success: true,
      data: [
        { url: 'https://a.test', title: 'A', description: 'first', publishedDate: '2026-08-20' },
        { url: 'https://a.test', title: 'duplicate', description: 'ignored' },
        { url: 'https://b.test', snippet: 'second' },
        { title: 'missing url' },
      ],
    }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await new FirecrawlSearchProvider(options).search({ query: 'hello', maxResults: 2 })

    expect(result).toEqual({
      sources: [
        { url: 'https://a.test', title: 'A', snippet: 'first', publishedAt: '2026-08-20' },
        { url: 'https://b.test', snippet: 'second' },
      ],
      truncated: false,
    })
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(init).toMatchObject({ method: 'POST', redirect: 'error' })
    expect(JSON.parse(init.body as string)).toEqual({ query: 'hello', limit: 2 })
  })

  it('maps Firecrawl Markdown and metadata into the fetch seam', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({
      success: true,
      data: {
        markdown: '# Example',
        html: '<h1>Example</h1>',
        metadata: { url: 'https://example.test/final', statusCode: 200 },
      },
    }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await new FirecrawlFetchProvider(options).fetch({ url: 'https://example.test' })

    expect(result).toEqual({
      url: 'https://example.test/final',
      statusCode: 200,
      body: { kind: 'text', content: '# Example' },
      truncated: false,
    })
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('http://firecrawl.test/v1/scrape')
    expect(init).toMatchObject({ method: 'POST', redirect: 'error' })
    expect(JSON.parse(init.body as string)).toEqual({
      url: 'https://example.test',
      formats: ['markdown', 'html'],
      skipTlsVerification: false,
    })
  })
})

describe('Firecrawl provider errors and registration', () => {
  it('rejects a redirect without contacting a second target', async () => {
    const fetchMock = vi.fn(async () => new Response('', { status: 302, headers: { location: 'https://other.test' } }))
    vi.stubGlobal('fetch', fetchMock)
    const error = await new FirecrawlSearchProvider(options).search({ query: 'q' }).then(() => undefined, cause => cause)
    expect(error).toMatchObject({ code: 'WEB_PROVIDER_ERROR' })
    expect((error as Error).message).toMatch(/HTTP 302/)
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it('maps an abort to WEB_ABORTED', async () => {
    const fetchMock = vi.fn(() => Promise.reject(new DOMException('aborted', 'AbortError')))
    vi.stubGlobal('fetch', fetchMock)
    await expect(new FirecrawlFetchProvider(options).fetch({ url: 'https://example.test' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_ABORTED' }))
  })

  it('maps an unsuccessful Firecrawl envelope to WEB_PROVIDER_ERROR', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ success: false, error: 'adapter unavailable' })))
    const error = await new FirecrawlSearchProvider(options).search({ query: 'q' }).then(() => undefined, cause => cause)
    expect(error).toMatchObject({ code: 'WEB_PROVIDER_ERROR' })
    expect((error as Error).message).toMatch(/adapter unavailable/)
  })

  it('registers both providers and selects them by the shared id', async () => {
    const ctx = new Context()
    const fiber = await ctx.plugin(WebRuntime, { searchProvider: FIRECRAWL_PROVIDER_ID, fetchProvider: FIRECRAWL_PROVIDER_ID })
    await ctx.plugin(firecrawlPlugin, options)
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ success: true, data: [{ url: 'https://search.test', title: 'Search' }] }))
      .mockResolvedValueOnce(jsonResponse({ success: true, data: { html: '<h1>Fetch</h1>', metadata: { statusCode: 200 } } }))
    vi.stubGlobal('fetch', fetchMock)
    try {
      await expect(ctx.web.search({ query: 'q' })).resolves.toEqual({
        sources: [{ url: 'https://search.test', title: 'Search' }],
        truncated: false,
      })
      await expect(ctx.web.fetch({ url: 'https://fetch.test' })).resolves.toEqual({
        url: 'https://fetch.test',
        statusCode: 200,
        body: { kind: 'html', content: '<h1>Fetch</h1>' },
        truncated: false,
      })
      expect(fiber).toBeDefined()
    } finally {
      await ctx.fiber.dispose()
    }
  })
})
