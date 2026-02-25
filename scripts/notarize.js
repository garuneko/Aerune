const { notarize } = require('@electron/notarize');
const path = require('path');

exports.default = async function notarizing(context) {
  const { electronPlatformName, appOutDir } = context;
  if (electronPlatformName !== 'darwin') return;

  const appName = context.packager.appInfo.productFilename;
  const appPath = path.join(appOutDir, `${appName}.app`);

  console.log(`\n--- Custom Notarization Start: ${appName} ---`);

  delete process.env.APPLE_ID;
  delete process.env.APPLE_ID_PASSWORD;
  delete process.env.APPLE_PASSWORD;
  delete process.env.APPLE_TEAM_ID;

  const apiKeyPath = process.env.MY_APPLE_API_KEY;
  const apiKeyId = process.env.MY_APPLE_API_KEY_ID;
  const apiIssuer = process.env.MY_APPLE_API_ISSUER;

  if (!apiKeyPath || !apiKeyId || !apiIssuer) {
    console.log("Skipping notarization: Missing MY_ environment variables.");
    return;
  }

  console.log(`Using Key ID: ${apiKeyId}`);
  console.log("Submitting to Apple... (Appleの審査待ちです。10分〜30分ほどかかることがあります)");

  try {
    await notarize({
      tool: 'notarytool',
      appPath: appPath,
      appleApiKey: apiKeyPath,
      appleApiKeyId: apiKeyId,
      appleApiIssuer: apiIssuer
    });
    console.log(`--- Notarization Completed Successfully! ---`);
  } catch (error) {
    console.error('Custom notarization failed:', error);
    throw error;
  }
};
