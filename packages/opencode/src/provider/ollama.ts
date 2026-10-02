import { ModelV2 } from "@opencode-ai/core/model"
import { ProviderV2 } from "@opencode-ai/core/provider"

export function shouldDiscoverOllama(id: string, options: Record<string, unknown> | undefined) {
  if (options?.discover === false) return false
  if (id === "ollama") return true
  const baseURL = options?.baseURL
  if (typeof baseURL !== "string") return false
  try {
    const url = new URL(baseURL)
    return url.port === "11434" || url.hostname === "ollama"
  } catch {
    return false
  }
}

export function ollamaTagsURL(baseURL: string) {
  const url = new URL(baseURL)
  url.pathname = "/api/tags"
  url.search = ""
  url.hash = ""
  return url.toString()
}

type OllamaTag = {
  name?: string
  details?: { family?: string }
}

export function modelsFromOllamaTags(input: { providerID: string; baseURL: string; npm: string; tags: OllamaTag[] }) {
  const providerID = ProviderV2.ID.make(input.providerID)
  const models: Record<string, ReturnType<typeof modelFromTag>> = {}
  for (const tag of input.tags) {
    const name = tag.name?.trim()
    if (!name || /embed/i.test(name)) continue
    models[name] = modelFromTag({
      providerID,
      id: name,
      family: tag.details?.family ?? "",
      baseURL: input.baseURL,
      npm: input.npm,
    })
  }
  return models
}

function modelFromTag(input: {
  providerID: ReturnType<typeof ProviderV2.ID.make>
  id: string
  family: string
  baseURL: string
  npm: string
}) {
  return {
    id: ModelV2.ID.make(input.id),
    providerID: input.providerID,
    api: { id: input.id, npm: input.npm, url: input.baseURL },
    name: input.id,
    family: input.family,
    status: "active" as const,
    headers: {},
    options: {},
    cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
    limit: { context: 32768, output: 8192 },
    capabilities: {
      temperature: true,
      reasoning: false,
      attachment: false,
      toolcall: true,
      input: { text: true, audio: false, image: false, video: false, pdf: false },
      output: { text: true, audio: false, image: false, video: false, pdf: false },
      interleaved: false as const,
    },
    release_date: "",
    variants: {},
  }
}
