# 🏪 Payment Management Portal - Complete Design Specification

## 🎯 PORTAL STRATEGY: TRANSPARENCY & CONTROL

### **Core Philosophy:**
> "Give users complete control over their subscription with zero friction and maximum transparency"

### **Key Principles:**
- ✅ **Full Transparency** - Every charge, every date, every detail visible
- ✅ **Easy Cancellation** - One-click cancel, no dark patterns
- ✅ **Self-Service** - Users solve problems without contacting support
- ✅ **Professional Experience** - Enterprise-grade subscription management
- ✅ **Mobile-First** - Perfect experience on all devices

---

## 🏗️ PORTAL ARCHITECTURE

### **Three-Layer Approach:**

#### **Layer 1: Quick Actions (Account Overview)**
- Current subscription status
- Next billing date and amount
- Quick access to common actions
- Recent activity summary

#### **Layer 2: Stripe Customer Portal (Self-Service)**
- Complete billing management
- Payment method updates
- Invoice downloads
- Subscription modifications

#### **Layer 3: POSPal Account Settings (Business Logic)**
- Restaurant profile management
- Usage statistics
- Support and documentation
- Account deletion

---

## 📊 COMPLETE PORTAL DESIGN

### **MAIN ACCOUNT PAGE (`account.html`)**

```html
<!DOCTYPE html>
<html lang="el">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Ο Λογαριασμός μου - POSPal</title>
    <script src="https://js.stripe.com/v3/"></script>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        
        body {
            font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
            background: #f8fafc;
            color: #1F2937;
            line-height: 1.6;
        }

        .container {
            max-width: 1200px;
            margin: 0 auto;
            padding: 2rem;
        }

        .header {
            background: white;
            border-radius: 12px;
            padding: 2rem;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.05);
            margin-bottom: 2rem;
            border: 1px solid #E5E7EB;
        }

        .header-content {
            display: flex;
            justify-content: space-between;
            align-items: center;
            flex-wrap: wrap;
            gap: 1rem;
        }

        .user-info h1 {
            font-size: 2rem;
            font-weight: 700;
            color: #1F2937;
            margin-bottom: 0.5rem;
        }

        .user-info p {
            color: #6B7280;
            font-size: 1.1rem;
        }

        .status-badge {
            padding: 0.5rem 1rem;
            border-radius: 20px;
            font-weight: 600;
            font-size: 0.9rem;
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }

        .status-active {
            background: #DCFCE7;
            color: #166534;
        }

        .status-trial {
            background: #FEF3C7;
            color: #92400E;
        }

        .status-cancelled {
            background: #FEE2E2;
            color: #991B1B;
        }

        .dashboard-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(350px, 1fr));
            gap: 2rem;
            margin-bottom: 3rem;
        }

        .card {
            background: white;
            border-radius: 12px;
            padding: 2rem;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.05);
            border: 1px solid #E5E7EB;
            transition: transform 0.2s ease, box-shadow 0.2s ease;
        }

        .card:hover {
            transform: translateY(-2px);
            box-shadow: 0 8px 25px rgba(0, 0, 0, 0.1);
        }

        .card-header {
            display: flex;
            align-items: center;
            margin-bottom: 1.5rem;
        }

        .card-icon {
            font-size: 1.5rem;
            margin-right: 0.75rem;
        }

        .card-title {
            font-size: 1.25rem;
            font-weight: 600;
            color: #1F2937;
        }

        .billing-info {
            margin-bottom: 1rem;
        }

        .billing-amount {
            font-size: 2rem;
            font-weight: 700;
            color: #059669;
            margin-bottom: 0.25rem;
        }

        .billing-period {
            color: #6B7280;
            font-size: 1rem;
        }

        .next-billing {
            background: #F0FDF4;
            border: 1px solid #BBF7D0;
            border-radius: 8px;
            padding: 1rem;
            margin: 1rem 0;
        }

        .next-billing strong {
            color: #059669;
        }

        .action-button {
            background: #059669;
            color: white;
            border: none;
            padding: 0.75rem 1.5rem;
            border-radius: 8px;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.2s ease;
            width: 100%;
            margin: 0.5rem 0;
        }

        .action-button:hover {
            background: #047857;
            transform: translateY(-1px);
        }

        .action-button.secondary {
            background: #6B7280;
        }

        .action-button.secondary:hover {
            background: #4B5563;
        }

        .action-button.danger {
            background: #DC2626;
        }

        .action-button.danger:hover {
            background: #B91C1C;
        }

        .stripe-portal-btn {
            background: #635BFF;
            color: white;
            border: none;
            padding: 1rem 2rem;
            border-radius: 8px;
            font-weight: 600;
            cursor: pointer;
            width: 100%;
            font-size: 1rem;
            transition: all 0.2s ease;
        }

        .stripe-portal-btn:hover {
            background: #5A52E8;
            transform: translateY(-1px);
        }

        .usage-stats {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
            gap: 1rem;
            margin: 1rem 0;
        }

        .stat-item {
            text-align: center;
            padding: 1rem;
            background: #F9FAFB;
            border-radius: 8px;
        }

        .stat-number {
            font-size: 2rem;
            font-weight: 700;
            color: #059669;
        }

        .stat-label {
            color: #6B7280;
            font-size: 0.9rem;
            margin-top: 0.25rem;
        }

        .recent-activity {
            margin-top: 1.5rem;
        }

        .activity-item {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 0.75rem 0;
            border-bottom: 1px solid #F3F4F6;
        }

        .activity-item:last-child {
            border-bottom: none;
        }

        .activity-description {
            font-weight: 500;
        }

        .activity-date {
            color: #6B7280;
            font-size: 0.9rem;
        }

        .activity-amount {
            font-weight: 600;
            color: #059669;
        }

        .support-links {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 1rem;
            margin-top: 1.5rem;
        }

        .support-link {
            display: flex;
            align-items: center;
            padding: 1rem;
            background: #F9FAFB;
            border-radius: 8px;
            text-decoration: none;
            color: #1F2937;
            transition: background-color 0.2s ease;
        }

        .support-link:hover {
            background: #F3F4F6;
        }

        .support-link-icon {
            font-size: 1.25rem;
            margin-right: 0.75rem;
        }

        .modal {
            display: none;
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0, 0, 0, 0.5);
            z-index: 1000;
            align-items: center;
            justify-content: center;
        }

        .modal-content {
            background: white;
            border-radius: 12px;
            padding: 2rem;
            max-width: 500px;
            margin: 2rem;
            box-shadow: 0 20px 50px rgba(0, 0, 0, 0.3);
        }

        .modal-header {
            font-size: 1.5rem;
            font-weight: 700;
            margin-bottom: 1rem;
            color: #1F2937;
        }

        .modal-body {
            margin-bottom: 2rem;
            color: #6B7280;
            line-height: 1.6;
        }

        .modal-actions {
            display: flex;
            gap: 1rem;
            justify-content: flex-end;
        }

        .btn-cancel-modal {
            padding: 0.75rem 1.5rem;
            border: 1px solid #D1D5DB;
            background: white;
            border-radius: 8px;
            cursor: pointer;
            font-weight: 500;
        }

        @media (max-width: 768px) {
            .container {
                padding: 1rem;
            }
            
            .header-content {
                flex-direction: column;
                text-align: center;
            }
            
            .dashboard-grid {
                grid-template-columns: 1fr;
            }
            
            .card {
                padding: 1.5rem;
            }
        }
    </style>
</head>
<body>
    <div class="container">
        <!-- Account Header -->
        <div class="header">
            <div class="header-content">
                <div class="user-info">
                    <h1 id="restaurant-name">Taverna Mykonos</h1>
                    <p id="user-email">maria@tavernamykonos.gr</p>
                </div>
                <div class="status-badge status-active" id="account-status">
                    Ενεργό
                </div>
            </div>
        </div>

        <!-- Dashboard Grid -->
        <div class="dashboard-grid">
            <!-- Subscription Info Card -->
            <div class="card">
                <div class="card-header">
                    <div class="card-icon">💳</div>
                    <div class="card-title">Η Συνδρομή μου</div>
                </div>
                
                <div class="billing-info">
                    <div class="billing-amount" id="billing-amount">€20</div>
                    <div class="billing-period">ανά μήνα</div>
                </div>

                <div class="next-billing">
                    <strong>Επόμενη χρέωση:</strong> <span id="next-billing-date">15 Μαρτίου 2024</span>
                </div>

                <button class="stripe-portal-btn" id="manage-billing-btn">
                    🔧 Διαχείριση Χρέωσης & Πληρωμών
                </button>
                
                <button class="action-button danger" id="cancel-subscription-btn" style="margin-top: 1rem;">
                    ❌ Ακύρωση Συνδρομής
                </button>
            </div>

            <!-- Usage Statistics Card -->
            <div class="card">
                <div class="card-header">
                    <div class="card-icon">📊</div>
                    <div class="card-title">Στατιστικά Χρήσης</div>
                </div>

                <div class="usage-stats">
                    <div class="stat-item">
                        <div class="stat-number" id="orders-count">1,247</div>
                        <div class="stat-label">Συνολικές Παραγγελίες</div>
                    </div>
                    <div class="stat-item">
                        <div class="stat-number" id="monthly-orders">89</div>
                        <div class="stat-label">Αυτόν τον Μήνα</div>
                    </div>
                    <div class="stat-item">
                        <div class="stat-number" id="tables-count">12</div>
                        <div class="stat-label">Ενεργά Τραπέζια</div>
                    </div>
                    <div class="stat-item">
                        <div class="stat-number" id="uptime">99.8%</div>
                        <div class="stat-label">Χρόνος Λειτουργίας</div>
                    </div>
                </div>

                <button class="action-button secondary" id="download-data-btn">
                    📥 Λήψη Δεδομένων
                </button>
            </div>

            <!-- Recent Activity Card -->
            <div class="card">
                <div class="card-header">
                    <div class="card-icon">🕐</div>
                    <div class="card-title">Πρόσφατη Δραστηριότητα</div>
                </div>

                <div class="recent-activity" id="recent-activity">
                    <div class="activity-item">
                        <div>
                            <div class="activity-description">Πληρωμή επεξεργάστηκε</div>
                            <div class="activity-date">15 Φεβρουαρίου 2024</div>
                        </div>
                        <div class="activity-amount">€20.00</div>
                    </div>
                    <div class="activity-item">
                        <div>
                            <div class="activity-description">Σύνδεση στο POSPal</div>
                            <div class="activity-date">14 Φεβρουαρίου 2024</div>
                        </div>
                        <div>✅</div>
                    </div>
                    <div class="activity-item">
                        <div>
                            <div class="activity-description">Ενημέρωση μενού</div>
                            <div class="activity-date">13 Φεβρουαρίου 2024</div>
                        </div>
                        <div>📝</div>
                    </div>
                </div>

                <button class="action-button secondary" id="view-full-history-btn">
                    📋 Πλήρες Ιστορικό
                </button>
            </div>

            <!-- Support & Help Card -->
            <div class="card">
                <div class="card-header">
                    <div class="card-icon">🆘</div>
                    <div class="card-title">Υποστήριξη & Βοήθεια</div>
                </div>

                <div class="support-links">
                    <a href="#" class="support-link">
                        <div class="support-link-icon">📚</div>
                        <div>Οδηγός Χρήσης</div>
                    </a>
                    <a href="#" class="support-link">
                        <div class="support-link-icon">🎥</div>
                        <div>Video Tutorials</div>
                    </a>
                    <a href="#" class="support-link">
                        <div class="support-link-icon">💬</div>
                        <div>Επικοινωνία</div>
                    </a>
                    <a href="#" class="support-link">
                        <div class="support-link-icon">❓</div>
                        <div>Συχνές Ερωτήσεις</div>
                    </a>
                </div>

                <button class="action-button" id="contact-support-btn">
                    📧 Στείλε Email Υποστήριξης
                </button>
            </div>
        </div>
    </div>

    <!-- Cancellation Confirmation Modal -->
    <div class="modal" id="cancel-modal">
        <div class="modal-content">
            <div class="modal-header">
                Ακύρωση Συνδρομής
            </div>
            <div class="modal-body">
                <p><strong>Είσαι σίγουρος ότι θέλεις να ακυρώσεις τη συνδρομή σου;</strong></p>
                <br>
                <p>• Η συνδρομή σου θα παραμείνει ενεργή μέχρι <strong id="cancel-date">15 Μαρτίου 2024</strong></p>
                <p>• Δεν θα χρεωθείς ξανά μετά από αυτή την ημερομηνία</p>
                <p>• Μπορείς να επανενεργοποιήσεις οποτεδήποτε</p>
                <br>
                <p>Θα μας λείψεις! 😢</p>
            </div>
            <div class="modal-actions">
                <button class="btn-cancel-modal" onclick="closeCancelModal()">
                    Ακύρωση
                </button>
                <button class="action-button danger" onclick="confirmCancellation()">
                    Ναι, Ακύρωση Συνδρομής
                </button>
            </div>
        </div>
    </div>

    <script>
        // Initialize Stripe
        const stripe = Stripe('pk_test_51S2bGO0ee6hGru1PcQXsgn6AvCPqDGqVwZ9AuON37wN3EQpsLNCSCMlpLC4U3xVAda7zgL2D4ifbT1TSXn0PJtbL00b1W7wxZT');

        // Load account data on page load
        document.addEventListener('DOMContentLoaded', async () => {
            await loadAccountData();
            setupEventListeners();
        });

        // Load account information
        async function loadAccountData() {
            try {
                const token = localStorage.getItem('pospal_token');
                if (!token) {
                    window.location.href = '/login.html';
                    return;
                }

                const response = await fetch('/api/account-info', {
                    headers: {
                        'Authorization': `Bearer ${token}`
                    }
                });

                if (!response.ok) {
                    throw new Error('Failed to load account data');
                }

                const data = await response.json();
                updateAccountDisplay(data);

            } catch (error) {
                console.error('Account data loading failed:', error);
                showError('Σφάλμα φόρτωσης δεδομένων λογαριασμού');
            }
        }

        // Update account display with data
        function updateAccountDisplay(data) {
            document.getElementById('restaurant-name').textContent = data.restaurantName;
            document.getElementById('user-email').textContent = data.email;
            document.getElementById('billing-amount').textContent = `€${data.subscription.amount}`;
            document.getElementById('next-billing-date').textContent = data.subscription.nextBilling;
            document.getElementById('orders-count').textContent = data.stats.totalOrders;
            document.getElementById('monthly-orders').textContent = data.stats.monthlyOrders;
            document.getElementById('tables-count').textContent = data.stats.activeTables;
            document.getElementById('uptime').textContent = `${data.stats.uptime}%`;
            
            // Update status badge
            const statusBadge = document.getElementById('account-status');
            statusBadge.textContent = data.subscription.status === 'active' ? 'Ενεργό' : data.subscription.status;
            statusBadge.className = `status-badge status-${data.subscription.status}`;
        }

        // Setup event listeners
        function setupEventListeners() {
            // Stripe Customer Portal
            document.getElementById('manage-billing-btn').addEventListener('click', openStripePortal);
            
            // Cancellation
            document.getElementById('cancel-subscription-btn').addEventListener('click', openCancelModal);
            
            // Other actions
            document.getElementById('download-data-btn').addEventListener('click', downloadData);
            document.getElementById('contact-support-btn').addEventListener('click', contactSupport);
        }

        // Open Stripe Customer Portal
        async function openStripePortal() {
            try {
                const token = localStorage.getItem('pospal_token');
                const response = await fetch('/api/create-portal-session', {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'Content-Type': 'application/json'
                    }
                });

                if (!response.ok) {
                    throw new Error('Failed to create portal session');
                }

                const session = await response.json();
                window.location.href = session.url;

            } catch (error) {
                console.error('Portal access failed:', error);
                showError('Σφάλμα πρόσβασης στο πάνελ διαχείρισης');
            }
        }

        // Modal functions
        function openCancelModal() {
            document.getElementById('cancel-modal').style.display = 'flex';
        }

        function closeCancelModal() {
            document.getElementById('cancel-modal').style.display = 'none';
        }

        // Confirm cancellation
        async function confirmCancellation() {
            try {
                const token = localStorage.getItem('pospal_token');
                const response = await fetch('/api/cancel-subscription', {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'Content-Type': 'application/json'
                    }
                });

                if (!response.ok) {
                    throw new Error('Cancellation failed');
                }

                closeCancelModal();
                showSuccess('Η συνδρομή σου ακυρώθηκε επιτυχώς. Θα παραμείνει ενεργή μέχρι το τέλος της τρέχουσας περιόδου.');
                await loadAccountData(); // Refresh data

            } catch (error) {
                console.error('Cancellation failed:', error);
                showError('Σφάλμα ακύρωσης συνδρομής');
            }
        }

        // Download user data
        async function downloadData() {
            try {
                const token = localStorage.getItem('pospal_token');
                const response = await fetch('/api/export-data', {
                    headers: {
                        'Authorization': `Bearer ${token}`
                    }
                });

                if (!response.ok) {
                    throw new Error('Data export failed');
                }

                const blob = await response.blob();
                const url = window.URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = 'pospal-data-export.json';
                a.click();
                window.URL.revokeObjectURL(url);

                showSuccess('Η λήψη δεδομένων ξεκίνησε');

            } catch (error) {
                console.error('Data export failed:', error);
                showError('Σφάλμα λήψης δεδομένων');
            }
        }

        // Contact support
        function contactSupport() {
            window.location.href = 'mailto:support@pospal.gr?subject=Υποστήριξη POSPal - ' + document.getElementById('restaurant-name').textContent;
        }

        // Utility functions
        function showError(message) {
            // Simple error notification - you could use a toast library
            alert('Σφάλμα: ' + message);
        }

        function showSuccess(message) {
            // Simple success notification
            alert('Επιτυχία: ' + message);
        }

        // Close modal when clicking outside
        window.addEventListener('click', (e) => {
            if (e.target.classList.contains('modal')) {
                e.target.style.display = 'none';
            }
        });
    </script>
</body>
</html>
```

---

## 🔧 BACKEND API ENDPOINTS

### **Account Information API:**

```javascript
// src/account-api.js
export async function getAccountInfo(request, env) {
    try {
        const token = request.headers.get('Authorization')?.replace('Bearer ', '');
        const userData = verifyJWT(token, env.JWT_SECRET);
        
        // Get customer data from Stripe
        const customer = await stripe.customers.retrieve(userData.stripe_customer_id);
        const subscriptions = await stripe.subscriptions.list({
            customer: userData.stripe_customer_id,
            limit: 1
        });
        
        const subscription = subscriptions.data[0];
        
        // Get usage statistics from database
        const stats = await env.DB.prepare(`
            SELECT 
                COUNT(*) as total_orders,
                COUNT(CASE WHEN created_at >= datetime('now', '-30 days') THEN 1 END) as monthly_orders
            FROM user_activity 
            WHERE user_id = ?
        `).bind(userData.user_id).first();

        return new Response(JSON.stringify({
            restaurantName: userData.restaurant_name,
            email: customer.email,
            subscription: {
                status: subscription.status,
                amount: (subscription.items.data[0].price.unit_amount / 100),
                nextBilling: new Date(subscription.current_period_end * 1000).toLocaleDateString('el-GR'),
                cancelAtPeriodEnd: subscription.cancel_at_period_end
            },
            stats: {
                totalOrders: stats.total_orders || 0,
                monthlyOrders: stats.monthly_orders || 0,
                activeTables: userData.active_tables || 12,
                uptime: '99.8' // Could be calculated from uptime monitoring
            }
        }), {
            headers: { 'Content-Type': 'application/json' }
        });

    } catch (error) {
        console.error('Account info fetch failed:', error);
        return new Response(JSON.stringify({ error: 'Account data unavailable' }), { 
            status: 500 
        });
    }
}
```

### **Subscription Cancellation API:**

```javascript
// src/cancellation-api.js
export async function cancelSubscription(request, env) {
    try {
        const token = request.headers.get('Authorization')?.replace('Bearer ', '');
        const userData = verifyJWT(token, env.JWT_SECRET);
        
        // Get current subscription
        const subscriptions = await stripe.subscriptions.list({
            customer: userData.stripe_customer_id,
            status: 'active',
            limit: 1
        });
        
        if (subscriptions.data.length === 0) {
            return new Response(JSON.stringify({ error: 'No active subscription' }), { 
                status: 400 
            });
        }
        
        const subscription = subscriptions.data[0];
        
        // Cancel at period end (not immediately)
        const cancelledSubscription = await stripe.subscriptions.update(subscription.id, {
            cancel_at_period_end: true,
            metadata: {
                cancelled_by: 'customer',
                cancelled_at: new Date().toISOString(),
                cancellation_reason: 'customer_request'
            }
        });
        
        // Log cancellation in database
        await env.DB.prepare(`
            INSERT INTO user_activity (user_id, action, details, created_at)
            VALUES (?, 'subscription_cancelled', ?, datetime('now'))
        `).bind(
            userData.user_id,
            JSON.stringify({ subscription_id: subscription.id, cancelled_at_period_end: true })
        ).run();
        
        // Send cancellation email
        await sendCancellationEmail(userData.email, subscription.current_period_end, env);
        
        return new Response(JSON.stringify({
            success: true,
            message: 'Subscription cancelled successfully',
            activeUntil: new Date(subscription.current_period_end * 1000).toLocaleDateString('el-GR')
        }), {
            headers: { 'Content-Type': 'application/json' }
        });

    } catch (error) {
        console.error('Subscription cancellation failed:', error);
        return new Response(JSON.stringify({ error: 'Cancellation failed' }), { 
            status: 500 
        });
    }
}
```

### **Data Export API:**

```javascript
// src/data-export.js
export async function exportUserData(request, env) {
    try {
        const token = request.headers.get('Authorization')?.replace('Bearer ', '');
        const userData = verifyJWT(token, env.JWT_SECRET);
        
        // Collect all user data
        const exportData = {
            account: {
                restaurant_name: userData.restaurant_name,
                email: userData.email,
                created_at: userData.created_at
            },
            
            // Get subscription history
            subscription_history: await getSubscriptionHistory(userData.stripe_customer_id),
            
            // Get usage statistics
            usage_statistics: await getUserUsageStats(userData.user_id, env),
            
            // Get activity log
            activity_log: await getUserActivityLog(userData.user_id, env),
            
            export_info: {
                generated_at: new Date().toISOString(),
                format: 'JSON',
                version: '1.0'
            }
        };
        
        return new Response(JSON.stringify(exportData, null, 2), {
            headers: {
                'Content-Type': 'application/json',
                'Content-Disposition': `attachment; filename="pospal-data-export-${Date.now()}.json"`
            }
        });

    } catch (error) {
        console.error('Data export failed:', error);
        return new Response(JSON.stringify({ error: 'Export failed' }), { 
            status: 500 
        });
    }
}
```

---

## 📧 AUTOMATED EMAIL COMMUNICATIONS

### **Cancellation Email Template:**

```javascript
// src/email-templates.js
export const cancellationEmailTemplate = (restaurantName, activeUntil) => ({
    subject: `Η συνδρομή σου στο POSPal ακυρώθηκε - ${restaurantName}`,
    html: `
        <div style="font-family: Inter, system-ui, sans-serif; max-width: 600px; margin: 0 auto;">
            <div style="background: #059669; color: white; padding: 2rem; text-align: center;">
                <h1>😢 Θα μας λείψεις!</h1>
            </div>
            
            <div style="padding: 2rem; background: #f8fafc;">
                <h2>Γεια σου από το POSPal,</h2>
                
                <p>Λυπούμαστε που έχασες την εμπιστοσύνη σου στο POSPal. Η συνδρομή σου για το <strong>${restaurantName}</strong> ακυρώθηκε επιτυχώς.</p>
                
                <div style="background: white; border: 2px solid #E5E7EB; border-radius: 8px; padding: 1.5rem; margin: 1.5rem 0;">
                    <h3>📅 Τι συμβαίνει τώρα:</h3>
                    <ul style="margin: 1rem 0;">
                        <li>✅ Η συνδρομή σου παραμένει ενεργή μέχρι <strong>${activeUntil}</strong></li>
                        <li>🚫 Δεν θα χρεωθείς ξανά μετά από αυτή την ημερομηνία</li>
                        <li>💾 Όλα τα δεδομένα σου θα διατηρηθούν για 90 ημέρες</li>
                        <li>🔄 Μπορείς να επανενεργοποιήσεις οποτεδήποτε</li>
                    </ul>
                </div>
                
                <div style="background: #FEF3C7; border: 2px solid #F59E0B; border-radius: 8px; padding: 1.5rem; margin: 1.5rem 0;">
                    <h3>💡 Άλλαξες γνώμη;</h3>
                    <p>Εάν θέλεις να συνεχίσεις με το POSPal, μπορείς να επανενεργοποιήσεις τη συνδρομή σου οποτεδήποτε πριν από τη λήξη.</p>
                    <a href="https://pospal.gr/reactivate" style="background: #059669; color: white; padding: 0.75rem 1.5rem; border-radius: 8px; text-decoration: none; display: inline-block; margin-top: 1rem;">
                        🔄 Επανενεργοποίηση Συνδρομής
                    </a>
                </div>
                
                <p>Εάν αντιμετώπισες κάποιο πρόβλημα ή έχεις κάποια ανατροφοδότηση, θα θέλαμε πολύ να το ακούσουμε:</p>
                
                <a href="mailto:support@pospal.gr?subject=Σχόλια για την ακύρωση" style="background: #6B7280; color: white; padding: 0.75rem 1.5rem; border-radius: 8px; text-decoration: none; display: inline-block; margin: 1rem 0;">
                    💬 Στείλε μας Σχόλια
                </a>
                
                <p>Σε ευχαριστούμε που δοκίμασες το POSPal και σου ευχόμαστε τα καλύτερα για το εστιατόριό σου!</p>
                
                <p style="color: #6B7280; font-size: 0.9rem; margin-top: 2rem;">
                    Με εκτίμηση,<br>
                    Η Ομάδα του POSPal
                </p>
            </div>
        </div>
    `
});
```

---

## 📱 MOBILE-OPTIMIZED EXPERIENCE

### **Mobile Portal Features:**
- **Touch-friendly navigation** with large tap targets
- **Swipe gestures** for common actions
- **Mobile-specific layouts** for complex information
- **One-thumb operation** for all primary functions
- **Fast loading** optimized for mobile networks

### **Progressive Web App Features:**
```javascript
// Add to portal for mobile app experience
const pwaManifest = {
    name: "POSPal Account Portal",
    short_name: "POSPal",
    description: "Manage your POSPal subscription",
    start_url: "/account",
    display: "standalone",
    background_color: "#059669",
    theme_color: "#059669",
    icons: [
        {
            src: "/icon-192.png",
            sizes: "192x192",
            type: "image/png"
        }
    ]
};
```

---

## ✅ TESTING & VALIDATION

### **Portal Testing Checklist:**

#### **Functionality Testing:**
- [ ] Account data loads correctly
- [ ] Stripe portal integration works
- [ ] Cancellation flow completes successfully
- [ ] Data export downloads properly
- [ ] Email notifications are sent
- [ ] Mobile responsive design works

#### **Security Testing:**
- [ ] JWT token validation
- [ ] Unauthorized access blocked
- [ ] Stripe webhook signature verification
- [ ] Data privacy compliance
- [ ] SQL injection protection

#### **User Experience Testing:**
- [ ] Clear navigation and information hierarchy
- [ ] Fast loading times (< 3 seconds)
- [ ] Error handling is user-friendly
- [ ] Success confirmations are clear
- [ ] Mobile experience is smooth

---

<function_calls>
<invoke name="TodoWrite">
<parameter name="todos">[{"content": "BACKEND SYSTEM COMPLETE", "status": "completed", "activeForm": "Backend authentication and payment system working"}, {"content": "FRONTEND REDESIGN PLANNING", "status": "completed", "activeForm": "Planning complete frontend payment experience redesign"}, {"content": "Audit current frontend payment pages", "status": "completed", "activeForm": "Auditing current frontend payment pages"}, {"content": "Design user-centric payment flow", "status": "completed", "activeForm": "Designing user-centric payment flow"}, {"content": "Plan Stripe native UI integration", "status": "completed", "activeForm": "Planning Stripe native UI integration"}, {"content": "Design payment management portal", "status": "completed", "activeForm": "Designing payment management portal"}]