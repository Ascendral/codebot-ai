const { spawn, execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

exports.default = async function notarizing(context) {
  const { electronPlatformName, appOutDir } = context;

  if (electronPlatformName !== 'darwin') return;
  if (process.env.CODEBOT_FORCE_NOTARIZE !== '1') {
    console.log('Skipping notarization for local build (set CODEBOT_FORCE_NOTARIZE=1 to enable).');
    return;
  }

  const appName = context.packager.appInfo.productFilename;
  const appPath = path.join(appOutDir, `${appName}.app`);
  const zipPath = path.join(appOutDir, `${appName}.zip`);

  console.log(`Zipping ${appPath} for notarization...`);
  execSync(`ditto -c -k --keepParent "${appPath}" "${zipPath}"`, { stdio: 'inherit' });

  const zipSize = (fs.statSync(zipPath).size / 1024 / 1024).toFixed(1);
  console.log(`Submitting ${zipPath} (${zipSize}MB) for notarization...`);

  // Use async spawn instead of execSync to avoid ETIMEDOUT on large bundles.
  // execSync has a Node.js-level timeout that kills the process even when
  // Apple is still processing — spawn has no such timeout issue.
  try {
    await new Promise((resolve, reject) => {
      const proc = spawn(
        'xcrun',
        ['notarytool', 'submit', zipPath, '--keychain-profile', 'codebot-notarize', '--wait', '--timeout', '30m'],
        { stdio: 'inherit' },
      );

      proc.on('close', (code) => {
        if (code === 0) resolve();
        else reject(new Error(`notarytool exited with code ${code}`));
      });

      proc.on('error', (err) => reject(err));
    });

    console.log('Notarization succeeded. Stapling ticket...');
    execSync(`xcrun stapler staple "${appPath}"`, { stdio: 'inherit' });
    console.log('Stapling complete.');
  } catch (err) {
    console.error('Notarization failed:', err.message);
    throw err;
  } finally {
    // Clean up zip
    try {
      fs.unlinkSync(zipPath);
    } catch (_) {}
  }
};
