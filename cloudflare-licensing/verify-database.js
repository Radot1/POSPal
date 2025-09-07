/**
 * Database Verification Script for POSPal
 * Verifies all tables, indexes, and constraints exist
 * Can be run in development or production
 */

const REQUIRED_TABLES = [
  'customers',
  'audit_log', 
  'email_log',
  'active_sessions',
  'refund_requests',
  'schema_version'
];

const REQUIRED_INDEXES = [
  // Customer indexes
  'idx_customers_email',
  'idx_customers_token', 
  'idx_customers_session',
  'idx_customers_machine',
  'idx_customers_status',
  'idx_customers_created_at',
  'idx_customers_last_seen',
  'idx_customers_status_created',
  'idx_customers_last_validation',
  
  // Audit log indexes
  'idx_audit_customer',
  'idx_audit_action', 
  'idx_audit_created',
  'idx_audit_customer_action',
  'idx_audit_recent',
  
  // Email log indexes
  'idx_email_customer',
  'idx_email_status',
  'idx_email_type',
  'idx_email_created_at',
  
  // Session indexes
  'idx_active_sessions_customer_status',
  'idx_active_sessions_session_id',
  'idx_active_sessions_heartbeat',
  'idx_active_sessions_machine',
  'idx_sessions_cleanup',
  
  // Refund indexes
  'idx_refund_requests_customer_id',
  'idx_refund_requests_status',
  'idx_refund_requests_created_at'
];

const REQUIRED_VIEWS = [
  'active_customers_summary',
  'session_activity_summary'
];

async function verifyDatabase(env) {
  console.log('🔍 Starting database verification...\n');
  
  const results = {
    tables: { missing: [], present: [] },
    indexes: { missing: [], present: [] },
    views: { missing: [], present: [] },
    issues: [],
    performance: {}
  };
  
  try {
    // 1. Verify all tables exist
    console.log('📋 Checking tables...');
    const tablesQuery = await env.DB.prepare(`
      SELECT name FROM sqlite_master 
      WHERE type='table' AND name NOT LIKE 'sqlite_%'
    `).all();
    
    const existingTables = tablesQuery.results.map(row => row.name);
    
    for (const table of REQUIRED_TABLES) {
      if (existingTables.includes(table)) {
        results.tables.present.push(table);
        console.log(`  ✅ ${table}`);
      } else {
        results.tables.missing.push(table);
        console.log(`  ❌ ${table} - MISSING`);
      }
    }
    
    // 2. Verify all indexes exist
    console.log('\n📊 Checking indexes...');
    const indexesQuery = await env.DB.prepare(`
      SELECT name FROM sqlite_master 
      WHERE type='index' AND name NOT LIKE 'sqlite_%'
    `).all();
    
    const existingIndexes = indexesQuery.results.map(row => row.name);
    
    for (const index of REQUIRED_INDEXES) {
      if (existingIndexes.includes(index)) {
        results.indexes.present.push(index);
        console.log(`  ✅ ${index}`);
      } else {
        results.indexes.missing.push(index);
        console.log(`  ❌ ${index} - MISSING`);
      }
    }
    
    // 3. Verify views exist
    console.log('\n👁️ Checking views...');
    const viewsQuery = await env.DB.prepare(`
      SELECT name FROM sqlite_master 
      WHERE type='view'
    `).all();
    
    const existingViews = viewsQuery.results.map(row => row.name);
    
    for (const view of REQUIRED_VIEWS) {
      if (existingViews.includes(view)) {
        results.views.present.push(view);
        console.log(`  ✅ ${view}`);
      } else {
        results.views.missing.push(view);
        console.log(`  ❌ ${view} - MISSING`);
      }
    }
    
    // 4. Check data integrity
    console.log('\n🔐 Checking data integrity...');
    
    if (results.tables.present.includes('customers')) {
      // Check for duplicate emails
      const duplicateEmails = await env.DB.prepare(`
        SELECT email, COUNT(*) as count 
        FROM customers 
        GROUP BY email 
        HAVING COUNT(*) > 1
      `).all();
      
      if (duplicateEmails.results.length > 0) {
        results.issues.push(`Found ${duplicateEmails.results.length} duplicate emails`);
        console.log(`  ⚠️ Found ${duplicateEmails.results.length} duplicate emails`);
      } else {
        console.log(`  ✅ No duplicate emails`);
      }
      
      // Check for customers without tokens
      const missingTokens = await env.DB.prepare(`
        SELECT COUNT(*) as count 
        FROM customers 
        WHERE unlock_token IS NULL OR unlock_token = ''
      `).first();
      
      if (missingTokens.count > 0) {
        results.issues.push(`Found ${missingTokens.count} customers without tokens`);
        console.log(`  ⚠️ Found ${missingTokens.count} customers without tokens`);
      } else {
        console.log(`  ✅ All customers have tokens`);
      }
    }
    
    // 5. Performance analysis
    console.log('\n⚡ Performance analysis...');
    
    if (results.tables.present.includes('customers')) {
      const customerCount = await env.DB.prepare(`SELECT COUNT(*) as count FROM customers`).first();
      results.performance.total_customers = customerCount.count;
      console.log(`  📊 Total customers: ${customerCount.count}`);
      
      const activeCustomers = await env.DB.prepare(`
        SELECT COUNT(*) as count 
        FROM customers 
        WHERE subscription_status = 'active'
      `).first();
      results.performance.active_customers = activeCustomers.count;
      console.log(`  📊 Active customers: ${activeCustomers.count}`);
    }
    
    if (results.tables.present.includes('audit_log')) {
      const auditCount = await env.DB.prepare(`SELECT COUNT(*) as count FROM audit_log`).first();
      results.performance.total_audit_events = auditCount.count;
      console.log(`  📊 Total audit events: ${auditCount.count}`);
    }
    
    if (results.tables.present.includes('active_sessions')) {
      const activeSessions = await env.DB.prepare(`
        SELECT COUNT(*) as count 
        FROM active_sessions 
        WHERE status = 'active'
      `).first();
      results.performance.active_sessions = activeSessions.count;
      console.log(`  📊 Active sessions: ${activeSessions.count}`);
    }
    
    // 6. Generate summary
    console.log('\n📝 VERIFICATION SUMMARY');
    console.log('========================');
    
    const totalIssues = results.tables.missing.length + 
                       results.indexes.missing.length + 
                       results.views.missing.length + 
                       results.issues.length;
    
    if (totalIssues === 0) {
      console.log('🎉 DATABASE IS PRODUCTION READY!');
      console.log(`✅ ${results.tables.present.length}/${REQUIRED_TABLES.length} tables present`);
      console.log(`✅ ${results.indexes.present.length}/${REQUIRED_INDEXES.length} indexes present`);
      console.log(`✅ ${results.views.present.length}/${REQUIRED_VIEWS.length} views present`);
      console.log('✅ No data integrity issues found');
    } else {
      console.log(`❌ FOUND ${totalIssues} ISSUES - Database needs attention:`);
      
      if (results.tables.missing.length > 0) {
        console.log(`   Missing tables: ${results.tables.missing.join(', ')}`);
      }
      if (results.indexes.missing.length > 0) {
        console.log(`   Missing indexes: ${results.indexes.missing.join(', ')}`);
      }
      if (results.views.missing.length > 0) {
        console.log(`   Missing views: ${results.views.missing.join(', ')}`);
      }
      if (results.issues.length > 0) {
        console.log(`   Data issues: ${results.issues.join(', ')}`);
      }
    }
    
    return results;
    
  } catch (error) {
    console.error('❌ Database verification failed:', error);
    throw error;
  }
}

// For testing in Cloudflare Workers environment
export default {
  async fetch(request, env, ctx) {
    if (request.method !== 'GET') {
      return new Response('Method not allowed', { status: 405 });
    }
    
    try {
      const results = await verifyDatabase(env);
      
      return new Response(JSON.stringify({
        success: true,
        timestamp: new Date().toISOString(),
        results
      }, null, 2), {
        headers: { 'Content-Type': 'application/json' }
      });
      
    } catch (error) {
      return new Response(JSON.stringify({
        success: false,
        error: error.message,
        timestamp: new Date().toISOString()
      }, null, 2), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  }
};

export { verifyDatabase };