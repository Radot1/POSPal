// --- Global State & Configuration ---
let menu = {};
let selectedCategory = null;
let editingItem = null;

// --- Printer Session State ---
let printerVerificationStatus = 'unknown'; // 'unknown', 'verified', 'failed'

// --- Constants ---
const SELECTED_TABLE_KEY = 'pospal_selected_table';
const UNIVERSAL_COMMENT_KEY = 'pospal_universal_comment';

// --- NEW: Centralized State Management ---
// Generate unique device ID for this session
const DEVICE_ID = 'device_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
let currentOrder = [];
let currentOrderLineItemCounter = 0;
let orderNumber = 1;
let universalOrderComment = "";
let selectedTableNumber = "";
let isPaidByCard = false;

// --- State for Mobile UI (POSPal) ---
let isMobileOrderPanelOpen = false;
let itemForNumpad = null;
let numpadCurrentInput = "";

// --- State for Option Selection ---
let itemBeingConfigured = null;
let currentOptionSelectionStep = null;

// --- State for Desktop UI ---
let selectedItemId_desktop = null;
let numpadInput_desktop = "";

// --- NEW: Centralized State Management Functions ---
async function loadCentralizedState() {
    try {
        const response = await fetch(`/api/state?device_id=${DEVICE_ID}`);
        const data = await response.json();
        
        if (data.success) {
            currentOrder = data.state.current_order || [];
            currentOrderLineItemCounter = data.state.order_line_counter || 0;
            universalOrderComment = data.state.universal_comment || "";
            selectedTableNumber = data.state.selected_table || "";
            
            console.log('Centralized state loaded:', data.state);
            return true;
        } else {
            console.error('Failed to load centralized state:', data.message);
            return false;
        }
    } catch (error) {
        console.error('Error loading centralized state:', error);
        return false;
    }
}

async function saveCentralizedState(stateKey, value) {
    try {
        const response = await fetch(`/api/state/${stateKey}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ [stateKey]: value })
        });
        
        const data = await response.json();
        if (data.success) {
            console.log(`Centralized state saved: ${stateKey} =`, value);
            return true;
        } else {
            console.error(`Failed to save centralized state ${stateKey}:`, data.message);
            return false;
        }
    } catch (error) {
        console.error(`Error saving centralized state ${stateKey}:`, error);
        return false;
    }
}

async function updateCurrentOrder() {
    return await saveCentralizedState('current_order', currentOrder);
}

async function updateOrderLineCounter() {
    return await saveCentralizedState('order_line_counter', currentOrderLineItemCounter);
}

async function updateUniversalComment() {
    return await saveCentralizedState('universal_comment', universalOrderComment);
}

async function updateSelectedTable() {
    return await saveCentralizedState('selected_table', selectedTableNumber);
}

async function clearCentralizedOrder() {
    try {
        const response = await fetch('/api/state/clear_order', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            }
        });
        
        const data = await response.json();
        if (data.success) {
            currentOrder = [];
            currentOrderLineItemCounter = 0;
            console.log('Centralized order cleared');
            return true;
        } else {
            console.error('Failed to clear centralized order:', data.message);
            return false;
        }
    } catch (error) {
        console.error('Error clearing centralized order:', error);
        return false;
    }
}

// --- Shared Management Component Loading ---
// Management modals are now included directly in HTML files
function loadManagementComponent() {
    console.log('Management component is included directly in HTML');
    return true;
}

// --- DOM Element Cache ---
const elements = {};

// --- Initialization ---
document.addEventListener('DOMContentLoaded', async () => {
    console.log('DOM Content Loaded - Starting initialization...');
    
    // Load centralized state first
    console.log('Loading centralized state...');
    const stateLoaded = await loadCentralizedState();
    console.log('Centralized state loaded:', stateLoaded);
    
    // Management component is included directly in HTML
    const componentLoaded = loadManagementComponent();
    console.log('Management component loaded:', componentLoaded);
    
    // Cache DOM elements after component is loaded
    console.log('Caching DOM elements...');
    cacheDOMElements();
    console.log('DOM elements cached. Checking critical elements:');
    console.log('categoriesContainer:', elements.categoriesContainer);
    console.log('productsContainer:', elements.productsContainer);
    console.log('Is desktop-ui class present:', document.body.classList.contains('desktop-ui'));
    
    // Re-cache modal elements specifically to ensure they're found
    if (componentLoaded) {
        console.log('Re-caching modal elements...');
        // Re-cache all login modal elements
        elements.loginModal = document.getElementById('loginModal');
        elements.loginForm = document.getElementById('loginForm');
        elements.passwordInput = document.getElementById('passwordInput');
        elements.loginError = document.getElementById('loginError');
        elements.loginSubmitBtn = document.getElementById('loginSubmitBtn');
        
        // Re-cache all management modal elements
        elements.managementModal = document.getElementById('managementModal');
        elements.itemFormModal = document.getElementById('itemFormModal');
        elements.itemFormModalTitle = document.getElementById('itemFormModalTitle');
        elements.daySummaryModal = document.getElementById('daySummaryModal');
        elements.daySummaryContent = document.getElementById('daySummaryContent');
        elements.itemOptionSelectModal = document.getElementById('itemOptionSelectModal');
        elements.optionModalItemName = document.getElementById('optionModalItemName');
        elements.optionModalItemDescription = document.getElementById('optionModalItemDescription');
        elements.optionModalOptionsContainer = document.getElementById('optionModalOptionsContainer');
        elements.confirmOptionBtn = document.getElementById('confirmOptionBtn');
        elements.itemNameInput = document.getElementById('itemName');
        elements.itemPriceInput = document.getElementById('itemPrice');
        elements.itemCategorySelect = document.getElementById('itemCategory');
        elements.itemIdInput = document.getElementById('itemId');
        elements.saveItemBtn = document.getElementById('saveItemBtn');
        elements.existingItemsListModal = document.getElementById('existingItemsListModal');
        elements.itemHasOptionsCheckboxModal = document.getElementById('itemHasOptionsModal');
        elements.itemOptionsModalContainer = document.getElementById('itemOptionsModalContainer');
        elements.itemOptionsListDisplayModal = document.getElementById('itemOptionsListDisplayModal');
        elements.newOptionNameInputModal = document.getElementById('newOptionNameInputModal');
        elements.newOptionPriceInputModal = document.getElementById('newOptionPriceInputModal');
        elements.categoryNameInput = document.getElementById('categoryName');
        elements.existingCategoriesListModal = document.getElementById('existingCategoriesListModal');
        elements.licenseStatusDisplay = document.getElementById('license-status-display');
        elements.hardwareIdDisplay = document.getElementById('hardware-id-display');
        elements.copyHwidBtn = document.getElementById('copy-hwid-btn');
        elements.footerTrialStatus = document.getElementById('footer-trial-status');
        // Language selector
        const languageSelect = document.getElementById('languageSelect');
        if (languageSelect) {
            try {
                const res = await fetch('/api/settings/general');
                if (res.ok) {
                    const data = await res.json();
                    const lang = (data && (data.language === 'el' || data.language === 'en')) ? data.language : 'en';
                    languageSelect.value = lang;
                }
            } catch {}
            languageSelect.addEventListener('change', async (e) => {
                const val = e.target.value;
                await setLanguage(val);
            });
        }
        
        // Add event listener for login form after re-caching
        if (elements.loginForm) {
            elements.loginForm.addEventListener('submit', handleLogin);
        }
    }
    
    console.log('Initializing app state...');
    initializeAppState();
    console.log('Loading menu...');
    await loadMenu();
    console.log('Menu loaded. Current state:');
    console.log('menu:', menu);
    console.log('selectedCategory:', selectedCategory);
    console.log('Starting clock...');
    startClock();
    console.log('Checking trial status...');
    checkAndDisplayTrialStatus();
    if (elements.universalOrderCommentInput) {
        elements.universalOrderCommentInput.addEventListener('input', async (e) => {
            universalOrderComment = e.target.value;
            await updateUniversalComment();
        });
    }
    if (elements.paidByCardCheckbox) {
        elements.paidByCardCheckbox.addEventListener('change', (e) => {
            isPaidByCard = e.target.checked;
        });
    }
    if (elements.headerTableInput) {
        elements.headerTableInput.addEventListener('change', handleTableNumberChange);
        elements.headerTableInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                handleTableNumberChange(e);
                e.target.blur();
            }
        });
    }
    if(document.getElementById('universalOrderCommentInput_desktop')) {
         document.getElementById('universalOrderCommentInput_desktop').addEventListener('input', async (e) => {
            universalOrderComment = e.target.value;
            await updateUniversalComment();
        });
    }
    console.log('Updating order display...');
    updateOrderDisplay();
    console.log('Initialization complete!');
});


function cacheDOMElements() {
    console.log('cacheDOMElements called');
    
    // --- POSPal UI Elements ---
    elements.headerOrderNumber = document.getElementById('header-order-number');
    elements.headerTableInput = document.getElementById('header-table-input');
    elements.headerTableContainer = document.getElementById('header-table-container');
    elements.realtimeClock = document.getElementById('realtime-clock');
    elements.mobileOrderToggle = document.getElementById('mobile-order-toggle');
    elements.mobileOrderCountBadge = document.getElementById('mobile-order-count-badge');
    elements.orderPanel = document.getElementById('order-panel');
    elements.orderPanelBackdrop = document.getElementById('order-panel-backdrop');
    elements.numpadContainer = document.getElementById('numpad-container');
    elements.numpadItemNameDisplay = document.getElementById('numpad-item-name');
    elements.paidByCardCheckbox = document.getElementById('paidByCardCheckbox');

    // --- Desktop UI Elements ---
    elements.orderNumber_desktop = document.getElementById('order-number-desktop');

    // --- Universal/Shared Elements (must have same IDs in both HTML files) ---
    elements.categoriesContainer = document.getElementById('categories');
    elements.productsContainer = document.getElementById('products');
    elements.orderItemsContainer = document.getElementById('order-items-container');
    elements.emptyOrderMessage = document.getElementById('empty-order-message');
    elements.orderTotalDisplay = document.getElementById('order-total');
    elements.universalOrderCommentInput = document.getElementById('universalOrderCommentInput');
    elements.sendOrderBtn = document.getElementById('sendOrderBtn');
    elements.settingsGearContainer = document.getElementById('settings-gear-container');
    elements.toast = document.getElementById('toast');
    elements.toastMessage = document.getElementById('toast-message');
    elements.todaysOrdersList = document.getElementById('todaysOrdersList');
    elements.appVersionContainer = document.getElementById('appVersionContainer');
    elements.appVersion = document.getElementById('appVersion');

    // --- Modals (must have same structure and IDs in both HTML files) ---
    elements.loginModal = document.getElementById('loginModal');
    elements.loginForm = document.getElementById('loginForm');
    elements.passwordInput = document.getElementById('passwordInput');
    elements.loginError = document.getElementById('loginError');
    elements.loginSubmitBtn = document.getElementById('loginSubmitBtn');
    

    elements.managementModal = document.getElementById('managementModal');
    elements.itemFormModal = document.getElementById('itemFormModal');
    elements.itemFormModalTitle = document.getElementById('itemFormModalTitle');
    elements.daySummaryModal = document.getElementById('daySummaryModal');
    elements.daySummaryContent = document.getElementById('daySummaryContent');
    elements.itemOptionSelectModal = document.getElementById('itemOptionSelectModal');
    elements.optionModalItemName = document.getElementById('optionModalItemName');
    elements.optionModalItemDescription = document.getElementById('optionModalItemDescription');
    elements.optionModalOptionsContainer = document.getElementById('optionModalOptionsContainer');
    elements.confirmOptionBtn = document.getElementById('confirmOptionBtn');
    elements.itemNameInput = document.getElementById('itemName');
    elements.itemPriceInput = document.getElementById('itemPrice');
    elements.itemCategorySelect = document.getElementById('itemCategory');
    elements.itemIdInput = document.getElementById('itemId');
    elements.saveItemBtn = document.getElementById('saveItemBtn');
    elements.existingItemsListModal = document.getElementById('existingItemsListModal');
    elements.itemHasOptionsCheckboxModal = document.getElementById('itemHasOptionsModal');
    elements.itemOptionsModalContainer = document.getElementById('itemOptionsModalContainer');
    elements.itemOptionsListDisplayModal = document.getElementById('itemOptionsListDisplayModal');
    elements.newOptionNameInputModal = document.getElementById('newOptionNameInputModal');
    elements.newOptionPriceInputModal = document.getElementById('newOptionPriceInputModal');
    elements.categoryNameInput = document.getElementById('categoryName');
    elements.existingCategoriesListModal = document.getElementById('existingCategoriesListModal');
    elements.licenseStatusDisplay = document.getElementById('license-status-display');
    elements.hardwareIdDisplay = document.getElementById('hardware-id-display');
    elements.copyHwidBtn = document.getElementById('copy-hwid-btn');
    elements.footerTrialStatus = document.getElementById('footer-trial-status');
    
    console.log('Critical elements found:');
    console.log('categoriesContainer:', elements.categoriesContainer);
    console.log('productsContainer:', elements.productsContainer);
    console.log('orderItemsContainer:', elements.orderItemsContainer);
}

function startClock() {
    if (!elements.realtimeClock) return;
    const update = () => {
        elements.realtimeClock.textContent = new Date().toLocaleTimeString('en-GB', {
            hour: '2-digit',
            minute: '2-digit'
        });
    };
    update();
    setInterval(update, 1000 * 60);
}

async function fetchAndUpdateOrderNumber() {
    try {
        const response = await fetch('/api/order_status');
        if (!response.ok) throw new Error(`Server responded with status ${response.status}`);
        const data = await response.json();
        if (data && typeof data.next_order_number !== 'undefined') {
            orderNumber = data.next_order_number;
            // Update UI based on which element is present
            if (elements.headerOrderNumber) elements.headerOrderNumber.textContent = orderNumber;
            if (elements.orderNumber_desktop) elements.orderNumber_desktop.textContent = orderNumber;
        }
    } catch (error) {
        console.error("Could not fetch next order number:", error);
        if (elements.headerOrderNumber) elements.headerOrderNumber.textContent = "Err";
        if (elements.orderNumber_desktop) elements.orderNumber_desktop.textContent = "Err";
        showToast("Could not sync order number with server.", "error");
    }
}

async function autoVerifyPrinter() {
    console.log('Auto-verifying printer on startup...');
    try {
        // First check if we have a printer configured and if it's accessible
        const response = await fetch('/api/printers');
        const data = await response.json();
        
        if (!data.selected) {
            console.log('No printer selected, skipping auto-verification');
            printerVerificationStatus = 'failed';
            return;
        }

        // Check printer status
        const statusResp = await fetch(`/api/printer/status?name=${encodeURIComponent(data.selected)}`);
        const statusInfo = await statusResp.json();
        
        // If printer has error or is not accessible, skip auto-test
        if (statusInfo.error || (typeof statusInfo.status_code === 'number' && statusInfo.status_code !== 0)) {
            console.log('Printer not ready for auto-verification:', statusInfo);
            printerVerificationStatus = 'failed';
            return;
        }

        // Perform silent test print
        const testResp = await fetch('/api/printer/test', { method: 'POST' });
        const testResult = await testResp.json();
        
        if (testResult.success) {
            printerVerificationStatus = 'verified';
            console.log('Printer auto-verification successful');
            
            // Update the UI status dot if it exists (for settings page)
            const dot = document.getElementById('printerStatusDot');
            if (dot) {
                dot.innerHTML = `<span style="display:inline-flex;align-items:center;gap:6px"><span style="width:10px;height:10px;border-radius:9999px;background:#16a34a"></span><span>Ready</span></span>`;
            }
        } else {
            printerVerificationStatus = 'failed';
            console.log('Printer auto-verification failed:', testResult.message);
        }
    } catch (error) {
        printerVerificationStatus = 'failed';
        console.log('Error during printer auto-verification:', error);
    }
}

function initializeAppState() {
    console.log('initializeAppState called');
    fetchAndUpdateOrderNumber();
    selectedTableNumber = localStorage.getItem(SELECTED_TABLE_KEY) || "";
    console.log('Selected table number:', selectedTableNumber);
    if (elements.headerTableInput) {
        elements.headerTableInput.value = selectedTableNumber;
        console.log('Set header table input value');
    } else {
        console.log('headerTableInput not found');
    }
    const savedComment = localStorage.getItem(UNIVERSAL_COMMENT_KEY) || "";
    console.log('Saved comment:', savedComment);
    if (elements.universalOrderCommentInput) {
        elements.universalOrderCommentInput.value = savedComment;
        console.log('Set universal order comment input value');
    } else {
        console.log('universalOrderCommentInput not found');
    }
    const desktopCommentInput = document.getElementById('universalOrderCommentInput_desktop');
     if (desktopCommentInput) {
        desktopCommentInput.value = savedComment;
        console.log('Set desktop comment input value');
    } else {
        console.log('universalOrderCommentInput_desktop not found');
    }
    
    // Auto-verify printer on startup
    autoVerifyPrinter();
    
    console.log('initializeAppState completed');
}


async function loadMenu() {
    console.log('loadMenu called');
    try {
        const response = await fetch('/api/menu');
        console.log('API response status:', response.status);
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        menu = await response.json() || {};
        console.log('Menu loaded:', menu);

        if (Object.keys(menu).length > 0 && (!selectedCategory || !menu[selectedCategory])) {
            selectedCategory = Object.keys(menu)[0];
        } else if (Object.keys(menu).length === 0) {
            selectedCategory = null;
        }
        renderCategories();
        populateManagementCategorySelect();
        // Ensure products are rendered for the initial category
        if (selectedCategory) {
            renderProductsForSelectedCategory();
        }
    } catch (error) {
        console.warn('API unavailable – menu data not loaded');
        console.log('Error details:', error);
        menu = {};
        selectedCategory = null;
        renderCategories();
        populateManagementCategorySelect();
    }
}

async function saveMenuToServer() {
    try {
        const response = await fetch('/api/menu', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(menu)
        });
        if (!response.ok) {
            const errorData = await response.json().catch(() => ({
                message: `HTTP ${response.status} - ${response.statusText}`
            }));
            throw new Error(`Failed to save menu: ${errorData.message}`);
        }
        return true;
    } catch (error) {
        showToast(error.message, 'error');
        console.error("Save menu error:", error);
        return false;
    }
}

function renderCategories() {
    console.log('renderCategories called');
    console.log('categoriesContainer:', elements.categoriesContainer);
    if (!elements.categoriesContainer) {
        console.error('categoriesContainer not found');
        return;
    }
    elements.categoriesContainer.innerHTML = '';

    console.log('Menu keys:', Object.keys(menu));
    if (Object.keys(menu).length === 0) {
        console.log('No categories in menu');
        elements.categoriesContainer.innerHTML = '<p class="text-gray-500 italic">No categories defined.</p>';
        if (elements.productsContainer) {
            elements.productsContainer.innerHTML = '<p class="text-gray-600 italic col-span-full text-center py-8">Please add categories and items in Management.</p>';
        }
        return;
    }

    // Detect which UI is active by checking for a unique element
    const isDesktopUI = document.body.classList.contains('desktop-ui');

    if (isDesktopUI) {
        // Render tabs for Desktop UI
        Object.keys(menu).forEach(category => {
            const btn = document.createElement('button');
            btn.className = `category-tab ${category === selectedCategory ? 'active' : ''}`;
            btn.textContent = category;
            btn.onclick = () => {
                selectedCategory = category;
                // Update active state of all tabs
                elements.categoriesContainer.querySelectorAll('.category-tab').forEach(tab => {
                    tab.classList.remove('active');
                });
                btn.classList.add('active');
                // Render products for the selected category
                renderProductsForSelectedCategory();
            };
            elements.categoriesContainer.appendChild(btn);
        });
    } else {
        // Render dropdown for POSPal UI
        const selectEl = document.createElement('select');
        selectEl.className = 'w-full p-2.5 border border-gray-400 rounded-md shadow-sm bg-white text-sm';
        selectEl.id = 'categorySelectorDropdown';

        Object.keys(menu).forEach(category => {
            const option = document.createElement('option');
            option.value = category;
            option.textContent = category;
            if (category === selectedCategory) {
                option.selected = true;
            }
            selectEl.appendChild(option);
        });

        selectEl.onchange = (event) => {
            selectedCategory = event.target.value;
            renderProductsForSelectedCategory();
        };
        elements.categoriesContainer.appendChild(selectEl);
    }
    
    // Initial render of products
    if (selectedCategory) {
        renderProductsForSelectedCategory();
    }
}


function renderProductsForSelectedCategory() {
    console.log('renderProductsForSelectedCategory called');
    console.log('selectedCategory:', selectedCategory);
    console.log('menu:', menu);
    console.log('elements.productsContainer:', elements.productsContainer);
    
    if (!elements.productsContainer) {
        console.error('productsContainer not found');
        return;
    }
    elements.productsContainer.innerHTML = '';
    if (!selectedCategory || !menu[selectedCategory] || menu[selectedCategory].length === 0) {
        console.log('No items in category:', selectedCategory);
        elements.productsContainer.innerHTML = `<p class="text-gray-600 italic col-span-full text-center py-8">No items in "${selectedCategory || 'this'}" category.</p>`;
        return;
    }

    const isDesktopUI = document.body.classList.contains('desktop-ui');
    console.log('Rendering products for category:', selectedCategory);
    console.log('Items in category:', menu[selectedCategory]);
    console.log('Is Desktop UI:', isDesktopUI);

    menu[selectedCategory].forEach(item => {
        const card = document.createElement('div');
        card.onclick = () => addToOrder(item.id);

        if (isDesktopUI) {
            // Desktop card rendering (parity with mobile)
            card.className = 'product-card bg-white rounded-lg shadow hover:shadow-md transition-shadow overflow-hidden flex flex-col cursor-pointer border border-gray-200 h-full';
            const hasGenOptions = item.hasGeneralOptions && item.generalOptions && item.generalOptions.length > 0;
            const badgeIconsHTML = hasGenOptions ? `
                    <div class="absolute bottom-2 right-2 flex flex-col space-y-1">
                        <span class="options-badge inline-flex items-center justify-center p-1 w-6 h-6 rounded"><i class="fas fa-cogs text-sm"></i></span>
                    </div>
                ` : '';
            card.innerHTML = `
                <div class="relative p-3 flex-grow flex flex-col h-full">
                    <div class="flex-grow flex flex-col pr-8">
                        <div class="flex-grow">
                            <h3 class="text-sm font-semibold text-gray-800 mb-1">${item.name}</h3>
                        </div>
                        <div class="mt-auto">
                           <p class="text-lg font-bold text-black">€${(item.price || 0).toFixed(2)}</p>
                        </div>
                    </div>
                    ${badgeIconsHTML}
                </div>
            `;
        } else {
            // POSPal card rendering
            card.className = 'product-card bg-white rounded-lg shadow hover:shadow-md transition-shadow overflow-hidden flex flex-col cursor-pointer border border-gray-200';
            let badgeIconsHTML = '';
            const hasGenOptions = item.hasGeneralOptions && item.generalOptions && item.generalOptions.length > 0;

            if (hasGenOptions) {
                badgeIconsHTML = `
                    <div class="absolute bottom-2 right-2 flex flex-col space-y-1">
                        <span class="options-badge inline-flex items-center justify-center p-1 w-6 h-6 rounded"><i class="fas fa-cogs text-sm"></i></span>
                    </div>
                `;
            }
            card.innerHTML = `
                <div class="relative p-3 flex-grow flex flex-col h-full">
                    <div class="flex-grow flex flex-col pr-8">
                        <div class="flex-grow">
                            <h3 class="text-sm font-semibold text-gray-800 mb-1">${item.name}</h3>
                        </div>
                        <div class="mt-auto">
                           <p class="text-lg font-bold text-black">€${(item.price || 0).toFixed(2)}</p>
                        </div>
                    </div>
                    ${badgeIconsHTML}
                </div>
            `;
        }
        console.log('Created card for item:', item.name);
        elements.productsContainer.appendChild(card);
    });
    console.log('Finished rendering products');
}

async function addToOrder(itemId) {
    let menuItem;
    for (const categoryKey in menu) {
        const found = (menu[categoryKey] || []).find(i => i.id === itemId);
        if (found) {
            menuItem = found;
            break;
        }
    }

    if (!menuItem) {
        console.error("Menu item not found for ID:", itemId);
        showToast("Error: Item not found.", 'error');
        return;
    }

    itemBeingConfigured = { ...menuItem };
    currentOptionSelectionStep = null;

    const hasGenOpts = (itemBeingConfigured.hasGeneralOptions && itemBeingConfigured.generalOptions && Array.isArray(itemBeingConfigured.generalOptions) && itemBeingConfigured.generalOptions.length > 0);

    if (hasGenOpts) {
        currentOptionSelectionStep = 'general';
        openItemOptionSelectModal(itemBeingConfigured, 'general_item_option');
    } else {
        await finalizeAndAddOrderItem(itemBeingConfigured, []);
        resetMultiStepSelection();
    }
}

async function finalizeAndAddOrderItem(baseItem, generalChoicesWithOptions) {
    currentOrderLineItemCounter++;
    await updateOrderLineCounter();

    let uniqueSuffixParts = [];
    if (generalChoicesWithOptions && generalChoicesWithOptions.length > 0) {
        uniqueSuffixParts.push(...generalChoicesWithOptions.map(opt => opt.name.replace(/\s+/g, '_')));
    }

    const uniqueLineIdSuffix = uniqueSuffixParts.length > 0 ? uniqueSuffixParts.join('-') : 'noopts';
    const uniqueLineId = `${baseItem.id}-${uniqueLineIdSuffix}-line-${currentOrderLineItemCounter}`;

    let itemPriceWithModifiers = parseFloat(baseItem.price || 0);
    if (generalChoicesWithOptions && generalChoicesWithOptions.length > 0) {
        generalChoicesWithOptions.forEach(opt => {
            itemPriceWithModifiers += parseFloat(opt.priceChange || 0);
        });
    }

    const orderItem = {
        ...baseItem,
        quantity: 1,
        comment: "",
        orderId: uniqueLineId,
        generalSelectedOptions: generalChoicesWithOptions || [],
        itemPriceWithModifiers: itemPriceWithModifiers
    };
    currentOrder.push(orderItem);
    updateOrderDisplay();
}

function resetMultiStepSelection() {
    itemBeingConfigured = null;
    currentOptionSelectionStep = null;
}

function updateOrderDisplay() {
    if (!elements.orderItemsContainer) return;
    elements.orderItemsContainer.innerHTML = '';
    let total = 0;

    const isDesktopUI = document.body.classList.contains('desktop-ui');

    if (currentOrder.length === 0) {
        if (elements.emptyOrderMessage) elements.emptyOrderMessage.style.display = 'block';
    } else {
        if (elements.emptyOrderMessage) elements.emptyOrderMessage.style.display = 'none';
        currentOrder.forEach(item => {
            const pricePerUnit = typeof item.itemPriceWithModifiers === 'number' ? item.itemPriceWithModifiers : parseFloat(item.price || 0);
            const itemTotal = pricePerUnit * item.quantity;
            total += itemTotal;

            const div = document.createElement('div');
            let optionDisplayHTML = '';
            let commentText = item.comment ? `<span class="block text-xs text-gray-600 ml-4 break-all"><em>Note: ${item.comment}</em></span>` : '';
            
            if (isDesktopUI) {
                 // Desktop order item rendering
                div.className = `order-item p-2 border border-gray-200 rounded ${item.orderId === selectedItemId_desktop ? 'selected-for-numpad bg-blue-50 border-blue-300' : 'bg-white hover:bg-gray-50'} cursor-pointer transition-colors`;
                div.onclick = () => selectItemByOrderId_desktop(item.orderId);

                if (item.generalSelectedOptions && item.generalSelectedOptions.length > 0) {
                    item.generalSelectedOptions.forEach(opt => {
                        const priceChangeDisplay = parseFloat(opt.priceChange || 0) !== 0 ? ` (${parseFloat(opt.priceChange || 0) > 0 ? '+' : ''}€${parseFloat(opt.priceChange || 0).toFixed(2)})` : '';
                        optionDisplayHTML += `<div style="font-size: 0.8em; color: #777; margin-left: 10px;">↳ ${opt.name}${priceChangeDisplay}</div>`;
                    });
                }
                 commentText = item.comment ? `<div style="font-size: 0.8em; color: #555; margin-left: 10px;"><em>Note: ${item.comment}</em></div>` : '';

                div.innerHTML = `
                    <div class="flex justify-between items-start">
                        <div class="flex-1">
                            <div class="flex items-center space-x-2">
                                <span class="font-semibold text-gray-800">${item.quantity}x ${item.name}</span>
                            </div>
                            ${optionDisplayHTML}
                            ${commentText}
                        </div>
                        <div class="flex flex-col items-end">
                            <span class="font-bold text-gray-900 mb-1">€${itemTotal.toFixed(2)}</span>
                            <div class="flex items-center space-x-1">
                                <button onclick="event.stopPropagation(); decrementQuantity('${item.orderId}')" class="p-1 text-gray-500 hover:text-red-600 transition-colors" title="Decrease Quantity">
                                    <i class="fas fa-minus-circle text-sm"></i>
                                </button>
                                <span class="font-semibold text-gray-800 w-8 text-center">${item.quantity}</span>
                                <button onclick="event.stopPropagation(); incrementQuantity('${item.orderId}')" class="p-1 text-gray-500 hover:text-green-600 transition-colors" title="Increase Quantity">
                                    <i class="fas fa-plus-circle text-sm"></i>
                                </button>
                                <button onclick="event.stopPropagation(); promptForItemComment('${item.orderId}')" class="p-1 text-gray-500 hover:text-blue-600 transition-colors" title="Add Note">
                                    <i class="fas fa-comment-dots text-sm"></i>
                                </button>
                                <button onclick="event.stopPropagation(); removeItemByOrderId('${item.orderId}')" class="p-1 text-red-500 hover:text-red-700 transition-colors" title="Remove Item">
                                    <i class="fas fa-trash-alt text-sm"></i>
                                </button>
                            </div>
                        </div>
                    </div>
                `;

            } else {
                // POSPal order item rendering
                div.className = `order-item p-2 border-b border-gray-200 flex items-center justify-between text-sm ${item.orderId === itemForNumpad?.orderId ? 'selected-for-numpad' : ''}`;
                if (item.generalSelectedOptions && item.generalSelectedOptions.length > 0) {
                    item.generalSelectedOptions.forEach(opt => {
                        const priceChangeDisplay = parseFloat(opt.priceChange || 0) !== 0 ? ` (${parseFloat(opt.priceChange || 0) > 0 ? '+' : ''}€${parseFloat(opt.priceChange || 0).toFixed(2)})` : '';
                        optionDisplayHTML += `<span class="block text-xs text-gray-600 ml-4">↳ ${opt.name}${priceChangeDisplay}</span>`;
                    });
                }

                div.innerHTML = `
                    <div class="flex-grow pr-2">
                        <span class="font-medium text-gray-800">${item.name}</span>
                        <span class="text-xs text-gray-500 ml-1">(Base: €${parseFloat(item.price || 0).toFixed(2)})</span>
                        ${optionDisplayHTML}
                        ${commentText}
                    </div>
                    <div class="flex flex-col items-end space-y-1 flex-shrink-0">
                         <span class="font-semibold text-gray-800">€${pricePerUnit.toFixed(2)} x ${item.quantity} = €${itemTotal.toFixed(2)}</span>
                        <div class="flex items-center space-x-1">
                            <button onclick="decrementQuantity('${item.orderId}')" class="p-1 text-gray-500 hover:text-red-600"><i class="fas fa-minus-circle"></i></button>
                            <span class="font-semibold text-gray-800 w-6 text-center cursor-pointer" onclick="openNumpadForOrderItem('${item.orderId}', ${item.quantity}, '${item.name.replace(/'/g, "\\'")}')">${item.quantity}</span>
                            <button onclick="incrementQuantity('${item.orderId}')" class="p-1 text-gray-500 hover:text-green-600"><i class="fas fa-plus-circle"></i></button>
                            <button onclick="promptForItemComment('${item.orderId}')" class="p-1 text-gray-500 hover:text-black" title="Add Note"><i class="fas fa-comment-dots"></i></button>
                            <button onclick="removeItemByOrderId('${item.orderId}')" class="p-1 text-red-500 hover:text-red-700" title="Remove Item"><i class="fas fa-trash-alt"></i></button>
                        </div>
                    </div>
                `;
            }
            elements.orderItemsContainer.appendChild(div);
        });
    }

    if (elements.orderTotalDisplay) elements.orderTotalDisplay.textContent = `€${total.toFixed(2)}`;
    
    // Save to centralized state
    updateCurrentOrder();
    
    // UI-specific updates
    if (elements.mobileOrderCountBadge) {
        updateMobileOrderBadge();
    }
}


function incrementQuantity(orderId) {
    const item = currentOrder.find(i => i.orderId === orderId);
    if (item) {
        item.quantity++;
        updateOrderDisplay();
    }
}

function decrementQuantity(orderId) {
    const item = currentOrder.find(i => i.orderId === orderId);
    if (item) {
        item.quantity--;
        if (item.quantity <= 0) removeItemByOrderId(orderId);
        else updateOrderDisplay();
    }
}

function removeItemByOrderId(orderId) {
    currentOrder = currentOrder.filter(item => item.orderId !== orderId);
    // Hide numpad if the removed item was selected (for both UIs)
    if (itemForNumpad && itemForNumpad.orderId === orderId) hideNumpad();
    if (selectedItemId_desktop === orderId) selectedItemId_desktop = null;
    
    updateOrderDisplay();
    showToast('Item removed from order.', 'info');
}

function promptForItemComment(orderId) {
    const item = currentOrder.find(i => String(i.orderId) === orderId);
    if (item) {
        let currentSelectionDisplay = "";
        if (item.generalSelectedOptions && item.generalSelectedOptions.length > 0) {
            currentSelectionDisplay += ` (Opt: ${item.generalSelectedOptions.map(opt => opt.name + (parseFloat(opt.priceChange || 0) !== 0 ? ` ${parseFloat(opt.priceChange || 0) > 0 ? '+' : ''}€${parseFloat(opt.priceChange || 0).toFixed(2)}` : '')).join(', ')})`;
        }
        const newComment = prompt("Enter note for " + item.name + currentSelectionDisplay.trim() + ":", item.comment || "");
        if (newComment !== null) {
            item.comment = newComment.trim();
            updateOrderDisplay();
        }
    }
}

async function clearOrderData() {
    currentOrder = [];
    universalOrderComment = "";
    if (elements.universalOrderCommentInput) elements.universalOrderCommentInput.value = "";
    const desktopCommentInput = document.getElementById('universalOrderCommentInput_desktop');
    if (desktopCommentInput) desktopCommentInput.value = "";

    currentOrderLineItemCounter = 0;
    isPaidByCard = false;
    if (elements.paidByCardCheckbox) elements.paidByCardCheckbox.checked = false;

    hideNumpad();
    selectedItemId_desktop = null;
    numpadInput_desktop = "";

    // Clear centralized state
    await clearCentralizedOrder();
    await updateUniversalComment();

    updateOrderDisplay();
    fetchAndUpdateOrderNumber();
}

async function newOrder() {
    if (currentOrder.length > 0 && !confirm("Clear current order and start a new one? This will clear all items and notes.")) {
        return;
    }
    await clearOrderData();
    showToast('Order cleared. Ready for the next order.', 'info');
}

async function sendOrder() {
    if (!elements.sendOrderBtn) return;

    if (!currentOrder.length) {
        showToast('Order is empty!', 'warning');
        return;
    }
    
    const isDesktopUI = document.body.classList.contains('desktop-ui');
    let tableNumberForOrder = selectedTableNumber;

    // Require a table number on all UIs; no browser prompts
    if (!tableNumberForOrder || tableNumberForOrder.trim() === "") {
        showToast('Please select a table.', 'warning');
        if (elements.headerTableContainer) {
            elements.headerTableContainer.classList.add('ring-2', 'ring-red-500');
            setTimeout(() => {
                elements.headerTableContainer.classList.remove('ring-2', 'ring-red-500');
            }, 2000);
        }
        return;
    }


    // Preflight: block if printer not verified this session
    if (printerVerificationStatus !== 'verified') {
        if (printerVerificationStatus === 'failed') {
            showToast('Printer verification failed at startup. Open Settings to test and retry.', 'error', 7000);
        } else {
            showToast('Printer not verified yet. Open Settings to test and retry.', 'error', 7000);
        }
        return;
    }

    elements.sendOrderBtn.disabled = true;
    elements.sendOrderBtn.innerHTML = '<i class="fas fa-spinner fa-spin mr-1"></i> Sending...';

    const orderData = {
        tableNumber: tableNumberForOrder,
        items: currentOrder.map(item => ({
            id: item.id,
            name: item.name,
            basePrice: parseFloat(item.price || 0),
            quantity: item.quantity,
            generalSelectedOptions: item.generalSelectedOptions || [],
            itemPriceWithModifiers: item.itemPriceWithModifiers,
            comment: item.comment || "",
        })),
        universalComment: universalOrderComment.trim(),
        paymentMethod: isPaidByCard ? 'Card' : 'Cash'
    };

    try {
        const response = await fetch('/api/orders', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(orderData)
        });

        const result = await response.json().catch(() => ({}));

        if (response.ok) {
            if (result.status === "success") {
                showToast(result.message || `Order #${result.order_number} sent, all copies printed, and logged!`, 'success');
            } else if (result.status === "warning_print_copy2_failed" || result.status === "warning_print_partial_failed") {
                showToast(result.message || `Order #${result.order_number}: Some copies FAILED.`, 'warning', 7000);
            } else if (result.status === "error_print_failed_copy1") {
                showToast(result.message || `Order #${result.order_number} - COPY 1 FAILED. Order NOT saved.`, 'error', 7000);
            } else if (result.status === "error_log_failed_after_print") {
                showToast(result.message || `Order #${result.order_number} - PRINTED but LOGGING FAILED. Notify staff!`, 'error', 10000);
            } else {
                showToast(result.message || `Order #${result.order_number} processed with issues: ${result.status}`, 'warning', 7000);
            }

            if (result.status === "success" || result.status === "warning_print_copy2_failed" || result.status === "warning_print_partial_failed" || result.status === "error_log_failed_after_print") {
                clearOrderData();
            }

        } else {
            if (response.status === 403 && result.status === 'error_trial_expired') {
                showToast(result.message, 'error', 10000);
                openManagementModal();
                const licenseTabButton = document.querySelector('.management-tab[onclick*="\'license\'"]');
                if (licenseTabButton) {
                    switchManagementTab('license', licenseTabButton);
                }
            } else {
                const errorMsg = result.message || `Server error: ${response.status}. Please check server logs.`;
                showToast(errorMsg, 'error', 7000);
            }
            fetchAndUpdateOrderNumber();
        }
    } catch (error) {
        console.error('Send order network/parse error:', error);
        let detailedErrorMsg = 'Network error or invalid server response. Could not send order.';
        if (error instanceof TypeError) {
            detailedErrorMsg = 'Server returned an unexpected response format. Check server logs.';
        } else if (error.message) {
            detailedErrorMsg = `Error: ${error.message}. Could not send order.`;
        }
        showToast(detailedErrorMsg + ' Order remains on screen.', 'error', 7000);
        fetchAndUpdateOrderNumber();
    } finally {
        if (elements.sendOrderBtn) {
            elements.sendOrderBtn.disabled = false;
            elements.sendOrderBtn.innerHTML = '<i class="fas fa-paper-plane mr-1"></i> Send Order';
        }
    }
}

// --- UI-Specific Functions ---

// POSPal UI Functions
function toggleMobileOrderPanel() {
    if (!elements.orderPanel) return; // Only run on POSPal UI
    isMobileOrderPanelOpen = !isMobileOrderPanelOpen;
    if (isMobileOrderPanelOpen) {
        elements.orderPanel.classList.remove('translate-y-full');
        elements.orderPanelBackdrop.classList.remove('hidden');
        if (elements.settingsGearContainer) elements.settingsGearContainer.classList.add('hidden');
        document.body.style.overflow = 'hidden';
    } else {
        elements.orderPanel.classList.add('translate-y-full');
        elements.orderPanelBackdrop.classList.add('hidden');
        if (elements.settingsGearContainer) elements.settingsGearContainer.classList.remove('hidden');
        document.body.style.overflow = '';
        hideNumpad();
    }
}

function updateMobileOrderBadge() {
    if (!elements.mobileOrderCountBadge) return;
    const count = currentOrder.reduce((sum, item) => sum + item.quantity, 0);
    if (count > 0) {
        elements.mobileOrderCountBadge.textContent = count;
        elements.mobileOrderCountBadge.classList.remove('hidden');
    } else {
        elements.mobileOrderCountBadge.classList.add('hidden');
    }
}

function openNumpadForOrderItem(orderId, currentQuantity, itemName) {
    if (!elements.numpadContainer) return;
    itemForNumpad = {
        orderId,
        currentQuantity,
        itemName
    };
    numpadCurrentInput = currentQuantity.toString();
    if (elements.numpadItemNameDisplay) elements.numpadItemNameDisplay.innerHTML = `Quantity for: <span class="font-bold">${itemName}</span>`;
    if (elements.numpadContainer) elements.numpadContainer.classList.remove('hidden');
    updateOrderDisplay();
}

function hideNumpad() {
    if (elements.numpadContainer) elements.numpadContainer.classList.add('hidden');
    itemForNumpad = null;
    numpadCurrentInput = "";
    updateOrderDisplay(); // To remove selection highlight
}

function handleNumpadInput(value) {
    if (!itemForNumpad) return;
    if (value === 'clear') {
        numpadCurrentInput = "";
    } else if (value === 'backspace') {
        numpadCurrentInput = numpadCurrentInput.slice(0, -1);
    } else if (numpadCurrentInput.length < 3) {
        numpadCurrentInput += value;
    }
}

function confirmNumpadInput() {
    if (!itemForNumpad) return;
    const newQuantity = parseInt(numpadCurrentInput);
    const item = currentOrder.find(i => i.orderId === itemForNumpad.orderId);

    if (item) {
        if (!isNaN(newQuantity) && newQuantity > 0) {
            item.quantity = newQuantity;
        } else if (numpadCurrentInput === "" || newQuantity === 0) {
            removeItemByOrderId(item.orderId);
        } else {
            showToast("Invalid quantity. Please enter a number greater than 0.", "warning");
        }
    }
    hideNumpad();
}

function toggleDesktopNumpad() {
    if (!document.body.classList.contains('desktop-ui')) return;
    const full = document.getElementById('desktopNumpad');
    const mini = document.getElementById('desktopNumpadMini');
    if (!full || !mini) return;
    const isFullVisible = !full.classList.contains('hidden');
    if (isFullVisible) {
        full.classList.add('hidden');
        mini.classList.remove('hidden');
    } else {
        mini.classList.add('hidden');
        full.classList.remove('hidden');
    }
}

function toggleDesktopNotes() {
    if (!document.body.classList.contains('desktop-ui')) return;
    const el = document.getElementById('desktopNotesCard');
    if (!el) return;
    el.classList.toggle('hidden');
}

function expandDesktopNumpad() {
    if (!document.body.classList.contains('desktop-ui')) return;
    const full = document.getElementById('desktopNumpad');
    const mini = document.getElementById('desktopNumpadMini');
    if (!full || !mini) return;
    mini.classList.add('hidden');
    full.classList.remove('hidden');
}

async function handleTableNumberChange(event) {
    const inputValue = event.target.value.trim();
    
    // Check if input contains only numbers
    if (inputValue && !/^\d+$/.test(inputValue)) {
        // Show notification to user
        showToast("Table number must contain only numbers. Letters and special characters are not allowed.", "warning");
        
        // Clear the input field
        event.target.value = "";
        selectedTableNumber = "";
        await updateSelectedTable();
        return;
    }
    
    const newTableNumber = inputValue;
    if (selectedTableNumber !== newTableNumber) {
        selectedTableNumber = newTableNumber;
        await updateSelectedTable();
    }
}

// Desktop UI Functions
function selectItemByOrderId_desktop(orderId) {
    if (selectedItemId_desktop === orderId) {
        selectedItemId_desktop = null; // Deselect if clicked again
        numpadInput_desktop = "";
    } else {
        selectedItemId_desktop = orderId;
        numpadInput_desktop = "";
    }
    updateOrderDisplay();
}

function handleNumpad_desktop(digit) {
    // Case 1: An order line item is currently selected – adjust its quantity
    if (selectedItemId_desktop) {
        const item = currentOrder.find(i => String(i.orderId) === selectedItemId_desktop);
        if (!item) {
            showToast('Error: Selected item not found.', 'error');
            numpadInput_desktop = "";
            return;
        }

        numpadInput_desktop += String(digit);
        let newQuantity = Number(numpadInput_desktop);

        if (isNaN(newQuantity) || newQuantity <= 0) {
            item.quantity = 1;
            numpadInput_desktop = newQuantity > 0 ? newQuantity.toString() : "1";
        } else {
            item.quantity = newQuantity;
        }
        updateOrderDisplay();
    } else {
        // Case 2: No line item selected – treat the numpad input as the TABLE number
        numpadInput_desktop += String(digit);
        selectedTableNumber = numpadInput_desktop;
        if (elements.headerTableInput) elements.headerTableInput.value = selectedTableNumber;
        updateSelectedTable();
    }
}

function handleNumpadClear_desktop() {
    if (selectedItemId_desktop) {
        const item = currentOrder.find(i => String(i.orderId) === selectedItemId_desktop);
        if (item) {
            numpadInput_desktop = "";
            item.quantity = 1;
            updateOrderDisplay();
        }
    } else {
        // Clear the table number
        numpadInput_desktop = "";
        selectedTableNumber = "";
        if (elements.headerTableInput) elements.headerTableInput.value = "";
        updateSelectedTable();
    }
}

function handleNumpadBackspace_desktop() {
    if (selectedItemId_desktop) {
        const item = currentOrder.find(i => String(i.orderId) === selectedItemId_desktop);
        if (item) {
            if (numpadInput_desktop.length > 0) {
                numpadInput_desktop = numpadInput_desktop.slice(0, -1);
            }
            item.quantity = Number(numpadInput_desktop) > 0 ? Number(numpadInput_desktop) : 1;
            updateOrderDisplay();
        }
    } else {
        if (numpadInput_desktop.length > 0) {
            numpadInput_desktop = numpadInput_desktop.slice(0, -1);
        }
        selectedTableNumber = numpadInput_desktop;
        if (elements.headerTableInput) elements.headerTableInput.value = selectedTableNumber;
        updateSelectedTable();
    }
}


// --- Universal Modal & Management Logic ---

let currentItemOptionContext = null;

function openItemOptionSelectModal(itemForModal, context) {
    // Reset previous selections
    const container = elements.optionModalOptionsContainer;
    if (container) {
        container.querySelectorAll('input').forEach(input => {
            input.checked = false;
            const parentDiv = input.closest('.option-selectable');
            if (parentDiv) parentDiv.classList.remove('selected', 'border-black', 'bg-gray-100');
        });
    }

    currentItemOptionContext = context;
    if (!elements.itemOptionSelectModal || !elements.optionModalItemName || !elements.optionModalOptionsContainer) return;

    elements.optionModalItemName.textContent = `Options for: ${itemForModal.name}`;
    elements.optionModalOptionsContainer.innerHTML = '';
    elements.confirmOptionBtn.disabled = true;

    let optionsToShow = [];
    let description = "";
    let inputType = 'checkbox'; // Default to checkbox for general options

    if (context === 'general_item_option') {
        optionsToShow = itemForModal.generalOptions || [];
        description = `Select option(s) for ${itemForModal.name}. (Multiple selections allowed)`;
    } else {
        console.warn("Modal opened with unexpected context:", context);
        elements.optionModalOptionsContainer.innerHTML = `<p class="text-sm text-gray-500">No options for this step.</p>`;
        elements.itemOptionSelectModal.classList.remove('hidden');
        elements.itemOptionSelectModal.classList.add('flex');
        return;
    }
    elements.optionModalItemDescription.textContent = description;

    if (optionsToShow.length > 0) {
        elements.confirmOptionBtn.disabled = false;
        optionsToShow.forEach((optionData, index) => {
            const optionName = (typeof optionData === 'object' && optionData.name) ? optionData.name : optionData;
            const priceChange = (typeof optionData === 'object' && typeof optionData.priceChange === 'number') ? optionData.priceChange : 0;

            const optionId = `modal_item_opt_${itemForModal.id}_${context}_${optionName.replace(/\s+/g, '_')}_${index}`;
            const div = document.createElement('div');
            // This class is from POSPal's CSS, but we'll add it for consistency.
            // It should be defined in POSPalDesktop.html's style block if needed.
            div.className = "option-selectable p-3 border border-gray-300 rounded-md hover:bg-gray-100 cursor-pointer group focus-within:ring-2";

            const inputElement = document.createElement('input');
            inputElement.type = inputType;
            inputElement.name = `item_option_for_${itemForModal.id}_${context}`;
            if (inputType === 'checkbox') inputElement.name = optionId;
            inputElement.id = optionId;
            inputElement.value = optionName;
            inputElement.dataset.priceChange = priceChange;
            inputElement.className = `form-${inputType} h-4 w-4 text-black border-gray-300 focus:ring-black accent-black`;

            let labelText = optionName;
            if (priceChange !== 0) {
                labelText += ` (${priceChange > 0 ? '+' : ''}€${priceChange.toFixed(2)})`;
            }

            const label = document.createElement('label');
            label.htmlFor = optionId;
            label.textContent = labelText;
            label.className = "ml-2 text-sm text-gray-700 cursor-pointer flex-grow";

            const innerFlex = document.createElement('div');
            innerFlex.className = "flex items-center w-full";
            innerFlex.appendChild(inputElement);
            innerFlex.appendChild(label);
            div.appendChild(innerFlex);

            div.onclick = function(event) {
                if (event.target !== inputElement) {
                    inputElement.click();
                }
            };

            inputElement.addEventListener('change', function() {
                const parentDiv = this.closest('.option-selectable');
                if (!parentDiv) return;
                if (this.checked) {
                    parentDiv.classList.add('selected', 'border-black', 'bg-gray-100');
                } else {
                    parentDiv.classList.remove('selected', 'border-black', 'bg-gray-100');
                }
            });

            elements.optionModalOptionsContainer.appendChild(div);
        });
    } else {
        elements.optionModalOptionsContainer.innerHTML = `<p class="text-sm text-gray-500">No specific options defined for this item.</p>`;
    }
    // Handle different UI variants
    const isDesktopUI = document.body.classList.contains('desktop-ui');
    if (isDesktopUI) {
        elements.itemOptionSelectModal.style.display = 'flex';
    } else {
        elements.itemOptionSelectModal.classList.remove('hidden');
        elements.itemOptionSelectModal.classList.add('flex');
    }
}

function cancelOptionSelection() {
    if (elements.itemOptionSelectModal) {
        // Handle different UI variants
        const isDesktopUI = document.body.classList.contains('desktop-ui');
        if (isDesktopUI) {
            elements.itemOptionSelectModal.style.display = 'none';
        } else {
            elements.itemOptionSelectModal.classList.add('hidden');
            elements.itemOptionSelectModal.classList.remove('flex');
        }
    }
    currentItemOptionContext = null;
    resetMultiStepSelection();
}

function confirmOptionSelection() {
    if (!itemBeingConfigured || !elements.optionModalOptionsContainer || !currentItemOptionContext) {
        console.error("State missing for confirmOptionSelection", itemBeingConfigured, currentItemOptionContext);
        return;
    }

    if (currentItemOptionContext === 'general_item_option') {
        const checkedBoxes = elements.optionModalOptionsContainer.querySelectorAll('input[type="checkbox"]:checked');
        const generalSelectionsWithOptions = Array.from(checkedBoxes).map(cb => {
            return {
                name: cb.value,
                priceChange: parseFloat(cb.dataset.priceChange || 0)
            };
        });

        finalizeAndAddOrderItem(itemBeingConfigured, generalSelectionsWithOptions);
        resetMultiStepSelection();
        cancelOptionSelection();
    }
}


// --- Management Modal, Login & Data Logic ---
let currentManagementTab = 'analytics';
let tempItemOptionsModal = [];

function openLoginModal() {
    console.log('Opening login modal...');
    
    // If loginModal is not found, try to find it again
    if (!elements.loginModal) {
        console.log('Login modal not found, searching for elements...');
        elements.loginModal = document.getElementById('loginModal');
        elements.loginForm = document.getElementById('loginForm');
        elements.passwordInput = document.getElementById('passwordInput');
        elements.loginError = document.getElementById('loginError');
        elements.loginSubmitBtn = document.getElementById('loginSubmitBtn');
        
        if (!elements.loginModal) {
            console.log('Login modal still not found, creating fallback...');
            createFallbackLoginModal();
            return;
        } else {
            console.log('Login modal elements found and cached');
        }
    }
    
    elements.passwordInput.value = '';
    elements.loginError.classList.add('hidden');
    
    // Handle different UI variants
    const isDesktopUI = document.body.classList.contains('desktop-ui');
    if (isDesktopUI) {
        elements.loginModal.style.display = 'flex';
    } else {
        elements.loginModal.classList.remove('hidden');
        elements.loginModal.classList.add('flex');
    }
    elements.passwordInput.focus();
    console.log('Login modal opened successfully');
}

function createFallbackLoginModal() {
    const modalHTML = `
        <div id="loginModal" class="fixed inset-0 bg-black bg-opacity-70 z-[90] flex items-center justify-center p-4">
            <div class="bg-white rounded-lg shadow-xl p-6 w-full max-w-sm text-gray-800">
                <h3 class="text-xl font-semibold mb-4 text-center">Management Access</h3>
                <form id="loginForm">
                    <div class="space-y-4">
                        <div>
                            <label for="passwordInput" class="block text-sm font-medium text-gray-700">Password</label>
                            <input type="password" id="passwordInput" name="password" class="mt-1 block w-full px-3 py-2 border border-gray-400 rounded-md shadow-sm sm:text-sm" required>
                        </div>
                        <p id="loginError" class="text-sm text-red-600 text-center hidden"></p>
                        <div class="flex gap-2 pt-2">
                            <button type="button" class="w-full py-2 px-4 btn-secondary" onclick="closeLoginModal()">Cancel</button>
                            <button type="submit" id="loginSubmitBtn" class="w-full py-2 px-4 btn-primary">Login</button>
                        </div>
                    </div>
                </form>
            </div>
        </div>
    `;
    
    document.body.insertAdjacentHTML('beforeend', modalHTML);
    
    // Cache the new elements
    elements.loginModal = document.getElementById('loginModal');
    elements.loginForm = document.getElementById('loginForm');
    elements.passwordInput = document.getElementById('passwordInput');
    elements.loginError = document.getElementById('loginError');
    elements.loginSubmitBtn = document.getElementById('loginSubmitBtn');
    
    // Add event listener for the form
    if (elements.loginForm) {
        elements.loginForm.addEventListener('submit', handleLogin);
    }
    
}

function createFallbackManagementModal() {
    const modalHTML = `
        <div id="managementModal" class="fixed inset-0 bg-black bg-opacity-50 z-[70] flex flex-col justify-end sm:justify-center sm:items-center">
            <div class="bg-white shadow-xl w-full h-[90vh] sm:h-auto sm:max-h-[90vh] sm:max-w-6xl flex flex-col text-gray-800 rounded-t-2xl sm:rounded-lg">
                <div class="p-4 border-b border-gray-200 flex justify-between items-center flex-shrink-0">
                    <h2 class="text-xl font-semibold">Management</h2>
                    <button onclick="closeManagementModal()" class="text-gray-500 hover:text-black"><i class="fas fa-times text-2xl"></i></button>
                </div>
                <div class="p-2 border-b border-gray-200 management-tab-container flex-shrink-0">
                    <div class="flex flex-wrap gap-1 rounded-md bg-gray-100 p-1">
                        <button onclick="switchManagementTab('analytics', this)" class="management-tab flex-1 py-2 px-2 text-xs sm:text-sm font-medium rounded-md bg-white shadow-sm text-gray-800">Analytics</button>
                        <button onclick="switchManagementTab('items', this)" class="management-tab flex-1 py-2 px-2 text-xs sm:text-sm font-medium rounded-md text-gray-600 hover:bg-gray-200">Items</button>
                        <button onclick="switchManagementTab('categories', this)" class="management-tab flex-1 py-2 px-2 text-xs sm:text-sm font-medium rounded-md text-gray-600 hover:bg-gray-200">Categories</button>
                        <button onclick="switchManagementTab('orderHistory', this)" class="management-tab flex-1 py-2 px-2 text-xs sm:text-sm font-medium rounded-md text-gray-600 hover:bg-gray-200">Order History</button>
                        <button onclick="openDaySummaryModal()" class="flex-1 py-2 px-2 text-xs sm:text-sm font-medium rounded-md text-gray-600 hover:bg-gray-200 bg-blue-100">Day Summary</button>
                    </div>
                </div>
                <div class="flex-grow overflow-y-auto p-4 management-content">
                    <div id="analyticsManagement">
                        <h3 class="text-xl font-semibold text-gray-800 mb-4">Analytics Dashboard</h3>
                        <div class="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mb-4">
                            <div class="flex items-center">
                                <i class="fas fa-exclamation-triangle text-yellow-600 mr-2"></i>
                                <span class="text-yellow-800 font-medium">Limited Functionality</span>
                            </div>
                            <p class="text-yellow-700 text-sm mt-2">
                                The management component could not be loaded. This may be due to browser security restrictions when opening files directly.
                                <br><br>
                                <strong>Solution:</strong> Serve the files through a local server:
                                <br>
                                <code class="bg-yellow-100 px-2 py-1 rounded text-xs">python -m http.server 8000</code>
                                <br>
                                Then access via: <code class="bg-yellow-100 px-2 py-1 rounded text-xs">http://localhost:8000</code>
                            </p>
                        </div>
                        <p class="text-gray-600">Analytics content would be loaded here.</p>
                    </div>
                    <div id="itemsManagement" class="hidden">
                        <h3 class="text-xl font-semibold text-gray-800 mb-4">Items Management</h3>
                        <div class="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mb-4">
                            <p class="text-yellow-700 text-sm">
                                Items management functionality requires the full management component to be loaded.
                            </p>
                        </div>
                        <p class="text-gray-600">Items management content would be loaded here.</p>
                    </div>
                    <div id="categoriesManagement" class="hidden">
                        <h3 class="text-xl font-semibold text-gray-800 mb-4">Categories Management</h3>
                        <div class="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mb-4">
                            <p class="text-yellow-700 text-sm">
                                Categories management functionality requires the full management component to be loaded.
                            </p>
                        </div>
                        <p class="text-gray-600">Categories management content would be loaded here.</p>
                    </div>
                    <div id="orderHistoryManagement" class="hidden">
                        <h3 class="text-xl font-semibold text-gray-800 mb-4">Order History</h3>
                        <div class="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mb-4">
                            <p class="text-yellow-700 text-sm">
                                Order history functionality requires the full management component to be loaded.
                            </p>
                        </div>
                        <p class="text-gray-600">Order history content would be loaded here.</p>
                    </div>
                </div>
            </div>
        </div>
    `;
    
    document.body.insertAdjacentHTML('beforeend', modalHTML);
    
    // Cache the new element
    elements.managementModal = document.getElementById('managementModal');
    
}

function closeLoginModal() {
    if (!elements.loginModal) return;
    
    // Handle different UI variants
    const isDesktopUI = document.body.classList.contains('desktop-ui');
    if (isDesktopUI) {
        elements.loginModal.style.display = 'none';
    } else {
        elements.loginModal.classList.add('hidden');
        elements.loginModal.classList.remove('flex');
    }
}

async function handleLogin(event) {
    event.preventDefault();
    if (!elements.passwordInput || !elements.loginSubmitBtn || !elements.loginError) return;

    const password = elements.passwordInput.value;
    elements.loginSubmitBtn.disabled = true;
    elements.loginSubmitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
    elements.loginError.classList.add('hidden');

    try {
        const response = await fetch('/api/login', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                password: password
            })
        });

        const result = await response.json();

        if (response.ok && result.success) {
            closeLoginModal();
            openManagementModal();
        } else {
            elements.loginError.textContent = result.message || t('ui.login.loginFailed','Login failed. Please try again.');
            elements.loginError.classList.remove('hidden');
            elements.passwordInput.select();
        }
    } catch (error) {
        console.error('Login error:', error);
        elements.loginError.textContent = t('ui.login.networkError','A network error occurred. Please try again.');
        elements.loginError.classList.remove('hidden');
    } finally {
        elements.loginSubmitBtn.disabled = false;
        elements.loginSubmitBtn.textContent = 'Login';
    }
}

async function loadAppVersion() {
    if (!elements.appVersion) return;
    try {
        const response = await fetch('/api/version');
        if (!response.ok) throw new Error('Failed to fetch version');
        const data = await response.json();
        elements.appVersion.textContent = data.version;
    } catch (error) {
        console.error("Error fetching app version:", error);
        elements.appVersion.textContent = 'N/A';
    }
}

function openManagementModal() {
    // If managementModal is not found, try to find it again
    if (!elements.managementModal) {
        elements.managementModal = document.getElementById('managementModal');
        
        if (!elements.managementModal) {
            createFallbackManagementModal();
            return;
        }
    }
    
    // Handle different UI variants
    const isDesktopUI = document.body.classList.contains('desktop-ui');
    if (isDesktopUI) {
        elements.managementModal.style.display = 'flex';
    } else {
        elements.managementModal.classList.remove('hidden');
        elements.managementModal.classList.add('flex');
    }

    document.body.style.overflow = 'hidden';
    loadManagementData();
    loadAppVersion();
    checkAndDisplayTrialStatus();
    
    const analyticsTabButton = document.querySelector('.management-tab[onclick*="\'analytics\'"]');
    if (analyticsTabButton) {
        switchManagementTab('analytics', analyticsTabButton);
    }
}

function closeManagementModal() {
    if (!elements.managementModal) return;
    
    // Handle different UI variants
    const isDesktopUI = document.body.classList.contains('desktop-ui');
    if (isDesktopUI) {
        elements.managementModal.style.display = 'none';
    } else {
        elements.managementModal.classList.add('hidden');
        elements.managementModal.classList.remove('flex');
    }
    document.body.style.overflow = '';
}


function switchManagementTab(tabName, clickedButton) {
    currentManagementTab = tabName;
    
    const isDesktopUI = document.body.classList.contains('desktop-ui');

    if (isDesktopUI) {
        document.querySelectorAll('.management-tab').forEach(t => t.classList.remove('active'));
        if(clickedButton) clickedButton.classList.add('active');
    } else {
        document.querySelectorAll('.management-tab').forEach(btn => {
            btn.classList.remove('bg-white', 'shadow-sm', 'text-gray-800');
            btn.classList.add('text-gray-600', 'hover:bg-gray-200');
        });
        if (clickedButton) {
            clickedButton.classList.add('bg-white', 'shadow-sm', 'text-gray-800');
            clickedButton.classList.remove('text-gray-600', 'hover:bg-gray-200');
        }
    }

    const views = ['analyticsManagement', 'itemsManagement', 'categoriesManagement', 'orderHistoryManagement', 'licenseManagement', 'hardwarePrintingManagement', 'onlineMenuManagement'];
    views.forEach(id => {
        const view = document.getElementById(id);
        if (view) view.style.display = 'none';
    });

    const activeView = document.getElementById(`${tabName}Management`);
    if (activeView) activeView.style.display = 'block';

    if (tabName === 'analytics') {
        const todayButton = document.querySelector('.date-range-btn[onclick*="\'today\'"]');
        loadAnalyticsData('today', todayButton);
    } else if (tabName === 'categories') {
        if (elements.categoryNameInput) elements.categoryNameInput.value = '';
    } else if (tabName === 'orderHistory') {
        loadTodaysOrdersForReprint();
    } else if (tabName === 'license') {
        loadHardwareId();
    } else if (tabName === 'hardwarePrinting') {
        initializeHardwarePrintingUI();
    } else if (tabName === 'onlineMenu') {
        initializeCloudflareUI();
    }
}

async function initializeCloudflareUI() {
    try {
        const resp = await fetch('/api/settings/cloudflare');
        const cfg = await resp.json();
        const slugEl = document.getElementById('cfStoreSlug');
        const urlEl = document.getElementById('cfMenuUrl');
        const publishBtn = document.querySelector('button[onclick="publishOnlineMenu()"]');
        const msgEl = document.getElementById('cfSettingsMsg');
        
        // CRITICAL: If machine has persisted slug, immediately lock everything
        const isLocked = cfg.cloudflare_store_slug_locked || cfg.persisted_slug;
        const effectiveSlug = cfg.cloudflare_store_slug || cfg.persisted_slug || '';
        
        if (slugEl) slugEl.value = effectiveSlug;
        
        // Show URL if available
        const persistedUrl = cfg.persisted_public_url || '';
        const computedUrl = (cfg.cloudflare_public_base && effectiveSlug)
          ? `${cfg.cloudflare_public_base.replace(/\/$/,'')}/s/${effectiveSlug}`
          : '';
        const urlToShow = persistedUrl || computedUrl;
        if (urlToShow) {
            if (urlEl) urlEl.value = urlToShow;
            renderCloudflareQr(urlToShow);
        }
        
        // SECURITY: Lock UI if website exists on this machine
        if (isLocked) {
            if (slugEl) {
                slugEl.disabled = true;
                slugEl.style.backgroundColor = '#f3f4f6';
                slugEl.style.cursor = 'not-allowed';
            }
            if (msgEl) {
                msgEl.textContent = 'Website is published and locked to this machine. You can update menu content only.';
                msgEl.className = 'text-xs text-green-600 mt-1 font-medium';
            }
            if (publishBtn) {
                publishBtn.innerHTML = '<i class="fas fa-sync mr-2"></i>Update Menu';
                publishBtn.title = 'Update existing menu content';
            }
            
            // If config slug is missing but persisted exists, restore it
            if (!cfg.cloudflare_store_slug && cfg.persisted_slug) {
                console.log('Restoring missing slug from persistence:', cfg.persisted_slug);
                await fetch('/api/settings/cloudflare', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ 
                        cloudflare_store_slug: cfg.persisted_slug,
                        cloudflare_store_slug_locked: true 
                    })
                });
            }
        } else {
            if (msgEl) {
                msgEl.textContent = 'Enter a unique store name (e.g., cafe-olive). This will become part of your permanent URL.';
                msgEl.className = 'text-xs text-gray-600 mt-1';
            }
            if (publishBtn) {
                publishBtn.innerHTML = '<i class="fas fa-cloud-upload-alt mr-2"></i>Publish Menu';
                publishBtn.title = 'Publish menu online';
            }
        }
    } catch (e) {
        console.error('Failed to init Cloudflare UI:', e);
        const msg = document.getElementById('cfSettingsMsg');
        if (msg) msg.textContent = 'Could not load Cloudflare settings.';
    }
}

// Auto-publish helper: only publish if website is already locked (published)
async function maybeAutoPublishMenu() {
    console.log('maybeAutoPublishMenu() called');
    try {
        const resp = await fetch('/api/settings/cloudflare');
        const cfg = await resp.json();
        console.log('Cloudflare config:', cfg);
        console.log('Slug locked:', cfg.cloudflare_store_slug_locked);
        console.log('Store slug:', cfg.cloudflare_store_slug);
        
        const isLocked = cfg.cloudflare_store_slug_locked || cfg.persisted_slug;
        const effectiveSlug = cfg.cloudflare_store_slug || cfg.persisted_slug;
        
        if (isLocked && effectiveSlug) {
            console.log('Conditions met, auto-publishing...');
            // Website exists, auto-update it
            const publishResp = await fetch('/api/publish/cloudflare', { method: 'POST' });
            console.log('Publish response status:', publishResp.status);
            const publishResult = await publishResp.json();
            console.log('Publish result:', publishResult);
            console.log('Menu auto-published to website');
        } else {
            console.log('Auto-publish skipped: website not locked or no slug');
            console.log('Locked:', isLocked, 'Slug:', effectiveSlug);
        }
    } catch (e) {
        console.warn('Auto-publish failed:', e);
    }
}

function getCloudflareUrlFromInputs() {
    const publicBase = (document.getElementById('cfPublicBase')||{}).value || '';
    const slug = (document.getElementById('cfStoreSlug')||{}).value || '';
    if (!publicBase || !slug) return '';
    const base = publicBase.replace(/\/$/, '');
    return `${base}/s/${slug}`;
}

function renderCloudflareQr(url) {
    const container = document.getElementById('cfQrContainer');
    if (!container) return;
    container.innerHTML = '';
    try {
        if (typeof QRCode === 'function') {
            // 144px square QR
            new QRCode(container, { text: url, width: 144, height: 144, correctLevel: (window.QRCode && window.QRCode.CorrectLevel && window.QRCode.CorrectLevel.M) || 1 });
        } else {
            container.textContent = 'QR library not loaded';
        }
    } catch (e) {
        container.textContent = 'QR generation failed';
    }
}

async function saveCloudflareSettings() {
    const apiBase = (document.getElementById('cfApiBase')||{}).value || '';
    const apiKey = (document.getElementById('cfApiKey')||{}).value || '';
    const storeSlug = (document.getElementById('cfStoreSlug')||{}).value || '';
    const publicBase = (document.getElementById('cfPublicBase')||{}).value || '';
    const msg = document.getElementById('cfSettingsMsg');
    try {
        const resp = await fetch('/api/settings/cloudflare', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                cloudflare_api_base: apiBase,
                cloudflare_api_key: apiKey,
                cloudflare_store_slug: storeSlug,
                cloudflare_public_base: publicBase
            })
        });
        const res = await resp.json();
        if (res && res.success) {
            if (msg) { msg.textContent = 'Settings saved.'; }
            const url = getCloudflareUrlFromInputs();
            if (url) {
                const urlEl = document.getElementById('cfMenuUrl');
                if (urlEl) urlEl.value = url;
                renderCloudflareQr(url);
            }
            showToast('Cloudflare settings saved.', 'success');
        } else {
            const err = (res && res.message) || 'Failed to save settings';
            if (msg) { msg.textContent = err; }
            showToast(err, 'error');
        }
    } catch (e) {
        if (msg) { msg.textContent = 'Network error saving settings.'; }
        showToast('Network error saving settings.', 'error');
    }
}

async function publishOnlineMenu() {
    const btn = event && event.target && event.target.closest('button');
    const msg = document.getElementById('cfPublishMsg');
    try {
        if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>Publishing...'; }
        if (msg) msg.textContent = '';
        // 1) Save slug to server (normalized server-side)
        const slugEl = document.getElementById('cfStoreSlug');
        const slugRaw = slugEl ? (slugEl.value || '') : '';
        const slug = (slugRaw || '').trim();
        if (!slug) {
            if (msg) msg.textContent = 'Please enter a store slug (e.g., cafetest).';
            if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-cloud-upload-alt mr-2"></i>Publish Menu'; }
            return;
        }
        const saveResp = await fetch('/api/settings/cloudflare', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ cloudflare_store_slug: slug })
        });
        const saveRes = await saveResp.json().catch(()=>({}));
        if (!saveResp.ok || !saveRes.success) {
            const err = (saveRes && saveRes.message) || `Failed to save slug (HTTP ${saveResp.status})`;
            if (msg) msg.textContent = err;
            showToast(err, 'error');
            return;
        }
        // 2) Publish
        const resp = await fetch('/api/publish/cloudflare', { method: 'POST' });
        const res = await resp.json();
        if (res && res.success) {
            const urlEl = document.getElementById('cfMenuUrl');
            let url = res.url || '';
            if (urlEl) urlEl.value = url || '';
            if (url) renderCloudflareQr(url);
            showToast('Menu published online.', 'success');
            if (msg) msg.textContent = 'Published successfully.';
        } else {
            const err = (res && (res.message || (res.details && (res.details.message || res.details.text)))) || 'Publish failed';
            showToast(err, 'error');
            if (msg) msg.textContent = err;
        }
    } catch (e) {
        showToast('Network error during publish.', 'error');
        if (msg) msg.textContent = 'Network error during publish.';
    } finally {
        if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-cloud-upload-alt mr-2"></i>Publish Menu'; }
    }
}

async function copyCloudflareUrl() {
    try {
        const urlEl = document.getElementById('cfMenuUrl');
        const val = urlEl ? (urlEl.value || '') : '';
        if (!val) { showToast('No URL to copy.', 'warning'); return; }
        await navigator.clipboard.writeText(val);
        showToast('URL copied to clipboard.', 'success');
    } catch (e) {
        showToast('Could not copy URL.', 'error');
    }
}

function populateManagementCategorySelect() {
    if (!elements.itemCategorySelect) return;
    const currentCategoryValue = elements.itemCategorySelect.value;
    elements.itemCategorySelect.innerHTML = Object.keys(menu)
        .map(c => `<option value="${c}">${c}</option>`)
        .join('');
    if (Object.keys(menu).length === 0) {
        elements.itemCategorySelect.innerHTML = '<option value="">Create a category first</option>';
    } else if (currentCategoryValue && menu[currentCategoryValue]) {
        elements.itemCategorySelect.value = currentCategoryValue;
    } else if (elements.itemCategorySelect.options.length > 0) {
        elements.itemCategorySelect.selectedIndex = 0;
    }
}

function loadManagementData() {
    populateManagementCategorySelect();
    renderExistingItemsInModal();
    renderExistingCategoriesInModal();
}

async function initializeHardwarePrintingUI() {
    try {
        // Load settings
        const settingsResp = await fetch('/api/settings/printing');
        const settings = await settingsResp.json();
        const cutToggle = document.getElementById('cutAfterPrintToggle');
        if (cutToggle) cutToggle.checked = !!settings.cut_after_print;
        const copiesInput = document.getElementById('copiesPerOrderInput');
        if (copiesInput) {
            const val = parseInt(settings.copies_per_order);
            copiesInput.value = isNaN(val) ? 2 : Math.max(1, Math.min(10, val));
        }
        await refreshPrinters();
        
        // Load network settings
        await loadNetworkSettings();
        
    } catch (e) {
        console.error('Failed to initialize Hardware & Printing UI:', e);
    }
}

async function refreshPrinters() {
    try {
        const resp = await fetch('/api/printers');
        const data = await resp.json();
        const sel = document.getElementById('printerSelect');
        if (!sel) return;
        sel.innerHTML = '';
        (data.printers || []).forEach(name => {
            const opt = document.createElement('option');
            opt.value = name; opt.textContent = name;
            if (name === data.selected) opt.selected = true;
            sel.appendChild(opt);
        });
        updatePrinterStatusDot();
    } catch (e) {
        console.error('Failed to load printers:', e);
    }
}

async function updatePrinterStatusDot() {
    try {
        const sel = document.getElementById('printerSelect');
        const dot = document.getElementById('printerStatusDot');
        if (!sel || !dot) return;
        const name = encodeURIComponent(sel.value || '');
        const resp = await fetch(`/api/printer/status?name=${name}`);
        const info = await resp.json();
        let statusText = 'Unknown';
        let color = '#6b7280';
        
        // Check session verification status first
        if (printerVerificationStatus === 'verified') {
            statusText = 'Ready'; color = '#16a34a';
        } else if (info && typeof info.status_code === 'number') {
            const code = info.status_code;
            // Map 0 to Unknown (gray) instead of Ready; Ready will be set only after verification
            if (code !== 0) { statusText = 'Attention'; color = '#f59e0b'; }
            else { statusText = 'Unknown'; color = '#6b7280'; }
        } else if (info && info.error) {
            statusText = 'Offline'; color = '#ef4444';
        }
        dot.innerHTML = `<span style="display:inline-flex;align-items:center;gap:6px"><span style="width:10px;height:10px;border-radius:9999px;background:${color}"></span><span>${statusText}</span></span>`;
    } catch (e) {
        console.error('Failed to update printer status:', e);
    }
}

async function saveSelectedPrinter() {
    try {
        const sel = document.getElementById('printerSelect');
        if (!sel) return;
        const resp = await fetch('/api/printer/select', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ printer_name: sel.value })
        });
        const res = await resp.json();
        if (res.success) {
            showToast('Default printer saved.', 'success');
            updatePrinterStatusDot();
        } else {
            showToast(res.message || 'Failed to save printer.', 'error');
        }
    } catch (e) {
        showToast('Error saving printer.', 'error');
    }
}

async function testPrint() {
    const btn = event && event.target && event.target.closest('button');
    const resultEl = document.getElementById('lastTestPrintResult');
    try {
        if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-1"></i> Testing...'; }
        const resp = await fetch('/api/printer/test', { method: 'POST' });
        const res = await resp.json();
        if (res.success) {
            printerVerificationStatus = 'verified'; // Update session status
            if (resultEl) { resultEl.textContent = `Last test: Success (Printed) ${new Date().toLocaleTimeString()}`; resultEl.className = 'text-xs text-green-600'; }
            const dot = document.getElementById('printerStatusDot');
            if (dot) dot.innerHTML = `<span style="display:inline-flex;align-items:center;gap:6px"><span style=\"width:10px;height:10px;border-radius:9999px;background:#16a34a\"></span><span>Ready</span></span>`;
        } else {
            printerVerificationStatus = 'failed'; // Update session status
            if (resultEl) { resultEl.textContent = `Last test: Failed (${new Date().toLocaleTimeString()})`; resultEl.className = 'text-xs text-red-600'; }
            showToast(res.message || 'Test print failed.', 'error');
        }
    } catch (e) {
        printerVerificationStatus = 'failed'; // Update session status
        if (resultEl) { resultEl.textContent = `Last test: Error (${new Date().toLocaleTimeString()})`; resultEl.className = 'text-xs text-red-600'; }
        showToast('Error performing test print.', 'error');
    } finally {
        if (btn) { btn.disabled = false; btn.innerHTML = 'Test Print'; }
    }
}

async function openPdfFolder() {
    try {
        const resp = await fetch('/api/open_pdf_folder', { method: 'POST' });
        const res = await resp.json();
        if (!res.success) {
            showToast(res.message || 'Could not open PDF folder.', 'error');
        }
    } catch (e) {
        showToast('Error opening PDF folder.', 'error');
    }
}

async function changeManagementPassword() {
    try {
        const currentEl = document.getElementById('currentPasswordInput');
        const newEl = document.getElementById('newPasswordInput');
        const confirmEl = document.getElementById('confirmPasswordInput');
        const current = currentEl ? currentEl.value : '';
        const next = newEl ? newEl.value : '';
        const confirm = confirmEl ? confirmEl.value : '';
        if (next !== confirm) {
            showToast('New and confirm do not match.', 'warning');
            return;
        }
        const resp = await fetch('/api/settings/password', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ current_password: current, new_password: next })
        });
        const res = await resp.json();
        if (res.success) {
            showToast('Password updated.', 'success');
            if (currentEl) currentEl.value = '';
            if (newEl) newEl.value = '';
            if (confirmEl) confirmEl.value = '';
        } else {
            showToast(res.message || 'Failed to update password.', 'error');
        }
    } catch (e) {
        showToast('Error updating password.', 'error');
    }
}

// Network Settings Functions
async function loadNetworkSettings() {
    // Check if network settings UI elements exist (mobile version doesn't have them)
    const currentPortDisplay = document.getElementById('currentPortDisplay');
    const adminStatus = document.getElementById('adminStatus');
    const portSelectionArea = document.getElementById('portSelectionArea');
    
    if (!currentPortDisplay || !adminStatus || !portSelectionArea) {
        // Mobile version - skip network settings loading
        return;
    }
    
    try {
        const response = await fetch('/api/settings/network');
        const settings = await response.json();
        
        // Update current port display
        currentPortDisplay.textContent = settings.port;
        
        // Show admin status
        updateAdminStatus(settings.is_admin);
        
        // Disable port selection if not admin
        if (!settings.is_admin) {
            portSelectionArea.style.opacity = '0.5';
            portSelectionArea.style.pointerEvents = 'none';
        }
        
    } catch (error) {
        console.error('Error loading network settings:', error);
        showToast('Error loading network settings.', 'error');
    }
}

function updateAdminStatus(isAdmin) {
    const statusDiv = document.getElementById('adminStatus');
    const statusText = document.getElementById('adminStatusText');
    
    if (isAdmin) {
        statusDiv.className = 'p-2 rounded text-sm bg-green-50 border border-green-200 mb-3';
        statusText.innerHTML = '<i class="fas fa-check-circle text-green-600 mr-1"></i>Running as Administrator - Port changes available';
    } else {
        statusDiv.className = 'p-2 rounded text-sm bg-red-50 border border-red-200 mb-3';
        statusText.innerHTML = '<i class="fas fa-times-circle text-red-600 mr-1"></i>Not Administrator - Must restart as Administrator to change ports';
    }
}

function toggleInstructions() {
    const panel = document.getElementById('instructionsPanel');
    const arrow = document.getElementById('instructionsArrow');
    
    if (panel.classList.contains('hidden')) {
        panel.classList.remove('hidden');
        arrow.classList.add('rotate-90');
    } else {
        panel.classList.add('hidden');
        arrow.classList.remove('rotate-90');
    }
}

async function changePort() {
    const selectedPort = document.querySelector('input[name="selectedPort"]:checked');
    if (!selectedPort) {
        showToast('Please select a port first.', 'error');
        return;
    }
    
    const newPort = parseInt(selectedPort.value);
    const resultSpan = document.getElementById('portChangeResult');
    const changeBtn = document.getElementById('changePortBtn');
    
    // Disable button and show loading
    changeBtn.disabled = true;
    changeBtn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>Changing Port...';
    resultSpan.textContent = 'Updating configuration and firewall...';
    resultSpan.className = 'text-sm text-blue-600';
    
    try {
        // Change the port in config
        const response = await fetch('/api/settings/general', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ port: newPort })
        });
        
        if (!response.ok) {
            throw new Error('Failed to update port configuration');
        }
        
        // Setup firewall rule for new port
        const firewallResponse = await fetch('/api/windows_firewall/open_port', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ port: newPort })
        });
        
        const firewallResult = await firewallResponse.json();
        
        // Update UI
        document.getElementById('currentPortDisplay').textContent = newPort;
        
        if (firewallResult.success) {
            resultSpan.textContent = `✅ Port changed to ${newPort} and firewall configured! Restart POSPal to use new port.`;
            resultSpan.className = 'text-sm text-green-600';
            showToast(`Port changed to ${newPort}! Please restart POSPal.`, 'success');
        } else {
            resultSpan.textContent = `⚠️ Port changed to ${newPort} but firewall setup failed. You may need to manually allow port ${newPort}.`;
            resultSpan.className = 'text-sm text-orange-600';
            showToast(`Port changed but firewall setup failed: ${firewallResult.message}`, 'warning');
        }
        
        // Clear radio selection
        selectedPort.checked = false;
        
    } catch (error) {
        console.error('Error changing port:', error);
        resultSpan.textContent = `❌ Failed to change port: ${error.message}`;
        resultSpan.className = 'text-sm text-red-600';
        showToast('Error changing port.', 'error');
    } finally {
        // Re-enable button
        changeBtn.disabled = false;
        changeBtn.innerHTML = '<i class="fas fa-exchange-alt mr-2"></i>Change Port';
        
        // Auto-hide result message
        setTimeout(() => {
            resultSpan.textContent = '';
        }, 8000);
    }
}

// Persist settings when toggles change
document.addEventListener('change', async (e) => {
    const target = e.target;
    if (!(target instanceof HTMLElement)) return;
    const id = target.id;
    if (id === 'cutAfterPrintToggle') {
        try {
            const payload = {};
            payload.cut_after_print = target.checked;
            const resp = await fetch('/api/settings/printing', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            const res = await resp.json();
            if (!res.success) showToast(res.message || 'Failed to save setting.', 'error');
        } catch (err) {
            showToast('Error saving setting.', 'error');
        }
    } else if (id === 'copiesPerOrderInput') {
        try {
            const n = parseInt(target.value);
            const safe = isNaN(n) ? 2 : Math.max(1, Math.min(10, n));
            target.value = safe;
            const resp = await fetch('/api/settings/printing', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ copies_per_order: safe })
            });
            const res = await resp.json();
            if (!res.success) showToast(res.message || 'Failed to save copies per order.', 'error');
            else showToast('Saved.', 'success');
        } catch (err) {
            showToast('Error saving copies per order.', 'error');
        }
    } else if (id === 'printerSelect') {
        updatePrinterStatusDot();
    }
});

// Handle radio button changes for port selection
document.addEventListener('change', (e) => {
    if (e.target.name === 'selectedPort') {
        const changeBtn = document.getElementById('changePortBtn');
        const helpText = changeBtn.nextElementSibling;
        
        changeBtn.disabled = false;
        helpText.textContent = `Ready to change to port ${e.target.value}`;
        helpText.classList.remove('text-gray-500');
        helpText.classList.add('text-blue-600');
    }
});


function renderExistingItemsInModal() {
    if (!elements.existingItemsListModal) return;
    elements.existingItemsListModal.innerHTML = '';
    let itemCount = 0;
    
    Object.entries(menu).forEach(([category, items]) => {
        if (!items || items.length === 0) return;

        // Category header (shown on both UIs for consistent grouping)
        const categoryHeader = document.createElement('h5');
        categoryHeader.className = "font-bold text-gray-700 mt-3 mb-1 pb-1 border-b border-gray-300";
        categoryHeader.textContent = category;
        elements.existingItemsListModal.appendChild(categoryHeader);

        (items || []).forEach((item, index) => {
            itemCount++;
            const div = document.createElement('div');
            div.className = `p-2 border border-gray-300 rounded-md flex justify-between items-center text-sm bg-white hover:bg-gray-50`;

            let itemDetails = `<span class="font-medium text-gray-800">${item.name}</span>
                               <span class="text-xs text-gray-500 ml-1">- €${(item.price || 0).toFixed(2)}</span>`;
            if (item.hasGeneralOptions && item.generalOptions && item.generalOptions.length > 0) {
                itemDetails += `<span class="text-xs text-blue-600 ml-2">(+ Options)</span>`;
            }

            const isFirst = index === 0;
            const isLast = index === items.length - 1;
            const reorderButtons = `
                <div class="flex items-center">
                    <button onclick="moveItemPosition(${item.id}, 'up')" class="px-2 py-1 text-gray-500 hover:text-black ${isFirst ? 'opacity-25 cursor-not-allowed' : ''}" ${isFirst ? 'disabled' : ''} title="Move Up"><i class="fas fa-arrow-up"></i></button>
                    <button onclick="moveItemPosition(${item.id}, 'down')" class="px-2 py-1 text-gray-500 hover:text-black ${isLast ? 'opacity-25 cursor-not-allowed' : ''}" ${isLast ? 'disabled' : ''} title="Move Down"><i class="fas fa-arrow-down"></i></button>
                </div>`;

            div.innerHTML = `
                <div class="flex items-center">
                    ${reorderButtons}
                    <div class="ml-2">${itemDetails}</div>
                </div>
                <div class="space-x-1 flex-shrink-0">
                    <button onclick=\"openItemFormModal(${item.id})\" class=\"px-2 py-1 text-xs btn-warning text-white rounded hover:opacity-80\" data-i18n=\"ui.items.edit\">Edit</button>
                    <button onclick=\"deleteItem(${item.id})\" class=\"px-2 py-1 text-xs btn-danger text-white rounded hover:opacity-80\" data-i18n=\"ui.items.delete\">Delete</button>
                </div>`;

            elements.existingItemsListModal.appendChild(div);
        });
    });
    if (itemCount === 0) {
        elements.existingItemsListModal.innerHTML = '<p class="text-xs text-gray-500 italic">No items created yet.</p>';
    }
}


async function moveItemPosition(itemIdToMove, direction) {
    let categoryKey = null;
    let itemIndex = -1;

    for (const cat in menu) {
        const index = (menu[cat] || []).findIndex(i => i.id === itemIdToMove);
        if (index !== -1) {
            categoryKey = cat;
            itemIndex = index;
            break;
        }
    }

    if (categoryKey === null || itemIndex === -1) {
        showToast("Could not find item to move.", "error");
        return;
    }

    const itemsArray = menu[categoryKey];
    const itemToMove = itemsArray[itemIndex];

    if (direction === 'up' && itemIndex > 0) {
        itemsArray.splice(itemIndex, 1);
        itemsArray.splice(itemIndex - 1, 0, itemToMove);
    } else if (direction === 'down' && itemIndex < itemsArray.length - 1) {
        itemsArray.splice(itemIndex, 1);
        itemsArray.splice(itemIndex + 1, 0, itemToMove);
    } else {
        return;
    }

    const success = await saveMenuToServer();
    if (success) {
        showToast('Item order updated.', 'success');
        await maybeAutoPublishMenu();
        await loadMenu();
        loadManagementData();
    } else {
        showToast('Failed to save new item order. Reverting.', 'error');
        await loadMenu();
        loadManagementData();
    }
}

function renderExistingCategoriesInModal() {
    if (!elements.existingCategoriesListModal) return;
    elements.existingCategoriesListModal.innerHTML = '';
    const categoryKeys = Object.keys(menu);

    if (categoryKeys.length === 0) {
        elements.existingCategoriesListModal.innerHTML = '<p class="text-xs text-gray-500 italic">No categories created yet.</p>';
        return;
    }

    categoryKeys.forEach((categoryName, index) => {
        const div = document.createElement('div');
        const isFirst = index === 0;
        const isLast = index === categoryKeys.length - 1;
        const reorderButtons = `
            <div class="flex items-center">
                <button onclick="moveCategoryPosition('${categoryName}', 'up')" class="px-2 py-1 text-gray-500 hover:text-black ${isFirst ? 'opacity-25 cursor-not-allowed' : ''}" ${isFirst ? 'disabled' : ''} title="Move Up"><i class="fas fa-arrow-up"></i></button>
                <button onclick="moveCategoryPosition('${categoryName}', 'down')" class="px-2 py-1 text-gray-500 hover:text-black ${isLast ? 'opacity-25 cursor-not-allowed' : ''}" ${isLast ? 'disabled' : ''} title="Move Down"><i class="fas fa-arrow-down"></i></button>
            </div>`;
        div.className = "p-2 border border-gray-300 rounded-md flex justify-between items-center text-sm bg-white hover:bg-gray-50";
        div.innerHTML = `
            <div class="flex items-center">
                ${reorderButtons}
                <span class="font-medium text-gray-800 ml-2">${categoryName}</span>
            </div>
            <button onclick="deleteCategory('${categoryName}')" class="px-2 py-1 text-xs btn-danger text-white rounded hover:opacity-80">Delete</button>
        `;
        elements.existingCategoriesListModal.appendChild(div);
    });
}

async function moveCategoryPosition(categoryNameToMove, direction) {
    const keys = Object.keys(menu);
    const index = keys.indexOf(categoryNameToMove);

    if (index === -1) {
        showToast("Could not find category to move.", "error");
        return;
    }

    let newIndex;
    if (direction === 'up') {
        if (index === 0) return;
        newIndex = index - 1;
    } else {
        if (index === keys.length - 1) return;
        newIndex = index + 1;
    }

    [keys[index], keys[newIndex]] = [keys[newIndex], keys[index]];

    const newMenu = {};
    keys.forEach(key => {
        newMenu[key] = menu[key];
    });
    menu = newMenu;

    const success = await saveMenuToServer();
    if (success) {
        showToast('Category order updated.', 'success');
        await maybeAutoPublishMenu();
        renderCategories();
        loadManagementData();
    } else {
        showToast('Failed to save new category order. Reverting.', 'error');
        await loadMenu();
        loadManagementData();
    }
}


function generateItemId() {
    const allItems = [].concat(...Object.values(menu).map(categoryItems => categoryItems || []));
    return allItems.length > 0 ? Math.max(0, ...allItems.map(i => i.id || 0)) + 1 : 1;
}

function resetItemForm() {
    editingItem = null;
    if (elements.itemNameInput) elements.itemNameInput.value = '';
    if (elements.itemPriceInput) elements.itemPriceInput.value = '';
    if (elements.itemIdInput) elements.itemIdInput.value = '';
    if (elements.itemCategorySelect && elements.itemCategorySelect.options.length > 0) elements.itemCategorySelect.selectedIndex = 0;

    if (elements.itemHasOptionsCheckboxModal) elements.itemHasOptionsCheckboxModal.checked = false;
    tempItemOptionsModal = [];

    if (elements.newOptionNameInputModal) elements.newOptionNameInputModal.value = '';
    if (elements.newOptionPriceInputModal) elements.newOptionPriceInputModal.value = '';

    toggleItemOptionsUIInModal();
}

function openItemFormModal(itemIdToEdit = null) {
    resetItemForm();
    if (itemIdToEdit !== null) {
        elements.itemFormModalTitle.textContent = t('ui.items.editItem', 'Edit Item');
        populateItemFormForEdit(itemIdToEdit);
    } else {
        elements.itemFormModalTitle.textContent = t('ui.items.editItem', 'Add New Item');
        if (elements.saveItemBtn) elements.saveItemBtn.innerHTML = '💾 ' + t('ui.items.saveNewItem', 'Save New Item');
    }
    // Handle different UI variants
    const isDesktopUI = document.body.classList.contains('desktop-ui');
    if (isDesktopUI) {
        elements.itemFormModal.style.display = 'flex';
    } else {
        elements.itemFormModal.classList.remove('hidden');
        elements.itemFormModal.classList.add('flex');
    }
}

function closeItemFormModal() {
    // Handle different UI variants
    const isDesktopUI = document.body.classList.contains('desktop-ui');
    if (isDesktopUI) {
        elements.itemFormModal.style.display = 'none';
    } else {
        elements.itemFormModal.classList.add('hidden');
        elements.itemFormModal.classList.remove('flex');
    }
    resetItemForm();
}

function populateItemFormForEdit(itemIdToEdit) {
    let foundItem;
    let itemCategoryName;
    Object.entries(menu).forEach(([category, items]) => {
        const item = (items || []).find(i => i.id === itemIdToEdit);
        if (item) {
            foundItem = item;
            itemCategoryName = category;
        }
    });

    if (foundItem) {
        editingItem = { ...foundItem };
        if (elements.itemNameInput) elements.itemNameInput.value = foundItem.name;
        if (elements.itemPriceInput) elements.itemPriceInput.value = foundItem.price;
        if (elements.itemCategorySelect) elements.itemCategorySelect.value = itemCategoryName;
        if (elements.itemIdInput) elements.itemIdInput.value = foundItem.id;

        if (foundItem.hasGeneralOptions && foundItem.generalOptions && Array.isArray(foundItem.generalOptions)) {
            tempItemOptionsModal = [...foundItem.generalOptions];
        } else {
            tempItemOptionsModal = [];
        }
        if (elements.itemHasOptionsCheckboxModal) {
            elements.itemHasOptionsCheckboxModal.checked = (foundItem.hasGeneralOptions && tempItemOptionsModal.length > 0);
        }
        toggleItemOptionsUIInModal();
        if (elements.saveItemBtn) elements.saveItemBtn.innerHTML = '🔄 Update Item';
    }
}

async function saveItem() {
    console.log('saveItem() called');
    if (!elements.itemNameInput || !elements.itemPriceInput || !elements.itemCategorySelect) {
        console.log('Missing form elements:', {
            nameInput: !!elements.itemNameInput,
            priceInput: !!elements.itemPriceInput, 
            categorySelect: !!elements.itemCategorySelect
        });
        return;
    }

    const itemName = elements.itemNameInput.value.trim();
    const itemPrice = parseFloat(elements.itemPriceInput.value);
    const itemCategory = elements.itemCategorySelect.value;

    let itemIdVal = editingItem ? editingItem.id : generateItemId();

    if (isNaN(itemIdVal)) {
        showToast('Error: Invalid Item ID.', 'error');
        return;
    }
    if (!itemName || isNaN(itemPrice) || itemPrice < 0) {
        showToast('Item Name and a valid Base Price are required.', 'warning');
        return;
    }
    if (!itemCategory && Object.keys(menu).length > 0) {
        showToast('Please select a category.', 'warning');
        return;
    }
    if (Object.keys(menu).length === 0 && !itemCategory) {
        showToast('Please create a category first.', 'warning');
        return;
    }

    const itemData = {
        id: itemIdVal,
        name: itemName,
        price: itemPrice,
        hasGeneralOptions: elements.itemHasOptionsCheckboxModal.checked,
        generalOptions: (elements.itemHasOptionsCheckboxModal.checked && tempItemOptionsModal.length > 0) ? [...tempItemOptionsModal] : []
    };

    if (itemData.hasGeneralOptions && itemData.generalOptions.length === 0) {
        showToast('If "Has General Options" is checked, please add at least one option.', 'warning');
        return;
    }

    if (editingItem) {
        Object.keys(menu).forEach(cat => {
            const itemIndex = (menu[cat] || []).findIndex(i => i.id === editingItem.id);
            if (itemIndex > -1) {
                if (cat !== itemCategory) {
                    menu[cat].splice(itemIndex, 1);
                }
            }
        });
    }

    if (!menu[itemCategory]) menu[itemCategory] = [];

    const existingItemIndex = menu[itemCategory].findIndex(i => i.id === itemData.id);
    if (existingItemIndex > -1) {
        menu[itemCategory][existingItemIndex] = itemData;
    } else {
        menu[itemCategory].push(itemData);
    }

    console.log('About to call saveMenuToServer()');
    const success = await saveMenuToServer();
    console.log('saveMenuToServer() returned:', success);
    if (success) {
        console.log('Save successful, showing toast and auto-publishing');
        showToast(editingItem ? 'Item updated successfully!' : 'Item saved successfully!', 'success');
        console.log('About to call maybeAutoPublishMenu()');
        try {
            await maybeAutoPublishMenu();
            console.log('maybeAutoPublishMenu() completed');
        } catch (e) {
            console.error('Error in maybeAutoPublishMenu():', e);
        }
        closeItemFormModal();
        await loadMenu();
        loadManagementData();
    } else {
        showToast('Failed to save item to server. Reverting.', 'error');
        await loadMenu();
    }
}

async function deleteItem(itemIdToDelete) {
    if (!confirm(t('ui.items.confirmDeleteItem', 'Are you sure you want to delete this item? This cannot be undone.'))) return;

    let itemFoundAndDeletedLocally = false;
    Object.keys(menu).forEach(cat => {
        const itemIndex = (menu[cat] || []).findIndex(i => i.id === itemIdToDelete);
        if (itemIndex > -1) {
            menu[cat].splice(itemIndex, 1);
            itemFoundAndDeletedLocally = true;
        }
    });

    if (!itemFoundAndDeletedLocally) {
        showToast(t('ui.items.itemNotFoundDeletion', 'Item not found for deletion.'), 'warning');
        return;
    }

    const success = await saveMenuToServer();
    if (success) {
        showToast('Item deleted successfully.', 'success');
        await maybeAutoPublishMenu();
        await loadMenu();
        loadManagementData();
    } else {
        showToast('Failed to delete item on server. Reverting.', 'error');
        await loadMenu();
    }
}

async function saveCategory() {
    if (!elements.categoryNameInput) return;
    const categoryName = elements.categoryNameInput.value.trim();
    if (!categoryName) {
        showToast('Category name cannot be empty.', 'warning');
        return;
    }
    if (menu[categoryName]) {
        showToast('Category already exists.', 'warning');
        return;
    }

    const newMenu = { ...menu };
    newMenu[categoryName] = [];

    try {
        const response = await fetch('/api/menu', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(newMenu)
        });

        const contentType = response.headers.get('content-type');
        if (!contentType || !contentType.includes('application/json')) {
            const text = await response.text();
            throw new Error(`Invalid response: ${text.substring(0, 100)}`);
        }

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.message || 'Failed to save category');
        }

        menu = newMenu;
        showToast(`Category "${categoryName}" added successfully.`, 'success');
        await maybeAutoPublishMenu();
        elements.categoryNameInput.value = '';
        await loadMenu();
        loadManagementData();

    } catch (error) {
        showToast(`Failed to save category: ${error.message}`, 'error');
    }

}

async function deleteCategory(categoryNameToDelete) {
    if (menu[categoryNameToDelete] && menu[categoryNameToDelete].length > 0) {
        if (!confirm(t('ui.items.confirmDeleteCategoryWithItems', `Category "${categoryNameToDelete}" contains items. Are you sure you want to delete the category AND ALL ITS ITEMS? This cannot be undone.`).replace('{name}', categoryNameToDelete))) return;
    } else {
        if (!confirm(t('ui.items.confirmDeleteCategory', `Are you sure you want to delete category "${categoryNameToDelete}"? This cannot be undone.`).replace('{name}', categoryNameToDelete))) return;
    }
    const backupMenu = JSON.parse(JSON.stringify(menu));
    delete menu[categoryNameToDelete];

    const success = await saveMenuToServer();
    if (success) {
        showToast(t('ui.items.deleteCategorySuccess', `Category "${categoryNameToDelete}" deleted successfully.`).replace('{name}', categoryNameToDelete), 'success');
        await maybeAutoPublishMenu();
        if (selectedCategory === categoryNameToDelete) {
            selectedCategory = Object.keys(menu)[0] || null;
        }
        await loadMenu();
        loadManagementData();
    } else {
        menu = backupMenu;
        showToast(t('ui.items.deleteCategoryFailed', `Failed to delete category "${categoryNameToDelete}" on server. Reverting.`).replace('{name}', categoryNameToDelete), 'error');
        await loadMenu();
        loadManagementData();
    }
}

function toggleItemOptionsUIInModal() {
    const hasOptions = document.getElementById('itemHasOptionsModal').checked;
    document.getElementById('itemOptionsModalContainer').style.display = hasOptions ? 'block' : 'none';

    if (!hasOptions) {
        tempItemOptionsModal = [];
    }
    renderTemporaryOptionsListModal();
}

function addOptionToItemFormTempModal() {
    if (!elements.newOptionNameInputModal || !elements.newOptionPriceInputModal) return;
    const optionName = elements.newOptionNameInputModal.value.trim();
    const priceChangeText = elements.newOptionPriceInputModal.value.trim();
    const priceChange = priceChangeText === "" ? 0 : parseFloat(priceChangeText);

    if (!optionName) {
        showToast('Option name cannot be empty.', 'warning');
        return;
    }
    if (isNaN(priceChange)) {
        showToast('Price change must be a valid number or empty (for 0).', 'warning');
        return;
    }

    if (tempItemOptionsModal.find(opt => opt.name === optionName)) {
        showToast('This general option name already exists for the item.', 'warning');
        return;
    }

    tempItemOptionsModal.push({
        name: optionName,
        priceChange: priceChange
    });
    renderTemporaryOptionsListModal();
    elements.newOptionNameInputModal.value = '';
    elements.newOptionPriceInputModal.value = '';
    elements.newOptionNameInputModal.focus();
}

function renderTemporaryOptionsListModal() {
    if (!elements.itemOptionsListDisplayModal) return;
    elements.itemOptionsListDisplayModal.innerHTML = '';
    if (tempItemOptionsModal.length === 0 && document.getElementById('itemHasOptionsModal').checked) {
        elements.itemOptionsListDisplayModal.innerHTML = '<p class="text-xs text-gray-500 italic w-full">No general options added yet.</p>';
        return;
    } else if (tempItemOptionsModal.length === 0 && !document.getElementById('itemHasOptionsModal').checked) {
        elements.itemOptionsListDisplayModal.innerHTML = '';
        return;
    }

    tempItemOptionsModal.forEach(opt => {
        const pillSpan = document.createElement('span');
        pillSpan.className = 'option-pill';
        const priceDisplay = parseFloat(opt.priceChange || 0) !== 0 ? ` (${parseFloat(opt.priceChange || 0) > 0 ? '+' : ''}€${parseFloat(opt.priceChange || 0).toFixed(2)})` : '';
        pillSpan.textContent = `${opt.name}${priceDisplay}`;

        const removeBtn = document.createElement('button');
        removeBtn.className = 'remove-option-btn';
        removeBtn.innerHTML = '&times;';
        removeBtn.title = `Remove option: ${opt.name}`;
        removeBtn.type = 'button';
        removeBtn.onclick = () => removeTemporaryOptionModal(opt.name);
        pillSpan.appendChild(removeBtn);
        elements.itemOptionsListDisplayModal.appendChild(pillSpan);
    });
}

function removeTemporaryOptionModal(optionNameToRemove) {
    tempItemOptionsModal = tempItemOptionsModal.filter(opt => opt.name !== optionNameToRemove);
    renderTemporaryOptionsListModal();
}

let toastTimeout;

function showToast(message, type = 'info', duration = 3000) {
    if (!elements.toast || !elements.toastMessage) return;
    clearTimeout(toastTimeout);
    elements.toastMessage.textContent = message;

    // Reset classes
    elements.toast.className = 'fixed top-5 right-5 text-white px-4 py-2 rounded-md shadow-lg text-sm z-[100] opacity-0 transition-opacity duration-300';
    const isDesktopUI = document.body.classList.contains('desktop-ui');
    
    if(isDesktopUI) {
        elements.toast.className = 'fixed top-5 right-5 text-white px-4 py-2 rounded-md shadow-lg text-sm z-[2000] transition-opacity duration-300';
        switch (type) {
            case 'success': elements.toast.style.backgroundColor = '#16a34a'; break;
            case 'warning': elements.toast.style.backgroundColor = '#f59e0b'; break;
            case 'error': elements.toast.style.backgroundColor = '#ef4444'; break;
            default: elements.toast.style.backgroundColor = '#1f2937';
        }
    } else {
        switch (type) {
            case 'success': elements.toast.classList.add('bg-green-600'); break;
            case 'warning': elements.toast.classList.add('bg-yellow-500'); break;
            case 'error': elements.toast.classList.add('bg-red-600'); break;
            default: elements.toast.classList.add('bg-gray-800');
        }
    }


    elements.toast.style.display = 'block';
    setTimeout(() => {
        if(!isDesktopUI) elements.toast.classList.remove('opacity-0')
    }, 10);

    toastTimeout = setTimeout(() => {
        if(!isDesktopUI) elements.toast.classList.add('opacity-0');
        setTimeout(() => elements.toast.style.display = 'none', 300);
    }, duration);
}

async function loadTodaysOrdersForReprint() {
    if (!elements.todaysOrdersList) return;
    elements.todaysOrdersList.innerHTML = '<p class="text-xs text-gray-500 italic">' + t('ui.orderHistory.loadingToday','Loading today\'s orders...') + '</p>';
    try {
        const dateEl = document.getElementById('ohDate');
        const rangeEl = document.getElementById('ohRange');
        const startEl = document.getElementById('ohStart');
        const endEl = document.getElementById('ohEnd');
        const searchEl = document.getElementById('ohSearch');
        const dateStr = (dateEl && dateEl.value) ? dateEl.value : new Date().toISOString().slice(0,10);
        const range = rangeEl ? (rangeEl.value || 'all') : 'all';
        let url = `/api/orders_by_date?date=${encodeURIComponent(dateStr)}&range=${encodeURIComponent(range)}`;
        if (range === 'custom' && startEl && endEl && startEl.value && endEl.value) {
            url += `&start=${encodeURIComponent(startEl.value)}&end=${encodeURIComponent(endEl.value)}`;
        }
        const response = await fetch(url);
        if (!response.ok) {
            const errorData = await response.json().catch(() => ({
                message: `HTTP ${response.status}`
            }));
            throw new Error(errorData.message || `Failed to load orders: ${response.statusText}`);
        }
        let orders = await response.json();
        // Client-side search filter
        const q = (searchEl && (searchEl.value || '').trim().toLowerCase()) || '';
        if (q) {
            orders = orders.filter(o => String(o.order_number||'').toLowerCase().includes(q) || String(o.table_number||'').toLowerCase().includes(q));
        }
        renderTodaysOrdersList(orders);
    } catch (error) {
        console.error("Error loading today's orders for reprint:", error);
        elements.todaysOrdersList.innerHTML = `<p class="text-xs text-red-500 italic">${t('ui.orderHistory.errorLoading','Error loading orders:')} ${error.message}. ${t('ui.orderHistory.tryRefreshing','Try refreshing.')}</p>`;
        showToast(`${t('ui.orderHistory.errorLoading','Error loading orders:')} ${error.message}`, 'error');
    }
}

function renderTodaysOrdersList(orders) {
    if (!elements.todaysOrdersList) return;
    elements.todaysOrdersList.innerHTML = '';

    if (!orders || orders.length === 0) {
        elements.todaysOrdersList.innerHTML = '<p class="text-xs text-gray-500 italic">No orders found for today.</p>';
        return;
    }
    
    const isDesktopUI = document.body.classList.contains('desktop-ui');

    orders.forEach(order => {
        const div = document.createElement('div');
        let formattedTimestamp = order.timestamp;
        try {
            const dateObj = new Date(order.timestamp);
            if (!isNaN(dateObj)) {
                formattedTimestamp = dateObj.toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit'
                });
            }
        } catch (e) { /* keep original */ }

        // Unified mobile-style row for both UIs
        div.className = "p-2.5 border border-gray-300 rounded-md bg-white hover:bg-gray-50";
        div.innerHTML = `
            <div class="flex justify-between items-center text-sm">
                <div>
                    <span class="font-semibold text-gray-800">${t('ui.orderHistory.orderNumber','Order #')}${order.order_number}</span>
                    <span class="text-xs text-gray-600 ml-2">Table: ${order.table_number || 'N/A'}</span>
                    <span class="text-xs text-gray-500 ml-2">${t('ui.orderHistory.time','Time:')} ${formattedTimestamp}</span>
                    <span class="text-xs text-gray-500 ml-2">Total: €${order.order_total || '-'}</span>
                </div>
                <div class="flex items-center gap-1">
                    <button onclick=\"toggleOrderDetails('${order.order_number}')\" class=\"px-3 py-1.5 text-xs btn-secondary rounded hover:opacity-80 transition\">Details</button>
                    <button onclick=\"reprintOrder('${order.order_number}')\" class=\"px-3 py-1.5 text-xs btn-primary text-white rounded hover:opacity-80 transition\">
                        <i class=\"fas fa-print mr-1\"></i> ${t('ui.orderHistory.reprint','Reprint')}
                    </button>
                </div>
            </div>
            <div id="order-details-${order.order_number}" class="hidden mt-2 p-2 bg-gray-50 border border-gray-200 rounded"></div>
        `;
        elements.todaysOrdersList.appendChild(div);
    });
}

// Initialize default date and toggle custom time UI
document.addEventListener('DOMContentLoaded', () => {
    const dateEl = document.getElementById('ohDate');
    const rangeEl = document.getElementById('ohRange');
    const customBox = document.getElementById('ohCustomRange');
    if (dateEl) {
        dateEl.value = new Date().toISOString().slice(0,10);
    }
    if (rangeEl && customBox) {
        rangeEl.addEventListener('change', () => {
            if (rangeEl.value === 'custom') customBox.classList.remove('hidden');
            else customBox.classList.add('hidden');
        });
    }
});

async function toggleOrderDetails(orderNumber) {
    const container = document.getElementById(`order-details-${orderNumber}`);
    if (!container) return;
    const isHidden = container.classList.contains('hidden');
    if (!isHidden) {
        container.classList.add('hidden');
        container.innerHTML = '';
        return;
    }
    container.classList.remove('hidden');
    container.innerHTML = '<p class="text-xs text-gray-500 italic">Loading details...</p>';
    try {
        const todayStr = new Date().toISOString().slice(0,10);
        const resp = await fetch(`/api/order_details?date=${todayStr}&order_number=${encodeURIComponent(orderNumber)}`);
        const data = await resp.json();
        if (!resp.ok || data.status === 'error') {
            throw new Error(data.message || `HTTP ${resp.status}`);
        }
        const itemsHtml = (data.items || []).map(it => {
            const opts = (it.generalSelectedOptions || []).map(o => `${o.name}${(o.priceChange||0)?` (+€${Number(o.priceChange).toFixed(2)})`:''}`).join(', ');
            const comment = (it.comment||'').trim();
            return `<li class="mb-1"><span class="font-medium">${it.quantity}x ${it.name}</span> - €${Number(it.itemPriceWithModifiers || it.basePrice || 0).toFixed(2)}${opts?`<div class='text-xs text-gray-600'>Options: ${opts}</div>`:''}${comment?`<div class='text-xs text-gray-600'>Note: ${comment}</div>`:''}</li>`;
        }).join('');
        container.innerHTML = `
            <div class="text-xs text-gray-700">
                <div class="flex flex-wrap gap-3 mb-2">
                    <span><span class="text-gray-500">Table:</span> ${data.table_number || 'N/A'}</span>
                    <span><span class="text-gray-500">Payment:</span> ${String(data.payment_method||'Cash').toUpperCase()}</span>
                    <span><span class="text-gray-500">Total:</span> €${Number(data.order_total||0).toFixed(2)}</span>
                </div>
                ${data.universal_comment ? `<div class="mb-2"><span class="text-gray-500">Order Notes:</span> ${data.universal_comment}</div>` : ''}
                <ul class="list-disc ml-5">
                    ${itemsHtml || '<li class="italic text-gray-500">No items.</li>'}
                </ul>
            </div>
        `;
    } catch (e) {
        container.innerHTML = `<p class="text-xs text-red-600">Failed to load details: ${e.message}</p>`;
    }
}


async function reprintOrder(orderNumToReprint) {
    if (!orderNumToReprint) {
        showToast(t('ui.orderHistory.invalidOrderForReprint','Invalid order number for reprint.'), 'error');
        return;
    }

    const reprintButton = event.target.closest('button');
    if (reprintButton) {
        reprintButton.disabled = true;
        reprintButton.innerHTML = '<i class="fas fa-spinner fa-spin mr-1"></i> ' + t('ui.orderHistory.reprinting','Reprinting...');
    }

    try {
        const response = await fetch('/api/reprint_order', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                order_number: orderNumToReprint
            })
        });
        const result = await response.json();

        if (response.ok) {
            if (result.status === "success") {
                showToast(result.message || `${t('ui.orderHistory.orderNumber','Order #')}${orderNumToReprint} ${t('ui.orderHistory.reprintedSuccess','REPRINTED successfully!')}`, 'success');
            } else if (result.status === "warning_reprint_copy2_failed") {
                showToast(result.message || `${t('ui.orderHistory.orderNumber','Order #')}${orderNumToReprint}${t('ui.orderHistory.kitchenReprintedCopy2Failed',': Kitchen REPRINTED. Copy 2 FAILED.')}`, 'warning', 7000);
            } else {
                showToast(result.message || `${t('ui.orderHistory.failedReprint','Failed to reprint')} ${t('ui.orderHistory.orderNumber','Order #')}${orderNumToReprint}.`, 'error', 7000);
            }
        } else {
            showToast(result.message || `${t('ui.orderHistory.serverErrorDuringReprint','Server error during reprint of')} ${t('ui.orderHistory.orderNumber','Order #')}${orderNumToReprint}: ${response.status}.`, 'error', 7000);
        }

    } catch (error) {
        console.error(`Error reprinting order ${orderNumToReprint}:`, error);
        showToast(`${t('ui.orderHistory.networkErrorDuringReprint','Network error or invalid response while reprinting')} ${t('ui.orderHistory.orderNumber','Order #')}${orderNumToReprint}.`, 'error', 7000);
    } finally {
        if (reprintButton) {
            reprintButton.disabled = false;
            reprintButton.innerHTML = '<i class="fas fa-print mr-1"></i> ' + t('ui.orderHistory.reprint','Reprint');
        }
    }
}

async function openDaySummaryModal() {
    if (!elements.daySummaryModal || !elements.daySummaryContent) {
        // Try to find them again
        elements.daySummaryModal = document.getElementById('daySummaryModal');
        elements.daySummaryContent = document.getElementById('daySummaryContent');
        
        if (!elements.daySummaryModal || !elements.daySummaryContent) {
            return;
        }
    }
    
    // Handle different UI variants
    const isDesktopUI = document.body.classList.contains('desktop-ui');
    if (isDesktopUI) {
        elements.daySummaryModal.style.display = 'flex';
    } else {
        elements.daySummaryModal.classList.remove('hidden');
        elements.daySummaryModal.classList.add('flex');
    }
    elements.daySummaryContent.innerHTML = '<p class="text-center italic">' + t('ui.daySummary.loading', 'Loading summary...') + '</p>';

    try {
        const response = await fetch('/api/daily_summary');
        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(errorText || `Server error: ${response.status}`);
        }
        const summary = await response.json();
        renderDaySummary(summary);
    } catch (error) {
        elements.daySummaryContent.innerHTML = `<p class="text-center text-red-500">Error loading summary: ${error.message}</p>`;
    }
}

function closeDaySummaryModal() {
    if (!elements.daySummaryModal) return;
    
    // Handle different UI variants
    const isDesktopUI = document.body.classList.contains('desktop-ui');
    if (isDesktopUI) {
        elements.daySummaryModal.style.display = 'none';
    } else {
        elements.daySummaryModal.classList.add('hidden');
        elements.daySummaryModal.classList.remove('flex');
    }
}

function renderDaySummary(summary) {
    if (!elements.daySummaryContent) return;

    if (summary.status === 'error') {
        elements.daySummaryContent.innerHTML = `<p class="text-center text-red-500">${summary.message}</p>`;
        return;
    }

    elements.daySummaryContent.innerHTML = `
        <div class="space-y-3 text-base">
            <div class="flex justify-between items-center py-2 border-b">
                <span class="font-medium text-gray-600">${t('ui.daySummary.totalOrders','Total Orders:')}</span>
                <span class="font-semibold text-gray-800">${summary.total_orders}</span>
            </div>
            <div class="flex justify-between items-center py-2 border-b">
                <span class="font-medium text-gray-600">${t('ui.daySummary.totalCash','Total Cash Payments:')}</span>
                <span class="font-semibold text-green-600">€${summary.cash_total.toFixed(2)}</span>
            </div>
            <div class="flex justify-between items-center py-2 border-b">
                <span class="font-medium text-gray-600">${t('ui.daySummary.totalCard','Total Card Payments:')}</span>
                <span class="font-semibold text-blue-600">€${summary.card_total.toFixed(2)}</span>
            </div>
            <div class="flex justify-between items-center pt-3 mt-2 border-t-2 border-black">
                <span class="text-lg font-bold text-gray-900">${t('ui.daySummary.grandTotal','Grand Total:')}</span>
                <span class="font-semibold text-gray-900">€${summary.grand_total.toFixed(2)}</span>
            </div>
        </div>
    `;
}

// --- Analytics Functions ---

function toggleCustomDateRangeUI(buttonEl) {
    const picker = document.getElementById('custom-date-range-picker');
    if (!picker) return;

    document.querySelectorAll('.date-range-btn').forEach(btn => btn.classList.remove('active'));
    buttonEl.classList.add('active');

    picker.classList.toggle('hidden');

    if (!picker.classList.contains('hidden')) {
        const endDateInput = document.getElementById('endDate');
        const startDateInput = document.getElementById('startDate');
        const today = new Date().toISOString().split('T')[0];
        endDateInput.value = today;
        if (!startDateInput.value) {
            startDateInput.value = today;
        }
    }
}

async function fetchAnalytics(url) {
    const analyticsContainer = document.getElementById('analyticsManagement');
    
    if (!analyticsContainer) {
        showToast('Analytics container not found', 'error');
        return;
    }
    
    analyticsContainer.querySelectorAll('.font-bold.text-gray-900').forEach(el => el.textContent = '...');
    analyticsContainer.querySelectorAll('.max-h-48, .max-h-64, #analytics-chart-container').forEach(el => el.innerHTML = '<p class="text-xs text-gray-500 italic p-4">Loading data...</p>');

    try {
        const response = await fetch(url);
        if (!response.ok) {
            const errorData = await response.json().catch(() => ({
                message: `HTTP ${response.status}`
            }));
            throw new Error(errorData.message || 'Failed to load analytics data');
        }
        const data = await response.json();
        renderAnalytics(data);
        showToast(`Analytics loaded successfully.`, "success");
    } catch (error) {
        showToast(`Error loading analytics: ${error.message}`, 'error');
        console.error("Analytics load error:", error);
    }
}

function loadAnalyticsData(range = 'today', buttonEl = null) {
    document.querySelectorAll('.date-range-btn').forEach(btn => btn.classList.remove('active'));
    if (buttonEl) buttonEl.classList.add('active');

    const picker = document.getElementById('custom-date-range-picker');
    if (picker) picker.classList.add('hidden');

    fetchAnalytics(`/api/analytics?range=${range}`);
}

function fetchCustomDateRangeAnalytics() {
    const startDate = document.getElementById('startDate').value;
    const endDate = document.getElementById('endDate').value;

    if (!startDate || !endDate) {
        showToast('Please select both a start and end date.', 'warning');
        return;
    }
    if (new Date(startDate) > new Date(endDate)) {
        showToast('Start date cannot be after the end date.', 'warning');
        return;
    }

    fetchAnalytics(`/api/analytics?range=custom&start=${startDate}&end=${endDate}`);
}


function renderAnalytics(data) {
    const isDesktopUI = document.body.classList.contains('desktop-ui');
    
    document.getElementById('kpi-gross-revenue').textContent = `€${(data.grossRevenue || 0).toFixed(2)}`;
    document.getElementById('kpi-total-orders').textContent = data.totalOrders || 0;
    document.getElementById('kpi-atv').textContent = `€${(data.atv || 0).toFixed(2)}`;

    // No card/cash metrics or fees/net revenue required

    // Items per order
    const itemsPerOrder = (data.totalItems && data.totalOrders) ? (data.totalItems / data.totalOrders) : 0;
    const itemsPerOrderEl = document.getElementById('kpi-items-per-order');
    if (itemsPerOrderEl) itemsPerOrderEl.textContent = itemsPerOrder > 0 ? itemsPerOrder.toFixed(2) : '-';

    // Payment metrics removed per requirements

    // Dine-in only deployment: remove takeaway-related UI and logic

    if (isDesktopUI) {
        renderList('kpi-sales-by-category', data.salesByCategory, item => `
            <div style="display: flex; justify-content: space-between; font-size: 0.875rem;">
                <span style="color: #4b5563; text-overflow: ellipsis; overflow: hidden; white-space: nowrap; padding-right: 0.5rem;">${item.category}</span>
                <span style="font-weight: 500; color: #1f2937; white-space: nowrap;">€${(item.total || 0).toFixed(2)}</span>
            </div>`, "No category sales yet.");

        renderList('kpi-top-revenue-items', data.topRevenueItems, item => `
            <div style="display: flex; justify-content: space-between; font-size: 0.875rem;">
                <span style="color: #4b5563; text-overflow: ellipsis; overflow: hidden; white-space: nowrap; padding-right: 0.5rem;">${item.name}</span>
                <span style="font-weight: 500; color: #1f2937; white-space: nowrap;">€${(item.revenue || 0).toFixed(2)}</span>
            </div>`, "No items sold yet.");

        renderList('kpi-best-sellers', data.bestSellers, item => `
            <div style="display: flex; justify-content: space-between; font-size: 0.875rem;">
                <span style="color: #4b5563; text-overflow: ellipsis; overflow: hidden; white-space: nowrap; padding-right: 0.5rem;">${item.name}</span>
                <span style="font-weight: 500; color: #1f2937; white-space: nowrap;">${item.quantity} sold</span>
            </div>`, "No items sold yet.");

        renderList('kpi-worst-sellers', data.worstSellers, item => `
            <div style="display: flex; justify-content: space-between; font-size: 0.875rem;">
                <span style="color: #4b5563; text-overflow: ellipsis; overflow: hidden; white-space: nowrap; padding-right: 0.5rem;">${item.name}</span>
                <span style="font-weight: 500; color: #1f2937; white-space: nowrap;">${item.quantity} sold</span>
            </div>`, "No underperforming items found.");
    } else {
        renderList('kpi-sales-by-category', data.salesByCategory, item => `
            <div class="flex justify-between text-sm">
                <span class="text-gray-600 truncate pr-2">${item.category}</span>
                <span class="font-medium text-gray-800 whitespace-nowrap">€${(item.total || 0).toFixed(2)}</span>
            </div>`, "No category sales yet.");

        renderList('kpi-top-revenue-items', data.topRevenueItems, item => `
            <div class="flex justify-between text-sm">
                <span class="text-gray-600 truncate pr-2">${item.name}</span>
                <span class="font-medium text-gray-800 whitespace-nowrap">€${(item.revenue || 0).toFixed(2)}</span>
            </div>`, "No items sold yet.");

        renderList('kpi-best-sellers', data.bestSellers, item => `
            <div class="flex justify-between text-sm">
                <span class="text-gray-600 truncate pr-2">${item.name}</span>
                <span class="font-medium text-gray-800 whitespace-nowrap">${item.quantity} sold</span>
            </div>`, "No items sold yet.");

        renderList('kpi-worst-sellers', data.worstSellers, item => `
            <div class="flex justify-between text-sm">
                <span class="text-gray-600 truncate pr-2">${item.name}</span>
                <span class="font-medium text-gray-800 whitespace-nowrap">${item.quantity} sold</span>
            </div>`, "No underperforming items found.");
    }

    renderSalesByHourChart(data.salesByHour);

    // Top add-ons/options
    const addonsContainer = document.getElementById('kpi-top-addons');
    if (addonsContainer) {
        const items = data.topAddons || [];
        if (items.length === 0) {
            addonsContainer.innerHTML = isDesktopUI ? '<p style="font-size: 0.75rem; color: #6b7280; font-style: italic; padding: 0.5rem;">No add‑on data.</p>' : '<p class="text-xs text-gray-500 italic p-2">No add‑on data.</p>';
        } else {
            addonsContainer.innerHTML = items.map(a => `
                <div class="flex justify-between text-sm">
                    <span class="text-gray-600 truncate pr-2">${a.name}</span>
                    <span class="font-medium text-gray-800 whitespace-nowrap">€${(a.revenue || 0).toFixed(2)} • ${a.attachRate ? Math.round(a.attachRate*100) : 0}%</span>
                </div>
            `).join('');
        }
    }
}

function renderList(containerId, items, templateFn, emptyMessage) {
    const container = document.getElementById(containerId);
    const isDesktopUI = document.body.classList.contains('desktop-ui');
    container.innerHTML = '';
    
    if (items && items.length > 0) {
        items.forEach(item => {
            container.innerHTML += templateFn(item);
        });
    } else {
        if (isDesktopUI) {
            container.innerHTML = `<p style="font-size: 0.75rem; color: #6b7280; font-style: italic; padding: 0.5rem;">${emptyMessage}</p>`;
        } else {
            container.innerHTML = `<p class="text-xs text-gray-500 italic p-2">${emptyMessage}</p>`;
        }
    }
}

function renderSalesByHourChart(salesByHour) {
    const container = document.getElementById('analytics-chart-container');
    const isDesktopUI = document.body.classList.contains('desktop-ui');
    container.innerHTML = '';

    if (!salesByHour || salesByHour.length === 0) {
        if (isDesktopUI) {
            container.innerHTML = '<p style="font-size: 0.75rem; color: #6b7280; font-style: italic; width: 100%; text-align: center; align-self: center;">No sales data for this period.</p>';
        } else {
            container.innerHTML = '<p class="text-xs text-gray-500 italic w-full text-center self-center">No sales data for this period.</p>';
        }
        container.style.minWidth = 'auto';
        return;
    }

    const barWidth = 40;
    const spaceWidth = 16;
    container.style.minWidth = `${salesByHour.length * (barWidth + spaceWidth) + 60}px`;
    container.style.maxHeight = '100%';
    container.style.overflowY = 'hidden';
    container.style.position = 'relative';

    const maxRevenue = Math.max(...salesByHour.map(h => h.total), 0);

    // Create global tooltip
    const tooltip = document.createElement('div');
    tooltip.id = 'chart-tooltip';
    tooltip.style.cssText = `
        position: absolute;
        background: #1f2937;
        color: white;
        padding: 8px 12px;
        border-radius: 6px;
        font-size: 12px;
        font-weight: 600;
        pointer-events: none;
        z-index: 1000;
        box-shadow: 0 4px 12px rgba(0,0,0,0.3);
        opacity: 0;
        transition: opacity 0.2s ease;
        white-space: nowrap;
    `;
    container.appendChild(tooltip);

    // Y-axis (5 ticks)
    const yAxis = document.createElement('div');
    if (isDesktopUI) {
        yAxis.style.cssText = 'display:flex; flex-direction:column; justify-content:space-between; height:100%; margin-right:8px; color:#6b7280; font-size:12px;';
    } else {
        yAxis.className = 'flex flex-col justify-between h-full mr-2 text-gray-500 text-xs';
    }
    const ticks = 5;
    for (let i = ticks; i >= 0; i--) {
        const val = (maxRevenue / ticks) * i;
        const lbl = document.createElement('div');
        lbl.textContent = `€${val.toFixed(0)}`;
        if (isDesktopUI) {
            lbl.style.cssText = 'height:1px; transform:translateY(6px)';
        }
        yAxis.appendChild(lbl);
    }
    container.appendChild(yAxis);

    salesByHour.forEach(hourData => {
        const barHeight = maxRevenue > 0 ? (hourData.total / maxRevenue) * 100 : 0;
        const barWrapper = document.createElement('div');
        
        if (isDesktopUI) {
            barWrapper.style.cssText = 'width: 2.5rem; display: flex; flex-direction: column; align-items: center; justify-content: flex-end; height: 100%;';
        } else {
            barWrapper.className = 'w-10 flex flex-col items-center justify-end h-full';
        }

        // Create bar container
        const barContainer = document.createElement('div');
        if (isDesktopUI) {
            barContainer.style.cssText = 'width: 100%; height: 100%; display: flex; align-items: flex-end; justify-content: center; position: relative;';
        } else {
            barContainer.className = 'w-full h-full flex items-end justify-center relative';
        }

        // Create the bar
        const bar = document.createElement('div');
        if (isDesktopUI) {
            bar.style.cssText = `
                background-color: #4f46e5;
                width: 75%;
                border-radius: 2px 2px 0 0;
                transition: all 0.3s ease;
                height: ${barHeight}%;
                box-shadow: 0 2px 4px rgba(0,0,0,0.1);
                cursor: pointer;
            `;
        } else {
            bar.className = 'bg-indigo-600 w-3/4 rounded-t-sm transition-all duration-300 shadow-sm cursor-pointer';
            bar.style.height = `${barHeight}%`;
        }

        // Add event listeners
        bar.addEventListener('mouseenter', function(e) {
            // Update tooltip
            tooltip.textContent = `€${hourData.total.toFixed(2)}`;
            tooltip.style.opacity = '1';
            
            // Position tooltip inside the chart area - to the right of the bar
            const rect = this.getBoundingClientRect();
            const containerRect = container.getBoundingClientRect();
            const tooltipRect = tooltip.getBoundingClientRect();
            
            let left = rect.right - containerRect.left + 10; // Position to the right of the bar
            let top = rect.top - containerRect.top + (rect.height / 2) - 12; // Center vertically on the bar
            
            // If tooltip would go outside right edge, position it to the left of the bar
            if (left + tooltipRect.width > container.offsetWidth - 5) {
                left = rect.left - containerRect.left - tooltipRect.width - 10;
            }
            
            // Keep tooltip within vertical bounds
            if (top < 5) top = 5;
            if (top + tooltipRect.height > container.offsetHeight - 5) top = container.offsetHeight - tooltipRect.height - 5;
            
            tooltip.style.left = left + 'px';
            tooltip.style.top = top + 'px';
            
            // Style bar
            if (isDesktopUI) {
                this.style.backgroundColor = '#6366f1';
                this.style.transform = 'scale(1.05)';
            } else {
                this.classList.add('bg-indigo-500', 'scale-105');
                this.classList.remove('bg-indigo-600');
            }
        });

        bar.addEventListener('mouseleave', function(e) {
            // Hide tooltip
            tooltip.style.opacity = '0';
            
            // Reset bar
            if (isDesktopUI) {
                this.style.backgroundColor = '#4f46e5';
                this.style.transform = 'scale(1)';
            } else {
                this.classList.remove('bg-indigo-500', 'scale-105');
                this.classList.add('bg-indigo-600');
            }
        });

        // Create hour label
        const hourLabel = document.createElement('span');
        if (isDesktopUI) {
            hourLabel.style.cssText = 'font-size: 0.75rem; color: #6b7280; margin-top: 0.25rem;';
        } else {
            hourLabel.className = 'text-xs text-gray-500 mt-1';
        }
        hourLabel.textContent = String(hourData.hour).padStart(2, '0');

        // Assemble
        barContainer.appendChild(bar);
        barWrapper.appendChild(barContainer);
        barWrapper.appendChild(hourLabel);
        container.appendChild(barWrapper);
    });
}

function renderDaypartChart(dayparts) {
    const container = document.getElementById('analytics-daypart-container');
    if (!container) return;
    const isDesktopUI = document.body.classList.contains('desktop-ui');
    container.innerHTML = '';
    container.style.position = 'relative';
    container.style.overflow = 'hidden';

    const data = dayparts && dayparts.length ? dayparts : [
        { label: 'Morning', total: 0 },
        { label: 'Lunch', total: 0 },
        { label: 'Afternoon', total: 0 },
        { label: 'Evening', total: 0 }
    ];

    const max = Math.max(...data.map(d => d.total), 0) || 1;

    // Y-axis (5 ticks)
    const yAxis = document.createElement('div');
    if (isDesktopUI) {
        yAxis.style.cssText = 'display:flex; flex-direction:column; justify-content:space-between; height:100%; margin-right:8px; color:#6b7280; font-size:12px;';
    } else {
        yAxis.className = 'flex flex-col justify-between h-full mr-2 text-gray-500 text-xs';
    }
    const ticks = 5;
    for (let i = ticks; i >= 0; i--) {
        const val = (max / ticks) * i;
        const lbl = document.createElement('div');
        lbl.textContent = `€${val.toFixed(0)}`;
        if (isDesktopUI) {
            lbl.style.cssText = 'height:1px; transform:translateY(6px)';
        }
        yAxis.appendChild(lbl);
    }
    container.appendChild(yAxis);

    const bars = document.createElement('div');
    if (isDesktopUI) {
        bars.style.cssText = 'display:flex; align-items:flex-end; height:100%; gap:12px;';
    } else {
        bars.className = 'h-full flex items-end gap-3';
    }

    data.forEach(d => {
        const h = (d.total / max) * 100;
        const wrap = document.createElement('div');
        if (isDesktopUI) {
            wrap.style.cssText = 'width:56px; display:flex; flex-direction:column; align-items:center; justify-content:flex-end; height:100%;';
            wrap.innerHTML = `
                <div style=\"width:100%; height:100%; display:flex; align-items:flex-end; justify-content:center; position:relative;\">
                    <div style=\"background-color:#111827; width:70%; height:${h}%; border-radius:2px; transition:background-color 0.2s;\" onmouseover=\"this.nextElementSibling.style.opacity='1'; this.style.backgroundColor='#3b82f6'\" onmouseout=\"this.nextElementSibling.style.opacity='0'; this.style.backgroundColor='#111827'\"></div>
                    <div style=\"position:absolute; bottom: 100%; margin-bottom: 0.25rem; width: max-content; padding: 0.25rem 0.5rem; background-color: #1f2937; color: white; font-size: 0.75rem; border-radius: 0.25rem; opacity: 0; transition: opacity 0.2s; pointer-events: none; z-index: 10;\">€${(d.total || 0).toFixed(2)}</div>
                </div>
                <span style=\"font-size:12px; color:#6b7280; margin-top:4px;\">${d.label}</span>
            `;
        } else {
            wrap.className = 'w-14 flex flex-col items-center justify-end h-full';
            wrap.innerHTML = `
                <div class=\"w-full h-full flex items-end justify-center relative\">
                    <div class=\"bg-gray-900 w-3/4\" style=\"height:${h}%; border-radius:2px\" onmouseover=\"this.nextElementSibling.classList.remove('opacity-0'); this.classList.add('bg-indigo-600')\" onmouseout=\"this.nextElementSibling.classList.add('opacity-0'); this.classList.remove('bg-indigo-600')\"></div>
                    <div class=\"absolute bottom-full mb-1 w-max px-2 py-1 bg-gray-800 text-white text-xs rounded opacity-0 transition-opacity pointer-events-none z-10\">€${(d.total || 0).toFixed(2)}</div>
                </div>
                <span class=\"text-xs text-gray-500 mt-1\">${d.label}</span>
            `;
        }
        bars.appendChild(wrap);
    });

    container.appendChild(bars);

    // X-axis line just above labels area
    const xAxis = document.createElement('div');
    if (isDesktopUI) {
        xAxis.style.cssText = 'position:absolute; left:0; right:0; bottom:22px; height:1px; background:#e5e7eb;';
    } else {
        xAxis.className = 'absolute left-0 right-0';
        xAxis.style.bottom = '22px';
        xAxis.style.height = '1px';
        xAxis.style.background = '#e5e7eb';
    }
    container.appendChild(xAxis);
}

async function shutdownApplication() {
    if (!confirm('Are you sure you want to shut down the POSPal application? This will close the server for all users.')) {
        return;
    }

    try {
        const response = await fetch('/api/shutdown', {
            method: 'POST',
        });
        const result = await response.json();
        if (result.status === 'success') {
            showToast('Server is shutting down...', 'info', 5000);
            document.body.innerHTML = `
                <div class="fixed inset-0 bg-gray-900 flex flex-col items-center justify-center text-white p-8">
                    <h1 class="text-4xl font-bold mb-4">POSPal is Shutting Down</h1>
                    <p class="text-lg text-gray-300">You can now safely close this window.</p>
                </div>
            `;
            setTimeout(() => {
                window.close();
            }, 3000);
        } else {
            showToast(result.message || 'Failed to initiate shutdown.', 'error');
        }
    } catch (error) {
        console.log('Shutdown command sent. The server is likely closing the connection, which is normal.');
        showToast('Shutdown command sent. The server is closing.', 'info', 5000);
        document.body.innerHTML = `
            <div class="fixed inset-0 bg-gray-900 flex flex-col items-center justify-center text-white p-8">
                <h1 class="text-4xl font-bold mb-4">POSPal is Shutting Down</h1>
                <p class="text-lg text-gray-300">You can now safely close this window.</p>
            </div>
        `;
        setTimeout(() => {
            window.close();
        }, 3000);
    }
}

async function checkAndDisplayTrialStatus() {
    try {
        const response = await fetch('/api/trial_status');
        if (!response.ok) throw new Error('Could not fetch trial status');
        const status = await response.json();

        const statusDisplay = elements.licenseStatusDisplay;
        const footerStatusDisplay = elements.footerTrialStatus;
        
        // Get new UI elements
        const statusBadge = document.getElementById('license-status-badge');
        const subscriptionDetails = document.getElementById('subscription-details');
        const trialActions = document.getElementById('trial-actions');
        const activationInstructions = document.getElementById('activation-instructions');
        const nextBillingDate = document.getElementById('next-billing-date');

        if (status.licensed) {
            let licensedHTML, badgeHTML, badgeClass;
            
            if (status.subscription) {
                // Subscription license
                const validUntil = status.valid_until ? new Date(status.valid_until).toLocaleDateString() : '';
                const daysLeft = status.days_left || 0;
                licensedHTML = `Your subscription is active and will renew on ${validUntil}.`;
                badgeHTML = `Active Subscription`;
                badgeClass = 'bg-green-100 text-green-800';
                
                // Show subscription management UI
                if (subscriptionDetails) subscriptionDetails.classList.remove('hidden');
                if (trialActions) trialActions.classList.add('hidden');
                if (activationInstructions) activationInstructions.classList.add('hidden');
                
                // Update next billing date
                if (nextBillingDate) {
                    nextBillingDate.textContent = validUntil || 'Unknown';
                }
                
                // Footer status
                const footerHTML = `<i class="fas fa-check-circle text-green-600 mr-2"></i>Subscription Active (${daysLeft} days)`;
                if (footerStatusDisplay) {
                    footerStatusDisplay.innerHTML = footerHTML;
                    footerStatusDisplay.className = 'font-medium text-green-600';
                }
            } else {
                // Permanent license
                licensedHTML = `You have a permanent license. No subscription required.`;
                badgeHTML = `Permanent License`;
                badgeClass = 'bg-blue-100 text-blue-800';
                
                // Hide subscription management UI
                if (subscriptionDetails) subscriptionDetails.classList.add('hidden');
                if (trialActions) trialActions.classList.add('hidden');
                if (activationInstructions) activationInstructions.classList.add('hidden');
                
                // Footer status
                const footerHTML = `<i class="fas fa-check-circle text-green-600 mr-2"></i>Fully Licensed`;
                if (footerStatusDisplay) {
                    footerStatusDisplay.innerHTML = footerHTML;
                    footerStatusDisplay.className = 'font-medium text-green-600';
                }
            }
            
            // Update main status display
            if (statusDisplay) statusDisplay.innerHTML = licensedHTML;
            if (statusBadge) {
                statusBadge.innerHTML = badgeHTML;
                statusBadge.className = `px-3 py-1 rounded-full text-sm font-medium ${badgeClass}`;
            }
            
        } else if (status.subscription_expired) {
            const expiredHTML = `Your subscription has expired. Renew now to regain access to your data.`;
            const badgeHTML = `Subscription Expired`;
            const badgeClass = 'bg-red-100 text-red-800';
            
            // Update displays
            if (statusDisplay) statusDisplay.innerHTML = expiredHTML;
            if (statusBadge) {
                statusBadge.innerHTML = badgeHTML;
                statusBadge.className = `px-3 py-1 rounded-full text-sm font-medium ${badgeClass}`;
            }
            
            // Show trial actions, hide subscription management
            if (subscriptionDetails) subscriptionDetails.classList.add('hidden');
            if (trialActions) trialActions.classList.remove('hidden');
            if (activationInstructions) activationInstructions.classList.add('hidden');
            
            // Footer status
            const footerHTML = `<i class="fas fa-times-circle text-red-600 mr-2"></i>Subscription Expired`;
            if (footerStatusDisplay) {
                footerStatusDisplay.innerHTML = footerHTML;
                footerStatusDisplay.className = 'font-medium text-red-600';
            }
            
            // Redirect to unlock page for subscription expired  
            showUnlockRedirect('subscription');
            
        } else if (status.expired) {
            const expiredHTML = `Your 30-day trial has ended. Subscribe or buy a permanent license to continue.`;
            const badgeHTML = `Trial Expired`;
            const badgeClass = 'bg-red-100 text-red-800';
            
            // Update displays
            if (statusDisplay) statusDisplay.innerHTML = expiredHTML;
            if (statusBadge) {
                statusBadge.innerHTML = badgeHTML;
                statusBadge.className = `px-3 py-1 rounded-full text-sm font-medium ${badgeClass}`;
            }
            
            // Show trial actions and activation instructions
            if (subscriptionDetails) subscriptionDetails.classList.add('hidden');
            if (trialActions) trialActions.classList.remove('hidden');
            if (activationInstructions) activationInstructions.classList.remove('hidden');
            
            // Footer status
            const footerHTML = `<i class="fas fa-times-circle text-red-600 mr-2"></i>Trial Expired`;
            if (footerStatusDisplay) {
                footerStatusDisplay.innerHTML = footerHTML;
                footerStatusDisplay.className = 'font-medium text-red-600';
            }
            
            // Redirect to unlock page for trial expired
            showUnlockRedirect('trial');
        } else if (status.active) {
            const days = status.days_left;
            const dayText = days === 1 ? 'day' : 'days';
            const trialHTML = `Your 30-day trial is active. ${days} ${dayText} remaining.`;
            const badgeHTML = `Trial Active (${days} ${dayText})`;
            const badgeClass = days <= 5 ? 'bg-yellow-100 text-yellow-800' : 'bg-green-100 text-green-800';
            
            // Update displays
            if (statusDisplay) statusDisplay.innerHTML = trialHTML;
            if (statusBadge) {
                statusBadge.innerHTML = badgeHTML;
                statusBadge.className = `px-3 py-1 rounded-full text-sm font-medium ${badgeClass}`;
            }
            
            // Show trial actions and activation instructions
            if (subscriptionDetails) subscriptionDetails.classList.add('hidden');
            if (trialActions) trialActions.classList.remove('hidden');
            if (activationInstructions) activationInstructions.classList.remove('hidden');
            
            // Footer status
            const footerText = `Trial: ${days} ${dayText} remaining`;
            const footerHTML = `<i class="fas fa-info-circle text-yellow-500 mr-2"></i>${footerText}`;
            if (footerStatusDisplay) {
                footerStatusDisplay.innerHTML = footerHTML;
                footerStatusDisplay.className = 'font-medium text-yellow-500';
            }
        }

    } catch (error) {
        console.error("Error checking trial status:", error);
        if (elements.licenseStatusDisplay) elements.licenseStatusDisplay.textContent = t('ui.footer.statusUnknown','Status Unknown');
        if (elements.footerTrialStatus) {
            elements.footerTrialStatus.textContent = t('ui.footer.statusUnknown','Status Unknown');
            elements.footerTrialStatus.className = 'font-medium text-gray-500';
        }
    }
}

async function loadHardwareId() {
    if (!elements.hardwareIdDisplay) return;
    elements.hardwareIdDisplay.textContent = "Loading...";
    try {
        const response = await fetch('/api/hardware_id');
        if (!response.ok) throw new Error('Failed to fetch Hardware ID');
        const data = await response.json();
        elements.hardwareIdDisplay.textContent = data.hardware_id || 'Not Available';
    } catch (error) {
        console.error("Error fetching hardware ID:", error);
        elements.hardwareIdDisplay.textContent = 'Error loading ID.';
    }
}

function copyHardwareId() {
    const hwid = elements.hardwareIdDisplay.textContent;
    if (hwid && hwid !== 'Loading...' && hwid !== 'Error loading ID.') {
        if (navigator.clipboard && window.isSecureContext) {
            navigator.clipboard.writeText(hwid).then(() => {
                showToast('Hardware ID copied to clipboard!', 'success');
            }).catch(err => {
                showToast('Failed to copy.', 'error');
            });
        } else {
            const textArea = document.createElement("textarea");
            textArea.value = hwid;
            document.body.appendChild(textArea);
            textArea.focus();
            textArea.select();
            try {
                document.execCommand('copy');
                showToast('Hardware ID copied to clipboard!', 'success');
            } catch (err) {
                showToast('Failed to copy.', 'error');
            }
            document.body.removeChild(textArea);
        }
    } else {
        showToast('Hardware ID not available to copy.', 'warning');
    }
}

// --- Auto-publish helper ---
let _autoPublishBusy = false;
async function maybeAutoPublishMenu() {
    try {
        if (_autoPublishBusy) return;
        const cfgResp = await fetch('/api/settings/cloudflare');
        if (!cfgResp.ok) return;
        const cfg = await cfgResp.json();
        const hasCfg = (cfg.cloudflare_api_base && cfg.cloudflare_store_slug);
        if (!hasCfg) return;
        _autoPublishBusy = true;
        const resp = await fetch('/api/publish/cloudflare', { method: 'POST' });
        const res = await resp.json().catch(() => ({}));
        if (res && res.success) {
            const url = res.url || getCloudflareUrlFromInputs();
            const urlEl = document.getElementById('cfMenuUrl');
            if (urlEl) urlEl.value = url || '';
            if (url) renderCloudflareQr(url);
            showToast('Online menu updated.', 'success');
        }
    } catch (_) {
        // Silent failure
    } finally {
        _autoPublishBusy = false;
    }
}

// --- Trial Lock Screen Functions ---
let lockScreenShown = false;

async function showTrialLockScreen(type = 'trial') {
    if (lockScreenShown) return; // Prevent multiple overlays
    
    const lockScreen = document.getElementById('trialLockScreen');
    if (!lockScreen) {
        console.warn('Trial lock screen element not found');
        return;
    }
    
    // Load and display usage analytics
    try {
        const response = await fetch('/api/usage_analytics');
        if (response.ok) {
            const analytics = await response.json();
            updateLockScreenData(analytics);
        }
    } catch (error) {
        console.error('Failed to load analytics for lock screen:', error);
        // Show default values
        updateLockScreenData({
            total_orders: 0,
            total_revenue: 0,
            days_used: 30
        });
    }
    
    // Update the header based on expiration type
    if (type === 'subscription') {
        const header = lockScreen.querySelector('h2');
        if (header) header.textContent = 'Subscription Expired';
        
        const subtitle = lockScreen.querySelector('p');
        if (subtitle) subtitle.textContent = 'Your monthly subscription has expired, but all your data is safe';
    }
    
    // Show the lock screen
    lockScreen.classList.remove('hidden');
    lockScreen.classList.add('flex');
    lockScreenShown = true;
    
    // Disable body scrolling
    document.body.style.overflow = 'hidden';
}

function updateLockScreenData(analytics) {
    // Update orders count
    const ordersElement = document.getElementById('lockscreen-orders-count');
    if (ordersElement) {
        ordersElement.textContent = analytics.total_orders || '0';
    }
    
    // Update revenue amount
    const revenueElement = document.getElementById('lockscreen-revenue-amount');
    if (revenueElement) {
        const revenue = analytics.total_revenue || 0;
        revenueElement.textContent = `€${revenue.toFixed(2)}`;
    }
    
    // Update days used
    const daysElement = document.getElementById('lockscreen-days-used');
    if (daysElement) {
        daysElement.textContent = analytics.days_used || '30';
    }
}

function showUnlockRedirect(type = 'trial') {
    // Show unlock options instead of lock screen
    const message = type === 'subscription' ? 
        'Your subscription has expired. Choose an option to continue:' :
        'Your 30-day trial has ended. Choose an option to continue:';
    
    if (confirm(message + '\n\n✅ Already paid? Click OK to enter unlock code\n❌ Need to pay? Click Cancel to subscribe')) {
        showUnlockDialog();
    } else {
        window.open('unlock-pospal.html', '_blank');
    }
}

function redirectToSubscription() {
    // Redirect to new unlock/payment page
    window.open('unlock-pospal.html', '_blank');
}

function hideLockScreen() {
    const lockScreen = document.getElementById('trialLockScreen');
    if (lockScreen) {
        lockScreen.classList.add('hidden');
        lockScreen.classList.remove('flex');
    }
    
    lockScreenShown = false;
    document.body.style.overflow = 'auto';
}

// --- Subscription Management Functions ---
async function openCustomerPortal() {
    try {
        showToast('Opening customer portal...', 'info');
        
        const response = await fetch('/api/create-portal-session', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            }
        });
        
        if (!response.ok) {
            throw new Error('Failed to create portal session');
        }
        
        const data = await response.json();
        if (data.url) {
            window.open(data.url, '_blank');
        } else {
            throw new Error('No portal URL received');
        }
        
    } catch (error) {
        console.error('Customer portal error:', error);
        showToast('Failed to open customer portal. Please contact support.', 'error');
    }
}

async function updatePaymentMethod() {
    // For now, redirect to customer portal for payment updates
    openCustomerPortal();
}

async function loadUsageStatistics() {
    try {
        const response = await fetch('/api/usage_analytics');
        if (response.ok) {
            const analytics = await response.json();
            updateUsageStatsDisplay(analytics);
        }
    } catch (error) {
        console.error('Failed to load usage statistics:', error);
    }
}

function updateUsageStatsDisplay(analytics) {
    // Update total orders
    const ordersElement = document.getElementById('stats-total-orders');
    if (ordersElement) {
        ordersElement.textContent = analytics.total_orders || '0';
    }
    
    // Update total revenue
    const revenueElement = document.getElementById('stats-total-revenue');
    if (revenueElement) {
        const revenue = analytics.total_revenue || 0;
        revenueElement.textContent = `€${revenue.toFixed(2)}`;
    }
    
    // Update days used
    const daysElement = document.getElementById('stats-days-used');
    if (daysElement) {
        daysElement.textContent = analytics.days_used || '0';
    }
}

// --- Unlock Dialog Functions ---
function showUnlockDialog() {
    const dialog = document.getElementById('unlockTokenDialog');
    if (dialog) {
        dialog.classList.remove('hidden');
        dialog.classList.add('flex');
        
        // Focus on email input
        const emailInput = document.getElementById('unlockEmail');
        if (emailInput) {
            setTimeout(() => emailInput.focus(), 100);
        }
        
        // Disable body scrolling
        document.body.style.overflow = 'hidden';
    }
}

function hideUnlockDialog() {
    const dialog = document.getElementById('unlockTokenDialog');
    if (dialog) {
        dialog.classList.add('hidden');
        dialog.classList.remove('flex');
        
        // Clear form
        const form = document.getElementById('unlockTokenForm');
        if (form) form.reset();
        
        // Hide error
        hideUnlockError();
        
        // Re-enable body scrolling
        document.body.style.overflow = 'auto';
    }
}

function showUnlockError(message) {
    const errorDiv = document.getElementById('unlockError');
    if (errorDiv) {
        errorDiv.textContent = message;
        errorDiv.classList.remove('hidden');
    }
}

function hideUnlockError() {
    const errorDiv = document.getElementById('unlockError');
    if (errorDiv) {
        errorDiv.classList.add('hidden');
    }
}

function setUnlockLoading(loading) {
    const btn = document.getElementById('unlockSubmitBtn');
    const btnText = document.getElementById('unlockBtnText');
    
    if (btn && btnText) {
        btn.disabled = loading;
        if (loading) {
            btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i><span>Validating...</span>';
        } else {
            btn.innerHTML = '<i class="fas fa-unlock mr-2"></i><span>Unlock POSPal</span>';
        }
    }
}

async function generateMachineFingerprint() {
    // Get enhanced hardware ID (same as existing system)
    try {
        const response = await fetch('/api/hardware_id');
        if (response.ok) {
            const data = await response.json();
            return data.hardware_id || 'fallback-fingerprint';
        }
    } catch (error) {
        console.error('Failed to get hardware ID:', error);
    }
    
    // Fallback fingerprint
    return 'fallback-' + Date.now();
}

async function validateUnlockToken(email, token, machineFingerprint) {
    const response = await fetch('https://license.pospal.gr/validate', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            email: email,
            token: token,
            machineFingerprint: machineFingerprint
        })
    });
    
    const result = await response.json();
    return result;
}

function generateLicenseFile(email, token, machineFingerprint, customerName) {
    const licenseData = {
        customer: customerName || email.split('@')[0],
        email: email,
        unlock_token: token,
        machine_fingerprint: machineFingerprint,
        license_type: 'subscription',
        activated_at: new Date().toISOString(),
        version: '2.0.0',
        // Add signature for compatibility
        signature: 'token_based_license'
    };
    
    // Save to local file (this will need to be adapted for desktop app)
    const blob = new Blob([JSON.stringify(licenseData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'license.key';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    
    return licenseData;
}

// Handle unlock form submission and page load events
document.addEventListener('DOMContentLoaded', function() {
    // Set up unlock form handler
    const unlockForm = document.getElementById('unlockTokenForm');
    if (unlockForm) {
        unlockForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            
            const email = document.getElementById('unlockEmail').value.trim();
            const token = document.getElementById('unlockToken').value.trim().toUpperCase();
            
            if (!email || !token) {
                showUnlockError('Please fill in all fields.');
                return;
            }
            
            if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
                showUnlockError('Please enter a valid email address.');
                return;
            }
            
            setUnlockLoading(true);
            hideUnlockError();
            
            try {
                // Generate machine fingerprint
                const machineFingerprint = await generateMachineFingerprint();
                
                // Validate with server
                const result = await validateUnlockToken(email, token, machineFingerprint);
                
                if (result.valid) {
                    // Generate license file
                    generateLicenseFile(email, token, machineFingerprint, result.customerName);
                    
                    // Show success message
                    alert('✅ License validated successfully!\n\nThe license.key file has been downloaded.\n\n📁 Place it next to POSPal.exe and restart the application.');
                    
                    // Hide dialog
                    hideUnlockDialog();
                    
                    // Refresh trial status
                    setTimeout(() => {
                        checkAndDisplayTrialStatus();
                    }, 1000);
                    
                } else {
                    showUnlockError(result.error || 'Invalid email or unlock token. Please check and try again.');
                }
                
            } catch (error) {
                console.error('Unlock validation error:', error);
                showUnlockError('Connection failed. Please check your internet connection and try again.');
            } finally {
                setUnlockLoading(false);
            }
        });
    }
    
    // Format token input as user types
    const tokenInput = document.getElementById('unlockToken');
    if (tokenInput) {
        tokenInput.addEventListener('input', function(e) {
            let value = e.target.value.replace(/[^A-Z0-9]/g, '').toUpperCase();
            
            // Format as POSPAL-XXXX-XXXX-XXXX
            if (value.startsWith('POSPAL')) {
                value = value.substring(6); // Remove POSPAL prefix
            }
            
            // Add dashes every 4 characters
            const segments = [];
            for (let i = 0; i < value.length; i += 4) {
                segments.push(value.substring(i, i + 4));
            }
            
            let formatted = 'POSPAL-' + segments.join('-');
            
            // Limit length
            if (formatted.length > 23) { // POSPAL-XXXX-XXXX-XXXX = 23 chars
                formatted = formatted.substring(0, 23);
            }
            
            e.target.value = formatted;
        });
    }
    
    // Load usage statistics
    loadUsageStatistics();
    
    // Start session management and check subscription status on startup
    setTimeout(async () => {
        const sessionStarted = await startSession();
        if (sessionStarted) {
            await checkSubscriptionStatus();
        }
    }, 1000);
    
    // Set up periodic subscription checks every 4 hours
    setInterval(async () => {
        await checkSubscriptionStatus();
    }, 4 * 60 * 60 * 1000); // 4 hours
    
    // End session when page is closed
    window.addEventListener('beforeunload', () => {
        endSession();
    });
});

// --- Subscription Validation Functions ---

async function checkSubscriptionStatus() {
    try {
        const unlockToken = localStorage.getItem('pospal_unlock_token');
        const customerEmail = localStorage.getItem('pospal_customer_email');
        
        // Check if we have a trial or subscription to validate
        if (!unlockToken || !customerEmail) {
            return handleTrialValidation();
        }
        
        // Check if we're in a valid offline grace period first
        if (isInOfflineGracePeriod()) {
            console.log('Using offline grace period - skipping server validation');
            return; // Continue using app offline
        }
        
        // Check cached status (avoid too frequent API calls when online)
        const lastCheck = localStorage.getItem('pospal_last_validation_check');
        const cacheValid = lastCheck && (Date.now() - parseInt(lastCheck)) < (1000 * 60 * 60); // 1 hour cache
        
        if (cacheValid) {
            const cachedStatus = localStorage.getItem('pospal_cached_status');
            if (cachedStatus === 'active') {
                return; // Still active based on cache
            }
        }
        
        // Try to validate with server
        const isOnline = await attemptServerValidation(customerEmail, unlockToken);
        
        if (!isOnline) {
            // Server unreachable - start offline grace period
            handleOfflineMode();
        }
        
    } catch (error) {
        console.error('Failed to validate subscription:', error);
        handleOfflineMode();
    }
}

// Handle trial users (local validation only)
function handleTrialValidation() {
    const trialStarted = localStorage.getItem('pospal_trial_started');
    if (trialStarted) {
        const trialDays = 30;
        const daysSinceStart = (Date.now() - parseInt(trialStarted)) / (1000 * 60 * 60 * 24);
        
        // Trial users get 1 day offline grace
        const offlineGraceDays = 1;
        const lastOnlineCheck = localStorage.getItem('pospal_last_online_check');
        
        if (lastOnlineCheck) {
            const daysSinceLastOnline = (Date.now() - parseInt(lastOnlineCheck)) / (1000 * 60 * 60 * 24);
            if (daysSinceLastOnline > offlineGraceDays && daysSinceStart > trialDays) {
                showUnlockRedirect('trial');
                return;
            }
        } else if (daysSinceStart > trialDays) {
            showUnlockRedirect('trial');
            return;
        }
    }
}

// Check if user is within offline grace period
function isInOfflineGracePeriod() {
    const lastSuccessfulCheck = localStorage.getItem('pospal_last_successful_validation');
    const customerType = localStorage.getItem('pospal_cached_status');
    
    if (!lastSuccessfulCheck) {
        return false; // No previous successful validation
    }
    
    const daysSinceLastValidation = (Date.now() - parseInt(lastSuccessfulCheck)) / (1000 * 60 * 60 * 24);
    
    // Simple time-based grace period
    const gracePeriodDays = customerType === 'active' ? 7 : 1;
    const inGracePeriod = daysSinceLastValidation <= gracePeriodDays;
    
    if (inGracePeriod) {
        console.log(`Offline grace: ${daysSinceLastValidation.toFixed(1)}/${gracePeriodDays} days`);
        showOfflineIndicator(daysSinceLastValidation, gracePeriodDays);
    } else {
        console.log('Offline grace period expired');
    }
    
    return inGracePeriod;
}

// Attempt server validation with timeout
async function attemptServerValidation(customerEmail, unlockToken, timeout = 10000) {
    try {
        console.log('Attempting server validation...');
        
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeout);
        
        const machineFingerprint = generateMachineFingerprint();
        
        const response = await fetch('https://pospal-licensing-development.bzoumboulis.workers.dev/validate', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                email: customerEmail,
                token: unlockToken,
                machineFingerprint: machineFingerprint
            }),
            signal: controller.signal
        });
        
        clearTimeout(timeoutId);
        const result = await response.json();
        
        // Update successful validation timestamp
        localStorage.setItem('pospal_last_validation_check', Date.now().toString());
        localStorage.setItem('pospal_last_online_check', Date.now().toString());
        
        if (result.valid && result.subscriptionStatus === 'active') {
            // Validation successful
            localStorage.setItem('pospal_cached_status', 'active');
            localStorage.setItem('pospal_last_successful_validation', Date.now().toString());
            console.log('Server validation: ACTIVE');
            hideOfflineIndicator();
            return true;
        } else {
            // License issues detected online
            localStorage.setItem('pospal_cached_status', 'inactive');
            console.log('Server validation failed:', result.error || 'Unknown error');
            
            if (result.error && result.error.includes('Subscription is not active')) {
                showUnlockRedirect('subscription');
            } else if (result.error && result.error.includes('Invalid email or unlock token')) {
                showUnlockDialog();
            }
            
            return true; // We connected to server (validation failed but connection succeeded)
        }
        
    } catch (error) {
        console.log('Server validation failed (likely offline):', error.name);
        return false; // Assume offline
    }
}

// Handle offline mode gracefully
function handleOfflineMode() {
    const lastOnlineCheck = localStorage.getItem('pospal_last_online_check');
    if (!lastOnlineCheck) {
        // First time offline - start grace period
        localStorage.setItem('pospal_last_online_check', Date.now().toString());
    }
    
    if (!isInOfflineGracePeriod()) {
        // Grace period expired
        const customerType = localStorage.getItem('pospal_cached_status');
        
        if (customerType === 'active') {
            showOfflineExpiredDialog();
        } else {
            showUnlockRedirect('trial');
        }
    }
}

// Generate machine fingerprint (same as in payment modal)
function generateMachineFingerprint() {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    ctx.textBaseline = 'top';
    ctx.font = '14px Arial';
    ctx.fillText('Machine fingerprint', 2, 2);
    
    const fingerprint = {
        screen: `${screen.width}x${screen.height}`,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        language: navigator.language,
        platform: navigator.platform,
        canvas: canvas.toDataURL(),
        userAgent: navigator.userAgent.substring(0, 100)
    };
    
    return btoa(JSON.stringify(fingerprint)).substring(0, 32);
}

// --- Session Management Functions ---

let currentSessionId = null;
let heartbeatInterval = null;
const HEARTBEAT_INTERVAL = 30000; // 30 seconds
const WORKER_URL = 'https://pospal-licensing-development.bzoumboulis.workers.dev';

// Generate unique session ID
function generateSessionId() {
    return 'session_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

// Get device information for session tracking
function getDeviceInfo() {
    return {
        screen: `${screen.width}x${screen.height}`,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        language: navigator.language,
        platform: navigator.platform,
        userAgent: navigator.userAgent.substring(0, 200),
        browser: getBrowserInfo()
    };
}

function getBrowserInfo() {
    const userAgent = navigator.userAgent;
    if (userAgent.includes('Chrome')) return 'Chrome';
    if (userAgent.includes('Firefox')) return 'Firefox';
    if (userAgent.includes('Safari')) return 'Safari';
    if (userAgent.includes('Edge')) return 'Edge';
    return 'Unknown';
}

// Start session with server
async function startSession() {
    try {
        const unlockToken = localStorage.getItem('pospal_unlock_token');
        const customerEmail = localStorage.getItem('pospal_customer_email');
        
        if (!unlockToken || !customerEmail) {
            console.log('No license info found, skipping session management');
            return true; // Don't block app for trial users
        }
        
        // Check if we're in offline grace period first
        if (isInOfflineGracePeriod()) {
            console.log('Starting session in offline mode (using grace period)');
            startOfflineSession();
            return true;
        }
        
        currentSessionId = generateSessionId();
        const machineFingerprint = generateMachineFingerprint();
        const deviceInfo = getDeviceInfo();
        
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout
            
            const response = await fetch(`${WORKER_URL}/session/start`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    email: customerEmail,
                    token: unlockToken,
                    machineFingerprint: machineFingerprint,
                    sessionId: currentSessionId,
                    deviceInfo: deviceInfo
                }),
                signal: controller.signal
            });
            
            clearTimeout(timeoutId);
            const result = await response.json();
            
            if (result.success) {
                console.log('Session started successfully:', currentSessionId);
                startHeartbeat();
                localStorage.setItem('pospal_last_online_check', Date.now().toString());
                return true;
            } else if (result.conflict) {
                // Another device is using this license
                console.log('Session conflict detected:', result.error);
                const shouldTakeover = await showSessionConflictDialog(result.conflictInfo);
                
                if (shouldTakeover) {
                    return await takeoverSession();
                } else {
                    // User chose not to takeover, check if they can use offline mode
                    if (isInOfflineGracePeriod()) {
                        console.log('Starting in offline mode instead');
                        startOfflineSession();
                        return true;
                    } else {
                        showSessionConflictLock(result.conflictInfo);
                        return false;
                    }
                }
            } else {
                console.error('Failed to start session:', result.error);
                // Try offline mode if available
                if (isInOfflineGracePeriod()) {
                    startOfflineSession();
                    return true;
                }
                return true; // Don't block app for other server errors
            }
            
        } catch (error) {
            console.log('Session start failed (likely offline):', error.name);
            
            // Try offline mode
            if (isInOfflineGracePeriod()) {
                startOfflineSession();
                return true;
            } else {
                // No offline grace - handle as network error
                handleOfflineMode();
                return false;
            }
        }
        
    } catch (error) {
        console.error('Session start error:', error);
        return true; // Don't block app for unexpected errors
    }
}

// Start offline session (no server communication)
function startOfflineSession() {
    currentSessionId = generateSessionId();
    console.log('Started offline session:', currentSessionId);
    
    // Start modified heartbeat that doesn't communicate with server
    startOfflineHeartbeat();
    
    // Show offline indicator
    const daysSinceLastValidation = (Date.now() - parseInt(localStorage.getItem('pospal_last_successful_validation') || '0')) / (1000 * 60 * 60 * 24);
    const gracePeriodDays = localStorage.getItem('pospal_cached_status') === 'active' ? 7 : 1;
    showOfflineIndicator(daysSinceLastValidation, gracePeriodDays);
}

// Modified heartbeat for offline mode
function startOfflineHeartbeat() {
    if (heartbeatInterval) {
        clearInterval(heartbeatInterval);
    }
    
    // Daily reconnection check with persistence
    const DAILY_CHECK_INTERVAL = 24 * 60 * 60 * 1000; // 24 hours
    const RETRY_INTERVAL = 10 * 60 * 1000; // 10 minutes for retries
    const MAX_RETRIES_PER_DAY = 6; // Max 6 retries (1 hour of attempts)
    
    let dailyRetryCount = 0;
    let lastDailyCheck = localStorage.getItem('pospal_last_daily_check') || '0';
    
    const attemptReconnection = async (isRetry = false) => {
        try {
            console.log(isRetry ? 'Retrying connection...' : 'Daily connection check...');
            const unlockToken = localStorage.getItem('pospal_unlock_token');
            const customerEmail = localStorage.getItem('pospal_customer_email');
            
            if (unlockToken && customerEmail) {
                const isOnline = await attemptServerValidation(customerEmail, unlockToken, 8000); // 8 second timeout
                
                if (isOnline) {
                    console.log('Connection successful! Switching to online session management...');
                    localStorage.setItem('pospal_last_daily_check', Date.now().toString());
                    dailyRetryCount = 0;
                    // Restart full session management
                    await startSession();
                    return;
                } else {
                    // Server not responding - retry if we haven't exceeded retry limit
                    if (!isRetry) {
                        dailyRetryCount = 0; // Reset counter for new daily check
                    }
                    
                    if (dailyRetryCount < MAX_RETRIES_PER_DAY) {
                        dailyRetryCount++;
                        console.log(`Server not responding, retry ${dailyRetryCount}/${MAX_RETRIES_PER_DAY} in 10 minutes`);
                        heartbeatInterval = setTimeout(() => attemptReconnection(true), RETRY_INTERVAL);
                        return;
                    } else {
                        console.log('Max retries reached, will try again in 24 hours');
                    }
                }
            }
            
        } catch (error) {
            console.log('Connection failed:', error.name);
            
            // Retry logic for network errors too
            if (dailyRetryCount < MAX_RETRIES_PER_DAY) {
                dailyRetryCount++;
                console.log(`Connection error, retry ${dailyRetryCount}/${MAX_RETRIES_PER_DAY} in 10 minutes`);
                heartbeatInterval = setTimeout(() => attemptReconnection(true), RETRY_INTERVAL);
                return;
            }
        }
        
        // Check if offline grace period has expired
        if (!isInOfflineGracePeriod()) {
            console.log('Offline grace period expired');
            handleOfflineMode();
            return;
        }
        
        // Schedule next daily check
        const nextCheck = DAILY_CHECK_INTERVAL;
        console.log(`Next connection check in 24 hours`);
        heartbeatInterval = setTimeout(() => attemptReconnection(false), nextCheck);
    };
    
    // Determine when to start first check
    const timeSinceLastCheck = Date.now() - parseInt(lastDailyCheck);
    let initialDelay;
    
    if (timeSinceLastCheck >= DAILY_CHECK_INTERVAL) {
        // It's been over 24 hours, check now
        initialDelay = 5000; // 5 seconds to let app settle
    } else {
        // Schedule next check based on when last check was
        initialDelay = DAILY_CHECK_INTERVAL - timeSinceLastCheck;
        console.log(`Next connection check in ${Math.round(initialDelay / (1000 * 60 * 60))} hours`);
    }
    
    heartbeatInterval = setTimeout(() => attemptReconnection(false), initialDelay);
}

// Start heartbeat to keep session alive
function startHeartbeat() {
    if (heartbeatInterval) {
        clearInterval(heartbeatInterval);
    }
    
    heartbeatInterval = setInterval(async () => {
        try {
            if (!currentSessionId) return;
            
            const response = await fetch(`${WORKER_URL}/session/heartbeat`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    sessionId: currentSessionId
                }),
            });
            
            const result = await response.json();
            
            if (!result.success) {
                console.warn('Heartbeat failed:', result.error);
                if (result.error.includes('Session not found')) {
                    // Session was terminated, try to restart
                    console.log('Session was terminated, attempting to restart...');
                    await startSession();
                }
            }
            
        } catch (error) {
            console.error('Heartbeat error:', error);
        }
    }, HEARTBEAT_INTERVAL);
}

// End session when app closes
async function endSession() {
    try {
        if (currentSessionId) {
            await fetch(`${WORKER_URL}/session/end`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    sessionId: currentSessionId
                }),
            });
            
            console.log('Session ended:', currentSessionId);
        }
        
        if (heartbeatInterval) {
            clearInterval(heartbeatInterval);
            heartbeatInterval = null;
        }
        
        currentSessionId = null;
        
    } catch (error) {
        console.error('End session error:', error);
    }
}

// Takeover session from another device
async function takeoverSession() {
    try {
        const unlockToken = localStorage.getItem('pospal_unlock_token');
        const customerEmail = localStorage.getItem('pospal_customer_email');
        
        if (!unlockToken || !customerEmail) {
            return false;
        }
        
        currentSessionId = generateSessionId();
        const machineFingerprint = generateMachineFingerprint();
        const deviceInfo = getDeviceInfo();
        
        const response = await fetch(`${WORKER_URL}/session/takeover`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                email: customerEmail,
                token: unlockToken,
                machineFingerprint: machineFingerprint,
                sessionId: currentSessionId,
                deviceInfo: deviceInfo
            }),
        });
        
        const result = await response.json();
        
        if (result.success) {
            console.log('Session takeover successful:', currentSessionId);
            startHeartbeat();
            return true;
        } else {
            console.error('Session takeover failed:', result.error);
            return false;
        }
        
    } catch (error) {
        console.error('Session takeover error:', error);
        return false;
    }
}

// Show session conflict dialog
async function showSessionConflictDialog(conflictInfo) {
    return new Promise((resolve) => {
        const deviceInfo = conflictInfo?.deviceInfo || {};
        const lastSeen = conflictInfo?.lastSeen || 'Unknown';
        const deviceDesc = `${deviceInfo.browser || 'Unknown Browser'} on ${deviceInfo.platform || 'Unknown OS'}`;
        
        const modal = document.createElement('div');
        modal.className = 'fixed inset-0 bg-black bg-opacity-90 z-[120] flex items-center justify-center p-4';
        modal.innerHTML = `
            <div class="bg-white rounded-2xl shadow-2xl w-full max-w-md">
                <div class="p-6 text-center border-b border-gray-200">
                    <div class="text-4xl text-orange-500 mb-3">
                        <i class="fas fa-exclamation-triangle"></i>
                    </div>
                    <h2 class="text-2xl font-bold text-gray-900 mb-2">Device Conflict</h2>
                    <p class="text-gray-600">Another device is currently using your POSPal license</p>
                </div>
                
                <div class="p-6">
                    <div class="bg-gray-50 rounded-lg p-4 mb-4">
                        <h3 class="font-semibold text-gray-800 mb-2">Currently Active Device:</h3>
                        <div class="text-sm text-gray-600">
                            <p><i class="fas fa-desktop mr-2"></i>${deviceDesc}</p>
                            <p><i class="fas fa-clock mr-2"></i>Last seen: ${new Date(lastSeen).toLocaleString()}</p>
                            <p><i class="fas fa-screen mr-2"></i>Screen: ${deviceInfo.screen || 'Unknown'}</p>
                        </div>
                    </div>
                    
                    <p class="text-sm text-gray-600 mb-6">
                        Your POSPal license allows only one active device at a time. You can take over this license, which will immediately disconnect the other device.
                    </p>
                    
                    <div class="space-y-3">
                        <button id="takeoverBtn" class="w-full bg-orange-600 text-white py-3 px-4 rounded-lg font-semibold hover:bg-orange-700 transition-colors">
                            <i class="fas fa-laptop mr-2"></i>
                            Use POSPal on This Device
                        </button>
                        
                        <button id="cancelBtn" class="w-full bg-gray-300 text-gray-700 py-2 px-4 rounded-lg hover:bg-gray-400 transition-colors">
                            Cancel
                        </button>
                    </div>
                    
                    <div class="mt-4 text-center">
                        <p class="text-xs text-gray-500">
                            The other device will be disconnected immediately and can reconnect later when this device is closed.
                        </p>
                    </div>
                </div>
            </div>
        `;
        
        document.body.appendChild(modal);
        document.body.style.overflow = 'hidden';
        
        const takeoverBtn = modal.querySelector('#takeoverBtn');
        const cancelBtn = modal.querySelector('#cancelBtn');
        
        const cleanup = () => {
            document.body.removeChild(modal);
            document.body.style.overflow = 'auto';
        };
        
        takeoverBtn.onclick = () => {
            cleanup();
            resolve(true);
        };
        
        cancelBtn.onclick = () => {
            cleanup();
            resolve(false);
        };
    });
}

// Show session conflict lock screen
function showSessionConflictLock(conflictInfo) {
    const deviceInfo = conflictInfo?.deviceInfo || {};
    const deviceDesc = `${deviceInfo.browser || 'Unknown Browser'} on ${deviceInfo.platform || 'Unknown OS'}`;
    
    const lockScreen = document.createElement('div');
    lockScreen.id = 'sessionConflictLock';
    lockScreen.className = 'fixed inset-0 bg-gray-900 z-[100] flex items-center justify-center p-4';
    lockScreen.innerHTML = `
        <div class="text-center text-white max-w-md">
            <div class="text-6xl text-orange-500 mb-6">
                <i class="fas fa-ban"></i>
            </div>
            <h2 class="text-3xl font-bold mb-4">License In Use</h2>
            <p class="text-gray-300 mb-6">
                Your POSPal license is currently being used on another device (${deviceDesc}).
            </p>
            <p class="text-sm text-gray-400 mb-8">
                Only one device can use POSPal at a time. Close POSPal on the other device or refresh this page to try again.
            </p>
            <button onclick="window.location.reload()" 
                    class="bg-orange-600 text-white py-3 px-6 rounded-lg font-semibold hover:bg-orange-700 transition-colors">
                <i class="fas fa-refresh mr-2"></i>
                Try Again
            </button>
        </div>
    `;
    
    document.body.appendChild(lockScreen);
}

// --- Offline Mode UI Functions ---

let offlineIndicatorElement = null;

// Show offline mode indicator
function showOfflineIndicator(daysSinceLastValidation, gracePeriodDays) {
    if (offlineIndicatorElement) {
        hideOfflineIndicator();
    }
    
    const remainingDays = Math.max(0, gracePeriodDays - daysSinceLastValidation);
    const percentRemaining = (remainingDays / gracePeriodDays) * 100;
    
    // Create offline indicator
    offlineIndicatorElement = document.createElement('div');
    offlineIndicatorElement.id = 'offlineIndicator';
    offlineIndicatorElement.className = 'fixed top-4 right-4 bg-orange-100 border border-orange-300 text-orange-800 px-4 py-2 rounded-lg shadow-lg z-50 max-w-sm';
        
    offlineIndicatorElement.innerHTML = `
        <div class="flex items-center space-x-2">
            <div class="flex-shrink-0">
                <i class="fas fa-wifi-slash text-orange-500"></i>
            </div>
            <div class="flex-1 text-sm">
                <div class="font-medium">Offline Mode</div>
                <div class="text-orange-600">
                    ${remainingDays.toFixed(1)} days remaining
                </div>
                <div class="w-full bg-orange-200 rounded-full h-1.5 mt-1">
                    <div class="bg-orange-500 h-1.5 rounded-full transition-all duration-300" 
                         style="width: ${percentRemaining}%"></div>
                </div>
            </div>
            <button onclick="attemptReconnect()" class="text-orange-600 hover:text-orange-800 text-xs">
                <i class="fas fa-refresh"></i>
            </button>
        </div>
    `;
    
    document.body.appendChild(offlineIndicatorElement);
    
    // Update indicator every minute
    const updateInterval = setInterval(() => {
        if (!isInOfflineGracePeriod()) {
            clearInterval(updateInterval);
            hideOfflineIndicator();
            return;
        }
        
        const newDaysSince = (Date.now() - parseInt(localStorage.getItem('pospal_last_successful_validation') || '0')) / (1000 * 60 * 60 * 24);
        const newRemainingDays = Math.max(0, gracePeriodDays - newDaysSince);
        const newPercentRemaining = (newRemainingDays / gracePeriodDays) * 100;
        
        // Update DOM elements
        const limitElement = offlineIndicatorElement.querySelector('.text-orange-600');
        const progressElement = offlineIndicatorElement.querySelector('.bg-orange-500');
        
        if (limitElement) limitElement.textContent = `${newRemainingDays.toFixed(1)} days remaining`;
        if (progressElement) progressElement.style.width = `${newPercentRemaining}%`;
        
        // Change color as grace period runs out
        if (newPercentRemaining < 20) {
            offlineIndicatorElement.className = offlineIndicatorElement.className.replace('bg-orange-100 border-orange-300 text-orange-800', 'bg-red-100 border-red-300 text-red-800');
        }
        
    }, 60000); // Update every minute
}

// Hide offline indicator
function hideOfflineIndicator() {
    if (offlineIndicatorElement) {
        document.body.removeChild(offlineIndicatorElement);
        offlineIndicatorElement = null;
    }
}

// Manual reconnection attempt (user-triggered)
async function attemptReconnect() {
    const unlockToken = localStorage.getItem('pospal_unlock_token');
    const customerEmail = localStorage.getItem('pospal_customer_email');
    
    if (unlockToken && customerEmail) {
        showToast('Checking connection...', 'info', 2000);
        
        const isOnline = await attemptServerValidation(customerEmail, unlockToken, 10000); // 10 second timeout for manual attempts
        
        if (isOnline) {
            showToast('✅ Reconnected successfully!', 'success', 3000);
            hideOfflineIndicator();
            // Update last daily check timestamp to reset daily schedule
            localStorage.setItem('pospal_last_daily_check', Date.now().toString());
            // Restart session management
            setTimeout(() => {
                startSession();
            }, 1000);
        } else {
            showToast('❌ Still offline - automatic check once per day', 'error', 4000);
        }
    }
}

// Show offline expired dialog for paid customers
function showOfflineExpiredDialog() {
    const customerType = localStorage.getItem('pospal_cached_status');
    const gracePeriodDays = customerType === 'active' ? 7 : 1;
    
    const modal = document.createElement('div');
    modal.className = 'fixed inset-0 bg-black bg-opacity-90 z-[120] flex items-center justify-center p-4';
    
    modal.innerHTML = `
        <div class="bg-white rounded-2xl shadow-2xl w-full max-w-md">
            <div class="p-6 text-center border-b border-gray-200">
                <div class="text-4xl text-red-500 mb-3">
                    <i class="fas fa-exclamation-circle"></i>
                </div>
                <h2 class="text-2xl font-bold text-gray-900 mb-2">Connection Required</h2>
                <p class="text-gray-600">Your offline grace period has expired</p>
            </div>
            
            <div class="p-6">
                <div class="bg-red-50 rounded-lg p-4 mb-4">
                    <p class="text-sm text-red-700 mb-2">
                        <i class="fas fa-clock mr-2"></i>
                        You've been offline for more than ${gracePeriodDays} days
                    </p>
                    <p class="text-sm text-red-600">
                        POSPal needs to verify your subscription status with our servers to continue.
                    </p>
                </div>
                
                <p class="text-sm text-gray-600 mb-6">
                    Please check your internet connection and try again. Your subscription and data are safe.
                </p>
                
                <div class="space-y-3">
                    <button onclick="attemptReconnect()" class="w-full bg-blue-600 text-white py-3 px-4 rounded-lg font-semibold hover:bg-blue-700 transition-colors">
                        <i class="fas fa-wifi mr-2"></i>
                        Check Connection
                    </button>
                    
                    <button onclick="window.location.reload()" class="w-full bg-gray-300 text-gray-700 py-2 px-4 rounded-lg hover:bg-gray-400 transition-colors">
                        <i class="fas fa-refresh mr-2"></i>
                        Refresh Page
                    </button>
                </div>
                
                <div class="mt-4 text-center">
                    <p class="text-xs text-gray-500">
                        If you continue having connection issues, please contact support.
                    </p>
                </div>
            </div>
        </div>
    `;
    
    document.body.appendChild(modal);
    document.body.style.overflow = 'hidden';
}

// Expose global functions
window.attemptReconnect = attemptReconnect;

// Handle manual unlock token form submission
document.addEventListener('DOMContentLoaded', function() {
    const unlockForm = document.getElementById('unlockTokenForm');
    if (unlockForm) {
        unlockForm.addEventListener('submit', async function(e) {
            e.preventDefault();
            
            const email = document.getElementById('unlockEmail').value;
            const token = document.getElementById('unlockToken').value;
            const submitBtn = document.getElementById('unlockSubmitBtn');
            const btnText = document.getElementById('unlockBtnText');
            const errorDiv = document.getElementById('unlockError');
            
            // Clear previous error
            errorDiv.classList.add('hidden');
            
            // Show loading state
            submitBtn.disabled = true;
            btnText.textContent = 'Validating...';
            
            try {
                const machineFingerprint = generateMachineFingerprint();
                
                const response = await fetch('https://pospal-licensing-development.bzoumboulis.workers.dev/validate', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        email: email,
                        token: token,
                        machineFingerprint: machineFingerprint
                    }),
                });
                
                const result = await response.json();
                
                if (result.valid && result.subscriptionStatus === 'active') {
                    // Success! Unlock POSPal
                    unlockPOSPal(token, email, result.customerName);
                    // Start session management for this newly unlocked license
                    setTimeout(() => {
                        startSession();
                    }, 1000);
                } else {
                    // Show error
                    errorDiv.textContent = result.error || 'Invalid unlock code or email';
                    errorDiv.classList.remove('hidden');
                }
                
            } catch (error) {
                console.error('Unlock validation error:', error);
                errorDiv.textContent = 'Failed to validate unlock code. Please check your internet connection.';
                errorDiv.classList.remove('hidden');
            } finally {
                // Reset button state
                submitBtn.disabled = false;
                btnText.textContent = 'Unlock POSPal';
            }
        });
    }
});

// --- Embedded Payment Functions ---

function showEmbeddedPayment() {
    const paymentFrame = document.getElementById('paymentModalFrame');
    if (paymentFrame) {
        paymentFrame.style.display = 'block';
        document.body.style.overflow = 'hidden';
        
        // Post message to the iframe to show the modal
        setTimeout(() => {
            paymentFrame.contentWindow.postMessage({ action: 'showModal' }, '*');
        }, 100);
    }
}

function closeEmbeddedPayment() {
    const paymentFrame = document.getElementById('paymentModalFrame');
    if (paymentFrame) {
        paymentFrame.style.display = 'none';
        document.body.style.overflow = 'auto';
    }
}

// Function to unlock POSPal after successful payment
function unlockPOSPal(unlockToken, customerEmail = null, customerName = null) {
    console.log('POSPal unlocked with token:', unlockToken);
    
    // Hide the trial/expired UI elements
    const trialActions = document.getElementById('trial-actions');
    if (trialActions) {
        trialActions.classList.add('hidden');
    }
    
    const expiredOverlay = document.getElementById('expired-overlay');
    if (expiredOverlay) {
        expiredOverlay.classList.add('hidden');
    }
    
    // Close payment modal
    closeEmbeddedPayment();
    
    // Store the unlock token and customer info locally for future validation
    localStorage.setItem('pospal_unlock_token', unlockToken);
    localStorage.setItem('pospal_license_status', 'active');
    localStorage.setItem('pospal_license_validated', new Date().getTime());
    localStorage.setItem('pospal_cached_status', 'active');
    localStorage.setItem('pospal_last_validation_check', Date.now().toString());
    
    // Store customer info if provided (for future validation calls)
    if (customerEmail) {
        localStorage.setItem('pospal_customer_email', customerEmail);
    }
    if (customerName) {
        localStorage.setItem('pospal_customer_name', customerName);
    }
    
    // Show success message
    showToast('🎉 Welcome to POSPal Pro! Your app is now unlocked.', 'success', 5000);
    
    // Refresh the page to ensure all locked features are enabled
    setTimeout(() => {
        window.location.reload();
    }, 2000);
}

// Listen for messages from the payment modal iframe
window.addEventListener('message', function(event) {
    if (event.data && event.data.action) {
        switch (event.data.action) {
            case 'closeModal':
                closeEmbeddedPayment();
                break;
            case 'paymentSuccess':
                if (event.data.unlockToken) {
                    unlockPOSPal(event.data.unlockToken, event.data.customerEmail, event.data.customerName);
                }
                break;
            default:
                console.log('Unknown message from payment modal:', event.data);
        }
    }
});
