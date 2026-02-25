const { notarize } = require('@electron/notarize');
const path = require('path');
const fs = require('fs');

exports.default = async function notarizing(context) {
  const { electronPlatformName, appOutDir } = context;
  if (electronPlatformName !== 'darwin') return;

  const appName = context.packager.appInfo.productFilename;
  const appPath = path.join(appOutDir, `${appName}.app`);

  console.log(`\n--- 🚀 Custom Notarization Start: ${appName} ---`);

  // ファイルが存在するかとサイズを確認
  if (!fs.existsSync(appPath)) {
    throw new Error(`App bundle not found at: ${appPath}`);
  }
  const stats = fs.statSync(appPath);
  console.log(`App size: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);

  const apiKeyPath = process.env.MY_APPLE_API_KEY;
  const apiKeyId = process.env.MY_APPLE_API_KEY_ID;
  const apiIssuer = process.env.MY_APPLE_API_ISSUER;

  if (!apiKeyPath || !apiKeyId || !apiIssuer) {
    console.log("⚠️ Skipping notarization: Missing MY_ environment variables.");
    return;
  }

  console.log(`Using Key ID: ${apiKeyId}`);
  console.log("Submitting to Apple... (This may take several minutes)");

  try {
    await notarize({
      tool: 'notarytool',
      appPath: appPath,
      appleApiKey: apiKeyPath,
      appleApiKeyId: apiKeyId,
      appleApiIssuer: apiIssuer,
      // 公証が終わるまで待つ最大時間（20分）を設定
      submissionWaitDuration: 20 * 60 * 1000 
    });
    console.log(`✅ --- Notarization Completed Successfully! ---`);
  } catch (error) {
    console.error('❌ Custom notarization failed:');
    console.error(error);
    throw error;
  }
};
