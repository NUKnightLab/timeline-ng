import { describe, expect, it } from 'vitest';
import { didDocumentUrl } from './resolveDid.ts';

const env = { PLC_URL: 'https://plc.example' };

describe('didDocumentUrl', () => {
  it('points a did:plc at the directory', () => {
    expect(didDocumentUrl('did:plc:cnl2kb47mml274ewd4zk7mzp', env))
      .toBe('https://plc.example/did:plc:cnl2kb47mml274ewd4zk7mzp');
  });

  it('defaults to the public directory', () => {
    expect(didDocumentUrl('did:plc:cnl2kb47mml274ewd4zk7mzp', {}))
      .toBe('https://plc.directory/did:plc:cnl2kb47mml274ewd4zk7mzp');
  });

  it('rejects a did:plc whose identifier is not base32', () => {
    expect(didDocumentUrl('did:plc:NOTBASE32xxxxxxxxxxxxxxx', env)).toBeNull();
    expect(didDocumentUrl('did:plc:short', env)).toBeNull();
  });

  it('points a bare did:web at .well-known', () => {
    expect(didDocumentUrl('did:web:drafts.knightlab.com', env))
      .toBe('https://drafts.knightlab.com/.well-known/did.json');
  });

  it('expands did:web path segments', () => {
    expect(didDocumentUrl('did:web:example.com:user:alice', env))
      .toBe('https://example.com/user/alice/did.json');
  });

  it('decodes a percent-encoded port', () => {
    expect(didDocumentUrl('did:web:localhost%3A8080', env))
      .toBe('https://localhost:8080/.well-known/did.json');
  });

  // The DID arrives inside an unverified token, so anything that would widen
  // what the service can be made to fetch is refused rather than attempted.
  it.each([
    'did:key:z6Mk',
    'did:ion:abc',
    'not-a-did',
    '',
    'did:web:exa mple.com',
    'did:web:evil.com/..%2f',
  ])('refuses %j', (did) => {
    expect(didDocumentUrl(did, env)).toBeNull();
  });
});
