// --- FIREBASE SETUP ---
const firebaseConfig = {
  apiKey: process.env.FIREBASE_API_KEY,
  authDomain: process.env.FIREBASE_AUTH_DOMAIN,
  projectId: process.env.FIREBASE_PROJECT_ID,
  storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.FIREBASE_APP_ID,
  measurementId: process.env.FIREBASE_MEASUREMENT_ID
};

let db = null;
if (firebaseConfig.apiKey !== "YOUR_API_KEY") {
  firebase.initializeApp(firebaseConfig);
  db = firebase.firestore();
  window.db = db;
  if (typeof firebase.analytics === 'function') {
    firebase.analytics();
  }
  console.log("Firebase Connected to rokeya-3ccaa!");
}

// Initial Data
const JEWELLERY_CARE_INSTRUCTIONS = `CARE & SAFETY
✦	Cleaning: Wipe gently with a soft, dry cloth after each use. Avoid water, soap, or chemical cleaners.
✦	Storage: Store in a zip-lock pouch or airtight jewellery box to prevent tarnishing and dust accumulation.
✦	Avoid Moisture: Do not wear while bathing, swimming, or during heavy perspiration. Moisture accelerates tarnishing.
✦	Perfume & Chemicals: Apply perfume and hairspray before wearing. Keep the jewellery away from cosmetics and cleaning agents.
✦	Handling: Handle gently; avoid bending, dropping, or pulling on delicate motifs or stone settings.
✦	Stone Care: Do not scrub stone-set pieces. Wipe stone surfaces with a cotton swab to maintain shine.
✦	Longevity Tip: Occasional light polish with a soft cloth keeps the finish bright. Store separately to avoid scratches.`;

let products = JSON.parse(localStorage.getItem('saforio_products')) || [];

// Migration removed to ensure no automatic changes happen.
// Products will load exactly as they are in storage.
products = products.map(p => ({
  ...p,
  id: p.id || Date.now() + Math.random(),
  position: p.position ?? 999
}));

function cleanProductDescription(desc) { return desc || ""; }
function extractPriceFromDesc(desc) { return 0; }

// --- SEO & Image Optimization Helpers ---
function optimizeImageUrl(url) {
  if (!url) return '';
  if (url.includes('cloudinary.com') && !url.includes('f_auto,q_auto')) {
    return url.replace('/upload/', '/upload/f_auto,q_auto/');
  }
  return url;
}

function getSEOAttributes(product) {
  let name = product.name;
  if (!name && product.slug) {
    name = product.slug.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
  }
  if (!name) name = "Rokea Premium Product";

  name = name.replace(/"/g, '&quot;');

  return `alt="${name}" title="${name}" aria-label="${name}" loading="lazy" decoding="async" width="800" height="1000"`;
}

function generateSlug(text) {
  if (!text) return "";
  return text.toLowerCase().trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// Sort products by ID descending so newest are at the top
products.sort((a, b) => (b.id || 0) - (a.id || 0));

localStorage.setItem('saforio_products', JSON.stringify(products));


// Global Image Error Handler - Bulletproof way to stop question marks
window.addEventListener('error', function (e) {
  if (e.target && e.target.tagName && e.target.tagName.toLowerCase() === 'img') {
    e.target.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
    e.target.style.background = 'linear-gradient(135deg, #f0e6d3, #faf6ef)';
    e.target.style.display = 'block'; // Ensure it doesn't break layout
  }
}, true);

function sanitizeWishlist(list) {
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  return list.filter(item => {
    if (!item || item.id === undefined || item.id === null) return false;
    const idStr = String(item.id);
    if (seen.has(idStr)) return false;
    seen.add(idStr);
    return true;
  });
}

let cart = JSON.parse(localStorage.getItem('saforio_cart')) || [];
let wishlist = sanitizeWishlist(JSON.parse(localStorage.getItem('saforio_wishlist')) || []);
localStorage.setItem('saforio_wishlist', JSON.stringify(wishlist));
let users = JSON.parse(localStorage.getItem('saforio_users')) || [];
let currentCategory = 'sarees';
let currentSort = 'default';
let currentUser = JSON.parse(localStorage.getItem('saforio_currentUser')) || null;
let modalHistory = [];
let adminCurrentProductFilter = 'all';

// --- Environment Detection ---
const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';

function getProductLink(p) {
  if (isLocalhost) {
    return p.slug ? `product-details.html?slug=${p.slug}` : `product-details.html?id=${p.id}`;
  } else {
    return p.slug ? `/product/${p.slug}` : `/product-details?id=${p.id}`;
  }
}

function getAbsoluteProductLink(p) {
  const path = getProductLink(p);
  return window.location.origin + (path.startsWith('/') ? path : '/' + path);
}

// Initialize URL Parameters globally on script load to prevent ReferenceError
const urlParams = new URLSearchParams(window.location.search);
const urlCat = urlParams.get('category') || localStorage.getItem('rokea_selected_category');
let urlId = urlParams.get('slug') || urlParams.get('id');

// Detect Vercel rewrite or native /product/ path
if (!urlId && window.location.pathname.startsWith('/product/')) {
  urlId = window.location.pathname.replace('/product/', '').replace(/\/$/, '');
}

function saveProducts() {
  localStorage.setItem('saforio_products', JSON.stringify(products));
  renderAll();
}

// Sync across multiple tabs in real-time
window.addEventListener('storage', (e) => {
  if (e.key === 'saforio_products') {
    products = JSON.parse(e.newValue) || [];
    renderAll();
  }
});

// --- FIRESTORE PRODUCT SYNC ---
function loadProducts() {
  return new Promise((resolve) => {
    if (db) {
      db.collection("products").onSnapshot((snapshot) => {
        const fsProducts = [];
        snapshot.forEach(doc => {
          let p = doc.data();
          p.id = p.id || doc.id;
          fsProducts.push(p);
        });
        // Sort products by position (ascending)
        products = fsProducts.sort((a, b) => (a.position || 0) - (b.position || 0));
        localStorage.setItem('saforio_products', JSON.stringify(products));
        renderAll();
        resolve();
      }, (err) => {
        console.error("Firestore product listen error:", err);
        resolve();
      });
    } else {
      renderAll();
      resolve();
    }
  });
}

async function loadUsers() {
  if (db) {
    try {
      const snapshot = await db.collection("users").get();
      if (!snapshot.empty) {
        const fsUsers = [];
        snapshot.forEach(doc => fsUsers.push(doc.data()));
        users = fsUsers;
        localStorage.setItem('saforio_users', JSON.stringify(users));
      }
    } catch (err) {
      console.error("Firestore users load error:", err);
    }
  }
}

loadProducts().then(() => {
  renderMarquee();
});
loadUsers();

function saveUsers() {
  localStorage.setItem('saforio_users', JSON.stringify(users));
}

// --- CART & PAYMENT ---

function toggleCart() {
  const modal = document.getElementById('cartModal');
  modal.style.display = modal.style.display === 'flex' ? 'none' : 'flex';
  document.body.classList.toggle('modal-open', modal.style.display === 'flex');
  renderCart();
}

window.toggleMobileMenu = () => {
  const menu = document.getElementById('mobileMenu');
  if (menu) {
    menu.classList.toggle('active');
    document.body.classList.toggle('modal-open', menu.classList.contains('active'));
  }
}

// PREMIUM CUSTOM ALERT (DYNAMIC INJECTION)
function showToast(message, type = 'success', subText = '') {
  let overlay = document.getElementById('customAlertOverlay');

  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'customAlertOverlay';
    overlay.className = 'custom-alert-overlay';
    overlay.onclick = () => closeCustomAlert();
    overlay.style.cssText = "position:fixed; inset:0; background:rgba(0,0,0,0.8); backdrop-filter:blur(10px); display:none; align-items:center; justify-content:center; z-index:10001; animation: fadeIn 0.3s ease;";

    overlay.innerHTML = `
      <div class="custom-alert-box" onclick="event.stopPropagation()" style="background:#fff; width:90%; max-width:380px; border-radius:24px; overflow:hidden; box-shadow:0 30px 60px rgba(0,0,0,0.4); transform:scale(0.8); opacity:0; transition:all 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275); border:1px solid rgba(201,168,76,0.2);">
        <div style="background:linear-gradient(135deg, #b0937a, #8e6d4f); padding:30px 20px; text-align:center; color:#fff;">
          <div style="font-size:40px; margin-bottom:10px; filter:drop-shadow(0 2px 5px rgba(0,0,0,0.2));">✦</div>
          <div id="alertTitle" style="font-family:'Playfair Display',serif; font-size:24px; font-weight:700; letter-spacing:1px;">ROKEA Luxury</div>
        </div>
        <div style="padding:40px 30px; text-align:center;">
          <p id="alertMessage" style="font-family:'Poppins',sans-serif; font-size:15px; color:#444; line-height:1.6; margin:0; font-weight:500;">Item added successfully.</p>
        </div>
      </div>
      <style>
        .custom-alert-overlay.active { display:flex !important; }
        .custom-alert-overlay.active .custom-alert-box { transform:scale(1) !important; opacity:1 !important; }
        @keyframes fadeIn { from { opacity:0; } to { opacity:1; } }
      </style>
    `;
    document.body.appendChild(overlay);
  }

  const msgEl = overlay.querySelector('#alertMessage');
  const titleEl = overlay.querySelector('#alertTitle');

  if (msgEl) {
    msgEl.innerHTML = `<strong>${message}</strong>${subText ? `<br><span style="font-size:12px; color:#888; font-weight:400; margin-top:8px; display:block;">${subText}</span>` : ''}`;
    if (titleEl) {
      titleEl.innerText = type === 'success' ? 'Success!' : (type === 'info' ? 'Rokea Update' : 'Notice');
    }
    overlay.classList.add('active');
    document.body.style.overflow = 'hidden';

    setTimeout(() => {
      closeCustomAlert();
    }, 2000);
  }
}

window.closeCustomAlert = () => {
  const overlay = document.getElementById('customAlertOverlay');
  if (overlay) {
    overlay.classList.remove('active');
    document.body.style.overflow = '';
  }
}

// --- SIDE NOTIFICATION ---
function showSideNotification(product) {
  let container = document.getElementById('sideNotificationContainer');
  if (!container) {
    container = document.createElement('div');
    container.id = 'sideNotificationContainer';
    container.className = 'side-notification-container';
    document.body.appendChild(container);
  }

  const notification = document.createElement('div');
  notification.className = 'side-notification';
  notification.innerHTML = `
        <img src="${product.image || product.img}" class="side-notification-img" loading="lazy" decoding="async" ${getSEOAttributes(product)}>
        <div class="side-notification-content">
            <div class="side-notification-title">Added to Cart</div>
            <div class="side-notification-msg">${product.name} has been added to your bag.</div>
            <a href="javascript:void(0)" class="side-notification-btn" onclick="toggleCart()">View Cart & Checkout</a>
        </div>
        <span class="side-notification-close">&times;</span>
    `;

  container.appendChild(notification);

  // Close button
  notification.querySelector('.side-notification-close').onclick = () => {
    notification.classList.remove('active');
    setTimeout(() => notification.remove(), 500);
  };

  // Auto animate in
  setTimeout(() => notification.classList.add('active'), 10);

  // Auto remove
  setTimeout(() => {
    if (notification.parentNode) {
      notification.classList.remove('active');
      setTimeout(() => notification.remove(), 500);
    }
  }, 5000);
}





function addToCart(productId) {
  if (!currentUser) { openAuth(); return; }
  const p = products.find(prod => prod.id == productId);
  if (!p || p.stock === "Out of Stock") return;
  cart.push(p);
  localStorage.setItem('saforio_cart', JSON.stringify(cart));
  updateCartIcon();

  // Amazon-style button change if event exists
  if (window.event && window.event.currentTarget && window.event.currentTarget.tagName === 'BUTTON') {
    const btn = window.event.currentTarget;
    const originalText = btn.innerHTML;
    btn.classList.add('added');
    btn.innerHTML = 'Added';
    setTimeout(() => {
      btn.classList.remove('added');
      btn.innerHTML = originalText;
    }, 3000);
  }

  showSideNotification(p);
}

function removeFromCart(index) {
  cart.splice(index, 1);
  localStorage.setItem('saforio_cart', JSON.stringify(cart));
  renderCart();
  updateCartIcon();
}

function updateCartIcon() {
  const countEl = document.getElementById('cart-count');
  if (countEl) countEl.innerText = cart.length;
}

// --- WISHLIST LOGIC ---

function toggleWishlist() {
  const modal = document.getElementById('wishlistModal');
  modal.style.display = modal.style.display === 'flex' ? 'none' : 'flex';
  document.body.classList.toggle('modal-open', modal.style.display === 'flex');
  renderWishlist();
}

function addToWishlist(productId) {
  if (!currentUser) { openAuth(); return; }

  // Clean duplicates if any exist in array
  wishlist = sanitizeWishlist(wishlist);

  const p = products.find(prod => prod.id == productId);
  if (!p) return;

  const index = wishlist.findIndex(item => item.id == productId);

  // Find the element that was clicked to animate it
  const btn = (typeof event !== 'undefined' && event?.currentTarget) ? event.currentTarget : null;

  if (index === -1) {
    // Product is NOT in wishlist -> Add it EXACTLY ONCE
    wishlist.push(p);
    showToast("Added to Wishlist!", "success", p.name);

    if (btn) {
      btn.classList.add('wish-animate');
      setTimeout(() => btn.classList.remove('wish-animate'), 500);

      // Sparkle effect
      const sparkleCont = document.createElement('div');
      sparkleCont.className = 'sparkle-container';
      sparkleCont.style.position = 'absolute';
      sparkleCont.style.top = '50%';
      sparkleCont.style.left = '50%';
      sparkleCont.style.transform = 'translate(-50%, -50%)';
      btn.appendChild(sparkleCont);

      for (let i = 0; i < 8; i++) {
        const sparkle = document.createElement('div');
        sparkle.className = 'sparkle animate';
        const angle = (i * 45) * (Math.PI / 180);
        const dist = 25;
        sparkle.style.setProperty('--tx', `${Math.cos(angle) * dist}px`);
        sparkle.style.setProperty('--ty', `${Math.sin(angle) * dist}px`);
        sparkleCont.appendChild(sparkle);
      }
      setTimeout(() => sparkleCont.remove(), 700);

      // Instagram-style big heart pop
      const productCard = btn.closest('.product-card');
      const imgCont = productCard?.querySelector('.product-img');
      if (imgCont) {
        const heartPop = document.createElement('div');
        heartPop.className = 'insta-heart-pop animate';
        heartPop.innerHTML = `<svg viewBox="0 0 24 24" fill="#e91e63" style="width: 80px; height: 80px; filter: drop-shadow(0 5px 15px rgba(0,0,0,0.3));"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path></svg>`;
        imgCont.appendChild(heartPop);

        setTimeout(() => heartPop.remove(), 900);
      }
    }
  } else {
    // Product IS already in wishlist -> Remove it (single or any duplicate instances)
    wishlist = wishlist.filter(item => item.id != productId);
    showToast("Removed from Wishlist", "info", p.name);

    if (btn) {
      btn.classList.add('wish-animate');
      setTimeout(() => btn.classList.remove('wish-animate'), 500);
    }
  }

  localStorage.setItem('saforio_wishlist', JSON.stringify(wishlist));
  updateWishlistIcon();
  renderGrid();
  if (document.getElementById('wishlistModal') && document.getElementById('wishlistModal').style.display === 'flex') {
    renderWishlist();
  }
}

function removeFromWishlist(index) {
  wishlist.splice(index, 1);
  wishlist = sanitizeWishlist(wishlist);
  localStorage.setItem('saforio_wishlist', JSON.stringify(wishlist));
  updateWishlistIcon();
  renderWishlist();
  renderGrid();
}

function updateWishlistIcon() {
  const countEl = document.getElementById('wish-count');
  if (countEl) {
    countEl.innerText = wishlist.length;
    countEl.classList.add('wish-animate');
    setTimeout(() => countEl.classList.remove('wish-animate'), 400);
  }
}


function renderWishlist() {
  const list = document.getElementById('wishlist-items');
  if (!list) return;
  list.innerHTML = '';
  if (wishlist.length === 0) {
    list.innerHTML = '<div style="text-align:center; margin-top: 40px; color: #888;">Your wishlist is empty. ✿</div>';
  }
  wishlist.forEach((item, index) => {
    list.innerHTML += `
      <div class="cart-item" style="animation: fadeInUp 0.4s ease forwards; animation-delay: ${index * 0.1}s; opacity: 0;">

        <img src="${optimizeImageUrl(item.image || item.img)}" width="50" height="66" style="width:50px" loading="lazy" decoding="async" ${getSEOAttributes(item)}>
        <div class="cart-item-info">
          <div class="cart-item-name">${item.name}</div>
          <div class="cart-item-price">₹${item.price}</div>
          <button class="btn-primary" style="margin-top:5px; font-size:9px; padding:6px 10px;" onclick="wishToCart(${index})">Move to Cart</button>
        </div>
        <button class="btn-remove" onclick="removeFromWishlist(${index})">&times;</button>
      </div>`;
  });
}

function wishToCart(index) {
  const p = wishlist[index];
  addToCart(p.id);
  wishlist.splice(index, 1);
  localStorage.setItem('saforio_wishlist', JSON.stringify(wishlist));
  updateWishlistIcon();
  renderWishlist();
  renderGrid();
}

function moveAllToCart() {
  if (wishlist.length === 0) return alert("Wishlist is empty!");
  wishlist.forEach(p => addToCart(p.id));
  wishlist = [];
  localStorage.setItem('saforio_wishlist', JSON.stringify(wishlist));
  updateWishlistIcon();
  renderWishlist();
  renderGrid();
  toggleWishlist();
  toggleCart();
}

function renderCart() {
  const list = document.getElementById('cart-items');
  const totalEl = document.getElementById('cart-total');
  if (!list) return;
  list.innerHTML = '';
  let total = 0;
  cart.forEach((item, index) => {
    total += parseInt(item.price);
    list.innerHTML += `
      <div class="cart-item">
        <img src="${optimizeImageUrl(item.image || item.img)}" width="50" height="66" style="width:50px" loading="lazy" decoding="async" ${getSEOAttributes(item)}>
        <div class="cart-item-info">
          <div class="cart-item-name">${item.name}</div>
          <div class="cart-item-price">₹${item.price}</div>
        </div>
        <button class="btn-remove" onclick="removeFromCart(${index})">&times;</button>
      </div>`;
  });
  if (totalEl) totalEl.innerText = `₹${total}`;
}

function openCheckout() {
  if (cart.length === 0) { alert("Your cart is empty!"); return; }

  if (currentUser) {
    document.getElementById('orderName').value = currentUser.name || '';
    document.getElementById('orderPhone').value = currentUser.phone || '';
  }

  document.getElementById('cartModal').style.display = 'none';
  document.getElementById('checkoutModal').style.display = 'flex';
}

function closeCheckout() {
  document.getElementById('checkoutModal').style.display = 'none';
}

function handleOrder(e) {
  e.preventDefault();
  const name = document.getElementById('orderName').value;
  const phone = document.getElementById('orderPhone').value;
  const address = document.getElementById('orderAddress').value;
  let totalAmount = cart.reduce((sum, item) => sum + parseInt(item.price), 0);

  const options = {
    "key": process.env.RAZORPAY_KEY_ID,
    "amount": totalAmount * 100,
    "currency": "INR",
    "name": "ROKEA by RK Boutique",
    "description": "Payment for " + name,
    "handler": function (response) {
      alert("Payment Successful! ID: " + response.razorpay_payment_id);

      const orderData = {
        items: cart,
        total: totalAmount,
        customer: { name, phone, address },
        paymentId: response.razorpay_payment_id,
        userId: currentUser ? currentUser.uid : 'guest',
        date: new Date().toISOString()
      };

      // Save to localStorage
      const orders = JSON.parse(localStorage.getItem('saforio_orders')) || [];
      orders.push({ id: Date.now(), ...orderData, date: new Date().toLocaleDateString() });
      localStorage.setItem('saforio_orders', JSON.stringify(orders));

      // Save to Firebase Firestore
      if (db) {
        db.collection("orders").add(orderData)
          .then(() => console.log("Order saved to Firestore!"))
          .catch((error) => console.error("Firestore order error:", error));
      }

      cart = [];
      localStorage.removeItem('saforio_cart');
      updateCartIcon();
      closeCheckout();
    },
    "prefill": { "name": name, "contact": phone },
    "theme": { "color": "#C9A84C" }
  };

  const rzp1 = new Razorpay(options);
  rzp1.on('payment.failed', function (response) {
    alert("Payment Failed! Reason: " + response.error.description);
  });
  rzp1.open();
}

// AUTH LOGIC
const authModal = document.getElementById('authModal');
const loginView = document.getElementById('loginView');
const regView = document.getElementById('registerView');

window.openAuth = (initialView = 'login') => {
  if (authModal) {
    if (typeof window.toggleAuth === 'function') {
      window.toggleAuth(initialView);
    }
    authModal.style.display = 'flex';
    document.body.classList.add('modal-open');
    const vid = authModal.querySelector('.auth-bg-video');
    if (vid) vid.play().catch(() => {});
    const modalContent = authModal.querySelector('.modal-content');
    if (modalContent) modalContent.scrollTop = 0;
    void authModal.offsetWidth;
    authModal.classList.add('active');
  }
};

window.closeAuth = () => {
  if (authModal) {
    authModal.classList.remove('active');
    setTimeout(() => {
      authModal.style.display = 'none';
      document.body.classList.remove('modal-open');
    }, 300);
  }
};

window.toggleAuth = (view) => {
  const loginV = document.getElementById('loginView');
  const regV = document.getElementById('registerView');
  const forgotV = document.getElementById('forgotView');

  // Support boolean (true = login, false = register) or string ('login', 'register', 'forgot')
  let currentView = 'login';
  if (view === true || view === 'login') currentView = 'login';
  else if (view === false || view === 'register') currentView = 'register';
  else if (view === 'forgot') currentView = 'forgot';

  if (loginV) loginV.style.display = currentView === 'login' ? 'block' : 'none';
  if (regV) regV.style.display = currentView === 'register' ? 'block' : 'none';
  if (forgotV) {
    forgotV.style.display = currentView === 'forgot' ? 'block' : 'none';
    if (currentView === 'forgot') {
      const loginEmail = document.getElementById('loginEmail');
      const forgotEmail = document.getElementById('forgotEmail');
      if (loginEmail && forgotEmail && loginEmail.value.trim() && !forgotEmail.value.trim()) {
        forgotEmail.value = loginEmail.value.trim();
      }
    }
  }

  const modalContent = authModal ? authModal.querySelector('.modal-content') : null;
  if (modalContent) modalContent.scrollTop = 0;

  if (authModal && authModal.classList.contains('active')) {
    authModal.classList.remove('active');
    void authModal.offsetWidth;
    authModal.classList.add('active');
  }
};

window.openForgotPassword = () => {
  const forgotV = document.getElementById('forgotView');
  if (forgotV) {
    window.toggleAuth('forgot');
  } else {
    window.handleForgotPassword();
  }
};

window.handleForgotPassword = () => {
  const forgotEmailInput = document.getElementById('forgotEmail');
  const loginEmailInput = document.getElementById('loginEmail');
  let email = '';

  if (forgotEmailInput && forgotEmailInput.value.trim()) {
    email = forgotEmailInput.value.trim();
  } else if (loginEmailInput && loginEmailInput.value.trim()) {
    email = loginEmailInput.value.trim();
    if (forgotEmailInput) forgotEmailInput.value = email;
  }

  if (!email) {
    email = prompt("Enter your registered email to receive a password reset link:");
    if (!email) return;
    email = email.trim();
    if (forgotEmailInput) forgotEmailInput.value = email;
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    alert("Please enter a valid email address (e.g., yourname@gmail.com).");
    if (forgotEmailInput) forgotEmailInput.focus();
    return;
  }

  const submitBtn = document.getElementById('forgotSubmitBtn');
  const statusMsg = document.getElementById('forgotStatusMessage');
  const originalBtnHtml = submitBtn ? submitBtn.innerHTML : 'SEND RESET LINK';

  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.innerHTML = 'Sending Link... <i class="fas fa-spinner fa-spin"></i>';
  }

  if (!window.firebase || !firebase.auth) {
    alert("Authentication service is loading. Please check your internet connection and try again.");
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.innerHTML = originalBtnHtml;
    }
    return;
  }

  firebase.auth().sendPasswordResetEmail(email)
    .then(() => {
      const successHtml = `
        <div style="background: rgba(46, 125, 50, 0.25); border: 1.5px solid #4caf50; color: #c8e6c9; padding: 14px; border-radius: 8px; font-size: 12.5px; line-height: 1.6;">
          <strong style="color: #a5d6a7; font-size: 14px;">✓ Password Reset Email Sent!</strong><br>
          We have sent a reset link to: <strong>${email}</strong><br><br>
          <div style="background: rgba(255, 193, 7, 0.2); border: 1px solid #ffd54f; color: #fff9c4; padding: 10px; border-radius: 6px;">
            ⚠️ <strong>MAIL VARALAIYA?</strong><br>
            Gmail-la <strong>Spam / Junk</strong> folder kulla check pannunga! Firebase default server moolam varuvathala, 99% reset mail <strong>Spam folder</strong>-ku thaan pogum.
          </div>
          <div style="margin-top: 10px; text-align: center;">
            <a href="https://mail.google.com/mail/u/0/#spam" target="_blank" style="color: #ffd700; font-weight: 700; text-decoration: underline;">Open Gmail Spam Folder &rarr;</a>
          </div>
        </div>
      `;
      if (statusMsg) {
        statusMsg.innerHTML = successHtml;
        statusMsg.style.display = 'block';
      }
      if (submitBtn) {
        submitBtn.innerHTML = 'Link Sent! Check Spam Folder ✓';
        submitBtn.style.background = '#2e7d32';
      }
      alert("Password reset link sent to " + email + "!\n\n⚠️ IMPORTANT: Mail inbox-la illana kandippa SPAM / JUNK folder kulla check pannunga!");
    })
    .catch((error) => {
      console.error("Firebase sendPasswordResetEmail error:", error);
      let errMsg = error.message;
      if (error.code === 'auth/user-not-found') {
        errMsg = "Intha email-la account illa. Please check spelling or click Register to create a new account.";
      } else if (error.code === 'auth/invalid-email') {
        errMsg = "The email address is not properly formatted.";
      } else if (error.code === 'auth/too-many-requests') {
        errMsg = "Too many reset attempts recently. Please wait a few minutes before trying again.";
      }
      if (statusMsg) {
        statusMsg.innerHTML = `
          <div style="background: rgba(211, 47, 47, 0.25); border: 1px solid #f44336; color: #ffcdd2; padding: 12px; border-radius: 8px; font-size: 12px; line-height: 1.5;">
            <strong style="color: #ef5350;">Notice:</strong> ${errMsg}
          </div>
        `;
        statusMsg.style.display = 'block';
      }
      alert(errMsg);
    })
    .finally(() => {
      if (submitBtn) {
        submitBtn.disabled = false;
        setTimeout(() => {
          submitBtn.innerHTML = originalBtnHtml;
          submitBtn.style.background = '';
        }, 8000);
      }
    });
};
window.togglePassVisibility = (inputId, iconEl) => {
  const inp = document.getElementById(inputId);
  if (!inp) return;
  if (inp.type === 'password') {
    inp.type = 'text';
    if (iconEl) iconEl.classList.replace('fa-eye', 'fa-eye-slash');
  } else {
    inp.type = 'password';
    if (iconEl) iconEl.classList.replace('fa-eye-slash', 'fa-eye');
  }
};

// REEL MODAL LOGIC
const reelVideos = {
  'REEL_ID_1': 'https://www.w3schools.com/html/mov_bbb.mp4',
  'REEL_ID_2': 'https://www.w3schools.com/html/mov_bbb.mp4',
  'REEL_ID_3': 'https://www.w3schools.com/html/mov_bbb.mp4',
  'REEL_ID_4': 'https://www.w3schools.com/html/mov_bbb.mp4',
  'REEL_ID_5': 'https://www.w3schools.com/html/mov_bbb.mp4',
  'REEL_ID_6': 'https://www.w3schools.com/html/mov_bbb.mp4'
};

window.openReelModal = (reelId) => {
  const modal = document.getElementById('reelModal');
  const video = document.getElementById('reelVideo');
  if (modal && video) {
    // Set the source to a direct mp4 video URL instead of Instagram embed
    video.src = reelVideos[reelId] || 'https://www.w3schools.com/html/mov_bbb.mp4';
    modal.style.display = 'flex';
    document.body.classList.add('modal-open');
    video.play();
  }
}
window.closeReelModal = () => {
  const modal = document.getElementById('reelModal');
  const video = document.getElementById('reelVideo');
  if (modal && video) {
    video.pause();
    video.src = ''; // stops the video
    modal.style.display = 'none';
    document.body.classList.remove('modal-open');
  }
}

window.handleRegister = () => {
  const name = (document.getElementById('regName').value || '').trim();
  const email = (document.getElementById('regEmail').value || '').trim();
  const phone = (document.getElementById('regPhone').value || '').trim();
  const pass = (document.getElementById('regPass').value || '').trim();
  if (!name || !email || !pass) return alert('Please fill in Full Name, Email, and Password.');

  firebase.auth().createUserWithEmailAndPassword(email, pass)
    .then((userCredential) => {
      const user = userCredential.user;
      const userData = { name, email, phone, date: new Date().toISOString() };

      // Immediately log in user locally and update UI
      currentUser = { uid: user.uid, name, email, phone };
      localStorage.setItem('saforio_currentUser', JSON.stringify(currentUser));
      updateUserUI();

      // Save extra details to Firestore
      if (db) {
        db.collection("users").doc(user.uid).set(userData)
          .catch(err => console.error("Firestore user profile error:", err));
      }

      alert('Account created successfully! Welcome to ROKEA by RK.');
      closeAuth();
    })
    .catch((error) => {
      alert("Registration failed: " + error.message);
    });
};

window.handleAuth = () => {
  const email = document.getElementById('loginEmail').value;
  const pass = document.getElementById('loginPass').value;

  if (email === (process.env.ADMIN_EMAIL || 'admin') && pass === (process.env.ADMIN_PASSWORD || 'rokea@2025')) {
    closeAuth();
    const adminModal = document.getElementById('adminModal');
    if (adminModal) {
      adminModal.style.display = 'flex';
      renderAll();
    } else {
      sessionStorage.setItem('openAdmin', 'true');
      window.location.href = 'index.html';
    }
    return;
  }

  firebase.auth().signInWithEmailAndPassword(email, pass)
    .then((userCredential) => {
      console.log("Logged in with Firebase Auth");
      closeAuth();
    })
    .catch((error) => {
      alert("Login failed: " + error.message);
    });
}

// Firebase Auth State Observer
firebase.auth().onAuthStateChanged((user) => {
  if (user) {
    // User is signed in
    if (db) {
      db.collection("users").doc(user.uid).get().then((doc) => {
        if (doc.exists) {
          currentUser = doc.data();
          currentUser.uid = user.uid;
          localStorage.setItem('saforio_currentUser', JSON.stringify(currentUser));
          updateUserUI();
        } else {
          currentUser = {
            uid: user.uid,
            email: user.email,
            name: user.displayName || (user.email ? user.email.split('@')[0] : 'User')
          };
          localStorage.setItem('saforio_currentUser', JSON.stringify(currentUser));
          updateUserUI();
        }
      }).catch((err) => {
        console.warn("Could not fetch user doc:", err);
        currentUser = {
          uid: user.uid,
          email: user.email,
          name: user.displayName || (user.email ? user.email.split('@')[0] : 'User')
        };
        localStorage.setItem('saforio_currentUser', JSON.stringify(currentUser));
        updateUserUI();
      });
    } else {
      currentUser = {
        uid: user.uid,
        email: user.email,
        name: user.displayName || (user.email ? user.email.split('@')[0] : 'User')
      };
      localStorage.setItem('saforio_currentUser', JSON.stringify(currentUser));
      updateUserUI();
    }
  } else {
    // User is signed out
    currentUser = null;
    localStorage.removeItem('saforio_currentUser');
    updateUserUI();
  }
});


function updateUserUI() {
  const link = document.getElementById('userLinkCont');
  const mobileLink = document.getElementById('mobileLoginCont');
  let mobileNavCont = document.getElementById('mobileUserNavCont');

  if (currentUser) {
    const firstInitial = currentUser.name ? currentUser.name.charAt(0).toUpperCase() : (currentUser.email ? currentUser.email.charAt(0).toUpperCase() : 'U');
    const shortName = currentUser.name ? currentUser.name.split(' ')[0] : (currentUser.email ? currentUser.email.split('@')[0] : 'User');
    const fullName = currentUser.name || shortName;
    const userEmail = currentUser.email || '';

    const profileHtml = `
      <div class="user-profile-cont" onclick="toggleUserDropdown(event)" role="button" tabindex="0" aria-label="User Account">
        <div class="user-info-text">
          <span class="user-welcome">Welcome</span>
          <span class="user-name-display">${shortName}</span>
        </div>
        <div class="user-avatar-badge">${firstInitial}</div>
        
        <div class="user-dropdown" id="userDropdown" onclick="event.stopPropagation()">
          <div class="dropdown-header">
            <div class="dropdown-header-avatar">${firstInitial}</div>
            <div class="dropdown-user-name">${fullName}</div>
            <div class="dropdown-user-email">${userEmail}</div>
          </div>
          <a href="javascript:void(0)" class="dropdown-item" onclick="closeAllUserDropdowns(); toggleWishlist()">
            <span class="item-icon">✦</span> My Wishlist
          </a>
          <a href="javascript:void(0)" class="dropdown-item" onclick="closeAllUserDropdowns(); toggleCart()">
            <span class="item-icon">✦</span> My Shopping Cart
          </a>
          <a href="javascript:void(0)" class="dropdown-item logout-item" onclick="logoutUser()">
            <span class="item-icon">✕</span> Sign Out
          </a>
        </div>
      </div>
    `;

    if (link) link.innerHTML = profileHtml;

    // Mobile nav bar avatar inside .nav-actions
    const navActions = document.querySelector('.nav-actions');
    if (navActions && !mobileNavCont) {
      mobileNavCont = document.createElement('div');
      mobileNavCont.id = 'mobileUserNavCont';
      mobileNavCont.className = 'mobile-user-nav-cont';
      navActions.appendChild(mobileNavCont);
    }

    if (mobileNavCont) {
      mobileNavCont.innerHTML = `
        <div class="user-profile-cont mobile-profile-cont" onclick="toggleMobileUserDropdown(event)" role="button" tabindex="0" aria-label="User Account">
          <div class="user-avatar-badge">${firstInitial}</div>
          <div class="user-dropdown mobile-dropdown" id="mobileUserDropdown" onclick="event.stopPropagation()">
            <div class="dropdown-header">
              <div class="dropdown-header-avatar">${firstInitial}</div>
              <div class="dropdown-user-name">${fullName}</div>
              <div class="dropdown-user-email">${userEmail}</div>
            </div>
            <a href="javascript:void(0)" class="dropdown-item" onclick="closeAllUserDropdowns(); toggleWishlist()">
              <span class="item-icon">✦</span> My Wishlist
            </a>
            <a href="javascript:void(0)" class="dropdown-item" onclick="closeAllUserDropdowns(); toggleCart()">
              <span class="item-icon">✦</span> My Shopping Cart
            </a>
            <a href="javascript:void(0)" class="dropdown-item logout-item" onclick="logoutUser()">
              <span class="item-icon">✕</span> Sign Out
            </a>
          </div>
        </div>
      `;
    }

    if (mobileLink) {
      mobileLink.innerHTML = `
        <div class="mobile-drawer-user-info" style="padding: 12px 14px; background: rgba(255, 255, 255, 0.05); border-radius: 8px; margin: 8px 0; border: 1px solid rgba(212, 175, 55, 0.2);">
          <div style="font-weight: 600; color: #fff; font-size: 14px; font-family: 'Playfair Display', serif;">${fullName}</div>
          <div style="font-size: 11px; color: rgba(255,255,255,0.6); margin-bottom: 8px;">${userEmail}</div>
          <a href="javascript:void(0)" onclick="logoutUser()" style="color: #ff6b6b; font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 1px;">Sign Out</a>
        </div>
      `;
    }
  } else {
    if (link) link.innerHTML = '<a href="javascript:void(0)" onclick="openAuth()" id="navLogin">Login / Register</a>';
    if (mobileLink) mobileLink.innerHTML = '<a href="javascript:void(0)" onclick="toggleMobileMenu(); openAuth()">Login / Register</a>';
    if (mobileNavCont) mobileNavCont.innerHTML = '';
  }
}

window.closeAllUserDropdowns = () => {
  const dropdown = document.getElementById('userDropdown');
  if (dropdown) dropdown.classList.remove('active');
  const mobileDropdown = document.getElementById('mobileUserDropdown');
  if (mobileDropdown) mobileDropdown.classList.remove('active');
};

window.toggleUserDropdown = (e) => {
  if (e) e.stopPropagation();
  const dropdown = document.getElementById('userDropdown');
  if (dropdown) dropdown.classList.toggle('active');
  const mobileDropdown = document.getElementById('mobileUserDropdown');
  if (mobileDropdown) mobileDropdown.classList.remove('active');
};

window.toggleMobileUserDropdown = (e) => {
  if (e) e.stopPropagation();
  const mobileDropdown = document.getElementById('mobileUserDropdown');
  if (mobileDropdown) mobileDropdown.classList.toggle('active');
  const dropdown = document.getElementById('userDropdown');
  if (dropdown) dropdown.classList.remove('active');
};

// Close dropdown on click outside
window.addEventListener('click', () => {
  closeAllUserDropdowns();
});

window.logoutUser = () => {
  firebase.auth().signOut().then(() => {
    localStorage.removeItem('saforio_currentUser');
    location.reload();
  }).catch(() => {
    localStorage.removeItem('saforio_currentUser');
    location.reload();
  });
};

window.toggleAdminMenu = (forceClose = false) => {
  if (window.innerWidth > 1024) return;
  const navLinks = document.querySelector('.admin-nav-links');
  const toggleBtn = document.querySelector('.admin-menu-toggle');
  if (!navLinks || !toggleBtn) return;

  if (forceClose) {
    navLinks.classList.remove('active');
    toggleBtn.classList.remove('active');
  } else {
    navLinks.classList.toggle('active');
    toggleBtn.classList.toggle('active');
  }
}


// =============================================
// ADMIN DASHBOARD TABS
// =============================================

window.switchAdminTab = (tab) => {
  document.getElementById('viewProducts').style.display = tab === 'products' ? 'block' : 'none';
  document.getElementById('viewCustomers').style.display = tab === 'customers' ? 'block' : 'none';
  document.getElementById('viewLeads').style.display = tab === 'leads' ? 'block' : 'none';
  document.getElementById('viewOrders').style.display = tab === 'orders' ? 'block' : 'none';

  document.getElementById('tabProducts').classList.toggle('active', tab === 'products');
  document.getElementById('tabCustomers').classList.toggle('active', tab === 'customers');
  document.getElementById('tabLeads').classList.toggle('active', tab === 'leads');
  document.getElementById('tabOrders').classList.toggle('active', tab === 'orders');

  const titleEl = document.getElementById('adminTabTitle');
  if (tab === 'products') titleEl.innerText = 'Product Management';
  else if (tab === 'customers') titleEl.innerText = 'Customer Records';
  else if (tab === 'leads') titleEl.innerText = 'Consultation Leads';
  else titleEl.innerText = 'Order & Payment History';

  document.getElementById('addBtnTop').style.display = tab === 'products' ? 'block' : 'none';

  if (tab === 'customers') renderAdminCustomers();
  if (tab === 'leads') renderAdminLeads();
  if (tab === 'orders') renderAdminOrders();

  // Auto-close menu on mobile after switching tab
  window.toggleAdminMenu(true);
}

window.switchAdminProductFilter = (filter) => {
  adminCurrentProductFilter = filter;
  document.querySelectorAll('.admin-tab-btn').forEach(btn => btn.classList.remove('active'));
  if (filter === 'all') document.getElementById('adminFilterAll').classList.add('active');
  else if (filter === 'sarees') document.getElementById('adminFilterSarees').classList.add('active');
  else if (filter === 'imitation') document.getElementById('adminFilterJewels').classList.add('active');
  renderAdminList();
}

// =============================================
// ADMIN: LEADS — Firestore + localStorage fallback
// =============================================

function renderAdminLeads() {
  const list = document.getElementById('adminLeadList');
  if (!list) return;

  // Show loading state
  list.innerHTML = '<tr><td colspan="5" style="text-align:center; padding:30px; color:var(--muted);">Loading leads...</td></tr>';

  if (db) {
    db.collection("leads")
      .orderBy("date", "desc")
      .get()
      .then((snapshot) => {
        if (snapshot.empty) {
          list.innerHTML = '<tr><td colspan="5" style="text-align:center; padding:40px; color:var(--muted);">No leads captured yet.</td></tr>';
          return;
        }
        list.innerHTML = snapshot.docs.map((doc) => {
          const l = doc.data();
          const dateStr = l.date ? new Date(l.date).toLocaleDateString('en-IN') : 'N/A';
          return `
            <tr>
              <td><strong>${l.name || 'N/A'}</strong></td>
              <td>${l.phone || 'N/A'}</td>
              <td><span class="badge" style="background:var(--ivory); padding:5px 10px; font-size:10px; border:1px solid var(--gold);">${l.interest || 'N/A'}</span></td>
              <td>${dateStr}</td>
              <td><button class="admin-btn btn-delete" onclick="deleteFirebaseLead('${doc.id}')">Delete</button></td>
            </tr>`;
        }).join('');
      })
      .catch((err) => {
        console.error("Firestore leads fetch error:", err);
        renderAdminLeadsLocal(); // fallback
      });
  } else {
    renderAdminLeadsLocal();
  }
}

function renderAdminLeadsLocal() {
  const list = document.getElementById('adminLeadList');
  if (!list) return;
  const leads = JSON.parse(localStorage.getItem('saforio_leads')) || [];
  if (leads.length === 0) {
    list.innerHTML = '<tr><td colspan="5" style="text-align:center; padding:40px; color:var(--muted);">No leads captured yet.</td></tr>';
    return;
  }
  list.innerHTML = leads.map((l, idx) => `
    <tr>
      <td><strong>${l.name}</strong></td>
      <td>${l.phone}</td>
      <td><span class="badge" style="background:var(--ivory); padding:5px 10px; font-size:10px; border:1px solid var(--gold);">${l.interest}</span></td>
      <td>${l.date}</td>
      <td><button class="admin-btn btn-delete" onclick="deleteLocalLead(${idx})">Delete</button></td>
    </tr>`).join('');
}

window.deleteFirebaseLead = (docId) => {
  if (!confirm('Delete this lead?')) return;
  db.collection("leads").doc(docId).delete()
    .then(() => { console.log("Lead deleted from Firestore"); renderAdminLeads(); })
    .catch(err => console.error("Delete lead error:", err));
}

window.deleteLocalLead = (idx) => {
  if (!confirm('Delete this lead record?')) return;
  const leads = JSON.parse(localStorage.getItem('saforio_leads')) || [];
  leads.splice(idx, 1);
  localStorage.setItem('saforio_leads', JSON.stringify(leads));
  renderAdminLeadsLocal();
}

// Legacy alias
window.deleteLead = window.deleteLocalLead;

// =============================================
// ADMIN: CUSTOMERS — Firestore + localStorage fallback
// =============================================

function renderAdminCustomers() {
  const list = document.getElementById('adminCustomerList');
  if (!list) return;

  list.innerHTML = '<tr><td colspan="4" style="text-align:center; padding:30px; color:var(--muted);">Loading customers...</td></tr>';

  if (db) {
    db.collection("users")
      .orderBy("date", "desc")
      .get()
      .then((snapshot) => {
        if (snapshot.empty) {
          list.innerHTML = '<tr><td colspan="4" style="text-align:center; padding:40px; color:var(--muted);">No customers registered yet.</td></tr>';
          return;
        }
        list.innerHTML = snapshot.docs.map((doc) => {
          const u = doc.data();
          const dateStr = u.date ? new Date(u.date).toLocaleDateString('en-IN') : 'N/A';
          return `
            <tr>
              <td><strong>${u.name || 'N/A'}</strong></td>
              <td>${u.email || 'N/A'}</td>
              <td>${u.phone || 'N/A'}</td>
              <td>${dateStr}</td>
            </tr>`;
        }).join('');
      })
      .catch((err) => {
        console.error("Firestore customers fetch error:", err);
        renderAdminCustomersLocal(); // fallback
      });
  } else {
    renderAdminCustomersLocal();
  }
}

function renderAdminCustomersLocal() {
  const list = document.getElementById('adminCustomerList');
  if (!list) return;
  if (users.length === 0) {
    list.innerHTML = '<tr><td colspan="4" style="text-align:center; padding:40px; color:var(--muted);">No customers yet.</td></tr>';
    return;
  }
  list.innerHTML = users.map(u => `
    <tr>
      <td><strong>${u.name}</strong></td>
      <td>${u.email}</td>
      <td>${u.phone}</td>
      <td>${u.date}</td>
    </tr>`).join('');
}

// =============================================
// ADMIN: ORDERS — Firestore + localStorage fallback
// =============================================

function renderAdminOrders() {
  const list = document.getElementById('adminOrderList');
  if (!list) return;

  list.innerHTML = '<tr><td colspan="7" style="text-align:center; padding:30px; color:var(--muted);">Loading orders...</td></tr>';

  if (db) {
    db.collection("orders")
      .orderBy("date", "desc")
      .get()
      .then((snapshot) => {
        if (snapshot.empty) {
          list.innerHTML = '<tr><td colspan="7" style="text-align:center; padding:40px; color:var(--muted);">No orders found.</td></tr>';
          return;
        }

        // Save globally for lookup
        window.loadedOrders = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

        list.innerHTML = window.loadedOrders.map((o) => {
          const dateStr = o.date ? new Date(o.date).toLocaleDateString('en-IN') : 'N/A';
          const shortId = o.id.slice(0, 8).toUpperCase();
          return `
            <tr>
              <td><strong>#${shortId}</strong></td>
              <td>${o.customer?.name || 'N/A'}</td>
              <td>${o.customer?.phone || 'N/A'}</td>
              <td>₹${(o.total || 0).toLocaleString('en-IN')}</td>
              <td><span class="badge" style="background:var(--ivory); padding:5px 10px; font-size:10px; border:1px solid var(--gold);">${o.paymentId || 'N/A'}</span></td>
              <td>${dateStr}</td>
              <td>
                <button class="admin-btn btn-edit" onclick="viewOrderDetails('${o.id}', true)">View Items</button>
              </td>
            </tr>`;
        }).join('');
      })
      .catch((err) => {
        console.error("Firestore orders fetch error:", err);
        renderAdminOrdersLocal(); // fallback
      });
  } else {
    renderAdminOrdersLocal();
  }
}

function renderAdminOrdersLocal() {
  const list = document.getElementById('adminOrderList');
  const orders = JSON.parse(localStorage.getItem('saforio_orders')) || [];
  if (orders.length === 0) {
    list.innerHTML = '<tr><td colspan="7" style="text-align:center; padding:40px; color:var(--muted);">No orders found.</td></tr>';
    return;
  }
  list.innerHTML = orders.map((o) => `
    <tr>
      <td><strong>#${o.id}</strong></td>
      <td>${o.customer.name}</td>
      <td>${o.customer.phone}</td>
      <td>₹${o.total.toLocaleString()}</td>
      <td><span class="badge" style="background:var(--ivory); padding:5px 10px; font-size:10px; border:1px solid var(--gold);">${o.paymentId || 'N/A'}</span></td>
      <td>${o.date}</td>
      <td><button class="admin-btn btn-edit" onclick="viewOrderDetails('${o.id}', false)">View Items</button></td>
    </tr>`).join('');
}

window.viewOrderDetails = (orderId, isFirestore = true) => {
  let order = null;

  if (isFirestore) {
    order = (window.loadedOrders || []).find(o => o.id.toString() === orderId.toString());
  } else {
    const orders = JSON.parse(localStorage.getItem('saforio_orders')) || [];
    order = orders.find(o => o.id.toString() === orderId.toString());
  }

  if (!order) return alert("Order not found!");

  // Create the modal overlay if it doesn't exist
  let modal = document.getElementById('orderDetailModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'orderDetailModal';
    modal.className = 'modal';
    modal.style.cssText = `
      display: none;
      position: fixed;
      z-index: 3000;
      inset: 0;
      background: rgba(6, 6, 9, 0.75);
      backdrop-filter: blur(6px);
      align-items: center;
      justify-content: center;
      transition: all 0.3s ease;
    `;
    document.body.appendChild(modal);
  }

  const shortId = orderId.length > 8 ? orderId.slice(0, 8).toUpperCase() : orderId;

  // Render items with image, price details
  const itemsHtml = (order.items || []).map(item => `
    <div style="display: flex; align-items: center; gap: 15px; padding: 12px; background: rgba(255, 255, 255, 0.6); border: 1px solid rgba(201, 168, 76, 0.15); border-radius: 8px; margin-bottom: 10px;">
      <div style="width: 60px; height: 60px; border-radius: 6px; overflow: hidden; background: url('${item.image || item.img}') center/cover; border: 1px solid rgba(0,0,0,0.05); flex-shrink: 0;"></div>
      <div style="flex-grow: 1; min-width: 0;">
        <h4 style="margin: 0 0 4px 0; font-family: 'Playfair Display', serif; font-size: 15px; color: var(--dark); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${item.name}</h4>
        <span style="font-size: 10px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.5px;">${item.category || 'Product'}</span>
      </div>
      <div style="font-family: 'Poppins', sans-serif; font-weight: 700; color: var(--gold-dark); font-size: 14px;">₹${(parseInt(item.price) || 0).toLocaleString('en-IN')}</div>
    </div>
  `).join('');

  modal.innerHTML = `
    <div class="modal-content" style="max-width: 650px; width: 95%; background: var(--ivory); padding: 30px; border-radius: 12px; box-shadow: 0 10px 40px rgba(0,0,0,0.25); border: 1px solid rgba(201, 168, 76, 0.3); animation: fadeInUp 0.3s ease forwards; display: flex; flex-direction: column; max-height: 85vh; box-sizing: border-box; overflow: hidden;">
      <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid rgba(201, 168, 76, 0.2); padding-bottom: 15px; margin-bottom: 20px;">
        <div>
          <span class="section-label" style="margin-bottom: 2px;">Order Summary</span>
          <h3 style="font-family: 'Playfair Display', serif; font-size: 24px; margin: 0; color: var(--dark);">Order <em style="color: var(--gold-dark);">#${shortId}</em></h3>
        </div>
        <span onclick="closeOrderDetails()" style="font-size: 28px; cursor: pointer; color: var(--muted); transition: color 0.2s;" onmouseover="this.style.color='var(--gold-dark)'" onmouseout="this.style.color='var(--muted)'">&times;</span>
      </div>

      <div style="overflow-y: auto; flex-grow: 1; padding-right: 5px;">
        <!-- Two Column Details Grid -->
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 20px; margin-bottom: 25px;">
          <!-- Customer Address Card -->
          <div style="background: rgba(255, 255, 255, 0.8); border: 1px solid rgba(201, 168, 76, 0.15); border-radius: 8px; padding: 18px; box-shadow: 0 2px 8px rgba(0,0,0,0.01);">
            <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 12px; color: var(--gold-dark); font-weight: 700; font-size: 13px; text-transform: uppercase; letter-spacing: 0.5px;">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width: 15px; height: 15px;"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
              Customer & Address
            </div>
            <div style="display: flex; flex-direction: column; gap: 8px; font-size: 13px; line-height: 1.5; color: var(--text);">
              <div><strong style="color: var(--dark);">Name:</strong> ${order.customer?.name || 'Guest Customer'}</div>
              <div><strong style="color: var(--dark);">Phone:</strong> ${order.customer?.phone || 'N/A'}</div>
              <div><strong style="color: var(--dark);">Address:</strong> <span style="font-style: italic; color: #555;">${order.customer?.address || 'No Address Provided'}</span></div>
            </div>
          </div>

          <!-- Order Stats Card -->
          <div style="background: rgba(255, 255, 255, 0.8); border: 1px solid rgba(201, 168, 76, 0.15); border-radius: 8px; padding: 18px; box-shadow: 0 2px 8px rgba(0,0,0,0.01);">
            <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 12px; color: var(--gold-dark); font-weight: 700; font-size: 13px; text-transform: uppercase; letter-spacing: 0.5px;">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width: 15px; height: 15px;"><rect x="2" y="4" width="20" height="16" rx="2" ry="2"/><line x1="12" y1="18" x2="12" y2="18"/></svg>
              Payment & Status
            </div>
            <div style="display: flex; flex-direction: column; gap: 8px; font-size: 13px; line-height: 1.5; color: var(--text);">
              <div><strong style="color: var(--dark);">Payment ID:</strong> <span style="font-family: monospace; font-size: 11px; background: rgba(201,168,76,0.1); padding: 2px 6px; border-radius: 4px; color: var(--gold-dark); font-weight: 600;">${order.paymentId || 'N/A'}</span></div>
              <div><strong style="color: var(--dark);">Date:</strong> ${order.date ? new Date(order.date).toLocaleString('en-IN') : 'N/A'}</div>
              <div style="margin-top: 5px; padding-top: 5px; border-top: 1px dashed rgba(201, 168, 76, 0.15); display: flex; justify-content: space-between; align-items: center;">
                <span style="font-weight: 700; color: var(--dark);">Total Amount:</span>
                <span style="font-family: 'Poppins', sans-serif; font-weight: 700; font-size: 18px; color: var(--gold-dark);">₹${(order.total || 0).toLocaleString('en-IN')}</span>
              </div>
            </div>
          </div>
        </div>

        <!-- Items Ordered Header -->
        <h4 style="margin: 0 0 12px 0; color: var(--dark); font-size: 13px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; display: flex; align-items: center; gap: 6px;">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width: 15px; height: 15px;"><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z"/><path d="M3 6h18"/><path d="M16 10a4 4 0 0 1-8 0"/></svg>
          Ordered Items (${(order.items || []).length})
        </h4>

        <!-- Items Container -->
        <div style="max-height: 250px; overflow-y: auto; padding-right: 5px;">
          ${itemsHtml}
        </div>
      </div>

      <div style="display: flex; justify-content: flex-end; gap: 10px; margin-top: 20px; border-top: 1px solid rgba(201, 168, 76, 0.2); padding-top: 15px;">
        <button class="btn-primary" onclick="closeOrderDetails()" style="padding: 10px 25px; font-size: 11px; font-weight: 600; border-radius: 4px; cursor: pointer; background: var(--gold-dark); border: none; color: #fff; text-transform: uppercase; letter-spacing: 1px; font-family: 'Poppins', sans-serif; transition: all 0.2s;" onmouseover="this.style.background='var(--dark)'" onmouseout="this.style.background='var(--gold-dark)'">Close Details</button>
      </div>
    </div>
  `;

  modal.style.setProperty('display', 'flex', 'important');
  document.body.classList.add('modal-open');
}

window.closeOrderDetails = () => {
  const modal = document.getElementById('orderDetailModal');
  if (modal) {
    modal.style.setProperty('display', 'none', 'important');
  }
  document.body.classList.remove('modal-open');
}

// =============================================
// MARQUEE RENDERING
// =============================================

function renderMarquee() {
  const track = document.getElementById('marquee-track');
  if (!track) return;

  const marqueeProductNames = [
    "Premium soft silk saree",
    "Dubion saree",
    "Glow Viscose saree",
    "White stone necklace",
    "Deep wine floral necklace",
    "Antique gold coin necklace with Lakshmi pendant"
  ];

  let content = marqueeProductNames.map(name => `
    <span class="marquee-item">
      ${name} <span class="marquee-dot"></span>
    </span>
  `).join('');

  // Duplicate for seamless loop
  track.innerHTML = content + content + content;
}

// =============================================
// PRODUCT GRID
// =============================================

function renderGrid() {
  const grid = document.getElementById('main-product-grid');
  if (!grid) return;
  let filtered = products.filter(p => p.category === currentCategory);

  // Apply Sorting
  if (currentSort === 'low') {
    filtered.sort((a, b) => a.price - b.price);
  } else if (currentSort === 'high') {
    filtered.sort((a, b) => b.price - a.price);
  } else {
    // Default: Sort by position (ascending)
    filtered.sort((a, b) => (a.position || 0) - (b.position || 0));
  }

  grid.innerHTML = filtered.map((p) => {
    const inWishlist = wishlist.find(w => w.id == p.id);
    const isOOS = p.stock === 'Out of Stock';
    return `
    <div class="product-card" style="animation: fadeInUp 0.5s ease forwards;" onclick="openProductDetail(${p.id})">
      ${isOOS ? `<div class="oos-ribbon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" style="width:9px;height:9px;"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg> Sold Out</div>` : ''}

      <div class="product-img ${isOOS ? 'out-of-stock' : ''}">
        <img src="${optimizeImageUrl(p.image || p.img)}" width="300" height="400" class="img-main" loading="lazy" decoding="async" ${getSEOAttributes(p)} onerror="this.onerror=null; this.src='data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'; this.style.background='linear-gradient(135deg,#f0e6d3,#faf6ef)';">
        <img src="${optimizeImageUrl(p.imageHover || p.imgHover || p.image || p.img)}" width="300" height="400" class="img-hover" loading="lazy" decoding="async" ${getSEOAttributes(p)} onerror="this.style.display='none'">
        <div class="product-wish ${inWishlist ? 'active' : ''}" onclick="event.stopPropagation(); addToWishlist('${p.id}')">
          <svg class="wish-icon-svg" viewBox="0 0 24 24" fill="${inWishlist ? '#e91e63' : 'none'}" stroke="${inWishlist ? '#e91e63' : '#666'}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width: 20px; height: 20px; transition: all 0.2s ease;"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"></path></svg>
        </div>
        <div class="product-share" onclick="event.stopPropagation(); shareProduct('${p.id}')">
          <svg viewBox="0 0 24 24" fill="none" stroke="#555" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width: 16px; height: 16px;"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>
        </div>

      </div>
      <div class="product-info" style="display: flex; flex-direction: column; flex-grow: 1; padding: 15px;">
        <div class="product-price" style="display: block !important; margin-bottom: 8px;">
          <span class="price-main" style="color: var(--gold-dark); font-weight: 700; font-size: 18px;">₹${(extractPriceFromDesc(p.description) || p.price || 0).toLocaleString('en-IN')}</span>
        </div>
        <div class="product-type" style="font-size: 10px; color: var(--muted); text-transform: uppercase;">${p.category.toUpperCase()}</div>
        <h3 class="product-name" style="margin: 5px 0 15px 0;">${p.name}</h3>
        ${isOOS
        ? `<button class="btn-oos" style="display:flex;align-items:center;justify-content:center;gap:8px;margin-top:auto;width:100%;padding:12px 16px;border:1.5px solid #b0937a;background:linear-gradient(135deg,#f5ede6,#efe4d8);color:#7a4a2a;font-size:11px;font-weight:700;letter-spacing:2px;text-transform:uppercase;border-radius:4px;cursor:not-allowed;font-family:'Poppins',sans-serif;" disabled>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:13px;height:13px;"><circle cx="12" cy="12" r="10"/><line x1="8" y1="12" x2="16" y2="12"/></svg>
              Currently Unavailable
            </button>`
        : `<button class="btn-primary" style="display:flex;align-items:center;justify-content:center;gap:8px;margin-top:auto;" onclick="event.stopPropagation();addToCart('${p.id}')">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:14px;height:14px;"><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z"/><path d="M3 6h18"/><path d="M16 10a4 4 0 0 1-8 0"/></svg>
              Add to Cart
            </button>`
      }
      </div>
    </div>`;
  }).join('');
}

window.switchCategory = (cat) => {
  currentCategory = cat;
  document.querySelectorAll('.tab-item').forEach(tab => {
    tab.classList.toggle('active', tab.dataset.cat === cat);
  });
  renderGrid();
}

window.selectCategory = (cat) => {
  // Navigate to collections page
  localStorage.setItem('rokea_selected_category', cat);
  window.location.href = 'collections.html';
}

window.backToCategories = () => {
  // Navigate back to home page category section
  window.location.href = 'index.html#products';
}

window.applySort = (sortType) => {
  currentSort = sortType;
  renderGrid();
}

function renderAdminList() {
  const list = document.getElementById('adminProductList');
  if (!list) return;

  let filtered = products;
  if (adminCurrentProductFilter !== 'all') {
    filtered = products.filter(p => p.category === adminCurrentProductFilter);
  }

  list.innerHTML = filtered.map((p, idx) => {
    const isOutOfStock = p.stock === 'Out of Stock';
    return `
    <div class="admin-item" data-id="${p.id}" style="background-color: ${isOutOfStock ? 'rgba(217, 48, 37, 0.05)' : 'transparent'}; border-left: 3px solid ${isOutOfStock ? '#D93025' : '#4CAF50'};">
      <div class="drag-handle" style="cursor: grab; padding: 0 10px; color: #ccc;">☰</div>
      <div class="admin-img" style="width:40px;height:40px;border-radius:4px;flex-shrink:0; background:url('${p.image || p.img}') center/cover; opacity: ${isOutOfStock ? '0.5' : '1'};"></div>
      <div class="admin-item-info">
        <div style="font-size:12px; font-weight:600; ${isOutOfStock ? 'color: #999;' : ''}">${p.name}</div>
        <div style="font-size:10px; color:var(--muted); display: flex; align-items: center; gap: 8px;">
          <span>${p.category} • ₹${p.price.toLocaleString('en-IN')}</span>
          <span style="display: inline-flex; align-items: center; gap: 4px; padding: 2px 8px; border-radius: 12px; background: ${isOutOfStock ? '#ffebee' : '#e8f5e9'}; font-size: 9px; font-weight: 600; color: ${isOutOfStock ? '#D93025' : '#388e3c'};">
            <span style="width: 6px; height: 6px; border-radius: 50%; background: ${isOutOfStock ? '#D93025' : '#4CAF50'};"></span>
            ${isOutOfStock ? 'SOLD OUT' : 'IN STOCK'}
          </span>
        </div>
      </div>
      <div class="admin-item-actions">
        <button class="admin-btn btn-edit" onclick="editProductById(${p.id})">Edit</button>
        <button class="admin-btn btn-delete" onclick="deleteProductById(${p.id})">Delete</button>
      </div>
    </div>`;
  }).join('');

  // Initialize Sortable
  if (window.Sortable && filtered.length > 1) {
    Sortable.create(list, {
      animation: 150,
      handle: '.drag-handle',
      ghostClass: 'sortable-ghost',
      onEnd: function () {
        updateProductPositions();
      }
    });
  }
}

function updateProductPositions() {
  const list = document.getElementById('adminProductList');
  const items = list.querySelectorAll('.admin-item');
  const newOrderIds = Array.from(items).map(item => item.getAttribute('data-id'));

  // Create a map of IDs to their new positions based on the UI
  const idToPosition = {};
  newOrderIds.forEach((id, index) => {
    idToPosition[id] = index;
  });

  // Update positions in the products array
  // If we are filtered, we only update the positions of the filtered items relative to each other?
  // Actually, it's easier to maintain a global position.
  // When we reorder in a filtered view, we should update the 'position' field of these items.

  // To keep it simple and consistent:
  // 1. Get the current filtered items.
  // 2. Reorder them in the global 'products' array based on the new UI order.

  const currentFilteredIds = newOrderIds;
  const otherProducts = products.filter(p => !currentFilteredIds.includes(p.id.toString()));
  const reorderedFilteredProducts = currentFilteredIds.map(id => products.find(p => p.id.toString() === id));

  // Reconstruct products array: others + reordered
  // Actually, to maintain overall order, we can just update the 'position' field.

  products.forEach(p => {
    if (idToPosition[p.id.toString()] !== undefined) {
      // We need to offset this position based on where the filtered group starts in the global list?
      // No, let's just use absolute positions.
      p.position = idToPosition[p.id.toString()];
    } else {
      // For products not in the current filter, we can keep their position or shift them.
      // Simplest: just update the ones we dragged.
    }
  });

  // Re-sort products by position
  products.sort((a, b) => (a.position || 0) - (b.position || 0));

  // Re-normalize positions 0, 1, 2...
  products.forEach((p, i) => p.position = i);

  saveProducts();

  // Sync all changed positions to Firestore
  if (db) {
    products.forEach(p => {
      db.collection("products").doc(p.id.toString()).update({ position: p.position })
        .catch(err => console.error("Position sync error:", err));
    });
  }
}

// Helper to find index by ID since positions change
window.editProductById = (id) => {
  const idx = products.findIndex(p => p.id == id);
  if (idx > -1) editProduct(idx);
}

window.deleteProductById = (id) => {
  const idx = products.findIndex(p => p.id == id);
  if (idx > -1) deleteProduct(idx);
}

function renderAll() {
  renderGrid();
  renderAdminList();
  renderMarquee();
  // Load product page: prefer URL ?id=, fallback to sessionStorage (after refresh)
  const activeId = (typeof urlId !== 'undefined' && urlId)
    ? urlId
    : (window._pendingProductId || sessionStorage.getItem('rokea_current_product_id'));
  if (activeId && document.getElementById('detailMainImg')) {
    initProductPage(activeId);
  }
}

const adminModal = document.getElementById('adminModal');
const productForm = document.getElementById('productForm');

if (productForm) {
  productForm.onsubmit = (e) => {
    e.preventDefault();
    const editProductId = document.getElementById('editProductId').value;
    const newProd = {
      name: document.getElementById('prodName').value,
      category: document.getElementById('prodCategory').value,
      price: parseInt(document.getElementById('prodPrice').value),
      image: document.getElementById('prodImg').value,
      imageHover: document.getElementById('prodImgHover').value,
      extraImages: document.getElementById('prodExtraImgs') ? document.getElementById('prodExtraImgs').value.split(',').map(s => s.trim()).filter(Boolean) : [],
      stock: document.getElementById('prodStock').value,
      description: document.getElementById('prodDesc').value,
      productCare: document.getElementById('prodCare').value,
      slug: generateSlug(document.getElementById('prodName').value),
      seoTitle: document.getElementById('seoTitle') ? document.getElementById('seoTitle').value : '',
      seoKeyword: document.getElementById('seoKeyword') ? document.getElementById('seoKeyword').value : '',
      seoDesc: document.getElementById('seoDesc') ? document.getElementById('seoDesc').value : '',
      seoSecondaryKeywords: document.getElementById('seoSecondaryKeywords') ? document.getElementById('seoSecondaryKeywords').value : '',
      seoLongTailKeywords: document.getElementById('seoLongTailKeywords') ? document.getElementById('seoLongTailKeywords').value : '',
      seoTransactionalKeywords: document.getElementById('seoTransactionalKeywords') ? document.getElementById('seoTransactionalKeywords').value : '',
      seoCommercialKeywords: document.getElementById('seoCommercialKeywords') ? document.getElementById('seoCommercialKeywords').value : '',
      seoKeywords: document.getElementById('seoKeywords') ? document.getElementById('seoKeywords').value : '',
      seoSearchIntent: document.getElementById('seoSearchIntent') ? document.getElementById('seoSearchIntent').value : '',
      seoCanonical: document.getElementById('seoCanonical') ? document.getElementById('seoCanonical').value : '',
      seoRobots: document.getElementById('seoRobots') ? document.getElementById('seoRobots').value : 'index, follow',
      seoImgAlt: document.getElementById('seoImgAlt') ? document.getElementById('seoImgAlt').value : '',
      seoOgTags: document.getElementById('seoOgTags') ? document.getElementById('seoOgTags').value : '',
      seoTwitterTags: document.getElementById('seoTwitterTags') ? document.getElementById('seoTwitterTags').value : '',
      seoProductSchema: document.getElementById('seoProductSchema') ? document.getElementById('seoProductSchema').value : '',
      seoBreadcrumbSchema: document.getElementById('seoBreadcrumbSchema') ? document.getElementById('seoBreadcrumbSchema').value : '',
      seoWebPageSchema: document.getElementById('seoWebPageSchema') ? document.getElementById('seoWebPageSchema').value : '',
      seoOrganizationSchema: document.getElementById('seoOrganizationSchema') ? document.getElementById('seoOrganizationSchema').value : '',
      seoFaq: document.getElementById('seoFaq') ? document.getElementById('seoFaq').value : ''
    };

    if (editProductId) {
      const existingIdx = products.findIndex(p => p.id.toString() === editProductId.toString());
      if (existingIdx > -1) {
        newProd.id = products[existingIdx].id;
        newProd.position = products[existingIdx].position; // Keep existing position
        newProd.slug = products[existingIdx].slug || newProd.slug;
        products[existingIdx] = newProd;
      } else {
        newProd.id = parseFloat(editProductId);
        newProd.position = products.length;
        products.push(newProd);
      }
    } else {
      newProd.id = Date.now();
      newProd.position = -1; // Set to -1 to put at top during re-normalization
      products.unshift(newProd);
    }

    // Re-normalize positions after add/edit
    products.sort((a, b) => (a.position ?? -1) - (b.position ?? -1));
    products.forEach((p, i) => p.position = i);

    // Sync to Firestore
    if (db) {
      db.collection("products").doc(newProd.id.toString()).set(newProd)
        .then(() => console.log("Product synced to Cloud"))
        .catch(err => {
          console.error("Cloud sync error:", err);
          showToast("Cloud sync failed! " + err.message, "error", "Reverting local change...");
          alert("Cloud Sync Error: " + err.message + "\n\nPlease check if your Firestore Security Rules allow writes for anonymous users.");
        });
    }

    saveProducts();
    currentCategory = newProd.category;
    switchCategory(currentCategory);
    productForm.reset();
    document.getElementById('editProductId').value = "";
    document.getElementById('submitBtn').innerText = "Save Product";
    alert("Successfully Saved: " + newProd.name);
  };
}

window.editProduct = (idx) => {
  const p = products[idx];
  document.getElementById('editProductId').value = p.id;
  document.getElementById('prodName').value = p.name;
  document.getElementById('prodCategory').value = p.category;
  document.getElementById('prodPrice').value = p.price;
  document.getElementById('prodImg').value = p.image || p.img;
  document.getElementById('prodImgHover').value = p.imageHover || p.imgHover || p.image || p.img;
  if (document.getElementById('prodExtraImgs')) document.getElementById('prodExtraImgs').value = p.extraImages ? p.extraImages.join(', ') : "";
  document.getElementById('prodStock').value = p.stock || "In Stock";
  document.getElementById('prodDesc').value = p.description || "";
  if (document.getElementById('prodCare')) document.getElementById('prodCare').value = p.productCare || "";

  if (document.getElementById('seoTitle')) document.getElementById('seoTitle').value = p.seoTitle || "";
  if (document.getElementById('seoKeyword')) document.getElementById('seoKeyword').value = p.seoKeyword || "";
  if (document.getElementById('seoDesc')) document.getElementById('seoDesc').value = p.seoDesc || "";
  if (document.getElementById('seoSecondaryKeywords')) document.getElementById('seoSecondaryKeywords').value = p.seoSecondaryKeywords || "";
  if (document.getElementById('seoLongTailKeywords')) document.getElementById('seoLongTailKeywords').value = p.seoLongTailKeywords || "";
  if (document.getElementById('seoTransactionalKeywords')) document.getElementById('seoTransactionalKeywords').value = p.seoTransactionalKeywords || "";
  if (document.getElementById('seoCommercialKeywords')) document.getElementById('seoCommercialKeywords').value = p.seoCommercialKeywords || "";
  if (document.getElementById('seoKeywords')) document.getElementById('seoKeywords').value = p.seoKeywords || "";
  if (document.getElementById('seoSearchIntent')) document.getElementById('seoSearchIntent').value = p.seoSearchIntent || "";
  if (document.getElementById('seoCanonical')) document.getElementById('seoCanonical').value = p.seoCanonical || "";
  if (document.getElementById('seoRobots')) document.getElementById('seoRobots').value = p.seoRobots || "index, follow";
  if (document.getElementById('seoImgAlt')) document.getElementById('seoImgAlt').value = p.seoImgAlt || "";
  if (document.getElementById('seoOgTags')) document.getElementById('seoOgTags').value = p.seoOgTags || "";
  if (document.getElementById('seoTwitterTags')) document.getElementById('seoTwitterTags').value = p.seoTwitterTags || "";
  if (document.getElementById('seoProductSchema')) document.getElementById('seoProductSchema').value = p.seoProductSchema || "";
  if (document.getElementById('seoBreadcrumbSchema')) document.getElementById('seoBreadcrumbSchema').value = p.seoBreadcrumbSchema || "";
  if (document.getElementById('seoWebPageSchema')) document.getElementById('seoWebPageSchema').value = p.seoWebPageSchema || "";
  if (document.getElementById('seoOrganizationSchema')) document.getElementById('seoOrganizationSchema').value = p.seoOrganizationSchema || "";
  if (document.getElementById('seoFaq')) document.getElementById('seoFaq').value = p.seoFaq || "";

  document.getElementById('submitBtn').innerText = "Update Product";
  if (adminModal) adminModal.querySelector('.admin-main').scrollTop = 0;
};

window.generateSeoFromDescription = () => {
  const name = document.getElementById('prodName').value || 'Product';
  const category = document.getElementById('prodCategory').value || 'Category';
  const price = document.getElementById('prodPrice').value || '0';
  const descRaw = document.getElementById('prodDesc').value || '';
  const care = document.getElementById('prodCare').value || '';
  const imgUrl = document.getElementById('prodImg').value || '';
  const stock = document.getElementById('prodStock').value || 'In Stock';
  const slug = generateSlug(name) || 'product';
  const url = `https://rokeabyrk.com/product/${slug}`;

  if (!descRaw) {
    alert("Please enter a product description first.");
    return;
  }

  // --- Advanced Local Rule-Based Generation ---
  const cleanDesc = descRaw.split('\n')[0].replace(/^[✦•\-\*]\s*/, '').trim() || name;
  const shortDesc = cleanDesc.slice(0, 150) + (cleanDesc.length > 150 ? '...' : '');
  const lowerName = name.toLowerCase();
  const lowerCat = category.toLowerCase();

  // Keyword Generation
  const words = lowerName.split(' ').filter(w => w.length > 3);
  const primaryKws = words.join(', ');

  const focusKeyword = lowerName;
  const secondaryKeywords = `${lowerName} online, authentic ${lowerCat}, ${lowerCat} india`;
  const longTailKeywords = `buy ${lowerName} online best price, authentic ${lowerName} ${lowerCat}, ${lowerName} rokea by rk`;
  const transactionalKeywords = `buy ${lowerName}, order ${lowerCat} online, best price ${lowerName}, shop ${lowerCat}`;
  const commercialKeywords = `${lowerName} reviews, top ${lowerCat} brands, premium ${lowerCat}`;
  const seoKeywords = `${focusKeyword}, ${secondaryKeywords}, luxury ${lowerCat}`;

  // Schemas
  const faqArray = [
    {
      "question": `What is the price of ${name}?`,
      "answer": `The current best price for ${name} is ₹${price} at ROKEA by RK.`
    },
    {
      "question": `Is ${name} available in stock?`,
      "answer": `Yes, ${name} is currently ${stock}. You can order it directly online.`
    },
    {
      "question": `How should I care for my ${category}?`,
      "answer": care || `We recommend professional dry cleaning for premium ${lowerCat} to maintain their quality and longevity.`
    }
  ];

  const productSchema = {
    "@context": "https://schema.org/",
    "@type": "Product",
    "name": name,
    "description": shortDesc,
    "brand": { "@type": "Brand", "name": "ROKEA by RK" },
    "image": imgUrl,
    "offers": {
      "@type": "Offer",
      "priceCurrency": "INR",
      "price": price,
      "availability": stock.toLowerCase().includes('out') ? "https://schema.org/OutOfStock" : "https://schema.org/InStock",
      "url": url
    }
  };

  const breadcrumbSchema = {
    "@context": "https://schema.org/",
    "@type": "BreadcrumbList",
    "itemListElement": [
      { "@type": "ListItem", "position": 1, "name": "Home", "item": "https://rokeabyrk.com/" },
      { "@type": "ListItem", "position": 2, "name": category, "item": `https://rokeabyrk.com/category/${category.toLowerCase()}` },
      { "@type": "ListItem", "position": 3, "name": name, "item": url }
    ]
  };

  const webPageSchema = {
    "@context": "https://schema.org",
    "@type": "WebPage",
    "name": `${name} | ROKEA by RK`,
    "description": shortDesc,
    "url": url,
    "publisher": { "@type": "Organization", "name": "ROKEA by RK" }
  };

  const orgSchema = {
    "@context": "https://schema.org",
    "@type": "Organization",
    "name": "ROKEA by RK",
    "url": "https://rokeabyrk.com/",
    "logo": "https://rokeabyrk.com/images/logo.png"
  };

  // Populate Form Fields
  if (document.getElementById('seoTitle')) document.getElementById('seoTitle').value = `${name} | ROKEA by RK`;
  if (document.getElementById('seoKeyword')) document.getElementById('seoKeyword').value = focusKeyword;
  if (document.getElementById('seoDesc')) document.getElementById('seoDesc').value = `Buy ${name} online. ${shortDesc} Shop authentic luxury at ROKEA by RK.`;
  if (document.getElementById('seoSecondaryKeywords')) document.getElementById('seoSecondaryKeywords').value = secondaryKeywords;
  if (document.getElementById('seoLongTailKeywords')) document.getElementById('seoLongTailKeywords').value = longTailKeywords;
  if (document.getElementById('seoTransactionalKeywords')) document.getElementById('seoTransactionalKeywords').value = transactionalKeywords;
  if (document.getElementById('seoCommercialKeywords')) document.getElementById('seoCommercialKeywords').value = commercialKeywords;
  if (document.getElementById('seoKeywords')) document.getElementById('seoKeywords').value = seoKeywords;
  if (document.getElementById('seoSearchIntent')) document.getElementById('seoSearchIntent').value = "Transactional, Commercial Investigation";
  if (document.getElementById('seoCanonical')) document.getElementById('seoCanonical').value = url;
  if (document.getElementById('seoRobots')) document.getElementById('seoRobots').value = "index, follow, max-image-preview:large";
  if (document.getElementById('seoImgAlt')) document.getElementById('seoImgAlt').value = `Premium ${name} - ROKEA by RK`;

  if (document.getElementById('seoOgTags')) document.getElementById('seoOgTags').value =
    `<meta property="og:title" content="${name} | ROKEA by RK">
<meta property="og:description" content="${shortDesc}">
<meta property="og:image" content="${imgUrl}">
<meta property="og:url" content="${url}">
<meta property="og:type" content="product">`;

  if (document.getElementById('seoTwitterTags')) document.getElementById('seoTwitterTags').value =
    `<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${name} | ROKEA by RK">
<meta name="twitter:description" content="${shortDesc}">
<meta name="twitter:image" content="${imgUrl}">`;

  if (document.getElementById('seoProductSchema')) document.getElementById('seoProductSchema').value = JSON.stringify(productSchema, null, 2);
  if (document.getElementById('seoBreadcrumbSchema')) document.getElementById('seoBreadcrumbSchema').value = JSON.stringify(breadcrumbSchema, null, 2);
  if (document.getElementById('seoWebPageSchema')) document.getElementById('seoWebPageSchema').value = JSON.stringify(webPageSchema, null, 2);
  if (document.getElementById('seoOrganizationSchema')) document.getElementById('seoOrganizationSchema').value = JSON.stringify(orgSchema, null, 2);
  if (document.getElementById('seoFaq')) document.getElementById('seoFaq').value = JSON.stringify(faqArray, null, 2);

  alert('Advanced SEO Generated Locally! Please review before saving.');
};

window.bulkGenerateAllSeo = async () => {
  if (!confirm("This will loop through ALL products and generate advanced SEO locally. Are you sure?")) return;

  const btn = document.getElementById('bulkGenerateSeoBtn');
  const originalText = btn.innerText;
  btn.disabled = true;

  let generatedCount = 0;

  for (let i = 0; i < products.length; i++) {
    const p = products[i];
    btn.innerText = `Processing ${i + 1} / ${products.length} (${p.name})`;

    const name = p.name || 'Product';
    const category = p.category || 'Category';
    const price = p.price || '0';
    const descRaw = p.description || '';
    const care = p.productCare || '';
    const imgUrl = p.image || '';
    const stock = p.stock || 'In Stock';
    const slug = generateSlug(name) || 'product';
    const url = `https://rokeabyrk.com/product/${slug}`;

    const cleanDesc = descRaw.split('\n')[0].replace(/^[✦•\-\*]\s*/, '').trim() || name;
    const shortDesc = cleanDesc.slice(0, 150) + (cleanDesc.length > 150 ? '...' : '');
    const lowerName = name.toLowerCase();
    const lowerCat = category.toLowerCase();

    p.seoTitle = `${name} | ROKEA by RK`;
    p.seoKeyword = lowerName;
    p.seoDesc = `Buy ${name} online. ${shortDesc} Shop authentic luxury at ROKEA by RK.`;
    p.seoSecondaryKeywords = `${lowerName} online, authentic ${lowerCat}, ${lowerCat} india`;
    p.seoLongTailKeywords = `buy ${lowerName} online best price, authentic ${lowerName} ${lowerCat}, ${lowerName} rokea by rk`;
    p.seoTransactionalKeywords = `buy ${lowerName}, order ${lowerCat} online, best price ${lowerName}, shop ${lowerCat}`;
    p.seoCommercialKeywords = `${lowerName} reviews, top ${lowerCat} brands, premium ${lowerCat}`;
    p.seoKeywords = `${p.seoKeyword}, ${p.seoSecondaryKeywords}, luxury ${lowerCat}`;
    p.seoSearchIntent = "Transactional, Commercial Investigation";
    p.seoCanonical = url;
    p.seoRobots = "index, follow, max-image-preview:large";
    p.seoImgAlt = `Premium ${name} - ROKEA by RK`;

    p.seoOgTags = `<meta property="og:title" content="${name} | ROKEA by RK">\n<meta property="og:description" content="${shortDesc}">\n<meta property="og:image" content="${imgUrl}">\n<meta property="og:url" content="${url}">\n<meta property="og:type" content="product">`;
    p.seoTwitterTags = `<meta name="twitter:card" content="summary_large_image">\n<meta name="twitter:title" content="${name} | ROKEA by RK">\n<meta name="twitter:description" content="${shortDesc}">\n<meta name="twitter:image" content="${imgUrl}">`;

    p.seoProductSchema = JSON.stringify({
      "@context": "https://schema.org/",
      "@type": "Product",
      "name": name,
      "description": shortDesc,
      "brand": { "@type": "Brand", "name": "ROKEA by RK" },
      "image": imgUrl,
      "offers": { "@type": "Offer", "priceCurrency": "INR", "price": price, "availability": stock.toLowerCase().includes('out') ? "https://schema.org/OutOfStock" : "https://schema.org/InStock", "url": url }
    });

    p.seoBreadcrumbSchema = JSON.stringify({
      "@context": "https://schema.org/",
      "@type": "BreadcrumbList",
      "itemListElement": [
        { "@type": "ListItem", "position": 1, "name": "Home", "item": "https://rokeabyrk.com/" },
        { "@type": "ListItem", "position": 2, "name": category, "item": `https://rokeabyrk.com/category/${category.toLowerCase()}` },
        { "@type": "ListItem", "position": 3, "name": name, "item": url }
      ]
    });

    p.seoWebPageSchema = JSON.stringify({
      "@context": "https://schema.org",
      "@type": "WebPage",
      "name": p.seoTitle,
      "description": shortDesc,
      "url": url,
      "publisher": { "@type": "Organization", "name": "ROKEA by RK" }
    });

    p.seoOrganizationSchema = JSON.stringify({
      "@context": "https://schema.org",
      "@type": "Organization",
      "name": "ROKEA by RK",
      "url": "https://rokeabyrk.com/",
      "logo": "https://rokeabyrk.com/images/logo.png"
    });

    p.seoFaq = JSON.stringify([
      { "question": `What is the price of ${name}?`, "answer": `The current best price for ${name} is ₹${price} at ROKEA by RK.` },
      { "question": `Is ${name} available in stock?`, "answer": `Yes, ${name} is currently ${stock}. You can order it directly online.` },
      { "question": `How should I care for my ${category}?`, "answer": care || `We recommend professional dry cleaning for premium ${lowerCat} to maintain their quality and longevity.` }
    ]);

    if (db) {
      try {
        await db.collection("products").doc(p.id.toString()).set(p);
        generatedCount++;
      } catch (e) {
        console.error("Bulk save failed for " + name, e);
      }
    }
  }

  saveProducts();
  btn.innerText = originalText;
  btn.disabled = false;
  alert(`Bulk SEO Generation Completed! Successfully generated and saved SEO for ${generatedCount} products.`);
};



window.deleteProduct = (idx) => {
  if (confirm('Delete this product permanently?')) {
    const p = products[idx];
    products.splice(idx, 1);
    saveProducts();
    if (db && p.id) {
      db.collection("products").doc(p.id.toString()).delete()
        .then(() => console.log("Product deleted from cloud"))
        .catch(err => console.error("Cloud delete error:", err));
    }
  }
};

window.editProductById = (id) => {
  const idx = products.findIndex(p => p.id == id);
  if (idx > -1) window.editProduct(idx);
};

window.deleteProductById = (id) => {
  const idx = products.findIndex(p => p.id == id);
  if (idx > -1) window.deleteProduct(idx);
};

window.deleteAllProducts = () => {
  if (confirm("Are you sure you want to delete ALL products? This action cannot be undone.")) {
    if (confirm("This will permanently delete all products from your database. Proceed?")) {
      const allIds = products.map(p => p.id);
      products = [];
      saveProducts();

      if (db) {
        allIds.forEach(id => {
          db.collection("products").doc(id.toString()).delete()
            .catch(err => console.error("Cloud delete error:", err));
        });
        console.log("All products deleted from cloud");
      }
      alert("All products have been successfully deleted.");
    }
  }
};

// Full Story Logic
const storyModal = document.getElementById('storyModal');
window.openFullStory = () => { if (storyModal) storyModal.style.display = 'flex'; }
window.closeFullStory = () => { if (storyModal) storyModal.style.display = 'none'; }

// Close modals on background click
window.onclick = (e) => {
  if (e.target === adminModal) return;
  if (e.target === authModal) closeAuth();
  if (e.target === document.getElementById('appointmentModal')) closeAppointmentModal();
  if (e.target === storyModal) closeFullStory();
  if (e.target === document.getElementById('leadModal')) closeLeadModal();
  if (e.target === document.getElementById('productDetailModal')) closeProductDetail();
  if (e.target === document.getElementById('shareModal')) closeShareModal();
}

// PRODUCT DETAIL LOGIC
let currentDetailImages = [];
let currentDetailIndex = 0;
let touchstartX = 0;
let touchendX = 0;

window.openProductDetail = (productId) => {
  // Navigate to dedicated product page
  const p = products.find(prod => prod.id == productId || prod.slug === productId);
  if (p) {
    window.location.href = getProductLink(p);
  } else {
    window.location.href = `product-details.html?id=${productId}`;
  }
}

function renderRelatedProducts(category, currentId) {
  const slider = document.getElementById('relatedSlider');
  if (!slider) return;
  // Fallback to all products if less than 5 related
  let related = products.filter(p => p.category === category && p.id != currentId);
  if (related.length < 5) related = products.filter(p => p.id != currentId);
  slider.innerHTML = related.map((p, idx) => `
    <div class="slider-item product-card" onclick="openProductDetail(${p.id})" style="flex: 0 0 calc(20% - 12px); min-width: 190px; overflow: visible;">
      <div style="position: relative; width: 100%; aspect-ratio: 4/5; background: #fafafa;">
         <img src="${optimizeImageUrl(p.imageHover || p.imgHover || p.image || p.img)}" width="300" height="400" style="width: 100%; height: 100%; object-fit: cover;" loading="lazy" decoding="async" ${getSEOAttributes(p)} onerror="this.onerror=null; this.src='data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'; this.style.background='linear-gradient(135deg,#f0e6d3,#faf6ef)';">
         <div style="position: absolute; top: 12px; left: 12px; border: 1px solid rgba(0,0,0,0.3); color: #222; padding: 4px 14px; font-size: 10px; border-radius: 20px; background: rgba(255,255,255,0.85); display: ${idx % 3 === 0 ? 'none' : 'block'}">Best Seller</div>
         <div class="product-share" style="top: 12px; right: 12px; width: 32px; height: 32px; background: #fff; box-shadow: 0 2px 8px rgba(0,0,0,0.12);" onclick="event.stopPropagation(); shareProduct(${p.id})">
           <svg viewBox="0 0 24 24" fill="none" stroke="#555" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width: 14px; height: 14px;"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>
         </div>
      </div>
      <div style="padding: 16px 15px; display: flex; flex-direction: column; flex-grow: 1;">
         <div style="font-size: 13px; color: var(--gold-dark); font-weight: 700; margin-bottom: 8px;">₹${(extractPriceFromDesc(p.description) || p.price || 0).toLocaleString('en-IN')}</div>
         <div style="font-family: 'Poppins', sans-serif; font-size: 11px; color: #444; text-transform: uppercase; margin-bottom: 12px; font-weight: 500; letter-spacing: 0px; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; text-overflow: ellipsis; line-height: 1.5; height: 33px;">${p.name}</div>
      </div>
    </div>`).join('');
}

window.scrollSlider = (dir) => {
  const slider = document.getElementById('relatedSlider');
  slider.scrollBy({ left: 300 * dir, behavior: 'smooth' });
}

window.closeProductDetail = () => {
  const modal = document.getElementById('productDetailModal');
  if (modal) modal.style.display = 'none';
  document.body.classList.remove('modal-open');
  modalHistory = [];
}

window.modalGoBack = () => {
  if (modalHistory.length > 0) {
    const lastId = modalHistory.pop();
    openProductDetail(lastId, true);
  }
}

window.switchDetailImage = (index) => {
  if (index < 0 || index >= currentDetailImages.length) return;
  currentDetailIndex = index;
  const src = currentDetailImages[index];
  document.getElementById('detailMainImg').src = src;

  const tItems = document.querySelectorAll('.thumb-item');
  tItems.forEach(t => { t.classList.remove('active'); t.style.borderColor = 'transparent'; });

  if (tItems[index]) {
    tItems[index].classList.add('active');
    tItems[index].style.borderColor = '#000';
  }
}

window.switchDetailTab = (tab) => {
  const descBtn = document.getElementById('tabDescBtn');
  const careBtn = document.getElementById('tabCareBtn');
  const descContent = document.getElementById('detailDesc');
  const careContent = document.getElementById('detailCare');

  if (!descBtn || !careBtn || !descContent || !careContent) return;

  if (tab === 'desc') {
    descBtn.classList.add('active');
    descBtn.style.background = '#000';
    descBtn.style.color = '#fff';
    descBtn.style.borderColor = '#000';

    careBtn.classList.remove('active');
    careBtn.style.background = '#fff';
    careBtn.style.color = '#888';
    careBtn.style.borderColor = '#eee';

    descContent.style.display = 'block';
    careContent.style.display = 'none';
  } else {
    careBtn.classList.add('active');
    careBtn.style.background = '#000';
    careBtn.style.color = '#fff';
    careBtn.style.borderColor = '#000';

    descBtn.classList.remove('active');
    descBtn.style.background = '#fff';
    descBtn.style.color = '#888';
    descBtn.style.borderColor = '#eee';

    descContent.style.display = 'none';
    careContent.style.display = 'block';
  }
}

function handleMainImgSwipe() {
  if (touchendX < touchstartX - 40) { // Swipe Left -> Next
    if (currentDetailIndex < currentDetailImages.length - 1) {
      switchDetailImage(currentDetailIndex + 1);
    }
  }
  if (touchendX > touchstartX + 40) { // Swipe Right -> Prev
    if (currentDetailIndex > 0) {
      switchDetailImage(currentDetailIndex - 1);
    }
  }
}

// LEAD POPUP & FIREWORKS LOGIC
window.openLeadModal = () => {
  const leadModal = document.getElementById('leadModal');
  if (leadModal) {
    leadModal.style.display = 'flex';
    document.body.classList.add('modal-open');
    if (typeof window.triggerPattasuFireworks === 'function') {
      window.triggerPattasuFireworks(4500);
    }
  }
};

setTimeout(() => {
  const leadModal = document.getElementById('leadModal');
  if (leadModal && !sessionStorage.getItem('leadShown')) {
    window.openLeadModal();
    sessionStorage.setItem('leadShown', 'true');
  }
}, 7000);

window.closeLeadModal = () => {
  const modal = document.getElementById('leadModal');
  if (modal) {
    modal.style.display = 'none';
    document.body.classList.remove('modal-open');
  }
}

window.handleLead = (e) => {
  e.preventDefault();
  const name = document.getElementById('leadName').value;
  const phone = document.getElementById('leadPhone').value;
  const interest = document.getElementById('leadInterest').value;

  const leadData = { name, phone, interest, date: new Date().toISOString() };

  // Save to localStorage
  const leads = JSON.parse(localStorage.getItem('saforio_leads')) || [];
  leads.push({ name, phone, interest, date: new Date().toLocaleDateString() });
  localStorage.setItem('saforio_leads', JSON.stringify(leads));

  // Save to Firestore
  if (db) {
    db.collection("leads").add(leadData)
      .then(() => console.log("Lead saved to Firestore!"))
      .catch(err => console.error("Firestore lead error:", err));
  }

  // Trigger celebration fireworks (pattasu)
  if (typeof window.triggerPattasuFireworks === 'function') {
    window.triggerPattasuFireworks(5000);
  }

  alert("Thank you, " + name + "! Our master stylist will contact you shortly.");
  closeLeadModal();
}

// NEWSLETTER SUBSCRIPTION HANDLER
window.handleNewsletterSubscribe = (e) => {
  if (e) {
    if (typeof e.preventDefault === 'function') e.preventDefault();
    if (typeof e.stopPropagation === 'function') e.stopPropagation();
  }
  const input = document.getElementById('newsletterEmail') || document.querySelector('.nl-input');
  if (!input) return false;

  const email = (input.value || '').trim();
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  if (!email || !emailRegex.test(email)) {
    alert("Please enter a valid email address (e.g., yourname@gmail.com).");
    input.focus();
    return false;
  }

  const btn = document.getElementById('newsletterBtn') || document.querySelector('.nl-btn');
  const originalText = btn ? btn.innerHTML : 'Subscribe';
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = 'Subscribing...';
  }

  const subData = {
    email: email,
    subscribedAt: new Date().toISOString(),
    source: 'Exclusive Offers Newsletter'
  };

  // 1. Save to localStorage
  try {
    const subs = JSON.parse(localStorage.getItem('saforio_newsletter_subscribers')) || [];
    if (!subs.some(s => s.email === email)) {
      subs.push(subData);
      localStorage.setItem('saforio_newsletter_subscribers', JSON.stringify(subs));
    }
  } catch (err) {
    console.error("Local newsletter save error:", err);
  }

  // 2. Save to Firestore (both newsletter and leads collections)
  const activeDb = window.db || (typeof db !== 'undefined' ? db : null);
  if (activeDb) {
    try {
      activeDb.collection("newsletter").add(subData).catch(e => console.warn("Firestore newsletter write error:", e));
      activeDb.collection("leads").add({
        name: email.split('@')[0],
        email: email,
        phone: 'Newsletter',
        interest: 'Exclusive Offers Newsletter',
        date: new Date().toISOString()
      }).catch(e => console.warn("Firestore lead write error:", e));
    } catch (err) {
      console.error("Firestore write error:", err);
    }
  }

  // 3. Trigger celebration fireworks if available
  if (typeof window.triggerPattasuFireworks === 'function') {
    window.triggerPattasuFireworks(4000);
  }

  // 4. Update UI & Feedback immediately
  if (btn) {
    btn.innerHTML = 'Subscribed! ✓';
    btn.style.background = '#2e7d32';
    btn.style.color = '#ffffff';
  }

  const successEl = document.getElementById('newsletterSuccess');
  if (successEl) {
    successEl.style.display = 'block';
    successEl.innerHTML = `✦ Thank you for subscribing, <strong>${email}</strong>! Exclusive festive offers & bridal lookbooks will be sent to your inbox.`;
  }

  alert("Thank you for subscribing to ROKEA Exclusive Offers! We have registered " + email + " successfully.");

  input.value = '';

  setTimeout(() => {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = originalText;
      btn.style.background = '';
      btn.style.color = '';
    }
  }, 4000);

  return false;
};

document.addEventListener('DOMContentLoaded', () => {
  const nlForm = document.getElementById('newsletterForm');
  if (nlForm) {
    nlForm.addEventListener('submit', window.handleNewsletterSubscribe);
  }
  const nlBtn = document.getElementById('newsletterBtn') || document.querySelector('.nl-btn');
  if (nlBtn && (!nlForm || nlBtn.form !== nlForm)) {
    nlBtn.addEventListener('click', (e) => {
      window.handleNewsletterSubscribe(e);
    });
  }
});

const styleSheet = document.createElement('style');
styleSheet.textContent = `
  @keyframes fadeInUp {
    from { opacity: 0; transform: translateY(20px); }
    to { opacity: 1; transform: translateY(0); }
  }

  .preview-close:hover {
    transform: scale(1.1);
    background: #c2185b !important;
  }

  .stylist-recommendation-card {
    position: relative;
    transition: all 0.5s cubic-bezier(0.165, 0.84, 0.44, 1);
    cursor: pointer;
    background: transparent !important;
    text-align: center !important;
    z-index: 1;
  }

  .stylist-recommendation-card:hover {
    transform: translateY(-10px) scale(1.05);
  }

  /* Elegant Glow for Circular Cards */
  .stylist-recommendation-card::before {
    content: "";
    position: absolute;
    inset: -10px;
    z-index: -1;
    background: radial-gradient(circle at center, rgba(201, 168, 76, 0.3) 0%, transparent 70%);
    border-radius: 50%;
    opacity: 0;
    transition: opacity 0.5s ease;
    filter: blur(10px);
  }

  .stylist-recommendation-card:hover::before {
    opacity: 1;
  }

  .stylist-recommendation-card .product-img {
    width: 150px !important;
    height: 150px !important;
    border-radius: 50% !important;
    margin: 0 auto 15px auto !important;
    border: 3px solid var(--gold);
    box-shadow: 0 10px 25px rgba(201,168,76,0.2);
    overflow: hidden;
    background: #fff;
    position: relative;
    z-index: 2;
    transition: all 0.5s ease;
  }

  .stylist-recommendation-card:hover .product-img {
    border-color: var(--gold-light);
    box-shadow: 0 15px 35px rgba(201, 168, 76, 0.4);
    transform: rotate(3deg);
  }

  .results-grid {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 40px;
    margin-top: 40px;
  }

  .admin-tab-btn {
    background: transparent;
    border: 1px solid rgba(255,255,255,0.2);
    color: #fff;
    padding: 8px 16px;
    border-radius: 4px;
    font-size: 12px;
    cursor: pointer;
    transition: all 0.3s ease;
  }

  .admin-tab-btn:hover {
    background: rgba(255,255,255,0.1);
    border-color: var(--gold);
  }

  .admin-tab-btn.active {
    background: var(--gold);
    border-color: var(--gold);
    color: #000;
    font-weight: 600;
  }

  .sortable-ghost {
    opacity: 0.4;
    background: var(--gold-light) !important;
  }

  .admin-item {
    transition: transform 0.1s ease;
  }

  /* Flipkart Style Share Button */
  .product-share {
    position: absolute;
    top: 55px;
    right: 15px;
    width: 32px;
    height: 32px;
    background: #ffffff;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    box-shadow: 0 2px 10px rgba(0,0,0,0.15);
    transition: all 0.2s cubic-bezier(0.175, 0.885, 0.32, 1.275);
    z-index: 5;
    opacity: 1;
    border: none !important;
  }

  .product-share:hover {
    background: #f0f0f0;
    transform: scale(1.1);
    box-shadow: 0 4px 15px rgba(0,0,0,0.2);
  }

  .product-share-floating {
    position: absolute;
    top: 20px;
    right: 20px;
    width: 40px;
    height: 40px;
    background: #fff;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    box-shadow: 0 2px 10px rgba(0,0,0,0.2);
    z-index: 10;
    transition: all 0.3s ease;
  }

  .product-share-floating:hover {
    transform: scale(1.1);
    background: #f8f8f8;
  }

  .product-share:hover svg {
    stroke: #fff;
  }

  /* Share Modal Styles */
  .share-options {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 15px;
    margin-top: 25px;
  }

  .share-opt {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    cursor: pointer;
    transition: transform 0.3s;
  }

  .share-opt:hover {
    transform: translateY(-5px);
  }

  .share-icon-circle {
    width: 50px;
    height: 50px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    color: #fff;
    font-size: 20px;
  }

  .share-text {
    font-size: 10px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 1px;
    color: var(--muted);
  }
`;
document.head.appendChild(styleSheet);

updateUserUI();
updateWishlistIcon();
updateCartIcon();
renderAll();

// SHARE FUNCTIONALITY
let currentShareProduct = null;

window.shareProduct = (productId) => {
  const p = products.find(prod => prod.id == productId);
  if (!p) return;

  currentShareProduct = p;

  // Use Native Share if available (on mobile)
  if (navigator.share) {
    navigator.share({
      title: p.name,
      text: `Check out this beautiful ${p.name} at ROKEA!`,
      url: getAbsoluteProductLink(p)
    }).then(() => console.log('Successful share'))
      .catch((error) => console.log('Error sharing', error));
  } else {
    // Show custom share modal
    const modal = document.getElementById('shareModal');
    const nameEl = document.getElementById('shareProductName');
    if (modal) {
      if (nameEl) nameEl.innerText = p.name;
      modal.style.display = 'flex';
      document.body.classList.add('modal-open');
    }
  }
}

window.closeShareModal = () => {
  const modal = document.getElementById('shareModal');
  if (modal) modal.style.display = 'none';
  document.body.classList.remove('modal-open');
  document.getElementById('copySuccess').style.display = 'none';
}

window.shareTo = (platform) => {
  if (!currentShareProduct) return;

  const url = getAbsoluteProductLink(currentShareProduct);
  const text = `Check out this beautiful ${currentShareProduct.name} at ROKEA!`;

  let shareUrl = '';

  switch (platform) {
    case 'whatsapp':
      shareUrl = `https://wa.me/?text=${encodeURIComponent(text + ' ' + url)}`;
      break;
    case 'facebook':
      shareUrl = `https://www.facebook.com/profile.php?id=61587639092396`;
      break;
    case 'twitter':
      shareUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`;
      break;
    case 'copy':
      navigator.clipboard.writeText(url).then(() => {
        document.getElementById('copySuccess').style.display = 'block';
        setTimeout(() => {
          document.getElementById('copySuccess').style.display = 'none';
        }, 3000);
      });
      return;
  }

  if (shareUrl) window.open(shareUrl, '_blank');
}

// AI Stylist Logic
let stylistCache = new Map();

const fallbackStylistProducts = [
  {
    id: '1776414006390',
    name: 'Vintage Style Blue and Pink Silk Saree',
    category: 'sarees',
    price: 1500,
    image: 'https://i.postimg.cc/sXxwCWBs/DSC01979.jpg',
    stylistRole: 'Exquisite Handloom Saree',
    slug: 'vintage-style-blue-and-pink-silk-saree',
    description: 'Pure handloom silk saree with rich gold zari border, curated for royal festive celebrations.'
  },
  {
    id: '1776423130876',
    name: 'Lakshmi Antique Temple Haaram & Choker Set',
    category: 'imitation',
    price: 4999,
    image: 'https://i.postimg.cc/zBN8dJ3R/DSC01846.jpg',
    stylistRole: 'Heritage Jewellery Set',
    slug: 'lakshmi-antique-temple-haaram-choker-set',
    description: 'Traditional handcrafted temple jewellery set adorned with auspicious Goddess Lakshmi motifs.'
  },
  {
    id: '1776423529914',
    name: 'Ruby Raga Royal Necklace Set',
    category: 'imitation',
    price: 1200,
    image: 'https://i.postimg.cc/qRr4mkgj/DSC01914.jpg',
    stylistRole: 'Matching Royal Jewellery',
    slug: 'ruby-raga-royal-necklace-set',
    description: 'Festive handcrafted Ruby drop necklace and earrings that perfectly complete your ensemble.'
  }
];

function curateLuxuryLook() {
  const look = [];
  const allProds = (typeof products !== 'undefined' && Array.isArray(products) && products.length > 0)
    ? [...products]
    : [];

  // 1. Get Saree (category == 'sarees' or name matching saree/silk)
  const sareesList = allProds.filter(p =>
    (p.category && p.category.toLowerCase() === 'sarees') ||
    (p.name && /saree|silk|zari/i.test(p.name))
  );
  if (sareesList.length > 0) {
    const selectedSaree = sareesList[Math.floor(Math.random() * sareesList.length)];
    look.push({ ...selectedSaree, stylistRole: 'Exquisite Handloom Saree' });
  } else {
    look.push(fallbackStylistProducts[0]);
  }

  // 2. Get Jewellery Set
  const jewelryKeywords = ['earring', 'jhumka', 'stud', 'bangle', 'valayal', 'kangan', 'kada'];
  const jewelList = allProds.filter(p =>
    (p.category && p.category.toLowerCase() === 'imitation') &&
    !jewelryKeywords.some(kw => (p.name || '').toLowerCase().includes(kw))
  );
  if (jewelList.length > 0) {
    const selectedJewel = jewelList[Math.floor(Math.random() * jewelList.length)];
    look.push({ ...selectedJewel, stylistRole: 'Heritage Jewellery Set' });
  } else {
    look.push(fallbackStylistProducts[1]);
  }

  // 3. Get Earring or Bangle or Secondary Jewel
  const earringBangleList = allProds.filter(p =>
    (p.category && p.category.toLowerCase() === 'imitation') &&
    jewelryKeywords.some(kw => (p.name || '').toLowerCase().includes(kw))
  );
  if (earringBangleList.length > 0) {
    const selectedEarringBangle = earringBangleList[Math.floor(Math.random() * earringBangleList.length)];
    look.push({ ...selectedEarringBangle, stylistRole: 'Matching Royal Jewellery' });
  } else {
    look.push(fallbackStylistProducts[2]);
  }

  // Guarantee 3 distinct items
  while (look.length < 3) {
    const fb = fallbackStylistProducts.find(f => !look.some(item => item.id === f.id));
    if (fb) look.push(fb);
    else break;
  }

  return look;
}

window.triggerStylistUpload = () => {
  const inp = document.getElementById('userImageInput');
  if (inp) {
    inp.value = '';
    inp.click();
  }
};

window.trySampleLook = () => {
  const samplePhoto = 'ai_stylist_teaser.png';
  window.handleUserImage(samplePhoto);
};

window.resetStylist = () => {
  const zone = document.getElementById('uploadZone');
  const previewCont = document.getElementById('userPreviewCont');
  const results = document.getElementById('aiResults');
  const loader = document.getElementById('aiAnalysis');
  const input = document.getElementById('userImageInput');
  if (zone) zone.style.display = 'block';
  if (previewCont) previewCont.style.display = 'none';
  if (results) results.style.display = 'none';
  if (loader) loader.style.display = 'none';
  if (input) input.value = '';
};

window.handleUserImage = async (eventOrUrl) => {
  let file = null;
  let directUrl = null;

  if (typeof eventOrUrl === 'string') {
    directUrl = eventOrUrl;
  } else if (eventOrUrl && eventOrUrl.target && eventOrUrl.target.files && eventOrUrl.target.files[0]) {
    file = eventOrUrl.target.files[0];
  } else if (eventOrUrl && eventOrUrl.dataTransfer && eventOrUrl.dataTransfer.files && eventOrUrl.dataTransfer.files[0]) {
    file = eventOrUrl.dataTransfer.files[0];
  } else if (eventOrUrl instanceof File) {
    file = eventOrUrl;
  }

  if (!file && !directUrl) return;

  const processLook = (previewSrc) => {
    const previewImg = document.getElementById('userPhotoPreview');
    const previewCont = document.getElementById('userPreviewCont');
    const zone = document.getElementById('uploadZone');
    const loader = document.getElementById('aiAnalysis');
    const results = document.getElementById('aiResults');

    if (previewImg) previewImg.src = previewSrc;
    if (zone) zone.style.display = 'none';
    if (previewCont) previewCont.style.display = 'block';

    if (loader) {
      loader.innerHTML = `
        <div class="ai-loader"></div>
        <p id="aiStatus" style="font-family:'Playfair Display', serif; font-size:18px; color:var(--gold); margin-bottom:8px; font-weight:600;">Analyzing Your Aesthetic Aura...</p>
        <p id="aiSubStatus" style="font-family:'Poppins', sans-serif; font-size:12px; color:#e0d0b8; margin:0 0 16px;">Scanning facial features, tone & lighting</p>
        <div id="aiProgressContainer" style="width: 85%; max-width: 320px; margin: 0 auto; background: rgba(255,255,255,0.12); height: 6px; border-radius: 4px; overflow: hidden; position: relative;">
          <div id="aiProgressBar" style="width: 25%; background: linear-gradient(90deg, #d4af37, #ffd700); height: 100%; transition: width 0.3s ease;"></div>
        </div>
      `;
      loader.style.display = 'block';
    }
    if (results) results.style.display = 'none';

    const statusEl = document.getElementById('aiStatus');
    const subStatusEl = document.getElementById('aiSubStatus');
    const barEl = document.getElementById('aiProgressBar');

    setTimeout(() => {
      if (barEl) barEl.style.width = '70%';
      if (statusEl) statusEl.innerText = 'Matching ROKEA Heritage Collection...';
      if (subStatusEl) subStatusEl.innerText = 'Curating handloom sarees, choker sets & earrings';
    }, 400);

    setTimeout(() => {
      if (barEl) barEl.style.width = '100%';
      if (statusEl) statusEl.innerText = 'Look Curated Successfully!';
      if (subStatusEl) subStatusEl.innerText = 'Generating your exclusive AI festive ensemble';

      setTimeout(() => {
        if (loader) loader.style.display = 'none';
        if (results) {
          results.style.display = 'block';
          results.style.opacity = '1';
          results.style.visibility = 'visible';
        }

        const curatedLook = curateLuxuryLook();
        renderRecommendations(curatedLook);

        if (results) {
          results.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      }, 300);
    }, 850);
  };

  if (directUrl) {
    processLook(directUrl);
  } else if (file) {
    const reader = new FileReader();
    reader.onload = (e) => {
      processLook(e.target.result);
    };
    reader.onerror = () => {
      alert("Could not read image file. Please try selecting another photo.");
    };
    reader.readAsDataURL(file);
  }
};

function renderRecommendations(selected) {
  const recContainer = document.getElementById('stylistRecommendations');
  if (!recContainer) return;

  const titleEl = document.querySelector('.results-title');
  if (titleEl) {
    titleEl.innerHTML = `
      <span style="display:block; font-family:'Great Vibes', cursive; font-size:26px; color:var(--gold); margin-bottom:4px;">Matched to Your Aura</span>
      AI Recommendations: Handpicked for You
    `;
  }

  recContainer.innerHTML = selected.map(p => {
    const rawPrice = (typeof p.price === 'string' ? parseInt(p.price.replace(/[^0-9]/g, '')) : p.price) || 1500;
    const priceVal = (extractPriceFromDesc(p.description) || rawPrice || 0);
    const mainImg = optimizeImageUrl(p.image || p.img || 'https://i.postimg.cc/sXxwCWBs/DSC01979.jpg');
    const productUrl = getProductLink ? getProductLink(p) : 'product-details.html?id=' + p.id;

    // Notice: Using stylist-recommendation-card WITHOUT product-card to completely disable hover image
    return `
    <div class="stylist-recommendation-card" onclick="window.location.href='${productUrl}'">
      <div style="background:linear-gradient(135deg, #ffd700 0%, #d4af37 50%, #aa7c11 100%); color:#1c0d02; font-size:10px; font-weight:800; text-transform:uppercase; letter-spacing:1.5px; padding:6px 14px; border-radius:50px; width:fit-content; margin:14px auto 8px auto; box-shadow:0 4px 12px rgba(212,175,55,0.35);">
        ✦ ${p.stylistRole || 'Heritage Piece'}
      </div>
      <div class="product-img">
        <img src="${mainImg}" class="img-main" loading="eager" alt="${p.name}" onerror="this.onerror=null; this.src='https://i.postimg.cc/sXxwCWBs/DSC01979.jpg';">
      </div>
      <div style="padding: 16px 14px 18px; text-align: center; display:flex; flex-direction:column; flex-grow:1;">
        <div style="color:var(--gold-dark); font-weight:700; font-size: 17px; margin-bottom: 4px;">₹${priceVal.toLocaleString('en-IN')}</div>
        <div style="font-size:9.5px; color:var(--gold); text-transform: uppercase; letter-spacing:1px; margin-bottom: 6px; font-weight:600;">${(p.category || 'Luxury').toUpperCase()}</div>
        <h3 class="product-name" style="font-family:'Playfair Display',serif; font-size:15px; color:var(--dark); margin:0 auto 14px; line-height:1.35; font-weight:600; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden;">${p.name}</h3>
        <button class="btn-primary" type="button" style="padding:10px 16px; font-size:12px; margin-top:auto; width:100%; border-radius:50px; font-weight:700; letter-spacing:1px; display:flex; align-items:center; justify-content:center; gap:8px;" onclick="event.stopPropagation(); addToCartFromStylist('${p.id}')">Add to Look <i class="fas fa-shopping-bag"></i></button>
      </div>
    </div>`;
  }).join('');
}

// Global helper to add to cart straight from AI results
window.addToCartFromStylist = (id) => {
  if (!currentUser) { openAuth(); return; }
  let p = products.find(prod => prod.id == id);
  if (!p) {
    p = fallbackStylistProducts.find(prod => prod.id == id);
  }
  if (!p) return;
  cart.push(p);
  localStorage.setItem('saforio_cart', JSON.stringify(cart));
  if (typeof updateCartIcon === 'function') updateCartIcon();
  alert(p.name + " has been added to your cart!");
};

// Setup Drag & Drop on Upload Zone
document.addEventListener('DOMContentLoaded', () => {
  const zone = document.getElementById('uploadZone');
  if (zone) {
    ['dragenter', 'dragover'].forEach(name => {
      zone.addEventListener(name, (e) => {
        e.preventDefault();
        e.stopPropagation();
        zone.style.borderColor = 'var(--gold)';
        zone.style.background = 'rgba(212, 175, 55, 0.08)';
      });
    });
    ['dragleave', 'drop'].forEach(name => {
      zone.addEventListener(name, (e) => {
        e.preventDefault();
        e.stopPropagation();
        zone.style.borderColor = '';
        zone.style.background = '';
      });
    });
    zone.addEventListener('drop', (e) => {
      if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        window.handleUserImage({ target: { files: e.dataTransfer.files } });
      }
    });
  }
});

// Handle Category from URL
if (urlCat) {
  currentCategory = urlCat;
  // Update Tab UI if on collections page
  document.querySelectorAll('.tab-item').forEach(tab => {
    tab.classList.toggle('active', tab.dataset.cat === currentCategory);
  });
}

// Handle Product ID from URL
// Wait for Firestore to load before initialising the product page
if (urlId) {
  sessionStorage.setItem('rokea_current_product_id', urlId);
  if (window.__INITIAL_PRODUCT_DATA__) {
    initProductPage(urlId);
  } else if (products.length > 0) {
    setTimeout(() => { initProductPage(urlId); }, 50);
  } else {
    setTimeout(() => { initProductPage(urlId); }, 100);
  }
} else {
  // No ?id= in URL — check sessionStorage (happens after refresh when URL is clean)
  const savedId = sessionStorage.getItem('rokea_current_product_id');
  if (savedId && document.getElementById('detailMainImg')) {
    if (products.length > 0) {
      setTimeout(() => { initProductPage(savedId); }, 100);
    } else {
      // Wait for Firestore — renderAll() will call initProductPage(savedId)
      window._pendingProductId = savedId;
    }
  }
}

function initProductPage(productId) {
  // If Server-Side Rendering provided the initial data, use it immediately!
  if (window.__INITIAL_PRODUCT_DATA__) {
    let fetched = window.__INITIAL_PRODUCT_DATA__;
    if (!products.find(x => x.id == fetched.id)) products.push(fetched);
    return _populateProductPage(fetched);
  }

  let p = products.find(prod => prod.id == productId || prod.slug === productId);

  // If not found locally, try fetching directly from Firestore
  if (!p) {
    if (db) {
      // First try to find by ID
      db.collection('products').doc(productId.toString()).get()
        .then(doc => {
          if (doc.exists) {
            let fetched = doc.data();
            fetched.id = fetched.id || doc.id;
            // Merge into local products array so subsequent calls work
            if (!products.find(x => x.id == fetched.id)) products.push(fetched);
            _populateProductPage(fetched);
          } else {
            // Try fetching by slug
            return db.collection('products').where('slug', '==', productId).get().then(snap => {
              if (!snap.empty) {
                let fetched = snap.docs[0].data();
                fetched.id = fetched.id || snap.docs[0].id;
                if (!products.find(x => x.id == fetched.id)) products.push(fetched);
                _populateProductPage(fetched);
              } else {
                console.warn('Product not found in Firestore:', productId);
              }
            });
          }
        })
        .catch(err => console.error('Firestore product fetch error:', err));
    }
    return;
  }

  _populateProductPage(p);
}

function _populateProductPage(p) {

  // Update URL to show slug instead of stripping it
  if (window.history && window.history.replaceState) {
    let newUrl = isLocalhost
      ? (p.slug ? `${window.location.pathname}?slug=${p.slug}` : `${window.location.pathname}?id=${p.id}`)
      : (p.slug ? `/product/${p.slug}` : `/product-details?id=${p.id}`);
    history.replaceState(null, document.title, newUrl);
  }

  // ── SEO: Update page title, meta tags, OG tags, schema ──────────────────
  const productPrice = extractPriceFromDesc(p.description) || p.price || 0;
  const productImg = p.image || p.img || '';
  const productDesc = (p.description || '').split('\n')[0].replace(/^[✦•\-\*]\s*/, '').trim()
    || 'Luxury handwoven saree from ROKEA by RK, Coimbatore.';

  // Page title
  document.title = `${p.name} | ${p.category || 'Luxury Saree'} — ROKEA by RK`;

  // Meta description
  let metaDesc = document.querySelector('meta[name="description"]');
  if (!metaDesc) { metaDesc = document.createElement('meta'); metaDesc.name = 'description'; document.head.appendChild(metaDesc); }
  metaDesc.content = `${productDesc.slice(0, 140)} | Buy ${p.name} at ROKEA by RK, Coimbatore.`;

  // OG tags
  const setMeta = (id, attr, val) => { const el = document.getElementById(id); if (el) el.setAttribute(attr, val); };
  setMeta('ogTitle', 'content', `${p.name} | ROKEA by RK`);
  setMeta('ogDesc', 'content', productDesc.slice(0, 200));
  setMeta('ogImage', 'content', productImg);
  // Canonical URL
  let canonicalUrl = document.getElementById('canonicalUrl');
  if (canonicalUrl) {
    const productUrl = p.slug
      ? `https://rokeabyrk.com/product/${p.slug}`
      : `https://rokeabyrk.com/product-details?id=${p.id}`;
    canonicalUrl.href = productUrl;
    setMeta('ogUrl', 'content', productUrl);
  } else {
    setMeta('ogUrl', 'content', window.location.href);
  }

  setMeta('twTitle', 'content', `${p.name} | ROKEA by RK`);
  setMeta('twDesc', 'content', productDesc.slice(0, 200));
  setMeta('twImage', 'content', productImg);

  // Product Schema & Breadcrumbs JSON-LD
  let schemaScript = document.getElementById('productSchema');

  // Remove ALL existing schema tags with Product to prevent duplicates
  // Populate Elements (similar to old openProductDetail logic but for static page)
  const mainImg = document.getElementById('detailMainImg');
  const name = document.getElementById('detailName');
  const price = document.getElementById('detailPrice');
  const desc = document.getElementById('descBody');
  const care = document.getElementById('careBody');
  const stock = document.getElementById('detailStockStatus');
  const btn = document.getElementById('detailAddToCartBtn');
  const buyBtn = document.getElementById('detailBuyNowBtn');
  const thumbs = document.getElementById('detailThumbnails');
  const qtyVal = document.getElementById('detailQtyVal');
  const qtyMinus = document.getElementById('detailQtyMinus');
  const qtyPlus = document.getElementById('detailQtyPlus');
  const breadCat = document.getElementById('breadcrumb-cat');
  const breadName = document.getElementById('breadcrumb-name');
  const shopBannerText = document.getElementById('shopBannerText');
  if (shopBannerText) {
      shopBannerText.innerHTML = `Shop this elegant <strong>${p.name || 'product'}</strong> from ROKEA BY RK in Coimbatore and discover timeless sarees curated for every special occasion.`;
  }

  if (!name) return; // Not on product page

  let currentQty = 1;
  if (qtyVal) qtyVal.innerText = currentQty;
  if (qtyMinus) qtyMinus.onclick = () => { if (currentQty > 1) { currentQty--; qtyVal.innerText = currentQty; } };
  if (qtyPlus) qtyPlus.onclick = () => { currentQty++; qtyVal.innerText = currentQty; };

  // Set the real image and hide skeleton when loaded
  if (mainImg) {
    const skeleton = document.getElementById('imgSkeleton');
    const imgSrc = p.image || p.img || '';

    // SEO: descriptive alt text with product name, category, brand
    const altText = p.name
      ? `${p.name} - ${p.category || 'Luxury Saree'} | ROKEA by RK`
      : 'Luxury Handwoven Saree | ROKEA by RK';
    mainImg.alt = altText;
    mainImg.setAttribute('fetchpriority', 'high'); // LCP image — load first
    mainImg.setAttribute('decoding', 'async');

    if (imgSrc) {
      mainImg.onload = () => {
        mainImg.classList.add('img-loaded');   // fade in
        if (skeleton) skeleton.classList.add('hide');  // hide shimmer
      };
      mainImg.src = imgSrc;
    } else {
      // No image URL — show branded gradient placeholder
      if (skeleton) skeleton.classList.add('hide');
      mainImg.classList.add('img-loaded');
      mainImg.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'; // transparent
      mainImg.style.background = 'linear-gradient(135deg, #f0e6d3, #faf6ef)';
    }
  }
  if (name) name.innerText = p.name;
  if (breadName) breadName.innerText = p.name;
  if (breadCat) {
    breadCat.innerText = p.category;
    breadCat.href = `/collections`;
    breadCat.onclick = () => { localStorage.setItem('rokea_selected_category', p.category); };
  }
  if (price) price.innerText = `₹${(extractPriceFromDesc(p.description) || p.price || 0).toLocaleString('en-IN')}`;

  if (desc) {
    const descText = p.description || "Exquisite premium collection from ROKEA by RK.";
    const descLines = descText.split('\n').filter(line => line.trim().length > 0).map(l => l.replace(/^[✦•\-\*]\s*/, '').trim());
    
    // Filter out "Why You'll Love It" and styling tips if present in description text
    const filteredLines = descLines.filter(line => {
      const lower = line.toLowerCase();
      return !lower.includes('why you') && 
             !lower.includes('pair with gold jewellery') && 
             !lower.includes('style as bridal wear');
    });
    
    let prodDesc = filteredLines.length > 0 ? filteredLines.join('<br><br>') : descText;
    
    let color = p.color || "As shown";
    let occasion = p.occasion || "Wedding, Festival & Traditional Wear";
    let type = p.category || "Soft Silk Saree";

    desc.innerHTML = `
      <div class="info-box">
          <div class="info-box-title">Product Description</div>
          <div class="info-box-text">${prodDesc}</div>
      </div>
      <div class="info-box">
          <div class="info-box-title">Product Details</div>
          <div class="details-grid">
              <div class="detail-item">
                  <div class="detail-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M20.24 12.24a6 6 0 0 0-8.49-8.49L5 10.5V19h8.5z"></path></svg></div>
                  <div class="detail-label">Type</div>
                  <div class="detail-value">: ${type}</div>
              </div>
              <div class="detail-item">
                  <div class="detail-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><circle cx="12" cy="12" r="10"></circle><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"></path></svg></div>
                  <div class="detail-label">Style</div>
                  <div class="detail-value">: Traditional Indian</div>
              </div>
              <div class="detail-item">
                  <div class="detail-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><circle cx="12" cy="12" r="10"></circle><path d="M12 8v4"></path></svg></div>
                  <div class="detail-label">Colour</div>
                  <div class="detail-value">: ${color}</div>
              </div>
              <div class="detail-item">
                  <div class="detail-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg></div>
                  <div class="detail-label">Ideal For</div>
                  <div class="detail-value">: Women</div>
              </div>
              <div class="detail-item">
                  <div class="detail-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg></div>
                  <div class="detail-label">Occasion</div>
                  <div class="detail-value">: ${occasion}</div>
              </div>
              <div class="detail-item">
                  <div class="detail-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M22 12h-4l-3 9L9 3l-3 9H2"></path></svg></div>
                  <div class="detail-label">Care</div>
                  <div class="detail-value">: Dry Wash Only</div>
              </div>
          </div>
      </div>
    `;
  }

  if (care) {
    const careText = p.productCare || "Handle with care to maintain the longevity of this premium piece.";
    const items = careText.split('\n').filter(line => line.trim().length > 0);

    let html = `<div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 15px; margin-top: 10px;">`;

    items.forEach(item => {
      const text = item.replace(/^[✦•\-\*]\s*/, '').trim();
      if (text === "CARE & SAFETY") return;

      let title = "Care Tip";
      let descText = text;

      if (text.includes(':')) {
        const parts = text.split(':');
        title = parts[0].trim();
        descText = parts.slice(1).join(':').trim();
      }

      let iconSvg = `<svg viewBox="0 0 24 24" fill="none" stroke="var(--gold)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="width:18px; height:18px;"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>`;
      if (title.toLowerCase().includes('clean')) iconSvg = `<svg viewBox="0 0 24 24" fill="none" stroke="var(--gold)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="width:18px; height:18px;"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path></svg>`;
      if (title.toLowerCase().includes('water') || title.toLowerCase().includes('moisture')) iconSvg = `<svg viewBox="0 0 24 24" fill="none" stroke="var(--gold)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="width:18px; height:18px;"><path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z"/></svg>`;
      if (title.toLowerCase().includes('stor')) iconSvg = `<svg viewBox="0 0 24 24" fill="none" stroke="var(--gold)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="width:18px; height:18px;"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><line x1="9" y1="3" x2="9" y2="21"></line></svg>`;
      if (title.toLowerCase().includes('perfume') || title.toLowerCase().includes('chemical')) iconSvg = `<svg viewBox="0 0 24 24" fill="none" stroke="var(--gold)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="width:18px; height:18px;"><path d="M10 2v4M14 2v4M6 10v10a2 2 0 002 2h8a2 2 0 002-2V10a2 2 0 00-2-2H8a2 2 0 00-2 2z"/></svg>`;
      if (title.toLowerCase().includes('handl')) iconSvg = `<svg viewBox="0 0 24 24" fill="none" stroke="var(--gold)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="width:18px; height:18px;"><path d="M18 8h1a4 4 0 0 1 0 8h-1"></path><path d="M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z"></path><line x1="6" y1="1" x2="6" y2="4"></line><line x1="10" y1="1" x2="10" y2="4"></line><line x1="14" y1="1" x2="14" y2="4"></line></svg>`;
      if (title.toLowerCase().includes('longevity') || title.toLowerCase().includes('tip')) iconSvg = `<svg viewBox="0 0 24 24" fill="none" stroke="var(--gold)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="width:18px; height:18px;"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>`;

      html += `
        <div style="background: rgba(255,255,255,0.7); border: 1px solid rgba(201,168,76,0.15); border-radius: 8px; padding: 18px; display: flex; flex-direction: column; gap: 10px; transition: transform 0.3s, box-shadow 0.3s; cursor: default;" onmouseover="this.style.transform='translateY(-3px)'; this.style.boxShadow='0 5px 15px rgba(201,168,76,0.1)';" onmouseout="this.style.transform='translateY(0)'; this.style.boxShadow='none';">
          <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 2px;">
            <div style="background: rgba(201,168,76,0.1); width: 36px; height: 36px; border-radius: 50%; display: flex; align-items: center; justify-content: center; flex-shrink: 0; box-shadow: inset 0 0 10px rgba(201,168,76,0.05);">
               ${iconSvg}
            </div>
            <div style="font-family: 'Playfair Display', serif; font-weight: 600; font-size: 15px; color: var(--dark); letter-spacing: 0.3px;">${title}</div>
          </div>
          <div style="font-size: 13px; line-height: 1.6; color: var(--text);">${descText}</div>
        </div>
      `;
    });

    html += `</div>`;
    care.innerHTML = html;
  }

  if (stock) {
    const isOut = p.stock === 'Out of Stock';
    stock.innerHTML = `<span style="width: 8px; height: 8px; border-radius: 50%; background: ${isOut ? '#D93025' : '#4CAF50'};"></span> Availability: ${isOut ? 'Sold Out' : 'In Stock'}`;
  }

  if (p.stock === 'Out of Stock') {
    if (btn) { btn.innerText = 'Sold Out'; btn.disabled = true; }
    if (buyBtn) { buyBtn.disabled = true; }
  } else {
    if (btn) {
      btn.disabled = false;
      btn.innerText = 'Add to Cart';
      btn.onclick = () => {
        if (!currentUser) { openAuth(); return; }
        for (let i = 0; i < currentQty; i++) cart.push(p);
        localStorage.setItem('saforio_cart', JSON.stringify(cart));
        updateCartIcon();

        // Amazon-style button change
        const originalText = btn.innerHTML;
        btn.classList.add('added');
        btn.innerHTML = 'Added to Cart';

        showSideNotification(p);

        setTimeout(() => {
          btn.classList.remove('added');
          btn.innerHTML = originalText;
        }, 3000);
      };
    }
    if (buyBtn) {
      buyBtn.disabled = false;
      buyBtn.onclick = () => {
        if (!currentUser) { openAuth(); return; }
        for (let i = 0; i < currentQty; i++) cart.push(p);
        localStorage.setItem('saforio_cart', JSON.stringify(cart));
        updateCartIcon();
        showToast("Preparing Checkout...", "info", p.name);
        openCheckout();
      };
    }
  }

  // Thumbs — filter out empty/undefined values
  const rawImages = [
    p.image || p.img,
    p.imageHover || p.imgHover || p.image || p.img,
    ...(p.extraImages || [])
  ];
  currentDetailImages = [...new Set(rawImages.filter(u => u && u.trim && u.trim() !== ''))];
  currentDetailIndex = 0;

  if (thumbs) {
    thumbs.innerHTML = currentDetailImages.map((img, i) => {
      const thumbAlt = i === 0
        ? `${p.name} - Front View | ROKEA by RK`
        : `${p.name} - View ${i + 1} | ROKEA by RK`;
      return `<img src="${img}" class="thumb-item ${i === 0 ? 'active' : ''}" loading="lazy" decoding="async" ${getSEOAttributes({ name: thumbAlt })} onclick="switchDetailImage(${i})" onerror="this.style.display='none'">`;
    }).join('');
  }

  // Swipe Logic
  const visualCont = document.getElementById('mainVisualCont');
  if (visualCont) {
    visualCont.addEventListener('touchstart', e => {
      touchstartX = e.changedTouches[0].screenX;
    }, { passive: true });

    visualCont.addEventListener('touchend', e => {
      touchendX = e.changedTouches[0].screenX;
      handleSwipe();
    }, { passive: true });

    // Premium Interactive Pan-Zoom (Cursor tracking to prevent image cut-off on zoom)
    if (mainImg) {
      visualCont.addEventListener('mousemove', (e) => {
        const rect = visualCont.getBoundingClientRect();
        const x = ((e.clientX - rect.left) / rect.width) * 100;
        const y = ((e.clientY - rect.top) / rect.height) * 100;
        mainImg.style.transformOrigin = `${x}% ${y}%`;
      });

      visualCont.addEventListener('mouseleave', () => {
        // Reset to original focus position
        mainImg.style.transformOrigin = 'center 10%';
      });

      // Mobile Touch Move Zoom support
      visualCont.addEventListener('touchmove', (e) => {
        if (e.touches.length === 1) {
          const rect = visualCont.getBoundingClientRect();
          const touch = e.touches[0];
          const x = ((touch.clientX - rect.left) / rect.width) * 100;
          const y = ((touch.clientY - rect.top) / rect.height) * 100;
          mainImg.style.transformOrigin = `${x}% ${y}%`;
        }
      }, { passive: true });
    }
  }

  renderRelatedProducts(p.category, p.id);

  // Update page title
  if (p.name) document.title = p.name + ' — ROKEA by RK';
}

window.switchDetailImage = (index) => {
  currentDetailIndex = index;
  const mainImg = document.getElementById('detailMainImg');
  if (mainImg) {
    mainImg.style.opacity = '0';
    setTimeout(() => {
      mainImg.src = currentDetailImages[currentDetailIndex];
      mainImg.style.opacity = '1';
    }, 200);
  }

  // Update thumbs
  document.querySelectorAll('.thumb-item').forEach((thumb, i) => {
    thumb.classList.toggle('active', i === index);
  });
}

function handleSwipe() {
  if (touchendX < touchstartX - 50) {
    // Swipe Left -> Next Image
    if (currentDetailIndex < currentDetailImages.length - 1) {
      switchDetailImage(currentDetailIndex + 1);
    } else {
      switchDetailImage(0);
    }
  }
  if (touchendX > touchstartX + 50) {
    // Swipe Right -> Prev Image
    if (currentDetailIndex > 0) {
      switchDetailImage(currentDetailIndex - 1);
    } else {
      switchDetailImage(currentDetailImages.length - 1);
    }
  }
}

// Initial Render
renderAll();
updateCartIcon();
updateWishlistIcon();
updateUserUI();

// =============================================
// SPLASH SCREEN LOGIC
// =============================================
document.addEventListener('DOMContentLoaded', () => {
  if (sessionStorage.getItem('openAdmin') === 'true') {
    sessionStorage.removeItem('openAdmin');
    const adminModal = document.getElementById('adminModal');
    if (adminModal) {
      adminModal.style.display = 'flex';
      renderAll();
    }
  }

  const splashScreen = document.getElementById('splashScreen');
  const splashLogo = document.getElementById('splashLogo');
  const navLogoImg = document.getElementById('navLogoImg');

  if (splashScreen && splashLogo && navLogoImg) {
    const hasSplashPlayed = sessionStorage.getItem('splashPlayed') === 'true';

    if (document.getElementById('home') && !hasSplashPlayed) {
      sessionStorage.setItem('splashPlayed', 'true');
      navLogoImg.style.opacity = '0';
      navLogoImg.style.transition = 'opacity 0.5s ease';

      // Strictly prevent scrolling before and during animation
      document.documentElement.style.overflow = 'hidden';
      document.body.style.overflow = 'hidden';

      let splashDone = false;

      const preventScroll = (e) => {
        if (!splashDone) e.preventDefault();
      };

      window.addEventListener('wheel', preventScroll, { passive: false });
      window.addEventListener('touchmove', preventScroll, { passive: false });

      const handleSplash = (e) => {
        if (splashDone) return;

        if (e.type === 'wheel' && e.deltaY <= 0) return;

        splashDone = true;

        // Hide scroll indicator immediately
        const scrollInd = splashScreen.querySelector('.splash-scroll-indicator');
        if (scrollInd) scrollInd.style.opacity = '0';

        const navRect = navLogoImg.getBoundingClientRect();
        const logoRect = splashLogo.getBoundingClientRect();

        const xTranslate = navRect.left + (navRect.width / 2) - (logoRect.left + logoRect.width / 2);
        const yTranslate = navRect.top + (navRect.height / 2) - (logoRect.top + logoRect.height / 2);
        const scale = navRect.width / logoRect.width;

        splashLogo.style.transform = `translate(${xTranslate}px, ${yTranslate}px) scale(${Math.max(scale, 0.2)})`;

        // Wait for the logo to reach the destination
        setTimeout(() => {
          splashLogo.style.opacity = '0';
          navLogoImg.style.transition = 'opacity 0.5s ease';
          navLogoImg.style.opacity = '1';
          splashScreen.classList.add('scrolled');

          // Restore scrolling only after the splash background is gone
          setTimeout(() => {
            document.documentElement.style.overflow = '';
            document.body.style.overflow = '';
            window.removeEventListener('wheel', preventScroll);
            window.removeEventListener('touchmove', preventScroll);
          }, 800);
        }, 950);

        window.removeEventListener('wheel', handleSplash);
        window.removeEventListener('touchmove', handleSplash);
        window.removeEventListener('touchstart', handleSplash);
      };

      window.addEventListener('wheel', handleSplash, { passive: false });
      window.addEventListener('touchmove', handleSplash, { passive: false });
      window.addEventListener('touchstart', handleSplash, { passive: false });
    } else {
      splashScreen.style.display = 'none';
      navLogoImg.style.opacity = '1';
    }
  }
});

// --- FAB INJECTION ---
function injectFABs() {
  if (!document.querySelector('.whatsapp-fab')) {
    const waFAB = document.createElement('a');
    waFAB.href = "https://wa.me/917010394051";
    waFAB.className = "whatsapp-fab";
    waFAB.target = "_blank";
    waFAB.setAttribute('aria-label', 'Chat on WhatsApp');
    waFAB.innerHTML = `
      <svg viewBox="0 0 24 24">
        <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z"/>
      </svg>
      <div class="whatsapp-tooltip">Chat with us</div>
    `;
    document.body.appendChild(waFAB);
  }
  if (!document.querySelector('.ai-fab')) {
    const aiFAB = document.createElement('a');
    aiFAB.href = "/ai-stylist";
    aiFAB.className = "ai-fab";
    aiFAB.innerHTML = `
      <div class="ai-fab-icon">✦<span class="ai-fab-badge">New</span></div>
      <span class="ai-fab-text">AI Virtual Stylist is Here</span>
    `;
    document.body.appendChild(aiFAB);
  }
}
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', injectFABs);
} else {
  injectFABs();
}

// Disable right-click & drag on all images to prevent opening them in a new tab (which triggers free-hosting ads)
document.addEventListener('contextmenu', function (e) {
  if (e.target.tagName === 'IMG') {
    e.preventDefault();
  }
});
document.addEventListener('dragstart', function (e) {
  if (e.target.tagName === 'IMG') {
    e.preventDefault();
  }
});

// =============================================
// TESTIMONIAL CAROUSEL LOGIC
// =============================================
let currentTestimonialIndex = 0;
let testimonialInterval;

function initTestimonialCarousel() {
  const slides = document.querySelectorAll('.nt-featured-card.slide');
  const dots = document.querySelectorAll('.nt-dot');
  if (slides.length === 0) return;

  function showTestimonial(index) {
    slides.forEach(slide => slide.classList.remove('active'));
    dots.forEach(dot => dot.classList.remove('active'));

    slides[index].classList.add('active');
    if (dots[index]) dots[index].classList.add('active');
    currentTestimonialIndex = index;
  }

  window.nextTestimonial = () => {
    let nextIndex = (currentTestimonialIndex + 1) % slides.length;
    showTestimonial(nextIndex);
    resetTestimonialInterval();
  };

  window.prevTestimonial = () => {
    let prevIndex = (currentTestimonialIndex - 1 + slides.length) % slides.length;
    showTestimonial(prevIndex);
    resetTestimonialInterval();
  };

  window.goToTestimonial = (index) => {
    showTestimonial(index);
    resetTestimonialInterval();
  };

  function resetTestimonialInterval() {
    clearInterval(testimonialInterval);
    testimonialInterval = setInterval(window.nextTestimonial, 5000);
  }

  // Start auto-play
  resetTestimonialInterval();
}

document.addEventListener('DOMContentLoaded', initTestimonialCarousel);
// Custom Blouse Booking Logic - Direct Google Form Open with Pattasu Fireworks
window.openBlouseBooking = () => {
  if (typeof window.triggerPattasuFireworks === 'function') {
    window.triggerPattasuFireworks(4000);
  }
  const modal = document.getElementById('blouseModal');
  if (modal) {
    modal.style.display = 'flex';
    document.body.classList.add('modal-open');
  } else {
    window.open('https://forms.gle/xHJ6hSpyreHVNsNc8', '_blank');
  }
}

// FAQ Accordion Toggle
window.toggleFaq = (element) => {
  const faqItem = element.closest('.faq-item');
  if (!faqItem) return;
  const wasActive = faqItem.classList.contains('active');
  
  // Close other open FAQ items for neat accordion behavior
  document.querySelectorAll('.faq-item').forEach(item => {
    item.classList.remove('active');
  });

  if (!wasActive) {
    faqItem.classList.add('active');
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const customForm = document.getElementById('customBlouseForm');
  if (customForm) {
    customForm.addEventListener('submit', (e) => {
      e.preventDefault();
      alert('Thank you! Your custom blouse order details have been received. We will contact you shortly on WhatsApp to confirm the order.');
      // Here you would typically send the data to your backend or Firebase
      window.location.href = 'index.html';
    });
  }
});

// =============================================
// TEMPORARY SLUG MIGRATION FROM ADMIN DASHBOARD
// =============================================
window.executeSlugMigration = async () => {
  if (!db) {
    console.error("Firestore DB not found.");
    alert("Firestore DB not found.");
    return;
  }

  const btn = document.getElementById('generateSlugsBtn');
  if (btn) btn.innerText = "Generating...";

  console.log("Starting slug migration from Admin Dashboard...");

  try {
    const snapshot = await db.collection("products").get();
    let updatedCount = 0;
    let skippedCount = 0;

    for (let doc of snapshot.docs) {
      const data = doc.data();
      if (!data.slug) {
        const newSlug = generateSlug(data.name);
        if (newSlug) {
          console.log(`Updating product: ${data.name} -> ${newSlug}`);
          await db.collection("products").doc(doc.id).update({ slug: newSlug });
          updatedCount++;
        } else {
          console.warn(`Could not generate slug for product: ${doc.id}`);
          skippedCount++;
        }
      } else {
        skippedCount++;
      }
    }

    console.log(`Migration Complete! 🎉`);
    console.log(`Updated: ${updatedCount} products.`);
    console.log(`Skipped (already had slug or invalid name): ${skippedCount} products.`);
    alert(`Migration successful! Updated ${updatedCount} products. Check console for details.`);
  } catch (error) {
    console.error("Error during migration:", error);
    alert("Migration failed. Check console for details.");
  } finally {
    if (btn) btn.innerText = "Generate Slugs";
  }
};

// Function to handle sharing products
window.shareProduct = function (productId) {
  let urlToShare = window.location.href;
  let titleToShare = document.title;

  // Try to find the exact product if it exists
  if (typeof products !== 'undefined' && products.length > 0) {
    let p = products.find(prod => prod.id == productId || prod.slug === productId);
    if (p) {
      if (p.slug) {
        urlToShare = `https://rokeabyrk.com/product/${p.slug}`;
      } else if (p.id) {
        urlToShare = `https://rokeabyrk.com/product-details?id=${p.id}`;
      }
      titleToShare = `${p.name} | ROKEA by RK`;
    }
  }

  const shareData = {
    title: titleToShare,
    text: 'Check out this beautiful product from ROKEA by RK!',
    url: urlToShare
  };

  if (navigator.share) {
    navigator.share(shareData).catch(err => {
      console.log('Error sharing:', err);
    });
  } else {
    // Fallback: Copy to clipboard
    navigator.clipboard.writeText(urlToShare).then(() => {
      alert("Link copied to clipboard!");
    }).catch(err => {
      console.error('Failed to copy: ', err);
      // Fallback for older browsers
      const textArea = document.createElement("textarea");
      textArea.value = urlToShare;
      document.body.appendChild(textArea);
      textArea.select();
      try {
        document.execCommand('copy');
        alert("Link copied to clipboard!");
      } catch (err) {
        alert("Failed to copy link. Please copy the URL manually.");
      }
      document.body.removeChild(textArea);
    });
  }
};

/* ==========================================================================
   PATTASU FIREWORKS ENGINE (Festive Crackers Explosion Effect)
   ========================================================================== */
window.triggerPattasuFireworks = function (durationMs = 4500) {
  let canvas = document.getElementById('pattasuFireworksCanvas');
  if (!canvas) {
    canvas = document.createElement('canvas');
    canvas.id = 'pattasuFireworksCanvas';
    canvas.style.position = 'fixed';
    canvas.style.top = '0';
    canvas.style.left = '0';
    canvas.style.width = '100vw';
    canvas.style.height = '100vh';
    canvas.style.pointerEvents = 'none';
    canvas.style.zIndex = '999999';
    document.body.appendChild(canvas);
  }

  const ctx = canvas.getContext('2d');
  let width = (canvas.width = window.innerWidth);
  let height = (canvas.height = window.innerHeight);

  const handleResize = () => {
    width = canvas.width = window.innerWidth;
    height = canvas.height = window.innerHeight;
  };
  window.addEventListener('resize', handleResize);

  const colors = [
    '#ffd700', // Metallic Gold
    '#ff3366', // Crimson Flare
    '#ff9900', // Amber Diya
    '#00f2fe', // Turquoise Spark
    '#00ff87', // Emerald Star
    '#ff007f', // Deep Fuchsia
    '#ffffff', // Diamond White
    '#ffea00'  // Bright Yellow
  ];

  class Rocket {
    constructor(x, targetY, color) {
      this.x = x;
      this.y = height;
      this.targetY = targetY;
      this.color = color;
      this.speed = 9 + Math.random() * 6;
      this.angle = -Math.PI / 2 + (Math.random() - 0.5) * 0.25;
      this.vx = Math.cos(this.angle) * this.speed;
      this.vy = Math.sin(this.angle) * this.speed;
      this.exploded = false;
      this.trail = [];
    }

    update() {
      this.trail.push({ x: this.x, y: this.y, alpha: 1 });
      if (this.trail.length > 8) this.trail.shift();
      this.trail.forEach(t => (t.alpha -= 0.12));

      this.x += this.vx;
      this.y += this.vy;
      this.vy += 0.06;

      if (this.vy >= 0 || this.y <= this.targetY) {
        this.exploded = true;
        createExplosion(this.x, this.y, this.color);
      }
    }

    draw() {
      this.trail.forEach(t => {
        ctx.beginPath();
        ctx.arc(t.x, t.y, 2.5, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255, 215, 0, ${t.alpha})`;
        ctx.fill();
      });

      ctx.beginPath();
      ctx.arc(this.x, this.y, 3.5, 0, Math.PI * 2);
      ctx.fillStyle = this.color;
      ctx.shadowBlur = 14;
      ctx.shadowColor = this.color;
      ctx.fill();
      ctx.shadowBlur = 0;
    }
  }

  class Particle {
    constructor(x, y, color, isSparkler = false) {
      this.x = x;
      this.y = y;
      this.color = color;
      const speed = isSparkler ? Math.random() * 12 + 2 : Math.random() * 8 + 1;
      const angle = Math.random() * Math.PI * 2;
      this.vx = Math.cos(angle) * speed;
      this.vy = Math.sin(angle) * speed;
      this.gravity = 0.12;
      this.friction = 0.96;
      this.alpha = 1;
      this.decay = Math.random() * 0.02 + 0.012;
      this.size = Math.random() * 3.5 + 1.5;
      this.sparkle = Math.random() > 0.4;
    }

    update() {
      this.vx *= this.friction;
      this.vy *= this.friction;
      this.vy += this.gravity;
      this.x += this.vx;
      this.y += this.vy;
      this.alpha -= this.decay;
    }

    draw() {
      if (this.alpha <= 0) return;
      ctx.save();
      ctx.globalAlpha = this.sparkle && Math.random() > 0.4 ? this.alpha * 0.5 : this.alpha;
      ctx.beginPath();
      ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
      ctx.fillStyle = this.color;
      ctx.shadowBlur = 12;
      ctx.shadowColor = this.color;
      ctx.fill();
      ctx.restore();
    }
  }

  class FountainParticle {
    constructor(x, y) {
      this.x = x;
      this.y = y;
      this.vx = (Math.random() - 0.5) * 4.5;
      this.vy = -(Math.random() * 11 + 10);
      this.gravity = 0.35;
      this.alpha = 1;
      this.decay = Math.random() * 0.03 + 0.015;
      this.color = Math.random() > 0.5 ? '#ffd700' : '#ffffff';
      this.size = Math.random() * 2.5 + 1;
    }
    update() {
      this.vy += this.gravity;
      this.x += this.vx;
      this.y += this.vy;
      this.alpha -= this.decay;
    }
    draw() {
      if (this.alpha <= 0) return;
      ctx.save();
      ctx.globalAlpha = this.alpha;
      ctx.beginPath();
      ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
      ctx.fillStyle = this.color;
      ctx.shadowBlur = 8;
      ctx.shadowColor = '#ffd700';
      ctx.fill();
      ctx.restore();
    }
  }

  let rockets = [];
  let particles = [];
  let fountains = [];

  function createExplosion(x, y, color) {
    const particleCount = 65 + Math.floor(Math.random() * 35);
    for (let i = 0; i < particleCount; i++) {
      particles.push(new Particle(x, y, color));
    }
    for (let i = 0; i < 22; i++) {
      particles.push(new Particle(x, y, '#ffd700', true));
    }
  }

  const startTime = Date.now();
  let animId;

  const launchInterval = setInterval(() => {
    if (Date.now() - startTime > durationMs - 1000) {
      clearInterval(launchInterval);
      return;
    }
    for (let i = 0; i < 2; i++) {
      const rx = Math.random() * (width * 0.8) + width * 0.1;
      const ry = Math.random() * (height * 0.4) + height * 0.15;
      const color = colors[Math.floor(Math.random() * colors.length)];
      rockets.push(new Rocket(rx, ry, color));
    }
    if (Math.random() > 0.3) {
      const fx = Math.random() > 0.5 ? width * 0.15 : width * 0.85;
      for (let f = 0; f < 15; f++) {
        fountains.push(new FountainParticle(fx, height));
      }
    }
  }, 350);

  // Initial burst
  for (let i = 0; i < 3; i++) {
    const rx = Math.random() * (width * 0.6) + width * 0.2;
    const ry = Math.random() * (height * 0.35) + height * 0.15;
    const color = colors[Math.floor(Math.random() * colors.length)];
    rockets.push(new Rocket(rx, ry, color));
  }

  function loop() {
    ctx.clearRect(0, 0, width, height);

    rockets.forEach((r, idx) => {
      r.update();
      r.draw();
      if (r.exploded) rockets.splice(idx, 1);
    });

    particles.forEach((p, idx) => {
      p.update();
      p.draw();
      if (p.alpha <= 0) particles.splice(idx, 1);
    });

    fountains.forEach((f, idx) => {
      f.update();
      f.draw();
      if (f.alpha <= 0) fountains.splice(idx, 1);
    });

    if (Date.now() - startTime < durationMs || rockets.length > 0 || particles.length > 0 || fountains.length > 0) {
      animId = requestAnimationFrame(loop);
    } else {
      cancelAnimationFrame(animId);
      window.removeEventListener('resize', handleResize);
      ctx.clearRect(0, 0, width, height);
      if (canvas.parentNode) canvas.parentNode.removeChild(canvas);
    }
  }

  loop();
};

window.triggerFireworks = window.triggerPattasuFireworks;

// Auto-trigger pattasu fireworks when custom blouse order form page or lead form opens
document.addEventListener('DOMContentLoaded', () => {
  const isCustomBlousePage = window.location.pathname.includes('custom-blouse-order') ||
                             document.querySelector('.google-form-container') ||
                             document.getElementById('customBlouseForm');
  if (isCustomBlousePage) {
    setTimeout(() => {
      if (typeof window.triggerPattasuFireworks === 'function') {
        window.triggerPattasuFireworks(4500);
      }
    }, 600);
  }
});

/* ==========================================================================
   HERO TITLE LETTER-BY-LETTER REVEAL ANIMATION
   ========================================================================== */
function initHeroLetterReveal() {
  const title = document.querySelector('.hero-title');
  if (!title || title.getAttribute('data-letter-split') === 'true') return;

  title.setAttribute('data-letter-split', 'true');
  const childNodes = Array.from(title.childNodes);
  title.innerHTML = '';

  let charIndex = 0;
  const baseDelay = 0.35;

  childNodes.forEach(node => {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent;
      for (let i = 0; i < text.length; i++) {
        const char = text[i];
        if (char === ' ' || char === '\n') {
          title.appendChild(document.createTextNode(char));
        } else {
          const span = document.createElement('span');
          span.className = 'hero-char';
          span.textContent = char;
          span.style.animationDelay = `${(baseDelay + charIndex * 0.035).toFixed(3)}s`;
          title.appendChild(span);
          charIndex++;
        }
      }
    } else if (node.nodeName === 'EM') {
      const em = document.createElement('em');
      const text = node.textContent;
      for (let i = 0; i < text.length; i++) {
        const char = text[i];
        if (char === ' ' || char === '\n') {
          em.appendChild(document.createTextNode(char));
        } else {
          const span = document.createElement('span');
          span.className = 'hero-char';
          span.textContent = char;
          span.style.animationDelay = `${(baseDelay + charIndex * 0.035).toFixed(3)}s`;
          em.appendChild(span);
          charIndex++;
        }
      }
      title.appendChild(em);
    } else if (node.nodeName === 'BR') {
      title.appendChild(document.createElement('br'));
    } else {
      title.appendChild(node.cloneNode(true));
    }
  });
}

/* ==========================================================================
   CATEGORY SECTION - LETTER-BY-LETTER TITLE & STAGGERED SCROLL REVEAL
   ========================================================================== */
function initCategoryTitleReveal() {
  const title = document.querySelector('.products-main-title');
  if (!title || title.getAttribute('data-letter-split') === 'true') return;

  title.setAttribute('data-letter-split', 'true');
  const childNodes = Array.from(title.childNodes);
  title.innerHTML = '';

  let charIndex = 0;
  const baseDelay = 0.3; // Starts after header icon reveal

  childNodes.forEach(node => {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent;
      for (let i = 0; i < text.length; i++) {
        const char = text[i];
        if (char === ' ' || char === '\n') {
          title.appendChild(document.createTextNode(char));
        } else {
          const span = document.createElement('span');
          span.className = 'cat-title-char';
          span.textContent = char;
          span.style.animationDelay = `${(baseDelay + charIndex * 0.03).toFixed(3)}s`;
          title.appendChild(span);
          charIndex++;
        }
      }
    } else if (node.nodeName === 'EM') {
      const em = document.createElement('em');
      if (node.className) em.className = node.className;
      const text = node.textContent;
      for (let i = 0; i < text.length; i++) {
        const char = text[i];
        if (char === ' ' || char === '\n') {
          em.appendChild(document.createTextNode(char));
        } else {
          const span = document.createElement('span');
          span.className = 'cat-title-char';
          span.textContent = char;
          span.style.animationDelay = `${(baseDelay + charIndex * 0.03).toFixed(3)}s`;
          em.appendChild(span);
          charIndex++;
        }
      }
      title.appendChild(em);
    } else if (node.nodeName === 'BR') {
      title.appendChild(document.createElement('br'));
    } else {
      title.appendChild(node.cloneNode(true));
    }
  });
}

function initCategoryScrollReveal() {
  const section = document.querySelector('.products-section');
  if (!section) return;

  // Split category title letters first
  initCategoryTitleReveal();

  // Mark JS reveal ready so initial hidden state is applied smoothly
  section.classList.add('js-reveal-ready');

  const triggerReveal = () => {
    section.classList.add('cat-revealed');
  };

  if ('IntersectionObserver' in window) {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          triggerReveal();
          observer.unobserve(entry.target);
        }
      });
    }, {
      root: null,
      threshold: 0.1,
      rootMargin: '0px 0px -30px 0px'
    });

    observer.observe(section);
  } else {
    triggerReveal();
  }
}

document.addEventListener('DOMContentLoaded', () => {
  initHeroLetterReveal();
  initCategoryScrollReveal();
});

if (document.readyState === 'interactive' || document.readyState === 'complete') {
  initHeroLetterReveal();
  initCategoryScrollReveal();
}


// ========================================================
// APPOINTMENT & CONTACT FORM HANDLERS
// ========================================================
window.openAppointmentModal = () => {
  let modal = document.getElementById('appointmentModal');
  if (!modal) {
    // If not found in DOM, dynamically inject it so it works on any page
    const modalWrapper = document.createElement('div');
    modalWrapper.id = 'appointmentModal';
    modalWrapper.className = 'modal';
    modalWrapper.innerHTML = `
      <div class="modal-content appointment-modal-content">
        <span class="modal-close" onclick="closeAppointmentModal()">×</span>
        <div class="appointment-modal-header">
          <div class="auth-top-ornament">🪷</div>
          <span class="section-label">ROKEA CONCIERGE & STYLING</span>
          <h2 class="appointment-heading">Book an <em>Appointment</em></h2>
          <p class="appointment-subtitle">Schedule a personalized bridal styling consultation, custom blouse fitting, or boutique visit in Coimbatore.</p>
          <div class="auth-ornamental-divider small">
            <span class="line"></span>
            <span class="symbol">🪷</span>
            <span class="line"></span>
          </div>
        </div>

        <form id="appointmentForm" onsubmit="handleAppointmentSubmit(event)" class="appointment-form">
          <div class="form-row">
            <div class="form-group">
              <label>YOUR NAME <span style="color:#d4af37;">*</span></label>
              <div class="input-with-icon">
                <i class="fas fa-user input-icon"></i>
                <input type="text" id="appoName" required placeholder="Ex: Ananya Sharma">
              </div>
            </div>
            <div class="form-group">
              <label>PHONE / WHATSAPP <span style="color:#d4af37;">*</span></label>
              <div class="input-with-icon">
                <i class="fas fa-phone input-icon"></i>
                <input type="tel" id="appoPhone" required placeholder="Ex: 9876543210">
              </div>
            </div>
          </div>

          <div class="form-row">
            <div class="form-group">
              <label>EMAIL ADDRESS</label>
              <div class="input-with-icon">
                <i class="fas fa-envelope input-icon"></i>
                <input type="email" id="appoEmail" placeholder="your@email.com">
              </div>
            </div>
            <div class="form-group">
              <label>SERVICE / INTEREST <span style="color:#d4af37;">*</span></label>
              <div class="input-with-icon select-wrapper">
                <i class="fas fa-sparkles input-icon"></i>
                <select id="appoService" required>
                  <option value="Bridal Saree Consultation">Bridal Saree Styling & Draping</option>
                  <option value="Custom Blouse Designing">Custom Blouse Designing & Measurement</option>
                  <option value="Heritage Jewellery Styling">Heritage & Temple Jewellery Styling</option>
                  <option value="Boutique Personal Visit">Boutique Visit (Coimbatore)</option>
                  <option value="Online Video Consultation">Online Video Consultation</option>
                  <option value="General Enquiry">General Enquiry / Support</option>
                </select>
              </div>
            </div>
          </div>

          <div class="form-row">
            <div class="form-group">
              <label>PREFERRED DATE</label>
              <div class="input-with-icon">
                <i class="fas fa-calendar-alt input-icon"></i>
                <input type="date" id="appoDate">
              </div>
            </div>
            <div class="form-group">
              <label>PREFERRED TIME</label>
              <div class="input-with-icon select-wrapper">
                <i class="fas fa-clock input-icon"></i>
                <select id="appoTime">
                  <option value="Morning (10:00 AM - 1:00 PM)">Morning (10:00 AM - 1:00 PM)</option>
                  <option value="Afternoon (1:00 PM - 5:00 PM)" selected>Afternoon (1:00 PM - 5:00 PM)</option>
                  <option value="Evening (5:00 PM - 8:00 PM)">Evening (5:00 PM - 8:00 PM)</option>
                </select>
              </div>
            </div>
          </div>

          <div class="form-group">
            <label>MESSAGE / SPECIAL REQUIREMENTS</label>
            <div class="input-with-icon">
              <textarea id="appoNotes" rows="2" placeholder="Tell us about your occasion, preferred colors, or design requirements..." style="width:100%; border:1px solid rgba(212,175,55,0.3); border-radius:8px; padding:10px 12px; font-family:inherit; font-size:13px; outline:none; background:#fff; resize:vertical;"></textarea>
            </div>
          </div>

          <button type="submit" class="btn-primary pill-btn" id="appoSubmitBtn" style="width:100%; margin-top:10px; padding:12px; font-weight:700; letter-spacing:1px; display:flex; align-items:center; justify-content:center; gap:8px;">
            CONFIRM APPOINTMENT <i class="fas fa-arrow-right"></i>
          </button>

          <div class="appointment-whatsapp-box" style="margin-top:16px; padding:12px 14px; background:rgba(37,211,102,0.1); border:1px solid rgba(37,211,102,0.35); border-radius:10px; text-align:center;">
            <span style="font-size:12px; color:#2e7d32; font-weight:600; display:block; margin-bottom:6px;">Prefer Instant Booking via WhatsApp?</span>
            <a href="javascript:void(0)" onclick="bookViaWhatsAppDirect()" style="display:inline-flex; align-items:center; gap:8px; background:#25D366; color:#fff; font-weight:700; font-size:12.5px; padding:8px 20px; border-radius:50px; text-decoration:none; box-shadow:0 4px 12px rgba(37,211,102,0.3);">
              <i class="fab fa-whatsapp" style="font-size:16px;"></i> Book Instantly on WhatsApp
            </a>
          </div>
        </form>
      </div>`;
    document.body.appendChild(modalWrapper);
    modal = modalWrapper;
  }

  // Pre-fill user data if logged in
  if (currentUser) {
    const nameInp = document.getElementById('appoName');
    const emailInp = document.getElementById('appoEmail');
    const phoneInp = document.getElementById('appoPhone');
    if (nameInp && !nameInp.value) nameInp.value = currentUser.displayName || '';
    if (emailInp && !emailInp.value) emailInp.value = currentUser.email || '';
    if (phoneInp && !phoneInp.value && currentUser.phoneNumber) phoneInp.value = currentUser.phoneNumber;
  }

  // Set min date to today
  const dateInput = document.getElementById('appoDate');
  if (dateInput) {
    const today = new Date().toISOString().split('T')[0];
    dateInput.min = today;
    if (!dateInput.value) dateInput.value = today;
  }

  modal.style.display = 'flex';
  document.body.classList.add('modal-open');
};

window.closeAppointmentModal = () => {
  const modal = document.getElementById('appointmentModal');
  if (modal) {
    modal.style.display = 'none';
    document.body.classList.remove('modal-open');
  }
};

window.handleAppointmentSubmit = (e) => {
  if (e && e.preventDefault) e.preventDefault();

  const name = document.getElementById('appoName') ? document.getElementById('appoName').value.trim() : '';
  const phone = document.getElementById('appoPhone') ? document.getElementById('appoPhone').value.trim() : '';
  const email = document.getElementById('appoEmail') ? document.getElementById('appoEmail').value.trim() : '';
  const service = document.getElementById('appoService') ? document.getElementById('appoService').value : 'Bridal Saree Consultation';
  const date = document.getElementById('appoDate') ? document.getElementById('appoDate').value : '';
  const time = document.getElementById('appoTime') ? document.getElementById('appoTime').value : '';
  const notes = document.getElementById('appoNotes') ? document.getElementById('appoNotes').value.trim() : '';

  if (!name) {
    alert("Please enter your name.");
    return;
  }
  if (!phone || phone.length < 7) {
    alert("Please enter a valid phone or WhatsApp number.");
    return;
  }

  const submitBtn = document.getElementById('appoSubmitBtn');
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.innerHTML = 'Booking Appointment... <i class="fas fa-spinner fa-spin"></i>';
  }

  const appoData = {
    name,
    phone,
    email,
    service,
    date,
    time,
    notes,
    type: 'Appointment',
    source: 'Website Book Appointment',
    createdAt: new Date().toISOString()
  };

  // 1. Store in localStorage
  try {
    const localAppos = JSON.parse(localStorage.getItem('saforio_appointments')) || [];
    localAppos.push(appoData);
    localStorage.setItem('saforio_appointments', JSON.stringify(localAppos));
  } catch (err) {
    console.error("Local storage error:", err);
  }

  // 2. Store in Firestore (both appointments and leads collection so admin views see it!)
  if (window.db) {
    db.collection("appointments").add(appoData)
      .then(() => console.log("Appointment saved to Firestore"))
      .catch(err => console.error("Firestore appointment error:", err));

    db.collection("leads").add({
      name: name,
      phone: phone,
      email: email,
      interest: service + (date ? ' [' + date + ' ' + time + ']' : ''),
      notes: notes,
      date: new Date().toISOString()
    }).catch(err => console.error("Firestore lead error:", err));
  }

  // 3. Trigger festive celebration fireworks if available
  if (typeof window.triggerPattasuFireworks === 'function') {
    window.triggerPattasuFireworks(4000);
  }

  alert("Thank you, " + name + "! Your appointment for " + service + " has been booked.\n\nOur master stylist will call you shortly to confirm your session.");

  // Ask if they want instant WhatsApp confirmation
  const sendToWa = confirm("Would you like to send this appointment to WhatsApp for instant confirmation with our designer?");
  if (sendToWa) {
    window.bookViaWhatsAppDirect();
  }

  if (submitBtn) {
    submitBtn.disabled = false;
    submitBtn.innerHTML = 'CONFIRM APPOINTMENT <i class="fas fa-arrow-right"></i>';
  }

  window.closeAppointmentModal();
};

window.bookViaWhatsAppDirect = () => {
  const name = document.getElementById('appoName') ? document.getElementById('appoName').value.trim() : '';
  const phone = document.getElementById('appoPhone') ? document.getElementById('appoPhone').value.trim() : '';
  const service = document.getElementById('appoService') ? document.getElementById('appoService').value : 'Bridal Saree & Jewellery Styling';
  const date = document.getElementById('appoDate') ? document.getElementById('appoDate').value : '';
  const time = document.getElementById('appoTime') ? document.getElementById('appoTime').value : '';
  const notes = document.getElementById('appoNotes') ? document.getElementById('appoNotes').value.trim() : '';

  let msg = "Hi ROKEA by RK, I would like to book an appointment with your master stylist:\n";
  if (name) msg += "• Name: " + name + "\n";
  if (phone) msg += "• Phone: " + phone + "\n";
  if (service) msg += "• Service: " + service + "\n";
  if (date) msg += "• Preferred Date: " + date + "\n";
  if (time) msg += "• Preferred Time: " + time + "\n";
  if (notes) msg += "• Notes: " + notes + "\n";

  const waUrl = "https://wa.me/917010394051?text=" + encodeURIComponent(msg);
  window.open(waUrl, '_blank');
};
