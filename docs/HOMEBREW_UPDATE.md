# Updating Homebrew After Changes

This guide walks you through updating your Homebrew tap after making changes to 0studio.

## Quick Reference

```bash
# 1. Release new version
./scripts/release.sh 1.0.1

# 2. Wait for GitHub Actions to build

# 3. Get SHA256 checksums from the release page

# 4. Update your homebrew tap
cd ~/path/to/homebrew-0studio
# Edit Casks/0studio.rb with new version and checksums
git add .
git commit -m "Update 0studio to v1.0.1"
git push

# 5. Test the update
brew update
brew upgrade --cask 0studio
```

## Detailed Step-by-Step Guide

### Step 1: Make and Test Your Changes

1. Make your code changes in the 0studio repository
2. Test locally: `npm run dev`
3. Build locally to verify: `npm run build`
4. Commit your changes:
   ```bash
   git add .
   git commit -m "Your commit message"
   git push origin main
   ```

### Step 2: Create a New Release

Use the release script to automate version bumping and tagging:

```bash
./scripts/release.sh 1.0.1
```

This script will:
- Update `package.json` version
- Create a git commit for the version bump
- Create a git tag `v1.0.1`
- Push everything to GitHub
- Trigger GitHub Actions to build the release

**Alternative: Manual Release**

If you prefer to do it manually:

```bash
# Update version in package.json
npm version 1.0.1 --no-git-tag-version

# Commit
git add package.json package-lock.json
git commit -m "chore: bump version to 1.0.1"

# Tag and push
git tag v1.0.1
git push origin main
git push origin v1.0.1
```

### Step 3: Wait for GitHub Actions Build

1. Go to your GitHub repository
2. Click on **Actions** tab
3. Wait for the build workflow to complete (usually 5-10 minutes)
4. Once complete, go to **Releases** to see the new release

The release should include:
- `0studio-1.0.1-arm64-mac.zip` (Apple Silicon)
- `0studio-1.0.1-mac.zip` (Intel)
- `0studio-1.0.1-arm64.dmg` (Apple Silicon)
- `0studio-1.0.1.dmg` (Intel)

### Step 4: Get SHA256 Checksums

You have two options:

**Option A: From GitHub Release Page**

1. Go to your release page: `https://github.com/YOUR_USERNAME/0studio/releases/tag/v1.0.1`
2. If the workflow generates checksums, they'll be in the release notes
3. Copy the SHA256 values for both ZIP files

**Option B: Generate Locally**

Download the ZIP files and generate checksums:

```bash
# Download the files
curl -LO https://github.com/YOUR_USERNAME/0studio/releases/download/v1.0.1/0studio-1.0.1-arm64-mac.zip
curl -LO https://github.com/YOUR_USERNAME/0studio/releases/download/v1.0.1/0studio-1.0.1-mac.zip

# Generate checksums
shasum -a 256 0studio-1.0.1-arm64-mac.zip
shasum -a 256 0studio-1.0.1-mac.zip
```

**Option C: Generate Directly from URL**

```bash
curl -sL https://github.com/YOUR_USERNAME/0studio/releases/download/v1.0.1/0studio-1.0.1-arm64-mac.zip | shasum -a 256
curl -sL https://github.com/YOUR_USERNAME/0studio/releases/download/v1.0.1/0studio-1.0.1-mac.zip | shasum -a 256
```

### Step 5: Update Your Homebrew Tap

Navigate to your homebrew tap repository:

```bash
cd ~/path/to/homebrew-0studio
```

Edit `Casks/0studio.rb` and update:

```ruby
cask "0studio" do
  version "1.0.1"  # ← Update this

  on_arm do
    sha256 "NEW_ARM64_SHA256_HERE"  # ← Update this
    url "https://github.com/YOUR_USERNAME/0studio/releases/download/v#{version}/0studio-#{version}-arm64-mac.zip"
  end
  on_intel do
    sha256 "NEW_INTEL_SHA256_HERE"  # ← Update this
    url "https://github.com/YOUR_USERNAME/0studio/releases/download/v#{version}/0studio-#{version}-mac.zip"
  end

  # ... rest stays the same
end
```

**Important:** Only update the `version` and `sha256` values. The URL uses `#{version}` variable, so it will automatically point to the correct release.

### Step 6: Commit and Push the Homebrew Tap Update

```bash
cd ~/path/to/homebrew-0studio
git add Casks/0studio.rb
git commit -m "Update 0studio to v1.0.1"
git push origin main
```

### Step 7: Test the Update

Wait a minute for Homebrew to pick up the changes, then test:

```bash
# Update Homebrew
brew update

# Upgrade to the new version
brew upgrade --cask 0studio

# Or uninstall and reinstall to test fresh install
brew uninstall --cask 0studio
brew install --cask 0studio
```

## Troubleshooting

### "Version already installed"

If Homebrew says the version is already installed:

```bash
brew uninstall --cask 0studio
brew install --cask 0studio
```

### SHA256 Mismatch Error

If you get a checksum error:
1. Re-download the file from the release
2. Re-generate the SHA256
3. Make sure you're using the correct file (arm64 vs intel)
4. Update the cask and push again

### App Not Opening After Update

If the app shows quarantine/security warnings:
1. Run: `xattr -cr /Applications/0studio.app`
2. Or right-click the app → Open (first time only)

For a better experience, consider code signing (see `CODE_SIGNING_GUIDE.md`)

### "No available cask" Error

Users need to update their Homebrew tap first:

```bash
brew update
brew tap YOUR_USERNAME/0studio --force
brew upgrade --cask 0studio
```

## User Installation Instructions

After updating your tap, users can update with:

```bash
brew update
brew upgrade --cask 0studio
```

Or for new installations:

```bash
brew tap YOUR_USERNAME/0studio
brew install --cask 0studio
```

## Automated Update Workflow (Future)

Consider automating the Homebrew tap update:

1. Add a workflow to your main repo that runs after release
2. Automatically updates the homebrew tap repository
3. Example using GitHub Actions:

```yaml
# .github/workflows/update-homebrew.yml
name: Update Homebrew

on:
  release:
    types: [published]

jobs:
  update:
    runs-on: ubuntu-latest
    steps:
      - name: Update Homebrew Tap
        uses: mislav/bump-homebrew-formula-action@v2
        with:
          formula-name: 0studio
          homebrew-tap: YOUR_USERNAME/homebrew-0studio
          base-branch: main
          download-url: https://github.com/YOUR_USERNAME/0studio/releases/download/${{ github.event.release.tag_name }}/0studio-${{ github.event.release.tag_name }}-arm64-mac.zip
        env:
          COMMITTER_TOKEN: ${{ secrets.COMMITTER_TOKEN }}
```

## Checklist

- [ ] Make and commit your code changes
- [ ] Run `./scripts/release.sh NEW_VERSION`
- [ ] Wait for GitHub Actions to complete the build
- [ ] Get SHA256 checksums from release
- [ ] Update `Casks/0studio.rb` in homebrew tap
- [ ] Commit and push homebrew tap changes
- [ ] Test: `brew upgrade --cask 0studio`
- [ ] Verify app launches correctly
- [ ] Update release notes if needed

## Related Guides

- `HOMEBREW_SETUP.md` - Initial Homebrew setup
- `BUILD_GUIDE.md` - Building the app
- `CODE_SIGNING_GUIDE.md` - Code signing setup
