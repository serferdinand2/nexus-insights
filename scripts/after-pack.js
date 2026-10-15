/**
 * after-pack.js — electron-builder afterPack hook. macOS only.
 *
 * Without a paid Apple "Developer ID" certificate electron-builder skips
 * signing. That leaves only the executable's own linker signature, which
 * doesn't cover the Info.plist electron-builder rewrote, so the bundle's seal
 * is broken. Apple Silicon then rejects a downloaded copy as "damaged and
 * can't be opened", and the only way in is a Terminal command.
 *
 * An ad-hoc signature ("-") seals the bundle properly. macOS then shows the
 * ordinary unverified-developer prompt instead, which System Settings >
 * Privacy & Security > Open Anyway gets past.
 *
 * If a real identity is ever available, electron-builder signs after this
 * hook and replaces the ad-hoc signature.
 */

const path = require('path');
const { execFileSync } = require('child_process');

exports.default = async function afterPack(context) {
    if (context.electronPlatformName !== 'darwin') return;
    const app = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
    execFileSync('codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'inherit' });
};
