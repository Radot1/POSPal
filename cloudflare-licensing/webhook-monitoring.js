/**
 * Webhook Events Monitoring and Analysis Script
 *
 * This script helps monitor and analyze webhook events stored in the webhook_events table
 * to ensure Phase 3 idempotency protection is working correctly.
 */

// Database queries for monitoring webhook events
const QUERIES = {
  // Get recent webhook events
  recentEvents: `
    SELECT
      stripe_event_id,
      event_type,
      processing_status,
      customer_id,
      retry_count,
      created_at,
      processed_at,
      error_message
    FROM webhook_events
    ORDER BY created_at DESC
    LIMIT ?
  `,

  // Get events by processing status
  eventsByStatus: `
    SELECT
      processing_status,
      COUNT(*) as count,
      MIN(created_at) as first_event,
      MAX(created_at) as last_event
    FROM webhook_events
    GROUP BY processing_status
  `,

  // Get failed events with error details
  failedEvents: `
    SELECT
      stripe_event_id,
      event_type,
      error_message,
      retry_count,
      created_at,
      processed_at
    FROM webhook_events
    WHERE processing_status = 'failed'
    ORDER BY created_at DESC
  `,

  // Get events with high retry counts
  highRetryEvents: `
    SELECT
      stripe_event_id,
      event_type,
      retry_count,
      processing_status,
      error_message,
      created_at
    FROM webhook_events
    WHERE retry_count > 1
    ORDER BY retry_count DESC, created_at DESC
  `,

  // Get processing time statistics
  processingStats: `
    SELECT
      event_type,
      COUNT(*) as total_events,
      AVG(
        CASE
          WHEN processed_at IS NOT NULL AND created_at IS NOT NULL
          THEN (julianday(processed_at) - julianday(created_at)) * 24 * 60 * 60 * 1000
        END
      ) as avg_processing_time_ms,
      COUNT(CASE WHEN processing_status = 'completed' THEN 1 END) as completed,
      COUNT(CASE WHEN processing_status = 'failed' THEN 1 END) as failed,
      COUNT(CASE WHEN processing_status = 'processing' THEN 1 END) as stuck_processing
    FROM webhook_events
    GROUP BY event_type
    ORDER BY total_events DESC
  `,

  // Get events currently stuck in processing
  stuckEvents: `
    SELECT
      stripe_event_id,
      event_type,
      created_at,
      retry_count,
      (julianday('now') - julianday(created_at)) * 24 * 60 as minutes_stuck
    FROM webhook_events
    WHERE processing_status = 'processing'
    AND datetime(created_at, '+5 minutes') < datetime('now')
    ORDER BY created_at
  `,

  // Get duplicate events (same stripe_event_id)
  duplicateCheck: `
    SELECT
      stripe_event_id,
      COUNT(*) as occurrence_count,
      GROUP_CONCAT(processing_status) as statuses,
      MIN(created_at) as first_occurrence,
      MAX(created_at) as last_occurrence
    FROM webhook_events
    GROUP BY stripe_event_id
    HAVING COUNT(*) > 1
    ORDER BY occurrence_count DESC
  `,

  // Get events by customer
  eventsByCustomer: `
    SELECT
      customer_id,
      COUNT(*) as event_count,
      GROUP_CONCAT(DISTINCT event_type) as event_types,
      MIN(created_at) as first_event,
      MAX(created_at) as last_event
    FROM webhook_events
    WHERE customer_id IS NOT NULL
    GROUP BY customer_id
    ORDER BY event_count DESC
    LIMIT ?
  `
};

class WebhookMonitor {
  constructor(environment = 'development') {
    this.environment = environment;
    this.dbName = environment === 'production' ? 'pospal-subscriptions' : 'pospal-subscriptions-dev';
    this.remoteFlag = environment === 'production' ? '--remote' : '';
  }

  async executeQuery(query, params = []) {
    const { execSync } = require('child_process');
    const paramsStr = params.length > 0 ? params.map(p => `'${p}'`).join(',') : '';
    const queryWithParams = params.length > 0 ? query.replace(/\?/g, () => params.shift()) : query;

    const command = `wrangler d1 execute ${this.dbName} ${this.remoteFlag} --command "${queryWithParams}"`;

    try {
      const result = execSync(command, {
        cwd: process.cwd(),
        encoding: 'utf8',
        stdio: 'pipe'
      });

      const jsonMatch = result.match(/\[\s*\{[\s\S]*\}\s*\]/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return parsed[0]?.results || [];
      }
      return [];
    } catch (error) {
      console.error('Query failed:', error.message);
      return [];
    }
  }

  async displayRecentEvents(limit = 20) {
    console.log(`\n📊 Recent Webhook Events (Last ${limit})`);
    console.log('=' .repeat(80));

    const events = await this.executeQuery(QUERIES.recentEvents, [limit]);

    if (events.length === 0) {
      console.log('No webhook events found.');
      return;
    }

    console.log('Event ID'.padEnd(25) +
                'Type'.padEnd(20) +
                'Status'.padEnd(12) +
                'Retries'.padEnd(8) +
                'Created');
    console.log('-'.repeat(80));

    events.forEach(event => {
      const eventId = (event.stripe_event_id || '').substring(0, 24);
      const eventType = (event.event_type || '').substring(0, 19);
      const status = event.processing_status || 'unknown';
      const retries = event.retry_count || 0;
      const created = new Date(event.created_at).toLocaleString();

      console.log(eventId.padEnd(25) +
                  eventType.padEnd(20) +
                  status.padEnd(12) +
                  retries.toString().padEnd(8) +
                  created);

      if (event.error_message) {
        console.log('  ❌ Error: ' + event.error_message);
      }
    });
  }

  async displayStatusSummary() {
    console.log('\n📈 Webhook Processing Status Summary');
    console.log('=' .repeat(50));

    const statusCounts = await this.executeQuery(QUERIES.eventsByStatus);

    if (statusCounts.length === 0) {
      console.log('No webhook events found.');
      return;
    }

    statusCounts.forEach(status => {
      const emoji = {
        'completed': '✅',
        'failed': '❌',
        'processing': '⏳'
      }[status.processing_status] || '❓';

      console.log(`${emoji} ${status.processing_status.toUpperCase()}: ${status.count} events`);
      if (status.first_event && status.last_event) {
        console.log(`   First: ${new Date(status.first_event).toLocaleString()}`);
        console.log(`   Last:  ${new Date(status.last_event).toLocaleString()}`);
      }
    });
  }

  async displayFailedEvents() {
    console.log('\n❌ Failed Webhook Events');
    console.log('=' .repeat(60));

    const failedEvents = await this.executeQuery(QUERIES.failedEvents);

    if (failedEvents.length === 0) {
      console.log('✅ No failed events found.');
      return;
    }

    failedEvents.forEach(event => {
      console.log(`\n🚨 ${event.stripe_event_id}`);
      console.log(`   Type: ${event.event_type}`);
      console.log(`   Retries: ${event.retry_count}`);
      console.log(`   Created: ${new Date(event.created_at).toLocaleString()}`);
      console.log(`   Error: ${event.error_message}`);
    });
  }

  async displayStuckEvents() {
    console.log('\n⏳ Events Stuck in Processing');
    console.log('=' .repeat(50));

    const stuckEvents = await this.executeQuery(QUERIES.stuckEvents);

    if (stuckEvents.length === 0) {
      console.log('✅ No stuck events found.');
      return;
    }

    stuckEvents.forEach(event => {
      console.log(`\n🔄 ${event.stripe_event_id}`);
      console.log(`   Type: ${event.event_type}`);
      console.log(`   Stuck for: ${Math.round(event.minutes_stuck)} minutes`);
      console.log(`   Retries: ${event.retry_count}`);
      console.log(`   Created: ${new Date(event.created_at).toLocaleString()}`);
    });

    if (stuckEvents.length > 0) {
      console.log('\n💡 Consider manually updating these events to "failed" status');
    }
  }

  async displayProcessingStats() {
    console.log('\n⚡ Processing Performance Statistics');
    console.log('=' .repeat(70));

    const stats = await this.executeQuery(QUERIES.processingStats);

    if (stats.length === 0) {
      console.log('No processing statistics available.');
      return;
    }

    console.log('Event Type'.padEnd(25) +
                'Total'.padEnd(8) +
                'Completed'.padEnd(10) +
                'Failed'.padEnd(8) +
                'Stuck'.padEnd(8) +
                'Avg Time');
    console.log('-'.repeat(70));

    stats.forEach(stat => {
      const eventType = (stat.event_type || '').substring(0, 24);
      const avgTime = stat.avg_processing_time_ms
        ? `${Math.round(stat.avg_processing_time_ms)}ms`
        : 'N/A';

      console.log(eventType.padEnd(25) +
                  stat.total_events.toString().padEnd(8) +
                  stat.completed.toString().padEnd(10) +
                  stat.failed.toString().padEnd(8) +
                  stat.stuck_processing.toString().padEnd(8) +
                  avgTime);
    });
  }

  async displayDuplicateCheck() {
    console.log('\n🔍 Duplicate Event Detection');
    console.log('=' .repeat(50));

    const duplicates = await this.executeQuery(QUERIES.duplicateCheck);

    if (duplicates.length === 0) {
      console.log('✅ No duplicate events found (good!)');
      return;
    }

    console.log('⚠️  Found potential duplicate events:');
    duplicates.forEach(dup => {
      console.log(`\n📋 ${dup.stripe_event_id}`);
      console.log(`   Occurrences: ${dup.occurrence_count}`);
      console.log(`   Statuses: ${dup.statuses}`);
      console.log(`   First: ${new Date(dup.first_occurrence).toLocaleString()}`);
      console.log(`   Last:  ${new Date(dup.last_occurrence).toLocaleString()}`);
    });
  }

  async displayTopCustomers(limit = 10) {
    console.log(`\n👥 Top ${limit} Customers by Webhook Activity`);
    console.log('=' .repeat(60));

    const customers = await this.executeQuery(QUERIES.eventsByCustomer, [limit]);

    if (customers.length === 0) {
      console.log('No customer webhook events found.');
      return;
    }

    customers.forEach(customer => {
      console.log(`\n🧑‍💼 Customer ID: ${customer.customer_id}`);
      console.log(`   Events: ${customer.event_count}`);
      console.log(`   Types: ${customer.event_types}`);
      console.log(`   First: ${new Date(customer.first_event).toLocaleString()}`);
      console.log(`   Last:  ${new Date(customer.last_event).toLocaleString()}`);
    });
  }

  async generateFullReport() {
    console.log('🔍 Webhook Events Monitoring Report');
    console.log(`Environment: ${this.environment.toUpperCase()}`);
    console.log(`Database: ${this.dbName}`);
    console.log('Generated:', new Date().toLocaleString());
    console.log('=' .repeat(80));

    await this.displayStatusSummary();
    await this.displayProcessingStats();
    await this.displayRecentEvents(10);
    await this.displayStuckEvents();
    await this.displayFailedEvents();
    await this.displayDuplicateCheck();
    await this.displayTopCustomers(5);

    console.log('\n🎯 Summary & Recommendations:');
    console.log('- Monitor for events stuck in "processing" status');
    console.log('- Investigate failed events for recurring issues');
    console.log('- Ensure no duplicate events are being processed');
    console.log('- Check processing times are reasonable (<1s average)');
  }
}

// CLI interface
if (require.main === module) {
  const args = process.argv.slice(2);
  const environment = args.includes('--prod') ? 'production' : 'development';
  const command = args.find(arg => !arg.startsWith('--'));

  const monitor = new WebhookMonitor(environment);

  console.log(`\n🖥️  Webhook Monitoring - ${environment.toUpperCase()}`);

  switch (command) {
    case 'recent':
      monitor.displayRecentEvents(20);
      break;
    case 'status':
      monitor.displayStatusSummary();
      break;
    case 'failed':
      monitor.displayFailedEvents();
      break;
    case 'stuck':
      monitor.displayStuckEvents();
      break;
    case 'stats':
      monitor.displayProcessingStats();
      break;
    case 'duplicates':
      monitor.displayDuplicateCheck();
      break;
    case 'customers':
      monitor.displayTopCustomers(10);
      break;
    default:
      monitor.generateFullReport();
  }
}

module.exports = WebhookMonitor;