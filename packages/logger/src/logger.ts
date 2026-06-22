import pino, { type Logger } from 'pino'

const REDACT_PATHS = [
  'password',
  '*.password',
  '*.*.password',
  'username',
  '*.username',
  '*.*.username',
  'credentials',
  '*.credentials',
  'encryptedCredentials',
  '*.encryptedCredentials',
  '*.*.encryptedCredentials',
  'connection.encryptedCredentials',
  '*.connection.encryptedCredentials',
  '*.*.connection.encryptedCredentials',
  'token',
  '*.token',
  'sessionToken',
  '*.sessionToken',
  'keycloakToken',
  '*.keycloakToken',
  'authorization',
  '*.authorization',
  'req.headers.authorization',
]

export interface CreateLoggerOptions {
  level?: string
  /** Injectable for tests; defaults to stdout. */
  destination?: pino.DestinationStream
}

export function createLogger(service: string, options: CreateLoggerOptions = {}): Logger {
  const opts = {
    name: service,
    level: options.level ?? process.env['LOG_LEVEL'] ?? 'info',
    redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
  }
  return options.destination ? pino(opts, options.destination) : pino(opts)
}
