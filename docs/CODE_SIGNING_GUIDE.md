# Code Signing & Notarization Guide for macOS

This guide explains how to properly code sign and notarize your macOS app to avoid the "unidentified developer" warning.

## The Problem

When users download an unsigned app, macOS shows:
> "0studio cannot be opened because it is from an unidentified developer"

Users must right-click → Open, or go to System Settings → Privacy & Security to allow it.

## The Solution: Code Signing + Notarization

To eliminate this warning, you need:
1. **Code Signing** - Proves the app comes from you
2. **Notarization** - Apple verifies the app is safe

Both require an **Apple Developer Account** ($99/year).

---

## Step 1: Get an Apple Developer Account

1. Go to [developer.apple.com](https://developer.apple.com)
2. Sign up for the Apple Developer Program ($99/year)
3. Wait for approval (usually instant, but can take 24-48 hours)

---

## Step 2: Get Your Developer ID

Once approved:

1. Go to [Apple Developer Portal](https://developer.apple.com/account)
2. Navigate to **Certificates, Identifiers & Profiles**
3. Click **Certificates** → **+** to create a new certificate
4. Select **Developer ID Application** (for distribution outside App Store)
5. Follow the instructions to create a certificate
6. Download and double-click the certificate to install it in Keychain

**Find your Developer ID:**
```bash
security find-identity -v -p codesigning
```

Look for a line like:
```
Developer ID Application: Your Name (TEAM_ID)
```

---

## Step 3: Configure Code Signing

Update `package.json`:

```json
{
  "build": {
    "mac": {
      "identity": "Developer ID Application: Your Name (TEAM_ID)",
      "hardenedRuntime": true,
      "gatekeeperAssess": false
    }
  }
}
```

Replace `Your Name (TEAM_ID)` with your actual Developer ID from Step 2.

---

## Step 4: Create Entitlements File

Create `build/entitlements.mac.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>com.apple.security.cs.allow-jit</key>
  <true/>
  <key>com.apple.security.cs.allow-unsigned-executable-memory</key>
  <true/>
  <key>com.apple.security.cs.allow-dyld-environment-variables</key>
  <true/>
  <key>com.apple.security.cs.disable-library-validation</key>
  <true/>
</dict>
</plist>
```

Update `package.json` to use it:

```json
{
  "build": {
    "mac": {
      "entitlements": "build/entitlements.mac.plist",
      "entitlementsInherit": "build/entitlements.mac.plist"
    }
  }
}
```

---

## Step 5: Set Up Notarization

### Option A: Using App-Specific Password (Recommended)

1. Go to [appleid.apple.com](https://appleid.apple.com)
2. Sign in with your Apple ID
3. Go to **Security** → **App-Specific Passwords**
4. Create a new password (name it "Notarization")
5. Save the password securely

### Option B: Using Keychain

If you have 2FA enabled, you can use your regular password with an app-specific password.

---

## Step 6: Create Notarization Script

Create `scripts/notarize.js`:

```javascript
const { notarize } = require('@electron/notarize');

exports.default = async function notarizing(context) {
  const { electronPlatformName, appOutDir } = context;
  if (electronPlatformName !== 'darwin') {
    return;
  }

  const appName = context.packager.appInfo.productFilename;

  return await notarize({
    appBundleId: 'com.rhinostudio.app',
    appPath: `${appOutDir}/${appName}.app`,
    appleId: process.env.APPLE_ID,
    appleIdPassword: process.env.APPLE_ID_PASSWORD,
    teamId: process.env.APPLE_TEAM_ID,
  });
};
```

Install the notarization package:
```bash
npm install @electron/notarize --save-dev
```

---

## Step 7: Configure Environment Variables

Create a `.env.build` file (add to `.gitignore`):

```env
APPLE_ID=your-email@example.com
APPLE_ID_PASSWORD=your-app-specific-password
APPLE_TEAM_ID=YOUR_TEAM_ID
```

Update `package.json` scripts to load these:

```json
{
  "scripts": {
    "electron:dist": "npm run build && npm run build:electron && npm run prebuild:electron && electron-builder --publish=never"
  }
}
```

Or set them in your shell before building:
```bash
export APPLE_ID="your-email@example.com"
export APPLE_ID_PASSWORD="your-app-specific-password"
export APPLE_TEAM_ID="YOUR_TEAM_ID"
npm run build:all
```

---

## Step 8: Update Build Configuration

Update `package.json`:

```json
{
  "build": {
    "mac": {
      "identity": "Developer ID Application: Your Name (TEAM_ID)",
      "hardenedRuntime": true,
      "gatekeeperAssess": false,
      "entitlements": "build/entitlements.mac.plist",
      "entitlementsInherit": "build/entitlements.mac.plist"
    },
    "afterSign": "scripts/notarize.js"
  }
}
```

**Remove** `CSC_IDENTITY_AUTO_DISCOVERY=false` from build scripts.

---

## Step 9: Build and Test

```bash
npm run build:all
```

The build will:
1. Code sign the app
2. Create the DMG
3. Notarize with Apple (takes 5-10 minutes)
4. Staple the notarization ticket to the app

---

## Verifying Code Signing

Check if your app is signed:
```bash
codesign -dv --verbose=4 dist-electron/mac/0studio.app
```

Check notarization status:
```bash
spctl -a -vv dist-electron/mac/0studio.app
```

---

## Troubleshooting

### "resource fork, Finder information, or similar detritus not allowed"

This happens when files have extended attributes. Clean them:
```bash
find dist-electron -type f -exec xattr -c {} \;
rm -rf dist-electron/mac
npm run build:all
```

### Notarization Fails

- Check your Apple ID credentials
- Ensure app-specific password is correct
- Verify Team ID matches your Developer account
- Check notarization logs: `xcrun altool --notarization-history 0 -u YOUR_APPLE_ID -p YOUR_PASSWORD`

### "The signature is invalid"

- Make sure you're using the correct Developer ID
- Verify the certificate is installed in Keychain
- Check that `hardenedRuntime` is enabled

---

## Alternative: User Instructions (Temporary Solution)

If you can't code sign yet, provide users with these instructions:

### For Users Downloading Your App:

1. **Download the DMG**
2. **Open System Settings** → **Privacy & Security**
3. Under "Security", you'll see a message about the app being blocked
4. Click **"Open Anyway"**
5. Or: Right-click the app → **Open** → Click **"Open"** in the dialog

You can include these instructions in your download page or README.

---

## Cost Summary

- **Apple Developer Program**: $99/year
- **Code Signing**: Free (included)
- **Notarization**: Free (included)
- **Total**: $99/year

---

## Next Steps

1. Sign up for Apple Developer Program
2. Get your Developer ID certificate
3. Follow steps above to configure signing
4. Test with a build
5. Distribute your properly signed app!

For questions, see:
- [Apple Code Signing Guide](https://developer.apple.com/library/archive/documentation/Security/Conceptual/CodeSigningGuide/)
- [electron-builder Code Signing Docs](https://www.electron.build/code-signing)
