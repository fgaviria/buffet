import { useState, useEffect, useRef } from "react";

// ── CONFIGURACIÓN ─────────────────────────────────────────────
// Pegá acá la URL de tu Google Apps Script Web App
const APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbwKjxp7oBWUIYePHKPiUyD_up9Y4fnJo7PtCMDU2FGIw3oMefF8Xie7ffNOihOXRSGa/exec";

const MENU = [
  { id: 1, name: "Sándwich de milanesa",   price: 1200, desc: "Con lechuga y tomate",       emoji: "🥪" },
  { id: 2, name: "Sándwich de jamón y queso", price: 900, desc: "En pan de molde tostado",  emoji: "🫓" },
  { id: 3, name: "Empanada x3",            price: 700,  desc: "Carne, pollo o caprese",     emoji: "🫔" },
  { id: 4, name: "Porción de pizza",       price: 850,  desc: "Muzzarella o especial",      emoji: "🍕" },
  { id: 5, name: "Gaseosa 500ml",          price: 500,  desc: "Coca, Sprite o Fanta",       emoji: "🥤" },
  { id: 6, name: "Agua mineral",           price: 350,  desc: "Con o sin gas",              emoji: "💧" },
  { id: 7, name: "Combo familiar",         price: 2800, desc: "2 sándwiches + 2 bebidas",   emoji: "🧺" },
];
const DISCOUNT = 0.15;
const PIN = "1928";
const LOCAL_KEY = "kiosko_v3_orders";
const LOCAL_META = "kiosko_v3_meta";

function fmt(n) {
  return new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 }).format(n);
}

// ── API helpers ───────────────────────────────────────────────
async function apiPost(payload) {
  const r = await fetch(APPS_SCRIPT_URL, {
    method: "POST",
    body: JSON.stringify(payload),
    headers: { "Content-Type": "text/plain" }, // Apps Script requiere text/plain para evitar preflight CORS
  });
  return r.json();
}

async function fileToBase64(file) {
  return new Promise((res, rej) => {
    const reader = new FileReader();
    reader.onload = () => res(reader.result.split(",")[1]);
    reader.onerror = rej;
    reader.readAsDataURL(file);
  });
}

// ── Local storage helpers ─────────────────────────────────────
function loadLocal() {
  try { return JSON.parse(localStorage.getItem(LOCAL_KEY) || "[]"); } catch { return []; }
}
function saveLocal(orders) {
  try { localStorage.setItem(LOCAL_KEY, JSON.stringify(orders)); } catch {}
}
function loadMeta() {
  try { return JSON.parse(localStorage.getItem(LOCAL_META) || "{}"); } catch { return {}; }
}
function saveMeta(meta) {
  try { localStorage.setItem(LOCAL_META, JSON.stringify(meta)); } catch {}
}

// ─────────────────────────────────────────────────────────────
export default function App() {
  const [view, setView]           = useState("home");
  const [orders, setOrders]       = useState(loadLocal);
  const [cart, setCart]           = useState({});
  const [name, setName]           = useState("");
  const [phone, setPhone]         = useState("");
  const [file, setFile]           = useState(null);
  const [fileName, setFileName]   = useState("");
  const [submitted, setSubmitted] = useState(null);
  const [search, setSearch]       = useState("");
  const [result, setResult]       = useState(null);
  const [searched, setSearched]   = useState(false);
  const [confirm, setConfirm]     = useState(null);
  const [toast, setToast]         = useState(null);
  const [pin, setPin]             = useState("");
  const [unlocked, setUnlocked]   = useState(false);
  const [loading, setLoading]     = useState(false);
  const [backendStatus, setBackendStatus] = useState(loadMeta().backendOk ? "ok" : "unknown");
  const [backendUrls, setBackendUrls]     = useState(loadMeta());

  useEffect(() => { saveLocal(orders); }, [orders]);

  function showToast(msg, type = "ok") {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  }

  // ── Carrito ──
  const addItem    = (id) => setCart(c => ({ ...c, [id]: (c[id] || 0) + 1 }));
  const removeItem = (id) => setCart(c => { const n = { ...c }; n[id] > 1 ? n[id]-- : delete n[id]; return n; });
  const cartItems  = () => Object.entries(cart).filter(([, q]) => q > 0).map(([id, qty]) => ({ ...MENU.find(m => m.id === +id), qty }));
  const rawTotal   = cartItems().reduce((s, i) => s + i.price * i.qty, 0);
  const discTotal  = Math.round(rawTotal * (1 - DISCOUNT));
  const nextNumber = () => orders.reduce((m, o) => Math.max(m, o.number || 0), 0) + 1;

  // ── Inicializar backend ──
  async function initBackend() {
    setLoading(true);
    try {
      const res = await apiPost({ action: "init" });
      if (res.ok) {
        const meta = { backendOk: true, spreadsheetUrl: res.spreadsheetUrl, folderUrl: res.folderUrl };
        saveMeta(meta);
        setBackendUrls(meta);
        setBackendStatus("ok");
        showToast("Backend inicializado correctamente ✓");
      } else {
        showToast("Error: " + res.error, "err");
      }
    } catch (e) {
      showToast("No se pudo conectar con el backend", "err");
    }
    setLoading(false);
  }

  // ── Cargar pedidos desde Sheets ──
  async function syncOrders() {
    setLoading(true);
    try {
      const res = await fetch(`${APPS_SCRIPT_URL}?action=getOrders`);
      const data = await res.json();
      if (data.ok && data.orders.length > 0) {
        // Merge: mantiene datos locales, actualiza estados desde Sheets
        const merged = data.orders.map(remote => {
          const local = orders.find(o => String(o.number) === String(remote.number));
          return local ? { ...local, delivered: remote.delivered } : {
            number: remote.number, name: remote.name, phone: remote.phone,
            items: remote.itemsStr.split(", ").map(s => { const [qty, ...rest] = s.split("x "); return { name: rest.join("x ").trim(), qty: +qty }; }),
            total: remote.total, fileName: "", fileUrl: remote.fileUrl, delivered: remote.delivered, at: remote.at
          };
        });
        setOrders(merged);
        showToast(`${merged.length} pedidos sincronizados`);
      } else {
        showToast("Sin pedidos en Sheets todavía");
      }
    } catch (e) {
      showToast("Error al sincronizar", "err");
    }
    setLoading(false);
  }

  // ── Enviar pedido ──
  async function submitOrder() {
    if (!name.trim())        { showToast("Ingresá tu nombre", "err"); return; }
    if (!cartItems().length) { showToast("Agregá al menos un ítem", "err"); return; }
    if (!file)               { showToast("Adjuntá el comprobante", "err"); return; }

    setLoading(true);
    const number = nextNumber();

    try {
      const base64 = await fileToBase64(file);
      const res = await apiPost({
        action: "submitOrder",
        number, name: name.trim(), phone: phone.trim(),
        items: cartItems(), total: discTotal,
        fileData: base64, fileName: file.name, fileType: file.type,
      });

      if (!res.ok) throw new Error(res.error || "Error desconocido");

      const newOrder = {
        number, name: name.trim(), phone: phone.trim(),
        items: cartItems(), total: discTotal,
        fileName: file.name, fileUrl: res.fileUrl || "",
        delivered: false, at: new Date().toISOString(),
      };
      setOrders(prev => [...prev, newOrder]);
      setSubmitted(newOrder);
      setCart({}); setName(""); setPhone(""); setFile(null); setFileName("");
      setView("done");
    } catch (e) {
      // Fallback: guarda local si falla la red
      const newOrder = {
        number, name: name.trim(), phone: phone.trim(),
        items: cartItems(), total: discTotal,
        fileName: file.name, fileUrl: "", delivered: false,
        at: new Date().toISOString(), pendingSync: true,
      };
      setOrders(prev => [...prev, newOrder]);
      setSubmitted(newOrder);
      setCart({}); setName(""); setPhone(""); setFile(null); setFileName("");
      setView("done");
      showToast("Sin conexión — pedido guardado localmente", "warn");
    }
    setLoading(false);
  }

  // ── Marcar entregado ──
  async function confirmDeliver() {
    const o = confirm;
    setConfirm(null);
    const updated = orders.map(x => x.number === o.number ? { ...x, delivered: true } : x);
    setOrders(updated);
    if (result && !result.multi) setResult(prev => ({ ...prev, delivered: true }));

    try {
      const res = await apiPost({ action: "markDelivered", number: o.number });
      if (!res.ok) throw new Error(res.error);
      showToast(`Pedido #${o.number} entregado y sincronizado ✓`);
    } catch {
      showToast(`Pedido #${o.number} entregado (sin sync)`, "warn");
    }
  }

  // ── Búsqueda ──
  function doSearch() {
    setSearched(true);
    const q = search.trim();
    if (!q) { setResult(null); return; }
    const byNum  = orders.find(o => String(o.number) === q);
    if (byNum) { setResult(byNum); return; }
    const byName = orders.filter(o => o.name.toLowerCase().includes(q.toLowerCase()));
    if (byName.length === 1) { setResult(byName[0]); return; }
    if (byName.length > 1)   { setResult({ multi: byName }); return; }
    setResult(null);
  }

  // ── Estilos ──
  const S = {
    wrap:      { maxWidth: 500, margin: "0 auto", padding: "14px 14px 70px", fontFamily: "var(--font-sans)" },
    hdr:       { display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 18, paddingBottom: 12, borderBottom: "0.5px solid var(--color-border-tertiary)" },
    card:      { background: "var(--color-background-primary)", border: "0.5px solid var(--color-border-tertiary)", borderRadius: 12, padding: "12px 14px", marginBottom: 8 },
    input:     { width: "100%", padding: "9px 11px", fontSize: 14, border: "0.5px solid var(--color-border-secondary)", borderRadius: 8, background: "var(--color-background-secondary)", color: "var(--color-text-primary)", boxSizing: "border-box" },
    sec:       { marginBottom: 18 },
    secTitle:  { fontSize: 11, fontWeight: 500, color: "var(--color-text-secondary)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 },
    div:       { borderTop: "0.5px solid var(--color-border-tertiary)", margin: "12px 0" },
    navBtn:    (a) => ({ padding: "6px 12px", fontSize: 13, fontWeight: a ? 500 : 400, background: a ? "var(--color-background-info)" : "transparent", color: a ? "var(--color-text-info)" : "var(--color-text-secondary)", border: "0.5px solid " + (a ? "var(--color-border-info)" : "var(--color-border-tertiary)"), borderRadius: 8, cursor: "pointer" }),
    qBtn:      { width: 28, height: 28, borderRadius: "50%", border: "0.5px solid var(--color-border-secondary)", background: "var(--color-background-secondary)", color: "var(--color-text-primary)", cursor: "pointer", fontSize: 18, lineHeight: "28px", textAlign: "center" },
    primBtn:   { padding: "10px 18px", fontSize: 14, fontWeight: 500, cursor: "pointer", borderRadius: 8, background: "#185FA5", color: "white", border: "none" },
    ghostBtn:  { padding: "8px 14px", fontSize: 13, cursor: "pointer", borderRadius: 8, background: "transparent", color: "var(--color-text-secondary)", border: "0.5px solid var(--color-border-secondary)" },
    greenBtn:  { padding: "8px 14px", fontSize: 13, fontWeight: 500, cursor: "pointer", borderRadius: 8, background: "#0F6E56", color: "white", border: "none" },
    warnBanner: (type) => ({
      background: type === "err" ? "var(--color-background-danger)" : type === "warn" ? "var(--color-background-warning)" : "var(--color-background-success)",
      border: "0.5px solid " + (type === "err" ? "var(--color-border-danger)" : type === "warn" ? "var(--color-border-warning)" : "var(--color-border-success)"),
      borderRadius: 8, padding: "9px 12px", fontSize: 13,
      color: type === "err" ? "var(--color-text-danger)" : type === "warn" ? "var(--color-text-warning)" : "var(--color-text-success)",
    }),
  };

  function Badge({ delivered, pendingSync }) {
    if (pendingSync) return <span style={{ display: "inline-block", padding: "3px 9px", borderRadius: 8, fontSize: 12, fontWeight: 500, background: "var(--color-background-warning)", color: "var(--color-text-warning)" }}>⏳ Sin sync</span>;
    return <span style={{ display: "inline-block", padding: "3px 9px", borderRadius: 8, fontSize: 12, fontWeight: 500, background: delivered ? "var(--color-background-success)" : "var(--color-background-warning)", color: delivered ? "var(--color-text-success)" : "var(--color-text-warning)" }}>{delivered ? "✓ Entregado" : "Pendiente"}</span>;
  }

  function OCard({ o, big }) {
    return (
      <div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <div style={{ fontSize: big ? 26 : 17, fontWeight: 500, color: "var(--color-text-primary)" }}>#{o.number}</div>
            <div style={{ fontSize: 13, color: "var(--color-text-secondary)", marginTop: 1 }}>{o.name}{o.phone ? ` · ${o.phone}` : ""}</div>
          </div>
          <Badge delivered={o.delivered} pendingSync={o.pendingSync} />
        </div>
        <div style={{ marginTop: 5, fontSize: 12, color: "var(--color-text-secondary)" }}>
          {o.items?.map(i => `${i.qty}x ${i.name}`).join(" · ") || o.itemsStr}
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 8 }}>
          <div>
            <span style={{ fontSize: 13, fontWeight: 500, color: "var(--color-text-primary)" }}>{fmt(o.total)}</span>
            {o.fileUrl && <a href={o.fileUrl} target="_blank" rel="noreferrer" style={{ fontSize: 11, color: "var(--color-text-info)", marginLeft: 10 }}>📎 Ver comprobante</a>}
          </div>
          {!o.delivered && <button style={S.greenBtn} onClick={() => setConfirm(o)}>Marcar entregado</button>}
        </div>
      </div>
    );
  }

  return (
    <div style={S.wrap}>
      {toast && (
        <div style={{ position: "fixed", bottom: 16, left: "50%", transform: "translateX(-50%)", padding: "9px 18px", borderRadius: 8, fontSize: 13, fontWeight: 500, zIndex: 999, background: toast.type === "ok" ? "#0F6E56" : toast.type === "warn" ? "#B45309" : "#A32D2D", color: "white", whiteSpace: "nowrap" }}>
          {toast.msg}
        </div>
      )}

      {confirm && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 900 }}>
          <div style={{ background: "var(--color-background-primary)", borderRadius: 12, border: "0.5px solid var(--color-border-tertiary)", padding: "24px 20px", maxWidth: 320, width: "90%", textAlign: "center" }}>
            <div style={{ fontSize: 22, fontWeight: 500, marginBottom: 6, color: "var(--color-text-primary)" }}>¿Confirmar entrega?</div>
            <div style={{ fontSize: 15, color: "var(--color-text-secondary)", marginBottom: 4 }}>Pedido <strong>#{confirm.number}</strong></div>
            <div style={{ fontSize: 15, color: "var(--color-text-primary)", marginBottom: 18 }}>{confirm.name}</div>
            <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
              <button style={S.ghostBtn} onClick={() => setConfirm(null)}>Cancelar</button>
              <button style={S.greenBtn} onClick={confirmDeliver}>Confirmar entrega</button>
            </div>
          </div>
        </div>
      )}

      {/* ── HEADER ── */}
      <div style={S.hdr}>
        <div>
          <div style={{ fontSize: 17, fontWeight: 500, color: "var(--color-text-primary)" }}>Kiosko Escolar</div>
          <div style={{ fontSize: 12, color: "var(--color-text-secondary)", marginTop: 1 }}>Evento del colegio</div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button style={S.navBtn(view === "home" || view === "done")} onClick={() => setView("home")}>Pedir</button>
          <button style={S.navBtn(view === "kiosk")} onClick={() => { setView("kiosk"); setSearch(""); setResult(null); setSearched(false); }}>Kiosco</button>
          <button style={S.navBtn(view === "config")} onClick={() => setView("config")}>⚙</button>
        </div>
      </div>

      {/* ── VISTA CLIENTE ── */}
      {view === "home" && (
        <>
          <div style={{ ...S.warnBanner("ok"), marginBottom: 16 }}>
            🎉 {Math.round(DISCOUNT * 100)}% de descuento — ¡pagá anticipado y ahorrá!
          </div>

          <div style={S.sec}>
            <div style={S.secTitle}>Menú</div>
            {MENU.map(item => {
              const qty  = cart[item.id] || 0;
              const disc = Math.round(item.price * (1 - DISCOUNT));
              return (
                <div key={item.id} style={S.card}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 14, fontWeight: 500, color: "var(--color-text-primary)" }}>{item.emoji} {item.name}</div>
                      <div style={{ fontSize: 12, color: "var(--color-text-secondary)", marginTop: 2 }}>{item.desc}</div>
                      <div style={{ marginTop: 5, display: "flex", gap: 7, alignItems: "baseline" }}>
                        <span style={{ fontSize: 14, fontWeight: 500, color: "#185FA5" }}>{fmt(disc)}</span>
                        <span style={{ fontSize: 11, color: "var(--color-text-tertiary)", textDecoration: "line-through" }}>{fmt(item.price)}</span>
                      </div>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      {qty > 0 && <button style={S.qBtn} onClick={() => removeItem(item.id)}>−</button>}
                      {qty > 0 && <span style={{ fontSize: 14, fontWeight: 500, minWidth: 16, textAlign: "center" }}>{qty}</span>}
                      <button style={S.qBtn} onClick={() => addItem(item.id)}>+</button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {cartItems().length > 0 && (
            <div style={{ ...S.card, border: "2px solid var(--color-border-info)", background: "var(--color-background-info)", marginBottom: 16 }}>
              <div style={{ fontSize: 13, fontWeight: 500, color: "var(--color-text-info)", marginBottom: 8 }}>Tu pedido</div>
              {cartItems().map(i => (
                <div key={i.id} style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 3, color: "var(--color-text-primary)" }}>
                  <span>{i.qty}x {i.name}</span>
                  <span>{fmt(Math.round(i.price * i.qty * (1 - DISCOUNT)))}</span>
                </div>
              ))}
              <div style={S.div} />
              <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 500, fontSize: 14, color: "var(--color-text-info)" }}>
                <span>Total con descuento</span><span>{fmt(discTotal)}</span>
              </div>
            </div>
          )}

          <div style={S.sec}>
            <div style={S.secTitle}>Tus datos</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <input style={S.input} placeholder="Nombre y apellido *" value={name} onChange={e => setName(e.target.value)} />
              <input style={S.input} placeholder="Teléfono (opcional)" value={phone} onChange={e => setPhone(e.target.value)} />
            </div>
          </div>

          <div style={S.sec}>
            <div style={S.secTitle}>Comprobante de pago</div>
            <div style={{ ...S.card, textAlign: "center", cursor: "pointer" }} onClick={() => document.getElementById("fi").click()}>
              {fileName
                ? <><div style={{ fontSize: 18, marginBottom: 3 }}>📎</div><div style={{ fontSize: 13, color: "var(--color-text-info)", fontWeight: 500 }}>{fileName}</div></>
                : <><div style={{ fontSize: 18, marginBottom: 3 }}>📤</div><div style={{ fontSize: 13, color: "var(--color-text-secondary)" }}>Adjuntar comprobante de MercadoPago</div><div style={{ fontSize: 11, color: "var(--color-text-tertiary)", marginTop: 2 }}>JPG, PNG o PDF</div></>
              }
              <input id="fi" type="file" accept="image/*,.pdf" style={{ display: "none" }} onChange={e => { const f = e.target.files[0]; if (f) { setFile(f); setFileName(f.name); } }} />
            </div>
          </div>

          <button
            style={{ ...S.primBtn, width: "100%", padding: "12px 0", fontSize: 15, opacity: loading ? 0.6 : 1 }}
            onClick={submitOrder} disabled={loading}
          >
            {loading ? "Enviando pedido…" : "Confirmar pedido →"}
          </button>
        </>
      )}

      {/* ── CONFIRMACIÓN ── */}
      {view === "done" && submitted && (
        <div style={{ textAlign: "center", padding: "24px 0" }}>
          <div style={{ fontSize: 42, marginBottom: 10 }}>✅</div>
          <div style={{ fontSize: 19, fontWeight: 500, color: "var(--color-text-primary)", marginBottom: 4 }}>¡Pedido confirmado!</div>
          <div style={{ fontSize: 13, color: "var(--color-text-secondary)", marginBottom: 6 }}>Guardá tu número de pedido</div>
          <div style={{ fontSize: 56, fontWeight: 500, color: "#185FA5", margin: "10px 0 14px" }}>#{submitted.number}</div>
          <div style={S.card}>
            <div style={{ fontSize: 12, color: "var(--color-text-secondary)", marginBottom: 8 }}>Detalle</div>
            {submitted.items.map(i => (
              <div key={i.id} style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 3, color: "var(--color-text-primary)" }}>
                <span>{i.qty}x {i.name}</span>
                <span>{fmt(Math.round(i.price * i.qty * (1 - DISCOUNT)))}</span>
              </div>
            ))}
            <div style={S.div} />
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14, fontWeight: 500, color: "var(--color-text-primary)" }}>
              <span>Total pagado</span><span>{fmt(submitted.total)}</span>
            </div>
            {submitted.fileUrl
              ? <div style={{ fontSize: 11, color: "var(--color-text-success)", marginTop: 6 }}>📎 Comprobante subido a Drive</div>
              : <div style={{ fontSize: 11, color: "var(--color-text-warning)", marginTop: 6 }}>⏳ {submitted.fileName} (se subirá al sincronizar)</div>
            }
          </div>
          <div style={{ ...S.warnBanner("warn"), marginTop: 10 }}>
            Presentá el número <strong>#{submitted.number}</strong> en el kiosco el día del evento
          </div>
          <button style={{ ...S.ghostBtn, marginTop: 14 }} onClick={() => setView("home")}>Hacer otro pedido</button>
        </div>
      )}

      {/* ── KIOSCO — LOGIN ── */}
      {view === "kiosk" && !unlocked && (
        <div style={{ textAlign: "center", padding: "40px 0" }}>
          <div style={{ fontSize: 36, marginBottom: 10 }}>🔒</div>
          <div style={{ fontSize: 16, fontWeight: 500, marginBottom: 4, color: "var(--color-text-primary)" }}>Acceso al kiosco</div>
          <div style={{ fontSize: 13, color: "var(--color-text-secondary)", marginBottom: 20 }}>Ingresá el PIN para continuar</div>
          <input type="password" style={{ ...S.input, textAlign: "center", letterSpacing: 8, fontSize: 20, maxWidth: 160, display: "block", margin: "0 auto 14px" }}
            placeholder="••••" maxLength={4} value={pin} onChange={e => setPin(e.target.value)}
            onKeyDown={e => e.key === "Enter" && (pin === PIN ? setUnlocked(true) : showToast("PIN incorrecto", "err"))} />
          <button style={S.primBtn} onClick={() => pin === PIN ? setUnlocked(true) : showToast("PIN incorrecto", "err")}>Ingresar</button>
          <div style={{ fontSize: 11, color: "var(--color-text-tertiary)", marginTop: 10 }}>PIN de demo: 1234</div>
        </div>
      )}

      {/* ── KIOSCO — PANEL ── */}
      {view === "kiosk" && unlocked && (
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
            <div>
              <div style={{ fontSize: 15, fontWeight: 500, color: "var(--color-text-primary)" }}>Panel del kiosco</div>
              <div style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>{orders.length} pedidos · {orders.filter(o => o.delivered).length} entregados</div>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button style={{ ...S.ghostBtn, fontSize: 12 }} onClick={syncOrders} disabled={loading}>{loading ? "…" : "↻ Sync"}</button>
              <button style={{ ...S.ghostBtn, fontSize: 12 }} onClick={() => { setUnlocked(false); setPin(""); }}>Salir</button>
            </div>
          </div>

          {backendStatus !== "ok" && (
            <div style={{ ...S.warnBanner("warn"), marginBottom: 12, fontSize: 12 }}>
              ⚠ Backend no configurado — los pedidos se guardan solo localmente. Configurá el Apps Script en ⚙
            </div>
          )}

          <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
            <input style={{ ...S.input, flex: 1 }} placeholder="Buscar por número o nombre…" value={search}
              onChange={e => setSearch(e.target.value)} onKeyDown={e => e.key === "Enter" && doSearch()} />
            <button style={S.primBtn} onClick={doSearch}>Buscar</button>
          </div>

          {searched && !result && <div style={{ ...S.card, textAlign: "center", color: "var(--color-text-secondary)", fontSize: 13 }}>No se encontraron pedidos</div>}

          {result?.multi && (
            <div>
              <div style={{ fontSize: 12, color: "var(--color-text-secondary)", marginBottom: 6 }}>{result.multi.length} resultados:</div>
              {result.multi.map(o => <div key={o.number} style={S.card}><OCard o={o} big={false} /></div>)}
            </div>
          )}

          {result && !result.multi && (
            <div style={{ ...S.card, border: result.delivered ? "0.5px solid var(--color-border-success)" : "2px solid var(--color-border-info)", marginBottom: 12 }}>
              <OCard o={result} big={true} />
            </div>
          )}

          <div style={S.div} />
          <div style={{ ...S.secTitle, marginBottom: 8 }}>Todos los pedidos</div>
          {orders.length === 0 && <div style={{ fontSize: 13, color: "var(--color-text-tertiary)" }}>Aún no hay pedidos</div>}
          {[...orders].reverse().map(o => (
            <div key={o.number} style={{ ...S.card, opacity: o.delivered ? 0.65 : 1 }}>
              <OCard o={o} big={false} />
            </div>
          ))}
        </div>
      )}

      {/* ── CONFIG ── */}
      {view === "config" && (
        <div>
          <div style={{ fontSize: 16, fontWeight: 500, color: "var(--color-text-primary)", marginBottom: 16 }}>Configuración del backend</div>

          <div style={S.card}>
            <div style={{ fontSize: 13, fontWeight: 500, color: "var(--color-text-primary)", marginBottom: 6 }}>Estado del backend</div>
            <div style={{ fontSize: 13, color: backendStatus === "ok" ? "var(--color-text-success)" : "var(--color-text-warning)" }}>
              {backendStatus === "ok" ? "✓ Conectado a Google Apps Script" : "⚠ Sin configurar"}
            </div>
            {backendUrls.spreadsheetUrl && (
              <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 4 }}>
                <a href={backendUrls.spreadsheetUrl} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: "var(--color-text-info)" }}>📊 Ver Google Sheet</a>
                <a href={backendUrls.folderUrl} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: "var(--color-text-info)" }}>📁 Ver carpeta en Drive</a>
              </div>
            )}
          </div>

          <div style={{ ...S.card, background: "var(--color-background-secondary)" }}>
            <div style={{ fontSize: 13, fontWeight: 500, color: "var(--color-text-primary)", marginBottom: 8 }}>Pasos para configurar</div>
            <ol style={{ fontSize: 12, color: "var(--color-text-secondary)", paddingLeft: 16, lineHeight: 1.8 }}>
              <li>Abrí <a href="https://script.google.com" target="_blank" rel="noreferrer" style={{ color: "var(--color-text-info)" }}>script.google.com</a> con la cuenta Gmail del evento</li>
              <li>Creá un nuevo proyecto y pegá el código de <code>Code.gs</code></li>
              <li>Implementar → Nueva implementación → Aplicación web</li>
              <li>Ejecutar como: <strong>Yo</strong> · Acceso: <strong>Cualquier persona</strong></li>
              <li>Copiá la URL del Web App y editá <code>APPS_SCRIPT_URL</code> en esta app</li>
              <li>Tocá el botón de abajo para inicializar</li>
            </ol>
          </div>

          <button
            style={{ ...S.primBtn, width: "100%", padding: "12px 0", opacity: loading ? 0.6 : 1 }}
            onClick={initBackend} disabled={loading}
          >
            {loading ? "Inicializando…" : "Inicializar backend en Google"}
          </button>

          <div style={{ marginTop: 12, fontSize: 11, color: "var(--color-text-tertiary)" }}>
            Esto crea automáticamente la Google Sheet y la carpeta en Drive de la cuenta del evento.
          </div>
        </div>
      )}
    </div>
  );
}
