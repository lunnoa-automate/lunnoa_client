/**
 * Query and create entities (the platform's structured data layer).
 *
 * Run with:
 *   LUNNOA_URL=https://lunnoa.example LUNNOA_API_KEY=lna_... npx tsx examples/01-entities.ts
 */
import { LunnoaClient } from '@lunnoa/client';

const lunnoa = new LunnoaClient({
  baseUrl: process.env.LUNNOA_URL!,
  apiKey: process.env.LUNNOA_API_KEY!, // server-side only — never in a browser
});

async function main() {
  // Discover the deployment's entity types (with field definitions).
  const entityTypes = await lunnoa.entityTypes.list({
    expansion: ['attributeSchema', 'stateSchema'],
  });
  console.log(
    'Entity types:',
    entityTypes.map((t) => `${t.name} (${t.slug})`).join(', '),
  );

  const invoiceType = entityTypes.find((t) => t.slug === 'invoice');
  if (!invoiceType) {
    console.log('No "invoice" entity type on this deployment — adjust the slug.');
    return;
  }

  // Create an entity. Attribute values are keyed by field ID (see the
  // type's attributeSchema, or run `npx @lunnoa/client codegen` for
  // compile-time checked attributes).
  const created = await lunnoa.entities.create(
    {
      name: 'INV-2026-0042',
      objectTypeId: invoiceType.id,
      attributes: { amount: 1250.5, currency: 'CHF' },
    },
    { expansion: ['attributes'] },
  );
  console.log('Created entity:', created.id);

  // Query one page.
  const page = await lunnoa.entities.list({
    objectTypeSlug: 'invoice',
    state: 'pending',
    pageSize: 25,
    expansion: ['attributes', 'objectType'],
  });
  console.log(`Page 1 of ${page.pagination.totalPages}: ${page.data.length} entities`);

  // Or iterate everything without thinking about pages.
  let count = 0;
  for await (const entity of lunnoa.entities.iterate({ objectTypeSlug: 'invoice' })) {
    count += 1;
    if (count >= 100) break; // stop early — no further pages are fetched
  }
  console.log(`Iterated ${count} invoices`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
