const { spawn } = require('child_process');
const OWNER = 'garuneko';
const REPO = 'Aerune';

async function fetchDownloadStats() {
  const url = `https://api.github.com/repos/${OWNER}/${REPO}/releases`;

  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': 'Aerune-Download-Counter' }
    });

    if (!response.ok) {
      throw new Error(`APIエラー: ${response.status} ${response.statusText}`);
    }

    const releases = await response.json();

    let totalDownloads = 0;
    let macDownloads = 0;
    let winDownloads = 0;
    const versionStats = [];

    for (const release of releases) {
      const version = release.tag_name;
      let versionTotal = 0;
      let versionMac = 0;
      let versionWin = 0;

      for (const asset of release.assets) {
        const count = asset.download_count;
        const name = asset.name;

        if (count === 0) continue;

        totalDownloads += count;
        versionTotal += count;

        if (name.endsWith('.dmg') || name.endsWith('.zip')) {
          macDownloads += count;
          versionMac += count;
        } else if (name.endsWith('.exe')) {
          winDownloads += count;
          versionWin += count;
        }
      }

      if (versionTotal > 0) {
        versionStats.push({ version, total: versionTotal, mac: versionMac, win: versionWin });
      }
    }

    // ターミナルへの通常出力
    console.log(`\n=== 🚀 Aerune ダウンロード集計 ===\n`);
    console.log(`🏆 全体合計: ${totalDownloads} DL`);
    console.log(`🍎 Mac (dmg/zip): ${macDownloads} DL`);
    console.log(`🪟 Windows (exe): ${winDownloads} DL\n`);

    console.log(`=== 📦 バージョン別内訳 ===`);
    for (const stat of versionStats) {
      console.log(`[${stat.version.padEnd(6)}] 合計: ${String(stat.total).padStart(2)} (Mac: ${stat.mac} / Win: ${stat.win})`);
    }
    console.log(`================================\n`);

    // --- ここからSNS用テキスト作成＆クリップボードコピー処理 ---
    const latestVersion = versionStats.length > 0 ? versionStats[0].version : 'v--';
    const postText = `Aerune ダウンロード進捗🚀\n累計: ${totalDownloads} DL (🍎Mac: ${macDownloads} / 🪟Win: ${winDownloads})\n最新版 [${latestVersion}] も配信中！\nいつもありがとうございます✨`;

    const pbcopy = spawn('pbcopy');
    pbcopy.stdin.write(postText);
    pbcopy.stdin.end();

    console.log(`📋 以下のテキストをクリップボードにコピーしました！`);
    console.log(`--------------------------------`);
    console.log(postText);
    console.log(`--------------------------------`);
    console.log(`💡 そのまま「エアルネ」を開いて Cmd+V でポストできます！\n`);

  } catch (error) {
    console.error("❌ 集計に失敗しました:", error.message);
  }
}

fetchDownloadStats();
