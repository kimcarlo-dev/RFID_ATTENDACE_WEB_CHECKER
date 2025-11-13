// API Configuration
const API_URL = 'https://script.google.com/macros/s/AKfycbwCA0b-QD9JmUplU-1oxFq0j6nytTKli5p7QxB1EiXFICeIKOoHNy7w10tQxflbD2S2hg/exec';

// Admin password for reset operations
const ADMIN_PASSWORD = 'kimdev2025';

// Global variables
let currentUser = null;
let allMembers = [];
let currentAttendance = [];
let autoRefreshInterval = null;

// Session/requests control to avoid stale UI when switching accounts
let appSessionNonce = 0; // increments on login/logout
const inFlightControllers = new Set();
function bumpSession() {
  appSessionNonce++;
  // Cancel any in-flight network requests
  try { for (const c of Array.from(inFlightControllers)) { try { c.abort(); } catch {} } } catch {}
}

// Page Loading Overlay (enhanced with reference counting + fail-safe)
const pageLoadingOverlay = document.getElementById('pageLoadingOverlay');
const pageLoadingBackdrop   = document.getElementById('pageLoadingBackdrop');
const _activeLoadingReasons = new Set();
const _loadingTimers        = new Map();
const LOADING_FAIL_SAFE_MS  = 12000; // auto-hide after 12s if stuck

function _applyLoadingVisibility() {
  if (!_activeLoadingReasons.size) {
    // Hide overlay/backdrop
    if (pageLoadingOverlay && pageLoadingBackdrop) {
      setTimeout(() => {
        pageLoadingOverlay.classList.remove('active');
        pageLoadingBackdrop.classList.remove('active');
      }, 200); // quick fade consistency
    }
  } else {
    // Show overlay/backdrop
    if (pageLoadingOverlay && pageLoadingBackdrop) {
      pageLoadingBackdrop.classList.add('active');
      pageLoadingOverlay.classList.add('active');
    }
  }
}

function showPageLoading(reason = 'generic') {
  _activeLoadingReasons.add(reason);
  // Set fail-safe timer for this reason
  if (!_loadingTimers.has(reason)) {
    const timerId = setTimeout(() => {
      if (_activeLoadingReasons.has(reason)) {
        console.warn(`Loading fail-safe triggered for reason: ${reason}`);
        _activeLoadingReasons.delete(reason);
        _applyLoadingVisibility();
      }
      _loadingTimers.delete(reason);
    }, LOADING_FAIL_SAFE_MS);
    _loadingTimers.set(reason, timerId);
  }
  _applyLoadingVisibility();
}

function hidePageLoading(reason = 'generic') {
  // Remove reason (if caller didn't pass one but generic was added, it still matches)
  _activeLoadingReasons.delete(reason);
  // Clear timer if exists
  if (_loadingTimers.has(reason)) {
    clearTimeout(_loadingTimers.get(reason));
    _loadingTimers.delete(reason);
  }
  _applyLoadingVisibility();
}

// Helper: wrap async operations with loading handling & guaranteed cleanup
async function withLoading(reason, fn) {
  showPageLoading(reason);
  try {
    return await fn();
  } finally {
    hidePageLoading(reason);
  }
}

// Network utility: fetch with timeout to avoid indefinite hanging
async function fetchWithTimeout(url, options = {}, timeoutMs = 10000) {
  const controller = new AbortController();
  inFlightControllers.add(controller);
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    return res;
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error(`Request timed out after ${timeoutMs}ms: ${url}`);
    }
    throw err;
  } finally {
    clearTimeout(id);
    inFlightControllers.delete(controller);
  }
}

// --- Utilities: Photo URL helpers (Google Drive normalization) ---
function normalizeDriveUrl(url) {
  if (!url || typeof url !== 'string') return '';
  const trimmed = url.trim();
  try {
    // Already normalized to lh3.googleusercontent.com
    if (trimmed.includes('lh3.googleusercontent.com')) return trimmed;
    
    // Common Google Drive share formats:
    // 1) https://drive.google.com/file/d/FILE_ID/view?usp=sharing
    // 2) https://drive.google.com/open?id=FILE_ID
    // 3) https://drive.google.com/uc?id=FILE_ID&export=download
    // 4) https://drive.google.com/thumbnail?id=FILE_ID
    const u = new URL(trimmed);
    if (u.hostname.includes('drive.google.com') || u.hostname.includes('googleusercontent.com')) {
      let id = '';
      // /file/d/FILE_ID/
      const m = u.pathname.match(/\/file\/d\/([^/\?]+)/);
      if (m && m[1]) id = m[1];
      // open?id=FILE_ID or uc?id=FILE_ID or thumbnail?id=FILE_ID
      if (!id) {
        id = u.searchParams.get('id') || '';
      }
      // Use GoogleUserContent CDN format (bypasses 403 errors)
      if (id) {
        return `https://lh3.googleusercontent.com/d/${id}`;
      }
      // Folders or unsupported formats return original (will likely fail)
      return trimmed;
    }
    // Non-drive URL: return as-is
    return trimmed;
  } catch {
    return trimmed;
  }
}

function getPhotoUrl(record) {
  // Prefer photoUrl from attendance; fall back to allMembers map by UID
  let url = (record && record.photoUrl) ? record.photoUrl : '';
  if ((!url || url === '') && record && record.uid && Array.isArray(allMembers) && allMembers.length) {
    const found = allMembers.find(m => (m.uid || '').toString().trim().toUpperCase() === record.uid);
    if (found && found.photoUrl) url = found.photoUrl;
  }
  // Auto-convert Drive URLs to working format
  return normalizeDriveUrl(url);
}

// Update header photo
function updateHeaderPhoto(photoUrl) {
  const userProfileHeader = document.getElementById('userProfileHeader');
  if (!userProfileHeader || !currentUser) return;
  
  // Auto-convert Drive URLs to working format
  const normalizedUrl = normalizeDriveUrl(photoUrl);
  const initial = currentUser.name ? currentUser.name[0].toUpperCase() : '?';
  const userName = currentUser.isAdmin ? `${currentUser.name} (ADMIN)` : currentUser.name;
  
  let photoHTML = '';
  if (normalizedUrl) {
    photoHTML = `
      <div class="profile-photo-container">
        <img 
          src="${normalizedUrl}" 
          alt="${currentUser.name}" 
          class="profile-photo"
          loading="lazy"
          referrerpolicy="no-referrer"
          onerror="this.style.display='none'; this.parentElement.innerHTML='<div class=\\'profile-placeholder\\'>${initial}</div>'">
      </div>
    `;
  } else {
    photoHTML = `<div class="profile-placeholder">${initial}</div>`;
  }
  
  userProfileHeader.innerHTML = photoHTML + `<div class="user-name">${userName}</div>`;
}

// DOM Elements
const loginScreen = document.getElementById('loginScreen');
const dashboard = document.getElementById('dashboard');
const adminPage = document.getElementById('adminPage');
const loginForm = document.getElementById('loginForm');
const loginError = document.getElementById('loginError');
const logoutBtn = document.getElementById('logoutBtn');
const datePicker = document.getElementById('datePicker');
const refreshBtn = document.getElementById('refreshBtn');
const adminPanel = document.getElementById('adminPanel');
const attendanceBody = document.getElementById('attendanceBody');
const loadingIndicator = document.getElementById('loadingIndicator');
const emptyState = document.getElementById('emptyState');
const attendanceTable = document.getElementById('attendanceTable');

// Header and menu elements
const hamburgerBtn = document.getElementById('hamburgerBtn');
const mobileMenu = document.getElementById('mobileMenu');
const mobileLogoutBtn = document.getElementById('mobileLogoutBtn');
const mobileAboutBtn = document.getElementById('mobileAboutBtn');
const darkToggle = document.getElementById('darkToggle');
const logoBtn = document.getElementById('logoBtn');

// Modal elements
const removeMemberModal = document.getElementById('removeMemberModal');
const btnAdminControlPanel = document.getElementById('btnAdminControlPanel');
const btnCloseModal = document.getElementById('btnCloseModal');
const memberList = document.getElementById('memberList');
const memberLoading = document.getElementById('memberLoading');
const removeSuccess = document.getElementById('removeSuccess');
const removeError = document.getElementById('removeError');
const btnDownloadReport = document.getElementById('btnDownloadReport');
const btnEmailReport = document.getElementById('btnEmailReport');

// Entrance animations
function runDashboardEntranceAnimation() {
  const stats = document.querySelectorAll('.stat-card');
  const tableContainer = document.querySelector('.table-container');
  const adminPanelEl = document.getElementById('adminPanel');
  
  // Animate stats cards
  stats.forEach((stat, i) => {
    stat.style.opacity = 0;
    stat.style.transform = 'translateY(30px)';
    setTimeout(() => {
      stat.style.transition = 'opacity 0.5s ease, transform 0.5s ease';
      stat.style.opacity = 1;
      stat.style.transform = 'translateY(0)';
    }, 100 + i * 80);
  });
  
  // Animate admin panel if visible
  if (adminPanelEl && adminPanelEl.style.display !== 'none') {
    adminPanelEl.style.opacity = 0;
    adminPanelEl.style.transform = 'translateY(20px)';
    setTimeout(() => {
      adminPanelEl.style.transition = 'opacity 0.5s ease, transform 0.5s ease';
      adminPanelEl.style.opacity = 1;
      adminPanelEl.style.transform = 'translateY(0)';
    }, 400);
  }
  
  // Animate table
  if (tableContainer) {
    tableContainer.style.opacity = 0;
    tableContainer.style.transform = 'translateY(30px)';
    setTimeout(() => {
      tableContainer.style.transition = 'opacity 0.5s ease, transform 0.5s ease';
      tableContainer.style.opacity = 1;
      tableContainer.style.transform = 'translateY(0)';
    }, 500);
  }
}

// Header auto-hide on scroll: hide when scrolling down, show when scrolling up
(() => {
  const header = document.querySelector('.site-header');
  if (!header) return;
  let lastY = window.scrollY;
  let ticking = false;
  const threshold = 5; // minimal delta to act

  function update() {
    const currentY = window.scrollY;
    const delta = currentY - lastY;
    // if down and scrolled past top, hide header
    if (delta > threshold && currentY > 50) {
      header.classList.add('header-hidden');
    } else if (delta < -threshold) {
      header.classList.remove('header-hidden');
    }
    lastY = currentY;
    ticking = false;
  }

  window.addEventListener('scroll', () => {
    if (!ticking) {
      window.requestAnimationFrame(update);
      ticking = true;
    }
  }, { passive: true });
})();

// Dark mode toggle
function applyTheme(isDark) {
  const body = document.getElementById('app');
  if (isDark) {
    body.classList.add('dark');
    body.classList.remove('light');
  } else {
    body.classList.add('light');
    body.classList.remove('dark');
  }
}

// Hamburger menu toggle
if (hamburgerBtn && mobileMenu) {
  hamburgerBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const isExpanded = hamburgerBtn.getAttribute('aria-expanded') === 'true';
    hamburgerBtn.setAttribute('aria-expanded', !isExpanded);
    mobileMenu.classList.toggle('hidden');
    mobileMenu.setAttribute('aria-hidden', isExpanded);
  });
  
  // Close menu when clicking outside
  document.addEventListener('click', (e) => {
    if (!mobileMenu.contains(e.target) && !hamburgerBtn.contains(e.target)) {
      hamburgerBtn.setAttribute('aria-expanded', 'false');
      mobileMenu.classList.add('hidden');
      mobileMenu.setAttribute('aria-hidden', 'true');
    }
  });
}

// Mobile My Records button
if (document.getElementById('mobileMyRecords')) {
  document.getElementById('mobileMyRecords').addEventListener('click', () => {
    mobileMenu.classList.add('hidden');
    showMyRecords();
  });
}

// Mobile About button
if (mobileAboutBtn) {
  mobileAboutBtn.addEventListener('click', () => {
    mobileMenu.classList.add('hidden');
    showAboutModal();
  });
}

// Mobile Logout button
if (mobileLogoutBtn) {
  mobileLogoutBtn.addEventListener('click', () => {
    mobileMenu.classList.add('hidden');
    handleLogout();
  });
}

// Dark toggle handler
if (darkToggle) {
  darkToggle.addEventListener('change', (e) => {
    applyTheme(e.target.checked);
  });
}

// Login page dark toggle handler
const loginDarkToggle = document.getElementById('loginDarkToggle');
if (loginDarkToggle) {
  loginDarkToggle.addEventListener('change', (e) => {
    applyTheme(e.target.checked);
    // Sync with main dark toggle
    if (darkToggle) darkToggle.checked = e.target.checked;
  });
}

// Initialize dark mode
applyTheme(true);

// Initialize app
document.addEventListener('DOMContentLoaded', () => {
  // Check session synchronously first to avoid login flash
  const session = localStorage.getItem('attendanceSession');
  if (session) {
    try {
      currentUser = JSON.parse(session);
      // Show dashboard immediately if session exists
      loginScreen.style.display = 'none';
      dashboard.style.display = 'block';
      // Then load data asynchronously
      checkSession();
    } catch (e) {
      localStorage.removeItem('attendanceSession');
      showLogin();
    }
  } else {
    // No session - show login
    loginScreen.style.display = 'flex';
    dashboard.style.display = 'none';
  }
  
  setupEventListeners();
  setTodayDate();
});

// Setup event listeners
function setupEventListeners() {
  loginForm.addEventListener('submit', handleLogin);
  // Replace logout behaviour with 'My Records' modal
  if (logoutBtn) logoutBtn.addEventListener('click', (e) => { e.preventDefault(); showMyRecords(); });
  datePicker.addEventListener('change', loadAttendance);
  refreshBtn.addEventListener('click', () => loadAttendance(true));
  // Re-purpose this button later as "Admin Control Panel"; don't bind legacy remove-modal here
  btnCloseModal.addEventListener('click', closeRemoveMemberModal);
  btnDownloadReport.addEventListener('click', downloadReport);
  btnEmailReport.addEventListener('click', sendEmailReport);
  
  // Sign Out All button
  const btnSignOutAll = document.getElementById('btnSignOutAll');
  if (btnSignOutAll) {
    btnSignOutAll.addEventListener('click', signOutAllMembers);
  }
  
  // Admin page button listeners
  const backToAdminBtn = document.getElementById('backToAdminBtn');
  if (backToAdminBtn) {
    backToAdminBtn.addEventListener('click', showDashboard);
  }
  
  const addMemberCard = document.getElementById('addMemberCard');
  if (addMemberCard) {
    addMemberCard.querySelector('button').addEventListener('click', showAddMemberModal);
  }
  
  const removeMemberCard = document.getElementById('removeMemberCard');
  if (removeMemberCard) {
    removeMemberCard.querySelector('button').addEventListener('click', showRemoveMemberModalAdmin);
  }
  
  const resetDataCard = document.getElementById('resetDataCard');
  if (resetDataCard) {
    resetDataCard.querySelector('button').addEventListener('click', showResetDataModal);
  }
  
  const viewMembersCard = document.getElementById('viewMembersCard');
  if (viewMembersCard) {
    viewMembersCard.querySelector('button').addEventListener('click', showAllMembersView);
  }
  
  const resetTodayOutCard = document.getElementById('resetTodayOutCard');
  if (resetTodayOutCard) {
    resetTodayOutCard.querySelector('button').addEventListener('click', showResetTodayOutModal);
  }
  
  const webAccessCard = document.getElementById('webAccessCard');
  if (webAccessCard) {
    webAccessCard.querySelector('button').addEventListener('click', showWebAccessModal);
  }

  // Edit Member card
  const editMemberCard = document.getElementById('editMemberCard');
  if (editMemberCard) {
    editMemberCard.querySelector('button').addEventListener('click', showEditMemberModal);
  }

  // Edit Position card
  const editPositionCard = document.getElementById('editPositionCard');
  if (editPositionCard) {
    editPositionCard.querySelector('button').addEventListener('click', showEditPositionModal);
  }
  
  // Web attendance buttons
  const btnWebSignIn = document.getElementById('btnWebSignIn');
  const btnWebSignOut = document.getElementById('btnWebSignOut');
  if (btnWebSignIn) {
    btnWebSignIn.addEventListener('click', performWebSignIn);
  }
  if (btnWebSignOut) {
    btnWebSignOut.addEventListener('click', performWebSignOut);
  }
  
  // Admin Control Panel button - navigate to admin page
  if (btnAdminControlPanel) {
    btnAdminControlPanel.onclick = showAdminPage;
  }
  
  // Logo button - navigate to dashboard/main page
  if (logoBtn) {
    logoBtn.addEventListener('click', () => {
      if (currentUser) {
        showDashboard();
      }
    });
  }
  
  // Close modal when clicking outside
  removeMemberModal.addEventListener('click', (e) => {
    if (e.target === removeMemberModal) {
      closeRemoveMemberModal();
    }
  });
  
  // Mobile menu - Change Password
  const mobileChangePassword = document.getElementById('mobileChangePassword');
  if (mobileChangePassword) {
    mobileChangePassword.addEventListener('click', () => {
      // Close mobile menu
      mobileMenu.classList.add('hidden');
      mobileMenu.setAttribute('aria-hidden', 'true');
      hamburgerBtn.classList.remove('is-active');
      hamburgerBtn.setAttribute('aria-expanded', 'false');
      // Show change password modal
      showChangePasswordModal();
    });
  }

  // Mobile menu - Update Photo
  const mobileUpdatePhoto = document.getElementById('mobileUpdatePhoto');
  if (mobileUpdatePhoto) {
    mobileUpdatePhoto.addEventListener('click', () => {
      // Close mobile menu
      mobileMenu.classList.add('hidden');
      mobileMenu.setAttribute('aria-hidden', 'true');
      hamburgerBtn.classList.remove('is-active');
      hamburgerBtn.setAttribute('aria-expanded', 'false');
      // Show update photo modal
      showUpdatePhotoModal();
    });
  }

  // Mobile menu - Edit My Name (no position change)
  const mobileEditMyName = document.getElementById('mobileEditMyName');
  if (mobileEditMyName) {
    mobileEditMyName.addEventListener('click', () => {
      mobileMenu.classList.add('hidden');
      mobileMenu.setAttribute('aria-hidden', 'true');
      hamburgerBtn.classList.remove('is-active');
      hamburgerBtn.setAttribute('aria-expanded', 'false');
      showEditMyNameModal();
    });
  }
  
  // Change password modal buttons
  const btnCloseChangePasswordModal = document.getElementById('btnCloseChangePasswordModal');
  const btnChangePassword = document.getElementById('btnChangePassword');
  if (btnCloseChangePasswordModal) {
    btnCloseChangePasswordModal.addEventListener('click', closeChangePasswordModal);
  }
  if (btnChangePassword) {
    btnChangePassword.addEventListener('click', handleChangePassword);
  }

  // Update photo modal buttons
  const btnCloseUpdatePhotoModal = document.getElementById('btnCloseUpdatePhotoModal');
  const btnUpdatePhoto = document.getElementById('btnUpdatePhoto');
  if (btnCloseUpdatePhotoModal) {
    btnCloseUpdatePhotoModal.addEventListener('click', closeUpdatePhotoModal);
  }
  if (btnUpdatePhoto) {
    btnUpdatePhoto.addEventListener('click', handleUpdatePhoto);
  }
  
  // Change password modal - close when clicking outside
  const changePasswordModal = document.getElementById('changePasswordModal');
  if (changePasswordModal) {
    changePasswordModal.addEventListener('click', (e) => {
      if (e.target === changePasswordModal) {
        closeChangePasswordModal();
      }
    });
  }

  // Update photo modal - close when clicking outside
  const updatePhotoModal = document.getElementById('updatePhotoModal');
  if (updatePhotoModal) {
    updatePhotoModal.addEventListener('click', (e) => {
      if (e.target === updatePhotoModal) {
        closeUpdatePhotoModal();
      }
    });
  }
}

// Set today's date in date picker
function setTodayDate() {
  const today = new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, '0');
  const day = String(today.getDate()).padStart(2, '0');
  datePicker.value = `${year}-${month}-${day}`;
}

// Utility: normalize spreadsheet truthy values to boolean
function toBool(v) {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  const s = (v || '').toString().trim().toLowerCase();
  return s === 'true' || s === 'yes' || s === 'y' || s === '1';
}

// Check for existing session
async function checkSession() {
  const session = localStorage.getItem('attendanceSession');
  if (session) {
    try {
      currentUser = JSON.parse(session);
      console.log('Session restored:', currentUser); // Debug log
      
      // Refresh user data from server to get latest status/name/photo
      try {
        const response = await fetch(`${API_URL}?action=list_people`);
        const data = await response.json();
        const admins = (data.admins || []).map(a => ({...a, uid: (a.uid||'').toString().trim().toUpperCase(), isAdmin:true}));
        const members = (data.members || []).map(m => ({...m, uid: (m.uid||'').toString().trim().toUpperCase(), isAdmin:false}));
        const person = [...admins, ...members].find(p => p.uid === currentUser.uid);
        if (person) {
          currentUser.name = person.name || currentUser.name;
          const _pos = (person.position || '').toString().trim().toLowerCase();
          const isAdminByPosition = (_pos === 'admin' || _pos === 'super admin');
          currentUser.isAdmin = !!person.isAdmin || isAdminByPosition;
          currentUser.hasWebAccess = toBool(person.webAccess);
          currentUser.photoUrl = person.photoUrl || currentUser.photoUrl;
          currentUser.position = person.position || currentUser.position || '';
          localStorage.setItem('attendanceSession', JSON.stringify(currentUser));
        }
      } catch (error) {
        console.error('Error refreshing user data:', error);
      }
      
      // Dashboard already visible from DOMContentLoaded - just load data
      showDashboard();
    } catch (e) {
      console.error('Session parse error:', e); // Debug log
      localStorage.removeItem('attendanceSession');
      showLogin();
    }
  }
}

// Handle login
async function handleLogin(e) {
  e.preventDefault();
  
  const uid = document.getElementById('username').value.trim().toUpperCase();
  const password = document.getElementById('password').value;
  
  // Hide previous errors
  loginError.textContent = '';
  loginError.style.display = 'none';
  
  // Disable login button
  const loginBtn = document.getElementById('loginBtn');
  loginBtn.disabled = true;
  loginBtn.textContent = 'Logging in...';
  
  try {
    // Begin a fresh session to cancel any old requests and timers
    bumpSession();
    // Validate password with backend (pass UID so per-user password is enforced)
    const passwordResponse = await fetch(`${API_URL}?action=verify_password&uid=${encodeURIComponent(uid)}&password=${encodeURIComponent(password)}`);
    const passwordData = await passwordResponse.json();
    
    if (!passwordData.success) {
      throw new Error('Invalid password!');
    }
    
    // Fetch people (admins + members) to resolve identity and roles
    const response = await fetch(`${API_URL}?action=list_people`);
    const data = await response.json();

    const admins = (data.admins || []).map(a => ({...a, uid: (a.uid||'').toString().trim().toUpperCase(), isAdmin: true, webAccess: toBool(a.webAccess)}));
    const members = (data.members || []).map(m => ({...m, uid: (m.uid||'').toString().trim().toUpperCase(), isAdmin: false, webAccess: toBool(m.webAccess)}));

    const person = [...admins, ...members].find(p => p.uid === uid);
    if (!person) {
      throw new Error('UID not found! Please check your card number.');
    }

    // Determine website admin access: either in Admins sheet OR position is Admin/Super Admin
    const _pos = (person.position || '').toString().trim().toLowerCase();
    const isAdminByPosition = (_pos === 'admin' || _pos === 'super admin');

    // Login successful
    currentUser = {
      uid: uid,
      name: person.name,
      isAdmin: person.isAdmin === true || isAdminByPosition,
      hasWebAccess: toBool(person.webAccess),
      photoUrl: person.photoUrl || '',
      position: person.position || ''
    };

    // Save session
    localStorage.setItem('attendanceSession', JSON.stringify(currentUser));
    
    // Show dashboard
    showDashboard();
    
  } catch (error) {
    loginError.textContent = error.message;
    loginError.style.display = 'block';
    // Add shake animation
    loginError.classList.add('shake');
    setTimeout(() => loginError.classList.remove('shake'), 500);
  } finally {
    loginBtn.disabled = false;
    loginBtn.textContent = 'Login';
  }
}

// Handle logout
function handleLogout() {
  if (confirm('Are you sure you want to logout?')) {
    // Bump session and cancel all in-flight fetches to avoid stale updates
    bumpSession();
    localStorage.removeItem('attendanceSession');
    currentUser = null;
    clearAutoRefresh();
    // Clear caches and UI fragments to avoid previous user flashing on next login
    try {
      allMembers = [];
      currentAttendance = [];
      const userProfileHeader = document.getElementById('userProfileHeader');
      if (userProfileHeader) userProfileHeader.innerHTML = '';
      if (attendanceBody) attendanceBody.innerHTML = '';
      if (attendanceTable) attendanceTable.style.display = 'none';
      if (emptyState) emptyState.style.display = 'flex';
    } catch {}
    showLogin();
  }
}

// Show login screen
function showLogin() {
  showPageLoading();
  
  setTimeout(() => {
    loginScreen.style.display = 'flex';
    dashboard.style.display = 'none';
    adminPage.style.display = 'none';
    document.getElementById('username').value = '';
    document.getElementById('password').value = '';
    loginError.textContent = '';
    loginError.style.display = 'none';
    // Hide header on login screen
    const header = document.querySelector('.site-header');
    if (header) header.style.display = 'none';
    
    // Sync login dark mode toggle with current theme
    const body = document.getElementById('app');
    const isDark = body.classList.contains('dark');
    const loginDarkToggle = document.getElementById('loginDarkToggle');
    if (loginDarkToggle) loginDarkToggle.checked = isDark;
    
    hidePageLoading();
  }, 100);
}

// Show dashboard
function showDashboard() {
  
  loginScreen.style.display = 'none';
  adminPage.style.display = 'none';
  dashboard.style.display = 'block';
  
  // Show header on dashboard
  const header = document.querySelector('.site-header');
  if (header) header.style.display = 'block';
  
  // Sync dark mode toggle with current theme
  const body = document.getElementById('app');
  const isDark = body.classList.contains('dark');
  if (darkToggle) darkToggle.checked = isDark;
  
  // Set user name and photo in header
  const userProfileHeader = document.getElementById('userProfileHeader');
  const userName = document.getElementById('userName');
  
  if (userName) {
    userName.textContent = currentUser.isAdmin ? `${currentUser.name} (ADMIN)` : currentUser.name;
  }
  
  // Add user photo to header
  if (userProfileHeader && currentUser) {
    const photoUrl = getPhotoUrl({ uid: currentUser.uid, photoUrl: currentUser.photoUrl });
    const initial = currentUser.name ? currentUser.name[0].toUpperCase() : '?';
    
    let photoHTML = '';
    if (photoUrl) {
      photoHTML = `
        <div class="profile-photo-container">
          <img 
            src="${photoUrl}" 
            alt="${currentUser.name}" 
            class="profile-photo"
            loading="lazy"
            referrerpolicy="no-referrer"
            onerror="this.style.display='none'; this.parentElement.innerHTML='<div class=\\'profile-placeholder\\'>${initial}</div>'">
        </div>
      `;
    } else {
      photoHTML = `<div class="profile-placeholder">${initial}</div>`;
    }
    
    userProfileHeader.innerHTML = photoHTML + `<div class="user-name" id="userName">${userName.textContent}</div>`;
  }
  
  // Show admin panel for all users, but customize title and button visibility
  adminPanel.style.display = 'block';
  
  const adminPanelTitle = document.getElementById('adminPanelTitle');
  const btnAdminControlPanel = document.getElementById('btnAdminControlPanel');
  
  if (currentUser.isAdmin) {
    // Admin sees full controls
    adminPanelTitle.textContent = '⚙️ Admin Controls';
    btnAdminControlPanel.style.display = 'inline-block';
  } else {
    // Regular faculty sees only data functions
    adminPanelTitle.textContent = '📊 GET DATA';
    btnAdminControlPanel.style.display = 'none';
  }
  
  // Hide web attendance buttons initially to prevent flash during load
  const btnWebSignIn = document.getElementById('btnWebSignIn');
  const btnWebSignOut = document.getElementById('btnWebSignOut');
  if (btnWebSignIn) btnWebSignIn.style.display = 'none';
  if (btnWebSignOut) btnWebSignOut.style.display = 'none';
  
  // Load initial data with robust loading control
  withLoading('initial-load', async () => {
    await Promise.all([
      loadMembers(),
      loadAttendance(false, true)
    ]);
  });
  
  // Run entrance animations
  setTimeout(() => runDashboardEntranceAnimation(), 100);
  
  // Setup auto-refresh (every 30 seconds for real-time updates)
  clearAutoRefresh();
  autoRefreshInterval = setInterval(() => {
    loadAttendance(false, false); // Silent refresh: no notification, no loading spinner
  }, 30000); // 30000ms = 30 seconds
}

// Show admin page
function showAdminPage() {
  if (!currentUser || !currentUser.isAdmin) {
    showNotification('Access denied. Admin only.', 'error');
    return;
  }
  
  showPageLoading();
  
  setTimeout(() => {
    loginScreen.style.display = 'none';
    dashboard.style.display = 'none';
    adminPage.style.display = 'block';
    
    // Show header on admin page
    const header = document.querySelector('.site-header');
    if (header) header.style.display = 'block';
    
    // Set admin user name
    document.getElementById('adminUserName').textContent = currentUser.isAdmin ? `${currentUser.name} (ADMIN)` : currentUser.name;
    
    // Load members for admin page
    loadMembers().then(() => {
      hidePageLoading();
    }).catch(() => {
      hidePageLoading();
    });
  }, 100);
}

// Clear auto-refresh interval
function clearAutoRefresh() {
  if (autoRefreshInterval) {
    clearInterval(autoRefreshInterval);
    autoRefreshInterval = null;
  }
}

// Load all people (admins + members) using list_people
async function loadMembers() {
  const localNonce = appSessionNonce;
  try {
    const response = await fetchWithTimeout(`${API_URL}?action=list_people`, {}, 10000);
    const data = await response.json();
    const admins = (data.admins || []).map(a => ({
      uid: (a.uid || '').toString().trim().toUpperCase(),
      name: a.name || '',
      webAccess: toBool(a.webAccess),
      photoUrl: a.photoUrl || '',
      position: a.position || '',
      isAdmin: true,
    }));
    const members = (data.members || []).map(m => ({
      uid: (m.uid || '').toString().trim().toUpperCase(),
      name: m.name || '',
      webAccess: toBool(m.webAccess),
      photoUrl: m.photoUrl || '',
      position: m.position || '',
      isAdmin: false,
    }));
    // Merge for quick lookup
    if (localNonce !== appSessionNonce) return; // stale, ignore
    allMembers = [...admins, ...members];
    updateMemberStats();

    // Refresh header photo now that members cache is loaded
    if (localNonce !== appSessionNonce) return;
    if (currentUser) {
      const resolvedPhotoUrl = getPhotoUrl({ uid: currentUser.uid, photoUrl: currentUser.photoUrl });
      updateHeaderPhoto(resolvedPhotoUrl);
    }
  } catch (error) {
    console.error('Error loading people:', error);
  }
}

// Load attendance data
async function loadAttendance(showRefreshMessage = false, showLoading = true) {
  const localNonce = appSessionNonce;
  const selectedDate = datePicker.value;
  
  // Show loading spinner only if not a background refresh
  if (showLoading) {
    loadingIndicator.style.display = 'flex';
    attendanceTable.style.display = 'none';
    emptyState.style.display = 'none';
  }
  
  try {
  const response = await fetchWithTimeout(`${API_URL}?action=get_today_attendance&date=${selectedDate}`, {}, 10000);
    const data = await response.json();
    if (localNonce !== appSessionNonce) return; // session switched
    currentAttendance = data.attendance || [];
    // Inject web access flag per record for downstream permission checks
    if (Array.isArray(currentAttendance) && allMembers && allMembers.length) {
      const accessMap = new Map();
      allMembers.forEach(m => {
        const k = (m.uid || '').toString().trim().toUpperCase();
        if (k) accessMap.set(k, toBool(m.webAccess));
      });
      currentAttendance = currentAttendance.map(r => {
        const k = (r.uid || '').toString().trim().toUpperCase();
        return { ...r, hasWebAccess: accessMap.get(k) === true };
      });
    }
    // Fallback enrichment: if some records lack photoUrl, try merging from allMembers
    if (Array.isArray(currentAttendance) && currentAttendance.some(r => !r.photoUrl)) {
      try {
        const map = new Map();
        (allMembers || []).forEach(m => {
          const k = (m.uid || '').toString().trim().toUpperCase();
          if (k) map.set(k, m.photoUrl || '');
        });
        currentAttendance = currentAttendance.map(r => {
          if (!r.photoUrl) {
            const k = (r.uid || '').toString().trim().toUpperCase();
            const fromMember = map.get(k) || '';
            if (fromMember) return { ...r, photoUrl: fromMember };
          }
          return r;
        });
      } catch (e) {
        console.warn('Photo enrichment skipped:', e);
      }
    }
    
    // Update UI
    if (localNonce !== appSessionNonce) return;
    displayAttendance();
    updateStats();
    updateWebAttendanceStatus(); // Update button visibility based on new data & permissions
    
    if (showRefreshMessage) {
      showNotification('Attendance data refreshed!', 'success');
    }
    
  } catch (error) {
    console.error('Error loading attendance:', error);
    if (showLoading) {
      showNotification('Failed to load attendance data', 'error');
      emptyState.style.display = 'flex';
    }
  } finally {
    if (showLoading) {
      loadingIndicator.style.display = 'none';
    }
  }
}

// Display attendance in table
function displayAttendance() {
  attendanceBody.innerHTML = '';
  const btnSignOutAll = document.getElementById('btnSignOutAll');
  
  if (currentAttendance.length === 0) {
    attendanceTable.style.display = 'none';
    emptyState.style.display = 'flex';
    if (btnSignOutAll) btnSignOutAll.style.display = 'none';
    return;
  }
  
  attendanceTable.style.display = 'table';
  emptyState.style.display = 'none';
  
  // Check if there are any checked-in members (has inTime but no outTime)
  const checkedInMembers = currentAttendance.filter(record => 
    record.inTime && record.inTime !== '-' && (!record.outTime || record.outTime === '-') && record.hasWebAccess === true
  );
  
  // Show "Sign Out All" button only if there are checked-in members and user is in Admin sheet
  if (btnSignOutAll) {
    // Check if user is in Admin sheet (not just by position)
    const uid = (currentUser.uid || '').toString().trim().toUpperCase();
    const isInAdminSheet = !!(allMembers || []).find(m => 
      m.uid === uid && m.isAdmin === true
    );
    if (isInAdminSheet && checkedInMembers.length > 0) {
      btnSignOutAll.style.display = 'block';
    } else {
      btnSignOutAll.style.display = 'none';
    }
  }
  
  // Build a UID -> position map for quick lookup
  const posMap = new Map();
  (allMembers || []).forEach(m => {
    const k = (m.uid || '').toString().trim().toUpperCase();
    if (k) posMap.set(k, m.position || '');
  });

  currentAttendance.forEach((record, index) => {
    const row = document.createElement('tr');
    
    // Add staggered animation
    row.style.opacity = 0;
    row.style.transform = 'translateY(20px)';
    setTimeout(() => {
      row.style.transition = 'opacity 0.4s ease, transform 0.4s ease';
      row.style.opacity = 1;
      row.style.transform = 'translateY(0)';
    }, index * 50);
    
      // Determine status
      let status = '';
      let statusClass = '';
      if (record.inTime && record.outTime) {
        status = 'Complete';
        statusClass = 'complete';
      } else if (record.inTime && !record.outTime) {
        status = 'Checked In';
        statusClass = 'in';
      } else if (!record.inTime && record.outTime) {
        status = 'Checked Out';
        statusClass = 'out';
      }
    
      // Create profile photo HTML
    const photoUrl = getPhotoUrl(record);
    const initial = (record.name || '?').charAt(0).toUpperCase();
    const photoHTML = photoUrl
      ? `<img src="${photoUrl}" alt="${record.name}" class="profile-photo" loading="lazy" referrerpolicy="no-referrer" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';">
        <div class="profile-placeholder" style="display:none;">${initial}</div>`
      : `<div class="profile-placeholder">${initial}</div>`;

    const uidKey = (record.uid || '').toString().trim().toUpperCase();
    const position = posMap.get(uidKey) || '';
    const nameBlock = `
      <div style="display:flex; flex-direction:column; gap:2px;">
        <span>${record.name || '-'}</span>
        ${position ? `<span style="font-size:12px; color: var(--muted);">${position}</span>` : ''}
      </div>`;
    
      row.innerHTML = `
        <td data-label="Name">
          <div style="display: flex; align-items: center; gap: 12px;">
            <div class="profile-photo-container">
              ${photoHTML}
            </div>
            ${nameBlock}
          </div>
        </td>
        <td data-label="Date">${record.date || '-'}</td>
        <td data-label="In Time">${record.inTime || '-'}</td>
        <td data-label="Out Time">${record.outTime || '-'}</td>
        <td data-label="Status"><span class="status-badge ${statusClass}">${status}</span></td>
      `;
    
    attendanceBody.appendChild(row);
  });
}

// Show current user's records in a modal (today's records filtered by UID/name)
async function showMyRecords() {
  if (!currentUser) { showNotification('Not logged in', 'error'); return; }
  // Ensure attendance data is fresh for selected date
  await loadAttendance(false);

  const myRecords = (currentAttendance || []).filter(r => {
    try { return (r.uid && r.uid.toString().trim().toUpperCase() === currentUser.uid) || (r.name && r.name === currentUser.name); } catch (e) { return false; }
  });

  // Build modal content
  let modal = document.getElementById('myRecordsModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'myRecordsModal';
    modal.className = 'modal';
    modal.innerHTML = `
      <div class="modal-content" style="max-width: 700px; background: var(--card); color: var(--text);">
        <div class="modal-header" style="color: var(--text);">
          <h2 style="color: var(--text);">📄 My Records</h2>
        </div>
        <div class="modal-body" style="text-align: left; max-height: 500px; overflow-y: auto;">
          <div style="margin-bottom: 15px; display: flex; align-items: center; gap: 10px;">
            <label style="color: var(--text); font-weight: 600;">Select Month:</label>
            <input type="month" id="myRecordsMonthPicker" style="
              padding: 8px 12px;
              border-radius: 8px;
              border: 1px solid rgba(102, 126, 234, 0.3);
              background: var(--bg);
              color: var(--text);
              font-size: 14px;
              cursor: pointer;
            ">
          </div>
          <div id="myRecordsLoading" style="text-align: center; padding: 40px; display: none;">
            <div class="spinner" style="margin: 0 auto 10px;"></div>
            <p style="color: var(--muted);">Loading records...</p>
          </div>
          <div id="myRecordsBody"></div>
        </div>
        <div class="modal-footer">
          <button class="btn-modal" id="closeMyRecordsBtn">Close</button>
        </div>
      </div>`;
    document.body.appendChild(modal);
    // close handlers
    modal.addEventListener('click', (e) => { if (e.target === modal) { modal.style.display = 'none'; } });
  }

  // Set default month to current month
  const monthPicker = document.getElementById('myRecordsMonthPicker');
  if (monthPicker) {
    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, '0');
    monthPicker.value = `${year}-${month}`;
    
    // Add change event listener
    monthPicker.onchange = () => {
      loadMyRecordsForMonth(monthPicker.value);
    };
  }

  // Load initial records
  loadMyRecordsForMonth(monthPicker.value);

  // show modal
  modal.style.display = 'flex';
  // attach close button
  const closeBtn = document.getElementById('closeMyRecordsBtn');
  if (closeBtn) closeBtn.onclick = () => { modal.style.display = 'none'; };
}

// Load My Records for a specific month
async function loadMyRecordsForMonth(yearMonth) {
  const bodyEl = document.getElementById('myRecordsBody');
  const loadingEl = document.getElementById('myRecordsLoading');
  
  if (!bodyEl || !currentUser) return;
  
  // Show loading
  loadingEl.style.display = 'block';
  bodyEl.innerHTML = '';
  
  try {
    // Parse year-month (format: "2025-11")
    const [year, month] = yearMonth.split('-');
    const monthName = new Date(year, parseInt(month) - 1).toLocaleString('default', { month: 'long', year: 'numeric' });
    
    // Fetch all attendance for this month
    const response = await fetch(`${API_URL}?action=get_monthly_attendance&year=${year}&month=${month}&uid=${currentUser.uid}`);
    const data = await response.json();
    
    loadingEl.style.display = 'none';
    
    // Filter records for current user
    const userRecordsRaw = (data.attendance || []).filter(r => 
      r.uid && r.uid.toString().trim().toUpperCase() === currentUser.uid.toString().trim().toUpperCase()
    );
    // Enrich with photo URL fallback & normalization
    const userRecords = userRecordsRaw.map(r => ({ ...r, photoUrl: getPhotoUrl(r) }));
    
    if (userRecords.length === 0) {
      bodyEl.innerHTML = `
        <div style="text-align: center; padding: 40px 20px; color: var(--muted);">
          <p style="font-size: 14px; margin-top: 10px;">No attendance records found for ${monthName}.</p>
        </div>
      `;
      return;
    }
    
    // Display records in table format
    const tableHTML = `
      <div style="background: rgba(102, 126, 234, 0.05); border-radius: 8px; padding: 15px; margin-bottom: 15px;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
          <div style="display:flex; align-items:center; gap:12px;">
            <div class="profile-photo-container" style="width:48px; height:48px;">
              ${currentUser && userRecords[0] && userRecords[0].photoUrl ? `<img src="${userRecords[0].photoUrl}" alt="${currentUser.name}" class="profile-photo" style="width:48px; height:48px;" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';">` : ''}
              ${(!userRecords[0] || !userRecords[0].photoUrl) ? `<div class="profile-placeholder" style="width:48px; height:48px; font-size:18px;">${(currentUser.name||'?').charAt(0).toUpperCase()}</div>` : `<div class="profile-placeholder" style="display:none; width:48px; height:48px; font-size:18px;">${(currentUser.name||'?').charAt(0).toUpperCase()}</div>`}
            </div>
            <div style="display:flex; flex-direction:column; gap:2px;">
              <strong style="color: var(--text); font-size: 16px;">${currentUser.name}</strong>
              ${(() => { const m = (allMembers||[]).find(x => (x.uid||'').toString().trim().toUpperCase() === currentUser.uid); const p = m && m.position ? m.position : ''; return p ? `<span style=\"font-size:12px; color: var(--muted);\">${p}</span>` : ''; })()}
            </div>
          </div>
          <span style="color: var(--muted); font-size: 13px;">${monthName}</span>
        </div>
      </div>
      
      <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
        <thead>
          <tr style="background: rgba(102, 126, 234, 0.1); border-bottom: 2px solid rgba(102, 126, 234, 0.2);">
            <th style="padding: 12px 8px; text-align: left; color: var(--text); font-weight: 600;">DATE</th>
            <th style="padding: 12px 8px; text-align: left; color: var(--text); font-weight: 600;">CHECK IN</th>
            <th style="padding: 12px 8px; text-align: left; color: var(--text); font-weight: 600;">CHECK OUT</th>
            <th style="padding: 12px 8px; text-align: center; color: var(--text); font-weight: 600;">STATUS</th>
          </tr>
        </thead>
        <tbody>
          ${userRecords.map((r, index) => {
            const status = (r.inTime && r.outTime) ? 'Complete' : (r.inTime ? 'Checked In' : 'Pending');
            const statusColor = (r.inTime && r.outTime) ? 'var(--success-color)' : (r.inTime ? 'var(--info-color)' : 'var(--warning-color)');
            const bgColor = index % 2 === 0 ? 'transparent' : 'rgba(102, 126, 234, 0.03)';
            const photoUrl = getPhotoUrl(r);
            
            return `
              <tr style="background: ${bgColor}; border-bottom: 1px solid rgba(102, 126, 234, 0.1);">
                <td style="padding: 12px 8px; color: var(--text);">
                  <div style="display:flex; align-items:center; gap:10px;">
                    <div class="profile-photo-container" style="width:36px; height:36px;">
                      ${photoUrl ? `<img src="${photoUrl}" alt="${currentUser.name}" class="profile-photo" style="width:36px; height:36px;" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';">` : ''}
                      ${!photoUrl ? `<div class="profile-placeholder" style="width:36px; height:36px; font-size:14px;">${(currentUser.name||'?').charAt(0).toUpperCase()}</div>` : `<div class="profile-placeholder" style="display:none; width:36px; height:36px; font-size:14px;">${(currentUser.name||'?').charAt(0).toUpperCase()}</div>`}
                    </div>
                    <span>${r.date || '—'}</span>
                  </div>
                </td>
                <td style="padding: 12px 8px; color: var(--text);">${r.inTime || '—'}</td>
                <td style="padding: 12px 8px; color: var(--text);">${r.outTime || '—'}</td>
                <td style="padding: 12px 8px; text-align: center;">
                  <span style="
                    display: inline-block;
                    padding: 4px 10px;
                    border-radius: 12px;
                    font-size: 11px;
                    font-weight: 600;
                    background: ${statusColor}15;
                    color: ${statusColor};
                  ">${status}</span>
                </td>
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>
      
      <div style="margin-top: 15px; padding: 10px; background: rgba(102, 126, 234, 0.05); border-radius: 8px; font-size: 12px; color: var(--muted);">
        <strong style="color: var(--text);">Total Records:</strong> ${userRecords.length}
      </div>
    `;
    
    bodyEl.innerHTML = tableHTML;
    
  } catch (error) {
    loadingEl.style.display = 'none';
    bodyEl.innerHTML = `
      <div style="text-align: center; padding: 40px 20px; color: var(--danger-color);">
        <p>Error loading records: ${error.message}</p>
      </div>
    `;
  }
}

// ================ CHANGE PASSWORD FUNCTIONS ================

// Show Change Password Modal
function showChangePasswordModal() {
  const modal = document.getElementById('changePasswordModal');
  const form = document.getElementById('changePasswordForm');
  const successMsg = document.getElementById('changePasswordSuccess');
  const errorMsg = document.getElementById('changePasswordError');
  
  // Reset form and messages
  if (form) form.reset();
  if (successMsg) {
    successMsg.textContent = '';
    successMsg.style.display = 'none';
  }
  if (errorMsg) {
    errorMsg.textContent = '';
    errorMsg.style.display = 'none';
  }
  
  // Show modal
  if (modal) modal.style.display = 'flex';
}

// Close Change Password Modal
function closeChangePasswordModal() {
  const modal = document.getElementById('changePasswordModal');
  if (modal) modal.style.display = 'none';
}

// Handle Change Password
async function handleChangePassword(e) {
  e.preventDefault();
  
  const currentPassword = document.getElementById('currentPassword').value;
  const newPassword = document.getElementById('newPassword').value;
  const confirmPassword = document.getElementById('confirmPassword').value;
  const successMsg = document.getElementById('changePasswordSuccess');
  const errorMsg = document.getElementById('changePasswordError');
  const btnChangePassword = document.getElementById('btnChangePassword');
  
  // Hide previous messages
  if (successMsg) {
    successMsg.textContent = '';
    successMsg.style.display = 'none';
  }
  if (errorMsg) {
    errorMsg.textContent = '';
    errorMsg.style.display = 'none';
  }
  
  // Validate inputs
  if (!currentPassword || !newPassword || !confirmPassword) {
    if (errorMsg) {
      errorMsg.textContent = 'All fields are required!';
      errorMsg.style.display = 'block';
    }
    return;
  }
  
  if (newPassword.length < 6) {
    if (errorMsg) {
      errorMsg.textContent = 'New password must be at least 6 characters!';
      errorMsg.style.display = 'block';
    }
    return;
  }
  
  if (newPassword !== confirmPassword) {
    if (errorMsg) {
      errorMsg.textContent = 'New passwords do not match!';
      errorMsg.style.display = 'block';
    }
    return;
  }
  
  // Disable button
  if (btnChangePassword) {
    btnChangePassword.disabled = true;
    btnChangePassword.textContent = 'Changing...';
  }
  
  try {
    // Call backend to change password (pass UID of logged-in user)
    let response = await fetch(
      `${API_URL}?action=change_password&uid=${encodeURIComponent(currentUser.uid)}&currentPassword=${encodeURIComponent(currentPassword)}&newPassword=${encodeURIComponent(newPassword)}`
    );
    let data = await response.json();

    // If admin gets "user not found", retry with explicit admin role/action fallbacks
    if (!data.success && currentUser && currentUser.isAdmin) {
      const msg = (data.message || '').toString().toLowerCase();
      if (msg.includes('user not found') || msg.includes('not found')) {
        // Fallback 1: role=admin hint
        try {
          response = await fetch(
            `${API_URL}?action=change_password&uid=${encodeURIComponent(currentUser.uid)}&currentPassword=${encodeURIComponent(currentPassword)}&newPassword=${encodeURIComponent(newPassword)}&role=admin`
          );
          data = await response.json();
        } catch (_) {}

        // Fallback 2: alternative action name sometimes used by scripts
        if (!data.success) {
          try {
            response = await fetch(
              `${API_URL}?action=change_admin_password&uid=${encodeURIComponent(currentUser.uid)}&currentPassword=${encodeURIComponent(currentPassword)}&newPassword=${encodeURIComponent(newPassword)}`
            );
            data = await response.json();
          } catch (_) {}
        }
      }
    }

    if (data.success) {
      // Show success message
      if (successMsg) {
        successMsg.textContent = data.message || 'Password changed successfully!';
        successMsg.style.display = 'block';
      }
      
      // Clear form
      const form = document.getElementById('changePasswordForm');
      if (form) form.reset();
      
      // Close modal after 2 seconds
      setTimeout(() => {
        closeChangePasswordModal();
        showNotification('Password changed successfully!', 'success');
      }, 2000);
      
    } else {
      // Show error message
      if (errorMsg) {
        errorMsg.textContent = data.message || 'Failed to change password';
        errorMsg.style.display = 'block';
      }
    }
    
  } catch (error) {
    console.error('Change password error:', error);
    if (errorMsg) {
      errorMsg.textContent = 'Failed to change password. Please try again.';
      errorMsg.style.display = 'block';
    }
  } finally {
    // Re-enable button
    if (btnChangePassword) {
      btnChangePassword.disabled = false;
      btnChangePassword.textContent = 'Change Password';
    }
  }
}

// ================ UPDATE PHOTO FUNCTIONS ================

// Show Update Photo Modal
function showUpdatePhotoModal() {
  const modal = document.getElementById('updatePhotoModal');
  const form = document.getElementById('updatePhotoForm');
  const successMsg = document.getElementById('updatePhotoSuccess');
  const errorMsg = document.getElementById('updatePhotoError');
  const photoUrlInput = document.getElementById('photoUrl');
  const currentPhotoDisplay = document.getElementById('currentPhotoDisplay');
  
  // Reset form and messages
  if (form) form.reset();
  if (successMsg) {
    successMsg.textContent = '';
    successMsg.style.display = 'none';
  }
  if (errorMsg) {
    errorMsg.textContent = '';
    errorMsg.style.display = 'none';
  }
  
  // Load current photo
  if (currentUser && currentPhotoDisplay) {
    const photoUrl = getPhotoUrl({ uid: currentUser.uid, photoUrl: currentUser.photoUrl });
    const initial = currentUser.name ? currentUser.name[0].toUpperCase() : '?';
    
    if (photoUrl) {
      currentPhotoDisplay.innerHTML = `
        <div class="profile-photo-container">
          <img 
            src="${photoUrl}" 
            alt="${currentUser.name}" 
            class="profile-photo"
            loading="lazy"
            referrerpolicy="no-referrer"
            onerror="this.style.display='none'; this.parentElement.innerHTML='<div class=\\'profile-placeholder\\'>${initial}</div>'">
        </div>
      `;
    } else {
      currentPhotoDisplay.innerHTML = `<div class="profile-placeholder">${initial}</div>`;
    }
    
    // Pre-fill with current photo URL if exists
    if (currentUser.photoUrl && photoUrlInput) {
      photoUrlInput.value = currentUser.photoUrl;
    }
  }
  
  // Show modal
  if (modal) modal.style.display = 'flex';
}

// Close Update Photo Modal
function closeUpdatePhotoModal() {
  const modal = document.getElementById('updatePhotoModal');
  if (modal) modal.style.display = 'none';
}

// Handle Update Photo
async function handleUpdatePhoto(e) {
  e.preventDefault();
  
  const photoUrl = document.getElementById('photoUrl').value.trim();
  const successMsg = document.getElementById('updatePhotoSuccess');
  const errorMsg = document.getElementById('updatePhotoError');
  const btnUpdatePhoto = document.getElementById('btnUpdatePhoto');
  
  // Hide previous messages
  if (successMsg) {
    successMsg.textContent = '';
    successMsg.style.display = 'none';
  }
  if (errorMsg) {
    errorMsg.textContent = '';
    errorMsg.style.display = 'none';
  }
  
  // Validate input
  if (!photoUrl) {
    if (errorMsg) {
      errorMsg.textContent = 'Please enter a Google Drive photo link!';
      errorMsg.style.display = 'block';
    }
    return;
  }
  
  // Validate it's a valid URL
  try {
    new URL(photoUrl);
  } catch (err) {
    if (errorMsg) {
      errorMsg.textContent = 'Please enter a valid URL!';
      errorMsg.style.display = 'block';
    }
    return;
  }
  
  // Check if it's a Google Drive link
  if (!photoUrl.includes('drive.google.com') && !photoUrl.includes('googleusercontent.com')) {
    if (errorMsg) {
      errorMsg.textContent = 'Please use a Google Drive link!';
      errorMsg.style.display = 'block';
    }
    return;
  }
  
  if (!currentUser || !currentUser.uid) {
    if (errorMsg) {
      errorMsg.textContent = 'User not logged in!';
      errorMsg.style.display = 'block';
    }
    return;
  }
  
  // Disable button
  if (btnUpdatePhoto) {
    btnUpdatePhoto.disabled = true;
    btnUpdatePhoto.textContent = 'Updating...';
  }
  
  try {
    // Call backend to update photo
    const response = await fetch(
      `${API_URL}?action=set_member_photo&uid=${encodeURIComponent(currentUser.uid)}&photoUrl=${encodeURIComponent(photoUrl)}`
    );
    const data = await response.json();
    
    if (data.status === 'success') {
      // Update current user's photo
      if (currentUser) {
        currentUser.photoUrl = data.photoUrl || photoUrl;
      }
      
      // Update in allMembers cache
      const memberIndex = allMembers.findIndex(m => m.uid === currentUser.uid);
      if (memberIndex !== -1) {
        allMembers[memberIndex].photoUrl = data.photoUrl || photoUrl;
      }
      
      // Show success message
      if (successMsg) {
        successMsg.textContent = 'Photo updated successfully! Refreshing...';
        successMsg.style.display = 'block';
      }
      
      // Update header photo immediately
      updateHeaderPhoto(data.photoUrl || photoUrl);
      
      // Reload attendance to show new photo
      setTimeout(async () => {
        await loadAttendance();
        closeUpdatePhotoModal();
        showNotification('Profile photo updated successfully!', 'success');
      }, 1500);
      
    } else {
      // Show error message
      if (errorMsg) {
        errorMsg.textContent = data.message || 'Failed to update photo';
        errorMsg.style.display = 'block';
      }
    }
    
  } catch (error) {
    console.error('Update photo error:', error);
    if (errorMsg) {
      errorMsg.textContent = 'Failed to update photo. Please try again.';
      errorMsg.style.display = 'block';
    }
  } finally {
    // Re-enable button
    if (btnUpdatePhoto) {
      btnUpdatePhoto.disabled = false;
      btnUpdatePhoto.textContent = 'Update Photo';
    }
  }
}

// Show About modal
function showAboutModal() {
  let modal = document.getElementById('aboutModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'aboutModal';
    modal.className = 'modal';
    modal.innerHTML = `
      <div class="modal-content" style="max-width: 600px; background: var(--card); color: var(--text);">
        <div class="modal-header" style="color: var(--text);">
          <h2 style="color: var(--text);">About This Application</h2>
        </div>
        <div class="modal-body" style="text-align: left; line-height: 1.8; color: var(--text); max-height: 500px; overflow-y: auto;">
          <p style="color: var(--text);"><strong>BSCPE Faculty Attendance Checker</strong></p>
          <p style="color: var(--text);">This system is designed to streamline attendance monitoring for the BSCPE (Bachelor of Science in Civil/Computer/Electrical Engineering) faculty at Pampanga State Agricultural University.</p>
          <br>
          <p style="color: var(--text);"><strong>Purpose:</strong></p>
          <p style="color: var(--text);">The system provides an efficient way to track faculty attendance using RFID technology, reducing manual paperwork and providing real-time attendance records for administrative purposes.</p>
          <br>
          <p style="color: var(--text);"><strong>Key Features:</strong></p>
          <ul style="margin-left: 20px; margin-bottom: 15px; color: var(--text);">
            <li>RFID-based login for quick and secure check-in/out</li>
            <li>Real-time attendance dashboard with today's records</li>
            <li>Admin controls for member management and reporting</li>
            <li>Dark/Light mode toggle for user comfort</li>
            <li>Responsive design for desktop and mobile devices</li>
            <li>Automatic data refresh every 5 minutes</li>
            <li>Attendance history and reporting capabilities</li>
          </ul>
          <br>
          <p style="color: var(--text);"><strong>Technology Stack:</strong></p>
          <ul style="margin-left: 20px; margin-bottom: 15px; color: var(--text);">
            <li><strong>Frontend:</strong> HTML5, CSS3, Vanilla JavaScript</li>
            <li><strong>Backend:</strong> Google Apps Script</li>
            <li><strong>Hardware:</strong> ESP32 Microcontroller with RFID Reader</li>
            <li><strong>Database:</strong> Google Sheets</li>
          </ul>
          <br>
          <p style="color: var(--text);"><strong>Developer Credits:</strong></p>
          <div style="background: rgba(102, 126, 234, 0.1); padding: 12px; border-radius: 8px; margin-bottom: 15px; border-left: 4px solid var(--primary-color); display: flex; align-items: center; gap: 15px;">
            <div style="flex: 1;">
              <p style="color: var(--text); margin-bottom: 5px;"><strong>System Developer</strong></p>
              <p style="color: var(--text); margin-bottom: 3px;">Kim Carlo T. Tolentino</p>
              <p style="color: var(--muted); font-size: 13px;">3rd Year Student, BSCPE</p>
              <p style="color: var(--muted); font-size: 13px;">Pampanga State Agricultural University</p>
            </div>
            <img src="kimphoto.jpg" alt="Kim Carlo T. Tolentino" style="width: 120px; height: 120px; border-radius: 12px; object-fit: cover; border: 3px solid var(--primary-color); flex-shrink: 0;">
          </div>
          <p style="color: var(--muted); font-size: 13px;"><strong>Responsibilities:</strong></p>
          <ul style="margin-left: 20px; margin-bottom: 15px; color: var(--muted); font-size: 13px;">
            <li>Full-stack development (Frontend & Backend)</li>
            <li>ESP32 firmware development</li>
            <li>System architecture and integration</li>
            <li>Database design and management</li>
          </ul>
          <br>
          <p style="color: var(--text);"><strong>Project Team:</strong></p>
          <div style="background: rgba(102, 126, 234, 0.08); padding: 12px; border-radius: 8px; margin-bottom: 10px; border-left: 4px solid #4caf50;">
            <p style="color: var(--text); margin-bottom: 5px; font-size: 14px;"><strong>Hardware & Technical Support</strong></p>
            <p style="color: var(--text); font-size: 13px;">Justine Laurence Quizon</p>
            <p style="color: var(--text); font-size: 13px;">John Lloyd Roncal</p>
          </div>
          <div style="background: rgba(102, 126, 234, 0.08); padding: 12px; border-radius: 8px; margin-bottom: 15px; border-left: 4px solid #ff9800;">
            <p style="color: var(--text); margin-bottom: 5px; font-size: 14px;"><strong>Documentation & Research</strong></p>
            <p style="color: var(--text); font-size: 13px;">Joshua Carl Nartea</p>
            <p style="color: var(--text); font-size: 13px;">Norland Barona</p>
          </div>
          <br>
          <p style="color: var(--muted);"><em>Version 1.0.0 | © 2025 All Rights Reserved</em></p>
        </div>
        <div class="modal-footer">
          <button class="btn-modal" id="closeAboutModal">Close</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
    
    // Close handlers
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        modal.style.display = 'none';
      }
    });
    document.getElementById('closeAboutModal').addEventListener('click', () => {
      modal.style.display = 'none';
    });
  }
  
  modal.style.display = 'flex';
}

// Update stats
function updateStats() {
  const present = currentAttendance.length;
  const checkedIn = currentAttendance.filter(r => r.inTime && !r.outTime).length;
  const checkedOut = currentAttendance.filter(r => r.outTime).length;
  
  document.getElementById('statPresent').textContent = present;
  document.getElementById('statIn').textContent = checkedIn;
  document.getElementById('statOut').textContent = checkedOut;
}

// Update member stats (exclude admins and super admin)
function updateMemberStats() {
  const superAdmin = 'FFDFA0DA';
  const count = (allMembers || []).filter(m => !m.isAdmin && (m.uid || '').toString().trim().toUpperCase() !== superAdmin).length;
  const el = document.getElementById('statMembers');
  if (el) el.textContent = count.toString();
}

// Open remove member modal
async function openRemoveMemberModal() {
  removeMemberModal.style.display = 'flex';
  memberList.innerHTML = '';
  removeSuccess.textContent = '';
  removeSuccess.style.display = 'none';
  removeError.textContent = '';
  removeError.style.display = 'none';
  memberLoading.style.display = 'flex';
  
  try {
    // Refresh member list
    await loadMembers();
    
    if (allMembers.length === 0) {
      memberList.innerHTML = '<p class="no-members">No members found</p>';
    } else {
      const isSuperAdmin = currentUser && (currentUser.position || '').toLowerCase() === 'super admin';
      
      allMembers.forEach(member => {
        const memberCard = document.createElement('div');
        memberCard.className = 'member-card';
        const memberPos = (member.position || '').toLowerCase();
        const isTargetAdmin = member.isAdmin || memberPos === 'admin' || memberPos === 'super admin';
        const adminBadge = isTargetAdmin ? '<span class="admin-badge">ADMIN</span>' : '';
        const disabledAttr = (isTargetAdmin && !isSuperAdmin) ? 'disabled' : '';
        const disabledTitle = (isTargetAdmin && !isSuperAdmin) ? ' title="Only Super Admins can remove other admins"' : '';
        memberCard.innerHTML = `
          <div class="member-info">
            <div class="member-name">${member.name} ${adminBadge}</div>
            <div class="member-uid">UID: ${member.uid}</div>
          </div>
          <button class="btn-remove" ${disabledAttr}${disabledTitle} data-uid="${member.uid}" data-name="${member.name}">Remove</button>
        `;
        memberList.appendChild(memberCard);
      });
      
      // Add click handlers to remove buttons
      document.querySelectorAll('.btn-remove').forEach(btn => {
        btn.addEventListener('click', () => {
          const uid = btn.getAttribute('data-uid');
          const name = btn.getAttribute('data-name');
          removeMember(uid, name);
        });
      });
    }
  } catch (error) {
    removeError.textContent = 'Failed to load members';
    removeError.style.display = 'block';
  } finally {
    memberLoading.style.display = 'none';
  }
}

// Close remove member modal
function closeRemoveMemberModal() {
  removeMemberModal.style.display = 'none';
}

// Remove member
async function removeMember(uid, name) {
  // Block removing admins - check from allMembers data
  const member = allMembers.find(m => m.uid === (uid || '').toString().trim().toUpperCase());
  const memberPos = member ? (member.position || '').toLowerCase() : '';
  const isTargetAdmin = member && (member.isAdmin || memberPos === 'admin' || memberPos === 'super admin');
  
  // Check if current user is Super Admin - must have explicit "Super Admin" position or UID
  const currentUserPos = (currentUser.position || '').toLowerCase();
  const isSuperAdmin = currentUserPos === 'super admin' || currentUser.uid === 'FFDFA0DA';
  
  // Block removal of any admin by non-Super Admin
  if (isTargetAdmin) {
    if (!isSuperAdmin) {
      showNotification('⚠️ Only Super Admins can remove other admins: ' + name, 'error');
      return;
    }
    // Extra confirmation for Super Admin removing another admin
    if (!confirm(`⚠️ WARNING: You are about to remove an ADMIN.\n\nUser: ${name}\nUID: ${uid}\n\nThis action cannot be undone. Continue?`)) {
      return;
    }
  } else {
    // Regular member removal - simple confirmation
    if (!confirm(`Are you sure you want to remove ${name}?`)) {
      return;
    }
  }
  
  removeSuccess.style.display = 'none';
  removeError.style.display = 'none';
  
  try {
    const response = await fetch(`${API_URL}?action=remove_member&uid=${encodeURIComponent(uid)}&actorUid=${encodeURIComponent(currentUser.uid)}`);
    const data = await response.json();
    
    if (data.status === 'success') {
      removeSuccess.textContent = `${name} has been removed successfully!`;
      removeSuccess.style.display = 'block';
      
      // Refresh the member list
      setTimeout(() => {
        openRemoveMemberModal();
      }, 1500);
      
      // Reload members and attendance
      loadMembers();
      loadAttendance();
    } else if (data.status === 'forbidden') {
      throw new Error('Only Super Admins can remove other admins');
    } else {
      throw new Error(data.message || 'Failed to remove member');
    }
  } catch (error) {
    removeError.textContent = error.message;
    removeError.style.display = 'block';
  }
}

// Download report
async function downloadReport() {
  try {
    // Show loading notification
    showNotification('Preparing download...', 'info');
    
    // Get last 3 months info from backend
    const response = await fetch(`${API_URL}?action=get_last_3_months_info`);
    const data = await response.json();
    
    if (data.success && data.sheets && data.sheets.length > 0) {
      // Build GID list for multiple sheets download
      // Format: gid=sheet1,sheet2,sheet3
      const gidList = data.sheets.map(sheet => sheet.sheetId).join(',');
      
      // Generate download URL for multiple sheets
      const downloadUrl = `https://docs.google.com/spreadsheets/d/${data.spreadsheetId}/export?format=xlsx&gid=${gidList}`;
      
      // Open in new tab to trigger download
      window.open(downloadUrl, '_blank');
      
      const sheetNames = data.sheets.map(s => s.sheetName).join(', ');
      showNotification(`Downloading last ${data.totalSheets} months: ${sheetNames}`, 'success');
    } else {
      showNotification('No attendance sheets found for the last 3 months', 'error');
    }
  } catch (error) {
    console.error('Download error:', error);
    showNotification('Failed to download report', 'error');
  }
}

// Send email report
async function sendEmailReport() {
  const selectedDate = datePicker.value;
  const [year, month] = selectedDate.split('-');
  const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 
                      'July', 'August', 'September', 'October', 'November', 'December'];
  const monthName = monthNames[parseInt(month) - 1];
  const sheetName = `${monthName} ${year}`;
  
  // Show email input modal
  showEmailInputModal(sheetName);
}

// Show email input modal
function showEmailInputModal(sheetName) {
  let modal = document.getElementById('emailInputModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'emailInputModal';
    modal.className = 'modal';
    modal.style.cssText = 'display: flex; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.7); z-index: 100; align-items: center; justify-content: center;';
    modal.innerHTML = `
      <div class="modal-content" style="background: var(--card); border-radius: 12px; padding: 30px; max-width: 500px; width: 90%; border: 1px solid rgba(255,255,255,0.1);">
        <div class="modal-header" style="margin-bottom: 20px;">
          <h2 style="color: var(--text); font-size: 22px; font-weight: 700;">Send Email Report</h2>
        </div>
        <div class="modal-body" style="margin-bottom: 25px;">
          <div class="form-group">
            <label for="emailRecipient" style="display: block; color: var(--text); font-weight: 600; margin-bottom: 8px; font-size: 14px;">Recipient Email Address</label>
            <input type="email" id="emailRecipient" placeholder="example@email.com" style="width: 100%; padding: 12px 16px; border: 2px solid rgba(255,255,255,0.1); border-radius: 8px; font-size: 14px; background: rgba(255,255,255,0.05); color: var(--input);" required />
            <small style="display: block; color: var(--muted); margin-top: 6px; font-size: 12px;">Enter the email address where the report will be sent</small>
          </div>
          <div id="emailSendMessage" style="margin-top: 15px;"></div>
        </div>
        <div class="modal-footer" style="display: flex; gap: 12px; justify-content: flex-end;">
          <button id="btnCancelEmail" class="btn-modal cancel" style="padding: 10px 20px; background: var(--gray-600); color: var(--white); border: none; border-radius: 8px; font-weight: 600; cursor: pointer;">Cancel</button>
          <button id="btnSendEmail" class="btn-modal" style="padding: 10px 20px; background: linear-gradient(135deg, var(--primary-color), var(--secondary-color)); color: var(--white); border: none; border-radius: 8px; font-weight: 600; cursor: pointer;">Send Email</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
    
    // Close button
    document.getElementById('btnCancelEmail').addEventListener('click', () => {
      modal.style.display = 'none';
    });
    
    // Close modal when clicking outside
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        modal.style.display = 'none';
      }
    });
    
    // Send button
    document.getElementById('btnSendEmail').addEventListener('click', async () => {
      await performSendEmail(modal, sheetName);
    });
    
    // Allow Enter key to submit
    document.getElementById('emailRecipient').addEventListener('keypress', async (e) => {
      if (e.key === 'Enter') {
        await performSendEmail(modal, sheetName);
      }
    });
  }
  
  // Reset and show modal
  document.getElementById('emailRecipient').value = '';
  document.getElementById('emailSendMessage').innerHTML = '';
  modal.style.display = 'flex';
  
  // Focus on email input
  setTimeout(() => {
    document.getElementById('emailRecipient').focus();
  }, 100);
}

// Perform send email
async function performSendEmail(modal, sheetName) {
  const emailInput = document.getElementById('emailRecipient');
  const email = emailInput.value.trim();
  const messageDiv = document.getElementById('emailSendMessage');
  const sendBtn = document.getElementById('btnSendEmail');
  
  if (!email) {
    messageDiv.innerHTML = '<div style="background: #fed7d7; color: #c53030; padding: 10px; border-radius: 6px; font-size: 13px;">Please enter an email address</div>';
    return;
  }
  
  // Basic email validation
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    messageDiv.innerHTML = '<div style="background: #fed7d7; color: #c53030; padding: 10px; border-radius: 6px; font-size: 13px;">Please enter a valid email address</div>';
    return;
  }
  
  // Disable send button
  sendBtn.disabled = true;
  sendBtn.textContent = 'Sending...';
  messageDiv.innerHTML = '<div style="color: var(--muted); font-size: 13px;">Sending email report...</div>';
  
  try {
    const response = await fetch(`${API_URL}?action=send_data&sheet=${encodeURIComponent(sheetName)}&email=${encodeURIComponent(email)}`);
    const responseText = await response.text();
    
    // Try to parse as JSON, if fails treat as plain text
    let data;
    try {
      data = JSON.parse(responseText);
    } catch (e) {
      // If response is plain text (like "sent"), treat it as success
      if (responseText.toLowerCase().includes('sent') || responseText.toLowerCase().includes('success')) {
        data = { status: 'success' };
      } else {
        throw new Error(responseText || 'Failed to send email');
      }
    }
    
    if (data.status === 'success' || responseText.toLowerCase().includes('sent')) {
      messageDiv.innerHTML = '<div style="background: #c6f6d5; color: #2f855a; padding: 10px; border-radius: 6px; font-size: 13px;">Email sent successfully to ' + email + '!</div>';
      showNotification('Email sent successfully!', 'success');
      
      // Close modal after 2 seconds
      setTimeout(() => {
        modal.style.display = 'none';
      }, 2000);
    } else {
      throw new Error(data.message || 'Failed to send email');
    }
  } catch (error) {
    messageDiv.innerHTML = '<div style="background: #fed7d7; color: #c53030; padding: 10px; border-radius: 6px; font-size: 13px;">Failed to send email: ' + error.message + '</div>';
    showNotification('Failed to send email: ' + error.message, 'error');
  } finally {
    sendBtn.disabled = false;
    sendBtn.textContent = 'Send Email';
  }
}

// Show notification
function showNotification(message, type = 'info') {
  // Create notification element
  const notification = document.createElement('div');
  notification.className = `notification ${type}`;
  notification.textContent = message;
  
  // Add to page
  document.body.appendChild(notification);
  
  // Show notification
  setTimeout(() => {
    notification.classList.add('show');
  }, 100);
  
  // Remove notification after 3 seconds
  setTimeout(() => {
    notification.classList.remove('show');
    setTimeout(() => {
      notification.remove();
    }, 300);
  }, 3000);
}

// ========== ADMIN FUNCTIONS ==========

// Show Add Member Modal
function showAddMemberModal() {
  if (!currentUser || !currentUser.isAdmin) {
    showNotification('Admin access required', 'error');
    return;
  }

  let modal = document.getElementById('addMemberModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'addMemberModal';
    modal.className = 'modal';
    modal.innerHTML = `
      <div class="modal-content" style="max-width: 550px;">
        <div class="modal-header">
          <h2>➕ Add New Member</h2>
        </div>
        <div class="modal-body" style="text-align: left;">
          <div class="form-group">
            <label>UID (Card Number)</label>
            <input type="text" id="addMemberUID" placeholder="Enter UID" />
            <small style="color: var(--muted); font-size: 12px; display: block; margin-top: 6px;">
              💡 Note: Ask the admin to scan your card on the ESP32 device to get the UID
            </small>
          </div>
          
          <div class="form-group">
            <label>Professional Title</label>
            <select id="addMemberTitle">
              <option value="">-- Select Title --</option>
              <option value="ENGR.">ENGR.</option>
              <option value="PROF.">PROF.</option>
              <option value="MS.">MS.</option>
              <option value="MRS.">MRS.</option>
              <option value="MR.">MR.</option>
              <option value="DR.">DR.</option>
            </select>
            <small style="color: var(--muted); font-size: 12px; display: block; margin-top: 6px;">
              💡 Note: Please select a professional title (required)
            </small>
          </div>
          
          <div class="form-group">
            <label>First Name</label>
            <input type="text" id="addMemberFirstName" placeholder="Enter first name" />
          </div>
          
          <div class="form-group">
            <label>Middle Initial (Optional)</label>
            <input type="text" id="addMemberMI" placeholder="Enter M.I. (e.g., T.)" maxlength="3" />
          </div>
          
          <div class="form-group">
            <label>Last Name</label>
            <input type="text" id="addMemberLastName" placeholder="Enter last name" />
            <small style="color: var(--muted); font-size: 12px; display: block; margin-top: 6px;">
              💡 Note: Enter the full name (e.g., "Kim Carlo T. Tolentino"). Title will be added automatically if selected above.
            </small>
          </div>
          
          <div id="addMemberMessage" style="margin-top: 15px;"></div>
        </div>
        <div class="modal-footer">
          <button class="btn-modal cancel" id="cancelAddMember">Cancel</button>
          <button class="btn-modal" id="confirmAddMember">Add Member</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
    
    modal.addEventListener('click', (e) => {
      if (e.target === modal) modal.style.display = 'none';
    });
    
    document.getElementById('confirmAddMember').addEventListener('click', () => {
      performAddMember(modal);
    });
    
    document.getElementById('cancelAddMember').addEventListener('click', () => {
      modal.style.display = 'none';
    });
  }
  
  document.getElementById('addMemberUID').value = '';
  document.getElementById('addMemberTitle').value = '';
  document.getElementById('addMemberFirstName').value = '';
  document.getElementById('addMemberMI').value = '';
  document.getElementById('addMemberLastName').value = '';
  document.getElementById('addMemberMessage').innerHTML = '';
  modal.style.display = 'flex';
}

// Perform Add Member
async function performAddMember(modal) {
  const uid = document.getElementById('addMemberUID').value.trim().toUpperCase();
  const title = document.getElementById('addMemberTitle').value.trim();
  const firstName = document.getElementById('addMemberFirstName').value.trim();
  const mi = document.getElementById('addMemberMI').value.trim();
  const lastName = document.getElementById('addMemberLastName').value.trim();
  const messageDiv = document.getElementById('addMemberMessage');
  
  if (!uid || !title || !firstName || !lastName) {
    messageDiv.innerHTML = '<p style="color: var(--danger-color); font-size: 13px;">❌ Please fill all required fields (UID, Title, First Name, and Last Name). M.I. is optional.</p>';
    return;
  }
  
  // Check if UID already exists in the database
  const existingMember = allMembers.find(m => m.uid === uid);
  if (existingMember) {
    messageDiv.innerHTML = `
      <div style="background: var(--warning-bg, #fff3cd); border: 1px solid var(--warning-border, #ffc107); border-radius: 8px; padding: 12px; margin-top: 8px;">
        <p style="color: var(--warning-color, #856404); font-size: 14px; font-weight: 600; margin: 0 0 8px 0;">
          ⚠️ UID Already Exists
        </p>
        <p style="color: var(--warning-color, #856404); font-size: 13px; margin: 0 0 8px 0;">
          This UID (<strong>${uid}</strong>) is already registered to <strong>${existingMember.name}</strong>.
        </p>
        <p style="color: var(--warning-color, #856404); font-size: 13px; margin: 0;">
          To update this member's information, please use the <strong>✏️ Edit Member</strong> feature instead.
        </p>
      </div>
    `;
    return;
  }
  
  // Combine name parts: Title FirstName MI LastName
  const fullName = mi 
    ? `${title} ${firstName} ${mi} ${lastName}`
    : `${title} ${firstName} ${lastName}`;
  
  try {
    messageDiv.innerHTML = '<p style="color: var(--muted); font-size: 13px;">Adding member...</p>';
    
    const response = await fetch(`${API_URL}?action=add_member&uid=${uid}&name=${encodeURIComponent(fullName)}`);
    const data = await response.text();
    
    if (data.includes('added') || data.includes('success')) {
      messageDiv.innerHTML = '<p style="color: var(--success-color); font-size: 13px;">✅ Member added successfully!</p>';
      setTimeout(() => {
        modal.style.display = 'none';
        loadMembers();
        showNotification('Member added successfully!', 'success');
      }, 1500);
    } else {
      throw new Error(data);
    }
  } catch (error) {
    messageDiv.innerHTML = '<p style="color: var(--danger-color); font-size: 13px;">❌ Error: ' + error.message + '</p>';
  }
}

// ====== EDIT MEMBER / EDIT MY NAME ======

const TITLE_OPTIONS = [
  '', 'ENGR.', 'DR.', 'PROF.', 'MS.', 'MRS.', 'MR.', 'ATTY.'
];

const POSITION_OPTIONS = [
  '',
  'Instructor I','Instructor II','Instructor III',
  'Assistant Professor I','Assistant Professor II','Assistant Professor III','Assistant Professor IV',
  'Associate Professor I','Associate Professor II','Associate Professor III','Associate Professor IV','Associate Professor V',
  'Professor I','Professor II','Professor III','Professor IV','College Professor'
];

function parseTitleAndBareName(fullName) {
  if (!fullName) return { title: '', bareName: '' };
  const name = fullName.trim();
  for (const t of TITLE_OPTIONS.filter(Boolean)) {
    const tWithSpace = t + ' ';
    if (name.toUpperCase().startsWith(tWithSpace)) {
      return { title: t, bareName: name.substring(tWithSpace.length).trim() };
    }
  }
  return { title: '', bareName: name };
}

async function fetchPeople() {
  const res = await fetchWithTimeout(`${API_URL}?action=list_people`, {}, 10000);
  return res.json();
}

function buildOptionsHtml(options, selected) {
  return options.map(opt => `<option value="${opt}">${opt || '-- None --'}</option>`)
    .join('')
    .replace(`value="${selected}"`, `value="${selected}" selected`);
}

function ensureEditMemberModal() {
  let modal = document.getElementById('editMemberModal');
  if (modal) return modal;
  modal = document.createElement('div');
  modal.id = 'editMemberModal';
  modal.className = 'modal';
  modal.innerHTML = `
    <div class="modal-content" style="max-width: 640px; background: var(--card); color: var(--text);">
      <div class="modal-header">
        <h2>✏️ Edit Member</h2>
      </div>
      <div class="modal-body" style="text-align:left; max-height: 65vh; overflow-y:auto;">
        <div class="form-group">
          <label>Select Person</label>
          <select id="editPersonSelect"></select>
          <small style="color: var(--muted); font-size: 12px; display:block; margin-top:6px;">Admins can edit Members. Only Super Admin can edit Admins.</small>
        </div>
        <div class="form-group">
          <label>UID (Card Number)</label>
          <input type="text" id="editUID" placeholder="Enter UID" />
        </div>
        <div class="form-group">
          <label>Title</label>
          <select id="editTitle"></select>
        </div>
        <div class="form-group">
          <label>Name (without title)</label>
          <input type="text" id="editNameBare" placeholder="First M.I. Last" />
        </div>
        <div class="form-group" id="positionGroup" style="display:none;">
          <label>Position (Admins only)</label>
          <select id="editPosition"></select>
        </div>
        <div id="editMemberMessage" style="margin-top:10px;"></div>
      </div>
      <div class="modal-footer">
        <button class="btn-modal cancel" id="btnCloseEditMember">Cancel</button>
        <button class="btn-modal" id="btnSaveEditMember">Save Changes</button>
      </div>
    </div>`;
  document.body.appendChild(modal);
  modal.addEventListener('click', (e) => { if (e.target === modal) modal.style.display = 'none'; });
  document.getElementById('btnCloseEditMember').addEventListener('click', () => { modal.style.display = 'none'; });
  return modal;
}

async function showEditMemberModal() {
  if (!currentUser || !currentUser.isAdmin) {
    showNotification('Admin access required', 'error');
    return;
  }
  
  try {
    const modal = ensureEditMemberModal();
    const selectEl = modal.querySelector('#editPersonSelect');
    const uidEl = modal.querySelector('#editUID');
    const titleEl = modal.querySelector('#editTitle');
    const nameEl = modal.querySelector('#editNameBare');
    const posGroup = modal.querySelector('#positionGroup');
    const posEl = modal.querySelector('#editPosition');
    const msgEl = modal.querySelector('#editMemberMessage');

    // Reset state
    msgEl.innerHTML = '';
    titleEl.innerHTML = buildOptionsHtml(TITLE_OPTIONS, '');
    posEl.innerHTML = buildOptionsHtml(POSITION_OPTIONS, '');
    selectEl.innerHTML = '<option value="">Loading...</option>';

    // Show modal immediately while loading
    modal.style.display = 'flex';

    const data = await fetchPeople();
    const admins = Array.isArray(data.admins) ? data.admins : [];
    const members = Array.isArray(data.members) ? data.members : [];

    // Build options grouped
    let html = '';
    if (admins.length) {
      html += '<optgroup label="Admins">';
      html += admins.map(a => `<option value="admin:${a.uid}" data-scope="admin">${a.name} (UID: ${a.uid})</option>`).join('');
      html += '</optgroup>';
    }
    if (members.length) {
      html += '<optgroup label="Members">';
      html += members.map(m => `<option value="member:${m.uid}" data-scope="member">${m.name} (UID: ${m.uid})</option>`).join('');
      html += '</optgroup>';
    }
    selectEl.innerHTML = `<option value="">-- Select person --</option>` + html;

    function fillFormFromSelection() {
      const val = selectEl.value;
      if (!val) { uidEl.value=''; titleEl.value=''; nameEl.value=''; posEl.value=''; posGroup.style.display='none'; return; }
      const [scope, uid] = val.split(':');
      // find record
      const arr = scope === 'admin' ? admins : members;
      const rec = arr.find(x => (x.uid||'').toString().trim().toUpperCase() === uid);
      if (!rec) return;
      uidEl.value = rec.uid || '';
      const { title, bareName } = parseTitleAndBareName(rec.name || '');
      titleEl.value = title || '';
      nameEl.value = bareName || '';
      // Show position only for admins; prefill if exists
      if (scope === 'admin') {
        posGroup.style.display = 'block';
        posEl.value = rec.position || '';
      } else {
        posGroup.style.display = 'none';
        posEl.value = '';
      }
    }
    selectEl.onchange = fillFormFromSelection;

    // Save handler
    const saveBtn = modal.querySelector('#btnSaveEditMember');
    saveBtn.onclick = async () => {
      msgEl.innerHTML = '';
      const sel = selectEl.value;
      if (!sel) { msgEl.innerHTML = '<p style="color:var(--danger-color);">Select a person first.</p>'; return; }
      const [scope, targetUidRaw] = sel.split(':');
      const newUid = (uidEl.value||'').trim().toUpperCase();
      const title = (titleEl.value||'').trim();
      const bareName = (nameEl.value||'').trim();
      const position = scope === 'admin' ? (posEl.value||'').trim() : '';
      if (!newUid || !bareName) { msgEl.innerHTML = '<p style="color:var(--danger-color);">UID and Name are required.</p>'; return; }

      // Deny editing other admins (by sheet or by position) unless Super Admin
      const currentUserPos = (currentUser && currentUser.position ? currentUser.position : '').toString().trim().toLowerCase();
      const isSuperAdmin = (currentUser && currentUser.uid === 'FFDFA0DA') || currentUserPos === 'super admin';
      const targetEntry = (allMembers || []).find(m => (m.uid || '').toString().trim().toUpperCase() === targetUidRaw.toUpperCase());
      const targetPos = ((targetEntry && targetEntry.position) || '').toString().trim().toLowerCase();
      const isTargetAdmin = !!(targetEntry && (targetEntry.isAdmin === true || targetPos === 'admin' || targetPos === 'super admin'));
      const isEditingSelf = currentUser && currentUser.uid.toUpperCase() === targetUidRaw.toUpperCase();
      if (isTargetAdmin && !isSuperAdmin && !isEditingSelf) {
        msgEl.innerHTML = `
          <div style="background: var(--danger-bg, #f8d7da); border: 1px solid var(--danger-border, #dc3545); border-radius: 8px; padding: 12px; margin-top: 8px;">
            <p style="color: var(--danger-color, #721c24); font-size: 14px; font-weight: 600; margin: 0 0 6px 0;">
              ⚠️ WARNING: YOU CAN'T EDIT OTHER ADMINS
            </p>
            <p style="color: var(--danger-color, #721c24); font-size: 13px; margin: 0;">
              Only the Super Admin can modify another admin's information (including admins assigned by position).
            </p>
          </div>
        `;
        return;
      }

      const isChangingUid = newUid !== targetUidRaw.toUpperCase();
      
      // Warn if changing own UID
      if (isEditingSelf && isChangingUid) {
        const confirmed = confirm(
          '⚠️ WARNING: UID CHANGE DETECTED\n\n' +
          'If you change your UID, your current card will LOSE ACCESS to:\n' +
          '• This web dashboard\n' +
          '• ESP32 attendance system\n' +
          '• All admin privileges\n\n' +
          'You will need to use your NEW UID card to regain access.\n\n' +
          'Are you absolutely sure you want to change your UID from ' + targetUidRaw + ' to ' + newUid + '?'
        );
        if (!confirmed) {
          msgEl.innerHTML = '<p style="color:var(--warning-color);">UID change cancelled.</p>';
          return;
        }
      }
      
      saveBtn.disabled = true; saveBtn.textContent = 'Saving...';
      try {
        const url = `${API_URL}?action=edit_member&actorUid=${encodeURIComponent(currentUser.uid)}&targetUid=${encodeURIComponent(targetUidRaw)}&newUid=${encodeURIComponent(newUid)}&name=${encodeURIComponent(bareName)}&title=${encodeURIComponent(title)}&position=${encodeURIComponent(position)}&scope=${encodeURIComponent(scope)}`;
        const res = await fetch(url);
        const data = await res.json();
        if (data.status === 'success') {
          msgEl.innerHTML = '<p style="color:var(--success-color);">Changes saved.</p>';
          // refresh caches and UI
          await loadMembers();
          await loadAttendance(false, false);
          // If current user edited self, update session name/uid
          if (isEditingSelf) {
            currentUser.uid = data.uid || newUid;
            currentUser.name = data.name || `${title} ${bareName}`.trim();
            localStorage.setItem('attendanceSession', JSON.stringify(currentUser));
            updateHeaderPhoto(getPhotoUrl({ uid: currentUser.uid, photoUrl: currentUser.photoUrl }));
            const userNameEl = document.getElementById('userName');
            if (userNameEl) userNameEl.textContent = currentUser.isAdmin ? `${currentUser.name} (ADMIN)` : currentUser.name;
            
            // Show additional warning if UID was changed
            if (isChangingUid) {
              showNotification('⚠️ UID Changed! You will need to log in with your new card.', 'warning');
            }
          }
          setTimeout(() => { modal.style.display = 'none'; showNotification('Member updated successfully', 'success'); }, 800);
        } else {
          msgEl.innerHTML = `<p style="color:var(--danger-color);">${data.message || 'Failed to save changes'}</p>`;
        }
      } catch (err) {
        console.error(err);
        msgEl.innerHTML = `<p style="color:var(--danger-color);">Error: ${err.message}</p>`;
      } finally {
        saveBtn.disabled = false; saveBtn.textContent = 'Save Changes';
      }
    };

  } catch (e) {
    selectEl.innerHTML = '<option value="">Failed to load list</option>';
  }

  modal.style.display = 'flex';
}

// ========== Edit Position Modal ==========
function showEditPositionModal() {
  if (!currentUser || !currentUser.isAdmin) {
    showNotification('Admin access required', 'error');
    return;
  }

  const modal = document.getElementById('editPositionModal');
  const memberSelect = document.getElementById('positionMemberSelect');
  const positionSelect = document.getElementById('positionSelect');
  const customPositionGroup = document.getElementById('customPositionGroup');
  const customPositionInput = document.getElementById('customPositionInput');
  const successEl = document.getElementById('editPositionSuccess');
  const errorEl = document.getElementById('editPositionError');
  const warningEl = document.getElementById('editPositionWarning');
  const btnSave = document.getElementById('btnSavePosition');
  const btnClose = document.getElementById('btnCloseEditPositionModal');
  const adminPositionsGroup = document.getElementById('adminPositionsGroup');

  // Check if current user is super admin (by position or by UID)
  const currentUserPos = (currentUser.position || '').toLowerCase();
  const isSuperAdmin = currentUserPos === 'super admin' || currentUser.uid === 'FFDFA0DA';

  // Hide/show admin positions based on super admin status
  if (adminPositionsGroup) {
    adminPositionsGroup.style.display = isSuperAdmin ? 'block' : 'none';
  }

  // Clear state
  successEl.textContent = '';
  errorEl.textContent = '';
  if (warningEl) {
    warningEl.innerHTML = '<div style="color: var(--muted); font-size: 12px;">Note: Only <strong>Super Admin</strong> can assign Admin/Super Admin roles or change another admin\'s position.</div>';
  }
  customPositionGroup.style.display = 'none';
  customPositionInput.value = '';
  memberSelect.innerHTML = '<option value="">-- Loading members --</option>';
  positionSelect.value = '';

  // Load all members and admins
  const admins = allMembers.filter(m => m.isAdmin);
  const members = allMembers.filter(m => !m.isAdmin);

  let optionsHtml = '<option value="">-- Choose a member --</option>';

  // Add admins group if super admin
  if (isSuperAdmin && admins.length > 0) {
    optionsHtml += '<optgroup label="Admins">';
    admins.forEach(admin => {
      const currentPos = admin.position || '';
      const label = currentPos ? `${admin.name} (Current: ${currentPos})` : admin.name;
      optionsHtml += `<option value="${admin.uid}" data-is-admin="true">${label}</option>`;
    });
    optionsHtml += '</optgroup>';
  }

  // Add members group
  if (members.length > 0) {
    optionsHtml += '<optgroup label="Members">';
    members.forEach(member => {
      const currentPos = member.position || '';
      const label = currentPos ? `${member.name} (Current: ${currentPos})` : member.name;
      optionsHtml += `<option value="${member.uid}" data-is-admin="false">${label}</option>`;
    });
    optionsHtml += '</optgroup>';
  }

  memberSelect.innerHTML = optionsHtml;

  // Update warning and button state based on selection
  function updateAdminSelectionWarning() {
    try {
      const targetUid = (memberSelect.value || '').toString().trim();
      
      if (!targetUid) {
        // No member selected yet
        if (btnSave) btnSave.disabled = false;
        return;
      }
      
      const targetEntry = (allMembers || []).find(m => (m.uid || '').toString().trim().toUpperCase() === targetUid.toUpperCase());
      const tPos = ((targetEntry && targetEntry.position) || '').toString().trim().toLowerCase();
      const isTargetAdmin = !!(targetEntry && (targetEntry.isAdmin === true || tPos === 'admin' || tPos === 'super admin'));

      // Any admin can edit normal members, only Super Admin can edit other admins
      if (isTargetAdmin && !isSuperAdmin) {
        if (warningEl) {
          warningEl.innerHTML = `
            <div style="background: var(--danger-bg, #f8d7da); border: 1px solid var(--danger-border, #dc3545); border-radius: 8px; padding: 12px; margin-top: 8px;">
              <p style="color: var(--danger-color, #721c24); font-size: 14px; font-weight: 600; margin: 0 0 6px 0;">
                ⚠️ WARNING: YOU CAN'T CHANGE THE POSITION OF OTHER ADMINS
              </p>
              <p style="color: var(--danger-color, #721c24); font-size: 13px; margin: 0;">
                Only the Super Admin can modify another admin's position (including admins assigned by position).
              </p>
            </div>`;
        }
        if (btnSave) btnSave.disabled = true;
      } else {
        // Normal member selected - any admin can edit
        if (warningEl) {
          warningEl.innerHTML = '<div style="color: var(--muted); font-size: 12px;">Note: Only <strong>Super Admin</strong> can assign Admin/Super Admin roles or change another admin\'s position.</div>';
        }
        if (btnSave) btnSave.disabled = false;
      }
    } catch (_) {
      // On error, enable button to not block functionality
      if (btnSave) btnSave.disabled = false;
    }
  }

  // Run once on open
  updateAdminSelectionWarning();
  // Update when selection changes
  memberSelect.addEventListener('change', updateAdminSelectionWarning);

  // Show/hide custom position input when "custom" is selected
  positionSelect.addEventListener('change', () => {
    if (positionSelect.value === 'custom') {
      customPositionGroup.style.display = 'block';
      customPositionInput.focus();
    } else {
      customPositionGroup.style.display = 'none';
      customPositionInput.value = '';
    }
  });

  // Close handler
  btnClose.onclick = () => {
    modal.style.display = 'none';
  };

  // Save handler
  btnSave.onclick = async () => {
    successEl.textContent = '';
    errorEl.textContent = '';

    const targetUid = memberSelect.value;
    let position = positionSelect.value;

    if (!targetUid) {
      errorEl.textContent = 'Please select a member';
      return;
    }

    if (!position) {
      errorEl.textContent = 'Please select a position';
      return;
    }

    // Use custom position if selected
    if (position === 'custom') {
      position = customPositionInput.value.trim();
      if (!position) {
        errorEl.textContent = 'Please enter a custom position';
        return;
      }
      
      // Block reserved words "Admin" and "Super Admin" in custom positions
      const positionLower = position.toLowerCase();
      if (positionLower.includes('admin') || positionLower.includes('super admin')) {
        errorEl.textContent = '⚠️ Cannot use "Admin" or "Super Admin" in custom positions. Use the dropdown to assign admin roles.';
        return;
      }
    }

    // Re-check super admin status for save operation
    const currentUserPos = (currentUser.position || '').toLowerCase();
    const isCurrentUserSuperAdmin = currentUserPos === 'super admin' || currentUser.uid === 'FFDFA0DA';

    // Check if trying to change another admin's position (only Super Admin can do this)
    const targetMember = (allMembers || []).find(m => (m.uid || '').toString().trim().toUpperCase() === (targetUid || '').toString().trim().toUpperCase());
    const targetPos = ((targetMember && targetMember.position) || '').toString().trim().toLowerCase();
    const isTargetAdmin = !!(targetMember && (targetMember.isAdmin === true || targetPos === 'admin' || targetPos === 'super admin'));
    
    // Block changing admin positions unless current user is Super Admin
    if (isTargetAdmin && !isCurrentUserSuperAdmin) {
      errorEl.innerHTML = `
        <div style="background: var(--danger-bg, #f8d7da); border: 1px solid var(--danger-border, #dc3545); border-radius: 8px; padding: 12px; margin-top: 8px;">
          <p style="color: var(--danger-color, #721c24); font-size: 14px; font-weight: 600; margin: 0 0 6px 0;">
            ⚠️ WARNING: YOU CAN'T CHANGE THE POSITION OF OTHER ADMINS
          </p>
          <p style="color: var(--danger-color, #721c24); font-size: 13px; margin: 0;">
            Only the Super Admin can modify another admin's position (including admins assigned by position).
          </p>
        </div>
      `;
      return;
    }

    // Check if trying to assign admin position without super admin privileges
    const isAdminPosition = position === 'Admin' || position === 'Super Admin';
    if (isAdminPosition && !isCurrentUserSuperAdmin) {
      errorEl.textContent = 'Only Super Admin can assign administrative positions';
      return;
    }

    btnSave.disabled = true;
    btnSave.textContent = 'Saving...';

    console.log('Attempting to save position...');

    try {
      const url = `${API_URL}?action=edit_position&actorUid=${encodeURIComponent(currentUser.uid)}&targetUid=${encodeURIComponent(targetUid)}&position=${encodeURIComponent(position)}`;
      console.log('Request URL:', url);
      const response = await fetch(url);
      const data = await response.json();
      
      console.log('Server response:', data);

      if (data.status === 'success') {
        successEl.textContent = `Position updated to "${position}" for ${data.name}`;

        const promotedToAdmin = (position === 'Admin' || position === 'Super Admin');

        // If promoted to admin, request backend to copy to admins sheet (best-effort)
        if (promotedToAdmin && isSuperAdmin) {
          try {
            const promoteRes = await fetch(`${API_URL}?action=promote_to_admin&uid=${encodeURIComponent(targetUid)}`);
            // tolerate non-JSON or failures silently
            try { await promoteRes.json(); } catch (_) {}
          } catch (_) {}
        }

        // Refresh member list to reflect changes from server
        await loadMembers();
        await loadAttendance(false, false);

        // If current user was promoted, grant UI access immediately
        if (promotedToAdmin && currentUser && currentUser.uid === targetUid) {
          currentUser.isAdmin = true;
          // Ensure session persists admin flag
          localStorage.setItem('attendanceSession', JSON.stringify(currentUser));
        }

        setTimeout(() => {
          modal.style.display = 'none';
          showNotification('Position updated successfully', 'success');
          // Re-render dashboard to reflect admin controls visibility
          if (promotedToAdmin) {
            showDashboard();
          }
        }, 1000);
      } else if (data.status === 'forbidden') {
        if (data.message === 'only_super_admin_can_assign_admin_positions') {
          errorEl.textContent = 'Only Super Admin (Kim Carlo Tolentino) can assign administrative positions';
        } else {
          errorEl.textContent = data.message || 'Permission denied';
        }
      } else {
        errorEl.textContent = data.message || 'Failed to update position';
      }
    } catch (error) {
      console.error('Error updating position:', error);
      errorEl.textContent = 'Network error. Please try again.';
    } finally {
      btnSave.disabled = false;
      btnSave.textContent = 'Save Position';
    }
  };

  // Close modal when clicking outside
  modal.onclick = (e) => {
    if (e.target === modal) {
      modal.style.display = 'none';
    }
  };

  modal.style.display = 'flex';
}

function ensureEditMyNameModal() {
  let modal = document.getElementById('editMyNameModal');
  if (modal) return modal;
  modal = document.createElement('div');
  modal.id = 'editMyNameModal';
  modal.className = 'modal';
  modal.innerHTML = `
    <div class="modal-content" style="max-width: 560px; background: var(--card); color: var(--text);">
      <div class="modal-header">
        <h2>👤 Edit My Name</h2>
      </div>
      <div class="modal-body" style="text-align:left;">
        <div class="form-group">
          <label>UID</label>
          <input type="text" id="myEditUID" />
        </div>
        <div class="form-group">
          <label>Title</label>
          <select id="myEditTitle"></select>
        </div>
        <div class="form-group">
          <label>Name (without title)</label>
          <input type="text" id="myEditNameBare" placeholder="First M.I. Last" />
        </div>
        <div id="editMyNameMessage" style="margin-top:10px;"></div>
      </div>
      <div class="modal-footer">
        <button class="btn-modal cancel" id="btnCloseEditMyName">Cancel</button>
        <button class="btn-modal" id="btnSaveEditMyName">Save</button>
      </div>
    </div>`;
  document.body.appendChild(modal);
  modal.addEventListener('click', (e) => { if (e.target === modal) modal.style.display = 'none'; });
  document.getElementById('btnCloseEditMyName').addEventListener('click', () => { modal.style.display = 'none'; });
  return modal;
}

async function showEditMyNameModal() {
  if (!currentUser) { showNotification('Not logged in', 'error'); return; }
  const modal = ensureEditMyNameModal();
  const uidEl = modal.querySelector('#myEditUID');
  const titleEl = modal.querySelector('#myEditTitle');
  const nameEl = modal.querySelector('#myEditNameBare');
  const msgEl = modal.querySelector('#editMyNameMessage');
  msgEl.innerHTML = '';
  titleEl.innerHTML = buildOptionsHtml(TITLE_OPTIONS, '');
  // Prefill from currentUser
  uidEl.value = currentUser.uid || '';
  const { title, bareName } = parseTitleAndBareName(currentUser.name || '');
  titleEl.value = title || '';
  nameEl.value = bareName || '';

  const saveBtn = modal.querySelector('#btnSaveEditMyName');
  saveBtn.onclick = async () => {
    msgEl.innerHTML = '';
    const newUid = (uidEl.value||'').trim().toUpperCase();
    const t = (titleEl.value||'').trim();
    const bare = (nameEl.value||'').trim();
    const isChangingUid = newUid !== (currentUser.uid||'').toUpperCase();
    // Warn if the admin is changing their own UID
    if (isChangingUid) {
      const confirmed = confirm(
        '⚠️ WARNING: UID CHANGE DETECTED\n\n' +
        'If you change your UID, your CURRENT CARD will LOSE ACCESS to:\n' +
        '• This web dashboard (you will be signed out)\n' +
        '• ESP32 attendance system (until you use the new card)\n' +
        '• All admin privileges tied to the old UID\n\n' +
        'You must use your NEW UID/card to regain access.\n\n' +
        'Proceed changing your UID from ' + (currentUser.uid||'') + ' to ' + newUid + ' ?'
      );
      if (!confirmed) {
        msgEl.innerHTML = '<p style="color:var(--warning-color);">UID change cancelled.</p>';
        return;
      }
    }
    if (!newUid || !bare) { msgEl.innerHTML = '<p style="color:var(--danger-color);">UID and Name are required.</p>'; return; }
    saveBtn.disabled = true; saveBtn.textContent = 'Saving...';
    try {
      const url = `${API_URL}?action=edit_member&actorUid=${encodeURIComponent(currentUser.uid)}&targetUid=${encodeURIComponent(currentUser.uid)}&newUid=${encodeURIComponent(newUid)}&name=${encodeURIComponent(bare)}&title=${encodeURIComponent(t)}&position=&scope=member`;
      const res = await fetch(url);
      const data = await res.json();
      if (data.status === 'success') {
        // update session
        currentUser.uid = data.uid || newUid;
        currentUser.name = data.name || `${t} ${bare}`.trim();
        localStorage.setItem('attendanceSession', JSON.stringify(currentUser));
        updateHeaderPhoto(getPhotoUrl({ uid: currentUser.uid, photoUrl: currentUser.photoUrl }));
        const userNameEl = document.getElementById('userName');
        if (userNameEl) userNameEl.textContent = currentUser.isAdmin ? `${currentUser.name} (ADMIN)` : currentUser.name;
        await loadMembers();
        await loadAttendance(false, false);
        msgEl.innerHTML = '<p style="color:var(--success-color);">Saved.</p>';
        setTimeout(() => {
          modal.style.display = 'none';
          showNotification('Updated successfully', 'success');
          if (isChangingUid) {
            showNotification('UID changed. Please log in with your new card.', 'warning');
          }
        }, 800);
      } else {
        msgEl.innerHTML = `<p style=\"color:var(--danger-color);\">${data.message || 'Failed to save'}</p>`;
      }
    } catch (err) {
      msgEl.innerHTML = `<p style=\"color:var(--danger-color);\">Error: ${err.message}</p>`;
    } finally {
      saveBtn.disabled = false; saveBtn.textContent = 'Save';
    }
  };

  modal.style.display = 'flex';
}

// Show Enhanced Remove Member Modal
async function showRemoveMemberModalAdmin() {
  if (!currentUser || !currentUser.isAdmin) {
    showNotification('Admin access required', 'error');
    return;
  }

  let modal = document.getElementById('removeMemberAdminModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'removeMemberAdminModal';
    modal.className = 'modal';
    modal.innerHTML = `
      <div class="modal-content" style="max-width: 600px;">
        <div class="modal-header">
          <h2>❌ Remove Member</h2>
        </div>
        <div class="modal-body" style="max-height: 450px; overflow-y: auto;">
          <div class="loading" id="memberLoadingAdmin">
            <div class="spinner"></div>
            <p>Loading members...</p>
          </div>
          <div id="memberListAdmin" class="member-list" style="display: none;"></div>
        </div>
        <div class="modal-footer">
          <button class="btn-modal cancel" id="cancelRemoveAdmin">Cancel</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
    
    modal.addEventListener('click', (e) => {
      if (e.target === modal) modal.style.display = 'none';
    });
    
    document.getElementById('cancelRemoveAdmin').addEventListener('click', () => {
      modal.style.display = 'none';
    });
  }
  
  modal.style.display = 'flex';
  const loadingDiv = document.getElementById('memberLoadingAdmin');
  const memberListDiv = document.getElementById('memberListAdmin');
  
  try {
    const response = await fetch(`${API_URL}?action=list_members`);
    const data = await response.json();
    
    if (data.status === 'success' && data.members.length > 0) {
      loadingDiv.style.display = 'none';
      memberListDiv.style.display = 'block';
      
      const membersHTML = data.members.map(raw => {
        const uid = (raw.uid || '').toString().trim().toUpperCase();
        const name = raw.name || '';
        const isAdmin = raw.isAdmin === true; // Use isAdmin flag from API
        const photoUrl = getPhotoUrl(raw);
        const initial = name ? name[0].toUpperCase() : '?';
        
        return `
          <div class="member-card" style="display: flex; align-items: center; gap: 12px;">
            <div class="profile-photo-container" style="width: 45px; height: 45px; flex-shrink: 0;">
              ${photoUrl ? `
                <img src="${photoUrl}" alt="${name}" class="profile-photo" loading="lazy" referrerpolicy="no-referrer"
                  onerror="this.style.display='none'; this.parentElement.innerHTML='<div class=\\'profile-placeholder\\'>${initial}</div>'">
              ` : `<div class="profile-placeholder">${initial}</div>`}
            </div>
            <div class="member-info" style="flex: 1;">
              <div class="member-name">${name}${isAdmin ? ' <span class="admin-badge">ADMIN</span>' : ''}</div>
              <div class="member-uid">UID: ${uid}</div>
            </div>
            <button class="btn-remove" ${isAdmin ? 'disabled title="Admins cannot be removed"' : ''}
              onclick="${isAdmin ? '' : `performRemoveMember('${uid}', '${name.replace(/'/g, "&#39;")}', document.getElementById('removeMemberAdminModal'))`}">
              Remove
            </button>
          </div>
        `;
      }).join('');
      
      memberListDiv.innerHTML = membersHTML;
    } else {
      loadingDiv.innerHTML = '<p style="color: var(--muted);">No members found</p>';
    }
  } catch (error) {
    loadingDiv.innerHTML = '<p style="color: var(--danger-color);">Error loading members: ' + error.message + '</p>';
  }
}

// Perform Remove Member with confirmation
async function performRemoveMember(uid, name, modal) {
  // Check from allMembers data
  const normUID = (uid || '').toString().trim().toUpperCase();
  const member = allMembers.find(m => m.uid === normUID);
  const memberPos = member ? (member.position || '').toLowerCase() : '';
  const isTargetAdmin = member && (member.isAdmin || memberPos === 'admin' || memberPos === 'super admin');
  
  // Check if current user is Super Admin
  const currentUserPos = (currentUser.position || '').toLowerCase();
  const isSuperAdmin = currentUserPos === 'super admin' || currentUser.uid === 'FFDFA0DA';
  
  // Block removal of any admin by non-Super Admin
  if (isTargetAdmin) {
    if (!isSuperAdmin) {
      showNotification('⚠️ Only Super Admins can remove other admins', 'error');
      return;
    }
    // Extra confirmation for Super Admin removing another admin
    if (!confirm(`⚠️ WARNING: You are about to remove an ADMIN.\n\nUser: ${name}\nUID: ${uid}\n\nThis action cannot be undone. Continue?`)) {
      return;
    }
  } else {
    // Regular member removal - simple confirmation
    if (!confirm(`Are you sure you want to remove ${name}? This action cannot be undone.`)) {
      return;
    }
  }
  
  try {
    const response = await fetch(`${API_URL}?action=remove_member&uid=${uid}&actorUid=${encodeURIComponent(currentUser.uid)}`);
    const data = await response.json();
    
    if (data.status === 'success') {
      showNotification(`${name} has been removed!`, 'success');
      modal.style.display = 'none';
      loadMembers();
      showRemoveMemberModalAdmin();
    } else if (data.status === 'forbidden') {
      showNotification('Only Super Admins can remove other admins', 'error');
    } else {
      throw new Error(data.message || 'Failed to remove member');
    }
  } catch (error) {
    showNotification('Error removing member: ' + error.message, 'error');
  }
}

// Show Reset Data Modal with Password
function showResetDataModal() {
  if (!currentUser || !currentUser.isAdmin) {
    showNotification('Admin access required', 'error');
    return;
  }

  let modal = document.getElementById('resetDataModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'resetDataModal';
    modal.className = 'modal';
    modal.innerHTML = `
      <div class="modal-content" style="max-width: 450px; background: var(--card); color: var(--text);">
        <div class="modal-header" style="color: var(--text);">
          <h2 style="color: var(--text);">🔄 Reset All Data</h2>
        </div>
        <div class="modal-body" style="text-align: left;">
          <div style="background: rgba(245, 101, 101, 0.1); padding: 12px; border-radius: 8px; margin-bottom: 15px; border-left: 4px solid var(--danger-color);">
            <p style="color: var(--danger-color); font-weight: 600; margin: 0;">⚠️ Warning!</p>
            <p style="color: var(--muted); font-size: 13px; margin: 5px 0 0 0;">This will delete ALL attendance records. This action CANNOT be undone.</p>
          </div>
          
          <div class="form-group">
            <label>Enter Admin Password to confirm:</label>
            <input type="password" id="resetPassword" placeholder="Enter password" />
          </div>
          
          <div id="resetMessage"></div>
        </div>
        <div class="modal-footer">
          <button class="btn-modal cancel" id="cancelReset">Cancel</button>
          <button class="btn-modal" id="confirmReset" style="background: var(--danger-color);">Reset All Data</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
    
    modal.addEventListener('click', (e) => {
      if (e.target === modal) modal.style.display = 'none';
    });
    
    document.getElementById('confirmReset').addEventListener('click', () => {
      performResetData(modal);
    });
    
    document.getElementById('cancelReset').addEventListener('click', () => {
      modal.style.display = 'none';
    });
  }
  
  document.getElementById('resetPassword').value = '';
  document.getElementById('resetMessage').innerHTML = '';
  modal.style.display = 'flex';
}

// Perform Reset Data
async function performResetData(modal) {
  const password = document.getElementById('resetPassword').value;
  const messageDiv = document.getElementById('resetMessage');
  
  if (password !== ADMIN_PASSWORD) {
    messageDiv.innerHTML = '<p style="color: var(--danger-color); font-size: 13px; margin-top: 10px;">❌ Incorrect password</p>';
    return;
  }
  
  if (!confirm('FINAL CONFIRMATION: All attendance data will be permanently deleted. Are you absolutely sure?')) {
    return;
  }
  
  try {
    messageDiv.innerHTML = '<p style="color: var(--muted); font-size: 13px; margin-top: 10px;">Resetting data...</p>';
    
    const response = await fetch(`${API_URL}?action=reset_all_data`);
    const data = await response.text();
    
    messageDiv.innerHTML = '<p style="color: var(--success-color); font-size: 13px; margin-top: 10px;">✅ All data reset successfully!</p>';
    setTimeout(() => {
      modal.style.display = 'none';
      loadAttendance();
      showNotification('All attendance data has been reset!', 'success');
    }, 1500);
  } catch (error) {
    messageDiv.innerHTML = '<p style="color: var(--danger-color); font-size: 13px; margin-top: 10px;">❌ Error: ' + error.message + '</p>';
  }
}

// Show Reset Today's Out Modal
async function showResetTodayOutModal() {
  if (!currentUser || !currentUser.isAdmin) {
    showNotification('Admin access required', 'error');
    return;
  }

  const modal = document.getElementById('resetTodayOutModal');
  const loadingDiv = document.getElementById('resetOutLoading');
  const listDiv = document.getElementById('resetOutList');
  const successDiv = document.getElementById('resetOutSuccess');
  const errorDiv = document.getElementById('resetOutError');
  
  // Reset modal state
  loadingDiv.style.display = 'flex';
  listDiv.style.display = 'none';
  listDiv.innerHTML = '';
  successDiv.textContent = '';
  errorDiv.textContent = '';
  modal.style.display = 'flex';
  
  // Close button handler
  const closeBtn = document.getElementById('btnCloseResetOutModal');
  if (closeBtn) {
    closeBtn.onclick = () => {
      modal.style.display = 'none';
    };
  }
  
  // Close modal when clicking outside
  modal.onclick = (e) => {
    if (e.target === modal) {
      modal.style.display = 'none';
    }
  };
  
  try {
    // Get today's date
    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const day = String(today.getDate()).padStart(2, '0');
    const todayStr = `${year}-${month}-${day}`;
    
    // Fetch today's attendance
    const response = await fetch(`${API_URL}?action=get_today_attendance&date=${todayStr}`);
    const data = await response.json();
    
    // Filter members who have OUT time today
    const membersWithOut = (data.attendance || []).filter(record => {
      return record.outTime && record.outTime.trim() !== '' && record.outTime !== '-';
    });
    
    loadingDiv.style.display = 'none';
    
    if (membersWithOut.length === 0) {
      listDiv.innerHTML = '<p style="color: var(--text-secondary); text-align: center; padding: 20px;">No members have checked out today.</p>';
      listDiv.style.display = 'block';
      return;
    }
    
    // Display members with OUT time
    listDiv.innerHTML = membersWithOut.map(record => {
      const uid = record.uid || '';
      const name = record.name || 'Unknown';
      const outTime = record.outTime || '';
      const photoUrl = getPhotoUrl(record);
      const initial = name ? name[0].toUpperCase() : '?';
      
      return `
        <div class="member-card" style="display: flex; justify-content: space-between; align-items: center; padding: 12px; margin-bottom: 8px; border: 1px solid var(--border); border-radius: 8px; background: var(--card);">
          <div style="display: flex; align-items: center; gap: 12px; flex: 1;">
            <div class="profile-photo-container" style="width: 45px; height: 45px; flex-shrink: 0;">
              ${photoUrl ? `
                <img src="${photoUrl}" alt="${name}" class="profile-photo" loading="lazy" referrerpolicy="no-referrer"
                  onerror="this.style.display='none'; this.parentElement.innerHTML='<div class=\\'profile-placeholder\\'>${initial}</div>'">
              ` : `<div class="profile-placeholder">${initial}</div>`}
            </div>
            <div class="member-info" style="flex: 1;">
              <div class="member-name" style="font-weight: 600; color: var(--text);">${name}</div>
              <div class="member-uid" style="font-size: 12px; color: var(--text-secondary);">UID: ${uid}</div>
              <div style="font-size: 12px; color: var(--text-secondary); margin-top: 4px;">OUT Time: ${outTime}</div>
            </div>
          </div>
          <button class="btn-remove" onclick="performResetOutTime('${uid}', '${name.replace(/'/g, "&#39;")}')">
            Reset OUT
          </button>
        </div>
      `;
    }).join('');
    
    listDiv.style.display = 'block';
    
  } catch (error) {
    loadingDiv.style.display = 'none';
    errorDiv.textContent = 'Error loading members: ' + error.message;
  }
}

// Perform Reset OUT Time for a member
async function performResetOutTime(uid, name) {
  if (!confirm(`Reset OUT time for ${name}? They will be able to check out again.`)) {
    return;
  }
  
  const successDiv = document.getElementById('resetOutSuccess');
  const errorDiv = document.getElementById('resetOutError');
  
  try {
    successDiv.textContent = '';
    errorDiv.textContent = '';
    
    const response = await fetch(`${API_URL}?action=reset_out_time&uid=${uid}`);
    const result = await response.text();
    
    if (result === 'out_time_cleared') {
      showNotification(`OUT time reset for ${name}!`, 'success');
      successDiv.textContent = `✅ OUT time reset for ${name}`;
      
      // Refresh attendance data and web attendance status
      await loadAttendance();
      updateWebAttendanceStatus();
      
      // Reload the modal to refresh the list
      setTimeout(() => {
        showResetTodayOutModal();
      }, 1500);
    } else if (result === 'no_out_time_found') {
      errorDiv.textContent = `No OUT time found for ${name} today.`;
    } else {
      throw new Error(result);
    }
  } catch (error) {
    errorDiv.textContent = 'Error: ' + error.message;
    showNotification('Failed to reset OUT time', 'error');
  }
}

// Sign Out All Checked-In Members
async function signOutAllMembers() {
  if (!currentUser || !currentUser.isAdmin) {
    showNotification('Admin access required', 'error');
    return;
  }
  
  // Get all checked-in members
  const checkedInMembers = currentAttendance.filter(record => 
    record.inTime && record.inTime !== '-' && (!record.outTime || record.outTime === '-')
  );
  
  if (checkedInMembers.length === 0) {
    showNotification('No members are currently checked in', 'info');
    return;
  }
  
  const memberNames = checkedInMembers.map(m => m.name).join(', ');
  if (!confirm(`Sign out all checked-in members?\n\nMembers: ${memberNames}\n\nTotal: ${checkedInMembers.length} member(s)`)) {
    return;
  }
  
  // Show progress
  showNotification('Signing out members...', 'info');
  
  let successCount = 0;
  let failCount = 0;
  
  // Sign out each member
  for (const member of checkedInMembers) {
    try {
      const response = await fetch(`${API_URL}?action=manual_sign_out&uid=${member.uid}`);
      const result = await response.text();
      
      if (result === 'signed_out' || result.includes('success')) {
        successCount++;
      } else {
        failCount++;
        console.error(`Failed to sign out ${member.name}: ${result}`);
      }
    } catch (error) {
      failCount++;
      console.error(`Error signing out ${member.name}:`, error);
    }
  }
  
  // Show results
  if (successCount > 0) {
    showNotification(`Successfully signed out ${successCount} member(s)!`, 'success');
  }
  if (failCount > 0) {
    showNotification(`Failed to sign out ${failCount} member(s). Check console for details.`, 'error');
  }
  
  // Reload attendance data and update web attendance status
  await loadAttendance(false);
  updateWebAttendanceStatus();
}

// Web Attendance Functions
// Cooldown helpers for Sign Out button
let signOutCooldownInterval = null;
function setSignOutCooldown(uid, ms = 120000) {
  try { localStorage.setItem(`signOutCooldown_${uid}`, String(Date.now() + ms)); } catch {}
}
function getSignOutCooldownRemaining(uid) {
  try {
    const exp = parseInt(localStorage.getItem(`signOutCooldown_${uid}`) || '0', 10);
    return Math.max(0, exp - Date.now());
  } catch { return 0; }
}
function clearSignOutCooldown(uid) {
  try { localStorage.removeItem(`signOutCooldown_${uid}`); } catch {}
}

function updateWebAttendanceStatus() {
  if (!currentUser) return;
  // Only hide personal buttons for users in Admin sheet (not by position)
  const uid = (currentUser.uid || '').toString().trim().toUpperCase();
  const isInAdminSheet = !!(allMembers || []).find(m => 
    m.uid === uid && m.isAdmin === true
  );
  if (isInAdminSheet) {
    const btnSignIn = document.getElementById('btnWebSignIn');
    const btnSignOut = document.getElementById('btnWebSignOut');
    if (btnSignIn) btnSignIn.style.display = 'none';
    if (btnSignOut) btnSignOut.style.display = 'none';
    return;
  }
  // If user lacks web access, hide both buttons unconditionally
  if (!currentUser.hasWebAccess) {
    const btnSignIn = document.getElementById('btnWebSignIn');
    const btnSignOut = document.getElementById('btnWebSignOut');
    if (btnSignIn) btnSignIn.style.display = 'none';
    if (btnSignOut) btnSignOut.style.display = 'none';
    return;
  }
  
  const btnSignIn = document.getElementById('btnWebSignIn');
  const btnSignOut = document.getElementById('btnWebSignOut');
  
  if (!btnSignIn || !btnSignOut) return;
  
  try {
    // Use already-loaded currentAttendance data instead of fetching again
    const myRecord = currentAttendance.find(r => 
      r.uid && r.uid.toString().trim().toUpperCase() === currentUser.uid.toString().trim().toUpperCase()
    );
    
    if (myRecord) {
      if (myRecord.inTime && myRecord.inTime !== '-' && (!myRecord.outTime || myRecord.outTime === '-')) {
        // User is checked in - show only Sign Out button
        btnSignIn.style.display = 'none';
        btnSignOut.style.display = 'inline-block';
        // Handle cooldown on sign-out
        const remaining = getSignOutCooldownRemaining(currentUser.uid);
        if (remaining > 0) {
          // Start/update countdown overlay on button
          btnSignOut.disabled = true;
          const updateLabel = () => {
            const r = getSignOutCooldownRemaining(currentUser.uid);
            if (r <= 0) {
              if (signOutCooldownInterval) { clearInterval(signOutCooldownInterval); signOutCooldownInterval = null; }
              btnSignOut.disabled = false;
              btnSignOut.textContent = 'Sign Out';
              return;
            }
            const secs = Math.ceil(r / 1000);
            const mm = String(Math.floor(secs / 60)).padStart(1, '0');
            const ss = String(secs % 60).padStart(2, '0');
            btnSignOut.textContent = `Sign Out (${mm}:${ss})`;
          };
          updateLabel();
          if (!signOutCooldownInterval) signOutCooldownInterval = setInterval(updateLabel, 1000);
        } else {
          // No cooldown
          if (signOutCooldownInterval) { clearInterval(signOutCooldownInterval); signOutCooldownInterval = null; }
          btnSignOut.disabled = false;
          btnSignOut.textContent = 'Sign Out';
        }
      } else if (myRecord.inTime && myRecord.inTime !== '-' && myRecord.outTime && myRecord.outTime !== '-') {
        // User completed attendance - hide both buttons
        btnSignIn.style.display = 'none';
        btnSignOut.style.display = 'none';
        if (signOutCooldownInterval) { clearInterval(signOutCooldownInterval); signOutCooldownInterval = null; }
      }
    } else {
      // No record yet - show only Sign In button
      btnSignIn.style.display = 'inline-block';
      btnSignIn.disabled = false;
      btnSignOut.style.display = 'none';
      if (signOutCooldownInterval) { clearInterval(signOutCooldownInterval); signOutCooldownInterval = null; }
    }
  } catch (error) {
    console.error('Error updating web attendance status:', error);
  }
}

async function performWebSignIn() {
  if (!currentUser) return;
  // Only block personal sign in for Admin sheet members
  const uid = (currentUser.uid || '').toString().trim().toUpperCase();
  const isInAdminSheet = !!(allMembers || []).find(m => 
    m.uid === uid && m.isAdmin === true
  );
  if (isInAdminSheet) return;
  if (!currentUser.hasWebAccess) {
    showNotification('Web access not granted for this account.', 'error');
    return;
  }
  
  if (!confirm('Sign in now?')) return;
  
  try {
    const response = await fetch(`${API_URL}?action=web_sign_in&uid=${currentUser.uid}`);
    const result = await response.text();
    
    if (result === 'signed_in' || result.includes('success')) {
      showNotification('Successfully signed in!', 'success');
      // Start a 2-minute cooldown for sign out
      setSignOutCooldown(currentUser.uid, 120000);
      // Refresh data first, then update button state
      await loadAttendance(false);
      updateWebAttendanceStatus();
    } else {
      throw new Error(result);
    }
  } catch (error) {
    showNotification('Failed to sign in: ' + error.message, 'error');
  }
}

async function performWebSignOut() {
  if (!currentUser) return;
  // Only block personal sign out for Admin sheet members
  const uid = (currentUser.uid || '').toString().trim().toUpperCase();
  const isInAdminSheet = !!(allMembers || []).find(m => 
    m.uid === uid && m.isAdmin === true
  );
  if (isInAdminSheet) return;
  if (!currentUser.hasWebAccess) {
    showNotification('Web access not granted for this account.', 'error');
    return;
  }
  
  if (!confirm('Sign out now?')) return;
  
  try {
    const response = await fetch(`${API_URL}?action=manual_sign_out&uid=${currentUser.uid}`);
    const result = await response.text();
    
    if (result === 'signed_out' || result.includes('success')) {
      showNotification('Successfully signed out!', 'success');
      clearSignOutCooldown(currentUser.uid);
      await loadAttendance(false);
      updateWebAttendanceStatus();
    } else {
      throw new Error(result);
    }
  } catch (error) {
    showNotification('Failed to sign out: ' + error.message, 'error');
  }
}

// Show Web Access Control Modal
async function showWebAccessModal() {
  if (!currentUser || !currentUser.isAdmin) {
    showNotification('Admin access required', 'error');
    return;
  }

  let modal = document.getElementById('webAccessModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'webAccessModal';
    modal.className = 'modal';
    modal.innerHTML = `
      <div class="modal-content" style="max-width: 700px;">
        <div class="modal-header">
          <h2>🌐 Web Access Control</h2>
        </div>
        <div class="modal-body" style="max-height: 500px; overflow-y: auto;">
          <p style="margin-bottom: 15px; color: var(--text-secondary);">
            Grant or deny web attendance access to faculty members. Members with access can sign in/out from the website.
          </p>
          <div class="loading" id="webAccessLoading">
            <div class="spinner"></div>
            <p>Loading members...</p>
          </div>
          <div id="webAccessList"></div>
        </div>
        <div class="modal-footer">
          <button class="btn-modal cancel" id="btnCloseWebAccessModal">Close</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
    
    modal.addEventListener('click', (e) => {
      if (e.target === modal) modal.style.display = 'none';
    });
    
    document.getElementById('btnCloseWebAccessModal').addEventListener('click', () => {
      modal.style.display = 'none';
    });
  }
  
  modal.style.display = 'flex';
  const loadingDiv = document.getElementById('webAccessLoading');
  const listDiv = document.getElementById('webAccessList');
  
  loadingDiv.style.display = 'flex';
  listDiv.innerHTML = '';
  
  try {
    const response = await fetch(`${API_URL}?action=list_members`);
    const data = await response.json();
    
    loadingDiv.style.display = 'none';
    
    if (data.status === 'success' && data.members.length > 0) {
      const membersHTML = data.members.map(member => {
        const uid = (member.uid || '').toString().trim().toUpperCase();
        const name = member.name || '';
        const hasWebAccess = member.webAccess === 'true' || member.webAccess === true;
        const isAdmin = member.isAdmin === true; // Use isAdmin flag from API
        
        if (isAdmin) return ''; // Don't show admins in the list
        
        const photoUrl = getPhotoUrl(member);
        const initial = name ? name[0].toUpperCase() : '?';
        
        return `
          <div class="member-card" style="display: flex; justify-content: space-between; align-items: center; padding: 15px; margin-bottom: 10px; border: 1px solid var(--border); border-radius: 8px; background: var(--card);">
            <div style="display: flex; align-items: center; gap: 12px; flex: 1;">
              <div class="profile-photo-container" style="width: 45px; height: 45px; flex-shrink: 0;">
                ${photoUrl ? `
                  <img src="${photoUrl}" alt="${name}" class="profile-photo" loading="lazy" referrerpolicy="no-referrer"
                    onerror="this.style.display='none'; this.parentElement.innerHTML='<div class=\\'profile-placeholder\\'>${initial}</div>'">
                ` : `<div class="profile-placeholder">${initial}</div>`}
              </div>
              <div class="member-info">
                <div class="member-name" style="font-weight: 600; color: var(--text);">${name}</div>
                <div class="member-uid" style="font-size: 12px; color: var(--text-secondary);">UID: ${uid}</div>
                <div style="font-size: 12px; margin-top: 5px;">
                  <span style="color: ${hasWebAccess ? 'var(--success-color)' : 'var(--danger-color)'}; font-weight: 600;">
                    ${hasWebAccess ? '✅ Web Access Granted' : '❌ No Web Access'}
                  </span>
                </div>
              </div>
            </div>
            <button class="btn-remove" onclick="toggleWebAccess('${uid}', '${name.replace(/'/g, "&#39;")}', ${hasWebAccess})">
              ${hasWebAccess ? 'Revoke Access' : 'Grant Access'}
            </button>
          </div>
        `;
      }).join('');
      
      listDiv.innerHTML = membersHTML || '<p style="text-align: center; color: var(--muted);">No members to manage</p>';
    } else {
      listDiv.innerHTML = '<p style="text-align: center; color: var(--muted);">No members found</p>';
    }
  } catch (error) {
    loadingDiv.style.display = 'none';
    listDiv.innerHTML = '<p style="color: var(--danger-color);">Error loading members: ' + error.message + '</p>';
  }
}

async function toggleWebAccess(uid, name, currentAccess) {
  const action = currentAccess ? 'revoke' : 'grant';
  const actionText = currentAccess ? 'revoke web access from' : 'grant web access to';
  
  if (!confirm(`${action === 'grant' ? 'Grant' : 'Revoke'} web attendance access for ${name}?`)) {
    return;
  }
  
  try {
    const newAccess = !currentAccess;
    const response = await fetch(`${API_URL}?action=set_web_access&uid=${uid}&access=${newAccess}`);
    const result = await response.text();
    
    if (result === 'success' || result.includes('updated')) {
      showNotification(`Web access ${action === 'grant' ? 'granted to' : 'revoked from'} ${name}!`, 'success');
      await loadMembers(); // Refresh member list
      showWebAccessModal(); // Refresh the modal
    } else {
      throw new Error(result);
    }
  } catch (error) {
    showNotification('Error: ' + error.message, 'error');
  }
}

// Show All Members View
async function showAllMembersView() {
  if (!currentUser || !currentUser.isAdmin) {
    showNotification('Admin access required', 'error');
    return;
  }

  let modal = document.getElementById('allMembersModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'allMembersModal';
    modal.className = 'modal';
    modal.innerHTML = `
      <div class="modal-content" style="max-width: 700px; background: var(--card); color: var(--text);">
        <div class="modal-header" style="color: var(--text);">
          <h2 style="color: var(--text);">👥 All Registered Members</h2>
        </div>
        <div class="modal-body" style="max-height: 500px; overflow-y: auto;">
          <div class="loading" id="allMembersLoading">
            <div class="spinner"></div>
            <p>Loading members...</p>
          </div>
          <div id="allMembersContent" style="display: none;"></div>
        </div>
        <div class="modal-footer">
          <button class="btn-modal" id="closeAllMembers">Close</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
    
    modal.addEventListener('click', (e) => {
      if (e.target === modal) modal.style.display = 'none';
    });
    
    document.getElementById('closeAllMembers').addEventListener('click', () => {
      modal.style.display = 'none';
    });
  }
  
  modal.style.display = 'flex';
  const loadingDiv = document.getElementById('allMembersLoading');
  const contentDiv = document.getElementById('allMembersContent');
  
  try {
    const response = await fetch(`${API_URL}?action=list_members`);
    const data = await response.json();
    
    if (data.status === 'success' && data.members.length > 0) {
      loadingDiv.style.display = 'none';
      contentDiv.style.display = 'block';
      
      const membersHTML = data.members.map((m, i) => {
        const photoUrl = getPhotoUrl(m);
        const name = m.name || 'Unknown';
        const uid = (m.uid||'')+''
        const initial = name ? name[0].toUpperCase() : '?';
        const isAdmin = m.isAdmin === true; // Use isAdmin flag from API
        
        return `
        <div style="padding: 12px; border-bottom: 1px solid rgba(102, 126, 234, 0.1); background: ${i % 2 === 0 ? 'rgba(102, 126, 234, 0.02)' : 'transparent'}; border-radius: 6px; margin-bottom: 6px;">
          <div style="display: flex; justify-content: space-between; align-items: center; gap: 12px;">
            <div style="display: flex; align-items: center; gap: 12px; flex: 1;">
              <div class="profile-photo-container" style="width: 45px; height: 45px; flex-shrink: 0;">
                ${photoUrl ? `
                  <img src="${photoUrl}" alt="${name}" class="profile-photo" loading="lazy" referrerpolicy="no-referrer"
                    onerror="this.style.display='none'; this.parentElement.innerHTML='<div class=\\'profile-placeholder\\'>${initial}</div>'">
                ` : `<div class="profile-placeholder">${initial}</div>`}
              </div>
              <div>
                <div style="font-weight: 600; color: var(--text);">${i + 1}. ${name}${isAdmin ? ' <span class=\"admin-badge\">ADMIN</span>' : ''}</div>
                <div style="font-size: 12px; color: var(--muted);">UID: ${uid}</div>
              </div>
            </div>
            <span style="font-size: 12px; background: ${isAdmin ? 'rgba(255, 193, 7, 0.2)' : 'rgba(102, 126, 234, 0.2)'}; color: ${isAdmin ? '#FFC107' : 'var(--info-color)'}; padding: 4px 8px; border-radius: 4px;">
              ${isAdmin ? '⭐ Admin' : 'Faculty'}
            </span>
          </div>
        </div>
      `;
      }).join('');
      
      contentDiv.innerHTML = `
        <div style="padding-bottom: 10px; border-bottom: 1px solid rgba(102, 126, 234, 0.2); margin-bottom: 10px;">
          <p style="color: var(--muted); font-size: 13px;"><strong>Total Members:</strong> ${data.members.length}</p>
        </div>
        ${membersHTML}
      `;
    } else {
      loadingDiv.innerHTML = '<p style="color: var(--muted);">No members found</p>';
    }
  } catch (error) {
    loadingDiv.innerHTML = '<p style="color: var(--danger-color);">Error loading members: ' + error.message + '</p>';
  }
}
