const { notarize } = require('@electron/notarize');
const path = require('path');
const fs = require('fs');

exports.default = async function notarizing(context) {
  const { electronPlatformName, appOutDir } = context;
  if (electronPlatformName !== 'darwin') return;

  const appName = context.packager.appInfo.productFilename;
  const appPath = path.join(appOutDir, `${appName}.app`);

  console.log(`\n--- 🚀 Custom Notarization Start: ${appName} ---`);

  // 混乱を防ぐため、公証に関係しそうな環境変数をこのスクリプト内だけで一時的に消去
  delete process.env.APPLE_ID;
  delete process.env.APPLE_ID_PASSWORD;
  delete process.env.APPLE_PASSWORD;

  const apiKeyPath = process.env.MY_APPLE_API_KEY;
  const apiKeyId = process.env.MY_APPLE_API_KEY_ID;
  const apiIssuer = process.env.MY_APPLE_API_ISSUER;
  const teamId = process.env.MY_APPLE_TEAM_ID;

  if (!apiKeyPath || !apiKeyId || !apiIssuer || !teamId) {
    console.log("⚠️ Skipping notarization: Missing environment variables (Check Team ID).");
    return;
  }

  console.log(`Using Key ID: ${apiKeyId}, Team ID: ${teamId}`);
  console.log("Submitting to Apple... (Wait up to 20 mins)");

  try {
    await notarize({
      tool: 'notarytool',
      appPath: appPath,
      appleApiKey: apiKeyPath,
      appleApiKeyId: apiKeyId,
      appleApiIssuer: apiIssuer,
      teamId: teamId
    });
    console.log(`✅ --- Notarization Completed Successfully! ---`);
  } catch (error) {
    console.error('❌ Custom notarization failed:');
    console.error(error);
    throw error;
  }
};
