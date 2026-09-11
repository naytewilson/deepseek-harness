/** Package-owned invariant companion for `@deepseek-ai/dsh-web-firecrawl`. */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-web-firecrawl'

/** Cordis companion plugin name. */
export const name = 'web-firecrawl-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/** No independent event relation exists beyond the owning web seam contracts. */
const install: InvariantInstaller = () => {}

/** Register this package's invariant companion. */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
