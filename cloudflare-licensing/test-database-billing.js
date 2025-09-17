/**
 * Database Billing Date Testing Script
 * Directly tests the database to verify billing date columns and data integrity
 */

import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

const testConfig = {
  dbPath: './test-database.sqlite3', // Test database path
  productionDbPath: './production.sqlite3' // If testing production backup
};

class DatabaseBillingTester {
  constructor(dbPath) {
    this.dbPath = dbPath;
    this.db = null;
    this.testResults = [];
  }

  async log(test, result, details = {}) {
    const timestamp = new Date().toISOString();
    const logEntry = { timestamp, test, result, details };
    this.testResults.push(logEntry);

    const status = result === 'PASS' ? '✅' : result === 'FAIL' ? '❌' : '⚠️';
    console.log(`${status} [${timestamp}] ${test}`);

    if (details.error) {
      console.log(`   Error: ${details.error}`);
    }
    if (details.data) {
      console.log(`   Data: ${JSON.stringify(details.data, null, 2)}`);
    }
  }

  initializeDatabase() {
    try {
      this.db = new Database(this.dbPath);
      console.log(`📁 Connected to database: ${this.dbPath}`);
      return true;
    } catch (error) {
      console.error(`❌ Failed to connect to database: ${error.message}`);
      return false;
    }
  }

  async testTableSchema() {
    console.log('\n📋 Testing Database Schema...');

    try {
      // Check if customers table exists
      const tablesResult = this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='customers'").get();

      if (tablesResult) {
        await this.log('Customers table exists', 'PASS');

        // Check table schema for billing date columns
        const schemaResult = this.db.prepare("PRAGMA table_info(customers)").all();
        const columnNames = schemaResult.map(col => col.name);

        const requiredBillingColumns = [
          'next_billing_date',
          'current_period_start',
          'current_period_end'
        ];

        const missingColumns = requiredBillingColumns.filter(col => !columnNames.includes(col));

        if (missingColumns.length === 0) {
          await this.log('All billing date columns present', 'PASS', {
            columns: requiredBillingColumns
          });
        } else {
          await this.log('Missing billing date columns', 'FAIL', {
            missing: missingColumns,
            existing: columnNames
          });
        }

        // Check column types
        const billingColumns = schemaResult.filter(col =>
          requiredBillingColumns.includes(col.name)
        );

        billingColumns.forEach(async (col) => {
          if (col.type === 'TEXT') {
            await this.log(`Column ${col.name} has correct type`, 'PASS', {
              column: col.name,
              type: col.type
            });
          } else {
            await this.log(`Column ${col.name} has incorrect type`, 'FAIL', {
              column: col.name,
              expected: 'TEXT',
              actual: col.type
            });
          }
        });

      } else {
        await this.log('Customers table exists', 'FAIL', {
          error: 'Customers table not found'
        });
      }
    } catch (error) {
      await this.log('Database schema check', 'FAIL', {
        error: error.message
      });
    }
  }

  async testBillingDataQueries() {
    console.log('\n🔍 Testing Billing Data Queries...');

    try {
      // Test basic select with billing columns
      const selectQuery = `
        SELECT id, email, subscription_id, subscription_status,
               next_billing_date, current_period_start, current_period_end
        FROM customers
        WHERE subscription_status = 'active'
        LIMIT 5
      `;

      const customers = this.db.prepare(selectQuery).all();

      if (customers.length > 0) {
        await this.log('Billing data query successful', 'PASS', {
          customerCount: customers.length,
          sampleCustomer: customers[0]
        });

        // Check data integrity
        let validBillingDataCount = 0;
        let invalidBillingDataCount = 0;

        customers.forEach(customer => {
          const hasAllBillingData = customer.next_billing_date &&
                                   customer.current_period_start &&
                                   customer.current_period_end;

          if (hasAllBillingData) {
            validBillingDataCount++;

            // Validate date format (should be ISO 8601)
            try {
              const nextBilling = new Date(customer.next_billing_date);
              const periodStart = new Date(customer.current_period_start);
              const periodEnd = new Date(customer.current_period_end);

              if (isNaN(nextBilling.getTime()) || isNaN(periodStart.getTime()) || isNaN(periodEnd.getTime())) {
                invalidBillingDataCount++;
              }
            } catch (e) {
              invalidBillingDataCount++;
            }
          } else {
            invalidBillingDataCount++;
          }
        });

        if (validBillingDataCount > 0) {
          await this.log('Valid billing data found', 'PASS', {
            validCount: validBillingDataCount,
            invalidCount: invalidBillingDataCount
          });
        } else {
          await this.log('No valid billing data found', 'WARN', {
            note: 'This may be expected if Phase 2 was just implemented'
          });
        }

      } else {
        await this.log('No active customers found', 'WARN', {
          note: 'Test database may be empty'
        });
      }
    } catch (error) {
      await this.log('Billing data query failed', 'FAIL', {
        error: error.message
      });
    }
  }

  async testBillingDataUpdates() {
    console.log('\n💾 Testing Billing Data Updates...');

    try {
      // Create a test customer with billing data
      const testEmail = 'db-test@pospal.gr';
      const testBillingData = {
        current_period_start: new Date().toISOString(),
        current_period_end: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        next_billing_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
      };

      // Check if test customer exists
      const existingCustomer = this.db.prepare('SELECT id FROM customers WHERE email = ?').get(testEmail);

      if (existingCustomer) {
        // Update existing customer with billing data
        const updateStmt = this.db.prepare(`
          UPDATE customers
          SET current_period_start = ?, current_period_end = ?, next_billing_date = ?
          WHERE email = ?
        `);

        const result = updateStmt.run(
          testBillingData.current_period_start,
          testBillingData.current_period_end,
          testBillingData.next_billing_date,
          testEmail
        );

        if (result.changes > 0) {
          await this.log('Billing data update successful', 'PASS', {
            email: testEmail,
            billingData: testBillingData
          });

          // Verify the update
          const updatedCustomer = this.db.prepare(`
            SELECT current_period_start, current_period_end, next_billing_date
            FROM customers WHERE email = ?
          `).get(testEmail);

          if (updatedCustomer.next_billing_date === testBillingData.next_billing_date) {
            await this.log('Billing data verification successful', 'PASS');
          } else {
            await this.log('Billing data verification failed', 'FAIL', {
              expected: testBillingData,
              actual: updatedCustomer
            });
          }
        } else {
          await this.log('Billing data update failed', 'FAIL', {
            error: 'No rows affected'
          });
        }
      } else {
        await this.log('Test customer not found', 'WARN', {
          note: `Create customer ${testEmail} first to test updates`
        });
      }
    } catch (error) {
      await this.log('Billing data update test failed', 'FAIL', {
        error: error.message
      });
    }
  }

  async testBillingDateValidation() {
    console.log('\n🔍 Testing Billing Date Validation Logic...');

    try {
      // Test customers with billing dates
      const customersWithBilling = this.db.prepare(`
        SELECT id, email, next_billing_date, current_period_start, current_period_end,
               subscription_status
        FROM customers
        WHERE next_billing_date IS NOT NULL
        AND current_period_start IS NOT NULL
        AND current_period_end IS NOT NULL
        LIMIT 10
      `).all();

      let validationErrors = [];

      customersWithBilling.forEach(customer => {
        try {
          const nextBilling = new Date(customer.next_billing_date);
          const periodStart = new Date(customer.current_period_start);
          const periodEnd = new Date(customer.current_period_end);
          const now = new Date();

          // Validation checks
          if (periodStart >= periodEnd) {
            validationErrors.push({
              customerId: customer.id,
              error: 'Period start is not before period end'
            });
          }

          if (nextBilling.getTime() !== periodEnd.getTime()) {
            validationErrors.push({
              customerId: customer.id,
              error: 'Next billing date should equal current period end'
            });
          }

          // Check if subscription is active but billing period has ended
          if (customer.subscription_status === 'active' && periodEnd < now) {
            validationErrors.push({
              customerId: customer.id,
              error: 'Active subscription with expired billing period'
            });
          }

        } catch (e) {
          validationErrors.push({
            customerId: customer.id,
            error: 'Invalid date format: ' + e.message
          });
        }
      });

      if (validationErrors.length === 0) {
        await this.log('Billing date validation passed', 'PASS', {
          customersChecked: customersWithBilling.length
        });
      } else {
        await this.log('Billing date validation issues found', 'WARN', {
          errors: validationErrors,
          customersChecked: customersWithBilling.length
        });
      }

    } catch (error) {
      await this.log('Billing date validation test failed', 'FAIL', {
        error: error.message
      });
    }
  }

  async testAuditLog() {
    console.log('\n📜 Testing Audit Log for Billing Events...');

    try {
      // Check if audit_log table exists and has billing-related entries
      const auditEntries = this.db.prepare(`
        SELECT id, customer_id, action, metadata, created_at
        FROM audit_log
        WHERE action LIKE '%payment%' OR action LIKE '%billing%'
        ORDER BY created_at DESC
        LIMIT 5
      `).all();

      if (auditEntries.length > 0) {
        await this.log('Billing audit entries found', 'PASS', {
          entryCount: auditEntries.length,
          sampleEntry: auditEntries[0]
        });
      } else {
        await this.log('No billing audit entries found', 'WARN', {
          note: 'This may be expected if no billing events have occurred yet'
        });
      }
    } catch (error) {
      await this.log('Audit log test failed', 'FAIL', {
        error: error.message
      });
    }
  }

  async runAllTests() {
    console.log('🗄️  Starting Database Billing Date Tests...\n');

    if (!this.initializeDatabase()) {
      console.error('❌ Cannot proceed without database connection');
      return;
    }

    await this.testTableSchema();
    await this.testBillingDataQueries();
    await this.testBillingDataUpdates();
    await this.testBillingDateValidation();
    await this.testAuditLog();

    this.printSummary();
    this.cleanup();
  }

  printSummary() {
    console.log('\n📊 Database Test Summary');
    console.log('=' * 50);

    const passed = this.testResults.filter(r => r.result === 'PASS').length;
    const failed = this.testResults.filter(r => r.result === 'FAIL').length;
    const warnings = this.testResults.filter(r => r.result === 'WARN').length;

    console.log(`✅ Passed: ${passed}`);
    console.log(`❌ Failed: ${failed}`);
    console.log(`⚠️  Warnings: ${warnings}`);
    console.log(`📋 Total: ${this.testResults.length}`);

    if (failed > 0) {
      console.log('\n❌ Failed Tests:');
      this.testResults
        .filter(r => r.result === 'FAIL')
        .forEach(r => console.log(`   - ${r.test}: ${r.details.error || 'Unknown error'}`));
    }

    const successRate = (passed / this.testResults.length * 100).toFixed(1);
    console.log(`\n🎯 Success Rate: ${successRate}%`);
  }

  cleanup() {
    if (this.db) {
      this.db.close();
      console.log('\n📁 Database connection closed');
    }
  }
}

// CLI interface
async function runDatabaseTests() {
  const dbPath = process.argv[3] || testConfig.dbPath;

  console.log(`🗄️  Testing database: ${dbPath}`);

  if (!fs.existsSync(dbPath)) {
    console.error(`❌ Database file not found: ${dbPath}`);
    console.log('\n💡 Available options:');
    console.log('   - Create test database first');
    console.log('   - Use development database path');
    console.log('   - Export production database for testing');
    return;
  }

  const tester = new DatabaseBillingTester(dbPath);
  await tester.runAllTests();
}

if (process.argv.length > 2) {
  const command = process.argv[2];

  switch (command) {
    case 'test':
      runDatabaseTests();
      break;
    case 'help':
      console.log(`
📖 Database Billing Test Script Usage:

node test-database-billing.js command [database-path]

Commands:
  test        - Run all database tests
  help        - Show this help

Examples:
  node test-database-billing.js test
  node test-database-billing.js test ./my-database.sqlite3

Note: Make sure you have the better-sqlite3 package installed:
  npm install better-sqlite3
      `);
      break;
    default:
      console.log('❓ Unknown command. Use "help" for usage information.');
  }
} else {
  console.log('📖 Use "help" command for usage information.');
}

export { DatabaseBillingTester, testConfig };