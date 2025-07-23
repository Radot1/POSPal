// --- Global State & Configuration ---
let menu = {};
let selectedCategory = null;
let editingItem = null;
// Standardized localStorage keys
const STORAGE_PREFIX = 'pospalApp_';
const CURRENT_ORDER_KEY = `${STORAGE_PREFIX}currentOrder`;
const ORDER_LINE_COUNTER_KEY = `${STORAGE_PREFIX}orderLineItemCounter`;
const UNIVERSAL_COMMENT_KEY = `${STORAGE_PREFIX}universalOrderComment`;
const SELECTED_TABLE_KEY = `${STORAGE_PREFIX}selectedTable`;

let currentOrder = JSON.parse(localStorage.getItem(CURRENT_ORDER_KEY)) || [];
let currentOrderLineItemCounter = parseInt(localStorage.getItem(ORDER_LINE_COUNTER_KEY)) || 0;
let orderNumber = 1;
let universalOrderComment = localStorage.getItem(UNIVERSAL_COMMENT_KEY) || "";
let selectedTableNumber = localStorage.getItem(SELECTED_TABLE_KEY) || "";
let isPaidByCard = false;

// --- State for Mobile UI (POSPal) ---
let isMobileOrderPanelOpen = false;
let itemForNumpad = null;
let numpadCurrentInput = "";

// --- State for Option Selection ---
let itemBeingConfigured = null;
let currentOptionSelectionStep = null;

// --- State for Desktop UI (Sushaki) ---
let selectedItemId_sushaki = null;
let numpadInput_sushaki = "";


// --- DOM Element Cache ---
const elements = {};

// --- Initialization ---
document.addEventListener('DOMContentLoaded', () => {
    cacheDOMElements();
    initializeAppState();
    loadMenu();
    startClock();
    checkAndDisplayTrialStatus();

    // --- Event Listeners ---
    // Universal Comment Input (works for both UIs if ID is the same)
    if (elements.universalOrderCommentInput) {
        elements.universalOrderCommentInput.addEventListener('input', (e) => {
            universalOrderComment = e.target.value;
            localStorage.setItem(UNIVERSAL_COMMENT_KEY, universalOrderComment);
        });
    }

    // Paid by Card Checkbox (POSPal UI)
    if (elements.paidByCardCheckbox) {
        elements.paidByCardCheckbox.addEventListener('change', (e) => {
            isPaidByCard = e.target.checked;
        });
    }

    // Table Input (POSPal UI)
    if (elements.headerTableInput) {
        elements.headerTableInput.addEventListener('change', handleTableNumberChange);
        elements.headerTableInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                handleTableNumberChange(e);
                e.target.blur();
            }
        });
    }
    
    // Login Form (Universal)
    if (elements.loginForm) {
        elements.loginForm.addEventListener('submit', handleLogin);
    }
    
    // Sushaki UI specific comment input
    if(document.getElementById('universalOrderCommentInput_sushaki')) {
         document.getElementById('universalOrderCommentInput_sushaki').addEventListener('input', (e) => {
            universalOrderComment = e.target.value;
            localStorage.setItem(UNIVERSAL_COMMENT_KEY, universalOrderComment);
        });
    }

    // Final UI update on load
    updateOrderDisplay();
});


function cacheDOMElements() {
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

    // --- Sushaki UI Elements ---
    elements.orderNumber_sushaki = document.getElementById('order-number-sushaki');

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
            if (elements.orderNumber_sushaki) elements.orderNumber_sushaki.textContent = orderNumber;
        }
    } catch (error) {
        console.error("Could not fetch next order number:", error);
        if (elements.headerOrderNumber) elements.headerOrderNumber.textContent = "Err";
        if (elements.orderNumber_sushaki) elements.orderNumber_sushaki.textContent = "Err";
        showToast("Could not sync order number with server.", "error");
    }
}

function initializeAppState() {
    fetchAndUpdateOrderNumber();
    selectedTableNumber = localStorage.getItem(SELECTED_TABLE_KEY) || "";
    if (elements.headerTableInput) {
        elements.headerTableInput.value = selectedTableNumber;
    }
    const savedComment = localStorage.getItem(UNIVERSAL_COMMENT_KEY) || "";
    if (elements.universalOrderCommentInput) {
        elements.universalOrderCommentInput.value = savedComment;
    }
    const sushakiCommentInput = document.getElementById('universalOrderCommentInput_sushaki');
     if (sushakiCommentInput) {
        sushakiCommentInput.value = savedComment;
    }
}


async function loadMenu() {
    try {
        const response = await fetch('/api/menu');
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        menu = await response.json() || {};

        if (Object.keys(menu).length > 0 && (!selectedCategory || !menu[selectedCategory])) {
            selectedCategory = Object.keys(menu)[0];
        } else if (Object.keys(menu).length === 0) {
            selectedCategory = null;
        }
        renderCategories();
        populateManagementCategorySelect();
    } catch (error) {
        showToast(`Error loading menu: ${error.message}`, 'error');
        console.error("Load menu error:", error);
        if (elements.categoriesContainer) elements.categoriesContainer.innerHTML = '<p class="text-gray-500 italic">Could not load categories.</p>';
        if (elements.productsContainer) elements.productsContainer.innerHTML = '<p class="text-gray-500 italic col-span-full text-center">Could not load items.</p>';
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
    if (!elements.categoriesContainer) return;
    elements.categoriesContainer.innerHTML = '';

    if (Object.keys(menu).length === 0) {
        elements.categoriesContainer.innerHTML = '<p class="text-gray-500 italic">No categories defined.</p>';
        if (elements.productsContainer) {
            elements.productsContainer.innerHTML = '<p class="text-gray-600 italic col-span-full text-center py-8">Please add categories and items in Management.</p>';
        }
        return;
    }

    // Detect which UI is active by checking for a unique element
    const isSushakiUI = document.body.classList.contains('sushaki-ui');

    if (isSushakiUI) {
        // Render tabs for Sushaki UI
        Object.keys(menu).forEach(category => {
            const btn = document.createElement('button');
            btn.className = `category-tab ${category === selectedCategory ? 'active' : ''}`;
            btn.textContent = category;
            btn.onclick = () => {
                selectedCategory = category;
                renderCategories(); // Re-render to update active state
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
    if (!elements.productsContainer) return;
    elements.productsContainer.innerHTML = '';
    if (!selectedCategory || !menu[selectedCategory] || menu[selectedCategory].length === 0) {
        elements.productsContainer.innerHTML = `<p class="text-gray-600 italic col-span-full text-center py-8">No items in "${selectedCategory || 'this'}" category.</p>`;
        return;
    }

    const isSushakiUI = document.body.classList.contains('sushaki-ui');

    menu[selectedCategory].forEach(item => {
        const card = document.createElement('div');
        card.onclick = () => addToOrder(item.id);

        if (isSushakiUI) {
            // Sushaki card rendering
            card.className = 'product-card';
            let optionsBadgeHTML = '';
            if (item.hasGeneralOptions && item.generalOptions && Array.isArray(item.generalOptions) && item.generalOptions.length > 0) {
                optionsBadgeHTML = `<span class="options-badge">Options</span>`;
            }
            card.innerHTML = `
                <div style="display: flex; justify-content: space-between; align-items: flex-start;">
                    <h3 title="${item.name}">${item.name}</h3>
                    ${optionsBadgeHTML}
                </div>
                <div class="price">€${(item.price || 0).toFixed(2)}</div>
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
        elements.productsContainer.appendChild(card);
    });
}

function addToOrder(itemId) {
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
        finalizeAndAddOrderItem(itemBeingConfigured, []);
        resetMultiStepSelection();
    }
}

function finalizeAndAddOrderItem(baseItem, generalChoicesWithOptions) {
    currentOrderLineItemCounter++;
    localStorage.setItem(ORDER_LINE_COUNTER_KEY, currentOrderLineItemCounter.toString());

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

    const isSushakiUI = document.body.classList.contains('sushaki-ui');

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
            
            if (isSushakiUI) {
                 // Sushaki order item rendering
                div.className = `order-item ${item.orderId === selectedItemId_sushaki ? 'selected-for-numpad' : ''}`;
                div.onclick = () => selectItemByOrderId_sushaki(item.orderId);

                if (item.generalSelectedOptions && item.generalSelectedOptions.length > 0) {
                    item.generalSelectedOptions.forEach(opt => {
                        const priceChangeDisplay = parseFloat(opt.priceChange || 0) !== 0 ? ` (${parseFloat(opt.priceChange || 0) > 0 ? '+' : ''}€${parseFloat(opt.priceChange || 0).toFixed(2)})` : '';
                        optionDisplayHTML += `<div style="font-size: 0.8em; color: #777; margin-left: 10px;">↳ ${opt.name}${priceChangeDisplay}</div>`;
                    });
                }
                 commentText = item.comment ? `<div style="font-size: 0.8em; color: #555; margin-left: 10px;"><em>Note: ${item.comment}</em></div>` : '';

                div.innerHTML = `
                    <div style="flex: 1;">
                        <span>${item.quantity}x ${item.name}</span>
                        ${optionDisplayHTML}
                        ${commentText}
                    </div>
                    <span class="price" style="text-align: right;">€${itemTotal.toFixed(2)}</span>
                    <div class="order-item-actions">
                        <button onclick="event.stopPropagation(); promptForItemComment('${item.orderId}')" class="secondary-btn" title="Add Note">✎</button>
                        <button onclick="event.stopPropagation(); removeItemByOrderId('${item.orderId}')" class="secondary-btn" title="Remove Item">×</button>
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
    localStorage.setItem(CURRENT_ORDER_KEY, JSON.stringify(currentOrder));
    
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
    if (selectedItemId_sushaki === orderId) selectedItemId_sushaki = null;
    
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

function clearOrderData() {
    currentOrder = [];
    universalOrderComment = "";
    if (elements.universalOrderCommentInput) elements.universalOrderCommentInput.value = "";
    const sushakiCommentInput = document.getElementById('universalOrderCommentInput_sushaki');
    if (sushakiCommentInput) sushakiCommentInput.value = "";
    localStorage.removeItem(UNIVERSAL_COMMENT_KEY);

    currentOrderLineItemCounter = 0;
    localStorage.setItem(ORDER_LINE_COUNTER_KEY, '0');
    isPaidByCard = false;
    if (elements.paidByCardCheckbox) elements.paidByCardCheckbox.checked = false;

    hideNumpad();
    selectedItemId_sushaki = null;
    numpadInput_sushaki = "";

    updateOrderDisplay();
    fetchAndUpdateOrderNumber();
}

function newOrder() {
    if (currentOrder.length > 0 && !confirm("Clear current order and start a new one? This will clear all items and notes.")) {
        return;
    }
    clearOrderData();
    showToast('Order cleared. Ready for the next order.', 'info');
}

async function sendOrder() {
    if (!elements.sendOrderBtn) return;

    if (!currentOrder.length) {
        showToast('Order is empty!', 'warning');
        return;
    }
    
    const isSushakiUI = document.body.classList.contains('sushaki-ui');
    let tableNumberForOrder = selectedTableNumber;

    if (isSushakiUI) {
        // Sushaki UI doesn't have a table input, so we might need a default or prompt
        if (!tableNumberForOrder) {
            tableNumberForOrder = prompt("Please enter a Table Number for this order:", "1");
            if (!tableNumberForOrder) {
                 showToast('Table number is required to send the order.', 'warning');
                 return;
            }
            selectedTableNumber = tableNumberForOrder; // Save for potential future use
            localStorage.setItem(SELECTED_TABLE_KEY, selectedTableNumber);
        }
    } else {
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
            } else if (result.status === "warning_print_copy2_failed") {
                showToast(result.message || `Order #${result.order_number}: Copy 1 PRINTED & LOGGED. Copy 2 FAILED.`, 'warning', 7000);
            } else if (result.status === "error_print_failed_copy1") {
                showToast(result.message || `Order #${result.order_number} - COPY 1 FAILED. Order NOT saved.`, 'error', 7000);
            } else if (result.status === "error_log_failed_after_print") {
                showToast(result.message || `Order #${result.order_number} - PRINTED but LOGGING FAILED. Notify staff!`, 'error', 10000);
            } else {
                showToast(result.message || `Order #${result.order_number} processed with issues: ${result.status}`, 'warning', 7000);
            }

            if (result.status === "success" || result.status === "warning_print_copy2_failed" || result.status === "error_log_failed_after_print") {
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

function handleTableNumberChange(event) {
    const newTableNumber = event.target.value.trim();
    if (selectedTableNumber !== newTableNumber) {
        selectedTableNumber = newTableNumber;
        localStorage.setItem(SELECTED_TABLE_KEY, selectedTableNumber);
    }
}

// Sushaki UI Functions
function selectItemByOrderId_sushaki(orderId) {
    if (selectedItemId_sushaki === orderId) {
        selectedItemId_sushaki = null; // Deselect if clicked again
        numpadInput_sushaki = "";
    } else {
        selectedItemId_sushaki = orderId;
        numpadInput_sushaki = "";
    }
    updateOrderDisplay();
}

function handleNumpad_sushaki(digit) {
    if (!selectedItemId_sushaki) {
        showToast('Select an item from the order first', 'warning');
        numpadInput_sushaki = "";
        return;
    }
    const item = currentOrder.find(i => String(i.orderId) === selectedItemId_sushaki);
    if (!item) {
        showToast('Error: Selected item not found.', 'error');
        numpadInput_sushaki = "";
        return;
    }

    numpadInput_sushaki += String(digit);
    let newQuantity = Number(numpadInput_sushaki);

    if (isNaN(newQuantity) || newQuantity <= 0) {
        item.quantity = 1;
        numpadInput_sushaki = newQuantity > 0 ? newQuantity.toString() : "1";
    } else {
        item.quantity = newQuantity;
    }
    updateOrderDisplay();
}

function handleNumpadClear_sushaki() {
    if (!selectedItemId_sushaki) return;
    const item = currentOrder.find(i => String(i.orderId) === selectedItemId_sushaki);
    if (item) {
        numpadInput_sushaki = "";
        item.quantity = 1;
        updateOrderDisplay();
    }
}

function handleNumpadBackspace_sushaki() {
    if (!selectedItemId_sushaki) return;
    const item = currentOrder.find(i => String(i.orderId) === selectedItemId_sushaki);
    if (item) {
        if (numpadInput_sushaki.length > 0) {
            numpadInput_sushaki = numpadInput_sushaki.slice(0, -1);
        }
        item.quantity = Number(numpadInput_sushaki) > 0 ? Number(numpadInput_sushaki) : 1;
        updateOrderDisplay();
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
            // It should be defined in sushaki.html's style block if needed.
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
    elements.itemOptionSelectModal.classList.remove('hidden');
    elements.itemOptionSelectModal.classList.add('flex');
}

function cancelOptionSelection() {
    if (elements.itemOptionSelectModal) {
        elements.itemOptionSelectModal.classList.add('hidden');
        elements.itemOptionSelectModal.classList.remove('flex');
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
    if (!elements.loginModal) return;
    elements.passwordInput.value = '';
    elements.loginError.classList.add('hidden');
    elements.loginModal.classList.remove('hidden');
    elements.loginModal.classList.add('flex');
    elements.passwordInput.focus();
}

function closeLoginModal() {
    if (!elements.loginModal) return;
    elements.loginModal.classList.add('hidden');
    elements.loginModal.classList.remove('flex');
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
            elements.loginError.textContent = result.message || 'Login failed. Please try again.';
            elements.loginError.classList.remove('hidden');
            elements.passwordInput.select();
        }
    } catch (error) {
        console.error('Login error:', error);
        elements.loginError.textContent = 'A network error occurred. Please try again.';
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
    if (!elements.managementModal) return;
    elements.managementModal.classList.remove('hidden');
    
    // Use different display properties for each UI
    const isSushakiUI = document.body.classList.contains('sushaki-ui');
    elements.managementModal.style.display = isSushakiUI ? 'flex' : 'flex'; // Both use flex now

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
    elements.managementModal.style.display = 'none';
    document.body.style.overflow = '';
}


function switchManagementTab(tabName, clickedButton) {
    currentManagementTab = tabName;
    
    const isSushakiUI = document.body.classList.contains('sushaki-ui');

    if (isSushakiUI) {
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

    const views = ['analyticsManagement', 'itemsManagement', 'categoriesManagement', 'orderHistoryManagement', 'licenseManagement'];
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

function renderExistingItemsInModal() {
    if (!elements.existingItemsListModal) return;
    elements.existingItemsListModal.innerHTML = '';
    let itemCount = 0;
    
    const isSushakiUI = document.body.classList.contains('sushaki-ui');

    Object.entries(menu).forEach(([category, items]) => {
        if (!items || items.length === 0) return;

        if(!isSushakiUI) {
            const categoryHeader = document.createElement('h5');
            categoryHeader.className = "font-bold text-gray-700 mt-3 mb-1 pb-1 border-b border-gray-300";
            categoryHeader.textContent = category;
            elements.existingItemsListModal.appendChild(categoryHeader);
        }

        (items || []).forEach((item, index) => {
            itemCount++;
            const div = document.createElement('div');
            
            if(isSushakiUI) {
                div.className = `item-row`;
                div.innerHTML = `
                    <span style="flex:1">${item.name}</span>
                    <span>€${(item.price || 0).toFixed(2)}</span>
                    <button onclick="openItemFormModal(${item.id})">Edit</button>
                    <button onclick="deleteItem(${item.id})" class="secondary-btn">Delete</button>
                `;
            } else {
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
                        <button onclick="openItemFormModal(${item.id})" class="px-2 py-1 text-xs btn-warning text-white rounded hover:opacity-80">Edit</button>
                        <button onclick="deleteItem(${item.id})" class="px-2 py-1 text-xs btn-danger text-white rounded hover:opacity-80">Delete</button>
                    </div>`;
            }
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
    const isSushakiUI = document.body.classList.contains('sushaki-ui');

    if (categoryKeys.length === 0) {
        elements.existingCategoriesListModal.innerHTML = '<p class="text-xs text-gray-500 italic">No categories created yet.</p>';
        return;
    }

    categoryKeys.forEach((categoryName, index) => {
        const div = document.createElement('div');
        if(isSushakiUI) {
            div.className = "item-row";
            div.innerHTML = `
                <span style="flex:1">${categoryName}</span>
                <button onclick="deleteCategory('${categoryName}')" class="secondary-btn">Delete</button>
            `;
        } else {
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
        }
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
        await loadMenu();
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
        elements.itemFormModalTitle.textContent = 'Edit Item';
        populateItemFormForEdit(itemIdToEdit);
    } else {
        elements.itemFormModalTitle.textContent = 'Add New Item';
        if (elements.saveItemBtn) elements.saveItemBtn.innerHTML = '💾 Save New Item';
    }
    elements.itemFormModal.classList.remove('hidden');
    elements.itemFormModal.classList.add('flex');
}

function closeItemFormModal() {
    elements.itemFormModal.classList.add('hidden');
    elements.itemFormModal.classList.remove('flex');
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
    if (!elements.itemNameInput || !elements.itemPriceInput || !elements.itemCategorySelect) return;

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

    const success = await saveMenuToServer();
    if (success) {
        showToast(editingItem ? 'Item updated successfully!' : 'Item saved successfully!', 'success');
        closeItemFormModal();
        await loadMenu();
        loadManagementData();
    } else {
        showToast('Failed to save item to server. Reverting.', 'error');
        await loadMenu();
    }
}

async function deleteItem(itemIdToDelete) {
    if (!confirm('Are you sure you want to delete this item? This cannot be undone.')) return;

    let itemFoundAndDeletedLocally = false;
    Object.keys(menu).forEach(cat => {
        const itemIndex = (menu[cat] || []).findIndex(i => i.id === itemIdToDelete);
        if (itemIndex > -1) {
            menu[cat].splice(itemIndex, 1);
            itemFoundAndDeletedLocally = true;
        }
    });

    if (!itemFoundAndDeletedLocally) {
        showToast('Item not found for deletion.', 'warning');
        return;
    }

    const success = await saveMenuToServer();
    if (success) {
        showToast('Item deleted successfully.', 'success');
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
        elements.categoryNameInput.value = '';
        await loadMenu();
        loadManagementData();

    } catch (error) {
        showToast(`Failed to save category: ${error.message}`, 'error');
    }

}

async function deleteCategory(categoryNameToDelete) {
    if (menu[categoryNameToDelete] && menu[categoryNameToDelete].length > 0) {
        if (!confirm(`Category "${categoryNameToDelete}" contains items. Are you sure you want to delete the category AND ALL ITS ITEMS? This cannot be undone.`)) return;
    } else {
        if (!confirm(`Are you sure you want to delete category "${categoryNameToDelete}"? This cannot be undone.`)) return;
    }
    const backupMenu = JSON.parse(JSON.stringify(menu));
    delete menu[categoryNameToDelete];

    const success = await saveMenuToServer();
    if (success) {
        showToast(`Category "${categoryNameToDelete}" deleted successfully.`, 'success');
        if (selectedCategory === categoryNameToDelete) {
            selectedCategory = Object.keys(menu)[0] || null;
        }
        await loadMenu();
        loadManagementData();
    } else {
        menu = backupMenu;
        showToast(`Failed to delete category "${categoryNameToDelete}" on server. Reverting.`, 'error');
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
    const isSushakiUI = document.body.classList.contains('sushaki-ui');
    
    if(isSushakiUI) {
        elements.toast.className = 'toast'; // Use the sushaki class
        switch (type) {
            case 'success': elements.toast.style.backgroundColor = '#16a34a'; break;
            case 'warning': elements.toast.style.backgroundColor = '#f59e0b'; break;
            case 'error': elements.toast.style.backgroundColor = '#ef4444'; break;
            default: elements.toast.style.backgroundColor = 'var(--primary)';
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
        if(!isSushakiUI) elements.toast.classList.remove('opacity-0')
    }, 10);

    toastTimeout = setTimeout(() => {
        if(!isSushakiUI) elements.toast.classList.add('opacity-0');
        setTimeout(() => elements.toast.style.display = 'none', 300);
    }, duration);
}

async function loadTodaysOrdersForReprint() {
    if (!elements.todaysOrdersList) return;
    elements.todaysOrdersList.innerHTML = '<p class="text-xs text-gray-500 italic">Loading today\'s orders...</p>';
    try {
        const response = await fetch('/api/todays_orders_for_reprint');
        if (!response.ok) {
            const errorData = await response.json().catch(() => ({
                message: `HTTP ${response.status}`
            }));
            throw new Error(errorData.message || `Failed to load orders: ${response.statusText}`);
        }
        const orders = await response.json();
        renderTodaysOrdersList(orders);
    } catch (error) {
        console.error("Error loading today's orders for reprint:", error);
        elements.todaysOrdersList.innerHTML = `<p class="text-xs text-red-500 italic">Error loading orders: ${error.message}. Try refreshing.</p>`;
        showToast(`Error loading orders: ${error.message}`, 'error');
    }
}

function renderTodaysOrdersList(orders) {
    if (!elements.todaysOrdersList) return;
    elements.todaysOrdersList.innerHTML = '';

    if (!orders || orders.length === 0) {
        elements.todaysOrdersList.innerHTML = '<p class="text-xs text-gray-500 italic">No orders found for today.</p>';
        return;
    }
    
    const isSushakiUI = document.body.classList.contains('sushaki-ui');

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

        if(isSushakiUI) {
            div.className = 'item-row';
            div.innerHTML = `
                <span style="flex:1">
                    <strong>Order #${order.order_number}</strong>
                    <span style="font-size: 0.8em; color: #555; margin-left: 8px;">Table: ${order.table_number || 'N/A'} at ${formattedTimestamp}</span>
                </span>
                <button onclick="reprintOrder('${order.order_number}')" class="primary-btn">
                    <i class="fas fa-print"></i> Reprint
                </button>
            `;
        } else {
            div.className = "p-2.5 border border-gray-300 rounded-md flex justify-between items-center text-sm bg-white hover:bg-gray-50";
            div.innerHTML = `
                <div>
                    <span class="font-semibold text-gray-800">Order #${order.order_number}</span>
                    <span class="text-xs text-gray-600 ml-2">Table: ${order.table_number || 'N/A'}</span>
                    <span class="text-xs text-gray-500 ml-2">Time: ${formattedTimestamp}</span>
                </div>
                <button onclick="reprintOrder('${order.order_number}')" class="px-3 py-1.5 text-xs btn-primary text-white rounded hover:opacity-80 transition">
                    <i class="fas fa-print mr-1"></i> Reprint
                </button>
            `;
        }
        elements.todaysOrdersList.appendChild(div);
    });
}


async function reprintOrder(orderNumToReprint) {
    if (!orderNumToReprint) {
        showToast('Invalid order number for reprint.', 'error');
        return;
    }

    const reprintButton = event.target.closest('button');
    if (reprintButton) {
        reprintButton.disabled = true;
        reprintButton.innerHTML = '<i class="fas fa-spinner fa-spin mr-1"></i> Reprinting...';
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
                showToast(result.message || `Order #${orderNumToReprint} REPRINTED successfully!`, 'success');
            } else if (result.status === "warning_reprint_copy2_failed") {
                showToast(result.message || `Order #${orderNumToReprint}: Kitchen REPRINTED. Copy 2 FAILED.`, 'warning', 7000);
            } else {
                showToast(result.message || `Failed to reprint Order #${orderNumToReprint}.`, 'error', 7000);
            }
        } else {
            showToast(result.message || `Server error during reprint of Order #${orderNumToReprint}: ${response.status}.`, 'error', 7000);
        }

    } catch (error) {
        console.error(`Error reprinting order ${orderNumToReprint}:`, error);
        showToast(`Network error or invalid response while reprinting Order #${orderNumToReprint}.`, 'error', 7000);
    } finally {
        if (reprintButton) {
            reprintButton.disabled = false;
            reprintButton.innerHTML = '<i class="fas fa-print mr-1"></i> Reprint';
        }
    }
}

async function openDaySummaryModal() {
    if (!elements.daySummaryModal || !elements.daySummaryContent) return;
    elements.daySummaryModal.classList.remove('hidden');
    elements.daySummaryModal.classList.add('flex');
    elements.daySummaryContent.innerHTML = '<p class="text-center italic">Loading summary...</p>';

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
    elements.daySummaryModal.classList.add('hidden');
    elements.daySummaryModal.classList.remove('flex');
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
                <span class="font-medium text-gray-600">Total Orders:</span>
                <span class="font-semibold text-gray-800">${summary.total_orders}</span>
            </div>
            <div class="flex justify-between items-center py-2 border-b">
                <span class="font-medium text-gray-600">Total Cash Payments:</span>
                <span class="font-semibold text-green-600">€${summary.cash_total.toFixed(2)}</span>
            </div>
            <div class="flex justify-between items-center py-2 border-b">
                <span class="font-medium text-gray-600">Total Card Payments:</span>
                <span class="font-semibold text-blue-600">€${summary.card_total.toFixed(2)}</span>
            </div>
            <div class="flex justify-between items-center pt-3 mt-2 border-t-2 border-black">
                <span class="text-lg font-bold text-gray-900">Grand Total:</span>
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
    document.getElementById('kpi-gross-revenue').textContent = `€${(data.grossRevenue || 0).toFixed(2)}`;
    document.getElementById('kpi-total-orders').textContent = data.totalOrders || 0;
    document.getElementById('kpi-atv').textContent = `€${(data.atv || 0).toFixed(2)}`;

    document.getElementById('kpi-payment-cash').textContent = `€${(data.paymentMethods.cash || 0).toFixed(2)}`;
    document.getElementById('kpi-payment-card').textContent = `€${(data.paymentMethods.card || 0).toFixed(2)}`;

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

    renderSalesByHourChart(data.salesByHour);
}

function renderList(containerId, items, templateFn, emptyMessage) {
    const container = document.getElementById(containerId);
    container.innerHTML = '';
    if (items && items.length > 0) {
        items.forEach(item => {
            container.innerHTML += templateFn(item);
        });
    } else {
        container.innerHTML = `<p class="text-xs text-gray-500 italic p-2">${emptyMessage}</p>`;
    }
}

function renderSalesByHourChart(salesByHour) {
    const container = document.getElementById('analytics-chart-container');
    container.innerHTML = '';

    if (!salesByHour || salesByHour.length === 0) {
        container.innerHTML = '<p class="text-xs text-gray-500 italic w-full text-center self-center">No sales data for this period.</p>';
        container.style.minWidth = 'auto';
        return;
    }

    const barWidth = 40;
    const spaceWidth = 16;
    container.style.minWidth = `${salesByHour.length * (barWidth + spaceWidth)}px`;

    const maxRevenue = Math.max(...salesByHour.map(h => h.total), 0);

    salesByHour.forEach(hourData => {
        const barHeight = maxRevenue > 0 ? (hourData.total / maxRevenue) * 100 : 0;
        const barWrapper = document.createElement('div');
        barWrapper.className = 'w-10 flex flex-col items-center justify-end h-full';
        barWrapper.innerHTML = `
            <div class="w-full h-full flex items-end justify-center group relative">
                <div class="bg-gray-200 hover:bg-indigo-400 w-3/4 rounded-t-sm transition-colors" style="height: ${barHeight}%"></div>
                <div class="absolute bottom-full mb-1 w-max px-2 py-1 bg-gray-800 text-white text-xs rounded opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10">
                    €${hourData.total.toFixed(2)}
                </div>
            </div>
            <span class="text-xs text-gray-500 mt-1">${String(hourData.hour).padStart(2, '0')}</span>
        `;
        container.appendChild(barWrapper);
    });
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

        if (status.licensed) {
            const licensedHTML = `<i class="fas fa-check-circle text-green-600 mr-2"></i>Fully Licensed`;
            if (statusDisplay) statusDisplay.innerHTML = licensedHTML;
            if (footerStatusDisplay) {
                footerStatusDisplay.innerHTML = licensedHTML;
                footerStatusDisplay.className = 'font-medium text-green-600';
            }
        } else if (status.expired) {
            const expiredHTML = `<i class="fas fa-times-circle text-red-600 mr-2"></i>Trial Expired`;
            if (statusDisplay) statusDisplay.innerHTML = expiredHTML;
            if (footerStatusDisplay) {
                footerStatusDisplay.innerHTML = expiredHTML;
                footerStatusDisplay.className = 'font-medium text-red-600';
            }
        } else if (status.active) {
            const days = status.days_left;
            const dayText = days === 1 ? 'day' : 'days';
            const trialHTML = `<i class="fas fa-info-circle text-yellow-500 mr-2"></i>Trial Version: ${days} ${dayText} remaining`;
            if (statusDisplay) statusDisplay.innerHTML = trialHTML;
            if (footerStatusDisplay) {
                footerStatusDisplay.innerHTML = trialHTML;
                footerStatusDisplay.className = 'font-medium text-yellow-500';
            }
        }

    } catch (error) {
        console.error("Error checking trial status:", error);
        if (elements.licenseStatusDisplay) elements.licenseStatusDisplay.textContent = "Could not load status.";
        if (elements.footerTrialStatus) {
            elements.footerTrialStatus.textContent = "Status Unknown";
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
