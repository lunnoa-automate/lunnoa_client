import { describe, expect, it } from 'vitest';

import { parseArgs } from '../src/cli/args';

describe('parseArgs', () => {
  it('parses tools list filters', () => {
    const args = parseArgs([
      'tools',
      'list',
      '--for-agent',
      '--json',
      '--app',
      'http',
      '--url',
      'https://lunnoa.example',
      '--api-key',
      'lna_test',
    ]);
    expect(args.command).toBe('tools');
    expect(args.subcommand).toBe('list');
    expect(args.forAgent).toBe(true);
    expect(args.json).toBe(true);
    expect(args.app).toBe('http');
    expect(args.url).toBe('https://lunnoa.example');
    expect(args.apiKey).toBe('lna_test');
  });

  it('parses tools get / search positionals', () => {
    expect(parseArgs(['tools', 'get', 'http_action_send-request']).path).toBe(
      'http_action_send-request',
    );
    expect(parseArgs(['tools', 'search', 'email']).path).toBe('email');
  });

  it('still parses workflow deploy path', () => {
    const args = parseArgs([
      'workflows',
      'deploy',
      './ping.ts',
      '--project-id',
      'proj-1',
    ]);
    expect(args.command).toBe('workflows');
    expect(args.subcommand).toBe('deploy');
    expect(args.path).toBe('./ping.ts');
    expect(args.projectId).toBe('proj-1');
  });

  it('does not consume the next flag as a boolean value', () => {
    const args = parseArgs(['tools', 'list', '--json', '--for-agent']);
    expect(args.json).toBe(true);
    expect(args.forAgent).toBe(true);
  });

  it('rejects unknown flags', () => {
    expect(() => parseArgs(['tools', 'list', '--wat'])).toThrow(/Unknown option/);
  });

  it('rejects value flags without a value', () => {
    expect(() => parseArgs(['tools', 'list', '--app'])).toThrow(/Missing value/);
  });
});
