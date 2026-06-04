# Building 0studio for Distribution

This guide covers how to build and package 0studio for shipping to end users.


TLDR:
# Step 1: Fix npm cache permissions
sudo chown -R $(whoami):staff ~/.npm

# Step 2: Upgrade electron-builder
npm install electron-builder@26.5.0 --save-dev

# Step 3: Clean old build artifacts
rm -rf dist dist-electron release

# Step 4: Rebuild
npm run build:all

## Prerequisites

Before building, ensure you have:

1. **Node.js 18+** and npm installed
2. **All dependencies installed**: `npm install`
3. **Environment variables configured** (see below)
4. **macOS** (for building macOS apps - cross-platform builds require additional setup)

## Environment Variables

For production builds, environment variables are embedded at build time. Make sure your `.env` file contains all required variables:

```env
# Supabase (optional - only for cloud features)
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your_anon_key

# Backend API (optional - only for cloud features)
VITE_BACKEND_URL=https://your-backend-url.com
```

> **Important**: 
> - Vite only reads `.env` files at build time
> - Never commit `.env` to version control (it's in `.gitignore`)
> - For production, use production URLs (not `localhost`)

## Build Steps

### Step 1: Build the React Frontend

Build the Vite/React application:

```bash
npm run build
```

This creates optimized production files in the `dist/` directory.

### Step 2: Build Electron TypeScript

Compile the Electron main process and preload scripts:

```bash
npm run build:electron
```

This compiles TypeScript files from `electron/` to JavaScript in `dist-electron/`. The script uses a cross-platform Node.js rename (works on macOS and Windows).

### Step 3: Package for Distribution

Create distributable packages (DMG for macOS, EXE for Windows):

```bash
# macOS DMG (run on macOS)
npm run electron:dist

# Windows EXE (run on Windows or via CI)
npm run build && npm run build:electron && npx electron-builder --win --publish=never
```

This will:
- Run the frontend build (if not already done)
- Package everything with electron-builder
- Create installers in the `release/` directory

## Complete Build Command

You can run all steps in sequence:

```bash
npm run build && npm run build:electron && npm run electron:dist
```

Or use the convenience script (if available):

```bash
npm run build:all
```

## Build Output

After a successful build, you'll find artifacts in the `release/` directory:

**macOS:**
- `release/0studio-1.0.1-arm64.dmg` — Apple Silicon installer
- `release/0studio-1.0.1.dmg` — Intel Mac installer
- `release/*.zip` — ZIP archives (for Homebrew cask distribution)

**Windows:**
- `release/0studio-1.0.1-Setup.exe` — NSIS installer (x64)

> **Note**: Run `ls release/*.zip` after building to confirm the exact filenames before updating Homebrew cask URLs — electron-builder naming can vary across versions.

### Testing the Built App

**macOS:**
1. **Mount the DMG**: Double-click the `.dmg` file
2. **Install**: Drag `0studio.app` to Applications
3. **Run**: Launch from Applications — if Gatekeeper blocks it, right-click → Open

**Windows:**
1. Double-click `*-Setup.exe`
2. If SmartScreen warns "Unknown publisher", click "More info" → "Run anyway" (app is unsigned)
3. Follow the installer wizard

**Test core features:**
- Open a .3dm file
- Create a commit
- View version history
- Test cloud sync (if applicable)

## Build Configuration

The build configuration is in `package.json` under the `"build"` key:

```json
{
  "build": {
    "appId": "com.rhinostudio.app",
    "productName": "0studio",
    "directories": {
      "output": "release"
    },
    "mac": {
      "category": "public.app-category.developer-tools",
      "target": ["dmg", "zip"],
      "arch": ["x64", "arm64"]
    },
    "win": {
      "icon": "assets/icon.ico",
      "target": [{ "target": "nsis", "arch": ["x64"] }]
    }
  }
}
```

### Customizing the Build

#### Change App ID

Edit `package.json`:
```json
"build": {
  "appId": "com.yourcompany.app"
}
```

#### Change Output Directory

```json
"build": {
  "directories": {
    "output": "release"
  }
}
```

#### Add Code Signing (for App Store distribution)

```json
"build": {
  "mac": {
    "identity": "Developer ID Application: Your Name (TEAM_ID)"
  }
}
```

#### Add Notarization (required for macOS Gatekeeper)

```json
"build": {
  "mac": {
    "hardenedRuntime": true,
    "gatekeeperAssess": false,
    "entitlements": "build/entitlements.mac.plist",
    "entitlementsInherit": "build/entitlements.mac.plist"
  },
  "afterSign": "scripts/notarize.js"
}
```

## Troubleshooting

### Build Fails with "Cannot find module"

**Problem**: Missing dependencies or TypeScript compilation errors.

**Solution**:
1. Run `npm install` to ensure all dependencies are installed
2. Check for TypeScript errors: `npm run build:electron`
3. Verify all imports are correct

### DMG Creation Fails

**Problem**: electron-builder can't create DMG.

**Solution**:
1. Ensure you're on macOS (DMG creation requires macOS)
2. Check disk space (need ~500MB free)
3. Try cleaning build artifacts: `rm -rf dist dist-electron release`

### App Won't Launch After Build

**Problem**: Built app crashes on launch.

**Solution**:
1. Check console logs: Run from terminal: `./release/mac/0studio.app/Contents/MacOS/0studio`
2. Verify environment variables are set correctly
3. Check that all required files are included in the build
4. Ensure backend API is accessible (if using cloud features)

### Missing Files in Build

**Problem**: Some files aren't included in the packaged app.

**Solution**:
1. Check `package.json` `build.files` array
2. Add missing files/patterns:
```json
"build": {
  "files": [
    "dist/**/*",
    "dist-electron/**/*",
    "assets/**/*",  // Add if needed
    "!**/node_modules/**/*",
    "!**/*.map"
  ]
}
```

## Distribution Checklist

Before shipping your app:

- [ ] All environment variables are set correctly
- [ ] Build completes without errors
- [ ] App launches and runs correctly
- [ ] Core features work (open file, commit, history)
- [ ] Cloud features work (if applicable)
- [ ] No console errors in production build
- [ ] App icon and metadata are correct
- [ ] Version number is updated in `package.json`
- [ ] DMG installer works correctly
- [ ] App can be installed and uninstalled cleanly

## Advanced: Continuous Integration

For automated builds, you can use GitHub Actions or similar CI/CD:

```yaml
# .github/workflows/build.yml
name: Build
on:
  push:
    tags:
      - 'v*'
jobs:
  build:
    runs-on: macos-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '18'
      - run: npm install
      - run: npm run build
      - run: npm run build:electron
      - run: npm run electron:dist
      - uses: actions/upload-artifact@v3
        with:
          name: dist
          path: dist-electron/*.dmg
```

## Next Steps

After building:

1. **Test thoroughly** on a clean macOS system
2. **Code sign** (if distributing outside App Store)
3. **Notarize** (required for macOS Gatekeeper)
4. **Upload** to distribution platform (App Store, website, etc.)
5. **Update version** in `package.json` for next release

---

For questions or issues, refer to:
- [README.md](./README.md) - General project information
- [PRD_CONTEXT.md](./PRD_CONTEXT.md) - Technical architecture details