// API Configuration
const API_URL = 'https://script.google.com/macros/s/AKfycbyADrvhaT8WS5ybI0OwfgNumFQzSk3Nk2cD0Y830Q8P_1Q0A2t5JyHDX_xatgmVOBoKAw/exec';

// Admin UIDs (these users can access admin panel)
const ADMIN_UIDS = ['FFDFA0DA', '72B7B9AB'];
// Admin password for reset operations
const ADMIN_PASSWORD = 'kimdev2025';
// normalize admin UIDs (ensure trimmed uppercase)
ADMIN_UIDS.forEach((v, i) => { ADMIN_UIDS[i] = (v || '').toString().trim().toUpperCase(); });

// Global variables
let currentUser = null;
let allMembers = [];
let currentAttendance = [];
let autoRefreshInterval = null;

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
const btnRemoveMember = document.getElementById('btnRemoveMember');
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
  checkSession();
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
  
  // Admin panel button - navigate to admin page
  if (btnRemoveMember) {
    btnRemoveMember.textContent = '⚙️ Admin Control Panel';
    btnRemoveMember.onclick = showAdminPage;
  }
  
  // Close modal when clicking outside
  removeMemberModal.addEventListener('click', (e) => {
    if (e.target === removeMemberModal) {
      closeRemoveMemberModal();
    }
  });
}

// Set today's date in date picker
function setTodayDate() {
  const today = new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, '0');
  const day = String(today.getDate()).padStart(2, '0');
  datePicker.value = `${year}-${month}-${day}`;
}

// Check for existing session
function checkSession() {
  const session = localStorage.getItem('attendanceSession');
  if (session) {
    try {
      currentUser = JSON.parse(session);
      showDashboard();
    } catch (e) {
      localStorage.removeItem('attendanceSession');
      showLogin();
    }
  } else {
    showLogin();
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
    // Validate password
    if (password !== 'bscpekim2025') {
      throw new Error('Invalid password!');
    }
    
    // Fetch all members to validate UID
    const response = await fetch(`${API_URL}?action=list_members`);
    const data = await response.json();
    console.log('member list (login):', data && data.members ? data.members.slice(0,10) : data);
    console.log('Admin UIDs:', ADMIN_UIDS);
    console.log('Looking for UID:', uid);
    
    if (!data.members || data.members.length === 0) {
      throw new Error('Unable to load member list. Please try again.');
    }
    
    // Check if UID exists (robust compare: trim + uppercase)
    const member = (data.members || []).find(m => {
      try { 
        const memberUid = (m.uid || '').toString().trim().toUpperCase();
        console.log('Comparing:', memberUid, '===', uid, '?', memberUid === uid);
        return memberUid === uid; 
      } catch (err) { 
        console.error('Error comparing:', err);
        return false; 
      }
    });
    
    if (!member) {
      console.error('Member not found. Available members:', data.members.map(m => ({ uid: m.uid, name: m.name })));
      throw new Error('UID not found! Please check your card number.');
    }
    
    console.log('Member found:', member);
    
    // Login successful
    currentUser = {
      uid: uid,
      name: member.name,
      isAdmin: ADMIN_UIDS.includes(uid)
    };
    
    console.log('Current user:', currentUser);
    
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
    localStorage.removeItem('attendanceSession');
    currentUser = null;
    clearAutoRefresh();
    showLogin();
  }
}

// Show login screen
function showLogin() {
  loginScreen.style.display = 'flex';
  dashboard.style.display = 'none';
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
  
  // Set user name
  document.getElementById('userName').textContent = currentUser.isAdmin ? `${currentUser.name} (ADMIN)` : currentUser.name;
  
  // Show/hide admin panel - admin users see button to access admin page
  if (currentUser.isAdmin) {
    adminPanel.style.display = 'block';
  } else {
    adminPanel.style.display = 'none';
  }
  
  // Load initial data
  loadMembers();
  loadAttendance();
  
  // Run entrance animations
  setTimeout(() => runDashboardEntranceAnimation(), 100);
  
  // Setup auto-refresh (every 5 minutes)
  clearAutoRefresh();
  autoRefreshInterval = setInterval(() => {
    loadAttendance(false);
  }, 300000); // 300000ms = 5 minutes
}

// Show admin page
function showAdminPage() {
  if (!currentUser || !currentUser.isAdmin) {
    showNotification('Access denied. Admin only.', 'error');
    return;
  }
  
  loginScreen.style.display = 'none';
  dashboard.style.display = 'none';
  adminPage.style.display = 'block';
  
  // Show header on admin page
  const header = document.querySelector('.site-header');
  if (header) header.style.display = 'block';
  
  // Set admin user name
  document.getElementById('adminUserName').textContent = currentUser.isAdmin ? `${currentUser.name} (ADMIN)` : currentUser.name;
  
  // Load members for admin page
  loadMembers();
}

// Clear auto-refresh interval
function clearAutoRefresh() {
  if (autoRefreshInterval) {
    clearInterval(autoRefreshInterval);
    autoRefreshInterval = null;
  }
}

// Load all members
async function loadMembers() {
  try {
    const response = await fetch(`${API_URL}?action=list_members`);
    const data = await response.json();
    allMembers = (data.members || []).map(m => ({
      ...m,
      isAdmin: ADMIN_UIDS.includes((m.uid || '').toString().trim().toUpperCase())
    }));
    updateMemberStats();
  } catch (error) {
    console.error('Error loading members:', error);
  }
}

// Load attendance data
async function loadAttendance(showRefreshMessage = false) {
  const selectedDate = datePicker.value;
  
  // Show loading
  loadingIndicator.style.display = 'flex';
  attendanceTable.style.display = 'none';
  emptyState.style.display = 'none';
  
  try {
    const response = await fetch(`${API_URL}?action=get_today_attendance&date=${selectedDate}`);
    const data = await response.json();
    
    currentAttendance = data.attendance || [];
    
    // Update UI
    displayAttendance();
    updateStats();
    
    if (showRefreshMessage) {
      showNotification('Attendance data refreshed!', 'success');
    }
    
  } catch (error) {
    console.error('Error loading attendance:', error);
    showNotification('Failed to load attendance data', 'error');
    emptyState.style.display = 'flex';
  } finally {
    loadingIndicator.style.display = 'none';
  }
}

// Display attendance in table
function displayAttendance() {
  attendanceBody.innerHTML = '';
  
  if (currentAttendance.length === 0) {
    attendanceTable.style.display = 'none';
    emptyState.style.display = 'flex';
    return;
  }
  
  attendanceTable.style.display = 'table';
  emptyState.style.display = 'none';
  
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
    
      row.innerHTML = `
        <td>${record.name || '-'}</td>
        <td>${record.date || '-'}</td>
        <td>${record.inTime || '-'}</td>
        <td>${record.outTime || '-'}</td>
        <td><span class="status-badge ${statusClass}">${status}</span></td>
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
      <div class="modal-content" style="max-width: 550px; background: var(--card); color: var(--text);">
        <div class="modal-header" style="color: var(--text);">
          <h2 style="color: var(--text);">📄 My Records</h2>
        </div>
        <div class="modal-body" style="text-align: left; max-height: 400px; overflow-y: auto;">
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

  const bodyEl = modal.querySelector('#myRecordsBody');
  if (!bodyEl) return;
  
  if (myRecords.length === 0) {
    bodyEl.innerHTML = `
      <div style="text-align: center; padding: 40px 20px; color: var(--muted);">
        <p style="font-size: 14px; margin-top: 10px;">No attendance records found for today.</p>
      </div>
    `;
  } else {
    const selectedDate = datePicker.value;
    const rows = myRecords.map(r => {
      const status = (r.inTime && r.outTime) ? 'CHECKED OUT' : (r.inTime ? 'CHECKED IN' : 'PENDING');
      const statusColor = (r.inTime && r.outTime) ? 'var(--success-color)' : (r.inTime ? 'var(--info-color)' : 'var(--warning-color)');
      return `
        <div style="padding: 15px; border-bottom: 1px solid rgba(102, 126, 234, 0.1); background: rgba(102, 126, 234, 0.05); border-radius: 8px; margin-bottom: 10px;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
            <div><strong style="font-size: 15px; color: var(--text);">${r.name}</strong></div>
            <span style="font-size: 11px; font-weight: 600; color: ${statusColor}; text-transform: uppercase;">${status}</span>
          </div>
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px; font-size: 13px; color: var(--muted);">
            <div>
              <div style="color: var(--muted); font-size: 11px; text-transform: uppercase; margin-bottom: 3px;">Check In</div>
              <div style="color: var(--text); font-weight: 500;">${r.inTime || '—'}</div>
            </div>
            <div>
              <div style="color: var(--muted); font-size: 11px; text-transform: uppercase; margin-bottom: 3px;">Check Out</div>
              <div style="color: var(--text); font-weight: 500;">${r.outTime || '—'}</div>
            </div>
          </div>
          <div style="font-size: 12px; color: var(--muted); margin-top: 8px; padding-top: 8px; border-top: 1px solid rgba(102, 126, 234, 0.1);">
            <strong>Date:</strong> ${r.date || selectedDate}
          </div>
        </div>
      `;
    }).join('');
    bodyEl.innerHTML = rows;
  }

  // show modal
  modal.style.display = 'flex';
  // attach close button
  const closeBtn = document.getElementById('closeMyRecordsBtn');
  if (closeBtn) closeBtn.onclick = () => { modal.style.display = 'none'; };
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
          <div style="background: rgba(102, 126, 234, 0.1); padding: 12px; border-radius: 8px; margin-bottom: 15px; border-left: 4px solid var(--primary-color);">
            <p style="color: var(--text); margin-bottom: 5px;"><strong>System Developer</strong></p>
            <p style="color: var(--text); margin-bottom: 3px;">Kim Carlo T. Tolentino</p>
            <p style="color: var(--muted); font-size: 13px;">3rd Year Student, BSCPE</p>
            <p style="color: var(--muted); font-size: 13px;">Pampanga State Agricultural University</p>
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

// Update member stats
function updateMemberStats() {
  document.getElementById('statMembers').textContent = allMembers.length;
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
      allMembers.forEach(member => {
        const memberCard = document.createElement('div');
        memberCard.className = 'member-card';
        const adminBadge = member.isAdmin ? '<span class="admin-badge">ADMIN</span>' : '';
        const disabledAttr = member.isAdmin ? 'disabled' : '';
        const disabledTitle = member.isAdmin ? ' title="Admins cannot be removed"' : '';
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
  // Block removing admins
  if (ADMIN_UIDS.includes((uid || '').toString().trim().toUpperCase())) {
    showNotification('Cannot remove admin: ' + name, 'error');
    return;
  }
  if (!confirm(`Are you sure you want to remove ${name}?`)) {
    return;
  }
  
  removeSuccess.style.display = 'none';
  removeError.style.display = 'none';
  
  try {
    const response = await fetch(`${API_URL}?action=remove_member&uid=${encodeURIComponent(uid)}`);
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
    } else {
      throw new Error(data.message || 'Failed to remove member');
    }
  } catch (error) {
    removeError.textContent = error.message;
    removeError.style.display = 'block';
  }
}

// Download report
function downloadReport() {
  const selectedDate = datePicker.value;
  const [year, month] = selectedDate.split('-');
  const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 
                      'July', 'August', 'September', 'October', 'November', 'December'];
  const monthName = monthNames[parseInt(month) - 1];
  const sheetName = `${monthName} ${year}`;
  
  // Open download URL in new tab
  const downloadUrl = `${API_URL}?action=send_data&sheet=${encodeURIComponent(sheetName)}&download=true`;
  window.open(downloadUrl, '_blank');
  
  showNotification('Preparing download...', 'info');
}

// Send email report
async function sendEmailReport() {
  const selectedDate = datePicker.value;
  const [year, month] = selectedDate.split('-');
  const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 
                      'July', 'August', 'September', 'October', 'November', 'December'];
  const monthName = monthNames[parseInt(month) - 1];
  const sheetName = `${monthName} ${year}`;
  
  if (!confirm(`Send ${sheetName} attendance report via email?`)) {
    return;
  }
  
  try {
    const response = await fetch(`${API_URL}?action=send_data&sheet=${encodeURIComponent(sheetName)}`);
    const data = await response.json();
    
    if (data.status === 'success') {
      showNotification('Email sent successfully!', 'success');
    } else {
      throw new Error(data.message || 'Failed to send email');
    }
  } catch (error) {
    showNotification('Failed to send email: ' + error.message, 'error');
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
        const isAdmin = ADMIN_UIDS.includes(uid);
        return `
          <div class="member-card">
            <div class="member-info">
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
  // Block removal of admins
  const normUID = (uid || '').toString().trim().toUpperCase();
  if (ADMIN_UIDS.includes(normUID)) {
    showNotification('You cannot remove an ADMIN account.', 'error');
    return;
  }
  if (!confirm(`Are you sure you want to remove ${name}? This action cannot be undone.`)) {
    return;
  }
  
  try {
    const response = await fetch(`${API_URL}?action=remove_member&uid=${uid}`);
    const data = await response.json();
    
    if (data.status === 'success') {
      showNotification(`${name} has been removed!`, 'success');
      modal.style.display = 'none';
      loadMembers();
      showRemoveMemberModalAdmin();
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
      
      const membersHTML = data.members.map((m, i) => `
        <div style="padding: 12px; border-bottom: 1px solid rgba(102, 126, 234, 0.1); background: ${i % 2 === 0 ? 'rgba(102, 126, 234, 0.02)' : 'transparent'}; border-radius: 6px; margin-bottom: 6px;">
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <div>
              <div style="font-weight: 600; color: var(--text);">${i + 1}. ${m.name}${ADMIN_UIDS.includes(((m.uid||'')+ '').toUpperCase()) ? ' <span class=\"admin-badge\">ADMIN</span>' : ''}</div>
              <div style="font-size: 12px; color: var(--muted);">UID: ${(m.uid||'')+''}</div>
            </div>
            <span style="font-size: 12px; background: ${ADMIN_UIDS.includes(((m.uid||'')+ '').toUpperCase()) ? 'rgba(255, 193, 7, 0.2)' : 'rgba(102, 126, 234, 0.2)'}; color: ${ADMIN_UIDS.includes(((m.uid||'')+ '').toUpperCase()) ? '#FFC107' : 'var(--info-color)'}; padding: 4px 8px; border-radius: 4px;">
              ${ADMIN_UIDS.includes(((m.uid||'')+ '').toUpperCase()) ? '⭐ Admin' : 'Faculty'}
            </span>
          </div>
        </div>
      `).join('');
      
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
