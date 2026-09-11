/** Register self-hosted Firecrawl search and fetch providers in `ctx.web`. */

import type { Context } from '@deepseek-ai/cordis'
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-web'
import {
  FirecrawlFetchProvider,
  FirecrawlSearchProvider,
  FIRECRAWL_DEFAULT_BASE_URL,
  FIRECRAWL_DEFAULT_MAX_RESPONSE_BYTES,
  FIRECRAWL_DEFAULT_SEARCH_LIMIT,
} from './provider.ts'
import type { FirecrawlProviderOptions } from './provider.ts'

export {
  endpoint,
  FirecrawlFetchProvider,
  FirecrawlSearchProvider,
  FIRECRAWL_DEFAULT_BASE_URL,
  FIRECRAWL_DEFAULT_MAX_RESPONSE_BYTES,
  FIRECRAWL_DEFAULT_SEARCH_LIMIT,
  FIRECRAWL_PROVIDER_ID,
  validBaseURL,
} from './provider.ts'
export type { FirecrawlProviderOptions } from './provider.ts'
export type {
  FirecrawlScrapeMetadata,
  FirecrawlScrapeResponse,
  FirecrawlSearchItem,
  FirecrawlSearchResponse,
} from './types.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'web-firecrawl'

/** The web seam this provider registers into. */
export const inject = ['web']

/** Plugin config for a self-hosted Firecrawl API. */
export interface Config {
  /** API root, or a URL ending in `/v1`; falls back to `FIRECRAWL_BASE_URL`. */
  baseURL?: string
  /** Optional API key for an authenticated Firecrawl deployment. */
  apiKey?: string
  /** Default search result count when a tool request omits its cap. */
  searchLimit?: number
  /** Maximum JSON response body accepted from Firecrawl. */
  maxResponseBytes?: number
}

export const Config: z<Config> = z.object({
  baseURL: z.string(),
  apiKey: z.string().role('secret'),
  searchLimit: z.number().step(1).min(1).default(FIRECRAWL_DEFAULT_SEARCH_LIMIT),
  maxResponseBytes: z.number().step(1).min(1).default(FIRECRAWL_DEFAULT_MAX_RESPONSE_BYTES),
})

/** Register both Firecrawl providers with the web seam. */
export function apply(ctx: Context, config: Config): void {
  const environment = launchEnvironmentOf(ctx)
  const environmentApiKey = environment.get('FIRECRAWL_API_KEY')?.value
  const options: FirecrawlProviderOptions = {
    baseURL: config.baseURL
      ?? environment.get('FIRECRAWL_BASE_URL')?.value
      ?? FIRECRAWL_DEFAULT_BASE_URL,
    ...config.apiKey !== undefined ? { apiKey: config.apiKey } :
      environmentApiKey === undefined ? {} : { apiKey: environmentApiKey },
    searchLimit: config.searchLimit ?? FIRECRAWL_DEFAULT_SEARCH_LIMIT,
    maxResponseBytes: config.maxResponseBytes ?? FIRECRAWL_DEFAULT_MAX_RESPONSE_BYTES,
  }
  ctx.web.registerSearchProvider(new FirecrawlSearchProvider(options))
  ctx.web.registerFetchProvider(new FirecrawlFetchProvider(options))
}
