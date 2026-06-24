import { AdvancedExtractor } from './extractor.js';
import { sources, sourceStats } from './sources.js';

async function test() {
  console.log('🧪 Stream_V0 Testing...
');
  
  const extractor = new AdvancedExtractor();
  
  try {
    console.log('1️⃣ Testing sources list...');
    console.log(`   Total Sources: ${sources.length}`);
    console.log(`   Tier 1: ${sourceStats.tier1}`);
    console.log(`   4K Sources: ${sourceStats.with4k}
`);
    
    console.log('✅ Test completed!
');
    
  } catch (error) {
    console.error('❌ Test failed:', error);
  } finally {
    await extractor.close();
  }
}

test();
