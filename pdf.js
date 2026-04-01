const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

let browser = null;

// Read the app CSS once at startup
const fullCSS = fs.readFileSync(path.join(__dirname, 'public', 'css', 'app.css'), 'utf8');

// System font overrides for PDF — Google Fonts aren't available in Docker,
// so we map to system/liberation fonts that are installed in the container
const fontOverrides = `
  .template-classic { font-family: 'Liberation Serif', Georgia, 'Times New Roman', serif !important; }
  .template-modern { font-family: 'Liberation Sans', 'Segoe UI', Calibri, sans-serif !important; }
  .template-minimal { font-family: 'Liberation Sans', 'Helvetica Neue', Arial, sans-serif !important; }
  .template-executive { font-family: 'Liberation Sans', Calibri, 'Segoe UI', sans-serif !important; }
  .template-elegant { font-family: 'Liberation Serif', Georgia, serif !important; }
  .template-classic h2 { font-family: 'Liberation Sans', sans-serif !important; }
  .template-elegant h2 { font-family: 'Liberation Sans', sans-serif !important; }
`;

async function getBrowser() {
  if (!browser || !browser.connected) {
    var opts = {
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-gpu',
        '--disable-dev-shm-usage',
        '--font-render-hinting=none'
      ]
    };
    if (process.env.PUPPETEER_EXECUTABLE_PATH) {
      opts.executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
    }
    browser = await puppeteer.launch(opts);
  }
  return browser;
}

// Build the resume HTML that the client renders, but server-side
function buildResumeHTML(template, data) {
  function esc(str) {
    if (!str) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
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

  function renderContactRow(p, sep) {
    var items = [];
    if (p.email) items.push(esc(p.email));
    if (p.phone) items.push(esc(p.phone));
    if (p.location) items.push(esc(p.location));
    if (p.linkedin) items.push(esc(p.linkedin));
    if (p.website) items.push(esc(p.website));
    return items.join(' <span class="contact-sep">' + esc(sep) + '</span> ');
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

  function renderSectionEntries(type, d) {
    if (type === 'experience') {
      return d.experience.map(function(e) {
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
      return d.education.map(function(e) {
        return '<div class="entry"><div class="entry-top"><div>' +
          '<h3>' + esc(e.institution) + '</h3>' +
          '<div class="entry-sub">' + esc(e.degree) + (e.field ? ' in ' + esc(e.field) : '') + (e.gpa ? ' | GPA: ' + esc(e.gpa) : '') + '</div>' +
          '</div><div class="entry-dates">' + dateRange(e.startDate, e.endDate, false) + '</div></div></div>';
      }).join('');
    }
    if (type === 'projects') {
      return d.projects.map(function(e) {
        return '<div class="entry"><div class="entry-top">' +
          '<h3>' + esc(e.name) + (e.link ? ' <span class="entry-sub" style="font-weight:400">\u2014 ' + esc(e.link) + '</span>' : '') + '</h3>' +
          '</div>' +
          (e.technologies ? '<div class="entry-sub">Technologies: ' + esc(e.technologies) + '</div>' : '') +
          (e.description ? '<p style="margin-top:3px">' + esc(e.description) + '</p>' : '') + '</div>';
      }).join('');
    }
    if (type === 'certifications') {
      return d.certifications.map(function(e) {
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

  var d = data;
  var p = d.personal;
  var name = [p.firstName, p.lastName].filter(Boolean).join(' ');
  var resumeBody;

  if (template === 'classic') {
    resumeBody = '<div class="resume template-classic">' +
      (name ? '<h1>' + esc(name) + '</h1>' : '') +
      (p.title ? '<div class="resume-title">' + esc(p.title) + '</div>' : '') +
      '<div class="contact-row">' + renderContactRow(p, '|') + '</div>' +
      buildSections(d) + '</div>';
  } else if (template === 'modern') {
    resumeBody = '<div class="resume template-modern"><div class="modern-header">' +
      (name ? '<h1>' + esc(name) + '</h1>' : '') +
      (p.title ? '<div class="resume-title">' + esc(p.title) + '</div>' : '') +
      '<div class="contact-row">' + renderContactRow(p, '\u00b7') + '</div>' +
      '</div><div class="modern-body">' + buildSections(d) + '</div></div>';
  } else if (template === 'minimal') {
    resumeBody = '<div class="resume template-minimal">' +
      (name ? '<h1>' + esc(name) + '</h1>' : '') +
      (p.title ? '<div class="resume-title">' + esc(p.title) + '</div>' : '') +
      '<div class="contact-row">' + renderContactRow(p, '\u00b7') + '</div>' +
      buildSections(d) + '</div>';
  } else if (template === 'executive') {
    var contactLines = [];
    if (p.email) contactLines.push(esc(p.email));
    if (p.phone) contactLines.push(esc(p.phone));
    if (p.location) contactLines.push(esc(p.location));
    if (p.linkedin) contactLines.push(esc(p.linkedin));
    if (p.website) contactLines.push(esc(p.website));
    resumeBody = '<div class="resume template-executive"><div class="exec-header"><div>' +
      (name ? '<h1>' + esc(name) + '</h1>' : '') +
      (p.title ? '<div class="resume-title">' + esc(p.title) + '</div>' : '') +
      '</div><div class="exec-contact">' + contactLines.join('<br>') + '</div></div>' +
      '<div class="exec-body">' + buildSections(d) + '</div></div>';
  } else if (template === 'elegant') {
    resumeBody = '<div class="resume template-elegant">' +
      (name ? '<h1>' + esc(name) + '</h1>' : '') +
      (p.title ? '<div class="resume-title">' + esc(p.title) + '</div>' : '') +
      '<div class="contact-row">' + renderContactRow(p, '\u00b7') + '</div>' +
      '<div class="elegant-divider"></div>' +
      buildSections(d) + '</div>';
  } else {
    resumeBody = '<div class="resume">' + buildSections(d) + '</div>';
  }

  return resumeBody;
}

async function generatePDF(template, data) {
  var b = await getBrowser();
  var page = await b.newPage();

  // Set viewport to letter-width (8.5in at 96dpi)
  await page.setViewport({ width: 816, height: 1056 });

  var resumeHTML = buildResumeHTML(template, data);

  // Build a self-contained HTML page with no external dependencies
  var html = '<!DOCTYPE html><html><head><meta charset="UTF-8">' +
    '<style>' +
    '*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }' +
    'body { margin: 0; padding: 0; background: #fff; }' +
    fullCSS + '\n' +
    fontOverrides +
    '</style></head><body>' + resumeHTML + '</body></html>';

  // Write to temp file and navigate to it — more reliable than setContent
  var tmpFile = path.join(require('os').tmpdir(), 'resume-' + Date.now() + '.html');
  fs.writeFileSync(tmpFile, html);

  try {
    await page.goto('file://' + tmpFile, { waitUntil: 'load', timeout: 10000 });

    var pdfBuffer = await page.pdf({
      format: 'Letter',
      printBackground: true,
      margin: { top: 0, right: 0, bottom: 0, left: 0 }
    });

    return pdfBuffer;
  } finally {
    await page.close();
    try { fs.unlinkSync(tmpFile); } catch (_) {}
  }
}

function closeBrowser() {
  if (browser) {
    browser.close().catch(function() {});
    browser = null;
  }
}

module.exports = { generatePDF, closeBrowser };
