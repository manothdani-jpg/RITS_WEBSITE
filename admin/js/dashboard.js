(function () {
  "use strict";

  var API = window.RITS_API_BASE;
  var token = localStorage.getItem("rits_admin_token");
  if (!token) {
    window.location.href = "index.html";
    return;
  }

  var adminInfo = JSON.parse(localStorage.getItem("rits_admin_info") || "{}");
  document.getElementById("who-name").textContent = adminInfo.name || adminInfo.email || "Admin";
  var isSuperAdmin = adminInfo.role === "superadmin";
  if (isSuperAdmin) {
    document.getElementById("nav-admins-btn").style.display = "";
  }

  document.getElementById("logout-btn").addEventListener("click", function () {
    localStorage.removeItem("rits_admin_token");
    localStorage.removeItem("rits_admin_info");
    window.location.href = "index.html";
  });

  /* ---------------- fetch helper ---------------- */
  async function api(path, options) {
    options = options || {};
    options.headers = Object.assign(
      { "Content-Type": "application/json", Authorization: "Bearer " + token },
      options.headers || {}
    );
    if (options.body && typeof options.body !== "string") {
      options.body = JSON.stringify(options.body);
    }
    var res = await fetch(API + path, options);
    if (res.status === 401) {
      localStorage.removeItem("rits_admin_token");
      window.location.href = "index.html";
      throw new Error("Session expired");
    }
    if (res.status === 204) return null;
    var data = await res.json().catch(function () { return {}; });
    if (!res.ok) throw new Error(data.error || "Request failed");
    return data;
  }

  // Like api(), but for multipart/form-data uploads — no Content-Type
  // header (the browser sets the multipart boundary itself).
  async function apiUpload(path, formData) {
    var res = await fetch(API + path, {
      method: "POST",
      headers: { Authorization: "Bearer " + token },
      body: formData,
    });
    if (res.status === 401) {
      localStorage.removeItem("rits_admin_token");
      window.location.href = "index.html";
      throw new Error("Session expired");
    }
    var data = await res.json().catch(function () { return {}; });
    if (!res.ok) throw new Error(data.error || "Upload failed");
    return data;
  }

  function toast(msg, isError) {
    var el = document.getElementById("toast");
    el.textContent = msg;
    el.classList.toggle("is-error", !!isError);
    el.classList.add("is-visible");
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { el.classList.remove("is-visible"); }, 3200);
  }

  function fmtDate(d) {
    if (!d) return "—";
    return new Date(d).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  }
  function fmtDateTime(d) {
    if (!d) return "—";
    return new Date(d).toLocaleString(undefined, { year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  }
  function escapeHtml(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  /* ---------------- View switching ---------------- */
  var navButtons = document.querySelectorAll(".admin-nav button");
  navButtons.forEach(function (btn) {
    btn.addEventListener("click", function () {
      navButtons.forEach(function (b) { b.classList.remove("active"); });
      btn.classList.add("active");
      var view = btn.getAttribute("data-view");
      document.getElementById("view-members").style.display = view === "members" ? "" : "none";
      document.getElementById("view-events").style.display = view === "events" ? "" : "none";
      document.getElementById("view-homepage").style.display = view === "homepage" ? "" : "none";
      document.getElementById("view-media").style.display = view === "media" ? "" : "none";
      document.getElementById("view-admins").style.display = view === "admins" ? "" : "none";
      document.getElementById("view-board-roster").style.display = view === "board-roster" ? "" : "none";
      document.getElementById("view-volunteers").style.display = view === "volunteers" ? "" : "none";
      document.getElementById("view-communications").style.display = view === "communications" ? "" : "none";
      document.getElementById("view-payment").style.display = view === "payment" ? "" : "none";
      document.getElementById("view-reports").style.display = view === "reports" ? "" : "none";
      document.getElementById("view-front-desk").style.display = view === "front-desk" ? "" : "none";
      document.getElementById("view-cultural").style.display = view === "cultural" ? "" : "none";
      document.getElementById("view-activity").style.display = view === "activity" ? "" : "none";
      if (view === "events") loadEvents();
      if (view === "homepage") loadHomepageContent();
      if (view === "media") loadMedia();
      if (view === "admins") { loadAdmins(); loadMailSettings(); }
      if (view === "board-roster") loadBoardRoster();
      if (view === "volunteers") loadVolunteers();
      if (view === "communications") refreshRecipientCount();
      if (view === "payment") { loadPaymentSettings(); loadMembershipCategories(); }
      if (view === "reports") { loadReports(); refreshEventFilter("report-event-filter").then(loadReportEventSections); }
      if (view === "front-desk") { loadDeskStaff(); loadDeskLogEventFilter(); loadDeskLog(); }
      if (view === "cultural") { refreshEventFilter("cultural-event-filter").then(function () { loadCulturalStats(); loadCulturalGroups(); }); }
      if (view === "activity") loadActivityLog(true);
    });
  });

  /* ============================================================
     MEMBERS
     ============================================================ */
  var membersTbody = document.getElementById("members-tbody");
  var membersEmpty = document.getElementById("members-empty");
  var searchInput = document.getElementById("member-search");
  var tierFilter = document.getElementById("filter-tier");
  var statusFilter = document.getElementById("filter-status");
  var allEvents = [];

  var searchDebounce;
  searchInput.addEventListener("input", function () {
    clearTimeout(searchDebounce);
    searchDebounce = setTimeout(loadMembers, 300);
  });
  tierFilter.addEventListener("change", loadMembers);
  statusFilter.addEventListener("change", loadMembers);

  function statusBadgeClass(status) {
    return { paid: "badge-paid", pending: "badge-pending", overdue: "badge-overdue", waived: "badge-waived" }[status] || "badge-pending";
  }

  async function loadMembers() {
    var params = new URLSearchParams();
    if (searchInput.value) params.set("search", searchInput.value);
    if (tierFilter.value) params.set("tier", tierFilter.value);
    if (statusFilter.value) params.set("status", statusFilter.value);
    params.set("pageSize", "100");

    try {
      var data = await api("/members?" + params.toString());
      renderMembers(data.members);
      renderStats(data.members, data.total);
    } catch (err) {
      toast(err.message, true);
    }
  }

  function renderStats(members, total) {
    var paid = members.filter(function (m) { return m.payment_status === "paid"; }).length;
    var pending = members.filter(function (m) { return m.payment_status === "pending"; }).length;
    var overdue = members.filter(function (m) { return m.payment_status === "overdue"; }).length;
    document.getElementById("member-stats").innerHTML = [
      { label: "Total Members", value: total },
      { label: "Paid", value: paid },
      { label: "Pending", value: pending },
      { label: "Overdue", value: overdue },
    ].map(function (s) {
      return '<div class="stat-card"><strong>' + s.value + "</strong><span>" + s.label + "</span></div>";
    }).join("");
  }

  function renderMembers(members) {
    membersEmpty.style.display = members.length ? "none" : "";
    membersTbody.innerHTML = members.map(function (m) {
      return (
        '<tr data-id="' + m.id + '">' +
        "<td>" + escapeHtml(m.first_name + " " + m.last_name) + "</td>" +
        "<td>" + escapeHtml(m.email) + "</td>" +
        "<td>" + escapeHtml(m.phone || "—") + "</td>" +
        '<td><span class="badge badge-tier">' + escapeHtml(m.membership_tier) + "</span></td>" +
        '<td><span class="badge ' + statusBadgeClass(m.payment_status) + '">' + escapeHtml(m.payment_status) + "</span></td>" +
        "<td>" + fmtDate(m.join_date) + "</td>" +
        '<td class="row-actions">' +
        '<button class="icon-btn" data-edit="' + m.id + '" aria-label="Edit ' + escapeHtml(m.first_name) + '"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4z"/></svg></button>' +
        "</td>" +
        "</tr>"
      );
    }).join("");
  }

  membersTbody.addEventListener("click", function (e) {
    var editBtn = e.target.closest("[data-edit]");
    var row = e.target.closest("tr[data-id]");
    var id = editBtn ? editBtn.getAttribute("data-edit") : row ? row.getAttribute("data-id") : null;
    if (id) openMemberModal(id);
  });

  /* ---------------- Member modal ---------------- */
  var memberModal = document.getElementById("member-modal");
  var memberForm = document.getElementById("member-form");
  var currentFamily = [];

  document.getElementById("add-member-btn").addEventListener("click", function () { openMemberModal(null); });
  document.getElementById("member-modal-close").addEventListener("click", closeMemberModal);
  document.getElementById("member-cancel-btn").addEventListener("click", closeMemberModal);
  memberModal.addEventListener("click", function (e) { if (e.target === memberModal) closeMemberModal(); });

  function closeMemberModal() { memberModal.classList.remove("is-open"); }

  async function openMemberModal(id) {
    memberForm.reset();
    document.getElementById("member-id").value = id || "";
    document.getElementById("delete-member-btn").style.display = id ? "" : "none";
    document.getElementById("family-section").style.display = id ? "" : "none";
    document.getElementById("rsvp-section").style.display = id ? "" : "none";
    currentFamily = [];
    resetFamilyForm();

    // Phone is required when adding a new member, matching the public
    // signup form — but editing an existing member never forces one in,
    // since plenty of legacy records predate this rule.
    document.getElementById("f-phone").required = !id;

    if (id) {
      document.getElementById("member-modal-title").textContent = "Edit Member";
      try {
        var data = await api("/members/" + id);
        var m = data.member;
        document.getElementById("f-first-name").value = m.first_name;
        document.getElementById("f-last-name").value = m.last_name;
        document.getElementById("f-email").value = m.email;
        document.getElementById("f-phone").value = m.phone || "";
        document.getElementById("f-tier").value = m.membership_tier;
        document.getElementById("f-status").value = m.payment_status;
        document.getElementById("f-renewal").value = m.renewal_date ? m.renewal_date.slice(0, 10) : "";
        document.getElementById("f-address1").value = m.address_line1 || "";
        document.getElementById("f-city").value = m.city || "";
        document.getElementById("f-zip").value = m.zip || "";
        document.getElementById("f-notes").value = m.notes || "";
        currentFamily = data.family_members;
        renderFamilyPills();
        renderRsvpList(data.rsvps);
      } catch (err) {
        toast(err.message, true);
        return;
      }
    } else {
      document.getElementById("member-modal-title").textContent = "Add Member";
      document.getElementById("f-tier").value = "individual";
      document.getElementById("f-status").value = "pending";
    }
    memberModal.classList.add("is-open");
  }

  var editingFamilyId = null;

  function renderFamilyPills() {
    document.getElementById("family-pills").innerHTML = currentFamily.map(function (f) {
      var detail = [f.email, [f.address_line1, f.city, f.zip].filter(Boolean).join(", ")].filter(Boolean).join(" &middot; ");
      return (
        '<div class="family-member-row">' +
        '<div class="fm-info">' +
        '<div class="fm-name">' + escapeHtml(f.first_name) + " (" + escapeHtml(f.relationship) + ")</div>" +
        (detail ? '<div class="fm-detail">' + detail + "</div>" : "") +
        "</div>" +
        '<div class="fm-actions">' +
        '<button type="button" data-edit-family="' + f.id + '" aria-label="Edit ' + escapeHtml(f.first_name) + '">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>' +
        '<button type="button" data-remove-family="' + f.id + '" aria-label="Remove ' + escapeHtml(f.first_name) + '">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6L6 18M6 6l12 12"/></svg></button>' +
        "</div></div>"
      );
    }).join("") || '<span style="color:var(--text-soft); font-size:.85rem;">No family members added yet.</span>';
  }

  function resetFamilyForm() {
    editingFamilyId = null;
    document.getElementById("new-family-name").value = "";
    document.getElementById("new-family-relationship").value = "child";
    document.getElementById("new-family-email").value = "";
    document.getElementById("new-family-address").value = "";
    document.getElementById("new-family-city").value = "";
    document.getElementById("new-family-zip").value = "";
    document.getElementById("add-family-btn").textContent = "Add";
    document.getElementById("cancel-family-edit-btn").style.display = "none";
  }

  function renderRsvpList(rsvps) {
    var box = document.getElementById("rsvp-list");
    if (!rsvps.length) {
      box.textContent = "No event RSVPs yet.";
      return;
    }
    box.innerHTML = rsvps.map(function (r) {
      return "&bull; " + escapeHtml(r.event_name) + " — " + fmtDate(r.event_date) + " (" + escapeHtml(r.status) + ")";
    }).join("<br>");
  }

  document.getElementById("add-family-btn").addEventListener("click", async function () {
    var id = document.getElementById("member-id").value;
    var name = document.getElementById("new-family-name").value.trim();
    if (!id) { toast("Save the member first, then add family members.", true); return; }
    if (!name) return;
    var payload = {
      first_name: name,
      relationship: document.getElementById("new-family-relationship").value,
      email: document.getElementById("new-family-email").value.trim() || null,
      address_line1: document.getElementById("new-family-address").value.trim() || null,
      city: document.getElementById("new-family-city").value.trim() || null,
      zip: document.getElementById("new-family-zip").value.trim() || null,
    };
    try {
      if (editingFamilyId) {
        var updated = await api("/members/" + id + "/family/" + editingFamilyId, { method: "PUT", body: payload });
        currentFamily = currentFamily.map(function (f) { return f.id === editingFamilyId ? updated.family_member : f; });
      } else {
        var data = await api("/members/" + id + "/family", { method: "POST", body: payload });
        currentFamily.push(data.family_member);
      }
      renderFamilyPills();
      resetFamilyForm();
    } catch (err) {
      toast(err.message, true);
    }
  });

  document.getElementById("cancel-family-edit-btn").addEventListener("click", resetFamilyForm);

  document.getElementById("family-pills").addEventListener("click", async function (e) {
    var editBtn = e.target.closest("[data-edit-family]");
    var removeBtn = e.target.closest("[data-remove-family]");

    if (editBtn) {
      var familyId = editBtn.getAttribute("data-edit-family");
      var f = currentFamily.find(function (x) { return x.id === familyId; });
      if (!f) return;
      editingFamilyId = familyId;
      document.getElementById("new-family-name").value = f.first_name || "";
      document.getElementById("new-family-relationship").value = f.relationship || "child";
      document.getElementById("new-family-email").value = f.email || "";
      document.getElementById("new-family-address").value = f.address_line1 || "";
      document.getElementById("new-family-city").value = f.city || "";
      document.getElementById("new-family-zip").value = f.zip || "";
      document.getElementById("add-family-btn").textContent = "Save";
      document.getElementById("cancel-family-edit-btn").style.display = "";
      return;
    }

    if (!removeBtn) return;
    var removeId = removeBtn.getAttribute("data-remove-family");
    var memberId = document.getElementById("member-id").value;
    try {
      await api("/members/" + memberId + "/family/" + removeId, { method: "DELETE" });
      currentFamily = currentFamily.filter(function (f) { return f.id !== removeId; });
      if (editingFamilyId === removeId) resetFamilyForm();
      renderFamilyPills();
    } catch (err) {
      toast(err.message, true);
    }
  });

  memberForm.addEventListener("submit", async function (e) {
    e.preventDefault();
    var id = document.getElementById("member-id").value;
    var payload = {
      first_name: document.getElementById("f-first-name").value.trim(),
      last_name: document.getElementById("f-last-name").value.trim(),
      email: document.getElementById("f-email").value.trim(),
      phone: document.getElementById("f-phone").value.trim() || null,
      membership_tier: document.getElementById("f-tier").value,
      payment_status: document.getElementById("f-status").value,
      renewal_date: document.getElementById("f-renewal").value || null,
      address_line1: document.getElementById("f-address1").value.trim() || null,
      city: document.getElementById("f-city").value.trim() || null,
      zip: document.getElementById("f-zip").value.trim() || null,
      notes: document.getElementById("f-notes").value.trim() || null,
    };

    try {
      if (id) {
        await api("/members/" + id, { method: "PUT", body: payload });
        toast("Member updated");
      } else {
        await api("/members", { method: "POST", body: payload });
        toast("Member added");
      }
      closeMemberModal();
      loadMembers();
    } catch (err) {
      toast(err.message, true);
    }
  });

  document.getElementById("delete-member-btn").addEventListener("click", async function () {
    var id = document.getElementById("member-id").value;
    if (!id) return;
    if (!confirm("Remove this member and their family/RSVP records? This can't be undone.")) return;
    try {
      await api("/members/" + id, { method: "DELETE" });
      toast("Member removed");
      closeMemberModal();
      loadMembers();
    } catch (err) {
      toast(err.message, true);
    }
  });

  /* ============================================================
     EVENTS
     ============================================================ */
  var eventsTbody = document.getElementById("events-tbody");
  var eventsEmpty = document.getElementById("events-empty");
  var eventModal = document.getElementById("event-modal");
  var eventForm = document.getElementById("event-form");

  document.getElementById("add-event-btn").addEventListener("click", function () { openEventModal(); });
  document.getElementById("event-modal-close").addEventListener("click", closeEventModal);
  document.getElementById("event-cancel-btn").addEventListener("click", closeEventModal);
  eventModal.addEventListener("click", function (e) { if (e.target === eventModal) closeEventModal(); });
  function closeEventModal() { eventModal.classList.remove("is-open"); eventForm.reset(); }

  // Local (not UTC) datetime-local input value, so editing an event doesn't
  // shift its displayed time.
  function toDatetimeLocalValue(isoString) {
    var d = new Date(isoString);
    var pad = function (n) { return String(n).padStart(2, "0"); };
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) + "T" + pad(d.getHours()) + ":" + pad(d.getMinutes());
  }

  function openEventModal(id) {
    eventForm.reset();
    document.getElementById("ev-id").value = id || "";
    if (id) {
      var ev = allEvents.find(function (e) { return e.id === id; });
      if (!ev) return;
      document.getElementById("event-modal-title").textContent = "Edit Event";
      document.getElementById("event-submit-btn").textContent = "Save Changes";
      document.getElementById("ev-name").value = ev.name;
      document.getElementById("ev-date").value = toDatetimeLocalValue(ev.event_date);
      document.getElementById("ev-location").value = ev.location || "";
      document.getElementById("ev-description").value = ev.description || "";
    } else {
      document.getElementById("event-modal-title").textContent = "Add Event";
      document.getElementById("event-submit-btn").textContent = "Create Event";
    }
    eventModal.classList.add("is-open");
  }

  async function loadEvents() {
    try {
      var data = await api("/events");
      allEvents = data.events;
      eventsEmpty.style.display = data.events.length ? "none" : "";
      var rows = await Promise.all(data.events.map(async function (ev) {
        var rsvps = await api("/events/" + ev.id + "/rsvps").catch(function () { return { rsvps: [] }; });
        return (
          "<tr>" +
          "<td>" + (ev.flyer_filename
            ? '<img src="' + apiOrigin + "/uploads/events/" + ev.flyer_filename + '" alt="Flyer for ' + escapeHtml(ev.name) + '" style="width:40px; height:40px; object-fit:cover; border-radius:var(--radius-sm);">'
            : "—") + "</td>" +
          "<td>" + escapeHtml(ev.name) + "</td>" +
          "<td>" + fmtDateTime(ev.event_date) + "</td>" +
          "<td>" + escapeHtml(ev.location || "—") + "</td>" +
          "<td>" + (ev.cultural_member_fee_cents != null && ev.cultural_non_member_fee_cents != null
            ? '<span class="badge badge-paid">Open</span>'
            : '<span class="badge badge-tier">Closed</span>') + "</td>" +
          "<td>" + rsvps.rsvps.length + "</td>" +
          '<td class="row-actions">' +
          '<button class="icon-btn" data-edit-event="' + ev.id + '" aria-label="Edit ' + escapeHtml(ev.name) + '"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4z"/></svg></button>' +
          '<button class="icon-btn" data-manage-flyer="' + ev.id + '" data-event-name="' + escapeHtml(ev.name) + '" aria-label="Manage flyer for ' + escapeHtml(ev.name) + '"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg></button>' +
          '<button class="icon-btn" data-view-attendees="' + ev.id + '" data-event-name="' + escapeHtml(ev.name) + '" aria-label="View attendees for ' + escapeHtml(ev.name) + '"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg></button>' +
          '<button class="icon-btn" data-manage-pricing="' + ev.id + '" data-event-name="' + escapeHtml(ev.name) + '" aria-label="Manage pricing for ' + escapeHtml(ev.name) + '"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg></button>' +
          '<button class="icon-btn" data-del-event="' + ev.id + '" aria-label="Delete ' + escapeHtml(ev.name) + '"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0-1 14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2L4 6"/></svg></button>' +
          "</td></tr>"
        );
      }));
      eventsTbody.innerHTML = rows.join("");
    } catch (err) {
      toast(err.message, true);
    }
  }

  eventsTbody.addEventListener("click", async function (e) {
    var editBtn = e.target.closest("[data-edit-event]");
    var delBtn = e.target.closest("[data-del-event]");
    var pricingBtn = e.target.closest("[data-manage-pricing]");
    var attendeesBtn = e.target.closest("[data-view-attendees]");
    var flyerBtn = e.target.closest("[data-manage-flyer]");

    if (editBtn) {
      openEventModal(editBtn.getAttribute("data-edit-event"));
      return;
    }

    if (flyerBtn) {
      openFlyerModal(flyerBtn.getAttribute("data-manage-flyer"), flyerBtn.getAttribute("data-event-name"));
      return;
    }

    if (attendeesBtn) {
      openAttendeesModal(attendeesBtn.getAttribute("data-view-attendees"), attendeesBtn.getAttribute("data-event-name"));
      return;
    }

    if (delBtn) {
      if (!confirm("Delete this event and its RSVPs?")) return;
      try {
        await api("/events/" + delBtn.getAttribute("data-del-event"), { method: "DELETE" });
        toast("Event deleted");
        loadEvents();
      } catch (err) {
        toast(err.message, true);
      }
      return;
    }

    if (pricingBtn) {
      openPricingModal(pricingBtn.getAttribute("data-manage-pricing"), pricingBtn.getAttribute("data-event-name"));
    }
  });

  /* ============================================================
     EVENT PRICING OPTIONS
     ============================================================ */
  var pricingModal = document.getElementById("pricing-modal");
  var currentPricingEventId = null;

  function pricingKindLabel(k) { return k === "participation" ? "Participation" : "Add-on"; }

  async function loadPricingOptions() {
    var list = document.getElementById("pricing-options-list");
    try {
      var data = await api("/events/" + currentPricingEventId + "/pricing");
      if (!data.options.length) {
        list.innerHTML = '<p class="empty-note">No pricing set — this event is free.</p>';
        return;
      }
      list.innerHTML = data.options.map(function (o) {
        var priceText = o.member_amount_cents === o.non_member_amount_cents
          ? centsToDollars(o.member_amount_cents)
          : "Member " + centsToDollars(o.member_amount_cents) + " · Non-member " + centsToDollars(o.non_member_amount_cents);
        return (
          '<div class="pricing-option-row" data-id="' + o.id + '">' +
          '<span class="badge badge-tier">' + pricingKindLabel(o.kind) + "</span>" +
          '<span class="pricing-option-label">' + escapeHtml(o.label) + "</span>" +
          '<span class="pricing-option-amount">' + priceText + "</span>" +
          '<button type="button" class="icon-btn" data-del-pricing="' + o.id + '" aria-label="Remove ' + escapeHtml(o.label) + '">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6L6 18M6 6l12 12"/></svg></button>' +
          "</div>"
        );
      }).join("");
    } catch (err) {
      toast(err.message, true);
    }
  }

  function openPricingModal(eventId, eventName) {
    currentPricingEventId = eventId;
    document.getElementById("pricing-modal-title").textContent = "Pricing — " + eventName;
    document.getElementById("pricing-form").reset();
    nonMemberPriceTouched = false;
    loadPricingOptions();

    var ev = allEvents.find(function (e) { return e.id === eventId; });
    document.getElementById("cultural-member-fee").value = ev && ev.cultural_member_fee_cents != null ? centsToDollars(ev.cultural_member_fee_cents) : "";
    document.getElementById("cultural-nonmember-fee").value = ev && ev.cultural_non_member_fee_cents != null ? centsToDollars(ev.cultural_non_member_fee_cents) : "";

    pricingModal.classList.add("is-open");
  }
  function closePricingModal() { pricingModal.classList.remove("is-open"); currentPricingEventId = null; }

  document.getElementById("pricing-modal-close").addEventListener("click", closePricingModal);
  document.getElementById("pricing-close-btn").addEventListener("click", closePricingModal);
  pricingModal.addEventListener("click", function (e) { if (e.target === pricingModal) closePricingModal(); });

  // Non-member price mirrors member price until the admin edits it directly —
  // most events have no member discount, so this saves re-typing the same number.
  var nonMemberPriceTouched = false;
  var memberPriceInput = document.getElementById("pricing-member-amount");
  var nonMemberPriceInput = document.getElementById("pricing-nonmember-amount");
  memberPriceInput.addEventListener("input", function () {
    if (!nonMemberPriceTouched) nonMemberPriceInput.value = memberPriceInput.value;
  });
  nonMemberPriceInput.addEventListener("input", function () { nonMemberPriceTouched = true; });

  document.getElementById("pricing-form").addEventListener("submit", async function (e) {
    e.preventDefault();
    var payload = {
      kind: document.getElementById("pricing-kind").value,
      label: document.getElementById("pricing-label").value.trim(),
      member_amount_cents: dollarsToCents(memberPriceInput.value),
      non_member_amount_cents: dollarsToCents(nonMemberPriceInput.value),
    };
    if (!payload.label) return;
    try {
      await api("/events/" + currentPricingEventId + "/pricing", { method: "POST", body: payload });
      document.getElementById("pricing-form").reset();
      nonMemberPriceTouched = false;
      loadPricingOptions();
      toast("Pricing option added");
    } catch (err) {
      toast(err.message, true);
    }
  });

  document.getElementById("cultural-fee-form").addEventListener("submit", async function (e) {
    e.preventDefault();
    var memberVal = document.getElementById("cultural-member-fee").value;
    var nonMemberVal = document.getElementById("cultural-nonmember-fee").value;
    var payload = {
      member_amount_cents: memberVal === "" ? null : dollarsToCents(memberVal),
      non_member_amount_cents: nonMemberVal === "" ? null : dollarsToCents(nonMemberVal),
    };
    try {
      var data = await api("/events/" + currentPricingEventId + "/cultural-pricing", { method: "PUT", body: payload });
      var ev = allEvents.find(function (x) { return x.id === currentPricingEventId; });
      if (ev) {
        ev.cultural_member_fee_cents = data.event.cultural_member_fee_cents;
        ev.cultural_non_member_fee_cents = data.event.cultural_non_member_fee_cents;
      }
      toast("Cultural fee saved");
    } catch (err) {
      toast(err.message, true);
    }
  });

  document.getElementById("pricing-options-list").addEventListener("click", async function (e) {
    var btn = e.target.closest("[data-del-pricing]");
    if (!btn) return;
    try {
      await api("/events/pricing/" + btn.getAttribute("data-del-pricing"), { method: "DELETE" });
      loadPricingOptions();
      toast("Pricing option removed");
    } catch (err) {
      toast(err.message, true);
    }
  });

  /* ============================================================
     EVENT ATTENDEES
     ============================================================ */
  var attendeesModal = document.getElementById("attendees-modal");

  function rsvpStatusBadgeClass(status) {
    return { registered: "badge-paid", pending_payment: "badge-pending", attended: "badge-paid", cancelled: "badge-tier", no_show: "badge-overdue" }[status] || "badge-tier";
  }

  function memberBadge(isMember) {
    return isMember === null || isMember === undefined
      ? "—"
      : '<span class="badge ' + (isMember ? "badge-paid" : "badge-tier") + '">' + (isMember ? "Member" : "Non-member") + "</span>";
  }

  // Shared row renderer for a single registrant — used by both the
  // Attendees modal and the Reports "Event RSVP Breakdown" registrant table.
  function renderAttendeeRow(r) {
    var selections = (r.selections || []).map(function (s) {
      return escapeHtml(s.label) + (s.kind === "addon" && s.quantity > 1 ? " ×" + s.quantity : "");
    }).join(", ") || "—";
    return (
      "<tr>" +
      "<td>" + escapeHtml(r.first_name + " " + r.last_name) + "</td>" +
      "<td>" + escapeHtml(r.email) + "</td>" +
      "<td>" + memberBadge(r.is_member) + "</td>" +
      "<td>" + memberBadge(r.member_at_registration) + "</td>" +
      "<td>" + selections + "</td>" +
      "<td>" + (r.amount_cents ? fmtMoney(r.amount_cents) : "Free") + "</td>" +
      "<td><span class=\"badge " + rsvpStatusBadgeClass(r.status) + "\">" + escapeHtml(r.status) + "</span></td>" +
      "</tr>"
    );
  }

  async function openAttendeesModal(eventId, eventName) {
    document.getElementById("attendees-modal-title").textContent = "Attendees — " + eventName;
    var tbody = document.getElementById("attendees-tbody");
    var empty = document.getElementById("attendees-empty");
    tbody.innerHTML = "";
    empty.style.display = "none";
    attendeesModal.classList.add("is-open");

    try {
      var data = await api("/events/" + eventId + "/rsvps");
      empty.style.display = data.rsvps.length ? "none" : "";
      tbody.innerHTML = data.rsvps.map(renderAttendeeRow).join("");
    } catch (err) {
      toast(err.message, true);
    }
  }

  function closeAttendeesModal() { attendeesModal.classList.remove("is-open"); }
  document.getElementById("attendees-modal-close").addEventListener("click", closeAttendeesModal);
  document.getElementById("attendees-close-btn").addEventListener("click", closeAttendeesModal);
  attendeesModal.addEventListener("click", function (e) { if (e.target === attendeesModal) closeAttendeesModal(); });

  /* ============================================================
     EVENT FLYER
     ============================================================ */
  var flyerModal = document.getElementById("flyer-modal");
  var currentFlyerEventId = null;

  function renderFlyerPreview(filename) {
    var host = document.getElementById("flyer-preview");
    var removeBtn = document.getElementById("flyer-remove-btn");
    if (filename) {
      host.innerHTML = '<img src="' + apiOrigin + "/uploads/events/" + filename + '" alt="Current flyer" style="max-width:100%; border-radius:var(--radius-sm);">';
      removeBtn.style.display = "";
    } else {
      host.innerHTML = '<p class="empty-note">No flyer uploaded yet.</p>';
      removeBtn.style.display = "none";
    }
  }

  function openFlyerModal(eventId, eventName) {
    currentFlyerEventId = eventId;
    document.getElementById("flyer-modal-title").textContent = "Flyer — " + eventName;
    document.getElementById("flyer-upload-form").reset();
    var ev = allEvents.find(function (e) { return e.id === eventId; });
    renderFlyerPreview(ev ? ev.flyer_filename : null);
    flyerModal.classList.add("is-open");
  }

  function closeFlyerModal() { flyerModal.classList.remove("is-open"); currentFlyerEventId = null; }
  document.getElementById("flyer-modal-close").addEventListener("click", closeFlyerModal);
  document.getElementById("flyer-close-btn").addEventListener("click", closeFlyerModal);
  flyerModal.addEventListener("click", function (e) { if (e.target === flyerModal) closeFlyerModal(); });

  document.getElementById("flyer-upload-form").addEventListener("submit", async function (e) {
    e.preventDefault();
    var fileInput = document.getElementById("flyer-file");
    if (!fileInput.files[0]) return;
    var formData = new FormData();
    formData.append("flyer", fileInput.files[0]);
    try {
      var res = await fetch(API + "/events/" + currentFlyerEventId + "/flyer", {
        method: "POST",
        headers: { Authorization: "Bearer " + token },
        body: formData,
      });
      var data = await res.json().catch(function () { return {}; });
      if (!res.ok) throw new Error(data.error || "Could not upload flyer");
      renderFlyerPreview(data.flyer_filename);
      loadEvents();
      toast("Flyer uploaded");
    } catch (err) {
      toast(err.message, true);
    }
  });

  document.getElementById("flyer-remove-btn").addEventListener("click", async function () {
    if (!confirm("Remove this event's flyer?")) return;
    try {
      await api("/events/" + currentFlyerEventId + "/flyer", { method: "DELETE" });
      renderFlyerPreview(null);
      loadEvents();
      toast("Flyer removed");
    } catch (err) {
      toast(err.message, true);
    }
  });

  eventForm.addEventListener("submit", async function (e) {
    e.preventDefault();
    var id = document.getElementById("ev-id").value;
    var payload = {
      name: document.getElementById("ev-name").value.trim(),
      event_date: new Date(document.getElementById("ev-date").value).toISOString(),
      location: document.getElementById("ev-location").value.trim() || null,
      description: document.getElementById("ev-description").value.trim() || null,
    };
    try {
      if (id) {
        await api("/events/" + id, { method: "PUT", body: payload });
        toast("Event updated");
      } else {
        await api("/events", { method: "POST", body: payload });
        toast("Event created");
      }
      closeEventModal();
      loadEvents();
    } catch (err) {
      toast(err.message, true);
    }
  });

  /* ============================================================
     BOARD MEMBERS (superadmin only)
     ============================================================ */
  var adminsTbody = document.getElementById("admins-tbody");
  var adminsEmpty = document.getElementById("admins-empty");
  var adminModal = document.getElementById("admin-modal");
  var adminForm = document.getElementById("admin-form");

  function roleLabel(role) { return role === "superadmin" ? "Super Admin" : "Board Director"; }

  async function loadAdmins() {
    if (!isSuperAdmin) return;
    try {
      var data = await api("/admins");
      adminsEmpty.style.display = data.admins.length ? "none" : "";
      adminsTbody.innerHTML = data.admins.map(function (a) {
        return (
          '<tr data-id="' + a.id + '">' +
          "<td>" + escapeHtml(a.name) + "</td>" +
          "<td>" + escapeHtml(a.email) + "</td>" +
          '<td><span class="badge badge-tier">' + roleLabel(a.role) + "</span></td>" +
          "<td>" + fmtDate(a.created_at) + "</td>" +
          '<td class="row-actions">' +
          '<button class="icon-btn" data-edit-admin="' + a.id + '" aria-label="Edit ' + escapeHtml(a.name) + '"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4z"/></svg></button>' +
          "</td></tr>"
        );
      }).join("");
    } catch (err) {
      toast(err.message, true);
    }
  }

  document.getElementById("add-admin-btn").addEventListener("click", function () { openAdminModal(null); });
  document.getElementById("admin-modal-close").addEventListener("click", closeAdminModal);
  document.getElementById("admin-cancel-btn").addEventListener("click", closeAdminModal);
  adminModal.addEventListener("click", function (e) { if (e.target === adminModal) closeAdminModal(); });
  function closeAdminModal() { adminModal.classList.remove("is-open"); }

  adminsTbody.addEventListener("click", function (e) {
    var btn = e.target.closest("[data-edit-admin]");
    if (btn) openAdminModal(btn.getAttribute("data-edit-admin"));
  });

  function openAdminModal(id) {
    adminForm.reset();
    document.getElementById("admin-id").value = id || "";
    document.getElementById("delete-admin-btn").style.display = id ? "" : "none";
    document.getElementById("a-password").required = !id;
    document.getElementById("a-password-hint").style.display = id ? "" : "none";
    document.getElementById("a-password-label").textContent = id ? "New Password (optional)" : "Password";

    if (id) {
      document.getElementById("admin-modal-title").textContent = "Edit Admin Login";
      var row = adminsTbody.querySelector('tr[data-id="' + id + '"]');
      document.getElementById("a-name").value = row.children[0].textContent;
      document.getElementById("a-email").value = row.children[1].textContent;
      document.getElementById("a-role").value = row.children[2].textContent.trim() === "Super Admin" ? "superadmin" : "board";
    } else {
      document.getElementById("admin-modal-title").textContent = "Add Admin Login";
      document.getElementById("a-role").value = "board";
    }
    adminModal.classList.add("is-open");
  }

  adminForm.addEventListener("submit", async function (e) {
    e.preventDefault();
    var id = document.getElementById("admin-id").value;
    var password = document.getElementById("a-password").value;
    var payload = {
      name: document.getElementById("a-name").value.trim(),
      email: document.getElementById("a-email").value.trim(),
      role: document.getElementById("a-role").value,
    };
    if (password) payload.password = password;

    try {
      if (id) {
        await api("/admins/" + id, { method: "PUT", body: payload });
        toast("Board member updated");
      } else {
        await api("/admins", { method: "POST", body: payload });
        toast("Board member added");
      }
      closeAdminModal();
      loadAdmins();
    } catch (err) {
      toast(err.message, true);
    }
  });

  document.getElementById("delete-admin-btn").addEventListener("click", async function () {
    var id = document.getElementById("admin-id").value;
    if (!id) return;
    if (!confirm("Remove this board member's login? This can't be undone.")) return;
    try {
      await api("/admins/" + id, { method: "DELETE" });
      toast("Board member removed");
      closeAdminModal();
      loadAdmins();
    } catch (err) {
      toast(err.message, true);
    }
  });

  /* ============================================================
     MAIL SERVER SETTINGS (superadmin only)
     ============================================================ */
  var mailSettingsForm = document.getElementById("mail-settings-form");

  async function loadMailSettings() {
    if (!isSuperAdmin) return;
    try {
      var data = await api("/mail-settings");
      var s = data.settings || {};
      document.getElementById("ms-host").value = s.smtp_host || "";
      document.getElementById("ms-port").value = s.smtp_port || "";
      document.getElementById("ms-user").value = s.smtp_user || "";
      document.getElementById("ms-from").value = s.from_address || "";
      document.getElementById("ms-secure").checked = !!s.smtp_secure;
      document.getElementById("ms-password").value = "";
      var badge = document.getElementById("mail-status-badge");
      badge.innerHTML = s.smtp_host
        ? '<span class="badge badge-paid">Configured' + (s.has_password ? "" : " — no password set") + '</span>'
        : '<span class="badge badge-tier">Not configured — password resets and communications will be logged to the server console instead of sent</span>';
    } catch (err) {
      toast(err.message, true);
    }
  }

  mailSettingsForm.addEventListener("submit", async function (e) {
    e.preventDefault();
    var payload = {
      smtp_host: document.getElementById("ms-host").value.trim(),
      smtp_port: document.getElementById("ms-port").value ? Number(document.getElementById("ms-port").value) : 587,
      smtp_secure: document.getElementById("ms-secure").checked,
      smtp_user: document.getElementById("ms-user").value.trim(),
      from_address: document.getElementById("ms-from").value.trim(),
    };
    var password = document.getElementById("ms-password").value;
    if (password) payload.password = password;
    try {
      await api("/mail-settings", { method: "PUT", body: payload });
      toast("Mail settings saved");
      loadMailSettings();
    } catch (err) {
      toast(err.message, true);
    }
  });

  document.getElementById("ms-test-btn").addEventListener("click", async function () {
    var to = document.getElementById("ms-test-to").value.trim();
    if (!to) { toast("Enter a recipient email first.", true); return; }
    var btn = this;
    btn.disabled = true;
    btn.textContent = "Sending…";
    try {
      await api("/mail-settings/test", { method: "POST", body: { to: to } });
      toast("Test email sent — check the inbox.");
    } catch (err) {
      toast(err.message, true);
    } finally {
      btn.disabled = false;
      btn.textContent = "Send Test Email";
    }
  });

  /* ============================================================
     COMMUNICATIONS
     ============================================================ */
  var commsForm = document.getElementById("comms-form");
  var commsTier = document.getElementById("comms-tier");
  var commsStatus = document.getElementById("comms-status");
  var commsCountEl = document.getElementById("comms-recipient-count");

  async function refreshRecipientCount() {
    var params = new URLSearchParams();
    if (commsTier.value) params.set("tier", commsTier.value);
    if (commsStatus.value) params.set("status", commsStatus.value);
    try {
      var data = await api("/communications/recipient-count?" + params.toString());
      commsCountEl.textContent = "This will be sent to " + data.count + " member" + (data.count === 1 ? "" : "s") + ".";
    } catch (err) {
      commsCountEl.textContent = "Could not load recipient count.";
    }
  }
  commsTier.addEventListener("change", refreshRecipientCount);
  commsStatus.addEventListener("change", refreshRecipientCount);

  commsForm.addEventListener("submit", async function (e) {
    e.preventDefault();
    var sendBtn = document.getElementById("comms-send-btn");
    sendBtn.disabled = true;
    sendBtn.textContent = "Sending…";

    var payload = {
      subject: document.getElementById("comms-subject").value.trim(),
      body: document.getElementById("comms-body").value,
      tier: commsTier.value || undefined,
      payment_status: commsStatus.value || undefined,
    };

    try {
      var data = await api("/communications/send", { method: "POST", body: payload });
      toast("Sent to " + data.delivered + " of " + data.recipient_count + " recipients" + (data.failed ? " (" + data.failed + " failed)" : ""));
      commsForm.reset();
      refreshRecipientCount();
    } catch (err) {
      toast(err.message, true);
    } finally {
      sendBtn.disabled = false;
      sendBtn.textContent = "Send Email";
    }
  });

  /* ============================================================
     HOMEPAGE CONTENT
     ============================================================ */
  var HOMEPAGE_FIELD_MAP = {
    "hc-hero-heading": "hero.heading",
    "hc-hero-motto": "hero.tamil_motto",
    "hc-hero-lede": "hero.lede",
    "hc-stat-families": "hero.stat_families",
    "hc-stat-events": "hero.stat_events_per_year",
    "hc-stat-founded": "hero.stat_founded_year",
    "hc-mission": "about.mission",
    "hc-bullet-founded": "about.bullet_founded",
    "hc-bullet-nonprofit": "about.bullet_nonprofit",
    "hc-bullet-serving": "about.bullet_serving",
    "hc-pillar1-title": "pillars.1_title",
    "hc-pillar1-desc": "pillars.1_description",
    "hc-pillar2-title": "pillars.2_title",
    "hc-pillar2-desc": "pillars.2_description",
    "hc-pillar3-title": "pillars.3_title",
    "hc-pillar3-desc": "pillars.3_description",
    "hc-pillar4-title": "pillars.4_title",
    "hc-pillar4-desc": "pillars.4_description",
    "hc-membership-note": "involve.membership_note",
    "hc-sponsor-note": "involve.sponsor_note",
    "hc-contact-email": "contact.email",
    "hc-contact-phone": "contact.phone",
    "hc-contact-location": "contact.location",
    "hc-facebook-url": "contact.facebook_url",
    "hc-instagram-url": "contact.instagram_url",
    "hc-youtube-url": "contact.youtube_url",
  };
  var homepageForm = document.getElementById("homepage-form");
  var homepageSaveBtn = homepageForm.querySelector('button[type="submit"]');
  var homepageContentLoaded = false;

  async function loadHomepageContent() {
    homepageContentLoaded = false;
    homepageSaveBtn.disabled = true;
    homepageSaveBtn.textContent = "Loading current content…";
    try {
      var data = await api("/site-content");
      Object.keys(HOMEPAGE_FIELD_MAP).forEach(function (fieldId) {
        var el = document.getElementById(fieldId);
        var value = data.content[HOMEPAGE_FIELD_MAP[fieldId]];
        if (el && value !== undefined) el.value = value;
      });
      homepageContentLoaded = true;
      homepageSaveBtn.disabled = false;
      homepageSaveBtn.textContent = "Save Changes";
    } catch (err) {
      // Leave Save disabled — submitting now would overwrite every field
      // with blanks, since none of them got populated.
      homepageSaveBtn.textContent = "Couldn't load — reopen this tab to retry";
      toast(err.message, true);
    }
  }

  homepageForm.addEventListener("submit", async function (e) {
    e.preventDefault();
    if (!homepageContentLoaded) {
      toast("Current content hasn't finished loading — please wait and try again.", true);
      return;
    }
    var payload = {};
    Object.keys(HOMEPAGE_FIELD_MAP).forEach(function (fieldId) {
      var el = document.getElementById(fieldId);
      if (el) payload[HOMEPAGE_FIELD_MAP[fieldId]] = el.value;
    });
    try {
      await api("/site-content", { method: "PUT", body: payload });
      toast("Homepage content updated");
    } catch (err) {
      toast(err.message, true);
    }
  });

  /* ============================================================
     MEDIA (gallery photos + sponsor logos)
     ============================================================ */
  var apiOrigin = API.replace(/\/api\/?$/, "");

  async function loadMedia() {
    try {
      var galleryData = await api("/gallery");
      var galleryGrid = document.getElementById("gallery-media-grid");
      var galleryEmpty = document.getElementById("gallery-media-empty");
      galleryEmpty.style.display = galleryData.photos.length ? "none" : "";
      galleryGrid.innerHTML = galleryData.photos.map(function (p) {
        return (
          '<div class="media-item" data-id="' + p.id + '">' +
          '<img src="' + apiOrigin + "/uploads/gallery/" + p.filename + '" alt="' + escapeHtml(p.caption || "") + '">' +
          (p.caption ? '<span class="media-caption">' + escapeHtml(p.caption) + "</span>" : "") +
          '<button type="button" class="media-delete" data-delete-gallery="' + p.id + '" aria-label="Delete photo">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6L6 18M6 6l12 12"/></svg></button>' +
          "</div>"
        );
      }).join("");

      var sponsorData = await api("/sponsors");
      var sponsorGrid = document.getElementById("sponsor-media-grid");
      var sponsorEmpty = document.getElementById("sponsor-media-empty");
      sponsorEmpty.style.display = sponsorData.sponsors.length ? "none" : "";
      sponsorGrid.innerHTML = sponsorData.sponsors.map(function (s) {
        return (
          '<div class="media-item is-logo" data-id="' + s.id + '">' +
          '<img src="' + apiOrigin + "/uploads/sponsors/" + s.filename + '" alt="' + escapeHtml(s.name) + '">' +
          '<span class="media-caption">' + escapeHtml(s.name) + "</span>" +
          '<button type="button" class="media-delete" data-delete-sponsor="' + s.id + '" aria-label="Delete sponsor">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6L6 18M6 6l12 12"/></svg></button>' +
          "</div>"
        );
      }).join("");
    } catch (err) {
      toast(err.message, true);
    }
  }

  document.getElementById("gallery-upload-form").addEventListener("submit", async function (e) {
    e.preventDefault();
    var fileInput = document.getElementById("gallery-file");
    if (!fileInput.files[0]) return;
    var formData = new FormData();
    formData.append("photo", fileInput.files[0]);
    formData.append("caption", document.getElementById("gallery-caption").value.trim());
    try {
      await apiUpload("/gallery", formData);
      toast("Photo uploaded");
      this.reset();
      loadMedia();
    } catch (err) {
      toast(err.message, true);
    }
  });

  document.getElementById("sponsor-upload-form").addEventListener("submit", async function (e) {
    e.preventDefault();
    var fileInput = document.getElementById("sponsor-file");
    if (!fileInput.files[0]) return;
    var formData = new FormData();
    formData.append("logo", fileInput.files[0]);
    formData.append("name", document.getElementById("sponsor-name").value.trim());
    formData.append("website_url", document.getElementById("sponsor-url").value.trim());
    try {
      await apiUpload("/sponsors", formData);
      toast("Sponsor added");
      this.reset();
      loadMedia();
    } catch (err) {
      toast(err.message, true);
    }
  });

  document.getElementById("gallery-media-grid").addEventListener("click", async function (e) {
    var btn = e.target.closest("[data-delete-gallery]");
    if (!btn) return;
    if (!confirm("Delete this photo?")) return;
    try {
      await api("/gallery/" + btn.getAttribute("data-delete-gallery"), { method: "DELETE" });
      loadMedia();
    } catch (err) {
      toast(err.message, true);
    }
  });

  document.getElementById("sponsor-media-grid").addEventListener("click", async function (e) {
    var btn = e.target.closest("[data-delete-sponsor]");
    if (!btn) return;
    if (!confirm("Remove this sponsor?")) return;
    try {
      await api("/sponsors/" + btn.getAttribute("data-delete-sponsor"), { method: "DELETE" });
      loadMedia();
    } catch (err) {
      toast(err.message, true);
    }
  });

  /* ============================================================
     BOARD ROSTER — public "Board of Directors" bios (distinct from
     Admin Logins, which is who can sign into this dashboard).
     ============================================================ */
  var boardProfileForm = document.getElementById("board-profile-form");
  var boardPhotoInput = document.getElementById("board-photo");
  var editingBoardProfileId = null;

  function termLabel(p) {
    return p.term_start_year + "–" + (p.term_end_year ? p.term_end_year : "Present");
  }

  var PERSON_PLACEHOLDER_SVG = '<svg class="media-placeholder" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>';

  function boardProfileTile(p) {
    var img = p.photo_filename
      ? '<img src="' + apiOrigin + "/uploads/board/" + p.photo_filename + '" alt="' + escapeHtml(p.name) + '">'
      : PERSON_PLACEHOLDER_SVG;
    return (
      '<div class="media-item is-board" data-id="' + p.id + '">' +
      img +
      '<span class="media-caption"><strong>' + escapeHtml(p.name) + "</strong><br>" + escapeHtml(p.title) + "<br>" + termLabel(p) + "</span>" +
      '<button type="button" class="media-edit" data-edit-board="' + p.id + '" aria-label="Edit ' + escapeHtml(p.name) + '"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4z"/></svg></button>' +
      '<button type="button" class="media-delete" data-delete-board="' + p.id + '" aria-label="Delete ' + escapeHtml(p.name) + '"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6L6 18M6 6l12 12"/></svg></button>' +
      "</div>"
    );
  }

  var allBoardProfiles = [];

  async function loadBoardRoster() {
    try {
      var data = await api("/board-profiles");
      allBoardProfiles = data.profiles;
      var current = data.profiles.filter(function (p) { return !p.term_end_year; });
      var past = data.profiles.filter(function (p) { return p.term_end_year; });

      document.getElementById("board-current-empty").style.display = current.length ? "none" : "";
      document.getElementById("board-current-list").innerHTML = current.map(boardProfileTile).join("");
      document.getElementById("board-past-empty").style.display = past.length ? "none" : "";
      document.getElementById("board-past-list").innerHTML = past.map(boardProfileTile).join("");
    } catch (err) {
      toast(err.message, true);
    }
  }

  function resetBoardProfileForm() {
    editingBoardProfileId = null;
    boardProfileForm.reset();
    document.getElementById("board-profile-submit").textContent = "Add to Roster";
  }

  boardProfileForm.addEventListener("submit", async function (e) {
    e.preventDefault();
    var payload = {
      name: document.getElementById("board-name").value.trim(),
      title: document.getElementById("board-title").value.trim(),
      term_start_year: document.getElementById("board-start-year").value,
      term_end_year: document.getElementById("board-end-year").value || null,
    };
    if (!payload.name || !payload.title) return;

    try {
      var profileId = editingBoardProfileId;
      if (profileId) {
        await api("/board-profiles/" + profileId, { method: "PUT", body: payload });
      } else {
        var created = await api("/board-profiles", { method: "POST", body: payload });
        profileId = created.profile.id;
      }

      if (boardPhotoInput.files[0]) {
        var formData = new FormData();
        formData.append("photo", boardPhotoInput.files[0]);
        await apiUpload("/board-profiles/" + profileId + "/photo", formData);
      }

      toast(editingBoardProfileId ? "Board profile updated" : "Added to roster");
      resetBoardProfileForm();
      loadBoardRoster();
    } catch (err) {
      toast(err.message, true);
    }
  });

  function boardRosterClick(e) {
    var editBtn = e.target.closest("[data-edit-board]");
    var delBtn = e.target.closest("[data-delete-board]");

    if (editBtn) {
      var id = editBtn.getAttribute("data-edit-board");
      var p = allBoardProfiles.find(function (x) { return x.id === id; });
      if (!p) return;
      editingBoardProfileId = id;
      document.getElementById("board-name").value = p.name;
      document.getElementById("board-title").value = p.title;
      document.getElementById("board-start-year").value = p.term_start_year;
      document.getElementById("board-end-year").value = p.term_end_year || "";
      document.getElementById("board-profile-submit").textContent = "Save Changes";
      document.getElementById("board-name").focus();
      return;
    }

    if (delBtn) {
      if (!confirm("Remove this person from the board roster?")) return;
      var delId = delBtn.getAttribute("data-delete-board");
      api("/board-profiles/" + delId, { method: "DELETE" }).then(function () {
        if (editingBoardProfileId === delId) resetBoardProfileForm();
        loadBoardRoster();
      }).catch(function (err) { toast(err.message, true); });
    }
  }
  document.getElementById("board-current-list").addEventListener("click", boardRosterClick);
  document.getElementById("board-past-list").addEventListener("click", boardRosterClick);

  /* ============================================================
     PAYMENT PAGE SETTINGS
     ============================================================ */
  var paymentForm = document.getElementById("payment-settings-form");

  function centsToDollars(c) { return (c / 100).toFixed(2); }
  function dollarsToCents(d) { return Math.round(parseFloat(d || "0") * 100); }

  async function loadPaymentSettings() {
    try {
      var data = await api("/payment-settings");
      document.getElementById("pay-heading").value = data.content.heading;
      document.getElementById("pay-intro").value = data.content.intro_text;
      document.getElementById("pay-instructions").value = data.content.instructions;
    } catch (err) {
      toast(err.message, true);
    }
  }

  paymentForm.addEventListener("submit", async function (e) {
    e.preventDefault();
    var payload = {
      content: {
        heading: document.getElementById("pay-heading").value.trim(),
        intro_text: document.getElementById("pay-intro").value.trim(),
        instructions: document.getElementById("pay-instructions").value.trim(),
      },
    };
    try {
      await api("/payment-settings", { method: "PUT", body: payload });
      toast("Payment page updated");
    } catch (err) {
      toast(err.message, true);
    }
  });

  /* ============================================================
     MEMBERSHIP CATEGORIES
     ============================================================ */
  var allCategories = []; // cached, refreshed on load + after any CRUD op
  var editingCategoryId = null;
  var categoryForm = document.getElementById("category-form");
  var categoryLabelInput = document.getElementById("category-label");
  var categoryAmountInput = document.getElementById("category-amount");

  function categoryOptionsHtml(selectedKey, includeBlank, blankLabel) {
    var html = includeBlank ? '<option value="">' + blankLabel + "</option>" : "";
    html += allCategories.map(function (c) {
      var label = escapeHtml(c.label) + (c.is_active ? "" : " (archived)");
      return '<option value="' + c.key + '"' + (c.key === selectedKey ? " selected" : "") + ">" + label + "</option>";
    }).join("");
    return html;
  }

  function populateTierSelects() {
    var filterTier = document.getElementById("filter-tier");
    var commsTier = document.getElementById("comms-tier");
    var fTier = document.getElementById("f-tier");
    if (filterTier) filterTier.innerHTML = categoryOptionsHtml(filterTier.value, true, "All tiers");
    if (commsTier) commsTier.innerHTML = categoryOptionsHtml(commsTier.value, true, "All tiers");
    if (fTier) fTier.innerHTML = categoryOptionsHtml(fTier.value, false);
  }

  async function refreshCategories() {
    try {
      var data = await api("/membership-categories");
      allCategories = data.categories;
      populateTierSelects();
    } catch (err) {
      toast(err.message, true);
    }
  }

  function renderCategoriesList() {
    var host = document.getElementById("membership-categories-list");
    if (!allCategories.length) {
      host.innerHTML = '<p class="empty-note">No membership categories yet.</p>';
      return;
    }
    host.innerHTML = allCategories.map(function (c) {
      return (
        '<div class="pricing-option-row" data-id="' + c.id + '">' +
        '<button type="button" class="badge ' + (c.is_active ? "badge-paid" : "badge-tier") + '" data-toggle-active="' + c.id + '" data-active="' + c.is_active + '" style="border:none; cursor:pointer;" aria-label="Toggle active">' +
        (c.is_active ? "Active" : "Archived") + "</button>" +
        '<span class="pricing-option-label">' + escapeHtml(c.label) + "</span>" +
        '<span class="pricing-option-amount">' + centsToDollars(c.amount_cents) + "</span>" +
        '<button type="button" class="icon-btn" data-edit-category="' + c.id + '" aria-label="Edit ' + escapeHtml(c.label) + '"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4z"/></svg></button>' +
        '<button type="button" class="icon-btn" data-del-category="' + c.id + '" aria-label="Delete ' + escapeHtml(c.label) + '"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6L6 18M6 6l12 12"/></svg></button>' +
        "</div>"
      );
    }).join("");
  }

  async function loadMembershipCategories() {
    await refreshCategories();
    renderCategoriesList();
  }

  function resetCategoryForm() {
    editingCategoryId = null;
    categoryForm.reset();
    categoryForm.querySelector("button[type=submit]").textContent = "Add Category";
  }

  categoryForm.addEventListener("submit", async function (e) {
    e.preventDefault();
    var payload = {
      label: categoryLabelInput.value.trim(),
      amount_cents: dollarsToCents(categoryAmountInput.value),
    };
    if (!payload.label) return;
    try {
      if (editingCategoryId) {
        await api("/membership-categories/" + editingCategoryId, { method: "PUT", body: payload });
        toast("Category updated");
      } else {
        await api("/membership-categories", { method: "POST", body: payload });
        toast("Category added");
      }
      resetCategoryForm();
      await refreshCategories();
      renderCategoriesList();
    } catch (err) {
      toast(err.message, true);
    }
  });

  document.getElementById("membership-categories-list").addEventListener("click", async function (e) {
    var editBtn = e.target.closest("[data-edit-category]");
    var delBtn = e.target.closest("[data-del-category]");
    var toggleBtn = e.target.closest("[data-toggle-active]");

    if (editBtn) {
      var id = editBtn.getAttribute("data-edit-category");
      var cat = allCategories.find(function (c) { return c.id === id; });
      if (!cat) return;
      editingCategoryId = id;
      categoryLabelInput.value = cat.label;
      categoryAmountInput.value = centsToDollars(cat.amount_cents);
      categoryForm.querySelector("button[type=submit]").textContent = "Save Changes";
      categoryLabelInput.focus();
      return;
    }

    if (toggleBtn) {
      var toggleId = toggleBtn.getAttribute("data-toggle-active");
      var nowActive = toggleBtn.getAttribute("data-active") !== "true";
      try {
        await api("/membership-categories/" + toggleId, { method: "PUT", body: { is_active: nowActive } });
        await refreshCategories();
        renderCategoriesList();
      } catch (err) {
        toast(err.message, true);
      }
      return;
    }

    if (delBtn) {
      if (!confirm("Delete this category? This only works if no members currently have it.")) return;
      try {
        await api("/membership-categories/" + delBtn.getAttribute("data-del-category"), { method: "DELETE" });
        toast("Category deleted");
        if (editingCategoryId === delBtn.getAttribute("data-del-category")) resetCategoryForm();
        await refreshCategories();
        renderCategoriesList();
      } catch (err) {
        toast(err.message, true);
      }
    }
  });

  /* ============================================================
     REPORTS
     ============================================================ */
  function tierLabel(t) {
    var cat = allCategories.find(function (c) { return c.key === t; });
    return cat ? cat.label : t;
  }
  function statusLabel(s) { return { paid: "Paid", pending: "Pending", overdue: "Overdue", waived: "Waived" }[s] || s; }

  async function loadReports() {
    try {
      var data = await api("/reports/summary");
      document.getElementById("report-stats").innerHTML = [
        { label: "Total Members", value: data.total_members },
        { label: "Family Members", value: data.total_family_members },
        { label: "Upcoming Events", value: data.upcoming_events },
        { label: "Active RSVPs", value: data.active_rsvps },
      ].map(function (s) {
        return '<div class="stat-card"><strong>' + s.value + "</strong><span>" + s.label + "</span></div>";
      }).join("");

      document.getElementById("report-by-tier").innerHTML = data.by_tier.map(function (row) {
        return '<span class="pill">' + tierLabel(row.key) + ": <strong style=\"margin-left:.3em;\">" + row.n + "</strong></span>";
      }).join("") || '<span class="empty-note">No data yet.</span>';

      document.getElementById("report-by-status").innerHTML = data.by_payment_status.map(function (row) {
        return '<span class="pill">' + statusLabel(row.key) + ": <strong style=\"margin-left:.3em;\">" + row.n + "</strong></span>";
      }).join("") || '<span class="empty-note">No data yet.</span>';
    } catch (err) {
      toast(err.message, true);
    }
  }

  function paymentStatusBadgeClass(status) {
    return { completed: "badge-paid", pending: "badge-pending", failed: "badge-overdue", cancelled: "badge-tier" }[status] || "badge-tier";
  }
  function fmtMoney(cents) {
    return (cents / 100).toLocaleString(undefined, { style: "currency", currency: "USD" });
  }

  async function loadPayments() {
    var tbody = document.getElementById("payments-tbody");
    var empty = document.getElementById("payments-empty");
    try {
      var data = await api("/payments" + reportEventQuery());
      empty.style.display = data.payments.length ? "none" : "";
      tbody.innerHTML = data.payments.map(function (p) {
        var what = p.purpose === "event"
          ? '<span class="badge badge-tier">Event</span> ' + escapeHtml(p.event_name || "—")
          : p.purpose === "cultural_group"
            ? '<span class="badge badge-tier">Cultural</span> ' + escapeHtml(p.event_name || "—")
            : '<span class="badge badge-tier">' + tierLabel(p.tier) + "</span>";
        return (
          "<tr>" +
          "<td>" + escapeHtml(p.first_name + " " + p.last_name) + "<br><span style=\"color:var(--text-soft); font-size:.82rem;\">" + escapeHtml(p.email) + "</span></td>" +
          "<td>" + what + "</td>" +
          "<td>" + fmtMoney(p.amount_cents) + "</td>" +
          "<td><span class=\"badge " + paymentStatusBadgeClass(p.status) + "\">" + p.status + "</span></td>" +
          "<td>" + fmtDateTime(p.created_at) + "</td>" +
          "</tr>"
        );
      }).join("");
    } catch (err) {
      toast(err.message, true);
    }
  }

  // Rebuilds an "All events / <each event>" dropdown from the events list,
  // keeping the current selection, so newly added events show up without a
  // page reload. Resolves (never rejects) so callers can chain loads on it.
  function refreshEventFilter(selectId) {
    var select = document.getElementById(selectId);
    var previous = select.value;
    return api("/events").then(function (data) {
      select.innerHTML = '<option value="">All events</option>' + data.events.map(function (ev) {
        return '<option value="' + ev.id + '">' + escapeHtml(ev.name) + "</option>";
      }).join("");
      select.value = previous;
      if (select.selectedIndex === -1) select.value = "";
    }).catch(function (err) {
      toast(err.message, true);
    });
  }

  var reportEventFilter = document.getElementById("report-event-filter");
  function reportEventQuery() {
    return reportEventFilter.value ? "?event_id=" + encodeURIComponent(reportEventFilter.value) : "";
  }
  function loadReportEventSections() {
    loadPayments();
    loadRsvpBreakdown();
    loadReportCultural();
  }
  reportEventFilter.addEventListener("change", loadReportEventSections);

  // Downloads an authenticated export and saves it under a name that says
  // which selection it holds, e.g. rits-cultural-events-thanksgiving-2026-09-21.xlsx.
  async function runExport(btn, path, prefix, select) {
    var label = btn.textContent;
    btn.disabled = true;
    btn.textContent = "Preparing…";
    try {
      var res = await fetch(API + path, { headers: { Authorization: "Bearer " + token } });
      if (!res.ok) throw new Error("Could not generate the export");
      var blob = await res.blob();
      var chosen = select.value ? select.options[select.selectedIndex].textContent : "all events";
      var slug = chosen.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "event";
      var url = URL.createObjectURL(blob);
      var a = document.createElement("a");
      a.href = url;
      a.download = prefix + "-" + slug + "-" + new Date().toISOString().slice(0, 10) + ".xlsx";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast(err.message, true);
    } finally {
      btn.disabled = false;
      btn.textContent = label;
    }
  }

  document.getElementById("export-report-xlsx-btn").addEventListener("click", function () {
    runExport(this, "/reports/event-report.xlsx" + reportEventQuery(), "rits-event-report", reportEventFilter);
  });

  document.getElementById("export-csv-btn").addEventListener("click", async function () {
    try {
      var res = await fetch(API + "/reports/members.csv", { headers: { Authorization: "Bearer " + token } });
      if (!res.ok) throw new Error("Could not generate the export");
      var blob = await res.blob();
      var url = URL.createObjectURL(blob);
      var a = document.createElement("a");
      a.href = url;
      a.download = "rits-members-" + new Date().toISOString().slice(0, 10) + ".csv";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast(err.message, true);
    }
  });

  function renderRegistrantsTable(registrants) {
    if (!registrants || !registrants.length) return "";
    return (
      '<div class="section-title" style="font-size:.85rem;">By Registrant</div>' +
      '<table><thead><tr><th>Name</th><th>Email</th><th>Member (Now)</th><th>Member (At Signup)</th><th>Selections</th><th>Amount</th><th>Status</th></tr></thead><tbody>' +
      registrants.map(renderAttendeeRow).join("") +
      "</tbody></table>"
    );
  }

  async function loadRsvpBreakdown() {
    var host = document.getElementById("rsvp-breakdown-list");
    var empty = document.getElementById("rsvp-breakdown-empty");
    try {
      var data = await api("/reports/rsvp-breakdown" + reportEventQuery());
      empty.style.display = data.events.length ? "none" : "";
      host.innerHTML = data.events.map(function (ev) {
        var optionsTable = ev.options.length
          ? '<table style="margin-top:.75rem;"><thead><tr><th>Option</th><th>Type</th><th>Qty</th><th>Registrants</th><th>Collected</th><th>Pending</th></tr></thead><tbody>' +
            ev.options.map(function (o) {
              return (
                "<tr><td>" + escapeHtml(o.label) + "</td><td>" + pricingKindLabel(o.kind) + "</td><td>" +
                o.quantity + "</td><td>" + o.registrant_count + "</td><td>" + fmtMoney(o.confirmed_revenue_cents) +
                "</td><td>" + (o.pending_revenue_cents ? fmtMoney(o.pending_revenue_cents) : "—") + "</td></tr>"
              );
            }).join("") + "</tbody></table>"
          : "";

        return (
          '<div class="table-wrap" style="padding:1.5rem; margin-bottom:1rem;">' +
          '<div class="section-title" style="margin-top:0; display:flex; justify-content:space-between; align-items:baseline; gap:1rem;">' +
          "<span>" + escapeHtml(ev.event_name) + '<span style="font-weight:400; color:var(--text-soft); margin-left:.5rem;">' + fmtDate(ev.event_date) + "</span></span>" +
          '<span style="color:var(--maroon);">' + fmtMoney(ev.confirmed_revenue_cents) + " collected</span>" +
          "</div>" +
          '<div class="pill-list">' +
          '<span class="pill">Confirmed: <strong style="margin-left:.3em;">' + ev.confirmed_count + "</strong></span>" +
          '<span class="pill">Pending payment: <strong style="margin-left:.3em;">' + ev.pending_count + " (" + fmtMoney(ev.pending_revenue_cents) + ")</strong></span>" +
          '<span class="pill">Cancelled: <strong style="margin-left:.3em;">' + ev.cancelled_count + "</strong></span>" +
          "</div>" +
          optionsTable +
          renderRegistrantsTable(ev.registrants) +
          "</div>"
        );
      }).join("");
    } catch (err) {
      toast(err.message, true);
    }
  }

  async function loadReportCultural() {
    var qs = reportEventQuery();
    var statsHost = document.getElementById("report-cultural-stats");
    var typesHost = document.getElementById("report-cultural-types");
    var listHost = document.getElementById("report-cultural-list");
    var empty = document.getElementById("report-cultural-empty");
    try {
      var results = await Promise.all([api("/reports/cultural" + qs), api("/reports/cultural-groups" + qs)]);
      var t = results[0].totals;
      statsHost.innerHTML = [
        ["Groups", t.group_count],
        ["Participants", t.participant_count],
        ["Collected", fmtMoney(t.collected_cents)],
        ["Pending", fmtMoney(t.pending_cents)],
      ].map(function (s) {
        return '<div class="stat-card"><strong>' + s[1] + "</strong><span>" + s[0] + "</span></div>";
      }).join("");

      typesHost.innerHTML = results[0].by_performance_type.map(function (row) {
        return '<span class="pill">' + (PERFORMANCE_TYPE_LABELS[row.performance_type] || row.performance_type) +
          ': <strong style="margin-left:.3em;">' + row.group_count + (row.group_count === 1 ? " group" : " groups") +
          " · " + row.participant_count + (row.participant_count === 1 ? " participant" : " participants") + "</strong></span>";
      }).join("");

      var groups = results[1].groups;
      empty.style.display = groups.length ? "none" : "";
      listHost.innerHTML = groups.map(function (g) {
        var members = g.participants.filter(function (p) { return p.is_member; }).length;
        var kids = g.participants.filter(function (p) { return p.age_category === "kid"; }).length;
        var statusClass = g.status === "registered" ? "badge-paid" : "badge-pending";
        var participantsTable = g.participants.length
          ? '<table style="margin-top:.75rem;"><thead><tr><th>Participant</th><th>Email</th><th>Adult / Kid</th><th>Membership</th><th>Fee</th></tr></thead><tbody>' +
            g.participants.map(function (p) {
              return (
                "<tr><td>" + escapeHtml(p.full_name) + "</td><td>" + escapeHtml(p.email || "—") + "</td><td>" +
                (p.age_category === "kid" ? "Kid" : "Adult") + '</td><td><span class="badge ' + (p.is_member ? "badge-paid" : "badge-tier") + '">' +
                (p.is_member ? "Member" : "Non-member") + "</span></td><td>" + fmtMoney(p.fee_cents) + "</td></tr>"
              );
            }).join("") + "</tbody></table>"
          : "";
        return (
          '<div class="table-wrap" style="padding:1.5rem; margin-bottom:1rem;">' +
          '<div class="section-title" style="margin-top:0; display:flex; justify-content:space-between; align-items:baseline; gap:1rem;">' +
          "<span>" + escapeHtml(g.group_name) + '<span style="font-weight:400; color:var(--text-soft); margin-left:.5rem;">' +
          escapeHtml(g.event_name) + " &middot; " + (PERFORMANCE_TYPE_LABELS[g.performance_type] || g.performance_type) + "</span></span>" +
          '<span style="color:var(--maroon);">' + fmtMoney(g.amount_cents) + "</span>" +
          "</div>" +
          '<div class="pill-list">' +
          '<span class="pill">Participants: <strong style="margin-left:.3em;">' + g.participants.length + "</strong></span>" +
          '<span class="pill">Members: <strong style="margin-left:.3em;">' + members + "</strong></span>" +
          '<span class="pill">Kids: <strong style="margin-left:.3em;">' + kids + "</strong></span>" +
          '<span class="badge ' + statusClass + '" style="align-self:center;">' + escapeHtml(g.status.replace("_", " ")) + "</span>" +
          "</div>" +
          '<p class="empty-note" style="padding:.6rem 0 0; margin:0;">Choreographer/Trainer: ' + escapeHtml(g.choreographer_name) +
          " (" + escapeHtml(g.choreographer_email) + (g.choreographer_phone ? ", " + escapeHtml(g.choreographer_phone) : "") + ")</p>" +
          participantsTable +
          "</div>"
        );
      }).join("");
    } catch (err) {
      toast(err.message, true);
    }
  }

  /* ============================================================
     VOLUNTEERS
     ============================================================ */
  var volunteerStatusFilter = document.getElementById("volunteer-filter-status");
  volunteerStatusFilter.addEventListener("change", loadVolunteers);

  var INTEREST_LABELS = {
    event_planning: "Event planning & setup",
    teaching: "Teaching Tamil classes",
    youth_wing: "Youth wing",
    hospitality: "Hospitality / day-of support",
    media: "Photography / media",
    fundraising: "Fundraising & sponsorship",
    other: "Other",
  };
  function volunteerStatusBadgeClass(status) {
    return { new: "badge-pending", contacted: "badge-tier", active: "badge-paid", inactive: "badge-overdue" }[status] || "badge-tier";
  }

  async function loadVolunteers() {
    var tbody = document.getElementById("volunteers-tbody");
    var empty = document.getElementById("volunteers-empty");
    try {
      var data = await api("/volunteers");
      var status = volunteerStatusFilter.value;
      var rows = status ? data.volunteers.filter(function (v) { return v.status === status; }) : data.volunteers;

      empty.style.display = rows.length ? "none" : "";
      tbody.innerHTML = rows.map(function (v) {
        var interests = (v.interests || []).map(function (i) { return INTEREST_LABELS[i] || i; }).join(", ") || "—";
        return (
          '<tr data-id="' + v.id + '">' +
          "<td>" + escapeHtml(v.first_name + " " + v.last_name) + "</td>" +
          "<td>" + escapeHtml(v.email) + "</td>" +
          "<td>" + escapeHtml(v.phone || "—") + "</td>" +
          "<td>" + escapeHtml(interests) + "</td>" +
          "<td>" + escapeHtml(v.note || "—") + "</td>" +
          "<td>" + fmtDate(v.created_at) + "</td>" +
          "<td><select class=\"badge " + volunteerStatusBadgeClass(v.status) + "\" data-volunteer-status=\"" + v.id + "\">" +
          ["new", "contacted", "active", "inactive"].map(function (s) {
            return '<option value="' + s + '"' + (s === v.status ? " selected" : "") + ">" + s + "</option>";
          }).join("") +
          "</select></td>" +
          "</tr>"
        );
      }).join("");
    } catch (err) {
      toast(err.message, true);
    }
  }

  document.getElementById("volunteers-tbody").addEventListener("change", async function (e) {
    var select = e.target.closest("[data-volunteer-status]");
    if (!select) return;
    var id = select.getAttribute("data-volunteer-status");
    try {
      await api("/volunteers/" + id, { method: "PUT", body: { status: select.value } });
      select.className = "badge " + volunteerStatusBadgeClass(select.value);
      toast("Volunteer status updated");
    } catch (err) {
      toast(err.message, true);
    }
  });

  document.getElementById("volunteers-export-btn").addEventListener("click", async function () {
    try {
      var res = await fetch(API + "/volunteers/export.csv", { headers: { Authorization: "Bearer " + token } });
      if (!res.ok) throw new Error("Could not generate the export");
      var blob = await res.blob();
      var url = URL.createObjectURL(blob);
      var a = document.createElement("a");
      a.href = url;
      a.download = "rits-volunteers-" + new Date().toISOString().slice(0, 10) + ".csv";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast(err.message, true);
    }
  });

  /* ============================================================
     FRONT DESK — desk-staff login accounts + activity log
     ============================================================ */
  var deskStaffTbody = document.getElementById("desk-staff-tbody");
  var deskStaffEmpty = document.getElementById("desk-staff-empty");
  var deskStaffModal = document.getElementById("desk-staff-modal");
  var deskStaffForm = document.getElementById("desk-staff-form");
  var allDeskStaff = [];

  async function loadDeskStaff() {
    try {
      var data = await api("/desk-staff");
      allDeskStaff = data.staff;
      deskStaffEmpty.style.display = data.staff.length ? "none" : "";
      deskStaffTbody.innerHTML = data.staff.map(function (s) {
        return (
          "<tr>" +
          "<td>" + escapeHtml(s.name) + "</td>" +
          "<td>" + escapeHtml(s.username) + "</td>" +
          '<td><span class="badge ' + (s.is_active ? "badge-paid" : "badge-tier") + '">' + (s.is_active ? "Active" : "Deactivated") + "</span></td>" +
          "<td>" + fmtDate(s.created_at) + "</td>" +
          '<td class="row-actions">' +
          '<button class="icon-btn" data-edit-desk-staff="' + s.id + '" aria-label="Edit ' + escapeHtml(s.name) + '"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4z"/></svg></button>' +
          "</td></tr>"
        );
      }).join("");
    } catch (err) {
      toast(err.message, true);
    }
  }

  document.getElementById("add-desk-staff-btn").addEventListener("click", function () { openDeskStaffModal(null); });
  document.getElementById("desk-staff-modal-close").addEventListener("click", closeDeskStaffModal);
  document.getElementById("desk-staff-cancel-btn").addEventListener("click", closeDeskStaffModal);
  deskStaffModal.addEventListener("click", function (e) { if (e.target === deskStaffModal) closeDeskStaffModal(); });
  function closeDeskStaffModal() { deskStaffModal.classList.remove("is-open"); }

  deskStaffTbody.addEventListener("click", function (e) {
    var btn = e.target.closest("[data-edit-desk-staff]");
    if (btn) openDeskStaffModal(btn.getAttribute("data-edit-desk-staff"));
  });

  function openDeskStaffModal(id) {
    deskStaffForm.reset();
    document.getElementById("ds-id").value = id || "";
    document.getElementById("delete-desk-staff-btn").style.display = id ? "" : "none";
    document.getElementById("ds-password").required = !id;
    document.getElementById("ds-password-hint").style.display = id ? "" : "none";
    document.getElementById("ds-password-label").textContent = id ? "New Password (optional)" : "Password";
    document.getElementById("ds-active-row").style.display = id ? "" : "none";

    if (id) {
      var s = allDeskStaff.find(function (x) { return x.id === id; });
      document.getElementById("desk-staff-modal-title").textContent = "Edit Desk Login";
      document.getElementById("ds-name").value = s.name;
      document.getElementById("ds-username").value = s.username;
      document.getElementById("ds-active").checked = s.is_active;
    } else {
      document.getElementById("desk-staff-modal-title").textContent = "Add Desk Login";
    }
    deskStaffModal.classList.add("is-open");
  }

  deskStaffForm.addEventListener("submit", async function (e) {
    e.preventDefault();
    var id = document.getElementById("ds-id").value;
    var password = document.getElementById("ds-password").value;
    var payload = {
      name: document.getElementById("ds-name").value.trim(),
      username: document.getElementById("ds-username").value.trim(),
    };
    if (password) payload.password = password;
    if (id) payload.is_active = document.getElementById("ds-active").checked;

    try {
      if (id) {
        await api("/desk-staff/" + id, { method: "PUT", body: payload });
        toast("Desk login updated");
      } else {
        await api("/desk-staff", { method: "POST", body: payload });
        toast("Desk login created");
      }
      closeDeskStaffModal();
      loadDeskStaff();
    } catch (err) {
      toast(err.message, true);
    }
  });

  document.getElementById("delete-desk-staff-btn").addEventListener("click", async function () {
    var id = document.getElementById("ds-id").value;
    if (!id) return;
    if (!confirm("Remove this desk login? Past transactions it recorded stay in the log.")) return;
    try {
      await api("/desk-staff/" + id, { method: "DELETE" });
      toast("Desk login removed");
      closeDeskStaffModal();
      loadDeskStaff();
    } catch (err) {
      toast(err.message, true);
    }
  });

  async function loadDeskLogEventFilter() {
    var select = document.getElementById("desk-log-event-filter");
    if (select.options.length > 1) return; // already populated
    try {
      var data = await api("/events");
      data.events.forEach(function (ev) {
        var opt = document.createElement("option");
        opt.value = ev.id;
        opt.textContent = ev.name;
        select.appendChild(opt);
      });
    } catch (err) {
      toast(err.message, true);
    }
  }
  document.getElementById("desk-log-event-filter").addEventListener("change", loadDeskLog);

  async function loadDeskLog() {
    var eventId = document.getElementById("desk-log-event-filter").value;
    try {
      var data = await api("/reports/front-desk" + (eventId ? "?event_id=" + eventId : ""));

      var paymentsBody = document.getElementById("desk-payments-tbody");
      document.getElementById("desk-payments-empty").style.display = data.payments.length ? "none" : "";
      paymentsBody.innerHTML = data.payments.map(function (p) {
        return (
          "<tr>" +
          "<td>" + escapeHtml(p.first_name + " " + p.last_name) + "</td>" +
          "<td>" + escapeHtml(p.event_name || "—") + "</td>" +
          "<td>" + fmtMoney(p.amount_cents) + "</td>" +
          '<td><span class="badge badge-tier">' + escapeHtml(p.method) + "</span></td>" +
          '<td><span class="badge ' + paymentStatusBadgeClass(p.status) + '">' + escapeHtml(p.status) + "</span></td>" +
          "<td>" + escapeHtml(p.staff_name || "—") + "</td>" +
          "<td>" + fmtDateTime(p.created_at) + "</td>" +
          "</tr>"
        );
      }).join("");

      var checkinsBody = document.getElementById("desk-checkins-tbody");
      document.getElementById("desk-checkins-empty").style.display = data.checkins.length ? "none" : "";
      checkinsBody.innerHTML = data.checkins.map(function (c) {
        return (
          "<tr>" +
          "<td>" + escapeHtml(c.first_name + " " + c.last_name) + "</td>" +
          "<td>" + escapeHtml(c.event_name) + "</td>" +
          "<td>" + escapeHtml(c.staff_name || "—") + "</td>" +
          "<td>" + fmtDateTime(c.checked_in_at) + "</td>" +
          "</tr>"
        );
      }).join("");
    } catch (err) {
      toast(err.message, true);
    }
  }

  /* ============================================================
     CULTURAL EVENTS — group performance registrations
     ============================================================ */
  var PERFORMANCE_TYPE_LABELS = { dance: "Dance", singing: "Singing", drama: "Drama", speech: "Speech", other: "Other" };
  var culturalGroupModal = document.getElementById("cultural-group-modal");
  var currentCulturalGroupId = null;

  document.getElementById("cultural-event-filter").addEventListener("change", function () {
    loadCulturalStats();
    loadCulturalGroups();
  });

  document.getElementById("export-cultural-xlsx-btn").addEventListener("click", function () {
    var select = document.getElementById("cultural-event-filter");
    runExport(this, "/reports/cultural.xlsx" + (select.value ? "?event_id=" + encodeURIComponent(select.value) : ""), "rits-cultural-events", select);
  });

  async function loadCulturalStats() {
    var eventId = document.getElementById("cultural-event-filter").value;
    try {
      var data = await api("/reports/cultural" + (eventId ? "?event_id=" + eventId : ""));
      var t = data.totals;
      document.getElementById("cultural-stats").innerHTML = [
        ["Groups", t.group_count],
        ["Participants", t.participant_count],
        ["Collected", fmtMoney(t.collected_cents)],
        ["Pending", fmtMoney(t.pending_cents)],
      ].map(function (s) {
        return '<div class="stat-card"><strong>' + s[1] + "</strong><span>" + s[0] + "</span></div>";
      }).join("");
    } catch (err) {
      toast(err.message, true);
    }
  }

  async function loadCulturalGroups() {
    var eventId = document.getElementById("cultural-event-filter").value;
    var tbody = document.getElementById("cultural-groups-tbody");
    try {
      var data = await api("/cultural-groups" + (eventId ? "?event_id=" + eventId : ""));
      document.getElementById("cultural-groups-empty").style.display = data.groups.length ? "none" : "";
      tbody.innerHTML = data.groups.map(function (g) {
        return (
          "<tr>" +
          "<td>" + escapeHtml(g.group_name) + "</td>" +
          "<td>" + escapeHtml(g.event_name) + "</td>" +
          "<td>" + (PERFORMANCE_TYPE_LABELS[g.performance_type] || g.performance_type) + "</td>" +
          "<td>" + escapeHtml(g.choreographer_name) + "</td>" +
          "<td>" + g.participant_count + "</td>" +
          "<td>" + fmtMoney(g.amount_cents) + "</td>" +
          '<td><span class="badge ' + (g.status === "registered" ? "badge-paid" : g.status === "cancelled" ? "badge-tier" : "badge-pending") + '">' + escapeHtml(g.status.replace("_", " ")) + "</span></td>" +
          '<td class="row-actions"><button class="icon-btn" data-view-cultural-group="' + g.id + '" aria-label="View ' + escapeHtml(g.group_name) + '"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7z"/></svg></button></td>' +
          "</tr>"
        );
      }).join("");
    } catch (err) {
      toast(err.message, true);
    }
  }

  document.getElementById("cultural-groups-tbody").addEventListener("click", function (e) {
    var btn = e.target.closest("[data-view-cultural-group]");
    if (btn) openCulturalGroupModal(btn.getAttribute("data-view-cultural-group"));
  });

  async function openCulturalGroupModal(id) {
    currentCulturalGroupId = id;
    try {
      var data = await api("/cultural-groups/" + id);
      var g = data.group;
      document.getElementById("cultural-group-modal-title").textContent = g.group_name;
      document.getElementById("cultural-group-info").innerHTML =
        escapeHtml(g.event_name) + " &middot; " + (PERFORMANCE_TYPE_LABELS[g.performance_type] || g.performance_type) + "<br>" +
        "Choreographer/Trainer: " + escapeHtml(g.choreographer_name) + " (" + escapeHtml(g.choreographer_email) + (g.choreographer_phone ? ", " + escapeHtml(g.choreographer_phone) : "") + ")" +
        (g.description ? "<br>" + escapeHtml(g.description) : "") +
        "<br>Total: " + fmtMoney(g.amount_cents) + " &middot; Status: " + escapeHtml(g.status.replace("_", " "));

      document.getElementById("cultural-participants-tbody").innerHTML = data.participants.map(function (p) {
        return (
          "<tr>" +
          "<td>" + escapeHtml(p.full_name) + "</td>" +
          "<td>" + escapeHtml(p.email || "—") + "</td>" +
          "<td>" + (p.age_category === "kid" ? "Kid" : "Adult") + "</td>" +
          '<td><span class="badge ' + (p.is_member ? "badge-paid" : "badge-tier") + '">' + (p.is_member ? "Member" : "Non-member") + "</span></td>" +
          "<td>" + fmtMoney(p.fee_cents) + "</td>" +
          "</tr>"
        );
      }).join("");
      culturalGroupModal.classList.add("is-open");
    } catch (err) {
      toast(err.message, true);
    }
  }

  function closeCulturalGroupModal() { culturalGroupModal.classList.remove("is-open"); currentCulturalGroupId = null; }
  document.getElementById("cultural-group-modal-close").addEventListener("click", closeCulturalGroupModal);
  document.getElementById("cultural-group-close-btn").addEventListener("click", closeCulturalGroupModal);
  culturalGroupModal.addEventListener("click", function (e) { if (e.target === culturalGroupModal) closeCulturalGroupModal(); });

  document.getElementById("delete-cultural-group-btn").addEventListener("click", async function () {
    if (!currentCulturalGroupId) return;
    if (!confirm("Remove this group registration and all its participants? This can't be undone.")) return;
    try {
      await api("/cultural-groups/" + currentCulturalGroupId, { method: "DELETE" });
      toast("Group registration removed");
      closeCulturalGroupModal();
      loadCulturalStats();
      loadCulturalGroups();
    } catch (err) {
      toast(err.message, true);
    }
  });

  /* ============================================================
     ACTIVITY LOG
     ============================================================ */
  var activityTypeFilter = document.getElementById("activity-type-filter");
  var activityActionFilter = document.getElementById("activity-action-filter");
  var activityLoadMoreBtn = document.getElementById("activity-load-more-btn");
  var activityOldestId = null;
  var activityTypesLoaded = false;

  // "events/cultural-pricing" -> "Events / Cultural Pricing" — a generic
  // label from the URL path segments the audit middleware recorded, so new
  // routes show up readably without needing a name added here by hand.
  function prettifyEntityType(t) {
    return t.split("/").map(function (part) {
      return part.split("-").map(function (w) { return w.charAt(0).toUpperCase() + w.slice(1); }).join(" ");
    }).join(" / ");
  }

  function activityQuery(before) {
    var params = [];
    if (activityTypeFilter.value) params.push("entity_type=" + encodeURIComponent(activityTypeFilter.value));
    if (activityActionFilter.value) params.push("action=" + encodeURIComponent(activityActionFilter.value));
    if (before) params.push("before=" + encodeURIComponent(before));
    return params.length ? "?" + params.join("&") : "";
  }

  function renderActivityRow(e) {
    var actionClass = { create: "badge-paid", update: "badge-pending", delete: "badge-overdue" }[e.action] || "badge-tier";
    var who = e.admin_name || e.admin_email || "—";
    var hasChanges = e.changes && Object.keys(e.changes).length;
    var details = escapeHtml(e.entity_id || "—") +
      (hasChanges
        ? '<details style="margin-top:.25rem;"><summary style="cursor:pointer; color:var(--text-soft); font-size:.82rem;">View details</summary>' +
          '<pre style="white-space:pre-wrap; font-size:.78rem; margin:.4rem 0 0; color:var(--text-soft);">' + escapeHtml(JSON.stringify(e.changes, null, 2)) + "</pre></details>"
        : "");
    return (
      "<tr>" +
      "<td>" + fmtDateTime(e.created_at) + "</td>" +
      "<td>" + escapeHtml(who) + "</td>" +
      '<td><span class="badge ' + actionClass + '">' + e.action + "</span></td>" +
      "<td>" + escapeHtml(prettifyEntityType(e.entity_type)) + "</td>" +
      "<td>" + details + "</td>" +
      "</tr>"
    );
  }

  async function loadActivityLog(reset) {
    var tbody = document.getElementById("activity-tbody");
    var empty = document.getElementById("activity-empty");
    if (reset) {
      activityOldestId = null;
      tbody.innerHTML = "";
    }
    try {
      var data = await api("/audit-log" + activityQuery(activityOldestId));

      if (!activityTypesLoaded) {
        activityTypesLoaded = true;
        activityTypeFilter.innerHTML = '<option value="">All areas</option>' + data.entity_types.map(function (t) {
          return '<option value="' + escapeHtml(t) + '">' + escapeHtml(prettifyEntityType(t)) + "</option>";
        }).join("");
      }

      if (reset) empty.style.display = data.entries.length ? "none" : "";
      tbody.insertAdjacentHTML("beforeend", data.entries.map(renderActivityRow).join(""));
      if (data.entries.length) activityOldestId = data.entries[data.entries.length - 1].id;
      activityLoadMoreBtn.style.display = data.has_more ? "" : "none";
    } catch (err) {
      toast(err.message, true);
    }
  }

  activityTypeFilter.addEventListener("change", function () { loadActivityLog(true); });
  activityActionFilter.addEventListener("change", function () { loadActivityLog(true); });
  activityLoadMoreBtn.addEventListener("click", function () { loadActivityLog(false); });

  /* ---------------- init ---------------- */
  refreshCategories();
  loadMembers();
})();
