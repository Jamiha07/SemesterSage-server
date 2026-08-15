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
            <button class="icon-btn" id="sageToggle" title="Ask Sage">&#129302;</button>
        </div>
        <div class="sidebar-scrim" id="sidebarScrim"></div>
        <div class="sidebar" id="sidebar">
            <div class="sidebar-heading heading-menu">MAIN MENU</div>
            <button class="menu-btn ${activeMenu === 'home' ? 'active' : ''}" onclick="location.href='feed.html'">&#127968; Home Feed</button>
            <button class="menu-btn ${activeMenu === 'tracker' ? 'active' : ''}" onclick="location.href='tracker.html'">&#9989; Study Tracker</button>
            <button class="menu-btn ${activeMenu === 'profile' ? 'active' : ''}" onclick="location.href='profile.html'">&#128100; My Profile</button>
            ${user.isAdmin ? `<button class="menu-btn ${activeMenu === 'admin' ? 'active' : ''}" onclick="location.href='admin.html'">&#128736; Admin Panel</button>` : ''}
            <button class="menu-btn" id="otherSemestersBtn">&#128197; Other Semesters</button>
            <div class="course-list" id="otherSemestersList" style="display:none;"></div>

            <div class="sidebar-heading heading-channels">COMMUNITY</div>
            <button class="menu-btn" onclick="location.href='feed.html?course=General'">&#128172; General Chat</button>

            <div class="sidebar-heading heading-subjects">ACADEMIC SUBJECTS</div>
            <div class="course-list" id="subjectsList">Loading...</div>
        </div>
    `;

    document.getElementById('sidebarToggle').onclick = () => toggleSidebar();
    document.getElementById('sidebarScrim').onclick = () => toggleSidebar(false);
    document.getElementById('sageToggle').onclick = () => window.location.href = 'sage.html';
    document.getElementById('otherSemestersBtn').onclick = () => toggleOtherSemesters();

    // Sidebar starts open on wide screens (pushes content over) and closed on
    // narrow ones (opens as an overlay) -- the toggle then works the same either way.
    toggleSidebar(window.innerWidth >= 900);

    loadSidebarCourses(user);
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
