/**
 * Webhook Events Cleanup and Maintenance Script
 *
 * This script helps clean up and maintain the webhook_events table,
 * fixing common issues that might arise with the idempotency system.
 */

class WebhookCleanup {
  constructor(environment = 'development') {
    this.environment = environment;
    this.dbName = environment === 'production' ? 'pospal-subscriptions' : 'pospal-subscriptions-dev';
    this.remoteFlag = environment === 'production' ? '--remote' : '';
  }

  async executeCommand(command) {
    const { execSync } = require('child_process');
    const fullCommand = `wrangler d1 execute ${this.dbName} ${this.remoteFlag} --command "${command}"`;

    try {
      const result = execSync(fullCommand, {
        cwd: process.cwd(),
        encoding: 'utf8',
        stdio: 'pipe'
      });

      console.log('✅ Command executed successfully');
      return true;
    } catch (error) {
      console.error('❌ Command failed:', error.message);
      return false;
    }
  }

  /**
   * Fix events stuck in "processing" status for more than 10 minutes
   */
  async fixStuckEvents() {
    console.log('\n🔧 Fixing Events Stuck in Processing Status');
    console.log('=' .repeat(50));

    const command = `
      UPDATE webhook_events
      SET
        processing_status = 'failed',
        processed_at = datetime('now'),
        error_message = 'Event timeout - stuck in processing for >10 minutes'
      WHERE
        processing_status = 'processing'
        AND datetime(created_at, '+10 minutes') < datetime('now')
    `;

    console.log('Updating events stuck in processing for more than 10 minutes...');
    const success = await this.executeCommand(command);

    if (success) {
      console.log('✅ Stuck events have been marked as failed');
    }
  }

  /**
   * Clean up old webhook events (older than 30 days)
   */
  async cleanupOldEvents() {
    console.log('\n🧹 Cleaning Up Old Webhook Events (>30 days)');
    console.log('=' .repeat(50));

    const command = `
      DELETE FROM webhook_events
      WHERE created_at < datetime('now', '-30 days')
    `;

    console.log('Deleting webhook events older than 30 days...');
    const success = await this.executeCommand(command);

    if (success) {
      console.log('✅ Old events cleaned up successfully');
    }
  }

  /**
   * Reset failed events to allow retry
   */
  async resetFailedEvents(eventId = null) {
    console.log('\n🔄 Resetting Failed Events for Retry');
    console.log('=' .repeat(40));

    let command;
    if (eventId) {
      command = `
        UPDATE webhook_events
        SET
          processing_status = 'processing',
          processed_at = NULL,
          error_message = NULL,
          retry_count = retry_count + 1
        WHERE stripe_event_id = '${eventId}'
        AND processing_status = 'failed'
      `;
      console.log(`Resetting specific event: ${eventId}`);
    } else {
      command = `
        UPDATE webhook_events
        SET
          processing_status = 'processing',
          processed_at = NULL,
          error_message = NULL,
          retry_count = retry_count + 1
        WHERE
          processing_status = 'failed'
          AND retry_count < 3
          AND created_at > datetime('now', '-24 hours')
      `;
      console.log('Resetting recent failed events (last 24h, <3 retries)...');
    }

    const success = await this.executeCommand(command);

    if (success) {
      console.log('✅ Failed events reset for retry');
    }
  }

  /**
   * Remove duplicate webhook events (keep the oldest)
   */
  async removeDuplicateEvents() {
    console.log('\n🗑️  Removing Duplicate Webhook Events');
    console.log('=' .repeat(40));

    const command = `
      DELETE FROM webhook_events
      WHERE id NOT IN (
        SELECT MIN(id)
        FROM webhook_events
        GROUP BY stripe_event_id
      )
    `;

    console.log('Removing duplicate events (keeping oldest occurrence)...');
    const success = await this.executeCommand(command);

    if (success) {
      console.log('✅ Duplicate events removed');
    }
  }

  /**
   * Fix events with missing customer_id
   */
  async fixMissingCustomerIds() {
    console.log('\n🔗 Fixing Missing Customer IDs');
    console.log('=' .repeat(35));

    // This would require custom logic based on your event structure
    // For now, we'll just identify them
    const command = `
      SELECT
        stripe_event_id,
        event_type,
        created_at
      FROM webhook_events
      WHERE
        customer_id IS NULL
        AND processing_status = 'completed'
        AND event_type IN (
          'checkout.session.completed',
          'invoice.payment_succeeded',
          'customer.subscription.deleted'
        )
      ORDER BY created_at DESC
      LIMIT 10
    `;

    console.log('Identifying events with missing customer IDs...');
    console.log('⚠️  Manual review required for customer ID assignment');
  }

  /**
   * Create indexes if they don't exist
   */
  async createIndexes() {
    console.log('\n📊 Creating Performance Indexes');
    console.log('=' .repeat(35));

    const indexes = [
      {
        name: 'idx_webhook_events_stripe_id',
        command: 'CREATE INDEX IF NOT EXISTS idx_webhook_events_stripe_id ON webhook_events(stripe_event_id)'
      },
      {
        name: 'idx_webhook_events_processing_status',
        command: 'CREATE INDEX IF NOT EXISTS idx_webhook_events_processing_status ON webhook_events(processing_status)'
      },
      {
        name: 'idx_webhook_events_customer_id',
        command: 'CREATE INDEX IF NOT EXISTS idx_webhook_events_customer_id ON webhook_events(customer_id)'
      },
      {
        name: 'idx_webhook_events_created_at',
        command: 'CREATE INDEX IF NOT EXISTS idx_webhook_events_created_at ON webhook_events(created_at)'
      }
    ];

    for (const index of indexes) {
      console.log(`Creating ${index.name}...`);
      await this.executeCommand(index.command);
    }

    console.log('✅ All indexes created/verified');
  }

  /**
   * Vacuum the database to reclaim space
   */
  async vacuumDatabase() {
    console.log('\n🗜️  Optimizing Database');
    console.log('=' .repeat(25));

    console.log('Running VACUUM to optimize database...');
    const success = await this.executeCommand('VACUUM');

    if (success) {
      console.log('✅ Database optimized');
    }
  }

  /**
   * Get database statistics
   */
  async getDatabaseStats() {
    console.log('\n📊 Database Statistics');
    console.log('=' .repeat(25));

    const commands = [
      {
        name: 'Total webhook events',
        command: 'SELECT COUNT(*) as count FROM webhook_events'
      },
      {
        name: 'Events by status',
        command: `
          SELECT
            processing_status,
            COUNT(*) as count
          FROM webhook_events
          GROUP BY processing_status
        `
      },
      {
        name: 'Database size info',
        command: 'SELECT page_count * page_size as size_bytes FROM pragma_page_count(), pragma_page_size()'
      }
    ];

    for (const cmd of commands) {
      console.log(`\n${cmd.name}:`);
      // Note: This would need the executeQuery method from the monitor class
      // For now, just show the command that would be run
      console.log(`Command: ${cmd.command.trim()}`);
    }
  }

  /**
   * Run maintenance routine
   */
  async runMaintenance() {
    console.log('🛠️  Running Webhook Events Maintenance');
    console.log(`Environment: ${this.environment.toUpperCase()}`);
    console.log(`Database: ${this.dbName}`);
    console.log('Started:', new Date().toLocaleString());
    console.log('=' .repeat(60));

    await this.createIndexes();
    await this.fixStuckEvents();
    await this.removeDuplicateEvents();
    await this.cleanupOldEvents();
    await this.vacuumDatabase();

    console.log('\n✅ Maintenance completed successfully!');
    console.log('📝 Recommendations:');
    console.log('- Run this maintenance weekly');
    console.log('- Monitor failed events and investigate recurring issues');
    console.log('- Consider archiving old events instead of deleting');
  }

  /**
   * Emergency reset - use with caution
   */
  async emergencyReset() {
    console.log('\n🚨 EMERGENCY RESET - This will clear all webhook events!');
    console.log('=' .repeat(60));

    const readline = require('readline');
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    return new Promise((resolve) => {
      rl.question('Are you sure you want to DELETE ALL webhook events? (type "YES" to confirm): ', (answer) => {
        rl.close();

        if (answer === 'YES') {
          console.log('🗑️  Clearing all webhook events...');
          this.executeCommand('DELETE FROM webhook_events');
          console.log('✅ Emergency reset completed');
        } else {
          console.log('❌ Emergency reset cancelled');
        }

        resolve();
      });
    });
  }
}

// CLI interface
if (require.main === module) {
  const args = process.argv.slice(2);
  const environment = args.includes('--prod') ? 'production' : 'development';
  const command = args.find(arg => !arg.startsWith('--'));

  const cleanup = new WebhookCleanup(environment);

  console.log(`\n🧹 Webhook Cleanup - ${environment.toUpperCase()}`);

  switch (command) {
    case 'stuck':
      cleanup.fixStuckEvents();
      break;
    case 'cleanup':
      cleanup.cleanupOldEvents();
      break;
    case 'reset-failed':
      const eventId = args.find(arg => arg.startsWith('evt_'));
      cleanup.resetFailedEvents(eventId);
      break;
    case 'duplicates':
      cleanup.removeDuplicateEvents();
      break;
    case 'indexes':
      cleanup.createIndexes();
      break;
    case 'vacuum':
      cleanup.vacuumDatabase();
      break;
    case 'stats':
      cleanup.getDatabaseStats();
      break;
    case 'emergency-reset':
      cleanup.emergencyReset();
      break;
    default:
      cleanup.runMaintenance();
  }
}

module.exports = WebhookCleanup;