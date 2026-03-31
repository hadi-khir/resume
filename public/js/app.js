/* ===================================
   ResumeForge - ATS-Friendly Resume Builder
   All dynamic user values are escaped via esc() (textContent-based)
   before interpolation into HTML strings to prevent XSS.
   =================================== */

// ── API Helper ─────────────────────────────
async function api(method, path, body) {
  var opts = {
    method: method,
    headers: { 'Content-Type': 'application/json' }
  };
  if (body) opts.body = JSON.stringify(body);
  var res = await fetch('/api' + path, opts);
  var data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

// ── State ──────────────────────────────────
var state = {
  user: null,
  currentResumeId: null,
  resumeList: [],
  template: 'modern',
  drawerOpen: false,
  openSections: ['personal'],
  data: emptyResumeData()
};

function emptyResumeData() {
  return {
    personal: { firstName: '', lastName: '', title: '', email: '', phone: '', location: '', linkedin: '', website: '' },
    summary: '',
    experience: [],
    education: [],
    skills: [],
    projects: [],
    certifications: []
  };
}

// ── Section Definitions ────────────────────
var SECTIONS = [
  { id: 'personal', title: 'Personal Info', icon: 'U' },
  { id: 'summary', title: 'Summary', icon: 'S' },
  { id: 'skills', title: 'Skills', icon: 'K' },
  { id: 'experience', title: 'Experience', icon: 'E' },
  { id: 'education', title: 'Education', icon: 'G' },
  { id: 'projects', title: 'Projects', icon: 'P' },
  { id: 'certifications', title: 'Certifications', icon: 'C' }
];

// ── Template Definitions ───────────────────
var TEMPLATES = {
  classic: { name: 'Classic', accent: '#333' },
  modern: { name: 'Modern', accent: '#1e3a5f' },
  minimal: { name: 'Minimal', accent: '#888' },
  executive: { name: 'Executive', accent: '#111827' },
  elegant: { name: 'Elegant', accent: '#8b6f4e' }
};

// ── Utility Functions ──────────────────────
var _escapeEl = document.createElement('span');
function esc(str) {
  if (!str) return '';
  _escapeEl.textContent = str;
  return _escapeEl.innerHTML;
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  var parts = dateStr.split('-');
  if (parts.length === 1) return parts[0];
  var months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return months[parseInt(parts[1], 10) - 1] + ' ' + parts[0];
}

function dateRange(start, end, current) {
  var s = formatDate(start);
  var e = current ? 'Present' : formatDate(end);
  if (!s && !e) return '';
  if (!s) return e;
  if (!e) return s;
  return s + ' \u2014 ' + e;
}

function bulletLines(text) {
  if (!text) return '';
  var lines = text.split('\n').filter(function(l) { return l.trim(); });
  if (lines.length === 0) return '';
  return '<ul>' + lines.map(function(l) { return '<li>' + esc(l.replace(/^[-\u2022]\s*/, '')) + '</li>'; }).join('') + '</ul>';
}

function debounce(fn, ms) {
  var t;
  return function() {
    var args = arguments;
    var ctx = this;
    clearTimeout(t);
    t = setTimeout(function() { fn.apply(ctx, args); }, ms);
  };
}

// ── Auth Flow ──────────────────────────────
var authMode = 'login';

function initAuth() {
  var overlay = document.getElementById('authOverlay');
  var form = document.getElementById('authForm');
  var switchBtn = document.getElementById('authSwitchBtn');

  switchBtn.addEventListener('click', function() {
    authMode = authMode === 'login' ? 'register' : 'login';
    updateAuthUI();
  });

  form.addEventListener('submit', async function(e) {
    e.preventDefault();
    var email = document.getElementById('authEmail').value.trim();
    var password = document.getElementById('authPassword').value;
    var submitBtn = document.getElementById('authSubmit');
    var errorEl = document.getElementById('authError');

    errorEl.classList.remove('visible');
    submitBtn.disabled = true;
    submitBtn.textContent = authMode === 'login' ? 'Signing in...' : 'Creating account...';

    try {
      if (authMode === 'register') {
        var name = document.getElementById('authName').value.trim();
        state.user = await api('POST', '/auth/register', { email: email, name: name, password: password });
      } else {
        state.user = await api('POST', '/auth/login', { email: email, password: password });
      }
      overlay.classList.add('hidden');
      await loadApp();
    } catch (err) {
      errorEl.textContent = err.message;
      errorEl.classList.add('visible');
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = authMode === 'login' ? 'Sign In' : 'Create Account';
    }
  });
}

function updateAuthUI() {
  document.getElementById('authTitle').textContent =
    authMode === 'login' ? 'Sign in to your account' : 'Create your account';
  document.getElementById('authSubmit').textContent =
    authMode === 'login' ? 'Sign In' : 'Create Account';
  document.getElementById('authSwitchText').textContent =
    authMode === 'login' ? "Don't have an account?" : 'Already have an account?';
  document.getElementById('authSwitchBtn').textContent =
    authMode === 'login' ? 'Create one' : 'Sign in';
  document.getElementById('authNameField').style.display =
    authMode === 'register' ? 'block' : 'none';
  document.getElementById('authError').classList.remove('visible');
}

// ── Auto-save ──────────────────────────────
var saveToServer = debounce(async function() {
  if (!state.currentResumeId) return;
  var statusEl = document.getElementById('saveStatus');
  statusEl.textContent = 'Saving...';
  statusEl.className = 'save-status saving';
  try {
    await api('PUT', '/resumes/' + state.currentResumeId, {
      template: state.template,
      data: state.data
    });
    statusEl.textContent = 'Saved';
    statusEl.className = 'save-status saved';
    setTimeout(function() {
      if (statusEl.textContent === 'Saved') {
        statusEl.textContent = '';
        statusEl.className = 'save-status';
      }
    }, 2000);
  } catch (err) {
    statusEl.textContent = 'Save failed';
    statusEl.className = 'save-status';
  }
}, 1500);

// ── Load App After Auth ────────────────────
async function loadApp() {
  var avatar = document.getElementById('userAvatar');
  var initial = (state.user.name || state.user.email || '?')[0].toUpperCase();
  avatar.textContent = initial;
  document.getElementById('userDropdownInfo').textContent = state.user.email;

  state.resumeList = await api('GET', '/resumes');

  if (state.resumeList.length === 0) {
    var newResume = await api('POST', '/resumes', {
      name: 'My Resume',
      template: 'modern',
      data: emptyResumeData()
    });
    state.resumeList = [{ id: newResume.id, name: newResume.name, template: newResume.template }];
  }

  renderResumeSelect();
  await loadResume(state.resumeList[0].id);

  renderTemplateCards();
  renderEditor();
  renderPreview();
  initEvents();
}

async function loadResume(id) {
  var resume = await api('GET', '/resumes/' + id);
  state.currentResumeId = resume.id;
  state.template = resume.template;
  state.data = resume.data;

  var empty = emptyResumeData();
  Object.keys(empty).forEach(function(key) {
    if (state.data[key] === undefined) state.data[key] = empty[key];
  });
  if (!state.data.personal) state.data.personal = empty.personal;
  Object.keys(empty.personal).forEach(function(key) {
    if (state.data.personal[key] === undefined) state.data.personal[key] = '';
  });
}

function renderResumeSelect() {
  var select = document.getElementById('resumeSelect');
  select.textContent = '';
  state.resumeList.forEach(function(r) {
    var opt = document.createElement('option');
    opt.value = r.id;
    opt.textContent = r.name;
    if (r.id === state.currentResumeId) opt.selected = true;
    select.appendChild(opt);
  });
}

// ── Template Renderers ─────────────────────
function renderContactRow(p, sep) {
  var items = [];
  if (p.email) items.push(esc(p.email));
  if (p.phone) items.push(esc(p.phone));
  if (p.location) items.push(esc(p.location));
  if (p.linkedin) items.push(esc(p.linkedin));
  if (p.website) items.push(esc(p.website));
  return items.join(' <span class="contact-sep">' + esc(sep) + '</span> ');
}

function renderSectionEntries(type, data) {
  if (type === 'experience') {
    return data.experience.map(function(e) {
      return '<div class="entry"><div class="entry-top"><div>' +
        '<h3>' + esc(e.company) + '</h3>' +
        '<div class="entry-sub">' + esc(e.position) + '</div>' +
        '</div><div class="entry-dates">' + dateRange(e.startDate, e.endDate, e.current) +
        (e.location ? '<div class="entry-location">' + esc(e.location) + '</div>' : '') +
        '</div></div>' +
        bulletLines(e.description) + '</div>';
    }).join('');
  }
  if (type === 'education') {
    return data.education.map(function(e) {
      return '<div class="entry"><div class="entry-top"><div>' +
        '<h3>' + esc(e.institution) + '</h3>' +
        '<div class="entry-sub">' + esc(e.degree) + (e.field ? ' in ' + esc(e.field) : '') + (e.gpa ? ' | GPA: ' + esc(e.gpa) : '') + '</div>' +
        '</div><div class="entry-dates">' + dateRange(e.startDate, e.endDate, false) + '</div></div></div>';
    }).join('');
  }
  if (type === 'projects') {
    return data.projects.map(function(e) {
      return '<div class="entry"><div class="entry-top">' +
        '<h3>' + esc(e.name) + (e.link ? ' <span class="entry-sub" style="font-weight:400">\u2014 ' + esc(e.link) + '</span>' : '') + '</h3>' +
        '</div>' +
        (e.technologies ? '<div class="entry-sub">Technologies: ' + esc(e.technologies) + '</div>' : '') +
        (e.description ? '<p style="margin-top:3px">' + esc(e.description) + '</p>' : '') + '</div>';
    }).join('');
  }
  if (type === 'certifications') {
    return data.certifications.map(function(e) {
      return '<div class="entry"><div class="entry-top"><div>' +
        '<h3>' + esc(e.name) + '</h3>' +
        '<div class="entry-sub">' + esc(e.issuer) + '</div>' +
        '</div><div class="entry-dates">' + formatDate(e.date) + '</div></div></div>';
    }).join('');
  }
  return '';
}

function renderSkills(skills) {
  if (!skills.length) return '';
  return '<div class="skills-list">' + skills.map(function(s) { return '<span>' + esc(s) + '</span>'; }).join('') + '</div>';
}

function hasContent(d) {
  return d.personal.firstName || d.personal.lastName || d.summary ||
    d.experience.length || d.education.length || d.skills.length ||
    d.projects.length || d.certifications.length;
}

function sectionHasContent(type, d) {
  if (type === 'summary') return !!d.summary;
  if (type === 'experience') return d.experience.length > 0 && d.experience.some(function(e) { return e.position || e.company; });
  if (type === 'education') return d.education.length > 0 && d.education.some(function(e) { return e.institution || e.degree; });
  if (type === 'skills') return d.skills.length > 0;
  if (type === 'projects') return d.projects.length > 0 && d.projects.some(function(e) { return e.name; });
  if (type === 'certifications') return d.certifications.length > 0 && d.certifications.some(function(e) { return e.name; });
  return false;
}

function buildSections(d) {
  var html = '';
  if (sectionHasContent('summary', d)) {
    html += '<div class="section"><h2>Professional Summary</h2><p class="summary-text">' + esc(d.summary) + '</p></div>';
  }
  if (sectionHasContent('skills', d)) {
    html += '<div class="section"><h2>Skills</h2>' + renderSkills(d.skills) + '</div>';
  }
  if (sectionHasContent('experience', d)) {
    html += '<div class="section"><h2>Experience</h2>' + renderSectionEntries('experience', d) + '</div>';
  }
  if (sectionHasContent('education', d)) {
    html += '<div class="section"><h2>Education</h2>' + renderSectionEntries('education', d) + '</div>';
  }
  if (sectionHasContent('projects', d)) {
    html += '<div class="section"><h2>Projects</h2>' + renderSectionEntries('projects', d) + '</div>';
  }
  if (sectionHasContent('certifications', d)) {
    html += '<div class="section"><h2>Certifications</h2>' + renderSectionEntries('certifications', d) + '</div>';
  }
  return html;
}

var templateRenderers = {
  classic: function(d) {
    var name = [d.personal.firstName, d.personal.lastName].filter(Boolean).join(' ');
    return '<div class="resume template-classic">' +
      (name ? '<h1>' + esc(name) + '</h1>' : '') +
      (d.personal.title ? '<div class="resume-title">' + esc(d.personal.title) + '</div>' : '') +
      '<div class="contact-row">' + renderContactRow(d.personal, '|') + '</div>' +
      buildSections(d) + '</div>';
  },
  modern: function(d) {
    var name = [d.personal.firstName, d.personal.lastName].filter(Boolean).join(' ');
    return '<div class="resume template-modern"><div class="modern-header">' +
      (name ? '<h1>' + esc(name) + '</h1>' : '') +
      (d.personal.title ? '<div class="resume-title">' + esc(d.personal.title) + '</div>' : '') +
      '<div class="contact-row">' + renderContactRow(d.personal, '\u00b7') + '</div>' +
      '</div><div class="modern-body">' + buildSections(d) + '</div></div>';
  },
  minimal: function(d) {
    var name = [d.personal.firstName, d.personal.lastName].filter(Boolean).join(' ');
    return '<div class="resume template-minimal">' +
      (name ? '<h1>' + esc(name) + '</h1>' : '') +
      (d.personal.title ? '<div class="resume-title">' + esc(d.personal.title) + '</div>' : '') +
      '<div class="contact-row">' + renderContactRow(d.personal, '\u00b7') + '</div>' +
      buildSections(d) + '</div>';
  },
  executive: function(d) {
    var name = [d.personal.firstName, d.personal.lastName].filter(Boolean).join(' ');
    var contactLines = [];
    if (d.personal.email) contactLines.push(esc(d.personal.email));
    if (d.personal.phone) contactLines.push(esc(d.personal.phone));
    if (d.personal.location) contactLines.push(esc(d.personal.location));
    if (d.personal.linkedin) contactLines.push(esc(d.personal.linkedin));
    if (d.personal.website) contactLines.push(esc(d.personal.website));
    return '<div class="resume template-executive"><div class="exec-header"><div>' +
      (name ? '<h1>' + esc(name) + '</h1>' : '') +
      (d.personal.title ? '<div class="resume-title">' + esc(d.personal.title) + '</div>' : '') +
      '</div><div class="exec-contact">' + contactLines.join('<br>') + '</div></div>' +
      '<div class="exec-body">' + buildSections(d) + '</div></div>';
  },
  elegant: function(d) {
    var name = [d.personal.firstName, d.personal.lastName].filter(Boolean).join(' ');
    return '<div class="resume template-elegant">' +
      (name ? '<h1>' + esc(name) + '</h1>' : '') +
      (d.personal.title ? '<div class="resume-title">' + esc(d.personal.title) + '</div>' : '') +
      '<div class="contact-row">' + renderContactRow(d.personal, '\u00b7') + '</div>' +
      '<div class="elegant-divider"></div>' +
      buildSections(d) + '</div>';
  }
};

// ── Editor Rendering ───────────────────────
function chevronSVG() {
  return '<svg class="section-chevron" width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M4 6l4 4 4-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
}

function renderEditorSection(section) {
  var isOpen = state.openSections.includes(section.id);
  return '<div class="editor-section' + (isOpen ? ' open' : '') + '" data-section="' + section.id + '">' +
    '<div class="section-header" data-toggle="' + section.id + '">' +
    '<div class="section-header-left">' +
    '<div class="section-icon">' + section.icon + '</div>' +
    '<div class="section-title">' + section.title + '</div>' +
    '</div>' + chevronSVG() + '</div>' +
    '<div class="section-body"><div class="section-content">' +
    renderSectionFields(section.id) +
    '</div></div></div>';
}

function renderSectionFields(sectionId) {
  var d = state.data;
  switch (sectionId) {
    case 'personal':
      return '<div class="field-row">' +
        '<div class="field-group"><label class="field-label">First Name</label>' +
        '<input class="field-input" data-section="personal" data-field="firstName" value="' + esc(d.personal.firstName) + '" placeholder="John"></div>' +
        '<div class="field-group"><label class="field-label">Last Name</label>' +
        '<input class="field-input" data-section="personal" data-field="lastName" value="' + esc(d.personal.lastName) + '" placeholder="Doe"></div></div>' +
        '<div class="field-group"><label class="field-label">Job Title</label>' +
        '<input class="field-input" data-section="personal" data-field="title" value="' + esc(d.personal.title) + '" placeholder="Software Engineer"></div>' +
        '<div class="field-row">' +
        '<div class="field-group"><label class="field-label">Email</label>' +
        '<input class="field-input" type="email" data-section="personal" data-field="email" value="' + esc(d.personal.email) + '" placeholder="john@email.com"></div>' +
        '<div class="field-group"><label class="field-label">Phone</label>' +
        '<input class="field-input" data-section="personal" data-field="phone" value="' + esc(d.personal.phone) + '" placeholder="(555) 123-4567"></div></div>' +
        '<div class="field-group"><label class="field-label">Location</label>' +
        '<input class="field-input" data-section="personal" data-field="location" value="' + esc(d.personal.location) + '" placeholder="City, State"></div>' +
        '<div class="field-row">' +
        '<div class="field-group"><label class="field-label">LinkedIn</label>' +
        '<input class="field-input" data-section="personal" data-field="linkedin" value="' + esc(d.personal.linkedin) + '" placeholder="linkedin.com/in/johndoe"></div>' +
        '<div class="field-group"><label class="field-label">Website</label>' +
        '<input class="field-input" data-section="personal" data-field="website" value="' + esc(d.personal.website) + '" placeholder="johndoe.com"></div></div>';

    case 'summary':
      return '<div class="field-group"><label class="field-label">Professional Summary</label>' +
        '<textarea class="field-input" data-section="summary" data-field="text" rows="5" placeholder="Brief overview of your professional background...">' + esc(d.summary) + '</textarea>' +
        '<div class="field-hint">2-4 sentences highlighting your experience and value proposition</div></div>';

    case 'experience':
      return d.experience.map(function(exp, i) {
        return '<div class="entry-card" data-index="' + i + '">' +
          '<div class="entry-header"><span class="entry-number">Position ' + (i + 1) + '</span>' +
          '<button class="entry-remove" data-remove="experience" data-index="' + i + '" title="Remove">' +
          '<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg></button></div>' +
          '<div class="field-row">' +
          '<div class="field-group"><label class="field-label">Position</label>' +
          '<input class="field-input" data-section="experience" data-index="' + i + '" data-field="position" value="' + esc(exp.position) + '" placeholder="Software Engineer"></div>' +
          '<div class="field-group"><label class="field-label">Company</label>' +
          '<input class="field-input" data-section="experience" data-index="' + i + '" data-field="company" value="' + esc(exp.company) + '" placeholder="Company Name"></div></div>' +
          '<div class="field-group"><label class="field-label">Location</label>' +
          '<input class="field-input" data-section="experience" data-index="' + i + '" data-field="location" value="' + esc(exp.location || '') + '" placeholder="City, State"></div>' +
          '<div class="field-row">' +
          '<div class="field-group"><label class="field-label">Start Date</label>' +
          '<input class="field-input" type="month" data-section="experience" data-index="' + i + '" data-field="startDate" value="' + exp.startDate + '"></div>' +
          '<div class="field-group"><label class="field-label">End Date</label>' +
          '<input class="field-input" type="month" data-section="experience" data-index="' + i + '" data-field="endDate" value="' + exp.endDate + '"' + (exp.current ? ' disabled' : '') + '></div></div>' +
          '<div class="checkbox-group">' +
          '<input type="checkbox" id="current-' + i + '" data-section="experience" data-index="' + i + '" data-field="current"' + (exp.current ? ' checked' : '') + '>' +
          '<label for="current-' + i + '">Currently working here</label></div>' +
          '<div class="field-group"><label class="field-label">Description</label>' +
          '<textarea class="field-input" data-section="experience" data-index="' + i + '" data-field="description" rows="4" placeholder="Key achievements (one per line)...">' + esc(exp.description) + '</textarea>' +
          '<div class="field-hint">Each line becomes a bullet point. Start with action verbs.</div></div></div>';
      }).join('') + '<button class="add-entry-btn" data-add="experience">+ Add Experience</button>';

    case 'education':
      return d.education.map(function(edu, i) {
        return '<div class="entry-card" data-index="' + i + '">' +
          '<div class="entry-header"><span class="entry-number">Education ' + (i + 1) + '</span>' +
          '<button class="entry-remove" data-remove="education" data-index="' + i + '" title="Remove">' +
          '<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg></button></div>' +
          '<div class="field-group"><label class="field-label">Institution</label>' +
          '<input class="field-input" data-section="education" data-index="' + i + '" data-field="institution" value="' + esc(edu.institution) + '" placeholder="University Name"></div>' +
          '<div class="field-row">' +
          '<div class="field-group"><label class="field-label">Degree</label>' +
          '<input class="field-input" data-section="education" data-index="' + i + '" data-field="degree" value="' + esc(edu.degree) + '" placeholder="Bachelor of Science"></div>' +
          '<div class="field-group"><label class="field-label">Field of Study</label>' +
          '<input class="field-input" data-section="education" data-index="' + i + '" data-field="field" value="' + esc(edu.field) + '" placeholder="Computer Science"></div></div>' +
          '<div class="field-row">' +
          '<div class="field-group"><label class="field-label">Start Year</label>' +
          '<input class="field-input" data-section="education" data-index="' + i + '" data-field="startDate" value="' + edu.startDate + '" placeholder="2017"></div>' +
          '<div class="field-group"><label class="field-label">End Year</label>' +
          '<input class="field-input" data-section="education" data-index="' + i + '" data-field="endDate" value="' + edu.endDate + '" placeholder="2021"></div></div>' +
          '<div class="field-group"><label class="field-label">GPA (optional)</label>' +
          '<input class="field-input" data-section="education" data-index="' + i + '" data-field="gpa" value="' + esc(edu.gpa) + '" placeholder="3.8"></div></div>';
      }).join('') + '<button class="add-entry-btn" data-add="education">+ Add Education</button>';

    case 'skills':
      return '<div class="field-group"><label class="field-label">Skills</label>' +
        '<div class="skills-input-wrapper" id="skillsWrapper">' +
        d.skills.map(function(s, i) {
          return '<span class="skill-tag" data-skill-index="' + i + '">' + esc(s) +
            '<button data-remove-skill="' + i + '">\u00d7</button></span>';
        }).join('') +
        '<input class="skill-input" id="skillInput" placeholder="Type a skill and press Enter" autocomplete="off">' +
        '</div><div class="field-hint">Press Enter or comma to add. Click \u00d7 to remove.</div></div>';

    case 'projects':
      return d.projects.map(function(proj, i) {
        return '<div class="entry-card" data-index="' + i + '">' +
          '<div class="entry-header"><span class="entry-number">Project ' + (i + 1) + '</span>' +
          '<button class="entry-remove" data-remove="projects" data-index="' + i + '" title="Remove">' +
          '<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg></button></div>' +
          '<div class="field-group"><label class="field-label">Project Name</label>' +
          '<input class="field-input" data-section="projects" data-index="' + i + '" data-field="name" value="' + esc(proj.name) + '" placeholder="Project Name"></div>' +
          '<div class="field-group"><label class="field-label">Description</label>' +
          '<textarea class="field-input" data-section="projects" data-index="' + i + '" data-field="description" rows="2" placeholder="Brief description...">' + esc(proj.description) + '</textarea></div>' +
          '<div class="field-row">' +
          '<div class="field-group"><label class="field-label">Technologies</label>' +
          '<input class="field-input" data-section="projects" data-index="' + i + '" data-field="technologies" value="' + esc(proj.technologies) + '" placeholder="React, Node.js"></div>' +
          '<div class="field-group"><label class="field-label">Link</label>' +
          '<input class="field-input" data-section="projects" data-index="' + i + '" data-field="link" value="' + esc(proj.link) + '" placeholder="github.com/user/project"></div></div></div>';
      }).join('') + '<button class="add-entry-btn" data-add="projects">+ Add Project</button>';

    case 'certifications':
      return d.certifications.map(function(cert, i) {
        return '<div class="entry-card" data-index="' + i + '">' +
          '<div class="entry-header"><span class="entry-number">Certification ' + (i + 1) + '</span>' +
          '<button class="entry-remove" data-remove="certifications" data-index="' + i + '" title="Remove">' +
          '<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg></button></div>' +
          '<div class="field-row">' +
          '<div class="field-group"><label class="field-label">Certification Name</label>' +
          '<input class="field-input" data-section="certifications" data-index="' + i + '" data-field="name" value="' + esc(cert.name) + '" placeholder="AWS Solutions Architect"></div>' +
          '<div class="field-group"><label class="field-label">Issuer</label>' +
          '<input class="field-input" data-section="certifications" data-index="' + i + '" data-field="issuer" value="' + esc(cert.issuer) + '" placeholder="Amazon Web Services"></div></div>' +
          '<div class="field-row">' +
          '<div class="field-group"><label class="field-label">Date</label>' +
          '<input class="field-input" type="month" data-section="certifications" data-index="' + i + '" data-field="date" value="' + cert.date + '"></div>' +
          '<div class="field-group"><label class="field-label">Link (optional)</label>' +
          '<input class="field-input" data-section="certifications" data-index="' + i + '" data-field="link" value="' + esc(cert.link) + '" placeholder="credential URL"></div></div></div>';
      }).join('') + '<button class="add-entry-btn" data-add="certifications">+ Add Certification</button>';

    default:
      return '';
  }
}

// ── Template Cards (uses only static/escaped content) ──
function renderTemplateCards() {
  var grid = document.getElementById('templateGrid');
  grid.textContent = '';
  Object.keys(TEMPLATES).forEach(function(id) {
    var tmpl = TEMPLATES[id];
    var card = document.createElement('div');
    card.className = 'template-card' + (state.template === id ? ' active' : '');
    card.dataset.template = id;

    var preview = document.createElement('div');
    preview.className = 'template-card-preview';
    ['title', 'subtitle', 'medium', 'section', 'long', 'full', 'medium', 'section', 'full', 'short'].forEach(function(cls) {
      var line = document.createElement('div');
      line.className = 'line ' + cls;
      if (cls === 'section') line.style.background = tmpl.accent;
      preview.appendChild(line);
    });

    var nameEl = document.createElement('div');
    nameEl.className = 'template-card-name';
    nameEl.textContent = tmpl.name;

    card.appendChild(preview);
    card.appendChild(nameEl);
    grid.appendChild(card);
  });
}

// ── Render Functions ───────────────────────
function setHTMLContent(el, html) {
  // All interpolated values in our HTML strings are pre-escaped via esc()
  el.innerHTML = html;
}

function renderEditor() {
  var scroll = document.getElementById('editorScroll');
  setHTMLContent(scroll, SECTIONS.map(function(s) { return renderEditorSection(s); }).join(''));
}

function renderEditorSectionContent(sectionId) {
  var sec = document.querySelector('.editor-section[data-section="' + sectionId + '"] .section-content');
  if (sec) setHTMLContent(sec, renderSectionFields(sectionId));
}

// Letter page height at 96dpi minus some tolerance
var PAGE_MAX_HEIGHT = 1056;

function checkPageOverflow() {
  var page = document.getElementById('previewPage');
  var warning = document.getElementById('overflowWarning');
  if (!page || !warning) return;

  // Measure the actual rendered content height
  var resume = page.querySelector('.resume');
  if (!resume) {
    warning.classList.remove('visible');
    return;
  }

  var contentHeight = resume.scrollHeight;
  if (contentHeight > PAGE_MAX_HEIGHT) {
    warning.classList.add('visible');
    var pagesEst = Math.ceil(contentHeight / PAGE_MAX_HEIGHT);
    warning.textContent = 'Content exceeds 1 page (~' + pagesEst + ' pages). PDF export will cut off content beyond the first page. Consider reducing content.';
  } else {
    warning.classList.remove('visible');
  }
}

var renderPreview = debounce(function() {
  var d = state.data;
  var page = document.getElementById('previewPage');
  var printContainer = document.getElementById('printContainer');

  if (!hasContent(d)) {
    page.textContent = '';
    var empty = document.createElement('div');
    empty.className = 'resume-empty';
    empty.textContent = 'Start filling in your details to see your resume here';
    page.appendChild(empty);
    var warning = document.getElementById('overflowWarning');
    if (warning) warning.classList.remove('visible');
    return;
  }

  var html = templateRenderers[state.template](d);
  setHTMLContent(page, html);
  setHTMLContent(printContainer, html);

  // Check after a frame so the browser has laid out the content
  requestAnimationFrame(checkPageOverflow);
}, 50);

// ── Event Handling ─────────────────────────
function initEvents() {
  var editorScroll = document.getElementById('editorScroll');

  editorScroll.addEventListener('click', function(e) {
    var toggle = e.target.closest('[data-toggle]');
    if (toggle) {
      var id = toggle.dataset.toggle;
      var idx = state.openSections.indexOf(id);
      if (idx >= 0) state.openSections.splice(idx, 1);
      else state.openSections.push(id);
      toggle.closest('.editor-section').classList.toggle('open');
      return;
    }

    var removeBtn = e.target.closest('[data-remove]');
    if (removeBtn && !removeBtn.dataset.removeSkill) {
      var section = removeBtn.dataset.remove;
      var index = parseInt(removeBtn.dataset.index);
      state.data[section].splice(index, 1);
      renderEditorSectionContent(section);
      renderPreview();
      saveToServer();
      return;
    }

    var addBtn = e.target.closest('[data-add]');
    if (addBtn) {
      var addSection = addBtn.dataset.add;
      var entryTemplates = {
        experience: { position: '', company: '', location: '', startDate: '', endDate: '', current: false, description: '' },
        education: { institution: '', degree: '', field: '', startDate: '', endDate: '', gpa: '' },
        projects: { name: '', description: '', technologies: '', link: '' },
        certifications: { name: '', issuer: '', date: '', link: '' }
      };
      state.data[addSection].push(Object.assign({}, entryTemplates[addSection]));
      renderEditorSectionContent(addSection);
      renderPreview();
      saveToServer();
      var cards = editorScroll.querySelectorAll('.editor-section[data-section="' + addSection + '"] .entry-card');
      if (cards.length) cards[cards.length - 1].scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }

    var removeSkill = e.target.closest('[data-remove-skill]');
    if (removeSkill) {
      var skillIdx = parseInt(removeSkill.dataset.removeSkill);
      state.data.skills.splice(skillIdx, 1);
      renderEditorSectionContent('skills');
      renderPreview();
      saveToServer();
      var inp = document.getElementById('skillInput');
      if (inp) inp.focus();
      return;
    }

    var wrapper = e.target.closest('.skills-input-wrapper');
    if (wrapper) {
      var skillInp = document.getElementById('skillInput');
      if (skillInp) skillInp.focus();
    }
  });

  editorScroll.addEventListener('input', function(e) {
    var input = e.target;
    if (!input.dataset || !input.dataset.section) return;
    var section = input.dataset.section;
    var field = input.dataset.field;
    var index = input.dataset.index !== undefined ? parseInt(input.dataset.index) : null;

    if (section === 'personal') {
      state.data.personal[field] = input.value;
    } else if (section === 'summary') {
      state.data.summary = input.value;
    } else if (index !== null) {
      state.data[section][index][field] = input.value;
    }

    renderPreview();
    saveToServer();
  });

  editorScroll.addEventListener('change', function(e) {
    var input = e.target;
    if (input.type === 'checkbox' && input.dataset.section === 'experience') {
      var index = parseInt(input.dataset.index);
      state.data.experience[index].current = input.checked;
      if (input.checked) state.data.experience[index].endDate = '';
      var endDateInput = editorScroll.querySelector('input[data-section="experience"][data-index="' + index + '"][data-field="endDate"]');
      if (endDateInput) endDateInput.disabled = input.checked;
      renderPreview();
      saveToServer();
    }
  });

  editorScroll.addEventListener('keydown', function(e) {
    if (e.target.id === 'skillInput') {
      if (e.key === 'Enter' || e.key === ',') {
        e.preventDefault();
        var val = e.target.value.replace(/,/g, '').trim();
        if (val && !state.data.skills.includes(val)) {
          state.data.skills.push(val);
          renderEditorSectionContent('skills');
          renderPreview();
          saveToServer();
          var inp = document.getElementById('skillInput');
          if (inp) inp.focus();
        }
      }
      if (e.key === 'Backspace' && !e.target.value && state.data.skills.length) {
        state.data.skills.pop();
        renderEditorSectionContent('skills');
        renderPreview();
        saveToServer();
        var bkInp = document.getElementById('skillInput');
        if (bkInp) bkInp.focus();
      }
    }
  });

  document.getElementById('templateToggleBtn').addEventListener('click', function() {
    state.drawerOpen = !state.drawerOpen;
    document.getElementById('templateDrawer').classList.toggle('open', state.drawerOpen);
    document.getElementById('templateToggleBtn').classList.toggle('active', state.drawerOpen);
  });

  document.getElementById('templateGrid').addEventListener('click', function(e) {
    var card = e.target.closest('.template-card');
    if (card) {
      state.template = card.dataset.template;
      renderTemplateCards();
      renderPreview();
      saveToServer();
    }
  });

  document.getElementById('exportBtn').addEventListener('click', function() {
    window.print();
  });

  document.getElementById('resumeSelect').addEventListener('change', async function(e) {
    var id = parseInt(e.target.value);
    await loadResume(id);
    renderTemplateCards();
    renderEditor();
    renderPreview();
  });

  document.getElementById('newResumeBtn').addEventListener('click', async function() {
    var name = prompt('Resume name:', 'New Resume');
    if (!name) return;
    try {
      var newResume = await api('POST', '/resumes', {
        name: name,
        template: 'modern',
        data: emptyResumeData()
      });
      state.resumeList.unshift({ id: newResume.id, name: newResume.name, template: newResume.template });
      renderResumeSelect();
      await loadResume(newResume.id);
      renderTemplateCards();
      renderEditor();
      renderPreview();
    } catch (err) {
      alert('Failed to create resume: ' + err.message);
    }
  });

  document.getElementById('deleteResumeBtn').addEventListener('click', async function() {
    if (state.resumeList.length <= 1) {
      alert('You must have at least one resume.');
      return;
    }
    if (!confirm('Delete this resume? This cannot be undone.')) return;
    try {
      await api('DELETE', '/resumes/' + state.currentResumeId);
      state.resumeList = state.resumeList.filter(function(r) { return r.id !== state.currentResumeId; });
      renderResumeSelect();
      await loadResume(state.resumeList[0].id);
      renderTemplateCards();
      renderEditor();
      renderPreview();
    } catch (err) {
      alert('Failed to delete: ' + err.message);
    }
  });

  document.getElementById('userAvatar').addEventListener('click', function(e) {
    e.stopPropagation();
    document.getElementById('userDropdown').classList.toggle('open');
  });
  document.addEventListener('click', function() {
    document.getElementById('userDropdown').classList.remove('open');
  });

  document.getElementById('logoutBtn').addEventListener('click', async function() {
    await api('POST', '/auth/logout');
    window.location.reload();
  });
}

// ── Initialize ─────────────────────────────
async function init() {
  initAuth();

  try {
    state.user = await api('GET', '/auth/me');
    document.getElementById('authOverlay').classList.add('hidden');
    await loadApp();
  } catch (e) {
    // Not authenticated - show login form
    document.getElementById('authOverlay').classList.remove('hidden');
  }
}

document.addEventListener('DOMContentLoaded', init);
