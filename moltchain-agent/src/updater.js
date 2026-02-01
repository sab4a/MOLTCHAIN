/**
 * Auto-updater for Moltchain Agent
 * 
 * Checks for new versions and updates automatically
 */

import { execSync, spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import https from 'https';

const GITHUB_API = 'https://api.github.com/repos/moltchain/moltchain-node/releases/latest';
const NPM_REGISTRY = 'https://registry.npmjs.org/moltchain-agent';

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
 * Auto-update daemon
 * Checks for updates periodically
 */
export class AutoUpdater {
  constructor(options = {}) {
    this.checkInterval = options.checkInterval || 6 * 60 * 60 * 1000; // 6 hours
    this.autoInstall = options.autoInstall || false;
    this.onUpdate = options.onUpdate || (() => {});
    this.timer = null;
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
    const result = await checkForUpdates({ 
      autoInstall: this.autoInstall, 
      silent: true 
    });
    
    if (result.updateAvailable) {
      console.log(`\n🆕 Update available: ${result.current} → ${result.latest}`);
      
      if (this.autoInstall && result.success) {
        console.log('✅ Update installed! Restart to apply.');
        this.onUpdate(result);
      } else if (!this.autoInstall) {
        console.log('💡 Run "moltchain-agent update" to install');
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
  AutoUpdater
};
