/**
 * Verifying atproto service auth — docs/phase2-plan.md Stage 1, [P4].
 *
 * A client asks its own PDS for a short-lived JWT naming us as the audience
 * (`com.atproto.server.getServiceAuth`), and we check the signature against
 * the signing key in the issuer's DID document. Nothing here talks to a PDS:
 * we learn who someone is without holding anything that can act as them.
 *
 * **Nothing about `aud` protects us.** The PDS validates `aud` for syntax and
 * does not resolve it — a token naming our DID is not evidence anyone vouched
 * for us, and a token minted for a different service would verify perfectly
 * well as a signature. Checking `aud` against our own DID, and `lxm` against
 * the one method we accept, is entirely this module's job.
 *
 * **WebCrypto cannot do this.** atproto's default repo signing key is
 * secp256k1 and `alg: ES256K` is not a WebCrypto algorithm at all — its ECDSA
 * curves are P-256/384/521, and asking for `secp256k1` throws
 * `NotSupportedError`. Hence `@noble/curves`. P-256 keys are also legal in
 * atproto, so both are handled.
 */
import { p256 } from '@noble/curves/nist.js';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { base58, base64urlnopad } from '@scure/base';

/** Multicodec prefixes that introduce a compressed public key in a Multikey. */
const CURVE_BY_PREFIX: Record<string, { verify: typeof secp256k1.verify; alg: string }> = {
  // varint 0xe7 0x01 — secp256k1-pub. Multikeys with it render as `zQ3s…`.
  'e701': { verify: secp256k1.verify, alg: 'ES256K' },
  // varint 0x80 0x24 — p256-pub. Multikeys with it render as `zDna…`.
  '8024': { verify: p256.verify, alg: 'ES256' },
};

/** Tolerance for clock skew between the issuing PDS and us. */
const SKEW_SECONDS = 30;

export interface ServiceAuthClaims {
  iss: string;
  aud: string;
  exp: number;
  iat?: number;
  lxm?: string;
  jti?: string;
}

export type VerifyResult =
  | { ok: true; did: string; claims: ServiceAuthClaims }
  | { ok: false; reason: string };

/** A DID document, narrowed to the one field this needs. */
export interface DidDocument {
  verificationMethod?: Array<{
    id?: string;
    type?: string;
    publicKeyMultibase?: string;
  }>;
}

/**
 * The signing key from a DID document, as compressed point bytes.
 *
 * atproto names its repo signing key `#atproto`; a document may carry others
 * (rotation keys, legacy entries) and picking the wrong one fails closed
 * rather than loosely, so the suffix is matched exactly.
 */
export function atprotoKey(doc: DidDocument): { bytes: Uint8Array; alg: string } | null {
  const method = doc.verificationMethod?.find((m) => m.id?.endsWith('#atproto'));
  if (!method?.publicKeyMultibase) return null;
  const multibase = method.publicKeyMultibase;
  // Multibase: a leading `z` means the rest is base58btc.
  if (!multibase.startsWith('z')) return null;
  let decoded: Uint8Array;
  try {
    decoded = base58.decode(multibase.slice(1));
  } catch {
    return null;
  }
  if (decoded.length < 3) return null;
  const prefix = [...decoded.slice(0, 2)].map((b) => b.toString(16).padStart(2, '0')).join('');
  const curve = CURVE_BY_PREFIX[prefix];
  if (!curve) return null;
  return { bytes: decoded.slice(2), alg: curve.alg };
}

/** Split a compact JWS without verifying anything. */
function decodeJwt(token: string):
  | { header: { alg?: string }; claims: ServiceAuthClaims; signed: Uint8Array; signature: Uint8Array }
  | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const header = JSON.parse(new TextDecoder().decode(base64urlnopad.decode(parts[0])));
    const claims = JSON.parse(new TextDecoder().decode(base64urlnopad.decode(parts[1])));
    return {
      header,
      claims,
      signed: new TextEncoder().encode(`${parts[0]}.${parts[1]}`),
      signature: base64urlnopad.decode(parts[2]),
    };
  } catch {
    return null;
  }
}

export interface VerifyOptions {
  /** The raw compact JWS presented by the client. */
  token: string;
  /** Our own DID. A token for anyone else is refused. */
  audience: string;
  /** The one `lxm` we accept. */
  method: string;
  /** The issuer's DID document, however the caller chose to resolve it. */
  didDocument: DidDocument;
  /** Seconds since the epoch; injectable so tests need no clock. */
  now: number;
}

/**
 * Check a service auth token, claims and signature both.
 *
 * Order matters: the cheap claim checks run before the signature, so a token
 * for another audience costs no elliptic-curve work.
 */
export function verifyServiceAuth(opts: VerifyOptions): VerifyResult {
  const decoded = decodeJwt(opts.token);
  if (!decoded) return { ok: false, reason: 'malformed token' };
  const { header, claims, signed, signature } = decoded;

  if (typeof claims.iss !== 'string' || !claims.iss.startsWith('did:')) {
    return { ok: false, reason: 'issuer is not a DID' };
  }
  if (claims.aud !== opts.audience) {
    return { ok: false, reason: 'token is for a different audience' };
  }
  // A method-less token authenticates its bearer for anything. The PDS allows
  // one; we do not. See docs/phase2-plan.md Stage 1.
  if (claims.lxm !== opts.method) {
    return { ok: false, reason: 'token is for a different method' };
  }
  if (typeof claims.exp !== 'number' || claims.exp <= opts.now - SKEW_SECONDS) {
    return { ok: false, reason: 'token has expired' };
  }
  if (typeof claims.iat === 'number' && claims.iat > opts.now + SKEW_SECONDS) {
    return { ok: false, reason: 'token is not valid yet' };
  }

  const key = atprotoKey(opts.didDocument);
  if (!key) return { ok: false, reason: 'no usable signing key in the DID document' };
  if (header.alg !== key.alg) {
    return { ok: false, reason: `token alg ${header.alg} does not match the signing key` };
  }

  const curve = Object.values(CURVE_BY_PREFIX).find((c) => c.alg === key.alg)!;
  let valid = false;
  try {
    // `prehash: false` because we hand it the digest, not the message. noble
    // v2 hashes its input by default, so omitting this verifies against
    // sha256(sha256(signing input)) — which is self-consistent if you also
    // sign that way, and therefore passes a unit test while rejecting every
    // token a real PDS ever minted.
    valid = curve.verify(signature, sha256(signed), key.bytes, { prehash: false });
  } catch {
    valid = false;
  }
  if (!valid) return { ok: false, reason: 'signature does not verify' };

  return { ok: true, did: claims.iss, claims };
}
