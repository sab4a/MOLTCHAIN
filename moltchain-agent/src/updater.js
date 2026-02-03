/**
 * Auto-updater for Moltchain Agent
 * 
 * Checks for new versions and updates automatically
 */

import { execSync, spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import https from 'https';

const GITHUB_API = 'https://api.github.com/repos/sab4a/MOLTCHAIN/releases/latest';
const NPM_REGISTRY = 'https://registry.npmjs.org/moltchain-agent';
const DEVNET_RPC = 'https://moltchain-rpc.fly.dev';

/**
 * Get current installed version
 */
export function getCurrentVersion() {
  try {
    const packagePath = new URL('../package.json', import.meta.url);
    const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
    return pkg.version;
  } catch {
    return '0.0.0';
  }
}

/**
 * Fetch latest version from npm
 */
export async function getLatestVersion() {
  return new Promise((resolve, reject) => {
    https.get(NPM_REGISTRY, { headers: { 'User-Agent': 'moltchain-agent' } }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const pkg = JSON.parse(data);
          resolve(pkg['dist-tags']?.latest || '0.0.0');
        } catch {
          resolve('0.0.0');
        }
      });
    }).on('error', () => resolve('0.0.0'));
  });
}

/**
 * Compare semver versions
 */
function isNewerVersion(current, latest) {
  const currentParts = current.split('.').map(Number);
  const latestParts = latest.split('.').map(Number);
  
  for (let i = 0; i < 3; i++) {
    if ((latestParts[i] || 0) > (currentParts[i] || 0)) return true;
    if ((latestParts[i] || 0) < (currentParts[i] || 0)) return false;
  }
  return false;
}

/**
 * Check for updates and optionally install
 */
export async function checkForUpdates(options = {}) {
  const { autoInstall = false, silent = false } = options;
  
  const current = getCurrentVersion();
  const latest = await getLatestVersion();
  
  if (!silent) {
    console.log(`📦 Current version: ${current}`);
    console.log(`📦 Latest version: ${latest}`);
  }
  
  if (isNewerVersion(current, latest)) {
    if (!silent) {
      console.log(`\n🆕 New version available: ${latest}`);
    }
    
    if (autoInstall) {
      return await installUpdate(latest, silent);
    }
    
    return { updateAvailable: true, current, latest };
  }
  
  if (!silent) {
    console.log('✅ You are running the latest version!');
  }
  
  return { updateAvailable: false, current, latest };
}

/**
 * Install the latest version
 */
export async function installUpdate(version, silent = false) {
  if (!silent) {
    console.log(`\n⬇️ Installing moltchain-agent@${version}...`);
  }
  
  try {
    // Try npm global update
    execSync('npm install -g moltchain-agent@latest', { 
      stdio: silent ? 'ignore' : 'inherit' 
    });
    
    if (!silent) {
      console.log('✅ Update installed successfully!');
      console.log('🔄 Please restart the agent to use the new version.');
    }
    
    return { success: true, version };
  } catch (error) {
    if (!silent) {
      console.error('❌ Failed to install update:', error.message);
      console.log('💡 Try manually: npm install -g moltchain-agent@latest');
    }
    return { success: false, error: error.message };
  }
}

/**
 * Get the devnet node version from RPC
 */
export async function getDevnetNodeVersion() {
  try {
    const response = await fetch(DEVNET_RPC, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'moltchain_status',
        params: [],
      }),
    });
    const json = await response.json();
    return json.result?.node_version || null;
  } catch {
    return null;
  }
}

/**
 * Check for Rust binary updates (for node)
 */
export async function checkBinaryUpdates() {
  return new Promise((resolve) => {
    https.get(GITHUB_API, { headers: { 'User-Agent': 'moltchain-agent' } }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const release = JSON.parse(data);
          resolve({
            version: release.tag_name,
            url: release.html_url,
            assets: release.assets?.map(a => ({
              name: a.name,
              url: a.browser_download_url,
              size: a.size
            })) || []
          });
        } catch {
          resolve(null);
        }
      });
    }).on('error', () => resolve(null));
  });
}

/**
 * Get platform-specific binary name
 */
function getBinaryName() {
  const platform = process.platform;
  const arch = process.arch;
  
  if (platform === 'darwin') {
    return arch === 'arm64' ? 'moltchain-darwin-arm64' : 'moltchain-darwin-x64';
  } else if (platform === 'linux') {
    return arch === 'arm64' ? 'moltchain-linux-arm64' : 'moltchain-linux-x64';
  } else if (platform === 'win32') {
    return 'moltchain-windows-x64.exe';
  }
  return null;
}

/**
 * Get current binary version
 */
export async function getCurrentBinaryVersion() {
  const binaryPath = path.join(process.env.HOME || '', '.moltchain', 'bin', 'moltchain');
  
  if (!fs.existsSync(binaryPath)) {
    return null;
  }
  
  try {
    const result = execSync(`"${binaryPath}" --version`, { encoding: 'utf8' });
    const match = result.match(/(\d+\.\d+\.\d+)/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

/**
 * Download and install the latest Rust binary
 */
export async function installBinaryUpdate(release, silent = false) {
  const binaryName = getBinaryName();
  if (!binaryName) {
    if (!silent) console.error('❌ Unsupported platform');
    return { success: false, error: 'Unsupported platform' };
  }
  
  const asset = release.assets.find(a => a.name === binaryName || a.name.includes(binaryName));
  if (!asset) {
    if (!silent) console.error('❌ No binary found for this platform');
    return { success: false, error: 'No binary for platform' };
  }
  
  const binDir = path.join(process.env.HOME || '', '.moltchain', 'bin');
  const binaryPath = path.join(binDir, 'moltchain');
  const tempPath = path.join(binDir, 'moltchain.new');
  
  // Ensure directory exists
  if (!fs.existsSync(binDir)) {
    fs.mkdirSync(binDir, { recursive: true });
  }
  
  if (!silent) {
    console.log(`⬇️ Downloading ${asset.name} (${(asset.size / 1024 / 1024).toFixed(1)} MB)...`);
  }
  
  return new Promise((resolve) => {
    const downloadUrl = asset.url;
    
    // Follow redirects for GitHub downloads
    const download = (url) => {
      https.get(url, { 
        headers: { 
          'User-Agent': 'moltchain-agent',
          'Accept': 'application/octet-stream'
        } 
      }, (res) => {
        // Handle redirect
        if (res.statusCode === 302 || res.statusCode === 301) {
          download(res.headers.location);
          return;
        }
        
        if (res.statusCode !== 200) {
          resolve({ success: false, error: `HTTP ${res.statusCode}` });
          return;
        }
        
        const file = fs.createWriteStream(tempPath);
        res.pipe(file);
        
        file.on('finish', () => {
          file.close();
          
          try {
            // Backup old binary
            if (fs.existsSync(binaryPath)) {
              fs.renameSync(binaryPath, `${binaryPath}.backup`);
            }
            
            // Move new binary
            fs.renameSync(tempPath, binaryPath);
            
            // Make executable
            fs.chmodSync(binaryPath, '755');
            
            if (!silent) {
              console.log(`✅ Binary updated to ${release.version}`);
              console.log(`📍 Installed to: ${binaryPath}`);
            }
            
            resolve({ success: true, version: release.version, path: binaryPath });
          } catch (err) {
            resolve({ success: false, error: err.message });
          }
        });
      }).on('error', (err) => {
        resolve({ success: false, error: err.message });
      });
    };
    
    download(downloadUrl);
  });
}

/**
 * Full update check - both npm package and Rust binary
 */
export async function checkAllUpdates(options = {}) {
  const { autoInstall = false, silent = false } = options;
  const results = { agent: null, binary: null };
  
  // Check npm package
  if (!silent) console.log('🔍 Checking for agent updates...');
  results.agent = await checkForUpdates({ autoInstall, silent });
  
  // Check Rust binary
  if (!silent) console.log('🔍 Checking for binary updates...');
  const release = await checkBinaryUpdates();
  
  if (release && release.version) {
    const currentBinary = await getCurrentBinaryVersion();
    const latestBinary = release.version.replace(/^v/, '');
    
    if (!silent) {
      console.log(`📦 Current binary: ${currentBinary || 'not installed'}`);
      console.log(`📦 Latest binary: ${latestBinary}`);
    }
    
    if (!currentBinary || isNewerVersion(currentBinary, latestBinary)) {
      if (!silent) console.log(`\n🆕 New binary available: ${release.version}`);
      
      if (autoInstall) {
        results.binary = await installBinaryUpdate(release, silent);
      } else {
        results.binary = { updateAvailable: true, current: currentBinary, latest: latestBinary };
      }
    } else {
      if (!silent) console.log('✅ Binary is up to date!');
      results.binary = { updateAvailable: false, current: currentBinary, latest: latestBinary };
    }
  }
  
  return results;
}

/**
 * Auto-update daemon
 * Checks for updates periodically (both npm and binary)
 */
export class AutoUpdater {
  constructor(options = {}) {
this.checkInterval = options.checkInterval || 2 * 60 * 1000; // 2 minutes
    this.autoInstall = options.autoInstall || false;
    this.onUpdate = options.onUpdate || (() => {});
    this.timer = null;
    this.restartOnBinaryUpdate = options.restartOnBinaryUpdate || false;
    this.lastKnownNodeVersion = null; // Track devnet node version
  }
  
  start() {
    console.log('🔄 Auto-updater started');
    console.log(`   Check interval: ${this.checkInterval / 1000 / 60} minutes`);
    console.log(`   Auto-install: ${this.autoInstall ? 'Yes' : 'No'}`);
    
    // Check immediately
    this.check();
    
    // Then periodically
    this.timer = setInterval(() => this.check(), this.checkInterval);
  }
  
  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    console.log('🔄 Auto-updater stopped');
  }
  
  async check() {
    // Check both agent and binary updates
    const results = await checkAllUpdates({ 
      autoInstall: this.autoInstall, 
      silent: true 
    });
    
    let needsRestart = false;
    
    // Check devnet node version (detect when Fly.io is updated)
    const devnetVersion = await getDevnetNodeVersion();
    if (devnetVersion && this.lastKnownNodeVersion && devnetVersion !== this.lastKnownNodeVersion) {
      console.log(`\n🆕 Devnet node updated: ${this.lastKnownNodeVersion} → ${devnetVersion}`);
      console.log('🔄 Resyncing with new network version...');
      this.onUpdate({ nodeVersionChanged: true, from: this.lastKnownNodeVersion, to: devnetVersion });
    }
    this.lastKnownNodeVersion = devnetVersion;
    
    // Agent update
    if (results.agent?.updateAvailable) {
      console.log(`\n🆕 Agent update available: ${results.agent.current} → ${results.agent.latest}`);
      
      if (this.autoInstall && results.agent.success) {
        console.log('✅ Agent update installed!');
        needsRestart = true;
      } else if (!this.autoInstall) {
        console.log('💡 Run "moltchain-agent update" to install');
      }
    }
    
    // Binary update
    if (results.binary?.updateAvailable) {
      console.log(`\n🆕 Binary update available: ${results.binary.current || 'none'} → ${results.binary.latest}`);
      
      if (this.autoInstall && results.binary.success) {
        console.log('✅ Binary update installed!');
        needsRestart = true;
      } else if (!this.autoInstall) {
        console.log('💡 Run "moltchain-agent update" to install');
      }
    }
    
    if (needsRestart) {
      console.log('\n⚠️ Updates installed! Restart to apply changes.');
      this.onUpdate(results);
      
      // Auto-restart if configured
      if (this.restartOnBinaryUpdate) {
        console.log('🔄 Auto-restarting in 5 seconds...');
        setTimeout(() => {
          process.exit(0); // Let process manager restart
        }, 5000);
      }
    }
  }
}

export default {
  getCurrentVersion,
  getLatestVersion,
  checkForUpdates,
  installUpdate,
  checkBinaryUpdates,
  getCurrentBinaryVersion,
  installBinaryUpdate,
  checkAllUpdates,
  getDevnetNodeVersion,
  AutoUpdater
};
