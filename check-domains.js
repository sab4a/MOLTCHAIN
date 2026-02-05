#!/usr/bin/env node

const dns = require('dns');
const { exec } = require('child_process');

const domains = [
  // Short & Clean
  'openclaw.com',
  'opencog.com',
  'openmind.com',
  'opennode.com',
  'openproof.com',
  'openpoc.com',
  'opendex.com',
  'openix.com',
  
  // AI/Agent
  'openagent.com',
  'openthinker.com',
  'openthink.com',
  'opensense.com',
  'openbrain.com',
  'openneural.com',
  
  // Blockchain
  'openledger.com',
  'openchain.com',
  'openvalidate.com',
  'openverify.com',
  'opentrust.com',
  'openprove.com',
  
  // Cognition
  'opencognition.com',
  'opencognito.com',
  'openaware.com',
  'opensentient.com',
  
  // Premium Invented
  'openara.com',
  'openvex.com',
  'openex.com',
  'openia.com',
  'openera.com',
  'openvera.com',
  'openvia.com',
  'openova.com',
  'opennova.com',
  'openaxis.com',
  'opennex.com',
  'openvix.com',
  
  // Your favorites
  'opendexterity.com',
  'openintelligence.com',
  'openverity.com',
  
  // Fun/Catchy
  'openfly.com',
  'openswarm.com',
  'openmesh.com',
  'opengrid.com',
  'opencore.com',
  'openbase.com',
  'openhive.com',
  'openpulse.com',
];

async function checkDomain(domain) {
  return new Promise((resolve) => {
    exec(`whois ${domain}`, (error, stdout, stderr) => {
      const output = stdout.toLowerCase();
      
      // Check for availability indicators
      const available = 
        output.includes('no match') ||
        output.includes('not found') ||
        output.includes('no data found') ||
        output.includes('domain not found') ||
        output.includes('no entries found') ||
        output.includes('status: free') ||
        output.includes('available');
      
      const taken = 
        output.includes('creation date') ||
        output.includes('registrar:') ||
        output.includes('name server') ||
        output.includes('domain name:');
      
      if (available && !taken) {
        resolve({ domain, status: '✅ AVAILABLE' });
      } else if (taken) {
        resolve({ domain, status: '❌ Taken' });
      } else {
        resolve({ domain, status: '❓ Unknown' });
      }
    });
  });
}

async function main() {
  console.log('\n🔍 Checking domain availability...\n');
  console.log('=' .repeat(50));
  
  const available = [];
  const taken = [];
  const unknown = [];
  
  for (const domain of domains) {
    const result = await checkDomain(domain);
    console.log(`${result.status}  ${result.domain}`);
    
    if (result.status.includes('AVAILABLE')) {
      available.push(domain);
    } else if (result.status.includes('Taken')) {
      taken.push(domain);
    } else {
      unknown.push(domain);
    }
    
    // Small delay to avoid rate limiting
    await new Promise(r => setTimeout(r, 500));
  }
  
  console.log('\n' + '='.repeat(50));
  console.log('\n📊 SUMMARY:\n');
  
  if (available.length > 0) {
    console.log('✅ AVAILABLE DOMAINS:');
    available.forEach(d => console.log(`   🟢 ${d}`));
  }
  
  if (unknown.length > 0) {
    console.log('\n❓ NEED MANUAL CHECK:');
    unknown.forEach(d => console.log(`   🟡 ${d}`));
  }
  
  console.log(`\n📈 Stats: ${available.length} available, ${taken.length} taken, ${unknown.length} unknown`);
  console.log('\n💡 Tip: Manually verify available domains at namecheap.com or godaddy.com\n');
}

main().catch(console.error);
