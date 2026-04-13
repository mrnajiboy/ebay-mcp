import { stdin as input, stdout as output } from 'node:process';
import { createInterface } from 'node:readline';
import {
  clearEbayResearchAuthCache,
  type EbayResearchAuthInspection,
  inspectEbayResearchAuthState,
  inspectEbayResearchSessionPersistence,
  type ResearchStorageState,
  storeEbayResearchSessionToKv,
} from '../validation/providers/ebay-research.js';
import type { EbayResearchSessionStoreBackend } from '../validation/providers/ebay-research-session-store.js';
import { loadChromium } from './playwright-runtime.js';

const configuredMarketplace = process.env.EBAY_RESEARCH_BOOTSTRAP_MARKETPLACE?.trim();
const marketplace =
  configuredMarketplace && configuredMarketplace.length > 0 ? configuredMarketplace : 'EBAY-US';
const researchUrl = `https://www.ebay.com/sh/research?marketplace=${encodeURIComponent(marketplace)}`;

function getExpectedVerificationSessionSource(
  selectedStore: EbayResearchSessionStoreBackend
): 'kv' | 'filesystem' | null {
  if (selectedStore === 'cloudflare_kv' || selectedStore === 'upstash-redis') {
    return 'kv';
  }

  if (selectedStore === 'filesystem') {
    return 'filesystem';
  }

  return null;
}

function getChromiumChannel(): string | undefined {
  const configuredChannel = process.env.PLAYWRIGHT_CHROMIUM_CHANNEL?.trim();
  return configuredChannel && configuredChannel.length > 0 ? configuredChannel : undefined;
}

async function waitForEnter(promptText: string): Promise<void> {
  await new Promise<void>((resolve) => {
    const rl = createInterface({ input, output });
    rl.question(promptText, () => {
      rl.close();
      resolve();
    });
  });
}

async function main(): Promise<void> {
  const chromium = await loadChromium();
  const browser = await chromium.launch({
    headless: false,
    channel: getChromiumChannel(),
  });

  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    console.log(`Opening eBay Research bootstrap flow for marketplace ${marketplace}...`);
    await page.goto(researchUrl, { waitUntil: 'domcontentloaded' });

    await waitForEnter(
      'Sign in to eBay Research in the opened browser window, confirm the research UI is accessible, then press Enter to persist storage state to KV. '
    );

    await page.goto(researchUrl, { waitUntil: 'domcontentloaded' });
    const currentUrl = page.url();
    if (!currentUrl.includes('/sh/research')) {
      throw new Error(
        `Research UI access could not be confirmed before persistence (currentUrl=${currentUrl}).`
      );
    }

    const storageState = await context.storageState<ResearchStorageState>();
    await storeEbayResearchSessionToKv(marketplace, storageState, 'storage_state');
    clearEbayResearchAuthCache();
    const persistence = await inspectEbayResearchSessionPersistence(marketplace);

    console.log(
      `[eBayResearchSessionBootstrap] wrote storage state to ${persistence.sessionStoreSelected} key=${persistence.canonicalStateKey ?? 'null'} bytes=${persistence.storageStateBytes}`
    );
    console.log(
      `[eBayResearchSessionBootstrap] canonical storage-state key ${persistence.canonicalStateKey ?? 'null'} exists=${persistence.storageStateExists} bytes=${persistence.storageStateBytes} valid=${persistence.storageStateValid}`
    );
    console.log(
      `[eBayResearchSessionBootstrap] fresh-client canonical key ${persistence.freshCanonicalReadback.key ?? 'null'} exists=${persistence.freshCanonicalReadback.exists} type=${persistence.freshCanonicalReadback.valueType} bytes=${persistence.freshCanonicalReadback.bytes} valid=${persistence.freshCanonicalReadback.validPlaywrightStorageStateJson} configuredFrom=${persistence.freshCanonicalReadback.configuredFrom} scope=${persistence.freshCanonicalReadback.stateKeyScope} connection=${persistence.freshCanonicalReadback.connection ?? 'null'} credentialFingerprint=${persistence.freshCanonicalReadback.credentialFingerprint ?? 'null'} error=${persistence.freshCanonicalReadback.error ?? 'null'}`
    );
    console.log(
      `[eBayResearchSessionBootstrap] metadata key ${persistence.canonicalMetaKey ?? 'null'} exists=${persistence.metadataExists}`
    );
    if (persistence.storeTargetConnection) {
      console.log(
        `[eBayResearchSessionBootstrap] target=${persistence.storeTargetConnection} credentialsConfigured=${persistence.storeCredentialsConfigured}`
      );
    }

    const verification: EbayResearchAuthInspection =
      await inspectEbayResearchAuthState(marketplace);
    const expectedSessionSource = getExpectedVerificationSessionSource(
      persistence.sessionStoreSelected
    );
    if (
      verification.authState !== 'loaded' ||
      verification.sessionSource !== expectedSessionSource ||
      verification.authValidationSucceeded !== true
    ) {
      throw new Error(
        `eBay Research session bootstrap verification failed (authState=${verification.authState}, sessionSource=${verification.sessionSource ?? 'none'}, authValidationSucceeded=${verification.authValidationSucceeded}, cookieCount=${verification.cookieCount}).`
      );
    }

    console.log(
      JSON.stringify(
        {
          ok: true,
          marketplace,
          persistedTo: persistence.sessionStoreSelected,
          storeTargetConnection: persistence.storeTargetConnection,
          storeCredentialsConfigured: persistence.storeCredentialsConfigured,
          canonicalKeys: {
            storageState: persistence.canonicalStateKey,
            metadata: persistence.canonicalMetaKey,
          },
          persistence,
          inspectCommand: 'pnpm run research:inspect-session',
          refreshCommand: 'pnpm run research:bootstrap',
          verification,
        },
        null,
        2
      )
    );
  } finally {
    await context.close();
    await browser.close();
  }
}

void main().catch((error: unknown) => {
  console.error(
    JSON.stringify(
      {
        ok: false,
        marketplace,
        error: error instanceof Error ? error.message : String(error),
      },
      null,
      2
    )
  );
  process.exit(1);
});
