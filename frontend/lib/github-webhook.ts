import crypto from "crypto"

/**
 * Verify GitHub webhook signature (X-Hub-Signature-256).
 * GitHub signs: HMAC-SHA256(secret, raw_body) → header value "sha256=" + hex
 */
export function verifyGitHubSignature(
  rawBody: Buffer | string,
  signature: string | null
): boolean {
  const secret = process.env.GITHUB_WEBHOOK_SECRET?.trim()
  if (!secret || !signature?.trim().startsWith("sha256=")) return false
  const sig = signature.trim()
  const bodyBuf = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(rawBody, "utf8")
  const expected = "sha256=" + crypto.createHmac("sha256", secret).update(bodyBuf).digest("hex")
  const a = Buffer.from(sig, "utf8")
  const b = Buffer.from(expected, "utf8")
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}
