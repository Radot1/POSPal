// Management Component Module
// This module contains the management modal markup as a template string
// and provides a function to inject it into the DOM

export function getManagementComponentHTML() {
    return `
    <!-- Login Modal -->
    <div id="loginModal" class="fixed inset-0 bg-black bg-opacity-70 z-[90] hidden items-center justify-center p-4">
        <div class="bg-white rounded-lg shadow-xl p-6 w-full max-w-sm text-gray-800">
            <h3 class="text-xl font-semibold mb-4 text-center">Management Access</h3>
            <form id="loginForm">
                <div class="space-y-4">
                    <div>
                        <label for="passwordInput" class="block text-sm font-medium text-gray-700">Password</label>
                        <input type="password" id="passwordInput" name="password" class="mt-1 block w-full px-3 py-2 border border-gray-400 rounded-md shadow-sm sm:text-sm" required>
                    </div>
                    <p id="loginError" class="text-red-600 text-sm hidden">Incorrect password</p>
                    <button type="submit" id="loginSubmitBtn" class="w-full py-2 px-4 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors">Login</button>
                </div>
            </form>
            <button onclick="closeLoginModal()" class="mt-4 w-full py-2 px-4 border border-gray-400 text-gray-700 rounded-md hover:bg-gray-50 transition-colors">Cancel</button>
        </div>
    </div>

    <!-- Management Modal -->
    <div id="managementModal" class="fixed inset-0 bg-black bg-opacity-50 z-[70] flex flex-col justify-end sm:justify-center sm:items-center">
        <div class="bg-white shadow-xl w-full h-[90vh] sm:h-auto sm:max-h-[90vh] sm:max-w-6xl flex flex-col text-gray-800 rounded-t-2xl sm:rounded-lg">
            <div class="p-4 border-b border-gray-200 flex justify-between items-center flex-shrink-0">
                <h2 class="text-xl font-semibold">Management</h2>
                <button onclick="closeManagementModal()" class="text-gray-500 hover:text-black"><i class="fas fa-times text-2xl"></i></button>
            </div>
            <div class="p-2 border-b border-gray-200 management-tab-container flex-shrink-0">
                <div class="flex flex-wrap gap-1 rounded-md bg-gray-100 p-1">
                    <button onclick="showManagementTab('items')" class="management-tab active px-3 py-1 text-sm rounded-md bg-white shadow-sm text-gray-700 hover:bg-gray-50">Items</button>
                    <button onclick="showManagementTab('categories')" class="management-tab px-3 py-1 text-sm rounded-md text-gray-600 hover:bg-gray-50">Categories</button>
                    <button onclick="showManagementTab('analytics')" class="management-tab px-3 py-1 text-sm rounded-md text-gray-600 hover:bg-gray-50">Analytics</button>
                    <button onclick="showManagementTab('settings')" class="management-tab px-3 py-1 text-sm rounded-md text-gray-600 hover:bg-gray-50">Settings</button>
                </div>
            </div>
            <div class="flex-1 overflow-y-auto p-4">
                <!-- Items Tab -->
                <div id="items-tab" class="management-tab-content">
                    <div class="flex justify-between items-center mb-4">
                        <h3 class="text-lg font-semibold">Items Management</h3>
                        <button onclick="openItemFormModal()" class="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors">
                            <i class="fas fa-plus mr-2"></i>Add Item
                        </button>
                    </div>
                    <div class="bg-gray-50 p-4 rounded-lg shadow">
                        <div class="flex justify-between items-center mb-3">
                            <h4 class="font-semibold text-gray-700">Items List</h4>
                            <div class="flex gap-2">
                                <input type="text" id="itemSearch" placeholder="Search items..." class="px-3 py-1 border border-gray-300 rounded-md text-sm">
                                <select id="categoryFilter" class="px-3 py-1 border border-gray-300 rounded-md text-sm">
                                    <option value="">All Categories</option>
                                </select>
                            </div>
                        </div>
                        <div id="itemsList" class="space-y-2">
                            <!-- Items will be populated here -->
                        </div>
                    </div>
                </div>

                <!-- Categories Tab -->
                <div id="categories-tab" class="management-tab-content hidden">
                    <div class="flex justify-between items-center mb-4">
                        <h3 class="text-lg font-semibold">Categories Management</h3>
                        <button onclick="openCategoryFormModal()" class="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors">
                            <i class="fas fa-plus mr-2"></i>Add Category
                        </button>
                    </div>
                    <div class="bg-gray-50 p-4 rounded-lg shadow">
                        <div class="flex justify-between items-center mb-3">
                            <h4 class="font-semibold text-gray-700">Categories List</h4>
                        </div>
                        <div id="categoriesList" class="space-y-2">
                            <!-- Categories will be populated here -->
                        </div>
                    </div>
                </div>

                <!-- Analytics Tab -->
                <div id="analytics-tab" class="management-tab-content hidden">
                    <div class="flex justify-between items-center mb-4">
                        <h3 class="text-lg font-semibold">Analytics Dashboard</h3>
                        <div class="flex gap-2">
                            <select id="analyticsPeriod" class="px-3 py-1 border border-gray-300 rounded-md text-sm">
                                <option value="today">Today</option>
                                <option value="week">This Week</option>
                                <option value="month">This Month</option>
                                <option value="year">This Year</option>
                            </select>
                            <button onclick="refreshAnalytics()" class="px-3 py-1 bg-gray-600 text-white rounded-md hover:bg-gray-700 transition-colors text-sm">
                                <i class="fas fa-sync-alt mr-1"></i>Refresh
                            </button>
                        </div>
                    </div>
                    <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
                        <div class="bg-white p-4 rounded-lg border">
                            <div class="flex items-center">
                                <div class="p-2 bg-green-100 rounded-lg">
                                    <i class="fas fa-shopping-cart text-green-600"></i>
                                </div>
                                <div class="ml-3">
                                    <p class="text-sm text-gray-600">Total Sales</p>
                                    <p id="kpi-total-sales" class="text-lg font-semibold">€0.00</p>
                                </div>
                            </div>
                        </div>
                        <div class="bg-white p-4 rounded-lg border">
                            <div class="flex items-center">
                                <div class="p-2 bg-blue-100 rounded-lg">
                                    <i class="fas fa-receipt text-blue-600"></i>
                                </div>
                                <div class="ml-3">
                                    <p class="text-sm text-gray-600">Orders</p>
                                    <p id="kpi-total-orders" class="text-lg font-semibold">0</p>
                                </div>
                            </div>
                        </div>
                        <div class="bg-white p-4 rounded-lg border">
                            <div class="flex items-center">
                                <div class="p-2 bg-purple-100 rounded-lg">
                                    <i class="fas fa-users text-purple-600"></i>
                                </div>
                                <div class="ml-3">
                                    <p class="text-sm text-gray-600">Customers</p>
                                    <p id="kpi-total-customers" class="text-lg font-semibold">0</p>
                                </div>
                            </div>
                        </div>
                        <div class="bg-white p-4 rounded-lg border">
                            <div class="flex items-center">
                                <div class="p-2 bg-orange-100 rounded-lg">
                                    <i class="fas fa-chart-line text-orange-600"></i>
                                </div>
                                <div class="ml-3">
                                    <p class="text-sm text-gray-600">Avg. Order</p>
                                    <p id="kpi-avg-order" class="text-lg font-semibold">€0.00</p>
                                </div>
                            </div>
                        </div>
                    </div>
                    <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
                        <div class="bg-white p-4 rounded-lg border">
                            <h4 class="font-semibold text-gray-700 mb-3">Top Selling Items</h4>
                            <div id="topItemsList" class="space-y-2">
                                <!-- Top items will be populated here -->
                            </div>
                        </div>
                        <div class="bg-white p-4 rounded-lg border">
                            <h4 class="font-semibold text-gray-700 mb-3">Sales by Category</h4>
                            <div id="categorySalesList" class="space-y-2">
                                <!-- Category sales will be populated here -->
                            </div>
                        </div>
                    </div>
                    <div class="mt-6">
                        <div class="bg-gray-50 p-4 rounded-lg shadow">
                            <h4 class="font-semibold text-gray-700 mb-2">Payment Methods</h4>
                            <div class="space-y-2 mt-3">
                                <div class="flex justify-between items-center">
                                    <span class="text-sm text-gray-600">
                                        <i class="fas fa-money-bill-wave mr-2 text-green-500"></i>Cash
                                    </span>
                                    <span id="kpi-payment-cash" class="font-bold text-gray-800">€0.00</span>
                                </div>
                                <div class="flex justify-between items-center">
                                    <span class="text-sm text-gray-600">
                                        <i class="far fa-credit-card mr-2 text-blue-500"></i>Card
                                    </span>
                                    <span id="kpi-payment-card" class="font-bold text-gray-800">€0.00</span>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- Settings Tab -->
                <div id="settings-tab" class="management-tab-content hidden">
                    <div class="flex justify-between items-center mb-4">
                        <h3 class="text-lg font-semibold">System Settings</h3>
                    </div>
                    <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
                        <div class="bg-white p-4 rounded-lg border">
                            <h4 class="font-semibold text-gray-700 mb-3">General Settings</h4>
                            <div class="space-y-4">
                                <div>
                                    <label class="block text-sm font-medium text-gray-700 mb-1">Store Name</label>
                                    <input type="text" id="storeName" class="w-full px-3 py-2 border border-gray-300 rounded-md">
                                </div>
                                <div>
                                    <label class="block text-sm font-medium text-gray-700 mb-1">Currency</label>
                                    <select id="currency" class="w-full px-3 py-2 border border-gray-300 rounded-md">
                                        <option value="EUR">Euro (€)</option>
                                        <option value="USD">US Dollar ($)</option>
                                        <option value="GBP">British Pound (£)</option>
                                    </select>
                                </div>
                                <div>
                                    <label class="block text-sm font-medium text-gray-700 mb-1">Tax Rate (%)</label>
                                    <input type="number" id="taxRate" step="0.01" class="w-full px-3 py-2 border border-gray-300 rounded-md">
                                </div>
                            </div>
                        </div>
                        <div class="bg-white p-4 rounded-lg border">
                            <h4 class="font-semibold text-gray-700 mb-3">Data Management</h4>
                            <div class="space-y-4">
                                <button onclick="exportData()" class="w-full py-2 px-4 bg-green-600 text-white rounded-md hover:bg-green-700 transition-colors">
                                    <i class="fas fa-download mr-2"></i>Export Data
                                </button>
                                <button onclick="importData()" class="w-full py-2 px-4 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors">
                                    <i class="fas fa-upload mr-2"></i>Import Data
                                </button>
                                <button onclick="clearAllData()" class="w-full py-2 px-4 bg-red-600 text-white rounded-md hover:bg-red-700 transition-colors">
                                    <i class="fas fa-trash mr-2"></i>Clear All Data
                                </button>
                            </div>
                        </div>
                        <div class="bg-white p-4 rounded-lg border">
                            <h4 class="font-semibold text-gray-700 mb-3">Hardware &amp; Printing</h4>
                            <div class="space-y-3">
                                <div>
                                    <h5 class="font-medium text-gray-700 mb-2">Printer</h5>
                                    <div class="flex items-center gap-2 flex-wrap">
                                        <select id="printerSelect" class="px-3 py-2 border border-gray-300 rounded-md bg-white text-sm"></select>
                                        <button class="btn-secondary px-3 py-2 rounded" onclick="refreshPrinters()">Refresh</button>
                                        <button class="btn-primary px-3 py-2 rounded" onclick="saveSelectedPrinter()">Save as Default</button>
                                        <span id="printerStatusDot" class="inline-flex items-center text-xs ml-2"></span>
                                    </div>
                                    <div class="mt-2 flex items-center gap-2">
                                        <button class="btn-secondary px-3 py-2 rounded" onclick="testPrint()">Test Print</button>
                                        <span id="lastTestPrintResult" class="text-xs text-gray-600"></span>
                                    </div>
                                </div>
                                <div class="my-2 border-t border-gray-200"></div>
                                <div class="space-y-3">
                                    <div class="grid gap-3 md:grid-cols-2">
                                        <div class="bg-gray-50 rounded-lg p-3 border border-gray-200">
                                            <p class="text-xs font-semibold text-gray-600 uppercase tracking-wide">Kitchen Tickets</p>
                                            <div class="flex items-center gap-2 mt-2">
                                                <span class="text-sm">Copies per order</span>
                                                <input type="number" id="kitchenCopiesInput" min="1" max="10" step="1" class="px-2 py-1 border border-gray-300 rounded w-20 text-sm" />
                                            </div>
                                            <label class="inline-flex items-center gap-2 text-sm mt-2">
                                                <input type="checkbox" id="cutAfterKitchenToggle" class="h-4 w-4">
                                                <span>Cut after kitchen tickets</span>
                                            </label>
                                        </div>
                                        <div class="bg-gray-50 rounded-lg p-3 border border-gray-200">
                                            <p class="text-xs font-semibold text-gray-600 uppercase tracking-wide">Customer Receipts</p>
                                            <div class="flex items-center gap-2 mt-2">
                                                <span class="text-sm">Copies per receipt</span>
                                                <input type="number" id="customerCopiesInput" min="1" max="10" step="1" class="px-2 py-1 border border-gray-300 rounded w-20 text-sm" />
                                            </div>
                                            <label class="inline-flex items-center gap-2 text-sm mt-2">
                                                <input type="checkbox" id="cutAfterCustomerToggle" class="h-4 w-4">
                                                <span>Cut after customer receipts</span>
                                            </label>
                                        </div>
                                    </div>
                                    <div id="tableReceiptSettings" class="bg-gray-50 rounded-lg p-3 border border-gray-200 hidden">
                                        <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                                            <div>
                                                <p class="text-xs font-semibold text-gray-600 uppercase tracking-wide">Table Receipts</p>
                                                <p class="text-xs text-gray-500">Visible when Table Management is enabled</p>
                                            </div>
                                            <div class="flex flex-wrap gap-3 items-center">
                                                <label class="inline-flex items-center gap-2 text-sm">
                                                    <span>Copies</span>
                                                    <input type="number" id="tableCopiesInput" min="1" max="10" step="1" class="px-2 py-1 border border-gray-300 rounded w-20 text-sm" />
                                                </label>
                                                <label class="inline-flex items-center gap-2 text-sm">
                                                    <input type="checkbox" id="cutAfterTableToggle" class="h-4 w-4">
                                                    <span>Cut after table receipts</span>
                                                </label>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </div>

    <!-- Item Form Modal -->
    <div id="itemFormModal" class="fixed inset-0 bg-black bg-opacity-50 z-[80] hidden items-center justify-center p-4">
        <div class="bg-white rounded-lg shadow-xl p-6 w-full max-w-md text-gray-800">
            <h3 class="text-xl font-semibold mb-4">Add/Edit Item</h3>
            <form id="itemForm">
                <div class="space-y-4">
                    <div>
                        <label for="itemName" class="block text-sm font-medium text-gray-700">Item Name</label>
                        <input type="text" id="itemName" name="itemName" class="mt-1 block w-full px-3 py-2 border border-gray-400 rounded-md shadow-sm sm:text-sm" required>
                    </div>
                    <div>
                        <label for="itemCategory" class="block text-sm font-medium text-gray-700">Category</label>
                        <select id="itemCategory" name="itemCategory" class="mt-1 block w-full px-3 py-2 border border-gray-400 rounded-md shadow-sm sm:text-sm" required>
                            <option value="">Select Category</option>
                        </select>
                    </div>
                    <div>
                        <label for="itemPrice" class="block text-sm font-medium text-gray-700">Base Price (€)</label>
                        <input type="number" step="0.01" id="itemPrice" name="itemPrice" inputmode="decimal" class="mt-1 block w-full px-3 py-2 border border-gray-400 rounded-md shadow-sm sm:text-sm" required>
                    </div>
                    <div>
                        <label for="itemStock" class="block text-sm font-medium text-gray-700">Stock Quantity</label>
                        <input type="number" id="itemStock" name="itemStock" class="mt-1 block w-full px-3 py-2 border border-gray-400 rounded-md shadow-sm sm:text-sm" required>
                    </div>
                    <div class="flex gap-3">
                        <button type="submit" class="flex-1 py-2 px-4 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors">Save</button>
                        <button type="button" onclick="closeItemFormModal()" class="w-full py-2 px-4 btn-secondary">Cancel</button>
                    </div>
                </div>
            </form>
        </div>
    </div>

    <!-- Category Form Modal -->
    <div id="categoryFormModal" class="fixed inset-0 bg-black bg-opacity-50 z-[80] hidden items-center justify-center p-4">
        <div class="bg-white rounded-lg shadow-xl p-6 w-full max-w-md text-gray-800">
            <h3 class="text-xl font-semibold mb-4">Add/Edit Category</h3>
            <form id="categoryForm">
                <div class="space-y-4">
                    <div>
                        <label for="categoryName" class="block text-sm font-medium text-gray-700">Category Name</label>
                        <input type="text" id="categoryName" name="categoryName" class="mt-1 block w-full px-3 py-2 border border-gray-400 rounded-md shadow-sm sm:text-sm" required>
                    </div>
                    <div>
                        <label for="categoryColor" class="block text-sm font-medium text-gray-700">Color</label>
                        <input type="color" id="categoryColor" name="categoryColor" class="mt-1 block w-full px-3 py-2 border border-gray-400 rounded-md shadow-sm sm:text-sm" value="#3B82F6">
                    </div>
                    <div class="flex gap-3">
                        <button type="submit" class="flex-1 py-2 px-4 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors">Save</button>
                        <button type="button" onclick="closeCategoryFormModal()" class="w-full py-2 px-4 btn-secondary">Cancel</button>
                    </div>
                </div>
            </form>
        </div>
    </div>
    `;
}

export function injectManagementComponent() {
    // Expose to global for non-module consumers
    if (typeof window !== 'undefined') {
        window.injectManagementComponent = injectManagementComponent;
        window.getManagementComponentHTML = getManagementComponentHTML;
    }
    const html = getManagementComponentHTML();
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = html;
    
    // Append all child nodes to the body
    while (tempDiv.firstChild) {
        document.body.appendChild(tempDiv.firstChild);
    }
    
    console.log('Management component injected successfully');
    return true;
} 
