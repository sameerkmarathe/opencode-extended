import { Database } from "@opencode-ai/core/database/database"
import { Effect, Schema, Scope } from "effect"
import { Agent } from "../agent/agent"
import { Session } from "@/session/session"
import { MessageV2 } from "../session/message-v2"
import type { SessionPrompt } from "../session/prompt"
import { Provider } from "@/provider/provider"
import { MessageID, SessionID } from "../session/schema"
import type { TaskPromptOps } from "./task"
import * as Tool from "./tool"

const DEFAULT_AGENT = "build"
const REPLY_LIMIT = 4000
const PREVIEW_LIMIT = 200
const CHILD_DENIES = ["session_new", "session_send"].map((permission) => ({
  permission,
  pattern: "*",
  action: "deny" as const,
}))

export const NewParameters = Schema.Struct({
  title: Schema.String.annotate({ description: "Short name for the new session, e.g. 'Plan: todo API'" }),
  prompt: Schema.String.annotate({ description: "The full instructions the new session should work on" }),
  agent: Schema.optional(Schema.String).annotate({
    description: "Agent for the new session. Default 'build' (can read, write and run code). Use 'plan' for planning only.",
  }),
  model: Schema.optional(Schema.String).annotate({
    description: "Model as 'provider/model', e.g. 'ollama/lfm2.5:latest'. Default: the model of this chat.",
  }),
  instructions: Schema.optional(Schema.String).annotate({
    description: "Extra system instructions for the new session (role, rules, style). Optional.",
  }),
})

export const SendParameters = Schema.Struct({
  session_id: Schema.String.annotate({ description: "Id of an existing session, from session_new or session_list" }),
  prompt: Schema.String.annotate({ description: "The next message to send to that session" }),
})

export const ListParameters = Schema.Struct({
  session_id: Schema.optional(Schema.String).annotate({
    description: "Give an id to read that session's latest reply in full. Omit to list every session.",
  }),
})

export const SessionNewTool = Tool.define(
  "session_new",
  Effect.gen(function* () {
    const control = yield* makeControl()
    return {
      description: [
        "Create a NEW separate chat session that starts working right away in the background, and return its session id.",
        "The user can open it from the sidebar and it runs in parallel with this chat.",
        "ALWAYS use this when the user asks for a new, separate, parallel or another session (for example 'plan it in one session and implement it in another').",
        "Call it once per session; call it several times in one turn to run sessions at the same time.",
        "You get a note here when each session finishes. Use session_list to read results and session_send to continue a session.",
        "In your reply, link every session you mention as a markdown link [title](/session/<id>) so the user can open it.",
      ].join(" "),
      parameters: NewParameters,
      execute: (params: Schema.Schema.Type<typeof NewParameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const agentName = params.agent ?? DEFAULT_AGENT
          const agent = yield* control.agents.get(agentName)
          if (!agent) throw new Error(`Unknown agent "${agentName}". Use "build" or "plan".`)
          const model = params.model ? Provider.parseModel(params.model) : yield* control.currentModel(ctx)
          if (model)
            yield* control.providers
              .getModel(model.providerID, model.modelID)
              .pipe(Effect.mapError(() => new Error(`Unknown model "${params.model}". Use 'provider/model'.`)))
          const session = yield* control.sessions.create({
            parentID: ctx.sessionID,
            title: params.title,
            agent: agent.name,
            permission: CHILD_DENIES,
          })
          yield* control.run(ctx, session, { agent: agent.name, model, system: params.instructions }, params.prompt)
          const modelName = model ? `${model.providerID}/${model.modelID}` : "default"
          return {
            title: params.title,
            metadata: { sessionId: session.id },
            output: `Started session ${link(session)} (agent ${agent.name}, model ${modelName}). It is running in the background.`,
          }
        }).pipe(Effect.orDie),
    }
  }),
)

export const SessionSendTool = Tool.define(
  "session_send",
  Effect.gen(function* () {
    const control = yield* makeControl()
    return {
      description: [
        "Send a follow-up message to an EXISTING session so it continues its work in the background.",
        "Use this to steer or continue sessions you created with session_new or found with session_list or session_search.",
      ].join(" "),
      parameters: SendParameters,
      execute: (params: Schema.Schema.Type<typeof SendParameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const session = yield* control.sessions.get(SessionID.make(params.session_id))
          yield* control.run(ctx, session, { agent: session.agent ?? DEFAULT_AGENT }, params.prompt)
          return {
            title: session.title,
            metadata: { sessionId: session.id },
            output: `Sent to session ${link(session)}. It is working in the background.`,
          }
        }).pipe(Effect.orDie),
    }
  }),
)

export const SessionListTool = Tool.define(
  "session_list",
  Effect.gen(function* () {
    const sessions = yield* Session.Service
    return {
      description: [
        "List every session in this project with its id, title and latest reply,",
        "or pass session_id to read that session's latest reply in full.",
      ].join(" "),
      parameters: ListParameters,
      execute: (params: Schema.Schema.Type<typeof ListParameters>) =>
        Effect.gen(function* () {
          if (params.session_id) {
            const session = yield* sessions.get(SessionID.make(params.session_id))
            const reply = latestReply(yield* sessions.messages({ sessionID: session.id }))
            return {
              title: session.title,
              metadata: { count: 1 },
              output: `session ${link(session)}\n${reply.slice(0, REPLY_LIMIT) || "(no reply yet)"}`,
            }
          }
          const all = yield* sessions.list({ limit: 50 })
          const lines = yield* Effect.forEach(all, (session) =>
            sessions.messages({ sessionID: session.id }).pipe(
              Effect.map((messages) => {
                const reply = latestReply(messages).replace(/\s+/g, " ").slice(0, PREVIEW_LIMIT)
                return `session ${link(session)} agent=${session.agent ?? "-"}${session.parentID ? ` parent=${session.parentID}` : ""}\n  ${reply || "(no reply yet)"}`
              }),
            ),
          )
          return { title: "Sessions", metadata: { count: all.length }, output: lines.join("\n") || "No sessions" }
        }).pipe(Effect.orDie),
    }
  }),
)

function makeControl() {
  return Effect.gen(function* () {
    const sessions = yield* Session.Service
    const agents = yield* Agent.Service
    const database = yield* Database.Service
    const scope = yield* Scope.Scope
    const providers = yield* Provider.Service

    const currentModel = Effect.fn("SessionControl.currentModel")(function* (ctx: Tool.Context) {
      const msg = yield* MessageV2.get({ sessionID: ctx.sessionID, messageID: ctx.messageID }).pipe(
        Effect.provideService(Database.Service, database),
        Effect.orDie,
      )
      return msg.info.role === "assistant" ? { modelID: msg.info.modelID, providerID: msg.info.providerID } : undefined
    })

    const run = Effect.fn("SessionControl.run")(function* (
      ctx: Tool.Context,
      session: Session.Info,
      input: Pick<SessionPrompt.PromptInput, "agent" | "model" | "system">,
      text: string,
    ) {
      const ops = ctx.extra?.promptOps as TaskPromptOps | undefined
      if (!ops) throw new Error("session tools require promptOps")
      yield* Effect.gen(function* () {
        const result = yield* ops.prompt({
          ...input,
          messageID: MessageID.ascending(),
          sessionID: session.id,
          parts: yield* ops.resolvePromptParts(text),
        })
        const reply = result.parts.findLast((part) => part.type === "text")?.text ?? ""
        const parent = yield* sessions.get(ctx.sessionID)
        yield* ops.prompt({
          sessionID: ctx.sessionID,
          agent: parent.agent ?? ctx.agent,
          noReply: true,
          parts: [
            {
              type: "text",
              synthetic: true,
              text: `Session ${link(session)} finished:\n${reply.slice(0, REPLY_LIMIT)}`,
            },
          ],
        })
      }).pipe(Effect.ignore, Effect.forkIn(scope, { startImmediately: true }))
    })

    return { sessions, agents, providers, currentModel, run }
  })
}

function link(session: Session.Info) {
  return `[${session.title.replace(/[[\]]/g, "")}](/session/${session.id}) (id ${session.id})`
}

function latestReply(messages: ReadonlyArray<{ info: { role: string }; parts: ReadonlyArray<{ type: string }> }>) {
  const last = messages.findLast((message) => message.info.role === "assistant")
  const part = last?.parts.findLast((item) => item.type === "text")
  return part && "text" in part && typeof part.text === "string" ? part.text : ""
}
