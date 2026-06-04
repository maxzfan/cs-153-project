# Distributing 0studio via Homebrew

This guide explains how to distribute 0studio through Homebrew on macOS.

## Overview

Homebrew distributes GUI apps through **Casks**. You have two options:

1. **Create your own tap** (recommended to start) - Full control, immediate availability
2. **Submit to homebrew-cask** - Wider reach, but requires app notability

## Option 1: Create Your Own Tap (Recommended)

### Step 1: Create the Tap Repository

Create a new GitHub repository named `homebrew-0studio` (the `homebrew-` prefix is required).

```bash
# Create the repository on GitHub, then:
git clone https://github.com/YOUR_USERNAME/homebrew-0studio.git
cd homebrew-0studio
mkdir -p Casks
```

### Step 2: Create the Cask Formula

Create `Casks/0studio.rb`:

```ruby
cask "0studio" do
  version "1.0.0"
  
  # Use different URLs for different architectures
  on_arm do
    sha256 "REPLACE_WITH_ARM64_SHA256"
    url "https://github.com/YOUR_USERNAME/0studio/releases/download/v#{version}/0studio-#{version}-arm64-mac.zip"
  end
  on_intel do
    sha256 "REPLACE_WITH_X64_SHA256"
    url "https://github.com/YOUR_USERNAME/0studio/releases/download/v#{version}/0studio-#{version}-mac.zip"
  end

  name "0studio"
  desc "Desktop app for 3D model version control with Rhino3D files"
  homepage "https://github.com/YOUR_USERNAME/0studio"

  livecheck do
    url :url
    strategy :github_latest
  end

  app "0studio.app"

  zap trash: [
    "~/Library/Application Support/0studio",
    "~/Library/Caches/0studio",
    "~/Library/Preferences/com.rhinostudio.app.plist",
    "~/Library/Saved Application State/com.rhinostudio.app.savedState",
  ]
end
```

### Step 3: Get SHA256 Checksums

After creating a release, get the SHA256 checksums:

```bash
# Download your release ZIP files and generate checksums
shasum -a 256 0studio-1.0.0-arm64-mac.zip
shasum -a 256 0studio-1.0.0-mac.zip
```

Or use the checksums from the GitHub release (the workflow generates them automatically).

### Step 4: Push and Test

```bash
cd homebrew-0studio
git add .
git commit -m "Add 0studio cask v1.0.0"
git push origin main
```

Test the installation:

```bash
brew tap YOUR_USERNAME/0studio
brew install --cask 0studio
```

## Option 2: Submit to Official homebrew-cask

If your app gains traction, you can submit to the official Homebrew Cask repository.

### Requirements
- App must be notable (significant user base, press coverage, etc.)
- Must be a stable release
- Must be properly code-signed (recommended)

### Steps

1. Fork [homebrew-cask](https://github.com/Homebrew/homebrew-cask)
2. Create your cask in `Casks/0/0studio.rb`
3. Run `brew audit --cask 0studio` to validate
4. Submit a pull request

## Releasing New Versions

### Automated (Recommended)

1. Update version in `package.json`
2. Create and push a git tag:
   ```bash
   git tag v1.1.0
   git push origin v1.1.0
   ```
3. GitHub Actions will build and release automatically
4. Update your Homebrew tap with new version and SHA256

### Manual Release

1. Build the app:
   ```bash
   npm run build:all
   ```

2. Create a GitHub release and upload:
   - `release/0studio-VERSION-arm64-mac.zip`
   - `release/0studio-VERSION-mac.zip`
   - `release/0studio-VERSION-arm64.dmg`
   - `release/0studio-VERSION.dmg`

3. Update your Homebrew cask with new version and checksums

## Updating the Cask

When releasing a new version:

1. Download the new ZIP files
2. Generate new SHA256 checksums
3. Update `Casks/0studio.rb`:
   ```ruby
   version "1.1.0"  # Update version
   sha256 "new_checksum_here"  # Update checksums
   ```
4. Commit and push to your tap repository

## Code Signing (Recommended for Distribution)

For a smoother user experience, consider code signing your app:

1. **Apple Developer Account** - $99/year
2. **Developer ID Application Certificate**
3. **Notarization** - Required for macOS Catalina+

Update `package.json` build config:

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

Without code signing, users will see a Gatekeeper warning and need to right-click → Open the app the first time.

## Testing Your Cask Locally

Before publishing, test your cask locally:

```bash
# Create a local tap
mkdir -p $(brew --repository)/Library/Taps/local/homebrew-test/Casks
cp 0studio.rb $(brew --repository)/Library/Taps/local/homebrew-test/Casks/

# Install from local tap
brew install --cask local/test/0studio

# Or test from a file directly
brew install --cask ./0studio.rb
```

## Quick Start Checklist

- [ ] Build the app: `npm run build:all` (artifacts land in `release/`)
- [ ] Run `ls release/*.zip` to confirm exact filenames before updating cask URLs
- [ ] Create GitHub release with ZIP files
- [ ] Generate SHA256 checksums
- [ ] Create `homebrew-0studio` repository
- [ ] Add `Casks/0studio.rb` with correct URLs and checksums
- [ ] Test: `brew tap USERNAME/0studio && brew install --cask 0studio`
- [ ] Update README with installation instructions
