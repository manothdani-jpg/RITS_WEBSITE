(function () {
  "use strict";

  var reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---------------- Footer year ---------------- */
  var yearEl = document.getElementById("year");
  if (yearEl) yearEl.textContent = new Date().getFullYear();

  /* ---------------- Mobile nav toggle ---------------- */
  var navToggle = document.getElementById("nav-toggle");
  var navLinks = document.getElementById("nav-links");
  if (navToggle && navLinks) {
    navToggle.addEventListener("click", function () {
      var isOpen = navLinks.classList.toggle("is-open");
      navToggle.setAttribute("aria-expanded", isOpen ? "true" : "false");
    });
    navLinks.querySelectorAll("a").forEach(function (link) {
      link.addEventListener("click", function () {
        navLinks.classList.remove("is-open");
        navToggle.setAttribute("aria-expanded", "false");
      });
    });
  }

  /* ---------------- Hero badge sparks ---------------- */
  if (!reducedMotion) {
    var sparkHost = document.getElementById("sparks");
    if (sparkHost) {
      var n = 12;
      for (var i = 0; i < n; i++) {
        var el = document.createElement("div");
        el.className = "spark";
        var angle = (360 / n) * i;
        var radius = 120 + (i % 3) * 20;
        el.style.setProperty("--a", angle + "deg");
        el.style.setProperty("--r", radius + "px");
        el.style.animationDelay = (i * 0.4).toFixed(2) + "s";
        sparkHost.appendChild(el);
      }
    }
  }

  /* ---------------- Scroll reveal ---------------- */
  var revealEls = document.querySelectorAll(".reveal");
  if (reducedMotion || !("IntersectionObserver" in window)) {
    revealEls.forEach(function (el) { el.classList.add("is-visible"); });
  } else {
    var io = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-visible");
            io.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.15, rootMargin: "0px 0px -40px 0px" }
    );
    revealEls.forEach(function (el) { io.observe(el); });
  }

  /* ---------------- Countdown timer ----------------
     activateCountdown(isoDateString) starts it — called below once the
     next real event (if any) is fetched from the API. */
  var countdownTimer;
  function activateCountdown(dateStr) {
    var countdown = document.getElementById("countdown");
    if (!countdown) return;
    var target = dateStr ? new Date(dateStr) : null;
    if (!target || isNaN(target.getTime())) return;

    var daysEl = document.getElementById("cd-days");
    var hoursEl = document.getElementById("cd-hours");
    var minsEl = document.getElementById("cd-mins");
    var secsEl = document.getElementById("cd-secs");

    function pad(n) { return String(n).padStart(2, "0"); }

    function tick() {
      var diff = target.getTime() - Date.now();
      if (diff <= 0) {
        [daysEl, hoursEl, minsEl, secsEl].forEach(function (el) { if (el) el.textContent = "00"; });
        clearInterval(countdownTimer);
        return;
      }
      var d = Math.floor(diff / 86400000);
      var h = Math.floor((diff % 86400000) / 3600000);
      var m = Math.floor((diff % 3600000) / 60000);
      var s = Math.floor((diff % 60000) / 1000);
      if (daysEl) daysEl.textContent = pad(d);
      if (hoursEl) hoursEl.textContent = pad(h);
      if (minsEl) minsEl.textContent = pad(m);
      if (secsEl) secsEl.textContent = pad(s);
    }

    clearInterval(countdownTimer);
    tick();
    countdownTimer = setInterval(tick, 1000);
  }

  /* ---------------- Editable homepage content ---------------- */
  (async function loadSiteContent() {
    try {
      var apiBase = window.RITS_API_BASE || "";
      var res = await fetch(apiBase + "/site-content");
      if (!res.ok) return;
      var data = await res.json();
      document.querySelectorAll("[data-content]").forEach(function (el) {
        var key = el.getAttribute("data-content");
        var value = data.content[key];
        if (value === undefined) return;
        var isPlaceholder = /^\[.*\]$/.test(value.trim());
        el.textContent = value;
        el.classList.toggle("ph", isPlaceholder);
      });
    } catch (err) {
      // Network hiccup or backend not running — the page's hardcoded
      // fallback text (already in the HTML) stays visible. Not fatal.
    }
  })();

  /* ---------------- Featured upcoming event (from the real events API) ---------------- */
  (async function loadFeaturedEvent() {
    try {
      var apiBase = window.RITS_API_BASE || "";
      var res = await fetch(apiBase + "/events");
      if (!res.ok) return;
      var data = await res.json();
      var now = new Date();
      var upcoming = data.events
        .filter(function (ev) { return new Date(ev.event_date) >= now; })
        .sort(function (a, b) { return new Date(a.event_date) - new Date(b.event_date); });

      var note = document.getElementById("countdown-note");
      if (!upcoming.length) {
        if (note) note.textContent = "No upcoming events yet — check back soon.";
        return;
      }

      var ev = upcoming[0];
      var nameEl = document.getElementById("featured-event-name");
      var descEl = document.getElementById("featured-event-description");
      var dateEl = document.getElementById("featured-event-date");
      var locEl = document.getElementById("featured-event-location");

      if (nameEl) { nameEl.textContent = ev.name; nameEl.classList.remove("ph"); }
      if (descEl) {
        if (ev.description) { descEl.textContent = ev.description; descEl.classList.remove("ph"); }
        else { descEl.style.display = "none"; }
      }
      if (dateEl) {
        dateEl.textContent = new Date(ev.event_date).toLocaleString(undefined, {
          weekday: "long", year: "numeric", month: "long", day: "numeric", hour: "numeric", minute: "2-digit",
        });
        dateEl.classList.remove("ph");
      }
      if (locEl) {
        if (ev.location) { locEl.textContent = ev.location; locEl.classList.remove("ph"); }
        else { locEl.parentElement.style.display = "none"; }
      }
      var flyerEl = document.getElementById("featured-event-flyer");
      if (flyerEl) {
        if (ev.flyer_filename) {
          flyerEl.src = apiBase.replace(/\/api\/?$/, "") + "/uploads/events/" + ev.flyer_filename;
          flyerEl.alt = ev.name + " flyer";
          flyerEl.style.display = "";
        } else {
          flyerEl.style.display = "none";
        }
      }
      if (note) note.style.display = "none";

      activateCountdown(ev.event_date);
    } catch (err) {
      // Backend not running — keep the placeholder copy already in the HTML.
    }
  })();

  /* ---------------- Gallery photos (from admin uploads) ---------------- */
  (async function loadGallery() {
    var grid = document.getElementById("gallery-grid");
    if (!grid) return;
    try {
      var apiBase = window.RITS_API_BASE || "";
      var apiOrigin = apiBase.replace(/\/api\/?$/, "");
      var res = await fetch(apiBase + "/gallery");
      if (!res.ok) return;
      var data = await res.json();
      if (!data.photos.length) return; // keep placeholder tiles

      grid.innerHTML = data.photos.slice(0, 8).map(function (p, i) {
        var caption = p.caption ? '<span class="g-caption">' + escapeHtmlLite(p.caption) + "</span>" : "";
        return (
          '<div class="g-item g-photo' + (i === 0 ? " g1" : "") + '">' +
          '<img src="' + apiOrigin + "/uploads/gallery/" + p.filename + '" alt="' + escapeHtmlLite(p.caption || "RITS event photo") + '" loading="lazy">' +
          caption +
          "</div>"
        );
      }).join("");
    } catch (err) {
      // Backend not running — keep the placeholder tiles already in the HTML.
    }
  })();

  /* ---------------- Past events (from the real events API) ---------------- */
  (async function loadPastEvents() {
    var grid = document.getElementById("past-events-grid");
    var section = document.getElementById("past-events");
    if (!grid || !section) return;
    try {
      var apiBase = window.RITS_API_BASE || "";
      var apiOrigin = apiBase.replace(/\/api\/?$/, "");
      var res = await fetch(apiBase + "/events");
      if (!res.ok) return;
      var data = await res.json();
      var now = new Date();
      var past = data.events
        .filter(function (ev) { return new Date(ev.event_date) < now; })
        .sort(function (a, b) { return new Date(b.event_date) - new Date(a.event_date); })
        .slice(0, 8);
      if (!past.length) return; // section stays hidden

      var gradients = ["g1", "g2", "g3", "g4", "g5"];
      grid.innerHTML = past.map(function (ev, i) {
        var dateStr = new Date(ev.event_date).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
        var label = escapeHtmlLite(ev.name) + " — " + dateStr;
        if (ev.flyer_filename) {
          return (
            '<div class="g-item g-photo">' +
            '<img src="' + apiOrigin + "/uploads/events/" + ev.flyer_filename + '" alt="' + escapeHtmlLite(ev.name) + '" loading="lazy">' +
            '<span class="g-caption">' + label + "</span>" +
            "</div>"
          );
        }
        return (
          '<div class="g-item ' + gradients[i % gradients.length] + '">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>' +
          "<span>" + label + "</span>" +
          "</div>"
        );
      }).join("");
      section.style.display = "";
    } catch (err) {
      // Backend not running — section stays hidden.
    }
  })();

  /* ---------------- Sponsor logos (from admin uploads) ---------------- */
  (async function loadSponsors() {
    var grid = document.getElementById("sponsor-grid");
    if (!grid) return;
    try {
      var apiBase = window.RITS_API_BASE || "";
      var apiOrigin = apiBase.replace(/\/api\/?$/, "");
      var res = await fetch(apiBase + "/sponsors");
      if (!res.ok) return;
      var data = await res.json();
      if (!data.sponsors.length) return; // keep placeholder boxes

      grid.innerHTML = data.sponsors.map(function (s) {
        var img = '<img src="' + apiOrigin + "/uploads/sponsors/" + s.filename + '" alt="' + escapeHtmlLite(s.name) + '" loading="lazy">';
        var inner = s.website_url
          ? '<a href="' + escapeHtmlLite(s.website_url) + '" target="_blank" rel="noopener">' + img + "</a>"
          : img;
        return '<div class="sponsor-box sponsor-logo">' + inner + "</div>";
      }).join("");
    } catch (err) {
      // Backend not running — keep the placeholder boxes already in the HTML.
    }
  })();

  /* ---------------- Board of Directors (from admin roster) ---------------- */
  (async function loadBoard() {
    var currentGrid = document.getElementById("board-current-grid");
    if (!currentGrid) return;
    var pastGrid = document.getElementById("board-past-grid");
    var pastToggle = document.getElementById("board-past-toggle");

    var PERSON_PLACEHOLDER_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>';

    function termLabel(p) {
      return p.term_start_year + "–" + (p.term_end_year ? p.term_end_year : "Present");
    }

    function boardCardHtml(p) {
      var photo = p.photo_filename
        ? '<img src="' + apiOrigin + "/uploads/board/" + p.photo_filename + '" alt="' + escapeHtmlLite(p.name) + '" loading="lazy">'
        : PERSON_PLACEHOLDER_SVG;
      return (
        '<div class="board-card">' +
        '<div class="board-photo">' + photo + "</div>" +
        "<h3>" + escapeHtmlLite(p.name) + "</h3>" +
        '<p class="board-title">' + escapeHtmlLite(p.title) + "</p>" +
        '<p class="board-term">' + termLabel(p) + "</p>" +
        "</div>"
      );
    }

    try {
      var apiBase = window.RITS_API_BASE || "";
      var apiOrigin = apiBase.replace(/\/api\/?$/, "");
      var res = await fetch(apiBase + "/board-profiles");
      if (!res.ok) return;
      var data = await res.json();

      var current = data.profiles.filter(function (p) { return !p.term_end_year; });
      var past = data.profiles.filter(function (p) { return p.term_end_year; });

      currentGrid.innerHTML = current.length
        ? current.map(boardCardHtml).join("")
        : '<p class="ph">[No current board members listed yet.]</p>';

      if (past.length) {
        pastToggle.hidden = false;
        pastToggle.addEventListener("click", function () {
          var expanded = pastToggle.getAttribute("aria-expanded") === "true";
          pastToggle.setAttribute("aria-expanded", String(!expanded));
          pastToggle.textContent = expanded ? "View Past Board Members" : "Hide Past Board Members";
          pastGrid.hidden = expanded;
          if (!expanded && !pastGrid.innerHTML) {
            pastGrid.innerHTML = past.map(boardCardHtml).join("");
          }
        });
      }
    } catch (err) {
      // Backend not running — leave the loading placeholder in place.
    }
  })();

  function escapeHtmlLite(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  /* ---------------- Contact / membership tabs ---------------- */
  var contactTabs = {
    join: { tab: document.getElementById("tab-join"), panel: document.getElementById("panel-join") },
    volunteer: { tab: document.getElementById("tab-volunteer"), panel: document.getElementById("panel-volunteer") },
    inquiry: { tab: document.getElementById("tab-inquiry"), panel: document.getElementById("panel-inquiry") },
  };

  function activateTab(active) {
    Object.keys(contactTabs).forEach(function (key) {
      var entry = contactTabs[key];
      if (!entry.tab || !entry.panel) return;
      var isActive = key === active;
      entry.tab.classList.toggle("is-active", isActive);
      entry.tab.setAttribute("aria-selected", String(isActive));
      entry.panel.hidden = !isActive;
    });
  }

  Object.keys(contactTabs).forEach(function (key) {
    var entry = contactTabs[key];
    if (entry.tab) entry.tab.addEventListener("click", function () { activateTab(key); });
  });

  var volunteerCardCta = document.getElementById("volunteer-card-cta");
  if (volunteerCardCta) {
    volunteerCardCta.addEventListener("click", function () { activateTab("volunteer"); });
  }

  /* ---------------- Membership tier options — admin-managed ---------------- */
  var tierSelect = document.getElementById("j-tier");
  if (tierSelect) {
    (async function loadTierOptions() {
      try {
        var apiBase = window.RITS_API_BASE || "";
        var res = await fetch(apiBase + "/payment-settings");
        var data = await res.json();
        tierSelect.innerHTML = (data.tiers || []).map(function (t) {
          return '<option value="' + t.key + '">' + escapeHtmlLite(t.label) + "</option>";
        }).join("");
      } catch (err) {
        tierSelect.innerHTML = '<option value="individual">Individual</option>';
      }
    })();
  }

  /* ---------------- Membership signup — posts to the RITS API ---------------- */
  var joinForm = document.getElementById("panel-join");
  var joinStatus = document.getElementById("join-status");
  var joinSubmit = document.getElementById("join-submit");

  function setJoinStatus(message, kind) {
    joinStatus.textContent = message;
    joinStatus.className = "form-status is-visible" + (kind ? " is-" + kind : "");
  }

  if (joinForm) {
    joinForm.addEventListener("submit", async function (e) {
      e.preventDefault();
      setJoinStatus("", "");
      joinStatus.classList.remove("is-visible");
      joinSubmit.disabled = true;
      joinSubmit.textContent = "Submitting…";

      var payload = {
        first_name: document.getElementById("j-first-name").value.trim(),
        last_name: document.getElementById("j-last-name").value.trim(),
        email: document.getElementById("j-email").value.trim(),
        phone: document.getElementById("j-phone").value.trim() || undefined,
        membership_tier: document.getElementById("j-tier").value,
        password: document.getElementById("j-password").value,
      };

      try {
        var apiBase = window.RITS_API_BASE || "";
        var res = await fetch(apiBase + "/members/signup", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        var data = await res.json().catch(function () { return {}; });

        if (!res.ok) {
          throw new Error(data.error || "Something went wrong. Please try again.");
        }

        setJoinStatus(
          "Thanks, " + data.member.first_name + "! Your membership request was received — a board member will follow up to confirm payment. You can log into the member portal any time with the email and password you just set.",
          "success"
        );
        joinForm.reset();
      } catch (err) {
        var msg = err.message === "Failed to fetch"
          ? "Couldn't reach the membership server. Please try again later or contact us directly."
          : err.message;
        setJoinStatus(msg, "error");
      } finally {
        joinSubmit.disabled = false;
        joinSubmit.textContent = "Join RITS";
      }
    });
  }

  /* ---------------- Volunteer signup — posts to the RITS API ---------------- */
  var volunteerForm = document.getElementById("panel-volunteer");
  var volunteerStatus = document.getElementById("volunteer-status");
  var volunteerSubmit = document.getElementById("volunteer-submit");

  function setVolunteerStatus(message, kind) {
    volunteerStatus.textContent = message;
    volunteerStatus.className = "form-status is-visible" + (kind ? " is-" + kind : "");
  }

  if (volunteerForm) {
    volunteerForm.addEventListener("submit", async function (e) {
      e.preventDefault();
      setVolunteerStatus("", "");
      volunteerStatus.classList.remove("is-visible");
      volunteerSubmit.disabled = true;
      volunteerSubmit.textContent = "Submitting…";

      var interests = Array.prototype.slice
        .call(volunteerForm.querySelectorAll('input[name="interests"]:checked'))
        .map(function (el) { return el.value; });

      var payload = {
        first_name: document.getElementById("v-first-name").value.trim(),
        last_name: document.getElementById("v-last-name").value.trim(),
        email: document.getElementById("v-email").value.trim(),
        phone: document.getElementById("v-phone").value.trim() || undefined,
        interests: interests,
        note: document.getElementById("v-note").value.trim() || undefined,
      };

      try {
        var apiBase = window.RITS_API_BASE || "";
        var res = await fetch(apiBase + "/volunteers", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        var data = await res.json().catch(function () { return {}; });

        if (!res.ok) {
          throw new Error(data.error || "Something went wrong. Please try again.");
        }

        setVolunteerStatus("Thanks, " + data.volunteer.first_name + "! A board member will reach out about next steps.", "success");
        volunteerForm.reset();
      } catch (err) {
        var msg = err.message === "Failed to fetch"
          ? "Couldn't reach the server. Please try again later or contact us directly."
          : err.message;
        setVolunteerStatus(msg, "error");
      } finally {
        volunteerSubmit.disabled = false;
        volunteerSubmit.textContent = "Sign Up to Volunteer";
      }
    });
  }

  /* ---------------- General inquiry form (placeholder handler) ---------------- */
  var inquiryForm = document.getElementById("panel-inquiry");
  if (inquiryForm) {
    inquiryForm.addEventListener("submit", function (e) {
      e.preventDefault();
      alert(
        "This form isn't connected yet. Replace this handler in js/main.js with a real submission " +
        "(e.g. Formspree, Netlify Forms, or your own backend) before launch."
      );
    });
  }
})();
