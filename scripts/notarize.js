const { notarize } = require('@electron/notarize');
const path = require('path');
const fs = require('fs');

exports.default = async function notarizing(context) {
  const { electronPlatformName, appOutDir } = context;
  if (electronPlatformName !== 'darwin') return;

  const appName = context.packager.appInfo.productFilename;
  const appPath = path.join(appOutDir, `${appName}.app`);

  console.log(`\n--- Notarization Start: ${appName} ---`);

  if (!process.env.APPLE_API_KEY || !process.env.APPLE_API_KEY_ID || !process.env.APPLE_API_ISSUER) {
    console.error("API Keyの情報が足りません。GitHub Secretsを確認してください。");
    return;
  }

  console.log(`Key ID: ${process.env.APPLE_API_KEY_ID}`);
  console.log(`Issuer ID: ${process.env.APPLE_API_ISSUER}`);
  console.log(`p8 File exists: ${fs.existsSync(process.env.APPLE_API_KEY)}`);

  try {
    await notarize({
      tool: 'notarytool',
      appPath: appPath,
      appleApiKey: process.env.APPLE_API_KEY,
      appleApiKeyId: process.env.APPLE_API_KEY_ID,
      appleApiIssuer: process.env.APPLE_API_ISSUER
    });
    console.log(`--- Notarization Successful! ---`);
  } catch (error) {
    console.error('Notarization failed:', error);
    throw error;
  }
};
