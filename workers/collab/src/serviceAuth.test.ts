import { describe, expect, it } from 'vitest';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { p256 } from '@noble/curves/nist.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { base58, base64urlnopad } from '@scure/base';
import { atprotoKey, verifyServiceAuth, type DidDocument } from './serviceAuth.ts';

const AUD = 'did:web:drafts.knightlab.com';
const LXM = 'com.knightlab.drafts.connect';
const NOW = 1_800_000_000;
const ISS = 'did:plc:cnl2kb47mml274ewd4zk7mzp';

/** A Multikey as a DID document carries it: base58btc, multicodec-prefixed. */
function multikey(pub: Uint8Array, prefix: number[]): string {
  return 'z' + base58.encode(new Uint8Array([...prefix, ...pub]));
}

const CURVES = {
  ES256K: { curve: secp256k1, prefix: [0xe7, 0x01] },
  ES256: { curve: p256, prefix: [0x80, 0x24] },
} as const;

/** Mint a token the way a PDS would, so the test exercises real signatures. */
function mint(
  alg: keyof typeof CURVES,
  claims: Record<string, unknown>,
  privateKey: Uint8Array,
): string {
  const b64 = (o: unknown) => base64urlnopad.encode(new TextEncoder().encode(JSON.stringify(o)));
  const signed = `${b64({ typ: 'JWT', alg })}.${b64(claims)}`;
  // noble v2's sign() returns raw r||s, which is exactly what a JWS carries.
  // `prehash: false` for the same reason the verifier needs it: this signs the
  // digest, as a PDS does, rather than letting noble hash it again.
  const sig = CURVES[alg].curve.sign(
    sha256(new TextEncoder().encode(signed)), privateKey, { prehash: false },
  );
  return `${signed}.${base64urlnopad.encode(sig)}`;
}

function keypair(alg: keyof typeof CURVES) {
  const { curve, prefix } = CURVES[alg];
  const priv = curve.utils.randomSecretKey();
  const pub = curve.getPublicKey(priv, true);
  const doc: DidDocument = {
    verificationMethod: [{ id: `${ISS}#atproto`, type: 'Multikey', publicKeyMultibase: multikey(pub, [...prefix]) }],
  };
  return { priv, doc };
}

const goodClaims = { iss: ISS, aud: AUD, lxm: LXM, iat: NOW - 10, exp: NOW + 600, jti: 'abc123' };

describe('verifyServiceAuth', () => {
  it.each(['ES256K', 'ES256'] as const)('accepts a well-formed %s token', (alg) => {
    const { priv, doc } = keypair(alg);
    const result = verifyServiceAuth({
      token: mint(alg, goodClaims, priv),
      audience: AUD, method: LXM, didDocument: doc, now: NOW,
    });
    expect(result).toMatchObject({ ok: true, did: ISS });
  });

  it('refuses a token minted for another service', () => {
    const { priv, doc } = keypair('ES256K');
    const token = mint('ES256K', { ...goodClaims, aud: 'did:web:someone-else.example' }, priv);
    expect(verifyServiceAuth({ token, audience: AUD, method: LXM, didDocument: doc, now: NOW }))
      .toEqual({ ok: false, reason: 'token is for a different audience' });
  });

  // The PDS allows a token with no lxm; it authenticates its bearer for
  // anything, so this module does not.
  it('refuses a method-less token', () => {
    const { priv, doc } = keypair('ES256K');
    const { lxm: _omitted, ...withoutLxm } = goodClaims;
    const token = mint('ES256K', withoutLxm, priv);
    expect(verifyServiceAuth({ token, audience: AUD, method: LXM, didDocument: doc, now: NOW }))
      .toEqual({ ok: false, reason: 'token is for a different method' });
  });

  it('refuses a token for a different method', () => {
    const { priv, doc } = keypair('ES256K');
    const token = mint('ES256K', { ...goodClaims, lxm: 'com.atproto.repo.putRecord' }, priv);
    expect(verifyServiceAuth({ token, audience: AUD, method: LXM, didDocument: doc, now: NOW }))
      .toEqual({ ok: false, reason: 'token is for a different method' });
  });

  it('refuses an expired token, but allows a little clock skew', () => {
    const { priv, doc } = keypair('ES256K');
    const expired = mint('ES256K', { ...goodClaims, exp: NOW - 120 }, priv);
    expect(verifyServiceAuth({ token: expired, audience: AUD, method: LXM, didDocument: doc, now: NOW }))
      .toEqual({ ok: false, reason: 'token has expired' });

    const justExpired = mint('ES256K', { ...goodClaims, exp: NOW - 5 }, priv);
    expect(verifyServiceAuth({ token: justExpired, audience: AUD, method: LXM, didDocument: doc, now: NOW }))
      .toMatchObject({ ok: true });
  });

  it('refuses a signature from the wrong key', () => {
    const { doc } = keypair('ES256K');
    const other = keypair('ES256K');
    const token = mint('ES256K', goodClaims, other.priv);
    expect(verifyServiceAuth({ token, audience: AUD, method: LXM, didDocument: doc, now: NOW }))
      .toEqual({ ok: false, reason: 'signature does not verify' });
  });

  // The attack this guards: take a valid token, rewrite its claims, and hope
  // the claim checks run on the new body while the signature is never redone.
  it('refuses a token whose claims were edited after signing', () => {
    const { priv, doc } = keypair('ES256K');
    const [h, , s] = mint('ES256K', goodClaims, priv).split('.');
    const forged = base64urlnopad.encode(
      new TextEncoder().encode(JSON.stringify({ ...goodClaims, iss: 'did:plc:someone-else' })),
    );
    expect(verifyServiceAuth({ token: `${h}.${forged}.${s}`, audience: AUD, method: LXM, didDocument: doc, now: NOW }))
      .toEqual({ ok: false, reason: 'signature does not verify' });
  });

  it('refuses when the header alg disagrees with the key', () => {
    const { priv, doc } = keypair('ES256K');
    const [, body, sig] = mint('ES256K', goodClaims, priv).split('.');
    const header = base64urlnopad.encode(new TextEncoder().encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
    expect(verifyServiceAuth({ token: `${header}.${body}.${sig}`, audience: AUD, method: LXM, didDocument: doc, now: NOW }))
      .toMatchObject({ ok: false });
  });

  it.each(['', 'not-a-jwt', 'a.b', 'a.b.c'])('refuses malformed input %j', (token) => {
    const { doc } = keypair('ES256K');
    expect(verifyServiceAuth({ token, audience: AUD, method: LXM, didDocument: doc, now: NOW }))
      .toMatchObject({ ok: false });
  });
});

describe('atprotoKey', () => {
  it('picks #atproto and ignores other verification methods', () => {
    const { doc } = keypair('ES256K');
    const withRotation: DidDocument = {
      verificationMethod: [
        { id: `${ISS}#rotation`, type: 'Multikey', publicKeyMultibase: 'zQ3shpotatopotatopotato' },
        ...doc.verificationMethod!,
      ],
    };
    expect(atprotoKey(withRotation)?.alg).toBe('ES256K');
  });

  it('returns null when there is no #atproto key', () => {
    expect(atprotoKey({ verificationMethod: [{ id: `${ISS}#rotation` }] })).toBeNull();
    expect(atprotoKey({})).toBeNull();
  });

  it('returns null for a key on a curve atproto does not use', () => {
    // Ed25519's multicodec prefix (0xed 0x01), which is valid multibase and
    // not something an atproto signing key is.
    const bogus = 'z' + base58.encode(new Uint8Array([0xed, 0x01, ...new Uint8Array(32)]));
    expect(atprotoKey({ verificationMethod: [{ id: `${ISS}#atproto`, publicKeyMultibase: bogus }] })).toBeNull();
  });
});
