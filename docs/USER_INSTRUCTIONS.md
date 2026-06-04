# Instructions for Users: Opening 0studio

If you see a warning that "0studio cannot be opened because it is from an unidentified developer," follow these steps:

## Method 1: Right-Click and Open (Easiest)

1. **Locate the app** in your Downloads folder or wherever you saved it
2. **Right-click** (or Control+Click) on `0studio.app`
3. Select **"Open"** from the context menu
4. Click **"Open"** in the security dialog that appears
5. The app will now open, and macOS will remember your choice

## Method 2: System Settings

1. **Open System Settings** (or System Preferences on older macOS)
2. Go to **Privacy & Security**
3. Scroll down to the **Security** section
4. You'll see a message: *"0studio was blocked because it is from an unidentified developer"*
5. Click **"Open Anyway"**
6. Confirm by clicking **"Open"** in the dialog

## Method 3: Remove Quarantine Attribute (Advanced)

If the above methods don't work, you can remove the quarantine attribute:

1. Open **Terminal**
2. Navigate to where you downloaded the app:
   ```bash
   cd ~/Downloads
   ```
3. Remove the quarantine attribute:
   ```bash
   xattr -cr 0studio.app
   ```
4. Now you can open the app normally

## Why This Happens

macOS includes a security feature called **Gatekeeper** that blocks apps from unknown developers. This is a safety measure to protect your Mac.

**For the best experience**, we recommend:
- The developer gets an Apple Developer Certificate ($99/year)
- The app is properly code signed and notarized
- No warnings appear when opening the app

Until then, the methods above will allow you to use the app safely.

## Still Having Issues?

If you continue to have problems:
1. Make sure you downloaded the app from the official source
2. Check that your macOS is up to date
3. Contact support if the issue persists
