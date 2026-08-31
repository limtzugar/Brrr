import { randomUUID } from 'node:crypto'
import { db } from './db'

interface LlmInvocationInput {
  operation: string
  provider: string
  model: string
  promptVersion?: string
  status: 'SUCCESS' | 'ERROR'
  inputTokens?: number
  outputTokens?: number
  costUsd?: number
  latencyMs: number
  errorMessage?: string
  metadataJson: string
}

export async function createLlmInvocation(input: LlmInvocationInput): Promise<string> {
  const id = randomUUID()
  await db.$executeRaw`
    INSERT INTO LlmInvocation (
      id, operation, provider, model, promptVersion, status,
      inputTokens, outputTokens, costUsd, latencyMs, errorMessage, metadataJson
    ) VALUES (
      ${id}, ${input.operation}, ${input.provider}, ${input.model},
      ${input.promptVersion ?? null}, ${input.status},
      ${input.inputTokens ?? null}, ${input.outputTokens ?? null},
      ${input.costUsd ?? null}, ${input.latencyMs},
      ${input.errorMessage ?? null}, ${input.metadataJson}
    )
  `
  return id
}

export async function markLlmInvocationError(id: string, errorMessage: string): Promise<void> {
  await db.$executeRaw`
    UPDATE LlmInvocation
    SET status = 'ERROR', errorMessage = ${errorMessage.slice(0, 2_000)}
    WHERE id = ${id}
  `
}
