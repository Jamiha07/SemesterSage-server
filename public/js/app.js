// Replaces a native <select> popup (which renders as a jarring unstyled OS picker on
// mobile) with a themed dropdown. `container` is an empty element that gets filled in;
// `options` is [{value, label}]; returns { get value(), set value(v) }.
function createCustomSelect(container, options, initialValue, onChange) {
    container.classList.add('custom-select');
    container.innerHTML = `<button type="button" class="custom-select-trigger"></button><div class="custom-select-options"></div>`;
    const trigger = container.querySelector('.custom-select-trigger');
    const list = container.querySelector('.custom-select-options');
    let value = initialValue !== undefined ? String(initialValue) : (options[0] && String(options[0].value));

    function render() {
        const selected = options.find(o => String(o.value) === value);
        trigger.textContent = selected ? selected.label : '';
        list.innerHTML = options.map(o =>
            `<div class="custom-select-option${String(o.value) === value ? ' selected' : ''}" data-value="${o.value}">${escapeHtml(o.label)}</div>`
        ).join('');
    }

    trigger.onclick = (e) => {
        e.stopPropagation();
        document.querySelectorAll('.custom-select-options.open').forEach(el => { if (el !== list) el.classList.remove('open'); });
        list.classList.toggle('open');
    };

    list.addEventListener('click', (e) => {
        const opt = e.target.closest('.custom-select-option');
        if (!opt) return;
        value = opt.dataset.value;
        render();
        list.classList.remove('open');
        if (onChange) onChange(value);
    });

    document.addEventListener('click', () => list.classList.remove('open'));

    render();
    return {
        get value() { return value; },
        set value(v) { value = String(v); render(); }
    };
}

// Renders the shared topbar + sidebar shell into #shell, and wires up navigation.
// activeMenu is one of: 'home', 'tracker', 'profile', 'admin' -- used to highlight the current page.
async function renderShell(activeMenu) {
    requireLogin();
    const user = getUser();

    document.getElementById('shell').innerHTML = `
        <div class="topbar">
            <button class="icon-btn" id="sidebarToggle">&#9776;</button>
            <span class="app-title">SemesterSage</span>
            <input class="search-input" id="searchInput" type="text" placeholder="&#128269; Search questions...">
            <div class="topbar-spacer"></div>
            <span class="welcome-text">Welcome, ${escapeHtml(user.username)}!</span>
        </div>
        <div class="sidebar-scrim" id="sidebarScrim"></div>
        <div class="sidebar" id="sidebar">
            <div class="sidebar-heading heading-menu">MAIN MENU</div>
            <button class="menu-btn ${activeMenu === 'home' ? 'active' : ''}" onclick="location.href='feed.html'">&#127968; Home Feed</button>
            <button class="menu-btn ${activeMenu === 'tracker' ? 'active' : ''}" onclick="location.href='tracker.html'">Study Tracker</button>
            <button class="menu-btn" id="profileMenuBtn">My Profile</button>
            ${user.isAdmin ? `<button class="menu-btn ${activeMenu === 'admin' ? 'active' : ''}" onclick="location.href='admin.html'">Admin Panel</button>` : ''}
            <button class="menu-btn" id="otherSemestersBtn">Other Semesters</button>
            <div class="course-list" id="otherSemestersList" style="display:none;"></div>

            <div class="sidebar-heading heading-channels">COMMUNITY</div>
            <button class="menu-btn" onclick="location.href='feed.html?course=General'">General Chat</button>

            <div class="sidebar-heading heading-subjects">ACADEMIC SUBJECTS</div>
            <div class="course-list" id="subjectsList">Loading...</div>
        </div>
    `;

    document.getElementById('sidebarToggle').onclick = () => toggleSidebar();
    document.getElementById('sidebarScrim').onclick = () => toggleSidebar(false);
    document.getElementById('otherSemestersBtn').onclick = () => toggleOtherSemesters();
    document.getElementById('profileMenuBtn').onclick = () => openProfileModal();

    // Sidebar starts open on wide screens (pushes content over) and closed on
    // narrow ones (opens as an overlay) -- the toggle then works the same either way.
    toggleSidebar(window.innerWidth >= 900);

    loadSidebarCourses(user);
    injectProfileModal();
}

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

function toggleSidebar(force) {
    const sidebar = document.getElementById('sidebar');
    const scrim = document.getElementById('sidebarScrim');
    const shouldOpen = force !== undefined ? force : !sidebar.classList.contains('open');
    sidebar.classList.toggle('open', shouldOpen);
    scrim.classList.toggle('show', shouldOpen && window.innerWidth < 900);
    document.body.classList.toggle('sidebar-open', shouldOpen);
}

async function loadSidebarCourses(user, semester) {
    const sem = semester || user.semester;
    const container = document.getElementById('subjectsList');
    container.innerHTML = 'Loading...';
    try {
        const courses = await api(`/courses?program=${user.program}&semester=${sem}`);
        if (courses.length === 0) {
            container.innerHTML = '<p class="text-secondary" style="font-size:12px;">No courses added yet for this semester.</p>';
            return;
        }
        container.innerHTML = courses.map(c =>
            `<button class="menu-btn" onclick="location.href='feed.html?course=${encodeURIComponent(c.name)}'">${c.code} &mdash; ${c.name}</button>`
        ).join('');
    } catch (err) {
        container.innerHTML = '<p class="text-secondary" style="font-size:12px;">Could not load courses.</p>';
    }
}

// Mirrors DashboardController's "Other Semesters" panel -- just semester names to pick
// from; picking one repopulates the ACADEMIC SUBJECTS list for that semester, still
// strictly scoped to the student's own program (not a dump of every course at once).
let otherSemestersLoaded = false;
async function toggleOtherSemesters() {
    const list = document.getElementById('otherSemestersList');
    const isOpen = list.style.display !== 'none';
    if (isOpen) { list.style.display = 'none'; return; }

    list.style.display = 'block';
    if (otherSemestersLoaded) return;
    otherSemestersLoaded = true;

    list.innerHTML = [1,2,3,4,5,6,7,8].map(sem =>
        `<button class="menu-btn" style="font-size:12px;" onclick="loadSidebarCourses(getUser(), ${sem})">Semester ${sem}</button>`
    ).join('');
}

function logout() {
    clearSession();
    window.location.href = 'login.html';
}

// --- Profile modal -- a true centered popup reachable from any page, matching the
// desktop app's actual behavior (a floating Stage, not a page tied to the sidebar layout). ---

const AVATAR_GRADIENTS = {
    1: ['#00c8ff', '#a855f7'], 2: ['#10b981', '#059669'], 3: ['#f97316', '#ec4899'],
    4: ['#ef4444', '#dc2626'], 5: ['#3b82f6', '#2563eb'], 6: ['#eab308', '#f59e0b']
};

function injectProfileModal() {
    if (document.getElementById('profileModal')) return;

    const wrapper = document.createElement('div');
    wrapper.innerHTML = `
        <div class="modal-overlay" id="profileModal">
            <div class="modal-box" style="max-width:380px;">
                <div style="display:flex; justify-content:space-between; align-items:center;">
                    <h3 style="margin:0;">My Profile</h3>
                    <button class="icon-btn" style="font-size:22px;" onclick="closeProfileModal()">&times;</button>
                </div>
                <div style="height:2px; background:linear-gradient(to right, var(--cyan), var(--purple)); border-radius:2px; margin:10px 0 20px;"></div>

                <div style="text-align:center;">
                    <div id="profileAvatarRing" style="width:90px; height:90px; border-radius:50%; margin:0 auto 14px; display:flex; align-items:center; justify-content:center; box-shadow:0 0 15px rgba(0,200,255,0.45);">
                        <div style="width:78px; height:78px; border-radius:50%; background:var(--bg); display:flex; align-items:center; justify-content:center; font-size:34px; font-weight:bold;" id="profileAvatarLetter">?</div>
                    </div>
                    <h2 id="profileUsername" style="margin:4px 0;">@loading</h2>
                    <span id="profileBadge" style="display:inline-block; padding:5px 15px; border-radius:20px; font-weight:bold; font-size:13px; margin-bottom:8px;"></span>
                </div>

                <div style="background:var(--input); border-radius:10px; padding:12px 14px; display:flex; align-items:center; gap:12px; margin-top:20px;">
                    <div style="width:32px; height:32px; min-width:32px; border-radius:50%; background:linear-gradient(to bottom right,#2563eb,#38bdf8); display:flex; align-items:center; justify-content:center; font-size:14px;">&#9993;</div>
                    <div>
                        <div style="font-size:10px; color:var(--text-secondary); font-weight:bold; letter-spacing:1px;">UNIVERSITY EMAIL</div>
                        <div id="profileEmail" style="font-size:13px;"></div>
                    </div>
                </div>

                <div style="background:var(--input); border-radius:10px; padding:12px 14px; margin-top:12px;">
                    <div style="display:flex; align-items:center; gap:12px; margin-bottom:10px;">
                        <div style="width:32px; height:32px; min-width:32px; border-radius:50%; background:linear-gradient(to bottom right,#2563eb,#38bdf8); display:flex; align-items:center; justify-content:center; font-size:14px;">&#128197;</div>
                        <div style="font-size:10px; color:var(--text-secondary); font-weight:bold; letter-spacing:1px;">CURRENT SEMESTER</div>
                    </div>
                    <div style="display:flex; gap:10px; align-items:center;">
                        <div id="profileSemesterSelect" style="flex:1; background:var(--bg); border-radius:8px; padding:0 10px;"></div>
                        <button class="btn btn-primary" style="margin:0; padding:10px 20px;" onclick="updateProfileSemester()">Update</button>
                    </div>
                </div>

                <button class="btn btn-primary" style="width:100%; margin-top:22px;" onclick="logout()">&rarr; Sign Out</button>
                <button class="btn btn-danger" style="width:100%; margin-top:10px;" onclick="openDeleteAccountModal()">&#128465; Delete Account</button>
            </div>
        </div>

        <div class="modal-overlay" id="deleteAccountModal">
            <div class="modal-box danger">
                <p style="font-weight:bold; text-align:center; color:var(--red);">&#9888;&#65039; Delete Account</p>
                <p class="text-secondary" style="font-size:13px;">Enter your password to confirm:</p>
                <input id="deleteAccountPassword" type="password" placeholder="Password">
                <p class="error-text" id="deleteAccountError"></p>
                <div style="display:flex; gap:10px; margin-top:18px;">
                    <button class="btn btn-ghost" style="flex:1;" onclick="closeDeleteAccountModal()">Cancel</button>
                    <button class="btn btn-danger" style="flex:1;" onclick="confirmDeleteAccountFromModal()">Confirm Delete</button>
                </div>
            </div>
        </div>
    `;
    document.body.appendChild(wrapper);
}

let profileSemesterSelect;

function openProfileModal() {
    const user = getUser();
    document.getElementById('profileUsername').textContent = '@' + user.username;
    document.getElementById('profileEmail').textContent = user.email;
    document.getElementById('profileAvatarLetter').textContent = user.username[0].toUpperCase();

    const semesterOptions = [1,2,3,4,5,6,7,8].map(n => ({ value: n, label: String(n) }));
    profileSemesterSelect = createCustomSelect(document.getElementById('profileSemesterSelect'), semesterOptions, user.semester);

    const [c1, c2] = AVATAR_GRADIENTS[user.avatarId] || AVATAR_GRADIENTS[1];
    document.getElementById('profileAvatarRing').style.background = `linear-gradient(to bottom right, ${c1}, ${c2})`;

    renderProfileBadge(user.semester);

    document.getElementById('profileModal').classList.add('show');
}

// Based on current semester (updates live when you change it), not batch year -- the
// desktop app's version was batch-based and never changed after registration.
function renderProfileBadge(semester) {
    const badge = document.getElementById('profileBadge');
    if (semester <= 2) {
        badge.textContent = '\u{1F331} Curious Freshman';
        badge.style.background = '#dcfce7'; badge.style.color = '#166534';
    } else if (semester <= 5) {
        badge.textContent = '\u{1F4DA} Wise Sophomore';
        badge.style.background = '#fef08a'; badge.style.color = '#854d0e';
    } else if (semester <= 7) {
        badge.textContent = '\u{1F9ED} Focused Junior';
        badge.style.background = '#fed7aa'; badge.style.color = '#9a3412';
    } else {
        badge.textContent = '\u{1F393} Honorable Senior';
        badge.style.background = '#e0e7ff'; badge.style.color = '#3730a3';
    }
}

function closeProfileModal() {
    document.getElementById('profileModal').classList.remove('show');
}

async function updateProfileSemester() {
    const newSem = parseInt(profileSemesterSelect.value, 10);
    try {
        await api('/users/me/semester', { method: 'PATCH', body: JSON.stringify({ semester: newSem }) });
        const user = getUser();
        user.semester = newSem;
        saveSession(getToken(), user);
        renderProfileBadge(newSem);
    } catch (err) {
        alert(err.message);
    }
}

function openDeleteAccountModal() {
    closeProfileModal();
    document.getElementById('deleteAccountModal').classList.add('show');
}
function closeDeleteAccountModal() {
    document.getElementById('deleteAccountModal').classList.remove('show');
    document.getElementById('deleteAccountPassword').value = '';
    document.getElementById('deleteAccountError').classList.remove('show');
}

async function confirmDeleteAccountFromModal() {
    const password = document.getElementById('deleteAccountPassword').value;
    const errEl = document.getElementById('deleteAccountError');
    try {
        await api('/users/me', { method: 'DELETE', body: JSON.stringify({ password }) });
        clearSession();
        window.location.href = 'login.html';
    } catch (err) {
        errEl.textContent = err.message;
        errEl.classList.add('show');
    }
}
