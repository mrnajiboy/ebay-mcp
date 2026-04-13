import { inspectEbayResearchSessionPersistence } from '../validation/providers/ebay-research.js';

function getMarketplace(): string {
  const cliMarketplace = process.argv[2]?.trim();
  if (cliMarketplace && cliMarketplace.length > 0) {
    return cliMarketplace;
  }

  const configuredMarketplace = process.env.EBAY_RESEARCH_BOOTSTRAP_MARKETPLACE?.trim();
  return configuredMarketplace && configuredMarketplace.length > 0
    ? configuredMarketplace
    : 'EBAY-US';
}

async function main(): Promise<void> {
  const marketplace = getMarketplace();
  const persistence = await inspectEbayResearchSessionPersistence(marketplace);

  console.log(
    JSON.stringify(
      {
        ok: persistence.error === null,
        marketplace,
        sessionStoreConfigured: persistence.sessionStoreConfigured,
        sessionStoreSelected: persistence.sessionStoreSelected,
        sessionStoreConfiguredFrom: persistence.sessionStoreConfiguredFrom,
        sessionStoreRawConfiguredValue: persistence.sessionStoreRawConfiguredValue,
        storeTargetConnection: persistence.storeTargetConnection,
        storeCredentialsConfigured: persistence.storeCredentialsConfigured,
        storeCredentialFingerprint: persistence.storeCredentialFingerprint,
        researchEnvironment: persistence.researchEnvironment,
        storageStateKeyScope: persistence.storageStateKeyScope,
        canonical: {
          storageStateKey: persistence.canonicalStateKey,
          metadataKey: persistence.canonicalMetaKey,
          storageStateExists: persistence.storageStateExists,
          metadataExists: persistence.metadataExists,
          storageStateBytes: persistence.storageStateBytes,
          validPlaywrightStorageStateJson: persistence.storageStateValid,
        },
        freshCanonicalReadback: persistence.freshCanonicalReadback,
        error: persistence.error,
      },
      null,
      2
    )
  );

  if (persistence.error) {
    process.exit(1);
  }
}

void main().catch((error: unknown) => {
  console.error(
    JSON.stringify(
      {
        ok: false,
        marketplace: getMarketplace(),
        error: error instanceof Error ? error.message : String(error),
      },
      null,
      2
    )
  );
  process.exit(1);
});
