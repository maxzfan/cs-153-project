const { execSync } = require('child_process');
const path = require('path');

// Ad-hoc sign the app with JIT entitlements after electron-builder packs it.
// Without this, macOS blocks V8 JIT in unsigned apps, causing ~30x slower JS execution.
//
// electron-builder 26.x's PackContext does NOT expose `projectDir` (only
// `outDir`, `appOutDir`, `packager`, `electronPlatformName`, `arch`, `targets`).
// Earlier code reached for `context.projectDir` and crashed with
// "TypeError: The 'path' argument must be of type string. Received undefined".
// Resolve the entitlements path relative to this script's location instead.
const PROJECT_ROOT = path.resolve(__dirname, '..');

exports.default = async function afterPack(context) {
  if (process.platform !== 'darwin') return;

  const appPath = path.join(
    context.appOutDir,
    `${context.packager.appInfo.productFilename}.app`
  );
  const entitlements = path.join(PROJECT_ROOT, 'build', 'entitlements.mac.plist');

  console.log(`Ad-hoc signing ${appPath} with JIT entitlements...`);
  execSync(
    `codesign -s - --deep --force --entitlements "${entitlements}" "${appPath}"`,
    { stdio: 'inherit' }
  );
};
