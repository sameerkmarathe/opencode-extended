import { Effect, Option, Schema, SchemaGetter } from "effect"
import * as Tool from "./tool"
import { Question } from "../question"
import { ToolJsonSchema } from "./json-schema"
import DESCRIPTION from "./question.txt"

export const Parameters = Schema.Struct({
  questions: Schema.mutable(Schema.Array(Question.Prompt)).annotate({ description: "Questions to ask" }),
})

// Small local models often send a flat question, a stringified (even Python-literal) array,
// `label`/`description` instead of `question`, or bare string options. Repair those before strict decoding.
const LenientParameters = Schema.Unknown.pipe(
  Schema.decodeTo(Parameters, {
    decode: SchemaGetter.transform((value) => repair(value) as typeof Parameters.Encoded),
    encode: SchemaGetter.transform((value) => value),
  }),
)

type Metadata = {
  answers: ReadonlyArray<Question.Answer>
}

export const QuestionTool = Tool.define<typeof LenientParameters, Metadata, Question.Service>(
  "question",
  Effect.gen(function* () {
    const question = yield* Question.Service

    return {
      description: DESCRIPTION,
      parameters: LenientParameters,
      jsonSchema: ToolJsonSchema.fromSchema(Parameters),
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context<Metadata>) =>
        Effect.gen(function* () {
          const answers = yield* question.ask({
            sessionID: ctx.sessionID,
            questions: params.questions,
            tool: ctx.callID ? { messageID: ctx.messageID, callID: ctx.callID } : undefined,
          })

          const formatted = params.questions
            .map((q, i) => `"${q.question}"="${answers[i]?.length ? answers[i].join(", ") : "Unanswered"}"`)
            .join(", ")

          return {
            title: `Asked ${params.questions.length} question${params.questions.length > 1 ? "s" : ""}`,
            output: `User has answered your questions: ${formatted}. You can now continue with the user's answers in mind.`,
            metadata: {
              answers,
            },
          }
        }).pipe(Effect.orDie),
    }
  }),
)

function repair(input: unknown) {
  const args = parse(input)
  const list = isRecord(args) && "questions" in args ? parse(args.questions) : args
  if (!Array.isArray(list) && !isRecord(list)) return args
  return {
    questions: (Array.isArray(list) ? list : [list]).filter(isRecord).map((item) => {
      const text = [item.question, item.label, item.description, item.header].find((v) => typeof v === "string")
      return {
        ...item,
        question: text,
        header: typeof item.header === "string" ? item.header : text?.slice(0, 30),
        options: (Array.isArray(item.options) ? item.options : []).map((option) => {
          if (typeof option === "string") return { label: option, description: option }
          if (isRecord(option)) return { ...option, description: option.description ?? option.label }
          return option
        }),
      }
    }),
  }
}

function parse(value: unknown) {
  if (typeof value !== "string") return value
  const json = Schema.decodeUnknownOption(Schema.UnknownFromJsonString)
  return Option.getOrElse(
    Option.orElse(json(value), () =>
      json(
        value
          .replaceAll("'", '"')
          .replace(/\bTrue\b/g, "true")
          .replace(/\bFalse\b/g, "false")
          .replace(/\bNone\b/g, "null"),
      ),
    ),
    () => value,
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
