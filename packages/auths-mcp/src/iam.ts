export interface AuthsPresentation {
  holder_did: string;
  nonce: string;
  signature_hex: string;
}

export function buildPresentationHeader(holderDid: string, nonce: string, signatureHex: string): string {
  const payload: AuthsPresentation = {
    holder_did: holderDid,
    nonce,
    signature_hex: signatureHex,
  };
  return `Auths-Presentation ${Buffer.from(JSON.stringify(payload)).toString('base64')}`;
}

export function parsePresentationHeader(header: string): AuthsPresentation | null {
  if (!header.startsWith('Auths-Presentation ')) {
    return null;
  }
  try {
    const raw = header.slice('Auths-Presentation '.length);
    const decoded = Buffer.from(raw, 'base64').toString('utf8');
    return JSON.parse(decoded) as AuthsPresentation;
  } catch {
    return null;
  }
}
