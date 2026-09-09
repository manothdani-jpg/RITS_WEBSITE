(function () {
  "use strict";

  var API = window.RITS_API_BASE;
  var token = localStorage.getItem("rits_desk_token");
  if (!token) {
    window.location.href = "index.html";
    return;
  }
  var deskInfo = JSON.parse(localStorage.getItem("rits_desk_info") || "{}");
  document.getElementById("who-name").textContent = deskInfo.name || deskInfo.username || "";

  document.getElementById("logout-btn").addEventListener("click", function () {
    localStorage.removeItem("rits_desk_token");
    localStorage.removeItem("rits_desk_info");
    window.location.href = "index.html";
  });

  async function api(path, options) {
    options = options || {};
    options.headers = Object.assign(
      { "Content-Type": "application/json", Authorization: "Bearer " + token },
      options.headers || {}
    );
    if (options.body && typeof options.body !== "string") options.body = JSON.stringify(options.body);
    var res = await fetch(API + path, options);
    if (res.status === 401) {
      localStorage.removeItem("rits_desk_token");
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

  function escapeHtml(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function fmtMoney(cents) {
    return ((cents || 0) / 100).toLocaleString(undefined, { style: "currency", currency: "USD" });
  }
  function fmtDateTime(d) {
    if (!d) return "—";
    return new Date(d).toLocaleString(undefined, { year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  }
  var METHOD_LABELS = { cash: "Cash", venmo: "Venmo", zelle: "Zelle", paypal: "PayPal", square: "Square" };

  /* ---------------- State ---------------- */
  var allEvents = [];
  var currentEventId = null;
  var currentOptions = [];
  var currentAttendees = [];
  var selectedPerson = null; // { id, first_name, last_name, email, payment_status } or { isWalkin:true, ... }
  var selectedMethod = null;
  var registrationMode = "register"; // or "add-items"

  function isActiveMember(person) {
    return person && person.payment_status === "paid";
  }
  function priceFor(opt, person) {
    return isActiveMember(person) ? opt.member_amount_cents : opt.non_member_amount_cents;
  }

  /* ---------------- Event picker ---------------- */
  async function loadEvents() {
    var data = await api("/desk/events");
    allEvents = data.events;
    var select = document.getElementById("event-select");
    select.innerHTML = allEvents.map(function (ev) {
      return '<option value="' + ev.id + '">' + escapeHtml(ev.name) + " — " + fmtDateTime(ev.event_date) + "</option>";
    }).join("");

    var now = new Date();
    var upcoming = allEvents.filter(function (ev) { return new Date(ev.event_date) >= now; });
    var defaultEvent = upcoming.length ? upcoming[0] : allEvents[allEvents.length - 1];
    if (defaultEvent) {
      select.value = defaultEvent.id;
      await selectEvent(defaultEvent.id);
    }
  }

  document.getElementById("event-select").addEventListener("change", function (e) {
    selectEvent(e.target.value);
  });

  async function selectEvent(eventId) {
    currentEventId = eventId;
    resetRegistrationFlow();
    var ev = allEvents.find(function (e) { return e.id === eventId; });
    document.getElementById("event-meta").textContent = ev && ev.location ? ev.location : "";
    try {
      var data = await api("/desk/events/" + eventId);
      currentOptions = data.options || [];
    } catch (err) {
      toast(err.message, true);
    }
    await Promise.all([loadAttendees(), loadTotals()]);
  }

  /* ---------------- Live totals ---------------- */
  async function loadTotals() {
    try {
      var data = await api("/desk/events/" + currentEventId + "/totals");
      var byStatus = {};
      data.by_status.forEach(function (r) { byStatus[r.status] = r.n; });
      var methodLines = data.by_method.map(function (m) {
        return (METHOD_LABELS[m.method] || m.method) + ": " + fmtMoney(m.amount_cents);
      }).join(" · ") || "—";

      document.getElementById("totals-row").innerHTML = [
        ["Checked In", data.checked_in],
        ["Registered", byStatus.registered || 0],
        ["Payment Pending", byStatus.pending_payment || 0],
        ["Collected", fmtMoney(data.total_collected_cents)],
      ].map(function (t) {
        return '<div class="stat-card"><strong>' + t[1] + "</strong><span>" + t[0] + "</span></div>";
      }).join("") + '<div class="stat-card" style="grid-column:1/-1;"><span style="text-transform:none; font-size:.8rem;">' + methodLines + "</span></div>";
    } catch (err) {
      toast(err.message, true);
    }
  }

  /* ---------------- Tabs ---------------- */
  document.querySelectorAll(".desk-tab").forEach(function (btn) {
    btn.addEventListener("click", function () {
      document.querySelectorAll(".desk-tab").forEach(function (b) { b.classList.remove("is-active"); });
      btn.classList.add("is-active");
      var tab = btn.getAttribute("data-tab");
      document.getElementById("tab-register").style.display = tab === "register" ? "" : "none";
      document.getElementById("tab-checkin").style.display = tab === "checkin" ? "" : "none";
    });
  });

  /* ---------------- Person search ---------------- */
  var searchTimer = null;
  document.getElementById("person-search").addEventListener("input", function (e) {
    var q = e.target.value.trim();
    clearTimeout(searchTimer);
    if (q.length < 2) {
      document.getElementById("person-search-results").innerHTML = "";
      return;
    }
    searchTimer = setTimeout(async function () {
      try {
        var data = await api("/desk/members/search?q=" + encodeURIComponent(q));
        document.getElementById("person-search-results").innerHTML = data.members.map(function (m) {
          return (
            '<button type="button" class="search-result-row" data-member-id="' + m.id + '">' +
            '<span><span class="sr-name">' + escapeHtml(m.first_name + " " + m.last_name) + '</span><br>' +
            '<span class="sr-detail">' + escapeHtml(m.email) + (m.phone ? " · " + escapeHtml(m.phone) : "") + "</span></span>" +
            '<span class="badge ' + (m.payment_status === "paid" ? "badge-paid" : "badge-tier") + '">' + escapeHtml(m.payment_status) + "</span>" +
            "</button>"
          );
        }).join("") || '<p class="empty-note">No matches.</p>';
      } catch (err) {
        toast(err.message, true);
      }
    }, 250);
  });

  document.getElementById("person-search-results").addEventListener("click", function (e) {
    var btn = e.target.closest("[data-member-id]");
    if (!btn) return;
    api("/desk/members/search?q=" + encodeURIComponent(document.getElementById("person-search").value)).then(function (data) {
      var member = data.members.find(function (m) { return m.id === btn.getAttribute("data-member-id"); });
      if (member) choosePerson(member);
    });
  });

  document.getElementById("use-walkin-btn").addEventListener("click", function () {
    var first = document.getElementById("wi-first-name").value.trim();
    var last = document.getElementById("wi-last-name").value.trim();
    if (!first || !last) { toast("First and last name are required.", true); return; }
    choosePerson({
      isWalkin: true,
      first_name: first,
      last_name: last,
      email: document.getElementById("wi-email").value.trim(),
      phone: document.getElementById("wi-phone").value.trim(),
      payment_status: "pending",
    });
  });

  function choosePerson(person) {
    selectedPerson = person;
    document.getElementById("person-search").value = "";
    document.getElementById("person-search-results").innerHTML = "";
    document.getElementById("selected-person").style.display = "";
    document.getElementById("selected-person-label").textContent =
      person.first_name + " " + person.last_name + (person.isWalkin ? " (new walk-in)" : "");

    var existingRsvp = !person.isWalkin && currentAttendees.find(function (a) {
      return a.member_id === person.id && ["registered", "attended"].includes(a.status);
    });
    registrationMode = existingRsvp ? "add-items" : "register";
    renderRegistrationCard();
  }

  document.getElementById("clear-person-btn").addEventListener("click", function () {
    selectedPerson = null;
    document.getElementById("selected-person").style.display = "none";
    document.getElementById("registration-card").style.display = "none";
  });

  /* ---------------- Registration card ---------------- */
  function renderRegistrationCard() {
    var card = document.getElementById("registration-card");
    var participationOptions = currentOptions.filter(function (o) { return o.kind === "participation"; });
    var addonOptions = currentOptions.filter(function (o) { return o.kind === "addon"; });

    document.getElementById("registration-mode-note").textContent =
      registrationMode === "add-items"
        ? "Already registered — this will add more items on top of what's already paid."
        : "New registration for this event.";

    var html = "";
    if (registrationMode === "register" && participationOptions.length) {
      html += participationOptions.map(function (o, i) {
        return (
          '<label class="pricing-choice"><input type="radio" name="participation" value="' + o.id + '"' + (i === 0 ? " checked" : "") + '> ' +
          escapeHtml(o.label) + " — " + fmtMoney(priceFor(o, selectedPerson)) + "</label>"
        );
      }).join("");
    }
    if (addonOptions.length) {
      html += '<div class="pricing-addons">' + addonOptions.map(function (o) {
        return (
          '<label class="pricing-choice">' +
          '<input type="checkbox" data-addon-check="' + o.id + '"> ' +
          escapeHtml(o.label) + " — " + fmtMoney(priceFor(o, selectedPerson)) + " each " +
          '<input type="number" min="1" max="50" value="1" class="addon-qty" data-addon-qty="' + o.id + '" disabled>' +
          "</label>"
        );
      }).join("") + "</div>";
    }
    document.getElementById("pricing-selections").innerHTML = html || '<p class="empty-note">This event is free — no items to select.</p>';
    document.querySelectorAll(".method-btn").forEach(function (b) { b.classList.remove("is-selected"); });
    selectedMethod = null;
    computeTotal();
    card.style.display = "";
    document.getElementById("receipt-card").style.display = "none";
  }

  function computeTotal() {
    var total = 0;
    var checkedParticipation = document.querySelector('input[name="participation"]:checked');
    if (checkedParticipation) {
      var opt = currentOptions.find(function (o) { return o.id === checkedParticipation.value; });
      if (opt) total += priceFor(opt, selectedPerson);
    }
    document.querySelectorAll("[data-addon-check]:checked").forEach(function (cb) {
      var opt = currentOptions.find(function (o) { return o.id === cb.getAttribute("data-addon-check"); });
      var qtyInput = document.querySelector('[data-addon-qty="' + cb.getAttribute("data-addon-check") + '"]');
      var qty = qtyInput ? Math.max(1, parseInt(qtyInput.value, 10) || 1) : 1;
      if (opt) total += priceFor(opt, selectedPerson) * qty;
    });
    document.getElementById("pricing-total").textContent = fmtMoney(total);
    return total;
  }

  document.getElementById("pricing-selections").addEventListener("change", function (e) {
    if (e.target.matches("[data-addon-check]")) {
      var qtyInput = document.querySelector('[data-addon-qty="' + e.target.getAttribute("data-addon-check") + '"]');
      if (qtyInput) qtyInput.disabled = !e.target.checked;
    }
    computeTotal();
  });

  document.getElementById("method-grid").addEventListener("click", function (e) {
    var btn = e.target.closest(".method-btn");
    if (!btn) return;
    document.querySelectorAll(".method-btn").forEach(function (b) { b.classList.remove("is-selected"); });
    btn.classList.add("is-selected");
    selectedMethod = btn.getAttribute("data-method");
  });

  document.getElementById("submit-registration-btn").addEventListener("click", async function () {
    if (!selectedPerson) { toast("Choose or add a person first.", true); return; }
    if (!selectedMethod) { toast("Choose a payment method.", true); return; }

    var addons = [];
    document.querySelectorAll("[data-addon-check]:checked").forEach(function (cb) {
      var qtyInput = document.querySelector('[data-addon-qty="' + cb.getAttribute("data-addon-check") + '"]');
      addons.push({ option_id: cb.getAttribute("data-addon-check"), quantity: qtyInput ? Math.max(1, parseInt(qtyInput.value, 10) || 1) : 1 });
    });

    var btn = this;
    btn.disabled = true;
    btn.textContent = "Processing…";
    try {
      var result;
      if (registrationMode === "add-items") {
        result = await api("/desk/events/" + currentEventId + "/add-items", {
          method: "POST",
          body: { member_id: selectedPerson.id, addons: addons, payment_method: selectedMethod },
        });
      } else {
        var checkedParticipation = document.querySelector('input[name="participation"]:checked');
        var payload = {
          addons: addons,
          payment_method: selectedMethod,
          participation_option_id: checkedParticipation ? checkedParticipation.value : undefined,
        };
        if (selectedPerson.isWalkin) {
          payload.first_name = selectedPerson.first_name;
          payload.last_name = selectedPerson.last_name;
          payload.email = selectedPerson.email || undefined;
          payload.phone = selectedPerson.phone || undefined;
        } else {
          payload.member_id = selectedPerson.id;
        }
        result = await api("/desk/events/" + currentEventId + "/register", { method: "POST", body: payload });
      }

      if (result.checkout_url) {
        window.open(result.checkout_url, "_blank");
        toast("Square checkout opened — hand the device to the guest. They'll show as pending until payment confirms.");
      } else {
        showReceipt(computeTotal());
        toast("Registration recorded.");
      }
      await Promise.all([loadAttendees(), loadTotals()]);
    } catch (err) {
      toast(err.message, true);
    } finally {
      btn.disabled = false;
      btn.textContent = "Complete Registration";
    }
  });

  function showReceipt(totalCents) {
    var ev = allEvents.find(function (e) { return e.id === currentEventId; });
    var name = selectedPerson.first_name + " " + selectedPerson.last_name;
    var itemsHtml = document.getElementById("pricing-selections").innerText.trim();

    document.getElementById("receipt-summary").innerHTML =
      "<p><strong>" + escapeHtml(name) + "</strong></p>" +
      "<p>" + fmtMoney(totalCents) + " via " + (METHOD_LABELS[selectedMethod] || selectedMethod) + "</p>";

    document.getElementById("receipt-print-event").textContent = ev ? ev.name : "";
    document.getElementById("receipt-print-name").textContent = name;
    document.getElementById("receipt-print-items").textContent = itemsHtml;
    document.getElementById("receipt-print-total").textContent = "Total: " + fmtMoney(totalCents);
    document.getElementById("receipt-print-method").textContent = "Paid via " + (METHOD_LABELS[selectedMethod] || selectedMethod);
    document.getElementById("receipt-print-time").textContent = new Date().toLocaleString();

    document.getElementById("registration-card").style.display = "none";
    document.getElementById("receipt-card").style.display = "";
  }

  document.getElementById("print-receipt-btn").addEventListener("click", function () { window.print(); });
  document.getElementById("register-another-btn").addEventListener("click", resetRegistrationFlow);

  function resetRegistrationFlow() {
    selectedPerson = null;
    selectedMethod = null;
    document.getElementById("selected-person").style.display = "none";
    document.getElementById("registration-card").style.display = "none";
    document.getElementById("receipt-card").style.display = "none";
    document.getElementById("person-search").value = "";
    document.getElementById("person-search-results").innerHTML = "";
    document.getElementById("wi-first-name").value = "";
    document.getElementById("wi-last-name").value = "";
    document.getElementById("wi-email").value = "";
    document.getElementById("wi-phone").value = "";
  }

  /* ---------------- Check-in tab ---------------- */
  async function loadAttendees() {
    try {
      var data = await api("/desk/events/" + currentEventId + "/attendees");
      currentAttendees = data.attendees;
      renderAttendees();
    } catch (err) {
      toast(err.message, true);
    }
  }

  function statusBadgeClass(status) {
    return { registered: "badge-paid", attended: "badge-paid", pending_payment: "badge-pending", cancelled: "badge-tier" }[status] || "badge-tier";
  }

  function renderAttendees() {
    var q = document.getElementById("checkin-search").value.trim().toLowerCase();
    var filtered = currentAttendees.filter(function (a) {
      if (!q) return true;
      return (a.first_name + " " + a.last_name + " " + a.email).toLowerCase().indexOf(q) !== -1;
    });
    var list = document.getElementById("attendees-list");
    var empty = document.getElementById("attendees-empty");
    empty.style.display = filtered.length ? "none" : "";

    list.innerHTML = filtered.map(function (a) {
      var selections = (a.selections || []).map(function (s) {
        return escapeHtml(s.label) + (s.quantity > 1 ? " ×" + s.quantity : "");
      }).join(", ");
      var canCheckIn = a.status === "registered" || a.status === "attended";
      return (
        '<div class="attendee-row">' +
        '<div><div class="ar-name">' + escapeHtml(a.first_name + " " + a.last_name) + "</div>" +
        '<div class="ar-detail">' + escapeHtml(a.email) + (selections ? " · " + selections : "") + (a.amount_cents ? " · " + fmtMoney(a.amount_cents) : "") + "</div></div>" +
        '<div class="ar-actions">' +
        '<span class="badge ' + statusBadgeClass(a.status) + '">' + escapeHtml(a.status.replace("_", " ")) + "</span>" +
        (canCheckIn
          ? '<button type="button" class="btn btn-outline-dark btn-sm" data-checkin="' + a.id + '" data-undo="' + (a.status === "attended" ? "1" : "0") + '">' +
            (a.status === "attended" ? "Undo" : "Check In") + "</button>"
          : "") +
        "</div></div>"
      );
    }).join("");
  }

  document.getElementById("checkin-search").addEventListener("input", renderAttendees);

  document.getElementById("attendees-list").addEventListener("click", async function (e) {
    var btn = e.target.closest("[data-checkin]");
    if (!btn) return;
    var undo = btn.getAttribute("data-undo") === "1";
    try {
      await api("/desk/rsvps/" + btn.getAttribute("data-checkin") + "/checkin", {
        method: "PUT",
        body: { checked_in: !undo },
      });
      toast(undo ? "Check-in undone" : "Checked in");
      await Promise.all([loadAttendees(), loadTotals()]);
    } catch (err) {
      toast(err.message, true);
    }
  });

  loadEvents();
})();
