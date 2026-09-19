(() => {
  "use strict";

  const $ = id => document.getElementById(id);
  const money = value => new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    maximumFractionDigits: 2
  }).format(Number(value || 0));

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, c => ({
      "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"
    }[c]));
  }

  async function api(url, options = {}) {
    const response = await fetch(url, {
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", ...(options.headers || {}) },
      ...options
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "No se pudo completar la operación.");
    return data;
  }

  function today() {
    return new Date().toISOString().slice(0, 10);
  }

  function renderSummary(data) {
    $("finBilled").textContent = money(data.billed);
    $("finCollected").textContent = money(data.collected);
    $("finReceivable").textContent = money(data.receivable);
    $("finExpenses").textContent = money(data.expenses);
    $("finResult").textContent = money(data.result);
    $("finInvoices").textContent = String(data.invoices || 0);
  }

  function statusLabel(status) {
    return ({
      emitida:"Emitida",
      parcial:"Pago parcial",
      pagada:"Pagada",
      vencida:"Vencida",
      anulada:"Anulada"
    })[status] || status;
  }

  async function loadAll() {
    const [summary, invoices, payments, expenses, clients] = await Promise.all([
      api("/api/admin/finance/summary"),
      api("/api/admin/finance/invoices"),
      api("/api/admin/finance/payments"),
      api("/api/admin/finance/expenses"),
      api("/api/admin/finance/clients")
    ]);

    renderSummary(summary);

    $("invoiceRows").innerHTML = invoices.invoices.length
      ? invoices.invoices.map(i => `
        <tr>
          <td><strong>${escapeHtml(i.invoice_number)}</strong><small>Presupuesto ${escapeHtml(i.quote_number)}</small></td>
          <td>${escapeHtml(i.client_name)}</td>
          <td>${new Date(i.issue_date).toLocaleDateString("es-AR")}</td>
          <td>${money(i.total)}</td>
          <td>${money(i.paid)}</td>
          <td>${money(i.balance)}</td>
          <td><span class="status status-${escapeHtml(i.status)}">${statusLabel(i.status)}</span></td>
          <td><button class="btn small" data-pay="${i.id}" data-balance="${i.balance}">Registrar cobro</button></td>
        </tr>`).join("")
      : '<tr><td colspan="8" class="empty">Todavía no hay registros de facturación de servicios.</td></tr>';

    $("paymentRows").innerHTML = payments.payments.length
      ? payments.payments.map(p => `
        <tr>
          <td>${new Date(p.payment_date).toLocaleDateString("es-AR")}</td>
          <td>${escapeHtml(p.client_name)}</td>
          <td>${escapeHtml(p.invoice_number)}</td>
          <td>${money(p.amount)}</td>
          <td>${escapeHtml(p.method)}</td>
          <td>${escapeHtml(p.reference || "—")}</td>
        </tr>`).join("")
      : '<tr><td colspan="6" class="empty">Todavía no hay cobros registrados.</td></tr>';

    $("expenseRows").innerHTML = expenses.expenses.length
      ? expenses.expenses.map(e => `
        <tr>
          <td>${new Date(e.expense_date).toLocaleDateString("es-AR")}</td>
          <td>${escapeHtml(e.category)}</td>
          <td>${escapeHtml(e.description)}</td>
          <td>${money(e.amount)}</td>
        </tr>`).join("")
      : '<tr><td colspan="4" class="empty">Todavía no hay gastos registrados.</td></tr>';

    $("clientRows").innerHTML = clients.clients.length
      ? clients.clients.map(c => `
        <tr>
          <td>${escapeHtml(c.client_name)}</td>
          <td>${escapeHtml(c.client_email || "—")}</td>
          <td>${money(c.billed)}</td>
          <td>${money(c.collected)}</td>
          <td>${money(c.receivable)}</td>
        </tr>`).join("")
      : '<tr><td colspan="5" class="empty">Todavía no hay movimientos por cliente.</td></tr>';
  }

  async function checkAdmin() {
    const me = await api("/api/me");
    if (!me.user || me.user.role !== "admin") {
      location.href = "/login.html";
      return false;
    }
    $("adminName").textContent = me.user.name || "Administrador";
    return true;
  }

  $("expenseForm").addEventListener("submit", async event => {
    event.preventDefault();
    try {
      await api("/api/admin/finance/expenses", {
        method:"POST",
        body: JSON.stringify({
          expense_date: $("expenseDate").value,
          category: $("expenseCategory").value,
          description: $("expenseDescription").value,
          amount: $("expenseAmount").value,
          notes: $("expenseNotes").value
        })
      });
      event.target.reset();
      $("expenseDate").value = today();
      await loadAll();
      $("financeMsg").textContent = "Gasto registrado correctamente.";
      $("financeMsg").className = "notice success";
    } catch (error) {
      $("financeMsg").textContent = error.message;
      $("financeMsg").className = "notice error";
    }
  });

  $("invoiceRows").addEventListener("click", async event => {
    const button = event.target.closest("[data-pay]");
    if (!button) return;

    const invoiceId = Number(button.dataset.pay);
    const balance = Number(button.dataset.balance || 0);
    const amount = prompt(`Saldo pendiente: ${money(balance)}\n\nImporte a cobrar:`, balance.toFixed(2));
    if (amount === null) return;

    const value = Number(String(amount).replace(",", "."));
    if (!Number.isFinite(value) || value <= 0) {
      alert("Importe inválido.");
      return;
    }

    const method = prompt("Medio de pago: efectivo / transferencia / tarjeta / otro", "transferencia") || "otro";
    try {
      await api(`/api/admin/finance/invoices/${invoiceId}/payments`, {
        method:"POST",
        body: JSON.stringify({
          amount:value,
          payment_date:today(),
          method,
          reference:"",
          notes:""
        })
      });
      await loadAll();
      $("financeMsg").textContent = "Cobro registrado correctamente.";
      $("financeMsg").className = "notice success";
    } catch (error) {
      $("financeMsg").textContent = error.message;
      $("financeMsg").className = "notice error";
    }
  });

  $("refreshFinance").addEventListener("click", loadAll);
  $("logout").addEventListener("click", async () => {
    await fetch("/api/logout", { method:"POST", credentials:"same-origin" });
    location.href="/";
  });

  (async () => {
    try {
      if (await checkAdmin()) {
        $("expenseDate").value = today();
        await loadAll();
      }
    } catch (error) {
      $("financeMsg").textContent = error.message;
      $("financeMsg").className = "notice error";
    }
  })();
})();