/** A service refused the credential it was sent (HTTP 401 or 403). The CLI exits 77. */
export class CredentialError extends Error {}

/** The command or its options are wrong. The CLI exits 64. */
export class UsageError extends Error {}
