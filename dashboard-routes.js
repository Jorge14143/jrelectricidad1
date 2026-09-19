
module.exports = function registerDashboardRoutes({ app, pool, requireAdmin }) {
  app.get("/api/admin/dashboard", requireAdmin, async (req, res) => {
    try {
      const raw = Number(req.query.months || 6);
      const months = [3, 6, 12].includes(raw) ? raw : 6;
      const q = (sql, params=[]) => pool.query(sql, params);

      const [
        [[clients]],
        [[quotes]],
        [[jobs]],
        [[pendingQuotes]],
        [[acceptedQuotes]],
        [[activeJobs]],
        [[invoices]],
        [[collected]],
        [[expenses]],
        [recentQuotes],
        [recentJobs],
        [recentClients],
        [agenda],
        [activity],
        [monthlyFinance]
      ] = await Promise.all([
        q("SELECT COUNT(DISTINCT CONCAT(COALESCE(phone,''),'|',COALESCE(LOWER(email),''))) AS total FROM quote_requests"),
        q("SELECT COUNT(*) AS total FROM quotes"),
        q("SELECT COUNT(*) AS total FROM jobs"),
        q("SELECT COUNT(*) AS total FROM quotes WHERE status IN ('pendiente','enviado')"),
        q("SELECT COUNT(*) AS total FROM quotes WHERE status='aceptado'"),
        q("SELECT COUNT(*) AS total FROM jobs WHERE status IN ('aceptado','en_proceso')"),
        q("SELECT COALESCE(SUM(total),0) AS total FROM service_invoices WHERE status <> 'anulada' AND issue_date >= DATE_SUB(CURDATE(), INTERVAL ? MONTH)", [months]),
        q("SELECT COALESCE(SUM(sp.amount),0) AS total FROM service_payments sp INNER JOIN service_invoices si ON si.id=sp.invoice_id WHERE si.status <> 'anulada' AND sp.payment_date >= DATE_SUB(CURDATE(), INTERVAL ? MONTH)", [months]),
        q("SELECT COALESCE(SUM(amount),0) AS total FROM business_expenses WHERE expense_date >= DATE_SUB(CURDATE(), INTERVAL ? MONTH)", [months]),
        q("SELECT q.id,q.quote_number,q.status,q.total,q.created_at,qr.name AS client_name,qr.service AS service FROM quotes q INNER JOIN quote_requests qr ON qr.id=q.quote_request_id ORDER BY q.created_at DESC LIMIT 8"),
        q("SELECT j.id,j.status,j.created_at,j.started_at,j.completed_at,q.quote_number,qr.name AS client_name,qr.service AS service FROM jobs j INNER JOIN quotes q ON q.id=j.quote_id INNER JOIN quote_requests qr ON qr.id=q.quote_request_id ORDER BY COALESCE(j.updated_at,j.created_at) DESC LIMIT 8"),
        q("SELECT name,phone,email,MAX(created_at) AS last_activity FROM quote_requests GROUP BY name,phone,email ORDER BY last_activity DESC LIMIT 8"),
        q("SELECT qr.name AS client_name,qr.service,qr.preferred_date,qr.phone,qr.email,q.quote_number,q.status FROM quote_requests qr LEFT JOIN quotes q ON q.quote_request_id=qr.id WHERE qr.preferred_date IS NOT NULL AND qr.preferred_date >= CURDATE() AND (q.status IS NULL OR q.status NOT IN ('rechazado','vencido')) ORDER BY qr.preferred_date ASC LIMIT 8"),
        q("SELECT type,id,message,is_read,created_at FROM admin_notifications ORDER BY created_at DESC LIMIT 10"),
        q("SELECT DATE_FORMAT(d.month_date,'%Y-%m') AS month, COALESCE(i.invoiced,0) AS invoiced, COALESCE(p.collected,0) AS collected, COALESCE(e.expenses,0) AS expenses FROM (SELECT DATE_FORMAT(DATE_SUB(CURDATE(), INTERVAL seq MONTH),'%Y-%m-01') AS month_date FROM (SELECT 0 seq UNION ALL SELECT 1 UNION ALL SELECT 2 UNION ALL SELECT 3 UNION ALL SELECT 4 UNION ALL SELECT 5 UNION ALL SELECT 6 UNION ALL SELECT 7 UNION ALL SELECT 8 UNION ALL SELECT 9 UNION ALL SELECT 10 UNION ALL SELECT 11) s WHERE seq < ?) d LEFT JOIN (SELECT DATE_FORMAT(issue_date,'%Y-%m-01') month_date,SUM(total) invoiced FROM service_invoices WHERE status <> 'anulada' GROUP BY DATE_FORMAT(issue_date,'%Y-%m-01')) i ON i.month_date=d.month_date LEFT JOIN (SELECT DATE_FORMAT(payment_date,'%Y-%m-01') month_date,SUM(amount) collected FROM service_payments sp INNER JOIN service_invoices si ON si.id=sp.invoice_id WHERE si.status <> 'anulada' GROUP BY DATE_FORMAT(payment_date,'%Y-%m-01')) p ON p.month_date=d.month_date LEFT JOIN (SELECT DATE_FORMAT(expense_date,'%Y-%m-01') month_date,SUM(amount) expenses FROM business_expenses GROUP BY DATE_FORMAT(expense_date,'%Y-%m-01')) e ON e.month_date=d.month_date ORDER BY d.month_date ASC", [months])
      ]);

      const invoiced = Number(invoices.total || 0);
      const collectedAmount = Number(collected.total || 0);
      const expenseAmount = Number(expenses.total || 0);

      res.json({
        success: true,
        period: { months },
        indicators: {
          clients: Number(clients.total || 0),
          quotes: Number(quotes.total || 0),
          pendingQuotes: Number(pendingQuotes.total || 0),
          acceptedQuotes: Number(acceptedQuotes.total || 0),
          jobs: Number(jobs.total || 0),
          activeJobs: Number(activeJobs.total || 0),
          invoiced, collected: collectedAmount,
          receivable: Math.max(0, invoiced - collectedAmount),
          expenses: expenseAmount,
          net: collectedAmount - expenseAmount
        },
        quotes: recentQuotes,
        jobs: recentJobs,
        clientsList: recentClients,
        agenda,
        activity,
        monthlyFinance: monthlyFinance.map(row => ({
          month: row.month,
          invoiced: Number(row.invoiced || 0),
          collected: Number(row.collected || 0),
          expenses: Number(row.expenses || 0)
        }))
      });
    } catch (error) {
      console.error("Error cargando dashboard V3:", error);
      res.status(500).json({ error: "No se pudo cargar el dashboard V3." });
    }
  });
};
