// @vitest-environment jsdom
/**
 * Reasoning-level editing on pi-ai model rows.
 *
 * The levels come from the pi-ai contract (`THINKING_LEVELS` in
 * `packages/llm/llm-pi-ai/src/catalog.ts`): each key of a model's
 * `reasoningEfforts` dict is a selectable level, each value the wire spelling
 * dispatch sends. The editor only toggles keys — identity levels are written
 * as themselves, `off` is written valueless (`null`, "supported, send
 * nothing") — and never rewrites wire spellings it did not set, so a
 * hand-written `max: ultra` survives every edit made here.
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import Schema from '@deepseek-ai/schemastery'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-web-react'
import type { RpcResponse, SettingsNamespaceView } from '@deepseek-ai/dsh-api-remotes/client'
import { ModelsSection } from '../src/client/ModelsSection.tsx'
import type { ModelsSectionInjected } from '../src/client/ModelsSection.tsx'
import { ModelListEditor } from '../src/client/ModelListEditor.tsx'
import type { ModelDraft } from '../src/client/ModelListEditor.tsx'
import { ModelsSettingsStore } from '../src/client/store.ts'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)

const t: ModelsSectionInjected['t'] = key => en[key]

/** Canonical pi-ai thinking levels in escalation order (the contract's `THINKING_LEVELS`). */
const LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const

/** Checkbox accessible name for one level on row 1, matching the editor's labeling. */
const box = (level: string): string => `${level.charAt(0).toUpperCase()}${level.slice(1)} 1`

const PiAiConfig = Schema.object({
  providers: Schema.dict(Schema.object({
    apiKeyEnv: Schema.string().role('credential-ref'),
    baseURL: Schema.string(),
    models: Schema.array(Schema.object({
      id: Schema.string().required(),
      name: Schema.string(),
      contextWindow: Schema.number(),
      maxTokens: Schema.number(),
    })),
  })),
})

let nextRpc = 0
function ok<T>(value: T): RpcResponse<T> {
  return { rpcId: `r-${nextRpc++}` as never, result: { ok: true, value } }
}

function piAiNamespace(
  providers: Record<string, unknown>,
  userProviders: Record<string, unknown> = providers,
): SettingsNamespaceView {
  return {
    ns: 'llm-pi-ai',
    schema: JSON.parse(JSON.stringify(PiAiConfig.toJSON())) as unknown,
    value: { providers },
    base: { providers: {} },
    user: { providers: userProviders },
    applies: 'live',
    secrets: [],
    revision: 3,
  }
}

function scriptedFace(options: { providers?: Record<string, unknown> } = {}) {
  const providers = options.providers ?? {
    openai: { apiKeyEnv: 'OPENAI_API_KEY', baseURL: 'https://proxy.example/v1' },
  }
  const namespace = piAiNamespace(providers)
  const mutate = vi.fn(() => Promise.resolve(ok(namespace)))
  const face = {
    llm: {
      providers: vi.fn(() => Promise.resolve(ok({
        providers: Object.keys(providers).map(provider => ({
          provider,
          displayName: provider,
          settingsNs: 'llm-pi-ai',
          settingsPath: ['providers', provider],
          active: true,
          declared: false,
        })),
      }))),
      models: vi.fn(() => Promise.resolve(ok({ groups: [], failures: [] }))),
      discoverModels: vi.fn(() => Promise.resolve(ok({ models: [] }))),
    },
    settings: {
      describe: vi.fn(() => Promise.resolve(ok({ writable: true, namespaces: [namespace] }))),
      update: vi.fn(),
      replace: vi.fn(),
      mutate,
    },
    credentials: {
      describe: vi.fn((payload: { refs: string[] }) => Promise.resolve(ok({
        credentials: Object.fromEntries(payload.refs.map(ref => [ref, { configured: false, writable: true }])),
      }))),
      set: vi.fn(() => Promise.resolve(ok({}))),
      unset: vi.fn(),
    },
  }
  return { face, mutate, namespace }
}

type WireFace = ConstructorParameters<typeof ModelsSettingsStore>[0]

async function mountSection(options: { providers?: Record<string, unknown> } = {}) {
  const scripted = scriptedFace(options)
  const controller = new ModelsSettingsStore(scripted.face as unknown as WireFace)
  await controller.load()
  const injected: ModelsSectionInjected = {
    controller,
    useSnapshot: bindSnapshotSelector(controller.store),
    api: scripted.face as never,
    t,
  }
  render(<ModelsSection {...injected} />)
  return { ...scripted, controller }
}

/** Open the editor of one configured row and its customized fold. */
function openEditor(provider: string): void {
  const row = screen.getByText(provider).closest('li')
  if (row === null) throw new Error(`no row for ${provider}`)
  const edit = [...row.querySelectorAll('button')].find(button => button.textContent === en.edit)
  if (edit === undefined) throw new Error('no edit button')
  fireEvent.click(edit)
  const summary = document.querySelector('summary')
  if (summary === null) throw new Error('no customized fold')
  fireEvent.click(summary)
}

/** Open one model row's advanced fold, where capacities and levels live. */
function expandModel(index: number): void {
  fireEvent.click(screen.getByLabelText(`${en.modelAdvanced} ${index}`))
}

interface MutateCall {
  ns: string
  ops: { op: string; path: string[]; value?: unknown }[]
}

/** The first recorded settings write; fails the case when nothing was written. */
function firstMutate(mutate: ReturnType<typeof vi.fn>): MutateCall {
  const call = mutate.mock.calls[0]?.[0] as MutateCall | undefined
  if (call === undefined) throw new Error('no settings write was recorded')
  return call
}

/** Render one row's editor directly and capture every models array it emits. */
function renderRow(model: ModelDraft) {
  const emitted: ModelDraft[][] = []
  render(
    <ModelListEditor
      models={[model]}
      onChange={(next) => { emitted.push(next) }}
      probe={{ settingsNs: 'llm-pi-ai' }}
      api={{ llm: { discoverModels: vi.fn(() => Promise.resolve(ok({ models: [] }))) } } as never}
      t={t}
      disabled={false}
    />,
  )
  fireEvent.click(screen.getByLabelText(`${en.modelAdvanced} 1`))
  return emitted
}

function checked(level: string): boolean {
  return screen.getByRole<HTMLInputElement>('checkbox', { name: box(level) }).checked
}

describe('reasoning levels editor', () => {
  it('leaves a model with no reasoningEfforts unchanged', async () => {
    const { mutate } = await mountSection({
      providers: { openai: { baseURL: 'https://proxy.example/v1', models: [{ id: 'm', name: 'M' }] } },
    })
    openEditor('openai')
    expandModel(1)
    fireEvent.change(screen.getByLabelText(`${en.modelName} 1`), { target: { value: 'M2' } })
    fireEvent.click(screen.getByText(en.apply))

    await waitFor(() => { expect(mutate).toHaveBeenCalled() })
    expect(firstMutate(mutate).ops).toEqual([
      { op: 'set', path: ['providers', 'openai', 'models'], value: [{ id: 'm', name: 'M2' }] },
    ])
  })

  it('renders existing identity-mapped efforts selected', () => {
    renderRow({ id: 'm', reasoningEfforts: { medium: 'medium', high: 'high' } })
    expect(checked('medium')).toBe(true)
    expect(checked('high')).toBe(true)
    expect(checked('low')).toBe(false)
    expect(checked('off')).toBe(false)
    expect(checked('max')).toBe(false)
  })

  it('writes an identity mapping when a level is enabled', async () => {
    const { mutate } = await mountSection({
      providers: { openai: { baseURL: 'https://proxy.example/v1', models: [{ id: 'm' }] } },
    })
    openEditor('openai')
    expandModel(1)
    fireEvent.click(screen.getByRole('checkbox', { name: box('medium') }))
    fireEvent.click(screen.getByText(en.apply))

    await waitFor(() => { expect(mutate).toHaveBeenCalled() })
    expect(firstMutate(mutate).ops).toEqual([
      {
        op: 'set',
        path: ['providers', 'openai', 'models'],
        value: [{ id: 'm', reasoningEfforts: { medium: 'medium' } }],
      },
    ])
  })

  it('removes a level when it is disabled', async () => {
    const { mutate } = await mountSection({
      providers: {
        openai: {
          baseURL: 'https://proxy.example/v1',
          models: [{ id: 'm', reasoningEfforts: { medium: 'medium', high: 'high' } }],
        },
      },
    })
    openEditor('openai')
    expandModel(1)
    fireEvent.click(screen.getByRole('checkbox', { name: box('medium') }))
    fireEvent.click(screen.getByText(en.apply))

    await waitFor(() => { expect(mutate).toHaveBeenCalled() })
    expect(firstMutate(mutate).ops).toEqual([
      {
        op: 'set',
        path: ['providers', 'openai', 'models'],
        value: [{ id: 'm', reasoningEfforts: { high: 'high' } }],
      },
    ])
  })

  it('keeps a non-identity wire mapping through unrelated edits', async () => {
    const { mutate } = await mountSection({
      providers: {
        openai: {
          baseURL: 'https://proxy.example/v1',
          models: [{ id: 'm', reasoningEfforts: { off: null, high: 'high', max: 'ultra' } }],
        },
      },
    })
    openEditor('openai')
    expandModel(1)
    // The renamed level still reads as offered, not as a level to repair.
    expect(checked('max')).toBe(true)
    expect(checked('off')).toBe(true)
    fireEvent.change(screen.getByLabelText(`${en.modelMaxTokens} 1`), { target: { value: '32K' } })
    fireEvent.click(screen.getByText(en.apply))

    await waitFor(() => { expect(mutate).toHaveBeenCalled() })
    expect(firstMutate(mutate).ops).toEqual([
      {
        op: 'set',
        path: ['providers', 'openai', 'models'],
        value: [{ id: 'm', maxTokens: 32_000, reasoningEfforts: { off: null, high: 'high', max: 'ultra' } }],
      },
    ])
  })

  it('keeps the valueless Off representation through unrelated edits', async () => {
    const { mutate } = await mountSection({
      providers: {
        openai: {
          baseURL: 'https://proxy.example/v1',
          models: [{ id: 'm', reasoningEfforts: { off: null, high: 'high' } }],
        },
      },
    })
    openEditor('openai')
    expandModel(1)
    fireEvent.change(screen.getByLabelText(`${en.modelContextWindow} 1`), { target: { value: '256K' } })
    fireEvent.click(screen.getByText(en.apply))

    await waitFor(() => { expect(mutate).toHaveBeenCalled() })
    const value = firstMutate(mutate).ops[0]?.value as ModelDraft[]
    const efforts = value[0]?.['reasoningEfforts'] as Record<string, unknown>
    // Present with a null (valueless) spelling — not rewritten to `off: 'off'`.
    expect('off' in efforts).toBe(true)
    expect(efforts['off']).toBe(null)
    expect(efforts).toEqual({ off: null, high: 'high' })
  })

  it('preserves reasoningEfforts across id, name, and capacity edits', async () => {
    const { mutate } = await mountSection({
      providers: {
        openai: {
          baseURL: 'https://proxy.example/v1',
          models: [{ id: 'm', reasoningEfforts: { low: 'low', high: 'high' } }],
        },
      },
    })
    openEditor('openai')
    expandModel(1)
    fireEvent.change(screen.getByLabelText(`${en.modelId} 1`), { target: { value: 'm2' } })
    fireEvent.change(screen.getByLabelText(`${en.modelName} 1`), { target: { value: 'M2' } })
    fireEvent.change(screen.getByLabelText(`${en.modelContextWindow} 1`), { target: { value: '128K' } })
    fireEvent.change(screen.getByLabelText(`${en.modelMaxTokens} 1`), { target: { value: '8K' } })
    fireEvent.click(screen.getByText(en.apply))

    await waitFor(() => { expect(mutate).toHaveBeenCalled() })
    expect(firstMutate(mutate).ops).toEqual([
      {
        op: 'set',
        path: ['providers', 'openai', 'models'],
        value: [{
          id: 'm2',
          name: 'M2',
          contextWindow: 128_000,
          maxTokens: 8000,
          reasoningEfforts: { low: 'low', high: 'high' },
        }],
      },
    ])
  })

  it('emits a profile entry the reasoning backend already accepts', async () => {
    // The first user route declares the Muse levels; the payload below is the
    // exact `PiAiModelProfile` input shape `resolveRouteModels` materializes
    // into `resolveModelInfo().reasoning` (see `catalog.spec.ts` /
    // `adapter.spec.ts` for the backend half of this round trip).
    const { mutate } = await mountSection({
      providers: {
        'meta-muse': {
          baseURL: 'https://gateway.example/v1',
          models: [{ id: 'muse-spark-1.3-contributor' }],
        },
      },
    })
    openEditor('meta-muse')
    expandModel(1)
    for (const level of ['minimal', 'low', 'medium', 'high', 'xhigh']) {
      fireEvent.click(screen.getByRole('checkbox', { name: box(level) }))
    }
    fireEvent.click(screen.getByText(en.apply))

    await waitFor(() => { expect(mutate).toHaveBeenCalled() })
    expect(firstMutate(mutate).ops).toEqual([
      {
        op: 'set',
        path: ['providers', 'meta-muse', 'models'],
        value: [{
          id: 'muse-spark-1.3-contributor',
          reasoningEfforts: {
            minimal: 'minimal',
            low: 'low',
            medium: 'medium',
            high: 'high',
            xhigh: 'xhigh',
          },
        }],
      },
    ])
  })

  it('enabling a level on a non-reasoning model replaces the false marker', () => {
    const emitted = renderRow({ id: 'm', reasoningEfforts: false })
    expect(checked('high')).toBe(false)
    fireEvent.click(screen.getByRole('checkbox', { name: box('high') }))
    expect(emitted).toEqual([[{ id: 'm', reasoningEfforts: { high: 'high' } }]])
  })

  it('disabling the last level drops the field instead of storing an empty dict', () => {
    const emitted = renderRow({ id: 'm', reasoningEfforts: { medium: 'medium' } })
    fireEvent.click(screen.getByRole('checkbox', { name: box('medium') }))
    // An empty dict is refused by resolution; absence means "no declaration".
    expect(emitted).toEqual([[{ id: 'm' }]])
  })

  it('offers every canonical level in escalation order', () => {
    renderRow({ id: 'm' })
    const boxes = screen.getAllByRole('checkbox')
    expect(boxes.map(box => box.getAttribute('aria-label'))).toEqual(
      LEVELS.map(level => box(level)),
    )
  })
})
