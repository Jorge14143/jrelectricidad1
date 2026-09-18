"use strict";

(async function loadSiteSettings() {
  const normalizePhone = value =>
    String(value || "").replace(/\D/g, "");

  const setText = (selector, value) => {
    if (!value) return;
    document.querySelectorAll(selector).forEach(el => {
      el.textContent = value;
    });
  };

  const setLinks = (selector, href, textValue) => {
    document.querySelectorAll(selector).forEach(el => {
      if (href) el.href = href;
      if (textValue) el.textContent = textValue;
    });
  };

  try {
    const response = await fetch("/api/settings", {
      headers: { Accept: "application/json" }
    });

    if (!response.ok) return;

    const data = await response.json();
    const settings = data && data.settings;

    if (!settings) return;

    const businessName =
      settings.business_name || "JR Electricidad";

    const phone = String(settings.phone || "").trim();
    const whatsapp = String(settings.whatsapp || phone).trim();
    const email = String(settings.email || "").trim();
    const address = String(settings.address || "").trim();
    const city = String(settings.city || "").trim();
    const hours = String(settings.hours || "").trim();
    const logoUrl = String(settings.logo_url || "").trim();

    document.title =
      businessName +
      " | Electricista Matriculado Cat. 3";

    document.querySelectorAll(
      ".logo span, .footer-logo span"
    ).forEach(el => {
      el.textContent = businessName
        .replace(/^JR\s*/i, "")
        .trim() || "ELECTRICIDAD";
    });

    setText(
      ".footer-brand small",
      "Electricista Matriculado · Cat. 3"
    );

    const whatsappDigits = normalizePhone(whatsapp);

    if (whatsappDigits) {
      setLinks(
        'a[href*="wa.me/"]',
        "https://wa.me/" + whatsappDigits
      );
    }

    if (phone) {
      setLinks(
        'a[href^="tel:"]',
        "tel:" + normalizePhone(phone),
        phone
      );
    }

    if (email) {
      setLinks(
        'a[href^="mailto:"]',
        "mailto:" + email,
        email
      );
    }

    const contactText = [
      phone ? "📞 " + phone : "",
      email ? "✉️ " + email : "",
      address ? "📍 " + address : "",
      city ? city : "",
      hours ? "🕒 " + hours : ""
    ].filter(Boolean).join(" · ");

    if (contactText) {
      setText("[data-business-contact]", contactText);
    }

    if (logoUrl) {
      document.querySelectorAll(
        "[data-business-logo]"
      ).forEach(el => {
        if (el.tagName === "IMG") {
          el.src = logoUrl;
          el.alt = businessName;
        } else {
          el.style.backgroundImage =
            "url(" + JSON.stringify(logoUrl) + ")";
        }
      });
    }

    document.querySelectorAll(
      "[data-business-name]"
    ).forEach(el => {
      el.textContent = businessName;
    });

  } catch (error) {
    console.warn(
      "No se pudo cargar la configuración pública del negocio:",
      error
    );
  }
})();
