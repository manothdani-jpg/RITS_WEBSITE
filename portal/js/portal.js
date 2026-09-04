(function () {
  "use strict";

  var API = window.RITS_API_BASE;
  var token = localStorage.getItem("rits_member_token");
  if (!token) {
    window.location.href = "index.html";
    return;
  }

  document.getElementById("logout-btn").addEventListener("click", function () {
    localStorage.removeItem("rits_member_token");
    localStorage.removeItem("rits_member_info");
    window.location.href = "index.html";
  });

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
      localStorage.removeItem("rits_member_token");
      window.location.href = "index.html";
      throw new Error("Session expired");
    }
    if (res.status === 204) return null;
    var data = await res.json().catch(function () { return {}; });
    if (!res.ok) throw new Error(data.error || "Request failed");
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
  function statusBadgeClass(status) {
    return { paid: "badge-paid", pending: "badge-pending", overdue: "badge-overdue", waived: "badge-waived" }[status] || "badge-pending";
  }
  function paymentStatusBadgeClass(status) {
    return { completed: "badge-paid", pending: "badge-pending", failed: "badge-overdue", cancelled: "badge-tier" }[status] || "badge-tier";
  }
  function rsvpStatusBadgeClass(status) {
    return { registered: "badge-pending", attended: "badge-paid", cancelled: "badge-tier", no_show: "badge-overdue" }[status] || "badge-tier";
  }
  function fmtMoney(cents) {
    return (cents / 100).toLocaleString(undefined, { style: "currency", currency: "USD" });
  }
  var tierLabelMap = {};
  function tierLabel(t) { return tierLabelMap[t] || t; }
  (async function loadTierLabels() {
    try {
      var res = await fetch(API + "/payment-settings");
      var data = await res.json();
      (data.tiers || []).forEach(function (t) { tierLabelMap[t.key] = t.label; });
    } catch (err) { /* fall back to raw tier key */ }
  })();

  var currentFamily = [];
  var currentRsvps = [];
  var allEvents = [];
  var currentMember = null;
  function isActiveMember() { return currentMember && currentMember.payment_status === "paid"; }
  function priceFor(o) { return isActiveMember() ? o.member_amount_cents : o.non_member_amount_cents; }

  /* ---------------- Load profile ---------------- */
  async function loadProfile() {
    try {
      var data = await api("/members/me");
      var m = data.member;
      currentMember = m;
      currentFamily = data.family_members;
      currentRsvps = data.rsvps;

      document.getElementById("profile-name").textContent = m.first_name + " " + m.last_name;
      document.getElementById("profile-email").textContent = m.email;
      document.getElementById("profile-tier").textContent = m.membership_tier;
      var statusEl = document.getElementById("profile-status");
      statusEl.textContent = m.payment_status;
      statusEl.className = "badge " + statusBadgeClass(m.payment_status);

      var expiryEl = document.getElementById("profile-expiry");
      if (m.renewal_date) {
        var expired = new Date(m.renewal_date) < new Date();
        expiryEl.textContent = (expired ? "Membership expired " : "Membership renews/expires ") + fmtDate(m.renewal_date);
        expiryEl.style.color = expired ? "var(--maroon)" : "";
      } else {
        expiryEl.textContent = "No renewal date on file yet.";
      }

      document.getElementById("c-first-name").value = m.first_name;
      document.getElementById("c-last-name").value = m.last_name;
      document.getElementById("c-email").value = m.email;
      document.getElementById("c-phone").value = m.phone || "";
      document.getElementById("c-city").value = m.city || "";
      document.getElementById("c-address1").value = m.address_line1 || "";
      document.getElementById("c-zip").value = m.zip || "";

      renderFamilyPills();
      renderEvents();
      renderRsvpHistory();
      loadPaymentHistory();
    } catch (err) {
      toast(err.message, true);
    }
  }

  /* ---------------- Payment history ---------------- */
  async function loadPaymentHistory() {
    var host = document.getElementById("payment-history-list");
    try {
      var data = await api("/payments/me");
      if (!data.payments.length) {
        host.innerHTML = '<p class="empty-note">No payments yet.</p>';
        return;
      }
      host.innerHTML = data.payments.map(function (p) {
        var title = p.purpose === "event"
          ? escapeHtml(p.event_name || "Event") + " Registration &middot; " + fmtMoney(p.amount_cents)
          : tierLabel(p.tier) + " Membership &middot; " + fmtMoney(p.amount_cents);
        return (
          '<div class="event-row">' +
          "<div>" +
          "<h3>" + title + "</h3>" +
          '<div class="meta">' + fmtDateTime(p.created_at) + "</div>" +
          "</div>" +
          '<span class="badge ' + paymentStatusBadgeClass(p.status) + '">' + p.status + "</span>" +
          "</div>"
        );
      }).join("");
    } catch (err) {
      host.innerHTML = '<p class="empty-note">Couldn\'t load payment history right now.</p>';
    }
  }

  /* ---------------- RSVP history (all, past + upcoming) ---------------- */
  function renderRsvpHistory() {
    var host = document.getElementById("rsvp-history-list");
    if (!currentRsvps.length) {
      host.innerHTML = '<p class="empty-note">You haven\'t RSVP\'d to any events yet.</p>';
      return;
    }
    var sorted = currentRsvps.slice().sort(function (a, b) {
      return new Date(b.event_date) - new Date(a.event_date);
    });
    host.innerHTML = sorted.map(function (r) {
      return (
        '<div class="event-row">' +
        "<div>" +
        "<h3>" + escapeHtml(r.event_name) + "</h3>" +
        '<div class="meta">' + fmtDateTime(r.event_date) +
        (r.location ? " &middot; " + escapeHtml(r.location) : "") +
        (r.guest_count ? " &middot; " + r.guest_count + " guest" + (r.guest_count === 1 ? "" : "s") : "") +
        "</div>" +
        "</div>" +
        '<span class="badge ' + rsvpStatusBadgeClass(r.status) + '">' + r.status.replace("_", " ") + "</span>" +
        "</div>"
      );
    }).join("");
  }

  /* ---------------- Contact info form ---------------- */
  document.getElementById("contact-form").addEventListener("submit", async function (e) {
    e.preventDefault();
    var payload = {
      phone: document.getElementById("c-phone").value.trim(),
      city: document.getElementById("c-city").value.trim(),
      address_line1: document.getElementById("c-address1").value.trim(),
      zip: document.getElementById("c-zip").value.trim(),
    };
    try {
      await api("/members/me", { method: "PUT", body: payload });
      toast("Contact info updated");
    } catch (err) {
      toast(err.message, true);
    }
  });

  /* ---------------- Family members ---------------- */
  var editingFamilyId = null;

  function renderFamilyPills() {
    var host = document.getElementById("family-pills");
    if (!currentFamily.length) {
      host.innerHTML = '<span class="empty-note">No family members added yet.</span>';
      return;
    }
    host.innerHTML = currentFamily.map(function (f) {
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
    }).join("");
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

  document.getElementById("add-family-btn").addEventListener("click", async function () {
    var name = document.getElementById("new-family-name").value.trim();
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
        var updated = await api("/members/me/family/" + editingFamilyId, { method: "PUT", body: payload });
        currentFamily = currentFamily.map(function (f) { return f.id === editingFamilyId ? updated.family_member : f; });
        toast("Family member updated");
      } else {
        var data = await api("/members/me/family", { method: "POST", body: payload });
        currentFamily.push(data.family_member);
        toast("Family member added");
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
      document.getElementById("new-family-name").focus();
    }

    if (removeBtn) {
      var removeId = removeBtn.getAttribute("data-remove-family");
      try {
        await api("/members/me/family/" + removeId, { method: "DELETE" });
        currentFamily = currentFamily.filter(function (f) { return f.id !== removeId; });
        if (editingFamilyId === removeId) resetFamilyForm();
        renderFamilyPills();
      } catch (err) {
        toast(err.message, true);
      }
    }
  });

  /* ---------------- Events / RSVPs ---------------- */
  var pricingByEvent = {}; // event_id -> [options]

  async function renderEvents() {
    var host = document.getElementById("events-list");
    try {
      var data = await api("/events");
      allEvents = data.events.filter(function (ev) { return new Date(ev.event_date) >= new Date(); });
    } catch (err) {
      host.innerHTML = '<p class="empty-note">Couldn\'t load events right now.</p>';
      return;
    }

    if (!allEvents.length) {
      host.innerHTML = '<p class="empty-note">No upcoming events yet — check back soon.</p>';
      return;
    }

    await Promise.all(allEvents.map(async function (ev) {
      if (pricingByEvent[ev.id]) return;
      try {
        var res = await fetch(API + "/events/" + ev.id + "/pricing");
        var d = await res.json();
        pricingByEvent[ev.id] = d.options || [];
      } catch (err) {
        pricingByEvent[ev.id] = [];
      }
    }));

    var rsvpByEvent = {};
    currentRsvps.forEach(function (r) { rsvpByEvent[r.event_id] = r; });

    host.innerHTML = allEvents.map(function (ev) {
      var options = pricingByEvent[ev.id] || [];
      var rsvp = rsvpByEvent[ev.id];
      return options.length
        ? renderPricedEventRow(ev, options, rsvp)
        : renderFreeEventRow(ev, rsvp);
    }).join("");
  }

  function renderFreeEventRow(ev, rsvp) {
    var going = rsvp && rsvp.status === "registered";
    return (
      '<div class="event-row">' +
      "<div>" +
      "<h3>" + escapeHtml(ev.name) + "</h3>" +
      '<div class="meta">' + fmtDateTime(ev.event_date) + (ev.location ? " &middot; " + escapeHtml(ev.location) : "") + "</div>" +
      "</div>" +
      '<div class="actions">' +
      (going
        ? '<span class="guest-count-field">' + (rsvp.guest_count || 0) + " guest" + (rsvp.guest_count === 1 ? "" : "s") + "</span>" +
          '<button class="btn btn-outline-dark btn-sm" data-cancel-rsvp="' + ev.id + '">Cancel RSVP</button>'
        : '<label class="guest-count-field">Guests <input type="number" min="0" max="20" value="0" data-guest-input="' + ev.id + '"></label>' +
          '<button class="btn btn-primary btn-sm" data-rsvp="' + ev.id + '">RSVP</button>') +
      "</div></div>"
    );
  }

  function renderPricedEventRow(ev, options, rsvp) {
    var participationOptions = options.filter(function (o) { return o.kind === "participation"; });
    var addonOptions = options.filter(function (o) { return o.kind === "addon"; });

    if (rsvp && rsvp.status === "registered") {
      return (
        '<div class="event-row">' +
        "<div>" +
        "<h3>" + escapeHtml(ev.name) + "</h3>" +
        '<div class="meta">' + fmtDateTime(ev.event_date) + (ev.location ? " &middot; " + escapeHtml(ev.location) : "") + "</div>" +
        "</div>" +
        '<span class="badge badge-paid">Registered &middot; ' + fmtMoney(rsvp.amount_cents) + " paid</span>" +
        "</div>"
      );
    }
    if (rsvp && rsvp.status === "pending_payment") {
      return (
        '<div class="event-row">' +
        "<div>" +
        "<h3>" + escapeHtml(ev.name) + "</h3>" +
        '<div class="meta">' + fmtDateTime(ev.event_date) + (ev.location ? " &middot; " + escapeHtml(ev.location) : "") + "</div>" +
        "</div>" +
        '<span class="badge badge-pending">Payment pending</span>' +
        "</div>"
      );
    }

    var participationHtml = participationOptions.length
      ? participationOptions.map(function (o, i) {
          return (
            '<label class="pricing-choice"><input type="radio" name="participation-' + ev.id + '" value="' + o.id + '" data-price-event="' + ev.id + '"' + (i === 0 ? " checked" : "") + '> ' +
            escapeHtml(o.label) + " — " + fmtMoney(priceFor(o)) + "</label>"
          );
        }).join("")
      : "";

    var addonHtml = addonOptions.length
      ? '<div class="pricing-addons">' + addonOptions.map(function (o) {
          return (
            '<label class="pricing-choice">' +
            '<input type="checkbox" data-addon-check="' + o.id + '" data-addon-event="' + ev.id + '" data-price-event="' + ev.id + '"> ' +
            escapeHtml(o.label) + " — " + fmtMoney(priceFor(o)) + " each " +
            '<input type="number" min="1" max="20" value="1" class="addon-qty" data-addon-qty="' + o.id + '" data-price-event="' + ev.id + '" disabled>' +
            "</label>"
          );
        }).join("") + "</div>"
      : "";

    var nonMemberNotice = !isActiveMember() && options.some(function (o) { return o.non_member_amount_cents !== o.member_amount_cents; })
      ? '<p class="empty-note" style="margin:.35rem 0 0;">Non-member pricing applies — pay your dues for member pricing.</p>'
      : "";

    return (
      '<div class="event-row priced-event-row" data-priced-event="' + ev.id + '">' +
      "<div style=\"width:100%;\">" +
      "<h3>" + escapeHtml(ev.name) + "</h3>" +
      '<div class="meta">' + fmtDateTime(ev.event_date) + (ev.location ? " &middot; " + escapeHtml(ev.location) : "") + "</div>" +
      '<div class="pricing-selections">' + participationHtml + addonHtml + "</div>" +
      nonMemberNotice +
      '<div class="pricing-total">Total: <strong data-price-total="' + ev.id + '">' + fmtMoney(participationOptions[0] ? priceFor(participationOptions[0]) : 0) + "</strong></div>" +
      '<button class="btn btn-primary btn-sm" data-register-pay="' + ev.id + '" style="margin-top:.5rem;">Register &amp; Pay</button>' +
      "</div></div>"
    );
  }

  function computeEventTotal(eventId) {
    var options = pricingByEvent[eventId] || [];
    var optionsById = {};
    options.forEach(function (o) { optionsById[o.id] = o; });
    var total = 0;

    var checkedParticipation = document.querySelector('input[name="participation-' + eventId + '"]:checked');
    if (checkedParticipation) total += priceFor(optionsById[checkedParticipation.value]);

    document.querySelectorAll('[data-addon-check][data-addon-event="' + eventId + '"]:checked').forEach(function (cb) {
      var optId = cb.getAttribute("data-addon-check");
      var qtyInput = document.querySelector('[data-addon-qty="' + optId + '"]');
      var qty = qtyInput ? Math.max(1, parseInt(qtyInput.value, 10) || 1) : 1;
      total += priceFor(optionsById[optId]) * qty;
    });

    var totalEl = document.querySelector('[data-price-total="' + eventId + '"]');
    if (totalEl) totalEl.textContent = fmtMoney(total);
  }

  document.getElementById("events-list").addEventListener("change", function (e) {
    var eventId = e.target.getAttribute("data-price-event");
    if (!eventId) return;
    if (e.target.matches("[data-addon-check]")) {
      var qtyInput = document.querySelector('[data-addon-qty="' + e.target.getAttribute("data-addon-check") + '"]');
      if (qtyInput) qtyInput.disabled = !e.target.checked;
    }
    computeEventTotal(eventId);
  });

  document.getElementById("events-list").addEventListener("click", async function (e) {
    var rsvpBtn = e.target.closest("[data-rsvp]");
    var cancelBtn = e.target.closest("[data-cancel-rsvp]");
    var registerBtn = e.target.closest("[data-register-pay]");

    if (rsvpBtn) {
      var eventId = rsvpBtn.getAttribute("data-rsvp");
      var guestInput = document.querySelector('[data-guest-input="' + eventId + '"]');
      var guestCount = guestInput ? parseInt(guestInput.value, 10) || 0 : 0;
      try {
        var data = await api("/rsvps/me", { method: "POST", body: { event_id: eventId, guest_count: guestCount } });
        // The API only returns the raw rsvps row — enrich it with the event
        // details (name/date/location) so RSVP history has something to show.
        var matchingEvent = allEvents.find(function (ev) { return ev.id === eventId; });
        var enrichedRsvp = Object.assign({}, data.rsvp, {
          event_name: matchingEvent ? matchingEvent.name : "",
          event_date: matchingEvent ? matchingEvent.event_date : null,
          location: matchingEvent ? matchingEvent.location : null,
        });
        currentRsvps = currentRsvps.filter(function (r) { return r.event_id !== eventId; });
        currentRsvps.push(enrichedRsvp);
        renderEvents();
        renderRsvpHistory();
        toast("You're on the list!");
      } catch (err) {
        toast(err.message, true);
      }
    }

    if (cancelBtn) {
      var evId = cancelBtn.getAttribute("data-cancel-rsvp");
      try {
        await api("/rsvps/me/" + evId, { method: "DELETE" });
        var cancelled = currentRsvps.find(function (r) { return r.event_id === evId; });
        if (cancelled) cancelled.status = "cancelled";
        renderEvents();
        renderRsvpHistory();
        toast("RSVP cancelled");
      } catch (err) {
        toast(err.message, true);
      }
    }

    if (registerBtn) {
      var pricedEventId = registerBtn.getAttribute("data-register-pay");
      registerBtn.disabled = true;
      registerBtn.textContent = "Redirecting…";

      var checkedParticipation = document.querySelector('input[name="participation-' + pricedEventId + '"]:checked');
      var addons = [];
      document.querySelectorAll('[data-addon-check][data-addon-event="' + pricedEventId + '"]:checked').forEach(function (cb) {
        var optId = cb.getAttribute("data-addon-check");
        var qtyInput = document.querySelector('[data-addon-qty="' + optId + '"]');
        addons.push({ option_id: optId, quantity: qtyInput ? Math.max(1, parseInt(qtyInput.value, 10) || 1) : 1 });
      });

      try {
        var payload = { event_id: pricedEventId, addons: addons };
        if (checkedParticipation) payload.participation_option_id = checkedParticipation.value;
        var result = await api("/payments/event-checkout", { method: "POST", body: payload });
        if (result.free) {
          toast("You're registered!");
          currentRsvps = currentRsvps.filter(function (r) { return r.event_id !== pricedEventId; });
          currentRsvps.push({ event_id: pricedEventId, status: "registered", amount_cents: 0 });
          renderEvents();
          renderRsvpHistory();
        } else {
          window.location.href = result.checkout_url;
        }
      } catch (err) {
        toast(err.message, true);
        registerBtn.disabled = false;
        registerBtn.textContent = "Register & Pay";
      }
    }
  });

  /* ---------------- Pay dues online (Square) ---------------- */
  document.getElementById("pay-now-btn").addEventListener("click", async function () {
    var btn = this;
    var errorEl = document.getElementById("pay-now-error");
    errorEl.style.display = "none";
    btn.disabled = true;
    btn.textContent = "Redirecting…";

    try {
      var data = await api("/payments/checkout", { method: "POST", body: {} });
      window.location.href = data.checkout_url;
    } catch (err) {
      errorEl.textContent = err.message;
      errorEl.style.display = "";
      btn.disabled = false;
      btn.textContent = "Pay Dues Online";
    }
  });

  loadProfile();
})();
