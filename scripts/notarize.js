const { notarize } = require('@electron/notarize');
const path = require('path');

exports.default = async function notarizing(context) {
  const { electronPlatformName, appOutDir } = context;
  // macOS以外、またはプルリクエスト時はスキップ（Secretsが使えないため）
  if (electronPlatformName !== 'darwin' || process.env.NODE_ENV === 'test') return;

  const appName = context.packager.appInfo.productFilename;
  const appPath = path.join(appOutDir, `${appName}.app`);

  console.log(`--- Notarization Start: ${appName} ---`);

  try {
    await notarize({
      tool: 'notarytool',
      appPath: appPath,
      appleApiKey: process.env.APPLE_API_KEY,      // p8ファイルのパス
      appleApiKeyId: process.env.APPLE_API_KEY_ID,  // 10桁のキーID
      appleApiIssuer: process.env.APPLE_API_ISSUER, // UUID形式のIssuer ID
    });
  } catch (error) {
    console.error('Notarization failed:');
    console.error(error);
    throw error; // エラー時はビルドを停止させる
  }

  console.log(`--- Notarization Completed ---`);
};
