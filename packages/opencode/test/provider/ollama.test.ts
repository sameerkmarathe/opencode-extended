import { describe, expect, test } from "bun:test"
import { modelsFromOllamaTags, ollamaTagsURL, shouldDiscoverOllama } from "../../src/provider/ollama"

describe("ollama discovery", () => {
  test("discovers an ollama provider and a local 11434 endpoint", () => {
    expect(shouldDiscoverOllama("ollama", { baseURL: "http://127.0.0.1:11434/v1" })).toBe(true)
    expect(shouldDiscoverOllama("local", { baseURL: "http://127.0.0.1:11434/v1" })).toBe(true)
    expect(shouldDiscoverOllama("ollama", { discover: false, baseURL: "http://127.0.0.1:11434/v1" })).toBe(false)
    expect(shouldDiscoverOllama("openai", { baseURL: "https://api.openai.com/v1" })).toBe(false)
  })

  test("reads tags from the Ollama origin, not the OpenAI-compatible path", () => {
    expect(ollamaTagsURL("http://127.0.0.1:11434/v1")).toBe("http://127.0.0.1:11434/api/tags")
  })

  test("turns installed chat models into selectable models and skips embeddings", () => {
    const models = modelsFromOllamaTags({
      providerID: "ollama",
      baseURL: "http://127.0.0.1:11434/v1",
      npm: "@ai-sdk/openai-compatible",
      tags: [{ name: "lfm2.5:latest", details: { family: "lfm" } }, { name: "nomic-embed-text:latest" }],
    })
    expect(Object.keys(models)).toEqual(["lfm2.5:latest"])
    expect(models["lfm2.5:latest"]?.capabilities.toolcall).toBe(true)
    expect(models["lfm2.5:latest"]?.api.url).toBe("http://127.0.0.1:11434/v1")
  })
})
