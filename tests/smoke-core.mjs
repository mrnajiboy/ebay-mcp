/**
 * Core Smoke Test - Live eBay API
 * Run: pnpm tsx tests/smoke-core.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { executeTool } from '../src/tools/index.js';
import { EbaySellerApi } from '../src/api/index.js';

// Load .env manually
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.join(__dirname, '..', '.env');
const envContent = fs.readFileSync(envPath, 'utf-8');
for (const line of envContent.split('\n')) {
  const trimmed = line.trim();
  if (trimmed && !trimmed.startsWith('#')) {
    const eqIndex = trimmed.indexOf('=');
    if (eqIndex > 0) {
      const key = trimmed.slice(0, eqIndex).trim();
      const value = trimmed.slice(eqIndex + 1).trim();
      process.env[key] = value;
    }
  }
}

const config = {
  clientId: process.env.EBAY_PRODUCTION_CLIENT_ID || process.env.EBAY_CLIENT_ID || '',
  clientSecret: process.env.EBAY_PRODUCTION_CLIENT_SECRET || process.env.EBAY_CLIENT_SECRET || '',
  redirectUri: process.env.EBAY_PRODUCTION_REDIRECT_URI || process.env.EBAY_REDIRECT_URI || '',
  environment: 'production',
};

const results = [];

async function testTool(name, args, expectEmpty = false) {
  try {
    const api = new EbaySellerApi(config);
    await api.initialize();
    const result = await executeTool(api, name, args);
    console.log(`✅ ${name}`);
    return { tool: name, status: 'pass' };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    const isExpectedEmpty = msg.includes('not found') || msg.includes('no orders') || msg.includes('empty') || msg.includes('No orders') || msg.includes('has no');
    
    if (expectEmpty && isExpectedEmpty) {
      console.log(`✅ ${name} (expected empty)`);
      return { tool: name, status: 'pass' };
    }
    
    console.log(`❌ ${name}: ${msg.slice(0, 100)}`);
    return { tool: name, status: 'fail', error: msg };
  }
}

async function main() {
  console.log('🚀 Core Smoke Test — Live eBay API\n');
  
  if (!config.clientId) {
    console.log('❌ Missing credentials');
    process.exit(1);
  }
  
  console.log('--- INVENTORY (core path) ---');
  results.push(await testTool('ebay_get_inventory_items', { limit: 3 }));
  results.push(await testTool('ebay_get_offers', { sku: 'NONEXISTENT' }, true));
  
  console.log('\n--- FULFILLMENT ---');
  results.push(await testTool('ebay_get_orders', {}));
  
  console.log('\n--- ORDER MANAGEMENT ---');
  results.push(await testTool('ebay_get_payment_dispute_summaries', {}));
  
  console.log('\n--- MARKETING ---');
  results.push(await testTool('ebay_get_campaigns', {}));
  results.push(await testTool('ebay_get_promotions', { marketplaceId: 'EBAY_US' }));
  
  console.log('\n--- ANALYTICS ---');
  results.push(await testTool('ebay_get_report_tasks', {}));
  
  console.log('\n--- COMMUNICATION ---');
  results.push(await testTool('ebay_get_conversations', {}));
  results.push(await testTool('ebay_get_feedback_summary', {}));
  
  console.log('\n--- BULK ---');
  results.push(await testTool('ebay_bulk_update_price_quantity', { requests: { requests: [] } }));
  
  console.log('\n--- TAXONOMY ---');
  results.push(await testTool('ebay_get_default_category_tree_id', { marketplaceId: 'EBAY_US' }));
  results.push(await testTool('ebay_get_category_suggestions', { categoryTreeId: '11384', query: 'kpop' }));
  
  console.log('\n--- BROWSE ---');
  results.push(await testTool('ebay_get_suggestions', { query: 'kpop photocard', marketplaceId: 'EBAY_US', limit: 5 }));
  
  // Summary
  const pass = results.filter(r => r.status === 'pass').length;
  const fail = results.filter(r => r.status === 'fail').length;
  
  console.log(`\n📊 RESULTS: ${pass}/${results.length} passed, ${fail} failed`);
  
  if (fail > 0) {
    console.log('\n🚨 FAILURES:');
    results.filter(r => r.status === 'fail').forEach(r => console.log(`  - ${r.tool}: ${r.error?.slice(0, 80)}`));
  }
  
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
