import { Database } from "@opencode-ai/core/database/database"
import { MessageTable, PartTable, SessionTable } from "@opencode-ai/core/session/sql"
import { and, desc, eq, sql } from "drizzle-orm"
import { Effect, Schema } from "effect"
import { SessionID } from "../session/schema"
import * as Tool from "./tool"

const LIMIT = 20
const SNIPPET = 240

export const Parameters = Schema.Struct({
  query: Schema.String.annotate({
    description: "Keywords to find in past questions and answers. Every word must appear in the same message part.",
  }),
  session_id: Schema.optional(Schema.String).annotate({
    description: "Only search this session. Omit to search every session.",
  }),
})

export const SessionSearchTool = Tool.define(
  "session_search",
  Effect.gen(function* () {
    const database = yield* Database.Service
    return {
      description: [
        "Keyword search over the text of every session: user questions and assistant answers.",
        "Returns session id, title, role, and a snippet. Continue a child session with the task tool and its task_id.",
      ].join(" "),
      parameters: Parameters,
      execute: (params: { query: string; session_id?: string }) =>
        Effect.gen(function* () {
          const words = params.query.split(/\s+/).filter(Boolean)
          if (words.length === 0) throw new Error("query is required")
          const text = sql<string>`json_extract(${PartTable.data}, '$.text')`
          // ponytail: LIKE scan over JSON parts, no index. Add an FTS5 table if sessions grow large.
          const rows = yield* database.db
            .select({
              sessionID: PartTable.session_id,
              messageID: PartTable.message_id,
              title: SessionTable.title,
              role: sql<string>`json_extract(${MessageTable.data}, '$.role')`,
              text,
            })
            .from(PartTable)
            .innerJoin(MessageTable, eq(MessageTable.id, PartTable.message_id))
            .innerJoin(SessionTable, eq(SessionTable.id, PartTable.session_id))
            .where(
              and(
                sql`json_extract(${PartTable.data}, '$.type') = 'text'`,
                params.session_id ? eq(PartTable.session_id, SessionID.make(params.session_id)) : undefined,
                ...words.map((word) => sql`${text} LIKE ${`%${escapeLike(word)}%`} ESCAPE '\\'`),
              ),
            )
            .orderBy(desc(PartTable.time_created))
            .limit(LIMIT)
            .all()
            .pipe(Effect.orDie)
          if (rows.length === 0) return { title: params.query, metadata: { matches: 0 }, output: "No matches" }
          return {
            title: params.query,
            metadata: { matches: rows.length },
            output: rows
              .map((row) =>
                [
                  `session ${row.sessionID} "${row.title}" (${row.role}, message ${row.messageID})`,
                  `  ${snippet(row.text ?? "", words[0])}`,
                ].join("\n"),
              )
              .join("\n\n"),
          }
        }),
    }
  }),
)

export function snippet(text: string, word: string) {
  const at = Math.max(0, text.toLowerCase().indexOf(word.toLowerCase()))
  const start = Math.max(0, at - SNIPPET / 2)
  const cut = text.slice(start, start + SNIPPET).replace(/\s+/g, " ")
  return (start > 0 ? "…" : "") + cut + (start + SNIPPET < text.length ? "…" : "")
}

function escapeLike(word: string) {
  return word.replace(/[\\%_]/g, (char) => `\\${char}`)
}
