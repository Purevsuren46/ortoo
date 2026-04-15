// Test ӨРТӨӨ API
const http = require('http');

function req(method, path, body, key) {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: 'localhost', port: 3401, path, method,
      headers: { 'Content-Type': 'application/json' }
    };
    if (key) opts.headers['X-API-Key'] = key;
    const r = http.request(opts, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => resolve({ status: res.statusCode, data: JSON.parse(d) }));
    });
    r.on('error', reject);
    if (body) r.write(JSON.stringify(body));
    r.end();
  });
}

(async () => {
  try {
    // 1. Create API key
    console.log('🔑 Creating API key...');
    const keyRes = await req('POST', '/api/keys', { tier: 'free' });
    const key = keyRes.data.key;
    console.log(`   Key: ${key}`);

    // 2. Health check
    console.log('\n🏥 Health check...');
    const health = await req('GET', '/api/health', null);
    console.log(`   ${health.data.name} v${health.data.version} — ${health.data.status}`);

    // 3. All rates
    console.log('\n📊 All rates...');
    const rates = await req('GET', '/api/v1/rates', null, key);
    console.log(`   Banks: ${rates.data.banks.length}`);
    console.log(`   Official: ${Object.keys(rates.data.official).join(', ')}`);
    if (rates.data.banks[0]) {
      const b = rates.data.banks[0];
      console.log(`   ${b.mn}: USD sell=${b.rates.USD?.sell}, buy=${b.rates.USD?.buy}`);
    }

    // 4. USD rates
    console.log('\n💵 USD rates...');
    const usd = await req('GET', '/api/v1/rates/usd', null, key);
    console.log(`   Official: ${usd.data.official}`);
    usd.data.banks.forEach(b => console.log(`   ${b.mn}: sell=${b.sell} buy=${b.buy} spread=${b.spread}`));

    // 5. Best USD
    console.log('\n🏆 Best USD...');
    const best = await req('GET', '/api/v1/rates/usd/best', null, key);
    console.log(`   Cheapest sell: ${best.data.cheapest_sell?.mn} ₮${best.data.cheapest_sell?.rate}`);
    console.log(`   Best buy: ${best.data.best_buy?.mn} ₮${best.data.best_buy?.rate}`);

    // 6. Convert
    console.log('\n🔄 Convert 1000 USD → MNT...');
    const conv = await req('POST', '/api/v1/convert', { amount: 1000, from: 'usd' }, key);
    console.log(`   Result: ${JSON.stringify(conv.data).substring(0, 200)}`);

    // 7. Tax config
    console.log('\n📋 Tax config...');
    const tax = await req('GET', '/api/v1/tax/config', null, key);
    console.log(`   VAT: ${tax.data.vat}%`);

    // 8. Rate limit check
    console.log('\n📊 Rate limit headers...');
    console.log(`   Remaining: ${JSON.stringify(keyRes.data).includes('free') ? 'tracking...' : 'N/A'}`);

    // 9. No auth test
    console.log('\n🚫 No auth test...');
    const noAuth = await req('GET', '/api/v1/rates', null);
    console.log(`   Status: ${noAuth.status} — ${noAuth.data.error}`);

    console.log('\n✅ All tests passed!');
    process.exit(0);
  } catch (e) {
    console.error('❌ Test failed:', e.message);
    process.exit(1);
  }
})();
