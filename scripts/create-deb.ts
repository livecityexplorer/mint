import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

export function buildDebianPackage() {
  const rootDir = process.cwd();
  const buildDir = path.join(rootDir, 'deb-build');
  const pkgName = 'mint-iptv-player';
  const version = '1.0.0';
  const arch = 'amd64';
  const pkgDirName = `${pkgName}_${version}_${arch}`;
  const targetDir = path.join(buildDir, pkgDirName);
  const outDebDir = path.join(rootDir, 'dist');
  const outDebFile = path.join(outDebDir, `${pkgDirName}.deb`);

  console.log(`[DEB BUILDER] Preparing packaging structure at ${targetDir}...`);

  // Clean previous build directory
  if (fs.existsSync(targetDir)) {
    fs.rmSync(targetDir, { recursive: true, force: true });
  }
  fs.mkdirSync(outDebDir, { recursive: true });

  // Create standard debian layout
  const debianDir = path.join(targetDir, 'DEBIAN');
  const binDir = path.join(targetDir, 'usr', 'bin');
  const appsDir = path.join(targetDir, 'usr', 'share', 'applications');
  const iconsDir = path.join(targetDir, 'usr', 'share', 'icons', 'hicolor', 'scalable', 'apps');
  const shareAppDir = path.join(targetDir, 'usr', 'share', 'mint-iptv-player');
  const targetShareDist = path.join(shareAppDir, 'dist');

  fs.mkdirSync(debianDir, { recursive: true });
  fs.mkdirSync(binDir, { recursive: true });
  fs.mkdirSync(appsDir, { recursive: true });
  fs.mkdirSync(iconsDir, { recursive: true });
  fs.mkdirSync(shareAppDir, { recursive: true });
  fs.mkdirSync(targetShareDist, { recursive: true });

  // 1. Copy web dist files (excluding any .deb files to prevent bloat or recursive packaging)
  const distSrc = path.join(rootDir, 'dist');
  if (fs.existsSync(distSrc)) {
    const files = fs.readdirSync(distSrc);
    for (const file of files) {
      if (file.endsWith('.deb')) continue;
      const srcPath = path.join(distSrc, file);
      const destPath = path.join(targetShareDist, file);
      try {
        execSync(`cp -r "${srcPath}" "${destPath}"`);
      } catch (e) {
        console.warn(`Failed to copy ${file}:`, e);
      }
    }
  }

  // 1b. Copy embedded Python desktop server (/usr/share/mint-iptv-player/server.py)
  // Python 3 is pre-installed on 100% of Linux Mint systems, guaranteeing zero-dependency execution.
  const pythonServerSrc = path.join(rootDir, 'scripts', 'server.py');
  if (fs.existsSync(pythonServerSrc)) {
    fs.copyFileSync(pythonServerSrc, path.join(shareAppDir, 'server.py'));
    fs.chmodSync(path.join(shareAppDir, 'server.py'), 0o755);
  }

  // 2. Electron Main Runner (/usr/share/mint-iptv-player/electron-main.cjs)
  const electronRunner = `// Electron Main Runner for Mint IPTV Player
const { app, BrowserWindow, Menu } = require('electron');
const path = require('path');

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    backgroundColor: '#121316',
    title: 'Mint IPTV Player',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: false // Allows IPTV m3u8 streams from diverse servers
    }
  });

  Menu.setApplicationMenu(null); // Clean cinematic presentation

  const indexPath = path.join(__dirname, 'dist', 'index.html');
  if (require('fs').existsSync(indexPath)) {
    mainWindow.loadFile(indexPath);
  } else {
    mainWindow.loadFile(path.join(__dirname, 'index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
`;
  fs.writeFileSync(path.join(shareAppDir, 'electron-main.cjs'), electronRunner, 'utf-8');

  // Fallback index.html in shareAppDir
  const standaloneHtml = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Mint IPTV Player</title>
  <meta http-equiv="refresh" content="0; url=dist/index.html" />
</head>
<body style="background:#121316;color:#87cf3e;font-family:sans-serif;padding:40px;text-align:center;">
  <h2>Loading Mint IPTV Player...</h2>
  <p>Opening player interface. If not redirected automatically, <a href="dist/index.html" style="color:#87cf3e;">click here</a>.</p>
</body>
</html>`;
  fs.writeFileSync(path.join(shareAppDir, 'index.html'), standaloneHtml, 'utf-8');

  // 3. Desktop Entry (/usr/share/applications/mint-iptv-player.desktop)
  const desktopContent = `[Desktop Entry]
Name=Mint IPTV Player
Comment=Modern IPTV Player with M3U, Xtream Codes, and EPG Grid
GenericName=IPTV & TV Guide Player
Exec=/usr/bin/mint-iptv-player %U
Icon=mint-iptv-player
Terminal=false
Type=Application
Categories=AudioVideo;Video;TV;Player;
Keywords=iptv;m3u;xtream;epg;tivimate;tv;player;stream;mint;cinnamon;
StartupWMClass=mint-iptv-player
MimeType=application/x-mpegurl;video/mp2t;application/vnd.apple.mpegurl;
Actions=FullScreen;EpgGrid;Port43210;Port8080;

[Desktop Action FullScreen]
Name=Launch in Full Screen
Exec=/usr/bin/mint-iptv-player --fullscreen

[Desktop Action EpgGrid]
Name=Open TV Guide (EPG)
Exec=/usr/bin/mint-iptv-player --view=epg

[Desktop Action Port43210]
Name=Launch on Dedicated Port (43210)
Exec=/usr/bin/mint-iptv-player --port=43210

[Desktop Action Port8080]
Name=Launch on Port 8080
Exec=/usr/bin/mint-iptv-player --port=8080
`;
  fs.writeFileSync(path.join(appsDir, 'mint-iptv-player.desktop'), desktopContent, 'utf-8');

  // 4. SVG Icon (/usr/share/icons/hicolor/scalable/apps/mint-iptv-player.svg)
  const svgIcon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="128" height="128">
  <defs>
    <linearGradient id="mintGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#87cf3e"/>
      <stop offset="100%" stop-color="#559922"/>
    </linearGradient>
    <linearGradient id="tvBg" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#26282e"/>
      <stop offset="100%" stop-color="#141518"/>
    </linearGradient>
  </defs>
  <rect x="8" y="16" width="112" height="86" rx="14" fill="url(#tvBg)" stroke="#3a3e47" stroke-width="3"/>
  <rect x="16" y="24" width="96" height="70" rx="8" fill="#0b0c0e" stroke="#22242a" stroke-width="2"/>
  <path d="M 64 16 C 60 8, 48 4, 42 6 C 44 12, 52 15, 64 16 Z" fill="#87cf3e"/>
  <path d="M 64 16 C 68 8, 80 4, 86 6 C 84 12, 76 15, 64 16 Z" fill="#9fe653"/>
  <rect x="54" y="102" width="20" height="8" rx="2" fill="#32353c"/>
  <rect x="40" y="110" width="48" height="6" rx="3" fill="#424650"/>
  <polygon points="50,42 86,59 50,76" fill="url(#mintGrad)"/>
  <circle cx="86" cy="38" r="4" fill="#87cf3e"/>
  <path d="M 94 48 A 12 12 0 0 1 94 70" fill="none" stroke="#87cf3e" stroke-width="3" stroke-linecap="round" opacity="0.8"/>
  <path d="M 100 42 A 20 20 0 0 1 100 76" fill="none" stroke="#87cf3e" stroke-width="2.5" stroke-linecap="round" opacity="0.4"/>
</svg>`;
  fs.writeFileSync(path.join(iconsDir, 'mint-iptv-player.svg'), svgIcon, 'utf-8');

  // 5. Launcher Executable (/usr/bin/mint-iptv-player)
  const launcherScript = [
    '#!/bin/bash',
    '# Mint IPTV Player Launcher for Linux Mint',
    'APP_DIR="/usr/share/mint-iptv-player"',
    'CONFIG_DIR="$HOME/.config/mint-iptv-player"',
    'mkdir -p "$CONFIG_DIR" 2>/dev/null || true',
    '',
    '# Default Dedicated IPTV Port (avoids common port 3000 conflicts)',
    'DEFAULT_PORT="43210"',
    'CHOSEN_PORT=""',
    '',
    '# Check if user saved a preferred port in ~/.config/mint-iptv-player/port',
    'if [ -f "$CONFIG_DIR/port" ]; then',
    '    SAVED_PORT=$(cat "$CONFIG_DIR/port" 2>/dev/null | tr -d \'[:space:]\')',
    '    if [ -n "$SAVED_PORT" ]; then',
    '        CHOSEN_PORT="$SAVED_PORT"',
    '    fi',
    'fi',
    '',
    '# Parse CLI arguments for --port or -p (supports: --port=8080, --port 8080, -p 8080, -p=8080)',
    'ARGS=()',
    'while [ $# -gt 0 ]; do',
    '    case "$1" in',
    '        --port=*)',
    '            CHOSEN_PORT="${1#*=}"',
    '            shift',
    '            ;;',
    '        -p=*)',
    '            CHOSEN_PORT="${1#*=}"',
    '            shift',
    '            ;;',
    '        --port|-p)',
    '            if [ -n "$2" ]; then',
    '                CHOSEN_PORT="$2"',
    '                shift 2',
    '            else',
    '                shift',
    '            fi',
    '            ;;',
    '        *)',
    '            ARGS+=("$1")',
    '            shift',
    '            ;;',
    '    esac',
    'done',
    '',
    '# Priority: CLI argument > Environment variable > Saved config > Default 43210',
    'PORT="${CHOSEN_PORT:-${MINT_IPTV_PORT:-$DEFAULT_PORT}}"',
    '',
    '# Function to verify port availability or auto-increment to find next open port',
    'find_available_port() {',
    '    local p="$1"',
    '    for ((i=0; i<20; i++)); do',
    '        local check_p=$((p + i))',
    '        # 1. Check if our own Mint IPTV Player is already running on this port',
    '        if curl -s -m 1 "http://127.0.0.1:$check_p/api/health" >/dev/null 2>&1; then',
    '            echo "$check_p"',
    '            return 0',
    '        fi',
    '        # 2. Check if port is listening by another program',
    '        local in_use=0',
    '        if command -v lsof >/dev/null 2>&1; then',
    '            if lsof -Pi :$check_p -sTCP:LISTEN -t >/dev/null 2>&1; then',
    '                in_use=1',
    '            fi',
    '        elif command -v ss >/dev/null 2>&1; then',
    '            if ss -tln | grep -q ":$check_p "; then',
    '                in_use=1',
    '            fi',
    '        fi',
    '        ',
    '        if [ "$in_use" -eq 0 ]; then',
    '            echo "$check_p"',
    '            return 0',
    '        fi',
    '    done',
    '    echo "$p"',
    '}',
    '',
    'ACTIVE_PORT=$(find_available_port "$PORT")',
    'export MINT_IPTV_PORT="$ACTIVE_PORT"',
    'export PORT="$ACTIVE_PORT"',
    'TARGET_URL="http://localhost:$ACTIVE_PORT"',
    '',
    '# Function to verify if server is alive on target URL',
    'is_server_alive() {',
    '    if command -v curl >/dev/null 2>&1; then',
    '        curl -s -m 1 "$TARGET_URL/api/health" >/dev/null 2>&1',
    '        return $?',
    '    elif command -v python3 >/dev/null 2>&1; then',
    '        python3 -c "import urllib.request, sys; urllib.request.urlopen(\'$TARGET_URL/api/health\', timeout=1)" >/dev/null 2>&1',
    '        return $?',
    '    fi',
    '    return 1',
    '}',
    '',
    '# 1. Try Electron if available',
    'if command -v electron >/dev/null 2>&1; then',
    '    exec electron "$APP_DIR/electron-main.cjs" "${ARGS[@]}"',
    'fi',
    '',
    '# 2. Start the local server if not already alive',
    'if ! is_server_alive; then',
    '    # Priority 1: Built-in Python 3 server (standard on 100% of Linux Mint systems)',
    '    if command -v python3 >/dev/null 2>&1 && [ -f "$APP_DIR/server.py" ]; then',
    '        python3 "$APP_DIR/server.py" --port "$ACTIVE_PORT" >/dev/null 2>&1 &',
    '    # Priority 2: Node.js server if available',
    '    elif command -v node >/dev/null 2>&1 && [ -f "$APP_DIR/dist/server.cjs" ]; then',
    '        NODE_ENV=production MINT_IPTV_PORT="$ACTIVE_PORT" PORT="$ACTIVE_PORT" node "$APP_DIR/dist/server.cjs" >/dev/null 2>&1 &',
    '    fi',
    '    # Wait up to 5 seconds for server readiness',
    '    for retry in {1..25}; do',
    '        if is_server_alive; then',
    '            break',
    '        fi',
    '        sleep 0.2',
    '    done',
    'fi',
    '',
    '# 3. Launch in Dedicated App Window Mode (clean desktop window without browser toolbars)',
    'if command -v google-chrome >/dev/null 2>&1; then',
    '    exec google-chrome --app="$TARGET_URL" --class="mint-iptv-player" --name="mint-iptv-player" "${ARGS[@]}"',
    'elif command -v chromium-browser >/dev/null 2>&1; then',
    '    exec chromium-browser --app="$TARGET_URL" --class="mint-iptv-player" --name="mint-iptv-player" "${ARGS[@]}"',
    'elif command -v chromium >/dev/null 2>&1; then',
    '    exec chromium --app="$TARGET_URL" --class="mint-iptv-player" --name="mint-iptv-player" "${ARGS[@]}"',
    'elif command -v brave-browser >/dev/null 2>&1; then',
    '    exec brave-browser --app="$TARGET_URL" --class="mint-iptv-player" --name="mint-iptv-player" "${ARGS[@]}"',
    'elif command -v msedge >/dev/null 2>&1; then',
    '    exec msedge --app="$TARGET_URL" --class="mint-iptv-player" --name="mint-iptv-player" "${ARGS[@]}"',
    'elif command -v firefox >/dev/null 2>&1; then',
    '    exec firefox --new-window "$TARGET_URL" "${ARGS[@]}"',
    'elif command -v xdg-open >/dev/null 2>&1; then',
    '    exec xdg-open "$TARGET_URL"',
    'else',
    '    echo "Mint IPTV Player running on $TARGET_URL. Please open this address in your web browser."',
    'fi'
  ].join('\n') + '\n';
  fs.writeFileSync(path.join(binDir, 'mint-iptv-player'), launcherScript, 'utf-8');

  // 6. Postinst & Prerm scripts
  const postinstContent = `#!/bin/sh
set -e
if command -v update-desktop-database > /dev/null 2>&1; then
    update-desktop-database -q /usr/share/applications || true
fi
if command -v gtk-update-icon-cache > /dev/null 2>&1; then
    gtk-update-icon-cache -q -t -f /usr/share/icons/hicolor || true
fi
exit 0
`;
  fs.writeFileSync(path.join(debianDir, 'postinst'), postinstContent, 'utf-8');

  const prermContent = `#!/bin/sh
set -e
exit 0
`;
  fs.writeFileSync(path.join(debianDir, 'prerm'), prermContent, 'utf-8');

  // Compute Installed-Size in KiB
  let installedSizeKb = 1200;
  try {
    const duOut = execSync(`du -sk "${targetDir}/usr"`).toString();
    const size = parseInt(duOut.trim().split(/\s+/)[0], 10);
    if (!isNaN(size)) installedSizeKb = size;
  } catch {}

  // 7. DEBIAN/control
  // CRITICAL: We use standard universal dependencies (bash, xdg-utils, python3)
  // Avoid strict dependencies on libasound2 or libcups2 which do not exist on Linux Mint 22 (time64 transition).
  const controlContent = `Package: ${pkgName}
Version: ${version}
Section: video
Priority: optional
Architecture: ${arch}
Installed-Size: ${installedSizeKb}
Maintainer: Linux Mint IPTV Community <community@linuxmint.com>
Depends: bash, xdg-utils, python3
Recommends: firefox | chromium-browser | google-chrome-stable | electron
Homepage: https://github.com/linuxmint/mint-iptv-player
Description: Native Modern IPTV & EPG Player for Linux Mint
 A sleek, desktop-integrated IPTV player for Linux Mint supporting
 M3U/M3U8 playlists, Xtream Codes (XC) API, interactive TiviMate-style EPG grid,
 multi-category stream filtering, HLS adaptive bitrate, and hardware playback.
 Perfectly integrates into Cinnamon, MATE, and XFCE menus with 1-click double-click installation.
`;
  fs.writeFileSync(path.join(debianDir, 'control'), controlContent, 'utf-8');

  // 8. Generate DEBIAN/md5sums for package integrity validation
  try {
    execSync(`cd "${targetDir}" && find usr -type f -exec md5sum {} + > "${debianDir}/md5sums"`);
  } catch (e) {
    console.warn('Failed to generate md5sums:', e);
  }

  // 9. Standardize Permissions Across All Package Files
  // Essential for GDebi: directories 755, executables 755, other files 644
  try {
    execSync(`find "${targetDir}" -type d -exec chmod 755 {} +`);
    execSync(`find "${targetDir}" -type f -exec chmod 644 {} +`);
    execSync(`chmod 755 "${debianDir}/postinst" "${debianDir}/prerm" "${binDir}/mint-iptv-player" "${shareAppDir}/server.py"`);
  } catch (e) {
    console.warn('Failed to apply chmod:', e);
  }

  // 10. Run dpkg-deb to package
  try {
    console.log(`[DEB BUILDER] Running dpkg-deb --build --root-owner-group ${targetDir} ${outDebFile}`);
    execSync(`dpkg-deb --build --root-owner-group "${targetDir}" "${outDebFile}"`, { stdio: 'inherit' });
    console.log(`[DEB BUILDER] SUCCESS! Built package: ${outDebFile}`);
    const stats = fs.statSync(outDebFile);
    console.log(`[DEB BUILDER] Package size: ${(stats.size / 1024).toFixed(1)} KB`);
    return outDebFile;
  } catch (err) {
    console.error(`[DEB BUILDER] Error building deb:`, err);
    throw err;
  }
}

// If run directly
if (process.argv[1]?.endsWith('create-deb.ts')) {
  buildDebianPackage();
}
