import { FastifyError, FastifyReply, FastifyRequest } from 'fastify'
import { ZodError } from 'zod'

export function errorHandler(
  error: FastifyError | Error,
  request: FastifyRequest,
  reply: FastifyReply,
) {
  request.log.error({ err: error }, 'Request error')

  // Zod validation errors
  if (error instanceof ZodError) {
    return reply.status(400).send({
      statusCode: 400,
      error: 'Validation Error',
      message: 'Invalid request data',
      issues: error.issues,
    })
  }

  // Fastify validation errors
  const fastifyError = error as FastifyError
  if (fastifyError.validation) {
    return reply.status(400).send({
      statusCode: 400,
      error: 'Validation Error',
      message: error.message,
    })
  }

  // Fastify errors with statusCode
  if (fastifyError.statusCode) {
    return reply.status(fastifyError.statusCode).send({
      statusCode: fastifyError.statusCode,
      error: error.name,
      message: error.message,
    })
  }

  // Unknown errors
  return reply.status(500).send({
    statusCode: 500,
    error: 'Internal Server Error',
    message: process.env.NODE_ENV === 'production' ? 'Something went wrong' : error.message,
  })
}
