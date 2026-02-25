const { notarize } = require('@electron/notarize');
const path = require('path');
const fs = require('fs');

exports.default = async function notarizing(context) {
  const { electronPlatformName, appOutDir } = context;
  if (electronPlatformName !== 'darwin') return;

  const appName = context.packager.appInfo.productFilename;
  const appPath = path.join(appOutDir, `${appName}.app`);

  console.log(`\n--- 🚀 Custom Notarization Start: ${appName} ---`);

  // デバッグ用：中身がちゃんとあるか確認
  if (fs.existsSync(appPath)) {
    const files = fs.readdirSync(appPath);
    console.log(`App bundle contents: ${files.join(', ')}`);
  }

  const apiKeyPath = process.env.MY_APPLE_API_KEY;
  const apiKeyId = process.env.MY_APPLE_API_KEY_ID;
  const apiIssuer = process.env.MY_APPLE_API_ISSUER;
  const teamId = process.env.MY_APPLE_TEAM_ID; // ← これを追加

  if (!apiKeyPath || !apiKeyId || !apiIssuer || !teamId) {
    console.log("⚠️ Skipping notarization: Missing environment variables (Check Team ID).");
    return;
  }

  console.log(`Using Key ID: ${apiKeyId}, Team ID: ${teamId}`);
  console.log("Submitting to Apple... Please wait.");

  try {
    await notarize({
      tool: 'notarytool',
      appPath: appPath,
      appleApiKey: apiKeyPath,
      appleApiKeyId: apiKeyId,
      appleApiIssuer: apiIssuer,
      teamId: teamId // ← これを渡す
    });
    console.log(`✅ --- Notarization Completed Successfully! ---`);
  } catch (error) {
    console.error('❌ Custom notarization failed:', error);
    throw error;
  }
};
