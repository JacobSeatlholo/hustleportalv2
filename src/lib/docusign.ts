// ============ DOCUSIGN EMBEDDED SIGNING (Task 211) ============
// Server-side JWT-growth: assert a JWT (RS256) against the DocuSign OAuth
// service, create an envelope from a private-docs PDF, and return the
// embedded recipient view URL. Free-form signing: the envelope carries no
// tabs, so the signer places their signature themselves — the standard
// pattern for arbitrary PDFs.
//
// Required env (Vercel project settings), demo account by default:
//   DOCUSIGN_INTEGRATION_KEY  — Apps & Keys → Integration Key (client id)
//   DOCUSIGN_USER_ID          — Apps & Keys → API Username
//   DOCUSIGN_ACCOUNT_ID       — the GUID the API base points at (i:0000…)
//   DOCUSIGN_RSA_PRIVATE_KEY  — the RSA private key PEM (multiline OK)
// Optional:
//   DOCUSIGN_OAUTH_BASE       — default https://account-d.docusign.com (demo)
//   DOCUSIGN_API_BASE         — default https://demo.docusign.net/restapi (demo)
// Production: live keys + https://account.docusign.com + https://api.docusign.net/restapi

export interface DocusignConfig {
  integrationKey: string
  userId: string
  accountId: string
  privateKeyPem: string
  oauthBase: string
  apiBase: string
}

export function docusignStatus(): { configured: boolean; missing: string[] } {
  const required: Array<[string, string | undefined]> = [
    ['DOCUSIGN_INTEGRATION_KEY', process.env.DOCUSIGN_INTEGRATION_KEY],
    ['DOCUSIGN_USER_ID', process.env.DOCUSIGN_USER_ID],
    ['DOCUSIGN_ACCOUNT_ID', process.env.DOCUSIGN_ACCOUNT_ID],
    ['DOCUSIGN_RSA_PRIVATE_KEY', process.env.DOCUSIGN_RSA_PRIVATE_KEY],
  ]
  const missing = required.filter(([, v]) => !v).map(([k]) => k)
  return { configured: missing.length === 0, missing }
}

export function docusignConfig(): DocusignConfig | null {
  const { configured } = docusignStatus()
  if (!configured) return null
  // The key may be stored with real newlines (Vercel multiline env) or with
  // escaped \n sequences — normalise to a usable PEM either way.
  const rawKey = process.env.DOCUSIGN_RSA_PRIVATE_KEY as string
  const privateKeyPem = rawKey.includes('\\n') ? rawKey.replace(/\\n/g, '\n') : rawKey
  return {
    integrationKey: process.env.DOCUSIGN_INTEGRATION_KEY as string,
    userId: process.env.DOCUSIGN_USER_ID as string,
    accountId: process.env.DOCUSIGN_ACCOUNT_ID as string,
    privateKeyPem,
    oauthBase: process.env.DOCUSIGN_OAUTH_BASE || 'https://account-d.docusign.com',
    apiBase: process.env.DOCUSIGN_API_BASE || 'https://demo.docusign.net/restapi',
  }
}

const b64url = (input: Buffer | string) => Buffer.from(input).toString('base64url')

async function getAccessToken(cfg: DocusignConfig): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const claims = b64url(
    JSON.stringify({
      iss: cfg.integrationKey,
      sub: cfg.userId,
      aud: new URL(cfg.oauthBase).host,
      iat: now,
      exp: now + 3600,
      scope: 'signature impersonation',
    }),
  )
  const signer = (await import('node:crypto')).createSign('RSA-SHA256')
  signer.update(`${header}.${claims}`)
  const signature = b64url(Buffer.from(signer.sign(cfg.privateKeyPem)))
  const assertion = `${header}.${claims}.${signature}`

  const res = await fetch(`${cfg.oauthBase}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
    signal: AbortSignal.timeout(20_000),
  })
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(`DocuSign token request failed (${res.status}): ${detail.slice(0, 300)}`)
  }
  const json = (await res.json()) as { access_token?: string }
  if (!json.access_token) throw new Error('DocuSign token response missing access_token')
  return json.access_token
}

export interface EmbeddedSigningResult {
  envelopeId: string
  url: string
}

export async function createEmbeddedSigning(
  cfg: DocusignConfig,
  input: { pdfBase64: string; docName: string; signerName: string; signerEmail: string; returnUrl: string; emailSubject: string },
): Promise<EmbeddedSigningResult> {
  const token = await getAccessToken(cfg)
  const accountPath = `${cfg.apiBase}/v2.1/accounts/${encodeURIComponent(cfg.accountId)}`

  // 1. Create the envelope: one embedded signer, no tabs (free-form signing).
  const envRes = await fetch(`${accountPath}/envelopes`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      status: 'sent',
      emailSubject: input.emailSubject,
      documents: [
        {
          documentBase64: input.pdfBase64,
          name: input.docName,
          fileExtension: 'pdf',
          documentId: '1',
        },
      ],
      recipients: {
        signers: [
          {
            email: input.signerEmail,
            name: input.signerName,
            recipientId: '1',
            clientUserId: 'bh-embedded-1',
          },
        ],
      },
    }),
    signal: AbortSignal.timeout(30_000),
  })
  if (!envRes.ok) {
    const detail = await envRes.text().catch(() => '')
    throw new Error(`DocuSign envelope creation failed (${envRes.status}): ${detail.slice(0, 300)}`)
  }
  const envJson = (await envRes.json()) as { envelopeId?: string }
  if (!envJson.envelopeId) throw new Error('DocuSign envelope response missing envelopeId')

  // 2. Recipient view: the embedded signing URL the browser opens in a tab.
  const viewRes = await fetch(`${accountPath}/envelopes/${encodeURIComponent(envJson.envelopeId)}/views/recipient`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      returnUrl: input.returnUrl,
      authenticationMethod: 'none',
      email: input.signerEmail,
      userName: input.signerName,
      clientUserId: 'bh-embedded-1',
    }),
    signal: AbortSignal.timeout(30_000),
  })
  if (!viewRes.ok) {
    const detail = await viewRes.text().catch(() => '')
    throw new Error(`DocuSign recipient view failed (${viewRes.status}): ${detail.slice(0, 300)}`)
  }
  const viewJson = (await viewRes.json()) as { url?: string }
  if (!viewJson.url) throw new Error('DocuSign recipient view response missing url')
  return { envelopeId: envJson.envelopeId, url: viewJson.url }
}
