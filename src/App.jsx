import { useState, useEffect, useMemo, useCallback } from "react";
import { db, auth, googleProvider, ref, onValue, set, remove, update, signInWithPopup, signOut, onAuthStateChanged } from "./firebase";

// ─── Constants ───
const ST = [
  { k: "DANG_VE", l: "Đang vẽ", c: "#6366F1", bg: "#EEF2FF" },
  { k: "CHO_REVIEW", l: "Chờ review", c: "#D97706", bg: "#FEF3C7" },
  { k: "DA_NOP", l: "Đã nộp", c: "#2563EB", bg: "#DBEAFE" },
  { k: "CHO_DUYET", l: "Chờ duyệt", c: "#7C3AED", bg: "#EDE9FE" },
  { k: "DA_DUYET", l: "Đã duyệt", c: "#059669", bg: "#D1FAE5" },
  { k: "REJECT", l: "Reject", c: "#DC2626", bg: "#FEE2E2" },
  { k: "DUYET_GC", l: "Duyệt có GC", c: "#0891B2", bg: "#CFFAFE" },
  { k: "TAI_NOP", l: "Tái nộp", c: "#EA580C", bg: "#FFEDD5" },
];
const RC = {
  late: { l: "Trễ hạn", c: "#DC2626", bg: "#FEE2E2", i: "🔴" },
  high: { l: "Nguy cơ cao", c: "#EA580C", bg: "#FFEDD5", i: "🟠" },
  med: { l: "Cần chú ý", c: "#D97706", bg: "#FEF3C7", i: "🟡" },
  ok: { l: "Đúng tiến độ", c: "#059669", bg: "#D1FAE5", i: "🟢" },
  done: { l: "Hoàn thành", c: "#6B7280", bg: "#F3F4F6", i: "✅" },
  reject: { l: "Reject", c: "#DC2626", bg: "#FEE2E2", i: "❌" },
  none: { l: "Chưa KH", c: "#9CA3AF", bg: "#F9FAFB", i: "⚪" },
};

// ─── Helpers ───
const td = () => new Date().toISOString().split("T")[0];
const ad = (d, n) => { if (!d) return ""; const x = new Date(d); x.setDate(x.getDate() + n); return x.toISOString().split("T")[0]; };
const dd = (a, b) => { if (!a || !b) return null; return Math.round((new Date(a) - new Date(b)) / 864e5); };
const fm = d => { if (!d) return "—"; const p = d.split("-"); return `${p[2]}/${p[1]}`; };

function rsk(it) {
  if (["DA_DUYET", "DUYET_GC"].includes(it.status)) return "done";
  if (it.status === "REJECT") return "reject";
  if (!it.planDate) return "none";
  if (it.actualDate) return dd(it.actualDate, it.planDate) > 0 ? "late" : "ok";
  const d = dd(it.planDate, td());
  if (d < 0) return "late"; if (d <= 3) return "high"; if (d <= 7) return "med"; return "ok";
}
function ld(it) {
  if (["DA_DUYET", "DUYET_GC"].includes(it.status)) return null;
  if (it.actualDate && it.planDate) { const d = dd(it.actualDate, it.planDate); return d > 0 ? d : 0; }
  if (!it.actualDate && it.planDate) { const d = dd(td(), it.planDate); return d > 0 ? d : 0; }
  return null;
}

// ─── Sample Data ───
function samples() {
  const d = n => ad(td(), n);
  return [
    { id: "s1", type: "SD", code: "SD-KC-001", name: "MB cốp pha sàn T5 — Block A", block: "Block A", floor: "T5", cat: "Kết cấu", who: "Nguyễn Văn Hùng", sub: "Trương Thanh Tân", status: "DA_DUYET", planDate: d(-20), actualDate: d(-19), offset: 7, rev: 0, links: ["r1"], notes: [{ id: "n1", t: "Phối hợp MEP ok — không xung đột", d: d(-21), h: "09:30" }, { id: "n2", t: "TVTK confirm cao độ +14.200", d: d(-19), h: "14:15" }] },
    { id: "s2", type: "SD", code: "SD-KC-002", name: "Chi tiết thép sàn T5 — Block A", block: "Block A", floor: "T5", cat: "Kết cấu", who: "Nguyễn Văn Hùng", sub: "Trương Thanh Tân", status: "DUYET_GC", planDate: d(-15), actualDate: d(-14), offset: 7, rev: 1, links: [], notes: [{ id: "n3", t: "Comment: bổ sung thép gia cường lỗ mở >300mm", d: d(-8), h: "10:00" }, { id: "n4", t: "Rev1: đã bổ sung chi tiết gia cường", d: d(-5), h: "16:30" }] },
    { id: "s3", type: "SD", code: "SD-KC-003", name: "MB cốp pha sàn T6 — Block A", block: "Block A", floor: "T6", cat: "Kết cấu", who: "Nguyễn Văn Hùng", sub: "Trương Thanh Tân", status: "CHO_DUYET", planDate: d(-5), actualDate: d(-4), offset: 7, rev: 0, links: [], notes: [] },
    { id: "s4", type: "SD", code: "SD-KC-004", name: "Chi tiết thép sàn T6 — Block A", block: "Block A", floor: "T6", cat: "Kết cấu", who: "Trần Minh Đức", sub: "Trương Thanh Tân", status: "DANG_VE", planDate: d(2), actualDate: "", offset: 7, rev: 0, links: ["r3"], notes: [{ id: "n5", t: "Chờ RFI-003 confirm lỗ thang máy", d: d(-1), h: "08:45" }] },
    { id: "s5", type: "SD", code: "SD-KC-005", name: "Chi tiết dầm T7 — Block A", block: "Block A", floor: "T7", cat: "Kết cấu", who: "Trần Minh Đức", sub: "Trương Thanh Tân", status: "DANG_VE", planDate: d(10), actualDate: "", offset: 7, rev: 0, links: [], notes: [] },
    { id: "s6", type: "SD", code: "SD-KT-001", name: "MB tường xây T3 — Block A", block: "Block A", floor: "T3", cat: "Kiến trúc", who: "Lê Thị Mai", sub: "Trương Thanh Tân", status: "REJECT", planDate: d(-12), actualDate: d(-11), offset: 5, rev: 0, links: ["r2"], notes: [{ id: "n6", t: "Reject: sai kích thước cửa sổ 1000x1400 thay vì 1200x1400", d: d(-5), h: "11:20" }] },
    { id: "s7", type: "SD", code: "SD-KT-002", name: "MB tường xây T3 — Block A (Rev1)", block: "Block A", floor: "T3", cat: "Kiến trúc", who: "Lê Thị Mai", sub: "Trương Thanh Tân", status: "TAI_NOP", planDate: d(-3), actualDate: d(-2), offset: 5, rev: 1, links: ["s6", "r2"], notes: [{ id: "n7", t: "Đã sửa kích thước cửa theo KT rev3", d: d(-2), h: "09:00" }] },
    { id: "s8", type: "SD", code: "SD-KT-003", name: "Chi tiết ốp lát WC T4 — Block A", block: "Block A", floor: "T4", cat: "Kiến trúc", who: "Lê Thị Mai", sub: "Trương Thanh Tân", status: "CHO_REVIEW", planDate: d(1), actualDate: "", offset: 5, rev: 0, links: [], notes: [{ id: "n8", t: "Chờ confirm mẫu gạch từ CĐT", d: d(0), h: "15:00" }] },
    { id: "s9", type: "SD", code: "SD-KC-006", name: "MB cốp pha sàn T3 — Block B", block: "Block B", floor: "T3", cat: "Kết cấu", who: "Phạm Quốc Bảo", sub: "Trương Thanh Tân", status: "DA_DUYET", planDate: d(-25), actualDate: d(-26), offset: 7, rev: 0, links: [], notes: [] },
    { id: "s10", type: "SD", code: "SD-KC-007", name: "Chi tiết thép vách T3 — Block B", block: "Block B", floor: "T3", cat: "Kết cấu", who: "Phạm Quốc Bảo", sub: "Trương Thanh Tân", status: "DA_NOP", planDate: d(-8), actualDate: d(-6), offset: 7, rev: 0, links: [], notes: [{ id: "n9", t: "Nộp trễ 2 ngày — chờ phối hợp MEP", d: d(-6), h: "17:30" }] },
    { id: "s11", type: "SD", code: "SD-KC-008", name: "MB cốp pha sàn T4 — Block B", block: "Block B", floor: "T4", cat: "Kết cấu", who: "Phạm Quốc Bảo", sub: "Trương Thanh Tân", status: "DANG_VE", planDate: d(-2), actualDate: "", offset: 7, rev: 0, links: [], notes: [{ id: "n10", t: "⚠️ Trễ 2 ngày — Bảo đang làm song song vách T3", d: d(0), h: "08:00" }] },
    { id: "s12", type: "SD", code: "SD-MEP-001", name: "MB PCCC T2 — Block B", block: "Block B", floor: "T2", cat: "MEP", who: "Võ Hoàng Long", sub: "Trương Thanh Tân", status: "DA_DUYET", planDate: d(-18), actualDate: d(-20), offset: 5, rev: 0, links: [], notes: [] },
    { id: "s13", type: "SD", code: "SD-MEP-002", name: "MB điện T3 — Block B", block: "Block B", floor: "T3", cat: "MEP", who: "Võ Hoàng Long", sub: "Trương Thanh Tân", status: "CHO_DUYET", planDate: d(-7), actualDate: d(-6), offset: 5, rev: 0, links: ["r4"], notes: [{ id: "n11", t: "Đã phối hợp KC — tránh xuyên dầm chính", d: d(-7), h: "14:00" }] },
    { id: "s14", type: "SD", code: "SD-MEP-003", name: "MB cấp thoát nước T3 — Block B", block: "Block B", floor: "T3", cat: "MEP", who: "Võ Hoàng Long", sub: "Trương Thanh Tân", status: "DANG_VE", planDate: d(5), actualDate: "", offset: 5, rev: 0, links: [], notes: [] },
    { id: "s15", type: "SD", code: "SD-KC-009", name: "MB cốp pha hầm B1 — Block C", block: "Block C", floor: "B1", cat: "Kết cấu", who: "Trần Minh Đức", sub: "Trương Thanh Tân", status: "DA_NOP", planDate: d(-10), actualDate: d(-10), offset: 7, rev: 0, links: ["r5"], notes: [] },
    { id: "r1", type: "RFI", code: "RFI-001", name: "Cao độ sàn T5 Block A — sai khác KT vs KC", block: "Block A", floor: "T5", cat: "Kết cấu", who: "Trương Thanh Tân", sub: "Trương Thanh Tân", status: "DA_DUYET", planDate: d(-22), actualDate: d(-22), offset: 3, rev: 0, links: ["s1"], notes: [{ id: "rn1", t: "KT +14.100 vs KC +14.200 → TVTK confirm theo KC", d: d(-20), h: "10:00" }] },
    { id: "r2", type: "RFI", code: "RFI-002", name: "Kích thước cửa sổ T3 Block A — rev2 vs rev3", block: "Block A", floor: "T3", cat: "Kiến trúc", who: "Trương Thanh Tân", sub: "Trương Thanh Tân", status: "DA_DUYET", planDate: d(-13), actualDate: d(-13), offset: 3, rev: 0, links: ["s6", "s7"], notes: [{ id: "rn2", t: "CĐT confirm rev3: cửa 1200x1400mm", d: d(-10), h: "11:00" }] },
    { id: "r3", type: "RFI", code: "RFI-003", name: "Vị trí lỗ thang máy T6 Block A — chênh 150mm", block: "Block A", floor: "T6", cat: "Kết cấu", who: "Trương Thanh Tân", sub: "Trương Thanh Tân", status: "CHO_DUYET", planDate: d(-3), actualDate: d(-3), offset: 3, rev: 0, links: ["s4"], notes: [{ id: "rn3", t: "Gửi TVTK bản vẽ so sánh, chờ phản hồi", d: d(-3), h: "09:30" }] },
    { id: "r4", type: "RFI", code: "RFI-004", name: "Sleeve ống điện ∅60 T3 Block B", block: "Block B", floor: "T3", cat: "MEP", who: "Trương Thanh Tân", sub: "Trương Thanh Tân", status: "DANG_VE", planDate: d(1), actualDate: "", offset: 3, rev: 0, links: ["s13"], notes: [{ id: "rn4", t: "Cần vẽ chi tiết sleeve trước khi gửi", d: d(0), h: "16:00" }] },
    { id: "r5", type: "RFI", code: "RFI-005", name: "Chống thấm hầm B1 Block C — đổi vật liệu", block: "Block C", floor: "B1", cat: "Kết cấu", who: "Trương Thanh Tân", sub: "Trương Thanh Tân", status: "REJECT", planDate: d(-8), actualDate: d(-8), offset: 5, rev: 0, links: ["s15"], notes: [{ id: "rn5", t: "CĐT reject: yêu cầu bảng so sánh giá 3 loại chống thấm", d: d(-4), h: "14:30" }, { id: "rn6", t: "Đang lấy báo giá Sika, Mapei, CT11A", d: d(-2), h: "09:00" }] },
    { id: "r6", type: "RFI", code: "RFI-006", name: "Thay đổi hộp kỹ thuật T4 Block A", block: "Block A", floor: "T4", cat: "MEP", who: "Trương Thanh Tân", sub: "Trương Thanh Tân", status: "DANG_VE", planDate: d(7), actualDate: "", offset: 3, rev: 0, links: [], notes: [] },
  ];
}

// ─── Firebase helpers ───
const ITEMS_REF = "items";

function writeAllItems(itemsArray) {
  const obj = {};
  itemsArray.forEach(it => { obj[it.id] = it; });
  set(ref(db, ITEMS_REF), obj);
}

function writeItem(item) {
  set(ref(db, `${ITEMS_REF}/${item.id}`), item);
}

function deleteItem(id) {
  remove(ref(db, `${ITEMS_REF}/${id}`));
}

function updateItem(id, data) {
  update(ref(db, `${ITEMS_REF}/${id}`), data);
}

// ─── Charts ───
function Donut({ data, size = 130 }) {
  const tot = data.reduce((s, d) => s + d.v, 0);
  if (!tot) return <div style={{ width: size, height: size, display: "flex", alignItems: "center", justifyContent: "center", color: "#64748B", fontSize: 12 }}>Trống</div>;
  let c = 0; const r = size / 2 - 5, cx = size / 2, cy = size / 2;
  return (<svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
    {data.filter(d => d.v > 0).map((d, i) => {
      const s = c / tot; c += d.v; const e = c / tot;
      if (e - s >= .999) return <circle key={i} cx={cx} cy={cy} r={r} fill={d.c} opacity={.85} />;
      const lg = e - s > .5 ? 1 : 0;
      const sx = cx + r * Math.cos(2 * Math.PI * s - Math.PI / 2), sy = cy + r * Math.sin(2 * Math.PI * s - Math.PI / 2);
      const ex = cx + r * Math.cos(2 * Math.PI * e - Math.PI / 2), ey = cy + r * Math.sin(2 * Math.PI * e - Math.PI / 2);
      return <path key={i} d={`M${cx},${cy}L${sx},${sy}A${r},${r} 0 ${lg} 1 ${ex},${ey}Z`} fill={d.c} opacity={.85} />;
    })}
    <circle cx={cx} cy={cy} r={r * .5} fill="#0F172A" />
    <text x={cx} y={cy + 1} textAnchor="middle" dominantBaseline="middle" fill="#F1F5F9" fontSize={18} fontWeight={800}>{tot}</text>
  </svg>);
}
function Bar({ data, h = 160 }) {
  const mx = Math.max(...data.map(d => d.v), 1); const bw = Math.min(32, Math.max(14, 240 / data.length - 4)); const w = data.length * (bw + 5) + 16;
  return (<svg width="100%" height={h} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="xMidYMid meet">
    {data.map((d, i) => { const bh = (d.v / mx) * (h - 28); const x = 8 + i * (bw + 5); return (<g key={i}><rect x={x} y={h - 16 - bh} width={bw} height={bh} rx={3} fill={d.c} opacity={.8} /><text x={x + bw / 2} y={h - 20 - bh} textAnchor="middle" fill="#94A3B8" fontSize={9} fontWeight={700}>{d.v}</text><text x={x + bw / 2} y={h - 3} textAnchor="middle" fill="#64748B" fontSize={7}>{d.l.length > 7 ? d.l.slice(0, 6) + "…" : d.l}</text></g>); })}
  </svg>);
}
function Seg({ data, h = 22 }) { const tot = data.reduce((s, d) => s + d.v, 0); if (!tot) return <div style={{ height: h, borderRadius: 6, background: "#1E293B" }} />; return <div style={{ display: "flex", borderRadius: 6, overflow: "hidden", height: h }}>{data.filter(d => d.v > 0).map((d, i) => <div key={i} style={{ width: `${d.v / tot * 100}%`, background: d.c, minWidth: 2 }} title={`${d.l}: ${d.v}`} />)}</div>; }
function Bd({ children, c, bg }) { return <span style={{ padding: "2px 9px", borderRadius: 16, fontSize: 11, fontWeight: 600, background: bg, color: c, whiteSpace: "nowrap" }}>{children}</span>; }

// ─── Main App ───
export default function App() {
  const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [items, setItems] = useState([]);
  const [ok, setOk] = useState(false);
  const [view, setView] = useState("dash");
  const [editId, setEditId] = useState(null);
  const [detId, setDetId] = useState(null);
  const [tab, setTab] = useState("SD");
  const [fl, setFl] = useState({ st: "ALL", rk: "ALL", bl: "ALL", ct: "ALL", wh: "ALL", q: "" });

  // ── Auth listener ──
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setAuthLoading(false);
    });
    return () => unsub();
  }, []);

  // ── Firebase realtime listener ──
  useEffect(() => {
    if (!user) return;
    const itemsRef = ref(db, ITEMS_REF);
    const unsub = onValue(itemsRef, (snapshot) => {
      const data = snapshot.val();
      if (data) {
        const arr = Object.values(data);
        setItems(arr);
      } else {
        // Database trống → load sample data
        const s = samples();
        writeAllItems(s);
        setItems(s);
      }
      setOk(true);
    });
    return () => unsub();
  }, [user]);

  const handleLogin = async () => {
    try { await signInWithPopup(auth, googleProvider); }
    catch (err) { console.error("Login error:", err); }
  };
  const handleLogout = async () => {
    try { await signOut(auth); setItems([]); setOk(false); }
    catch (err) { console.error("Logout error:", err); }
  };

  // ── CRUD ──
  const sv = useCallback((it) => {
    writeItem(it);
    setEditId(null);
    setView("list");
  }, []);

  const dl = useCallback((id) => {
    // Remove links pointing to this id from other items
    items.forEach(x => {
      if ((x.links || []).includes(id)) {
        updateItem(x.id, { links: (x.links || []).filter(l => l !== id) });
      }
    });
    deleteItem(id);
    if (detId === id) setDetId(null);
  }, [items, detId]);

  const uq = k => [...new Set(items.map(i => i[k]).filter(Boolean))].sort();
  const bls = useMemo(() => uq("block"), [items]);
  const cts = useMemo(() => uq("cat"), [items]);
  const ppl = useMemo(() => [...new Set([...items.map(i => i.who), ...items.map(i => i.sub)].filter(Boolean))].sort(), [items]);

  const flt = useMemo(() => items.filter(it => {
    if (it.type !== tab) return false;
    if (fl.st !== "ALL" && it.status !== fl.st) return false;
    if (fl.rk !== "ALL" && rsk(it) !== fl.rk) return false;
    if (fl.bl !== "ALL" && it.block !== fl.bl) return false;
    if (fl.ct !== "ALL" && it.cat !== fl.ct) return false;
    if (fl.wh !== "ALL" && it.who !== fl.wh && it.sub !== fl.wh) return false;
    if (fl.q) { const s = fl.q.toLowerCase(); return `${it.code} ${it.name} ${it.block} ${it.floor} ${it.cat} ${it.who} ${it.sub}`.toLowerCase().includes(s); }
    return true;
  }), [items, tab, fl]);

  const stats = useMemo(() => {
    const bS = {}, bR = { late: 0, high: 0, med: 0, ok: 0, done: 0, reject: 0, none: 0 }, bB = {}, bC = {}, bP = {};
    ST.forEach(s => bS[s.k] = 0);
    items.forEach(it => { bS[it.status]++; bR[rsk(it)]++; if (it.block) bB[it.block] = (bB[it.block] || 0) + 1; if (it.cat) bC[it.cat] = (bC[it.cat] || 0) + 1; if (it.who) bP[it.who] = (bP[it.who] || 0) + 1; });
    return { bS, bR, bB, bC, bP, tot: items.length, sd: items.filter(i => i.type === "SD").length, rfi: items.filter(i => i.type === "RFI").length };
  }, [items]);

  const alerts = useMemo(() => items.filter(i => ["late", "high"].includes(rsk(i))).sort((a, b) => (rsk(a) === "late" ? 0 : 1) - (rsk(b) === "late" ? 0 : 1) || (a.planDate || "").localeCompare(b.planDate || "")), [items]);

  const det = detId ? items.find(x => x.id === detId) : null;
  const eIt = editId === "ns" ? { id: Date.now().toString(36), type: "SD", code: "", name: "", block: "", floor: "", cat: "", who: "", sub: "", status: "DANG_VE", planDate: "", actualDate: "", offset: 7, rev: 0, links: [], notes: [] } : editId === "nr" ? { id: Date.now().toString(36), type: "RFI", code: "", name: "", block: "", floor: "", cat: "", who: "", sub: "", status: "DANG_VE", planDate: "", actualDate: "", offset: 3, rev: 0, links: [], notes: [] } : items.find(x => x.id === editId);

  // ── Loading ──
  if (authLoading) return <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", background: "#0F172A", color: "#F1F5F9" }}>Đang tải...</div>;

  // ── Login screen ──
  if (!user) return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", background: "#0F172A", flexDirection: "column", gap: 20 }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;600;700;800&display=swap');*{box-sizing:border-box;margin:0;padding:0}body{font-family:'Plus Jakarta Sans',sans-serif}`}</style>
      <div style={{ textAlign: "center" }}>
        <div style={{ fontSize: 48, marginBottom: 12 }}>📐</div>
        <h1 style={{ fontSize: 24, fontWeight: 800, color: "#F1F5F9", marginBottom: 6 }}>SD & RFI Tracker</h1>
        <p style={{ fontSize: 13, color: "#64748B", marginBottom: 24 }}>Wealthcons · Quản lý Shop Drawing & RFI</p>
        <button onClick={handleLogin} style={{
          padding: "12px 32px", borderRadius: 10, border: "none",
          background: "linear-gradient(135deg, #3B82F6, #8B5CF6)",
          color: "#fff", fontSize: 15, fontWeight: 700, cursor: "pointer",
          display: "flex", alignItems: "center", gap: 10, margin: "0 auto"
        }}>
          <svg width="20" height="20" viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" /><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" /><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" /><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" /></svg>
          Đăng nhập bằng Google
        </button>
      </div>
    </div>
  );

  if (!ok) return <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", background: "#0F172A", color: "#F1F5F9" }}>Đang đồng bộ dữ liệu...</div>;

  const done = (stats.bS.DA_DUYET || 0) + (stats.bS.DUYET_GC || 0);
  const pct = stats.tot ? Math.round(done / stats.tot * 100) : 0;
  const sData = ST.map(s => ({ l: s.l, v: stats.bS[s.k] || 0, c: s.c }));
  const rData = Object.entries(RC).filter(([k]) => k !== "none").map(([k, v]) => ({ l: v.l, v: stats.bR[k] || 0, c: v.c }));
  const ss = { padding: "5px 9px", borderRadius: 7, border: "1px solid #334155", background: "#1E293B", color: "#F1F5F9", fontSize: 12 };

  return (<>
    <style>{`@import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;700&family=Plus+Jakarta+Sans:wght@400;600;700;800&display=swap');*{box-sizing:border-box;margin:0;padding:0}body{background:#0F172A;color:#F1F5F9;font-family:'Plus Jakarta Sans',sans-serif}input,select,textarea{font-family:inherit}::-webkit-scrollbar{width:4px}::-webkit-scrollbar-thumb{background:#334155;border-radius:2px}`}</style>
    <div style={{ minHeight: "100vh", background: "#0F172A", padding: "12px 16px", maxWidth: 1400, margin: "0 auto" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14, flexWrap: "wrap", gap: 8 }}>
        <div><h1 style={{ fontSize: 19, fontWeight: 800, letterSpacing: -.5 }}>📐 SD & RFI Tracker</h1><p style={{ fontSize: 11, color: "#64748B" }}>Wealthcons · {stats.sd} SD · {stats.rfi} RFI</p></div>
        <div style={{ display: "flex", gap: 5, alignItems: "center", flexWrap: "wrap" }}>
          {[["dash", "📊 Tổng quan"], ["list", "📋 Danh sách"]].map(([k, l]) => <button key={k} onClick={() => { setView(k); setDetId(null); setEditId(null); }} style={{ padding: "6px 14px", borderRadius: 7, border: "1px solid", fontSize: 12, fontWeight: 600, cursor: "pointer", borderColor: view === k ? "#3B82F6" : "#334155", background: view === k ? "#3B82F6" : "transparent", color: view === k ? "#fff" : "#64748B" }}>{l}</button>)}
          <button onClick={() => { setEditId("ns"); setView("form"); }} style={{ padding: "6px 12px", borderRadius: 7, border: "none", background: "linear-gradient(135deg,#3B82F6,#8B5CF6)", color: "#fff", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>+ SD</button>
          <button onClick={() => { setEditId("nr"); setView("form"); }} style={{ padding: "6px 12px", borderRadius: 7, border: "none", background: "linear-gradient(135deg,#8B5CF6,#EC4899)", color: "#fff", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>+ RFI</button>
          <button onClick={() => { writeAllItems(samples()); setDetId(null); }} style={{ padding: "6px 10px", borderRadius: 7, border: "1px solid #334155", background: "transparent", color: "#F59E0B", fontSize: 11, cursor: "pointer" }}>🔄 Reset</button>
          {/* User info + Logout */}
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginLeft: 4 }}>
            {user.photoURL && <img src={user.photoURL} alt="" style={{ width: 26, height: 26, borderRadius: "50%" }} referrerPolicy="no-referrer" />}
            <span style={{ fontSize: 11, color: "#94A3B8", maxWidth: 100, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{user.displayName || user.email}</span>
            <button onClick={handleLogout} style={{ padding: "4px 8px", borderRadius: 5, border: "1px solid #334155", background: "transparent", color: "#EF4444", fontSize: 10, cursor: "pointer" }}>Đăng xuất</button>
          </div>
        </div>
      </div>

      {/* Detail overlay */}
      {det && <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,.6)", zIndex: 1000, display: "flex", justifyContent: "flex-end" }} onClick={() => setDetId(null)}>
        <div style={{ width: 400, maxWidth: "90vw", height: "100vh", background: "#1E293B", padding: "18px 20px", overflowY: "auto", boxShadow: "-4px 0 24px rgba(0,0,0,.4)" }} onClick={e => e.stopPropagation()}>
          <Detail item={det} items={items} onClose={() => setDetId(null)} onEdit={() => { setEditId(det.id); setView("form"); setDetId(null); }}
            onLink={tid => {
              const detLinks = [...new Set([...(det.links || []), tid])];
              const target = items.find(x => x.id === tid);
              const targetLinks = [...new Set([...(target?.links || []), det.id])];
              updateItem(det.id, { links: detLinks });
              updateItem(tid, { links: targetLinks });
            }}
            onUnlink={tid => {
              updateItem(det.id, { links: (det.links || []).filter(i => i !== tid) });
              updateItem(tid, { links: ((items.find(x => x.id === tid)?.links) || []).filter(i => i !== det.id) });
            }}
            onNote={t => {
              const newNotes = [...(det.notes || []), { id: Date.now().toString(36), t, d: td(), h: new Date().toLocaleTimeString("vi", { hour: "2-digit", minute: "2-digit" }) }];
              updateItem(det.id, { notes: newNotes });
            }}
            onDelNote={nid => {
              updateItem(det.id, { notes: (det.notes || []).filter(n => n.id !== nid) });
            }}
            onDel={() => dl(det.id)} onGo={id => setDetId(id)} />
        </div>
      </div>}

      {/* DASHBOARD */}
      {view === "dash" && <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(120px,1fr))", gap: 8 }}>
          {[{ l: "SD", v: stats.sd, c: "#3B82F6", i: "📐" }, { l: "RFI", v: stats.rfi, c: "#8B5CF6", i: "📝" }, { l: "Trễ", v: stats.bR.late, c: "#DC2626", i: "🔴" }, { l: "Nguy cơ", v: stats.bR.high, c: "#EA580C", i: "🟠" }, { l: "Duyệt", v: done, c: "#059669", i: "✅" }, { l: "Tỷ lệ", v: pct + "%", c: "#0891B2", i: "📈" }].map((c, i) =>
            <div key={i} style={{ background: "#1E293B", borderRadius: 10, padding: "12px 14px", borderLeft: `3px solid ${c.c}` }}>
              <div style={{ fontSize: 10, color: "#94A3B8", marginBottom: 3 }}>{c.i} {c.l}</div>
              <div style={{ fontSize: 24, fontWeight: 800, color: c.c, fontFamily: "'JetBrains Mono'" }}>{c.v}</div>
            </div>
          )}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <div style={{ background: "#1E293B", borderRadius: 10, padding: 14 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: "#94A3B8", marginBottom: 10 }}>Theo trạng thái</div>
            <div style={{ display: "flex", alignItems: "center", gap: 14 }}><Donut data={sData} /><div style={{ flex: 1 }}>{sData.filter(d => d.v > 0).map((d, i) => <div key={i} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, marginBottom: 3 }}><span style={{ width: 7, height: 7, borderRadius: 2, background: d.c, flexShrink: 0 }} /><span style={{ color: "#94A3B8", flex: 1 }}>{d.l}</span><span style={{ fontWeight: 700, fontFamily: "'JetBrains Mono'" }}>{d.v}</span></div>)}</div></div>
          </div>
          <div style={{ background: "#1E293B", borderRadius: 10, padding: 14 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: "#94A3B8", marginBottom: 10 }}>Theo rủi ro</div>
            <div style={{ display: "flex", alignItems: "center", gap: 14 }}><Donut data={rData} /><div style={{ flex: 1 }}>{rData.filter(d => d.v > 0).map((d, i) => <div key={i} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, marginBottom: 3 }}><span style={{ width: 7, height: 7, borderRadius: 2, background: d.c, flexShrink: 0 }} /><span style={{ color: "#94A3B8", flex: 1 }}>{d.l}</span><span style={{ fontWeight: 700, fontFamily: "'JetBrains Mono'" }}>{d.v}</span></div>)}</div></div>
          </div>
        </div>
        <div style={{ background: "#1E293B", borderRadius: 10, padding: "12px 14px" }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: "#94A3B8", marginBottom: 8 }}>Tiến độ</div>
          <Seg data={sData} h={24} />
          <div style={{ display: "flex", gap: 10, marginTop: 6, flexWrap: "wrap" }}>{sData.filter(d => d.v > 0).map((d, i) => <span key={i} style={{ fontSize: 10, color: "#94A3B8", display: "flex", alignItems: "center", gap: 3 }}><span style={{ width: 6, height: 6, borderRadius: 2, background: d.c }} />{d.l}({d.v})</span>)}</div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
          {[["Block", Object.entries(stats.bB), "#3B82F6"], ["Hạng mục", Object.entries(stats.bC), "#8B5CF6"], ["Người vẽ", Object.entries(stats.bP).sort((a, b) => b[1] - a[1]).slice(0, 8), "#0EA5E9"]].map(([t, d, c], i) =>
            <div key={i} style={{ background: "#1E293B", borderRadius: 10, padding: 14 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: "#94A3B8", marginBottom: 8 }}>{t}</div>
              {d.length ? <Bar data={d.map(([k, v]) => ({ l: k, v, c }))} /> : <div style={{ color: "#475569", fontSize: 12, padding: 16, textAlign: "center" }}>Trống</div>}
            </div>
          )}
        </div>
        <div style={{ background: "#1E293B", borderRadius: 10, padding: 14, borderLeft: "3px solid #EF4444" }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#EF4444", marginBottom: 8 }}>⚠️ Cảnh báo ({alerts.length})</div>
          {!alerts.length ? <div style={{ fontSize: 12, color: "#64748B" }}>Không có item trễ 🎉</div> :
            <div style={{ display: "flex", flexDirection: "column", gap: 5, maxHeight: 280, overflowY: "auto" }}>
              {alerts.map(it => { const r = rsk(it), rc = RC[r], l = ld(it); return (
                <div key={it.id} onClick={() => setDetId(it.id)} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", background: "#0F172A", borderRadius: 7, cursor: "pointer" }}>
                  <span>{rc.i}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 600 }}><span style={{ opacity: .5, fontSize: 10, marginRight: 3 }}>{it.type}</span>{it.code} · {it.name}</div>
                    <div style={{ fontSize: 10, color: "#64748B" }}>{it.block} · {it.who} · KH: {fm(it.planDate)}</div>
                  </div>
                  {l > 0 && <Bd c={rc.c} bg={rc.bg}>{r === "late" ? `Trễ ${l}d` : "≤3d"}</Bd>}
                </div>
              ); })}
            </div>}
        </div>
      </div>}

      {/* LIST */}
      {view === "list" && <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={{ display: "flex", gap: 0, borderBottom: "2px solid #1E293B" }}>
          {["SD", "RFI"].map(t => <button key={t} onClick={() => setTab(t)} style={{ padding: "7px 18px", border: "none", borderBottom: tab === t ? "3px solid #3B82F6" : "3px solid transparent", background: "transparent", color: tab === t ? "#F1F5F9" : "#64748B", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>{t === "SD" ? "📐 SD" : "📝 RFI"}</button>)}
        </div>
        <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
          <input placeholder="🔍 Tìm..." value={fl.q} onChange={e => setFl(f => ({ ...f, q: e.target.value }))} style={{ ...ss, flex: 1, minWidth: 100 }} />
          <select value={fl.bl} onChange={e => setFl(f => ({ ...f, bl: e.target.value }))} style={ss}><option value="ALL">Block</option>{bls.map(b => <option key={b}>{b}</option>)}</select>
          <select value={fl.ct} onChange={e => setFl(f => ({ ...f, ct: e.target.value }))} style={ss}><option value="ALL">Hạng mục</option>{cts.map(c => <option key={c}>{c}</option>)}</select>
          <select value={fl.wh} onChange={e => setFl(f => ({ ...f, wh: e.target.value }))} style={ss}><option value="ALL">Người</option>{ppl.map(p => <option key={p}>{p}</option>)}</select>
          <select value={fl.st} onChange={e => setFl(f => ({ ...f, st: e.target.value }))} style={ss}><option value="ALL">Trạng thái</option>{ST.map(s => <option key={s.k} value={s.k}>{s.l}</option>)}</select>
          <select value={fl.rk} onChange={e => setFl(f => ({ ...f, rk: e.target.value }))} style={ss}><option value="ALL">Rủi ro</option>{Object.entries(RC).map(([k, v]) => <option key={k} value={k}>{v.i}{v.l}</option>)}</select>
          {Object.values(fl).some(v => v !== "ALL" && v !== "") && <button onClick={() => setFl({ st: "ALL", rk: "ALL", bl: "ALL", ct: "ALL", wh: "ALL", q: "" })} style={{ ...ss, color: "#F87171", border: "1px solid #F87171", cursor: "pointer" }}>✕</button>}
        </div>
        <div style={{ fontSize: 11, color: "#64748B" }}>{flt.length} kết quả</div>
        <div style={{ overflowX: "auto", borderRadius: 8, border: "1px solid #1E293B" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
            <thead><tr style={{ background: "#1E293B" }}>{["", "Mã", "Tên", "Block", "Tầng", "HM", "Người vẽ", "Đệ trình", "TT", "KH", "TT nộp", "Duyệt", "Trễ", "🔗", "📝"].map((h, i) => <th key={i} style={{ padding: "8px 4px", textAlign: "left", fontWeight: 600, color: "#64748B", whiteSpace: "nowrap", borderBottom: "1px solid #334155", fontSize: 10 }}>{h}</th>)}</tr></thead>
            <tbody>{!flt.length ? <tr><td colSpan={15} style={{ padding: 30, textAlign: "center", color: "#475569" }}>Không có dữ liệu</td></tr> :
              flt.map(it => { const r = rsk(it), rc = RC[r], st = ST.find(s => s.k === it.status), l = ld(it), lk = (it.links || []).map(lid => items.find(x => x.id === lid)).filter(Boolean);
                return <tr key={it.id} onClick={() => setDetId(it.id)} style={{ cursor: "pointer", borderBottom: "1px solid #1E293B" }} onMouseEnter={e => e.currentTarget.style.background = "#1E293B"} onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                  <td style={{ padding: "6px 4px" }}>{rc.i}</td>
                  <td style={{ padding: "6px 4px", fontWeight: 700, fontFamily: "'JetBrains Mono'", fontSize: 10, whiteSpace: "nowrap" }}>{it.code || "—"}</td>
                  <td style={{ padding: "6px 4px", maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{it.name || "—"}</td>
                  <td style={{ padding: "6px 4px" }}>{it.block || "—"}</td>
                  <td style={{ padding: "6px 4px" }}>{it.floor || "—"}</td>
                  <td style={{ padding: "6px 4px" }}>{it.cat || "—"}</td>
                  <td style={{ padding: "6px 4px" }}>{it.who || "—"}</td>
                  <td style={{ padding: "6px 4px" }}>{it.sub || "—"}</td>
                  <td style={{ padding: "6px 4px" }}><Bd c={st?.c} bg={st?.bg}>{st?.l}</Bd></td>
                  <td style={{ padding: "6px 4px", fontFamily: "'JetBrains Mono'", fontSize: 9 }}>{fm(it.planDate)}</td>
                  <td style={{ padding: "6px 4px", fontFamily: "'JetBrains Mono'", fontSize: 9 }}>{fm(it.actualDate)}</td>
                  <td style={{ padding: "6px 4px", fontFamily: "'JetBrains Mono'", fontSize: 9 }}>{fm(ad(it.planDate, it.offset))}</td>
                  <td style={{ padding: "6px 4px" }}>{l > 0 ? <Bd c="#DC2626" bg="#FEE2E2">+{l}</Bd> : l === 0 ? <span style={{ color: "#64748B" }}>0</span> : "—"}</td>
                  <td style={{ padding: "6px 4px" }}>{lk.length > 0 && <span style={{ color: "#3B82F6" }}>🔗{lk.length}</span>}</td>
                  <td style={{ padding: "6px 4px" }}>{(it.notes || []).length > 0 && <span style={{ color: "#D97706" }}>📝{it.notes.length}</span>}</td>
                </tr>; })}</tbody>
          </table>
        </div>
      </div>}

      {/* FORM */}
      {view === "form" && eIt && <FormV item={eIt} onSave={sv} onCancel={() => { setEditId(null); setView("list"); }} />}
    </div>
  </>);
}

// ─── Detail Panel ───
function Detail({ item, items, onClose, onEdit, onLink, onUnlink, onNote, onDelNote, onDel, onGo }) {
  const [nt, setNt] = useState(""); const [ls, setLs] = useState(""); const [slp, setSlp] = useState(false);
  const st = ST.find(s => s.k === item.status), r = rsk(item), rc = RC[r], l = ld(item);
  const lk = (item.links || []).map(lid => items.find(x => x.id === lid)).filter(Boolean);
  const lkb = items.filter(x => x.id !== item.id && !(item.links || []).includes(x.id) && (!ls || `${x.code} ${x.name} ${x.type}`.toLowerCase().includes(ls.toLowerCase())));
  return (<>
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
      <div><div style={{ fontSize: 10, color: "#64748B", marginBottom: 2 }}>{item.type} · {item.block} · {item.floor} · {item.cat}</div>
        <h2 style={{ fontSize: 16, fontWeight: 800, marginBottom: 2 }}>{item.code || "—"}</h2>
        <div style={{ fontSize: 12, color: "#CBD5E1" }}>{item.name || "—"}</div></div>
      <button onClick={onClose} style={{ background: "none", border: "none", color: "#64748B", fontSize: 18, cursor: "pointer" }}>✕</button>
    </div>
    <div style={{ display: "flex", gap: 5, marginBottom: 12, flexWrap: "wrap" }}>
      <Bd c={st?.c} bg={st?.bg}>{st?.l}</Bd><Bd c={rc.c} bg={rc.bg}>{rc.i} {rc.l}</Bd>
      {l > 0 && <Bd c="#DC2626" bg="#FEE2E2">Trễ {l} ngày</Bd>}
      {item.rev > 0 && <Bd c="#7C3AED" bg="#EDE9FE">Rev {item.rev}</Bd>}
    </div>
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 7, marginBottom: 14 }}>
      {[["Người vẽ", item.who], ["Đệ trình", item.sub], ["Block", item.block], ["Tầng", item.floor], ["Hạng mục", item.cat], ["Offset", `+${item.offset}d`], ["KH nộp", fm(item.planDate)], ["Thực tế", fm(item.actualDate)], ["KH duyệt", fm(ad(item.planDate, item.offset))]].map(([k, v], i) =>
        <div key={i}><div style={{ fontSize: 9, color: "#64748B" }}>{k}</div><div style={{ fontSize: 12, fontWeight: 600 }}>{v || "—"}</div></div>
      )}
    </div>
    <hr style={{ border: "none", borderTop: "1px solid #1E293B", margin: "8px 0" }} />
    <div style={{ marginBottom: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 5 }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: "#94A3B8" }}>🔗 Liên kết ({lk.length})</span>
        <button onClick={() => setSlp(!slp)} style={{ background: "none", border: "1px solid #334155", borderRadius: 5, color: "#3B82F6", fontSize: 10, padding: "2px 8px", cursor: "pointer" }}>+</button>
      </div>
      {lk.map(x => { const xs = ST.find(s => s.k === x.status); return (
        <div key={x.id} style={{ display: "flex", alignItems: "center", gap: 5, padding: "5px 8px", background: "#0F172A", borderRadius: 6, marginBottom: 3, cursor: "pointer" }} onClick={() => onGo(x.id)}>
          <span style={{ fontSize: 10, fontWeight: 700, color: x.type === "RFI" ? "#8B5CF6" : "#3B82F6" }}>{x.type}</span>
          <span style={{ fontSize: 11, flex: 1 }}>{x.code} · {x.name || "—"}</span>
          <Bd c={xs?.c} bg={xs?.bg}>{xs?.l}</Bd>
          <button onClick={e => { e.stopPropagation(); onUnlink(x.id); }} style={{ background: "none", border: "none", color: "#EF4444", cursor: "pointer", fontSize: 12 }}>✕</button>
        </div>); })}
      {slp && <div style={{ background: "#0F172A", borderRadius: 6, padding: 6, marginTop: 4, border: "1px solid #334155" }}>
        <input placeholder="Tìm..." value={ls} onChange={e => setLs(e.target.value)} style={{ width: "100%", padding: "4px 7px", borderRadius: 5, border: "1px solid #334155", background: "#1E293B", color: "#F1F5F9", fontSize: 11, marginBottom: 3 }} />
        <div style={{ maxHeight: 120, overflowY: "auto" }}>{lkb.slice(0, 8).map(x => (
          <div key={x.id} onClick={() => { onLink(x.id); setLs(""); }} style={{ padding: "3px 5px", cursor: "pointer", borderRadius: 5, fontSize: 11, display: "flex", gap: 5 }} onMouseEnter={e => e.currentTarget.style.background = "#1E293B"} onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
            <span style={{ fontWeight: 700, color: x.type === "RFI" ? "#8B5CF6" : "#3B82F6", fontSize: 9 }}>{x.type}</span><span>{x.code} · {x.name || "—"}</span>
          </div>))}</div>
      </div>}
    </div>
    <hr style={{ border: "none", borderTop: "1px solid #1E293B", margin: "8px 0" }} />
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: "#94A3B8", marginBottom: 5 }}>📝 Ghi chú ({(item.notes || []).length})</div>
      <div style={{ display: "flex", gap: 5, marginBottom: 5 }}>
        <input placeholder="Thêm ghi chú..." value={nt} onChange={e => setNt(e.target.value)} onKeyDown={e => { if (e.key === "Enter" && nt.trim()) { onNote(nt.trim()); setNt(""); } }} style={{ flex: 1, padding: "5px 8px", borderRadius: 6, border: "1px solid #334155", background: "#0F172A", color: "#F1F5F9", fontSize: 11 }} />
        <button onClick={() => { if (nt.trim()) { onNote(nt.trim()); setNt(""); } }} style={{ padding: "5px 10px", borderRadius: 6, border: "none", background: "#3B82F6", color: "#fff", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>+</button>
      </div>
      <div style={{ maxHeight: 180, overflowY: "auto", display: "flex", flexDirection: "column", gap: 3 }}>
        {(item.notes || []).slice().reverse().map(n => (
          <div key={n.id} style={{ padding: "6px 8px", background: "#0F172A", borderRadius: 6, borderLeft: "3px solid #D97706" }}>
            <div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ fontSize: 9, color: "#64748B" }}>{n.d} · {n.h}</span><button onClick={() => onDelNote(n.id)} style={{ background: "none", border: "none", color: "#64748B", cursor: "pointer", fontSize: 10 }}>✕</button></div>
            <div style={{ fontSize: 11, marginTop: 2, color: "#E2E8F0", lineHeight: 1.3 }}>{n.t}</div>
          </div>))}
      </div>
    </div>
    <div style={{ display: "flex", gap: 6 }}>
      <button onClick={onEdit} style={{ flex: 1, padding: "7px 0", borderRadius: 7, border: "1px solid #334155", background: "transparent", color: "#3B82F6", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>✏️ Sửa</button>
      <button onClick={() => { if (window.confirm("Xóa?")) onDel(); }} style={{ padding: "7px 12px", borderRadius: 7, border: "1px solid #7F1D1D", background: "transparent", color: "#EF4444", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>🗑</button>
    </div>
  </>);
}

// ─── Form ───
function FormV({ item, onSave, onCancel }) {
  const [f, setF] = useState({ ...item }); const u = (k, v) => setF(p => ({ ...p, [k]: v }));
  const aDate = ad(f.planDate, f.offset); const r = rsk(f), rc = RC[r], l = ld(f);
  const I = { padding: "8px 10px", borderRadius: 7, border: "1px solid #334155", background: "#0F172A", color: "#F1F5F9", fontSize: 12, width: "100%" };
  const L = { fontSize: 10, fontWeight: 600, color: "#64748B", marginBottom: 2 };
  return (<div style={{ maxWidth: 640, margin: "0 auto" }}><div style={{ background: "#1E293B", borderRadius: 10, padding: 18 }}>
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
      <h2 style={{ fontSize: 16, fontWeight: 800 }}>{item.code ? "Sửa" : "Thêm"} {f.type}</h2>
      <div style={{ display: "flex", gap: 5 }}><span>{rc.i}</span><Bd c={rc.c} bg={rc.bg}>{rc.l}</Bd>{l > 0 && <Bd c="#DC2626" bg="#FEE2E2">{l}d</Bd>}</div>
    </div>
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
      <div><div style={L}>Loại</div><select value={f.type} onChange={e => u("type", e.target.value)} style={I}><option>SD</option><option>RFI</option></select></div>
      <div><div style={L}>Mã</div><input value={f.code} onChange={e => u("code", e.target.value)} style={I} placeholder="SD-KC-001" /></div>
      <div style={{ gridColumn: "1/-1" }}><div style={L}>Tên</div><input value={f.name} onChange={e => u("name", e.target.value)} style={I} placeholder="MB cốp pha sàn T5" /></div>
      <div><div style={L}>Block</div><input value={f.block} onChange={e => u("block", e.target.value)} style={I} /></div>
      <div><div style={L}>Tầng</div><input value={f.floor} onChange={e => u("floor", e.target.value)} style={I} /></div>
      <div><div style={L}>Hạng mục</div><input value={f.cat} onChange={e => u("cat", e.target.value)} style={I} /></div>
      <div><div style={L}>Rev</div><input type="number" min={0} value={f.rev} onChange={e => u("rev", +e.target.value || 0)} style={I} /></div>
      <div><div style={L}>Người vẽ</div><input value={f.who} onChange={e => u("who", e.target.value)} style={I} /></div>
      <div><div style={L}>Đệ trình</div><input value={f.sub} onChange={e => u("sub", e.target.value)} style={I} /></div>
      <div><div style={L}>Trạng thái</div><select value={f.status} onChange={e => u("status", e.target.value)} style={I}>{ST.map(s => <option key={s.k} value={s.k}>{s.l}</option>)}</select></div>
      <div><div style={L}>KH nộp</div><input type="date" value={f.planDate} onChange={e => u("planDate", e.target.value)} style={I} /></div>
      <div><div style={L}>Thực tế nộp</div><input type="date" value={f.actualDate} onChange={e => u("actualDate", e.target.value)} style={I} /></div>
      <div><div style={L}>Offset duyệt</div><div style={{ display: "flex", gap: 3 }}>{[3, 5, 7, 10, 14].map(n => <button key={n} onClick={() => u("offset", n)} style={{ flex: 1, padding: "7px 0", borderRadius: 5, border: "1px solid", fontSize: 11, fontWeight: 700, cursor: "pointer", borderColor: f.offset === n ? "#3B82F6" : "#334155", background: f.offset === n ? "#3B82F6" : "transparent", color: f.offset === n ? "#fff" : "#64748B" }}>+{n}</button>)}</div></div>
      <div><div style={L}>KH duyệt</div><div style={{ ...I, background: "#1E293B", fontFamily: "'JetBrains Mono'" }}>{aDate ? fm(aDate) : "—"}</div></div>
    </div>
    <div style={{ display: "flex", gap: 8, marginTop: 14, justifyContent: "flex-end" }}>
      <button onClick={onCancel} style={{ padding: "8px 18px", borderRadius: 7, border: "1px solid #334155", background: "transparent", color: "#94A3B8", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>Hủy</button>
      <button onClick={() => onSave(f)} style={{ padding: "8px 18px", borderRadius: 7, border: "none", background: "linear-gradient(135deg,#3B82F6,#8B5CF6)", color: "#fff", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>💾 Lưu</button>
    </div>
  </div></div>);
}
