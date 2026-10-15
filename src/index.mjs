import { createRestServer } from './server/rest-server.mjs';
import { REST_STAGES, getCompletedCount, getProgressPercentage } from './roadmap.mjs';

async function main() {
  console.log('======================================================');
  console.log('  The Learning Hub - RESTful API Systems Architecture');
  console.log('======================================================');
  console.log('Protocol: HTTP/1.1 & HTTP/2 Semantics (RFC 9110)');
  console.log('Maturity: Richardson Maturity Model Level 3 (HATEOAS)\n');

  const server = createRestServer();

  await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(null));
  });

  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;
  console.log(`Server active on ephemeral port: ${baseUrl}\n`);

  // 1. Root Discovery Request
  console.log('--- 1. HATEOAS Service Discovery (GET /) ---');
  const rootRes = await fetch(`${baseUrl}/`);
  const rootData = await rootRes.json();
  console.log('Root Hypermedia Links:', JSON.stringify(rootData._links, null, 2));

  // 2. Cursor Pagination Request
  console.log('\n--- 2. Keyset Cursor Pagination (GET /api/v1/orders?limit=2) ---');
  const page1Res = await fetch(`${baseUrl}/api/v1/orders?limit=2`);
  const page1Data = await page1Res.json();
  console.log(`Fetched ${page1Data.data.length} orders. Next Cursor: ${page1Data.pagination.nextCursor}`);

  // 3. Idempotency-Key Deduplication Demo
  console.log('\n--- 3. Distributed Idempotency-Key Deduplication (POST /api/v1/orders) ---');
  const idemKey = 'uuid-tx-99482-unique';

  // Request 1: Fresh submission
  const req1 = await fetch(`${baseUrl}/api/v1/orders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idemKey },
    body: JSON.stringify({ customer: 'Enterprise Client', amount: 850.00 })
  });
  console.log(`First Attempt  -> Status: ${req1.status}, Cache: ${req1.headers.get('X-Cache-Lookup')}`);

  // Request 2: Duplicate retry with same idempotency key
  const req2 = await fetch(`${baseUrl}/api/v1/orders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idemKey },
    body: JSON.stringify({ customer: 'Enterprise Client', amount: 850.00 })
  });
  console.log(`Second Attempt -> Status: ${req2.status}, Cache: ${req2.headers.get('X-Cache-Lookup')} (Deduplicated!)\n`);

  // 4. 7-Stage Pedagogical Roadmap
  console.log('--- 4. 7-Stage RESTful API Masterclass Roadmap ---');
  for (const stage of REST_STAGES) {
    const icon = stage.completed ? '[OK]' : '[..]';
    console.log(` ${icon} Stage ${stage.stageNumber}: ${stage.title}`);
    console.log(`      Focus: ${stage.domainFocus}`);
    console.log(`      Topics: ${stage.keyTopics.join(', ')}`);
  }

  const completed = getCompletedCount();
  const percent = getProgressPercentage();
  console.log('------------------------------------------------------');
  console.log(`Progress: ${completed}/7 Stages Complete (${percent}%)`);
  console.log('======================================================\n');

  server.close();
}

main().catch(err => {
  console.error('Fatal execution error:', err);
  process.exit(1);
});
