/** @vitest-environment node */
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { LunnoaAuthProvider, useLunnoaAuth } from '../src/react';

function Status() {
  return createElement('span', null, useLunnoaAuth().status);
}

describe('LunnoaAuthProvider SSR', () => {
  it('renders on the server without localStorage', () => {
    expect(
      renderToString(
        createElement(LunnoaAuthProvider, {
          baseUrl: 'https://lunnoa.example',
          children: createElement(Status),
        }),
      ),
    ).toContain('loading');
  });
});
