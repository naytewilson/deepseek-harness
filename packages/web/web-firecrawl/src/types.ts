/** JSON fields returned by the self-hosted Firecrawl search endpoint. */
export interface FirecrawlSearchItem {
  readonly url?: unknown
  readonly title?: unknown
  readonly description?: unknown
  readonly snippet?: unknown
  readonly publishedDate?: unknown
}

/** JSON envelope returned by `POST /v1/search`. */
export interface FirecrawlSearchResponse {
  readonly success?: unknown
  readonly data?: unknown
  readonly error?: unknown
  readonly code?: unknown
  readonly message?: unknown
}

/** Metadata fields returned inside Firecrawl's scrape result. */
export interface FirecrawlScrapeMetadata {
  readonly url?: unknown
  readonly statusCode?: unknown
  readonly title?: unknown
  readonly contentType?: unknown
}

/** JSON envelope returned by `POST /v1/scrape`. */
export interface FirecrawlScrapeResponse {
  readonly success?: unknown
  readonly data?: unknown
  readonly error?: unknown
  readonly code?: unknown
  readonly message?: unknown
}
