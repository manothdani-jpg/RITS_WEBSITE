(function () {
  "use strict";

  var API = window.RITS_API_BASE;
  var apiOrigin = API.replace(/\/api\/?$/, "");
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
  var tierAmountMap = {};
  function tierLabel(t) { return tierLabelMap[t] || t; }
  var tiersReady = (async function loadTierLabels() {
    try {
      var res = await fetch(API + "/payment-settings");
      var data = await res.json();
      (data.tiers || []).forEach(function (t) {
        tierLabelMap[t.key] = t.label;
        tierAmountMap[t.key] = t.amount_cents;
      });
    } catch (err) { /* fall back to raw tier key */ }
  })();

  var currentFamily = [];
  var currentRsvps = [];
  var allEvents = [];
  var currentMember = null;
  function isActiveMember() { return currentMember && currentMember.payment_status === "paid"; }
  function priceFor(o) { return isActiveMember() ? o.member_amount_cents : o.non_member_amount_cents; }

  /* ---------------- Membership status + renewal ---------------- */
  var PAY_BTN_LABEL = "Renew Membership";
  var EXPIRING_SOON_DAYS = 60;

  function renderMembershipCard(m) {
    var statusEl = document.getElementById("ms-status");
    var expiryEl = document.getElementById("ms-expiry");
    var daysEl = document.getElementById("ms-days");
    var noteEl = document.getElementById("ms-note");
    var btn = document.getElementById("pay-now-btn");

    var amount = tierAmountMap[m.membership_tier];
    document.getElementById("ms-tier").textContent =
      tierLabel(m.membership_tier) + (amount ? " — " + fmtMoney(amount) + " / term" : "");

    var daysLeft = null;
    if (m.renewal_date) {
      var today = new Date(); today.setHours(0, 0, 0, 0);
      var end = new Date(m.renewal_date); end.setHours(0, 0, 0, 0);
      daysLeft = Math.round((end - today) / 86400000);
      expiryEl.textContent = fmtDate(m.renewal_date);
      daysEl.textContent = daysLeft > 0 ? daysLeft + (daysLeft === 1 ? " day left" : " days left")
        : daysLeft === 0 ? "expires today" : "expired " + Math.abs(daysLeft) + (Math.abs(daysLeft) === 1 ? " day ago" : " days ago");
    } else {
      expiryEl.textContent = "—";
      daysEl.textContent = "";
    }

    var label, badge, note, showButton = true;
    PAY_BTN_LABEL = "Renew Membership";
    if (m.payment_status === "waived") {
      label = "Waived"; badge = "badge-waived"; showButton = false;
      note = "Your dues are waived — there's nothing to pay.";
    } else if (m.payment_status === "paid") {
      if (daysLeft !== null && daysLeft <= 0) {
        label = "Expired"; badge = "badge-overdue";
        note = "Your membership has expired. Renew to get member pricing and benefits back.";
      } else if (daysLeft !== null && daysLeft <= EXPIRING_SOON_DAYS) {
        label = "Expiring soon"; badge = "badge-pending";
        note = "Your membership ends soon. Renew now and the new term is added after your current end date.";
      } else {
        label = "Active"; badge = "badge-paid";
        note = daysLeft === null
          ? "Your dues are paid. The board hasn't recorded an end date yet."
          : "You're all set. If you renew early, the new term is added after your current end date.";
      }
    } else {
      label = m.payment_status === "overdue" ? "Overdue" : "Dues unpaid";
      badge = m.payment_status === "overdue" ? "badge-overdue" : "badge-pending";
      note = "Pay your membership dues to activate member pricing and benefits.";
      PAY_BTN_LABEL = "Pay Membership Dues";
    }

    statusEl.textContent = label;
    statusEl.className = "badge " + badge;
    daysEl.style.color = badge === "badge-overdue" ? "var(--maroon)" : "";
    noteEl.textContent = note;
    btn.style.display = showButton ? "" : "none";
    btn.textContent = PAY_BTN_LABEL;
  }

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
      await tiersReady;
      renderMembershipCard(m);

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

  // When the board takes payments through their own Square links, the site
  // can't be told who paid — the board confirms each payment by hand. Tell the
  // member the exact amount and what happens next before sending them off.
  function goToCheckout(result) {
    if (result.manual_confirmation) {
      alert(
        "You'll be taken to Square to pay " + fmtMoney(result.amount_cents) + ". Please enter exactly that amount.\n\n" +
        "Your payment will show as pending until the board confirms it, and you'll get an email once it is."
      );
    }
    window.location.href = result.checkout_url;
  }

  /* ---------------- Events / RSVPs ---------------- */
  var pricingByEvent = {}; // event_id -> [options]
  var attendeesByEvent = {}; // event_id -> { total_count, rsvp_count, attendees }

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
      if (!pricingByEvent[ev.id]) {
        try {
          var res = await fetch(API + "/events/" + ev.id + "/pricing");
          var d = await res.json();
          pricingByEvent[ev.id] = d.options || [];
        } catch (err) {
          pricingByEvent[ev.id] = [];
        }
      }
      try {
        attendeesByEvent[ev.id] = await api("/events/" + ev.id + "/attendees");
      } catch (err) {
        attendeesByEvent[ev.id] = null;
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

  // Shared "N going" count + expandable name list, used by both the free and
  // priced event row renderers.
  function renderAttendeesSummary(ev) {
    var info = attendeesByEvent[ev.id];
    if (!info || !info.rsvp_count) {
      return '<p class="attendees-summary">No one has RSVP\'d yet — be the first!</p>';
    }
    var countText = info.total_count + (info.total_count === 1 ? " person going" : " people going");
    var names = info.attendees.map(function (a) {
      var name = escapeHtml(a.first_name + " " + a.last_name);
      return a.guest_count ? name + " (+" + a.guest_count + ")" : name;
    }).join(", ");
    return (
      '<details class="attendees-summary">' +
      "<summary>" + countText + "</summary>" +
      '<p class="attendees-list">' + names + "</p>" +
      "</details>"
    );
  }

  function flyerThumb(ev) {
    return ev.flyer_filename
      ? '<img src="' + apiOrigin + "/uploads/events/" + ev.flyer_filename + '" alt="" style="width:48px; height:48px; object-fit:cover; border-radius:var(--radius-sm); margin-right:.75rem; flex-shrink:0;">'
      : "";
  }

  function renderFreeEventRow(ev, rsvp) {
    var going = rsvp && rsvp.status === "registered";
    return (
      '<div class="event-row">' +
      '<div style="display:flex; align-items:center;">' +
      flyerThumb(ev) +
      "<div>" +
      "<h3>" + escapeHtml(ev.name) + "</h3>" +
      '<div class="meta">' + fmtDateTime(ev.event_date) + (ev.location ? " &middot; " + escapeHtml(ev.location) : "") + "</div>" +
      renderAttendeesSummary(ev) +
      "</div>" +
      "</div>" +
      '<div class="actions">' +
      (going
        ? '<label class="guest-count-field">Guests <input type="number" min="0" max="20" value="' + (rsvp.guest_count || 0) + '" data-guest-input="' + ev.id + '"></label>' +
          '<button class="btn btn-outline-dark btn-sm" data-update-rsvp="' + ev.id + '">Update</button>' +
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
      var mySelections = rsvp.selections || [];
      var selectionsHtml = mySelections.length
        ? '<div class="pricing-selections" style="width:100%; margin-top:.5rem;">' +
          mySelections.map(function (s) {
            var isAddon = s.kind === "addon";
            return (
              '<div class="pricing-choice" style="display:flex; align-items:center; justify-content:space-between; gap:.5rem; flex-wrap:wrap;">' +
              '<span>' + escapeHtml(s.label) + (s.quantity > 1 ? " ×" + s.quantity : "") + " — " + fmtMoney(s.amount_cents) + "</span>" +
              (isAddon
                ? '<span style="display:flex; align-items:center; gap:.4rem;">' +
                  '<input type="number" min="0" max="' + (s.quantity - 1) + '" value="' + Math.max(0, s.quantity - 1) + '" class="addon-qty" data-reduce-qty-input="' + s.pricing_option_id + '" style="width:60px;">' +
                  '<button type="button" class="btn btn-outline-dark btn-sm" data-reduce-selection="' + s.pricing_option_id + '" data-reduce-event="' + ev.id + '" data-reduce-label="' + escapeHtml(s.label) + '">Update</button>' +
                  "</span>"
                : "") +
              "</div>"
            );
          }).join("") +
          "</div>"
        : "";
      var buyMoreHtml = addonOptions.length
        ? '<button type="button" class="btn btn-outline-dark btn-sm" data-toggle-buy-more="' + ev.id + '" style="margin-top:.5rem;">Buy More</button>' +
          '<div class="pricing-addons" data-buy-more-panel="' + ev.id + '" style="display:none; margin-top:.75rem; width:100%;">' +
          addonOptions.map(function (o) {
            return (
              '<label class="pricing-choice">' +
              '<input type="checkbox" data-bm-addon-check="' + o.id + '" data-bm-addon-event="' + ev.id + '"> ' +
              escapeHtml(o.label) + " — " + fmtMoney(priceFor(o)) + " each " +
              '<input type="number" min="1" max="20" value="1" class="addon-qty" data-bm-addon-qty="' + o.id + '" disabled>' +
              "</label>"
            );
          }).join("") +
          '<div class="pricing-total">Total: <strong data-bm-total="' + ev.id + '">' + fmtMoney(0) + "</strong></div>" +
          '<button type="button" class="btn btn-primary btn-sm" data-buy-more-submit="' + ev.id + '" style="margin-top:.5rem;">Purchase</button>' +
          "</div>"
        : "";
      return (
        '<div class="event-row" style="flex-wrap:wrap;">' +
        '<div style="display:flex; align-items:center;">' +
        flyerThumb(ev) +
        "<div>" +
        "<h3>" + escapeHtml(ev.name) + "</h3>" +
        '<div class="meta">' + fmtDateTime(ev.event_date) + (ev.location ? " &middot; " + escapeHtml(ev.location) : "") + "</div>" +
        renderAttendeesSummary(ev) +
        "</div>" +
        "</div>" +
        '<span class="badge badge-paid">Registered &middot; ' + fmtMoney(rsvp.amount_cents) + " paid</span>" +
        selectionsHtml +
        buyMoreHtml +
        "</div>"
      );
    }
    // Not paid yet — selections can still be changed. Re-submitting to
    // /payments/event-checkout upserts this same RSVP, so the "unpaid" and
    // "editing a pending registration" cases share the same selection form
    // and button; only the copy and the presence of a Cancel option differ.
    var isPending = rsvp && rsvp.status === "pending_payment";

    var selectedParticipationId = null;
    var selectedAddonQty = {};
    if (isPending) {
      (rsvp.selections || []).forEach(function (s) {
        if (s.kind === "participation") selectedParticipationId = s.pricing_option_id;
        else selectedAddonQty[s.pricing_option_id] = s.quantity;
      });
    }

    var participationHtml = participationOptions.length
      ? participationOptions.map(function (o, i) {
          var checked = selectedParticipationId ? o.id === selectedParticipationId : i === 0;
          return (
            '<label class="pricing-choice"><input type="radio" name="participation-' + ev.id + '" value="' + o.id + '" data-price-event="' + ev.id + '"' + (checked ? " checked" : "") + '> ' +
            escapeHtml(o.label) + " — " + fmtMoney(priceFor(o)) + "</label>"
          );
        }).join("")
      : "";

    var addonHtml = addonOptions.length
      ? '<div class="pricing-addons">' + addonOptions.map(function (o) {
          var qty = selectedAddonQty[o.id];
          return (
            '<label class="pricing-choice">' +
            '<input type="checkbox" data-addon-check="' + o.id + '" data-addon-event="' + ev.id + '" data-price-event="' + ev.id + '"' + (qty ? " checked" : "") + '> ' +
            escapeHtml(o.label) + " — " + fmtMoney(priceFor(o)) + " each " +
            '<input type="number" min="1" max="20" value="' + (qty || 1) + '" class="addon-qty" data-addon-qty="' + o.id + '" data-price-event="' + ev.id + '"' + (qty ? "" : " disabled") + ">" +
            "</label>"
          );
        }).join("") + "</div>"
      : "";

    var nonMemberNotice = !isActiveMember() && options.some(function (o) { return o.non_member_amount_cents !== o.member_amount_cents; })
      ? '<p class="empty-note" style="margin:.35rem 0 0;">Non-member pricing applies — pay your dues for member pricing.</p>'
      : "";

    var initialTotal = 0;
    var initialParticipationOption = selectedParticipationId
      ? participationOptions.find(function (o) { return o.id === selectedParticipationId; })
      : participationOptions[0];
    if (initialParticipationOption) initialTotal += priceFor(initialParticipationOption);
    addonOptions.forEach(function (o) { if (selectedAddonQty[o.id]) initialTotal += priceFor(o) * selectedAddonQty[o.id]; });

    return (
      '<div class="event-row priced-event-row" data-priced-event="' + ev.id + '">' +
      "<div style=\"width:100%;\">" +
      '<div style="display:flex; align-items:center;">' +
      flyerThumb(ev) +
      "<h3 style=\"margin:0;\">" + escapeHtml(ev.name) + "</h3>" +
      "</div>" +
      '<div class="meta">' + fmtDateTime(ev.event_date) + (ev.location ? " &middot; " + escapeHtml(ev.location) : "") + "</div>" +
      renderAttendeesSummary(ev) +
      (isPending
        ? '<span class="badge badge-pending">Payment pending</span>' +
          '<p class="empty-note" style="margin:.35rem 0 0;">You haven\'t paid yet — change your choices below if needed, then pay to confirm.</p>'
        : "") +
      '<div class="pricing-selections">' + participationHtml + addonHtml + "</div>" +
      nonMemberNotice +
      '<div class="pricing-total">Total: <strong data-price-total="' + ev.id + '">' + fmtMoney(initialTotal) + "</strong></div>" +
      '<div style="display:flex; gap:.5rem; margin-top:.5rem;">' +
      '<button class="btn btn-primary btn-sm" data-register-pay="' + ev.id + '">' + (isPending ? "Update &amp; Pay" : "Register &amp; Pay") + "</button>" +
      (isPending ? '<button type="button" class="btn btn-outline-dark btn-sm" data-cancel-rsvp="' + ev.id + '">Cancel</button>' : "") +
      "</div>" +
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

  function computeBuyMoreTotal(eventId) {
    var options = pricingByEvent[eventId] || [];
    var optionsById = {};
    options.forEach(function (o) { optionsById[o.id] = o; });
    var total = 0;
    document.querySelectorAll('[data-bm-addon-check][data-bm-addon-event="' + eventId + '"]:checked').forEach(function (cb) {
      var optId = cb.getAttribute("data-bm-addon-check");
      var qtyInput = document.querySelector('[data-bm-addon-qty="' + optId + '"]');
      var qty = qtyInput ? Math.max(1, parseInt(qtyInput.value, 10) || 1) : 1;
      total += priceFor(optionsById[optId]) * qty;
    });
    var totalEl = document.querySelector('[data-bm-total="' + eventId + '"]');
    if (totalEl) totalEl.textContent = fmtMoney(total);
  }

  document.getElementById("events-list").addEventListener("change", function (e) {
    if (e.target.matches("[data-bm-addon-check]")) {
      var bmQtyInput = document.querySelector('[data-bm-addon-qty="' + e.target.getAttribute("data-bm-addon-check") + '"]');
      if (bmQtyInput) bmQtyInput.disabled = !e.target.checked;
      computeBuyMoreTotal(e.target.getAttribute("data-bm-addon-event"));
      return;
    }
    if (e.target.matches("[data-bm-addon-qty]")) {
      var bmEventId = e.target.closest("[data-buy-more-panel]");
      if (bmEventId) computeBuyMoreTotal(bmEventId.getAttribute("data-buy-more-panel"));
      return;
    }
    var eventId = e.target.getAttribute("data-price-event");
    if (!eventId) return;
    if (e.target.matches("[data-addon-check]")) {
      var qtyInput = document.querySelector('[data-addon-qty="' + e.target.getAttribute("data-addon-check") + '"]');
      if (qtyInput) qtyInput.disabled = !e.target.checked;
    }
    computeEventTotal(eventId);
  });

  document.getElementById("events-list").addEventListener("click", async function (e) {
    var rsvpBtn = e.target.closest("[data-rsvp], [data-update-rsvp]");
    var cancelBtn = e.target.closest("[data-cancel-rsvp]");
    var registerBtn = e.target.closest("[data-register-pay]");
    var toggleBuyMoreBtn = e.target.closest("[data-toggle-buy-more]");
    var buyMoreSubmitBtn = e.target.closest("[data-buy-more-submit]");
    var reduceBtn = e.target.closest("[data-reduce-selection]");

    if (reduceBtn) {
      var reduceOptId = reduceBtn.getAttribute("data-reduce-selection");
      var reduceEvId = reduceBtn.getAttribute("data-reduce-event");
      var reduceLabel = reduceBtn.getAttribute("data-reduce-label");
      var reduceQtyInput = document.querySelector('[data-reduce-qty-input="' + reduceOptId + '"]');
      var reduceQty = reduceQtyInput ? Math.max(0, parseInt(reduceQtyInput.value, 10) || 0) : 0;
      var confirmMsg = reduceQty === 0
        ? 'Remove "' + reduceLabel + '" entirely? Any amount already paid for it will be refunded to your original payment method.'
        : 'Reduce "' + reduceLabel + '" to ' + reduceQty + '? The difference already paid will be refunded to your original payment method.';
      if (!window.confirm(confirmMsg)) return;

      reduceBtn.disabled = true;
      reduceBtn.textContent = "Refunding…";
      try {
        var reduceResult = await api("/payments/event-selection", { method: "PUT", body: { event_id: reduceEvId, option_id: reduceOptId, quantity: reduceQty } });
        toast(reduceResult.refunded_cents ? "Refunded " + fmtMoney(reduceResult.refunded_cents) : "Updated");
        await loadProfile();
      } catch (err) {
        toast(err.message, true);
        reduceBtn.disabled = false;
        reduceBtn.textContent = "Update";
      }
      return;
    }

    if (toggleBuyMoreBtn) {
      var panel = document.querySelector('[data-buy-more-panel="' + toggleBuyMoreBtn.getAttribute("data-toggle-buy-more") + '"]');
      if (panel) panel.style.display = panel.style.display === "none" ? "" : "none";
    }

    if (buyMoreSubmitBtn) {
      var bmEvId = buyMoreSubmitBtn.getAttribute("data-buy-more-submit");
      var bmAddons = [];
      document.querySelectorAll('[data-bm-addon-check][data-bm-addon-event="' + bmEvId + '"]:checked').forEach(function (cb) {
        var optId = cb.getAttribute("data-bm-addon-check");
        var qtyInput = document.querySelector('[data-bm-addon-qty="' + optId + '"]');
        bmAddons.push({ option_id: optId, quantity: qtyInput ? Math.max(1, parseInt(qtyInput.value, 10) || 1) : 1 });
      });
      if (!bmAddons.length) { toast("Pick at least one add-on first.", true); return; }

      buyMoreSubmitBtn.disabled = true;
      buyMoreSubmitBtn.textContent = "Redirecting…";
      try {
        var bmResult = await api("/payments/event-addon-checkout", { method: "POST", body: { event_id: bmEvId, addons: bmAddons } });
        if (bmResult.free) {
          toast("Added!");
          renderEvents();
        } else {
          goToCheckout(bmResult);
        }
      } catch (err) {
        toast(err.message, true);
        buyMoreSubmitBtn.disabled = false;
        buyMoreSubmitBtn.textContent = "Purchase";
      }
    }

    if (rsvpBtn) {
      var isUpdate = rsvpBtn.hasAttribute("data-update-rsvp");
      var eventId = rsvpBtn.getAttribute(isUpdate ? "data-update-rsvp" : "data-rsvp");
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
        toast(isUpdate ? "Guest count updated" : "You're on the list!");
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
      var registerBtnLabel = registerBtn.textContent;
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
          goToCheckout(result);
        }
      } catch (err) {
        toast(err.message, true);
        registerBtn.disabled = false;
        registerBtn.textContent = registerBtnLabel;
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
      goToCheckout(data);
    } catch (err) {
      errorEl.textContent = err.message;
      errorEl.style.display = "";
      btn.disabled = false;
      btn.textContent = PAY_BTN_LABEL;
    }
  });

  loadProfile();
})();
