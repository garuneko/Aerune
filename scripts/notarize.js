const { notarize } = require('@electron/notarize');
const path = require('path');

exports.default = async function notarizing(context) {
  const { electronPlatformName, appOutDir } = context;
  if (electronPlatformName !== 'darwin') return;

  const appName = context.packager.appInfo.productFilename;
  const appPath = path.join(appOutDir, `${appName}.app`);

  console.log(`\n--- Notarization Start: ${appName} ---`);

  // electron-builderにバレないように独自の環境変数名「MY_」で受け取る
  const apiKeyPath = process.env.MY_APPLE_API_KEY;
  const apiKeyId = process.env.MY_APPLE_API_KEY_ID;
  const apiIssuer = process.env.MY_APPLE_API_ISSUER;

  if (!apiKeyPath || !apiKeyId || !apiIssuer) {
    console.log("Skipping notarization: Missing API keys.");
    return;
  }

  try {
    await notarize({
      tool: 'notarytool',
      appPath: appPath,
      appleApiKey: apiKeyPath,
      appleApiKeyId: apiKeyId,
      appleApiIssuer: apiIssuer
    });
    console.log(`--- Notarization Successful! ---`);
  } catch (error) {
    console.error('Notarization failed:', error);
    throw error;
  }
};
