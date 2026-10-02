import { createEffect, createMemo, createResource, createSignal, For, Show } from "solid-js"
import type { Session } from "@opencode-ai/sdk/v2/client"
import { Button } from "@opencode-ai/ui/button"
import { useServerSync } from "@/context/server-sync"
import { useLanguage } from "@/context/language"
import { useServer } from "@/context/server"
import { useTabs } from "@/context/tabs"

export function SessionSidebar() {
  const language = useLanguage()
  const server = useServer()
  const tabs = useTabs()
  const sync = useServerSync()
  const [query, setQuery] = createSignal("")
  const [limit, setLimit] = createSignal(200)
  const [rev, setRev] = createSignal(0)
  const [found] = createResource(
    () => ({ search: query().trim(), limit: limit(), rev: rev(), events: sync().sessionsRev() }),
    (input) => sync().project.browseSessions(input.search.length < 2 ? "" : input.search, input.limit),
  )
  const sessions = createMemo(() => found() ?? [])
  const [catalog, setCatalog] = createSignal<Session[]>([])
  createEffect(() => {
    if (query().trim().length >= 2) return
    const next = found()
    if (next?.length) setCatalog(next)
  })
  const open = (session: Session) => {
    const tab = tabs.addSessionTab({ server: server.key, sessionId: session.id })
    tabs.select(tab)
  }
  const openMaster = async () => {
    const known = catalog()
    const directory = known.find((session) => session.directory)?.directory
    if (!directory) return
    const existing = known.find((session) => session.title === "Master" && session.directory === directory)
    const session = existing ?? (await sync().project.createMaster(directory))
    setRev((value) => value + 1)
    open(session)
  }

  return (
    <aside class="flex h-full w-[280px] shrink-0 flex-col gap-1 border-e border-border-weak-base bg-background-base py-2">
      <input
        type="search"
        aria-label={language.t("sidebar.sessions.search")}
        placeholder={language.t("sidebar.sessions.search")}
        value={query()}
        class="mx-2 mb-1 h-8 rounded-md border border-border-weak bg-surface-base px-2 text-12-regular text-text-base outline-none focus:border-border-strong"
        onInput={(event) => {
          setLimit(200)
          setQuery(event.currentTarget.value)
        }}
      />
      <Button
        variant="ghost"
        class="mx-2 flex w-auto justify-start text-14-regular text-text-strong"
        size="large"
        onClick={() => void openMaster()}
      >
        {language.t("sidebar.sessions.master")}
      </Button>
      <div class="min-h-0 flex-1 overflow-y-auto">
        <For each={sessions()}>
          {(session) => (
            <button
              type="button"
              class="flex w-full truncate px-3 py-1.5 text-left text-14-regular text-text-base hover:bg-surface-raised-base-hover"
              onClick={() => open(session)}
            >
              {session.title || session.id}
            </button>
          )}
        </For>
        <Show when={!found.loading && sessions().length === 0}>
          <div class="px-3 py-1 text-12-regular text-text-weak">{language.t("sidebar.sessions.none")}</div>
        </Show>
        <Show when={!query().trim() && sessions().length >= limit()}>
          <Button
            variant="ghost"
            class="mx-2 flex w-auto justify-start text-14-regular text-text-weak"
            size="large"
            onClick={() => setLimit((value) => value + 200)}
          >
            {language.t("common.loadMore")}
          </Button>
        </Show>
      </div>
    </aside>
  )
}
