#!/bin/bash

# Release script for 0studio
# Usage: ./scripts/release.sh 1.0.1

set -e

VERSION=$1

if [ -z "$VERSION" ]; then
    echo "Usage: ./scripts/release.sh <version>"
    echo "Example: ./scripts/release.sh 1.0.1"
    exit 1
fi

# Validate version format (semver)
if ! [[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    echo "Error: Version must be in semver format (e.g., 1.0.0)"
    exit 1
fi

echo "🚀 Releasing 0studio v$VERSION"

# Update version in package.json
echo "📝 Updating package.json version..."
npm version "$VERSION" --no-git-tag-version

# Commit the version bump
echo "📦 Committing version bump..."
git add package.json package-lock.json
git commit -m "chore: bump version to $VERSION"

# Create and push the tag
echo "🏷️  Creating tag v$VERSION..."
git tag "v$VERSION"

echo "⬆️  Pushing to origin..."
git push origin main
git push origin "v$VERSION"

echo ""
echo "✅ Release v$VERSION initiated!"
echo ""
echo "Next steps:"
echo "1. GitHub Actions will build and release automatically"
echo "2. Once complete, get SHA256 from the release:"
echo "   curl -sL https://github.com/YOUR_USERNAME/0studio/releases/download/v$VERSION/0studio-$VERSION-arm64-mac.zip | shasum -a 256"
echo "3. Update your Homebrew tap (homebrew-0studio) with new version and checksums"
echo ""
