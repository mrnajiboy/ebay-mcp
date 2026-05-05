/**
 * Core Smoke Test - Live eBay API
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { executeTool } from '../src/tools/index.js';
import { EbaySellerApi } from '../src/api/index.js';
import type { EbayConfig } from '../src/types/ebay.js';

// Load .env manually
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const envPath = path.join(__dirname, '..', '.env');
const envContent = fs.readFileSync(envPath, 'utf-8');
for (const line of envContent.split('\n')) {
  const trimmed = line.trim();
  if (trimmed && !trimmed.startsWith('#')) {
    const [key, ...valueParts] = trimmed.split('=');
    if (key && valueParts.length > 0) {
      process.env[key.trim()] = valueParts.join('=').trim();
    }
  }
}

// Load config from environment
const config: EbayConfig = {
  clientId: process.env.EBAY_PRODUCTION_CLIENT_ID || process.env.EBAY_CLIENT_ID || '',
  clientSecret: process.env.EBAY_PRODUCTION_CLIENT_SECRET || process.env.EBAY_CLIENT_SECRET || '',
  redirectUri: process.env.EBAY_PRODUCTION_REDIRECT_URI || process.env.EBAY_REDIRECT_URI || '',
  environment: 'production',
};

interface SmokeResult {
  tool: string;
  status: 'pass' | 'fail' | 'skip';
  error?: string;
}

const results: SmokeResult[] = [];

async function testTool(name: string, args: Record<string, unknown>, expectError?: boolean): Promise<SmokeResult> {
  try {
    const api = new EbaySellerApi(config);
    await api.initialize();
    
    const result = await executeTool(api, name, args);
    
    if (expectError) {
      return { tool: name, status: 'fail', error: `Expected error but got success` };
    }
    
    console.log(`✅ ${name}: SUCCESS`);
    return { tool: name, status: 'pass' };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    
    if (expectError && (msg.includes('not found') || msg.includes('no orders') || msg.includes('empty'))) {
      console.log(`✅ ${name}: EXPECTED EMPTY/NOT FOUND`);
      return { tool: name, status: 'pass', error: 'Expected empty/not found' };
    }
    
    console.log(`❌ ${name}: ${msg}`);
    return { tool: name, status: 'fail', error: msg };
  }
}

async function main() {
  console.log('🚀 Starting Core Smoke Test...\n');
  
  if (!config.clientId) {
    console.log('❌ Missing eBay credentials. Set EBAY_PRODUCTION_CLIENT_ID etc.');
    process.exit(1);
  }
  
  // --- FULFILLMENT TOOLS ---
  console.log('\n--- FULFILLMENT TOOLS ---');
  results.push(await testTool('ebay_get_orders', {}));
  results.push(await testTool('ebay_get_shipping_fulfillments', { orderId: '9999999999' }, true));
  
  // --- ORDER MANAGEMENT ---
  console.log('\n--- ORDER MANAGEMENT ---');
  results.push(await testTool('ebay_get_payment_dispute_summaries', {}));
  
  // --- MARKETING/PROMOTIONS ---
  console.log('\n--- MARKETING/PROMOTIONS ---');
  results.push(await testTool('ebay_get_campaigns', {}));
  results.push(await testTool('ebay_get_promotions', { marketplaceId: 'EBAY_US' }));
  
  // --- ANALYTICS/REPORTING ---
  console.log('\n--- ANALYTICS/REPORTING ---');
  results.push(await testTool('ebay_get_report_tasks', {}));
  results.push(await testTool('ebay_get_ad_report_metadata', {}));
  
  // --- COMMUNICATION ---
  console.log('\n--- COMMUNICATION ---');
  results.push(await testTool('ebay_get_conversations', {}));
  results.push(await testTool('ebay_get_feedback_summary', {}));
  
  // --- BULK/EDGE CASE ---
  console.log('\n--- BULK/EDGE CASE ---');
  results.push(await testTool('ebay_bulk_update_price_quantity', { 
    requests: { requests: [] } 
  }));
  
  // --- SUMMARY ---
  console.log('\n\n📊 SMOKE TEST SUMMARY');
  console.log('='.repeat(50));
  
  const pass = results.filter(r => r.status === 'pass').length;
  const fail = results.filter(r => r.status === 'fail').length;
  const skip = results.filter(r => r.status === 'skip').length;
  
  console.log(`✅ Passed: ${pass}/${results.length}`);
  console.log(`❌ Failed: ${fail}/${results.length}`);
  console.log(`⏭️  Skipped: ${skip}/${results.length}`);
  
  if (fail > 0) {
    console.log('\n🚨 FAILED TOOLS:');
    results.filter(r => r.status === 'fail').forEach(r => {
      console.log(`  - ${r.tool}: ${r.error}`);
    });
  }
  
  console.log('\n' + '='.repeat(50));
  console.log(`Total: ${pass}/${results.length} passed`);
  
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(console.error);
