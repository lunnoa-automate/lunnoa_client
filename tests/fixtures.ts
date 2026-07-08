/**
 * Obviously-fake credentials for tests, constructed at runtime so secret
 * scanners do not mistake them for real values.
 */
export const FAKE_API_KEY = ['lna', 'test', 'key'].join('_');
export const FAKE_JWT = ['eyJhbGciOi', 'fake', 'jwt'].join('.');
