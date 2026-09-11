# @deepseek-ai/dsh-web-firecrawl

English | [中文](README.zh.md)

A self-hosted [Firecrawl](https://github.com/firecrawl/firecrawl) implementation of the Harness [web capability seam](../web/README.md) (`ctx.web`). The plugin registers one `firecrawl` provider in each seam registry: `POST /v1/search` for `web_search` and `POST /v1/scrape` for `web_fetch`.

This is an implementation package. It does not own `ctx.web` and it does not register model-facing tools; [`dsh-tool-web`](../tool-web/README.md) remains the consumer. Search and fetch share one configured Firecrawl endpoint so a composition can pin both capabilities to the same self-hosted service.

## Config

| Key | Default | Meaning |
|---|---|---|
| `baseURL` | `$FIRECRAWL_BASE_URL`, then `http://127.0.0.1:33102` | Self-hosted Firecrawl API root, with or without a `/v1` suffix. Invalid or credential-bearing URLs make both providers unavailable. |
| `apiKey` | `$FIRECRAWL_API_KEY` | Optional API key for an authenticated deployment. It is sent only to the configured endpoint, with redirect following disabled. |
| `searchLimit` | `8` | Default search result count when the seam request omits `maxResults`. |
| `maxResponseBytes` | `10000000` | Maximum JSON response size accepted from Firecrawl. |

```yaml
- id: web
  config:
    searchProvider: firecrawl
    fetchProvider: firecrawl
- insert:
    - id: web-firecrawl
      name: '@deepseek-ai/dsh-web-firecrawl'
      config:
        baseURL: http://127.0.0.1:33102
- id: web-search-deepseek
  disabled: true
- id: tool-web
  config:
    search: true
    fetch: true
```

## Mapping

Search sends `{ query, limit }` to `/v1/search`. Each Firecrawl result with a non-empty URL becomes a `WebSearchSource`: `url` ← `url`, `title` ← `title`, `snippet` ← `description` (or `snippet`), and `publishedAt` ← `publishedDate`. Duplicate URLs are removed and the web seam owns the final `maxResults` bound.

Fetch sends `{ url, formats: ['markdown', 'html'], skipTlsVerification: false }` to `/v1/scrape`. A returned `data.markdown` becomes a seam `text` body; otherwise `data.html` becomes an `html` body. `metadata.url` and `metadata.statusCode` carry the final URL and origin response status when present. The explicit `skipTlsVerification: false` is part of the adapter contract and prevents an upstream default from requesting the unsafe mode.

Both provider requests use `redirect: 'error'`, pass cancellation through, and classify transport, HTTP, malformed-envelope, and abort failures as `WebError` (`WEB_PROVIDER_ERROR` or `WEB_ABORTED`). The provider never performs a network request from `available()`.

## Model Experience

Indirectly, through [`dsh-tool-web`](../tool-web/README.md), which retains bounded Firecrawl search URLs and snippets or Firecrawl Markdown/HTML fetch content. The provider contributes no additional prompt text or model-facing schema.

#### KV Cache effect

No direct invalidation; the named consumer owns request-prefix changes. Firecrawl results are independent auxiliary web calls.

## Known Limitations and Deferred Work

- **Configured-endpoint trust** — the plugin validates the administrator-supplied Firecrawl base URL but does not add an SSRF policy for the upstream service; the self-hosted Firecrawl/adapter deployment owns target validation.
- **Firecrawl API shape** — this package maps the current `/v1/search` and `/v1/scrape` envelopes only; extraction, crawl, map, actions, and provider-specific search controls remain outside the provider-neutral `ctx.web` contract.
- **Response bound is post-read** — the package rejects oversized declared and decoded response bodies, but the current implementation relies on the Fetch API's response reader before applying the decoded-size check; a streaming cap is deferred.
- **No shipped default activation** — the plugin is available to profiles through an explicit patch; the base bundle continues to select the DeepSeek provider until a deployment opts into self-hosted Firecrawl.
